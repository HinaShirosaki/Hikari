'use strict';

const fs = require('fs/promises');
const path = require('path');
const { transformPaperRecordsToMarkdown } = require('../paper-markdown-import');
const { resolveStorageRootLayout } = require('./storage-paths');
const { asArray, cleanText, ensureObject, normalizeFileTimestamp } = require('./storage-utils');

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join('/');
}

function simpleHash(value) {
  const source = String(value || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(16)}`;
}

function humanizeFileStem(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchFolderBackedRecord(records, folderName) {
  const normalizedFolder = sanitizeFolderName(folderName, '').toLowerCase();
  if (!normalizedFolder) {
    return null;
  }
  return asArray(records).find((record) => {
    const source = ensureObject(record);
    const candidateNames = [
      cleanText(source.name, 320),
      cleanText(source.linkedName, 320),
      cleanText(source.id, 220)
    ].filter(Boolean);
    return candidateNames.some((candidate) => (
      sanitizeFolderName(candidate, '').toLowerCase() === normalizedFolder
    ));
  }) || null;
}

function inferDiscoveredPaperContext(relativePath, options = {}) {
  const normalizedRelativePath = cleanText(relativePath, 2400);
  const parts = normalizedRelativePath.split('/').filter(Boolean);
  const projects = asArray(options.projects);
  const journalClubs = asArray(options.journalClubs);

  if (parts[0]?.toLowerCase() === 'project' && parts[2]?.toLowerCase() === 'papers') {
    const projectFolderName = parts[1] || 'Project';
    const matchedProject = matchFolderBackedRecord(projects, projectFolderName);
    return {
      linkedType: 'project',
      linkedId: cleanText(matchedProject?.id, 220) || sanitizeFolderName(projectFolderName, 'project'),
      linkedName: cleanText(matchedProject?.name, 320) || projectFolderName,
      discoveredJournalClub: null
    };
  }

  if (parts[0]?.toLowerCase() === 'papers') {
    const globalFolderName = parts[1] || 'Global Papers';
    const matchedClub = matchFolderBackedRecord(journalClubs, globalFolderName);
    const linkedId = cleanText(matchedClub?.id, 220) || `journal-club-${simpleHash(globalFolderName.toLowerCase())}`;
    const linkedName = cleanText(matchedClub?.name, 320) || globalFolderName;
    return {
      linkedType: 'journal-club',
      linkedId,
      linkedName,
      discoveredJournalClub: matchedClub
        ? null
        : {
            id: linkedId,
            name: linkedName,
            description: 'Discovered from the storage root Papers folder.'
          }
    };
  }

  if (parts[0]?.toLowerCase() === 'workflow') {
    const workflowFolderName = parts.find((part) => /__/.test(part)) || parts[1] || 'Workflow Papers';
    const linkedName = humanizeFileStem(workflowFolderName).replace(/\s+/g, ' ').trim() || workflowFolderName;
    const linkedId = `workflow-papers-${simpleHash(normalizedRelativePath.split('/').slice(0, -1).join('/').toLowerCase())}`;
    return {
      linkedType: 'journal-club',
      linkedId,
      linkedName,
      discoveredJournalClub: {
        id: linkedId,
        name: linkedName,
        description: 'Discovered from a workflow paper folder.'
      }
    };
  }

  return {
    linkedType: 'journal-club',
    linkedId: `journal-club-${simpleHash(normalizedRelativePath.toLowerCase())}`,
    linkedName: 'Discovered Papers',
    discoveredJournalClub: {
      id: `journal-club-${simpleHash(normalizedRelativePath.toLowerCase())}`,
      name: 'Discovered Papers',
      description: 'Discovered from storage.'
    }
  };
}

async function collectCandidatePaperFolders(storageRootPath) {
  const discoveredFolders = [];
  const seen = new Set();

  async function walk(currentPath, depth = 0) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const absolutePath = path.join(currentPath, entry.name);
      const lowered = entry.name.toLowerCase();
      if (lowered === 'papers' || lowered === 'relatedpapers') {
        const key = path.resolve(absolutePath);
        if (!seen.has(key)) {
          seen.add(key);
          discoveredFolders.push(absolutePath);
        }
      }
      if (depth < 8) {
        await walk(absolutePath, depth + 1);
      }
    }
  }

  await walk(storageRootPath, 0);
  return discoveredFolders;
}

async function collectPdfFiles(folderPath) {
  const rows = [];

  async function walk(currentPath, depth = 0) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) {
          await walk(absolutePath, depth + 1);
        }
        continue;
      }
      if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        rows.push(absolutePath);
      }
    }
  }

  await walk(folderPath, 0);
  return rows;
}

async function buildDiscoveredPaperRecord(storageRootPath, absolutePath, options = {}) {
  const stat = await fs.stat(absolutePath);
  const relativePath = toPosixRelative(storageRootPath, absolutePath);
  const existingPaper = asArray(options.knownPapers).find((paper) => {
    const source = ensureObject(paper);
    return cleanText(source.storedRelativePath, 2400).toLowerCase() === relativePath.toLowerCase();
  }) || null;
  const context = inferDiscoveredPaperContext(relativePath, options);
  const fileName = path.basename(absolutePath);
  const baseRecord = {
    id: cleanText(existingPaper?.id, 220) || `paper-${simpleHash(relativePath.toLowerCase())}`,
    title: cleanText(existingPaper?.title, 320) || humanizeFileStem(fileName) || fileName,
    fileName: cleanText(existingPaper?.fileName, 320) || fileName,
    pdfDataUrl: '',
    storedFilePath: '',
    storedRelativePath: relativePath,
    linkedType: context.linkedType,
    linkedId: context.linkedId,
    linkedName: context.linkedName,
    summary: cleanText(existingPaper?.summary, 20000),
    summaryStructured: existingPaper?.summaryStructured || null,
    summaryStatus: cleanText(existingPaper?.summaryStatus, 80) || 'idle',
    methodsExtract: asArray(existingPaper?.methodsExtract),
    methodsStatus: cleanText(existingPaper?.methodsStatus, 80) || 'idle',
    keyReagents: asArray(existingPaper?.keyReagents),
    reagentsStatus: cleanText(existingPaper?.reagentsStatus, 80) || 'idle',
    keyFigures: asArray(existingPaper?.keyFigures),
    highlights: asArray(existingPaper?.highlights),
    comments: asArray(existingPaper?.comments),
    deepReadReady: existingPaper?.deepReadReady === true,
    availabilityStatus: cleanText(existingPaper?.availabilityStatus, 80) || 'uploaded_pdf',
    ingestionStatus: cleanText(existingPaper?.ingestionStatus, 80) || 'uploaded',
    ingestionUpdatedAt: cleanText(existingPaper?.ingestionUpdatedAt, 80) || normalizeFileTimestamp(stat),
    ingestionErrors: asArray(existingPaper?.ingestionErrors),
    discoverySource: 'storage_scan',
    discoveredAt: cleanText(existingPaper?.discoveredAt, 80) || normalizeFileTimestamp(stat),
    createdAt: cleanText(existingPaper?.createdAt, 80) || normalizeFileTimestamp(stat),
    updatedAt: cleanText(existingPaper?.updatedAt, 80) || normalizeFileTimestamp(stat)
  };
  return {
    paper: existingPaper
      ? {
          ...existingPaper,
          ...baseRecord
        }
      : baseRecord,
    discoveredJournalClub: context.discoveredJournalClub
  };
}

async function discoverPapersFromStorageRoot({
  storagePath = '',
  knownPapers = [],
  projects = [],
  journalClubs = []
} = {}) {
  const storageRootPath = cleanText(storagePath, 2400);
  if (!storageRootPath) {
    return {
      papers: [],
      journalClubs: [],
      scannedFolders: [],
      warnings: []
    };
  }

  const layout = resolveStorageRootLayout({ storagePath: storageRootPath });
  const candidateFolders = await collectCandidatePaperFolders(layout.storageRootPath || storageRootPath);
  const discoveredPapers = [];
  const discoveredJournalClubs = new Map();
  const warnings = [];
  const seenRelativePaths = new Set();

  for (const folderPath of candidateFolders) {
    let pdfFiles = [];
    try {
      pdfFiles = await collectPdfFiles(folderPath);
    } catch (error) {
      warnings.push(`Failed to scan ${toPosixRelative(storageRootPath, folderPath)}: ${String(error?.message || error)}`);
      continue;
    }

    for (const absolutePath of pdfFiles) {
      try {
        const discovered = await buildDiscoveredPaperRecord(storageRootPath, absolutePath, {
          knownPapers,
          projects,
          journalClubs
        });
        const relativePath = cleanText(discovered.paper?.storedRelativePath, 2400).toLowerCase();
        if (!relativePath || seenRelativePaths.has(relativePath)) {
          continue;
        }
        seenRelativePaths.add(relativePath);
        discoveredPapers.push(discovered.paper);
        if (discovered.discoveredJournalClub) {
          discoveredJournalClubs.set(discovered.discoveredJournalClub.id, discovered.discoveredJournalClub);
        }
      } catch (error) {
        warnings.push(`Failed to index ${toPosixRelative(storageRootPath, absolutePath)}: ${String(error?.message || error)}`);
      }
    }
  }

  const paperMarkdown = await transformPaperRecordsToMarkdown({
    storagePath: storageRootPath,
    papers: discoveredPapers,
    source: 'storage_scan'
  });
  warnings.push(...asArray(paperMarkdown.warnings));

  return {
    papers: discoveredPapers,
    journalClubs: [...discoveredJournalClubs.values()],
    scannedFolders: candidateFolders.map((folderPath) => toPosixRelative(storageRootPath, folderPath)),
    paperMarkdown,
    warnings
  };
}

module.exports = {
  discoverPapersFromStorageRoot
};
