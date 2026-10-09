'use strict';

const fs = require('fs/promises');
const path = require('path');
const { PROJECT_SEQUENCE_FOLDER_NAME, RECORD_FOLDERS, getBundlePaths } = require('./storage-paths');
const {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  MEMORY_FILE_NAME,
  collectProjectMemoryRecords,
  writeProjectMemoryFile
} = require('../project-memory');
const { writeChemicalSqliteBundleIndex } = require('./storage-sql-write');
const { CHEMICAL_INDEX_UNREADABLE_CODE } = require('./chemical-index-guard');
const { writeSampleContainers } = require('./sample-containers');
const { writeExperimentLogSidecar } = require('./experiment-log-storage');
const { asArray, cleanText, ensureObject, forEachInBatches, isUnreadableJsonFile, sanitizeFolderName } = require('./storage-utils');
const { syncWorkflowRootFromSnapshot } = require('./workflow-storage');
const { isPathInside } = require('../lib/path-safety.js');
const { writeFileAtomic } = require('../lib/shared-json-file.js');
const { withStorageRootWrite } = require('./write-coordinator');
const { PAPER_RECORD_FILE_SUFFIX } = require('./paper-discovery');
const { removeGeneratedMarkdownSafely } = require('./record-markdown');
const { writeRecordDocumentSafely } = require('./record-markdown/document-storage');
const { buildNotebookPageFolderPath, buildProtocolFolderName, isWorkflowNotebookEntry, protocolFoldersById, snapshotDocumentInputs } = require('./record-markdown/record-paths');
const { preflightDocuments } = require('./record-markdown/preflight');
const { readRecordDocument } = require('./record-markdown/document-storage');

const PROTOCOL_SIDECAR_SCHEMA = 'hikari_protocols';
const NOTEBOOK_SIDECAR_SCHEMA = 'hikari_notebook_pages';
const SIDECAR_SCHEMA_VERSION = '1.0.0';
const PROTOCOL_FILE_NAME = 'protocol.md';

function buildProtocolsSidecar(snapshot, updatedAt) {
  return {
    schema_name: PROTOCOL_SIDECAR_SCHEMA,
    schema_version: SIDECAR_SCHEMA_VERSION,
    updated_at: updatedAt,
    protocols: asArray(snapshot.protocols)
  };
}

function buildNotebookPagesSidecar(snapshot, updatedAt) {
  return {
    schema_name: NOTEBOOK_SIDECAR_SCHEMA,
    schema_version: SIDECAR_SCHEMA_VERSION,
    updated_at: updatedAt,
    notebookPages: asArray(snapshot.notebookEntries)
  };
}

async function writeProtocolFiles(protocolRootPath, snapshot, updatedAt, markdownWarnings, skippedRecords) {
  const protocols = asArray(snapshot.protocols).map((rawProtocol) => ensureObject(rawProtocol));
  if (!protocolRootPath) {
    return [];
  }
  await fs.mkdir(protocolRootPath, { recursive: true });
  const existingEntries = await fs.readdir(protocolRootPath, { withFileTypes: true }).catch(() => []);
  const existingFoldersById = await protocolFoldersById(protocolRootPath, protocols);
  const activeFolders = new Set();
  const writtenPaths = [];
  await forEachInBatches(protocols, async (protocol, index) => {
    // Stable folders preserve document edits, attachments and citations on rename.
    const folderName = existingFoldersById.get(protocol.id) || buildProtocolFolderName(protocol, index);
    activeFolders.add(folderName);
    const filePath = path.join(protocolRootPath, folderName, PROTOCOL_FILE_NAME);
    writtenPaths.push(filePath);
    const payload = {
      schema_name: PROTOCOL_SIDECAR_SCHEMA,
      schema_version: SIDECAR_SCHEMA_VERSION,
      updated_at: updatedAt,
      protocol
    };
    const saved = await writeRecordDocumentSafely({ filePath, payload, kind: 'protocol', snapshot, storageRoot: path.dirname(protocolRootPath) }, markdownWarnings, skippedRecords);
    Object.assign(protocol, saved.record);
  });

  // A deleted or renamed protocol loses its record file; the folder goes only
  // once nothing else is in it, so files the user kept there survive.
  const activeIds = new Set(protocols.map((protocol) => protocol.id).filter(Boolean));
  for (const entry of existingEntries) {
    if (!entry.isDirectory() || activeFolders.has(entry.name)) {
      continue;
    }
    const filePath = path.join(protocolRootPath, entry.name, PROTOCOL_FILE_NAME);
    const stored = await readRecordDocument(filePath, 'protocol');
    // Unreadable records and copies of a protocol still in use are kept.
    if ((stored.exists && !stored.ok) || activeIds.has(stored.data?.protocol?.id)) {
      continue;
    }
    await removeGeneratedMarkdownSafely(filePath, markdownWarnings);
    await fs.rm(filePath.replace(/\.md$/, '.json'), { force: true });
    await fs.rmdir(path.join(protocolRootPath, entry.name)).catch(() => {});
  }

  return writtenPaths;
}

// A record whose artifacts already sit in a folder under this root keeps that
// folder, so its record file lands beside them; the modules name new folders
// the same way.
function buildRecordFolderName(rootPath, record, label) {
  const storageFolder = cleanText(record.storageFolder, 2400);
  if (storageFolder && path.dirname(path.resolve(storageFolder)) === path.resolve(rootPath)) {
    return path.basename(path.resolve(storageFolder));
  }
  const id = sanitizeFolderName(record.id, label.toLowerCase());
  return `${sanitizeFolderName(record.name || record.assayNumber || record.id, label)}__${id}`;
}

// One folder per record, found again on load by scanning the root. The folders
// also hold the modules' artifacts (images, analysis results), so a removed
// record loses only its record file, and the folder goes only once empty.
async function writeRecordFolders(rootPath, records, { fileName, key, schemaName, label }, updatedAt) {
  if (!rootPath) {
    return [];
  }
  await fs.mkdir(rootPath, { recursive: true });
  const activeFolders = new Set();
  const writtenPaths = [];
  for (const rawRecord of asArray(records)) {
    const record = ensureObject(rawRecord);
    if (!cleanText(record.id, 220)) {
      continue;
    }
    const folderName = buildRecordFolderName(rootPath, record, label);
    activeFolders.add(folderName);
    const filePath = path.join(rootPath, folderName, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(fs, filePath, JSON.stringify({
      schema_name: schemaName,
      schema_version: SIDECAR_SCHEMA_VERSION,
      updated_at: updatedAt,
      [key]: record
    }, null, 2));
    writtenPaths.push(filePath);
  }
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const filePath = path.join(rootPath, entry.name, fileName);
    if (entry.isDirectory() && !activeFolders.has(entry.name) && !(await isUnreadableJsonFile(filePath))) {
      await fs.rm(filePath, { force: true });
      await fs.rmdir(path.join(rootPath, entry.name)).catch(() => {});
    }
  }
  return writtenPaths;
}

// Beside each stored PDF, where readPaperRecordFiles finds it. A record whose
// PDF is not a file inside the storage root has nothing to sit beside.
async function writePaperRecordFiles(storageRootPath, papers, updatedAt) {
  for (const rawPaper of asArray(papers)) {
    const paper = ensureObject(rawPaper);
    const relativePath = cleanText(paper.storedRelativePath, 2400);
    if (!cleanText(paper.id, 220) || !relativePath) {
      continue;
    }
    const pdfPath = path.resolve(storageRootPath, relativePath);
    const isStoredFile = isPathInside(storageRootPath, pdfPath)
      && await fs.stat(pdfPath).then((stat) => stat.isFile(), () => false);
    if (!isStoredFile) {
      continue;
    }
    await writeFileAtomic(fs, `${pdfPath}${PAPER_RECORD_FILE_SUFFIX}`, JSON.stringify({
      schema_name: 'hikari_paper',
      schema_version: SIDECAR_SCHEMA_VERSION,
      updated_at: updatedAt,
      paper: { ...paper, pdfDataUrl: '', storedFilePath: '' }
    }, null, 2));
  }
}

function compactNotebookEntryForFolder(entry) {
  return {
    ...ensureObject(entry),
    storageDocumentFile: undefined,
    storageFolder: ''
  };
}

async function writeNotebookPageFolders(storageRootPath, snapshot, updatedAt, markdownWarnings, skippedRecords) {
  const writtenPaths = [];
  const notebookEntries = asArray(snapshot.notebookEntries)
    .map((entry) => ensureObject(entry))
    .filter((entry) => !isWorkflowNotebookEntry(entry, snapshot.workflows));
  await forEachInBatches(notebookEntries, async (entry) => {
    const folderPath = buildNotebookPageFolderPath(storageRootPath, entry);
    const filePath = path.join(folderPath, 'page.md');
    writtenPaths.push(filePath);
    const payload = {
      schema_name: NOTEBOOK_SIDECAR_SCHEMA,
      schema_version: SIDECAR_SCHEMA_VERSION,
      updated_at: updatedAt,
      notebookEntry: compactNotebookEntryForFolder(entry)
    };
    const saved = await writeRecordDocumentSafely({ filePath, payload, kind: 'notebook', snapshot, storageRoot: storageRootPath }, markdownWarnings, skippedRecords);
    if (!saved.skipped) Object.assign(entry, saved.record, { storageFolder: folderPath, storageDocumentFile: saved.markdownPath ? 'page.md' : 'page.json' });
  });
  return writtenPaths;
}

async function writeProjectMemoryFiles(
  storageRootPath,
  snapshot,
  releaseOfficialSkills,
  requestNotebookConclusion,
  agentMemoryFilePath
) {
  if (!storageRootPath) {
    return [];
  }
  const projectRootPath = path.join(storageRootPath, 'Project');
  await fs.mkdir(projectRootPath, { recursive: true });
  const projectRecords = collectProjectMemoryRecords(snapshot);
  const writtenPaths = [];
  for (const projectRecord of projectRecords) {
    const folderPath = path.join(projectRootPath, cleanText(projectRecord.folderName, 320) || 'Untitled_Project');
    const filePath = path.join(folderPath, MEMORY_FILE_NAME);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.mkdir(path.join(folderPath, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME), { recursive: true });
    // Sequence viewer's per-project folder, sibling of the project's Notebook
    // folder. The library rail mirrors the same set from `sequence_folders`.
    await fs.mkdir(path.join(folderPath, PROJECT_SEQUENCE_FOLDER_NAME), { recursive: true });
    await releaseOfficialSkills(folderPath, { snapshot });
    const result = await writeProjectMemoryFile({
      storageRootPath,
      folderPath,
      snapshot,
      projectRecord,
      requestNotebookConclusion,
      agentMemoryFilePath
    });
    writtenPaths.push(result.filePath || filePath);
  }
  return writtenPaths;
}

async function syncBundleFromSnapshotUnlocked({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = '',
  releaseOfficialMcpSkillsForWorkspace = async () => {},
  requestProjectMemoryConclusion = null,
  getAgentMemoryFilePath = null
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const bundlePaths = getBundlePaths({
    dataFilePath,
    fallbackDataFilePath,
    storagePath: safeSnapshot?.settings?.storagePath
  });
  const storageRootPath = cleanText(bundlePaths.storageRootPath, 2400)
    || (bundlePaths.dataFilePath ? path.dirname(bundlePaths.dataFilePath) : '');
  if (!storageRootPath) {
    return {
      bundlePaths,
      sidecarPaths: {}
    };
  }
  const updatedAt = new Date().toISOString();
  const markdownWarnings = [];
  const skippedRecords = [];
  preflightDocuments(await snapshotDocumentInputs(storageRootPath, safeSnapshot));
  await fs.mkdir(storageRootPath, { recursive: true });
  await releaseOfficialMcpSkillsForWorkspace(storageRootPath, { snapshot: safeSnapshot });
  if (bundlePaths.dataFilePath) {
    await fs.mkdir(path.dirname(bundlePaths.dataFilePath), { recursive: true });
  }
  await Promise.all([
    bundlePaths.papersRootPath ? fs.mkdir(bundlePaths.papersRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.assaysRootPath ? fs.mkdir(bundlePaths.assaysRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.gelsRootPath ? fs.mkdir(bundlePaths.gelsRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.paperMarkdownRootPath ? fs.mkdir(bundlePaths.paperMarkdownRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.samplesRootPath ? fs.mkdir(bundlePaths.samplesRootPath, { recursive: true }) : Promise.resolve()
  ]);
  const protocolFilePaths = await writeProtocolFiles(bundlePaths.protocolsPath, safeSnapshot, updatedAt, markdownWarnings, skippedRecords);
  const notebookPageFolderPaths = bundlePaths.storageRootPath
    ? await writeNotebookPageFolders(bundlePaths.storageRootPath, safeSnapshot, updatedAt, markdownWarnings, skippedRecords)
    : [];
  const projectMemoryFilePaths = bundlePaths.storageRootPath
    ? await writeProjectMemoryFiles(
      bundlePaths.storageRootPath,
      safeSnapshot,
      releaseOfficialMcpSkillsForWorkspace,
      requestProjectMemoryConclusion,
      typeof getAgentMemoryFilePath === 'function' ? cleanText(getAgentMemoryFilePath(), 2400) : ''
    )
    : [];
  await writeSampleContainers(bundlePaths.samplesRootPath, safeSnapshot, updatedAt);
  const experimentLogPath = await writeExperimentLogSidecar(
    bundlePaths.experimentLogPath,
    safeSnapshot,
    updatedAt
  );
  for (const [snapshotKey, folders] of Object.entries(RECORD_FOLDERS)) {
    await writeRecordFolders(bundlePaths[folders.rootKey], safeSnapshot[snapshotKey], folders, updatedAt);
  }
  await writePaperRecordFiles(storageRootPath, safeSnapshot.papers, updatedAt);
  // An unreadable chemicals index that could not be moved aside stays untouched;
  // everything else in the save still goes through.
  await writeChemicalSqliteBundleIndex(bundlePaths.chemicalsSqlitePath, safeSnapshot).catch((error) => {
    if (error?.code !== CHEMICAL_INDEX_UNREADABLE_CODE) {
      throw error;
    }
  });
  const workflowSync = await syncWorkflowRootFromSnapshot({
    storagePath: safeSnapshot?.settings?.storagePath,
    snapshot: safeSnapshot
  });
  const allSkipped = [...skippedRecords, ...workflowSync.skippedRecords];
  for (const [kind, file] of [['notebook', bundlePaths.notebookPagesPath], ['protocol', bundlePaths.basePath ? `${bundlePaths.basePath}.protocols.json` : '']]) {
    if (!file || allSkipped.some(record => record.kind === kind)) continue;
    await fs.copyFile(file, file.replace(/\.json$/, '.pre-markdown.json'), fs.constants.COPYFILE_EXCL)
      .catch(error => { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; });
    await fs.rm(file, { force: true });
  }
  return {
    bundlePaths,
    markdownRecords: { protocols: safeSnapshot.protocols, notebookEntries: safeSnapshot.notebookEntries },
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      protocolFilePaths,
      notebookPagesPath: '',
      notebookPageFolderPaths,
      markdownWarnings: [...markdownWarnings, ...workflowSync.markdownWarnings],
      skippedRecords: [...skippedRecords, ...workflowSync.skippedRecords],
      projectMemoryFilePaths,
      experimentLogPath,
      knowledgeBaseRootPath: bundlePaths.knowledgeBaseRootPath,
      paperMarkdownRootPath: bundlePaths.paperMarkdownRootPath,
      samplesRootPath: bundlePaths.samplesRootPath
    },
    workflowPaths: {
      workflowRootPath: workflowSync?.workflowRootPath || ''
    },
    workflowSummary: workflowSync?.summary || null
  };
}

// Only the chemical inventory syncs on its own; the other indexes follow full saves.
async function syncSqliteBundleFromSnapshotUnlocked({
  sqlitePath,
  snapshot
} = {}) {
  const targetSqlitePath = String(sqlitePath || '').trim();
  if (!targetSqlitePath) {
    return {
      sqlitePath: ''
    };
  }
  await fs.mkdir(path.dirname(targetSqlitePath), { recursive: true });
  await writeChemicalSqliteBundleIndex(targetSqlitePath, ensureObject(snapshot));
  return {
    sqlitePath: targetSqlitePath
  };
}

function syncBundleFromSnapshot(input = {}) {
  const snapshot = structuredClone(ensureObject(input.snapshot));
  const captured = { ...input, snapshot };
  const paths = getBundlePaths({ ...captured, storagePath: snapshot.settings?.storagePath });
  return withStorageRootWrite(paths.storageRootPath, () => (
    syncBundleFromSnapshotUnlocked(captured)
  ));
}

function syncSqliteBundleFromSnapshot(input = {}) {
  const snapshot = structuredClone(ensureObject(input.snapshot));
  const sqlitePath = String(input.sqlitePath || '').trim();
  const captured = { ...input, sqlitePath, snapshot };
  return withStorageRootWrite(sqlitePath ? path.dirname(sqlitePath) : '', () => (
    syncSqliteBundleFromSnapshotUnlocked(captured)
  ));
}

module.exports = {
  NOTEBOOK_SIDECAR_SCHEMA,
  PROTOCOL_SIDECAR_SCHEMA,
  SIDECAR_SCHEMA_VERSION,
  buildNotebookPagesSidecar,
  buildProtocolsSidecar,
  syncBundleFromSnapshot,
  syncSqliteBundleFromSnapshot
};
