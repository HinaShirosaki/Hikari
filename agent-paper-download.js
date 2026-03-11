const fs = require('fs/promises');
const path = require('path');

function sanitizeStorageName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizePdfFileName(fileName, fallback = 'paper.pdf') {
  const rawName = String(fileName || '').trim();
  const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24).toLowerCase();
  const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
  const safeBase = sanitizeStorageName(base, path.parse(fallback).name || 'paper');
  const safeExt = ext === '.pdf' ? '.pdf' : '.pdf';
  return `${safeBase}${safeExt}`;
}

function ensurePathWithinRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Target path must be inside the configured storage path.');
  }
  return resolvedTarget;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getUniqueFilePath(folderPath, fileName) {
  const parsed = path.parse(fileName);
  const safeNameBase = sanitizeStorageName(parsed.name, 'paper');
  const safeExt = '.pdf';
  let attempt = 0;

  while (attempt < 5000) {
    const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
    const candidateName = `${safeNameBase}${suffix}${safeExt}`;
    const candidatePath = path.join(folderPath, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }

  throw new Error('Unable to find a unique file name for downloaded PDF.');
}

function buildPaperStorageFolder({ storagePath, linkedType, linkedName }) {
  const category = linkedType === 'journal-club' ? 'JournalClub' : 'Project';
  const safeLinkedName = sanitizeStorageName(linkedName, 'Uncategorized');
  return path.join(path.resolve(storagePath), category, safeLinkedName, 'Papers');
}

function getFileNameFromDisposition(disposition) {
  const source = String(disposition || '');
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return String(utf8Match[1] || '').trim();
    }
  }
  const basicMatch = source.match(/filename="?([^";]+)"?/i);
  return String(basicMatch?.[1] || '').trim();
}

function inferFileNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(String(url || ''));
    const base = decodeURIComponent(path.basename(parsed.pathname || '')).trim();
    if (base) {
      return base;
    }
  } catch {
    // Keep fallback.
  }
  return fallback;
}

function looksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.slice(0, 5).toString('utf8') === '%PDF-';
}

async function downloadPdfToFolder({
  url,
  folderPath,
  rootPath,
  preferredFileName = '',
  fallbackFileName = 'paper.pdf'
}) {
  const response = await fetch(String(url || '').trim());
  if (!response.ok) {
    throw new Error(`Failed to download PDF (${response.status}) from ${url}`);
  }

  const binary = Buffer.from(await response.arrayBuffer());
  if (!binary.length) {
    throw new Error(`Downloaded empty content from ${url}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('pdf') && !looksLikePdf(binary)) {
    throw new Error(`Downloaded file is not a PDF: ${url}`);
  }

  const dispositionName = getFileNameFromDisposition(response.headers.get('content-disposition'));
  const rawFileName = preferredFileName || dispositionName || inferFileNameFromUrl(url, fallbackFileName);
  const fileName = sanitizePdfFileName(rawFileName, fallbackFileName);

  const resolvedRoot = path.resolve(rootPath);
  const resolvedFolder = ensurePathWithinRoot(resolvedRoot, folderPath);
  await fs.mkdir(resolvedFolder, { recursive: true });

  const targetFilePath = await getUniqueFilePath(resolvedFolder, fileName);
  await fs.writeFile(targetFilePath, binary);

  return {
    sourceUrl: String(url || '').trim(),
    filePath: targetFilePath,
    fileName: path.basename(targetFilePath),
    relativePath: path.relative(resolvedRoot, targetFilePath).split(path.sep).join('/'),
    sizeBytes: binary.length
  };
}

function normalizeSiItems(siPdfSources, siFileNames) {
  const names = Array.isArray(siFileNames) ? siFileNames : [];
  const sourceItems = Array.isArray(siPdfSources)
    ? siPdfSources
    : siPdfSources
      ? [siPdfSources]
      : [];
  return sourceItems.map((item, index) => {
    if (typeof item === 'string') {
      return {
        url: item,
        fileName: names[index] || `si_${index + 1}.pdf`
      };
    }
    if (item && typeof item === 'object') {
      return {
        url: String(item.url || '').trim(),
        fileName: String(item.fileName || names[index] || `si_${index + 1}.pdf`).trim()
      };
    }
    return {
      url: '',
      fileName: names[index] || `si_${index + 1}.pdf`
    };
  }).filter((item) => item.url);
}

async function downloadPaperAndSiPdf({
  storagePath,
  linkedType = 'project',
  linkedName = 'Uncategorized',
  paperPdfUrl,
  paperFileName = '',
  siPdfSources = [],
  siFileNames = []
}) {
  const rootPath = String(storagePath || '').trim();
  const paperUrl = String(paperPdfUrl || '').trim();

  if (!rootPath) {
    throw new Error('Missing storagePath.');
  }
  if (!paperUrl) {
    throw new Error('Missing paperPdfUrl.');
  }

  const papersFolder = buildPaperStorageFolder({
    storagePath: rootPath,
    linkedType,
    linkedName
  });
  const siFolder = path.join(papersFolder, 'SI');

  const paper = await downloadPdfToFolder({
    url: paperUrl,
    folderPath: papersFolder,
    rootPath,
    preferredFileName: paperFileName,
    fallbackFileName: 'paper.pdf'
  });

  const normalizedSiItems = normalizeSiItems(siPdfSources, siFileNames);
  const siPdfs = [];
  for (const item of normalizedSiItems) {
    const storedSi = await downloadPdfToFolder({
      url: item.url,
      folderPath: siFolder,
      rootPath,
      preferredFileName: item.fileName,
      fallbackFileName: 'si.pdf'
    });
    siPdfs.push(storedSi);
  }

  return {
    paper,
    siPdfs,
    folders: {
      papers: papersFolder,
      si: siFolder
    }
  };
}

module.exports = {
  downloadPaperAndSiPdf
};
