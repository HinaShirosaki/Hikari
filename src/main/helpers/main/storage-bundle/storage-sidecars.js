'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getBundlePaths } = require('./storage-paths');
const {
  MEMORY_FILE_NAME,
  buildProjectMemoryMarkdown,
  collectProjectMemoryRecords
} = require('./storage-memory');
const {
  writeChemicalSqliteBundleIndex,
  writeSqliteBundleIndex
} = require('./storage-sql-write');
const { asArray, cleanText, ensureObject } = require('./storage-utils');
const { syncWorkflowRootFromSnapshot } = require('./workflow-storage');

const PROTOCOL_SIDECAR_SCHEMA = 'enana_protocols';
const NOTEBOOK_SIDECAR_SCHEMA = 'enana_notebook_pages';
const SIDECAR_SCHEMA_VERSION = '1.0.0';
const PROTOCOL_FILE_NAME = 'protocol.json';

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function buildProtocolFolderName(protocol, index = 0) {
  const source = ensureObject(protocol);
  const id = cleanText(source.id, 220);
  const name = cleanText(source.name, 220);
  if (name || id) {
    return `${sanitizeFolderName(name, 'Protocol')}__${sanitizeFolderName(id, `protocol_${index + 1}`)}`;
  }
  return sanitizeFolderName(`protocol_${index + 1}`, `protocol_${index + 1}`);
}

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

async function writeProtocolFiles(protocolRootPath, snapshot, updatedAt) {
  const protocols = asArray(snapshot.protocols).map((rawProtocol) => ensureObject(rawProtocol));
  if (!protocolRootPath) {
    return [];
  }
  await fs.mkdir(protocolRootPath, { recursive: true });
  const existingEntries = await fs.readdir(protocolRootPath, { withFileTypes: true }).catch(() => []);
  const activeFolders = new Set();
  const writtenPaths = [];
  for (let index = 0; index < protocols.length; index += 1) {
    const protocol = protocols[index];
    const folderName = buildProtocolFolderName(protocol, index);
    activeFolders.add(folderName);
    const folderPath = path.join(protocolRootPath, folderName);
    const filePath = path.join(folderPath, PROTOCOL_FILE_NAME);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schema_name: PROTOCOL_SIDECAR_SCHEMA,
        schema_version: SIDECAR_SCHEMA_VERSION,
        updated_at: updatedAt,
        protocol
      }, null, 2),
      'utf8'
    );
    writtenPaths.push(filePath);
  }

  for (const entry of existingEntries) {
    if (!entry.isDirectory() || activeFolders.has(entry.name)) {
      continue;
    }
    await fs.rm(path.join(protocolRootPath, entry.name), { recursive: true, force: true });
  }

  return writtenPaths;
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ''));
  const child = path.resolve(String(childPath || ''));
  if (!parent || !child) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function isWorkflowNotebookEntry(entry) {
  const workflowContext = ensureObject(entry?.workflowContext);
  return Boolean(
    cleanText(workflowContext.workflowId, 220)
    || cleanText(workflowContext.workflowEntryId, 220)
    || cleanText(workflowContext.workflowBlockId, 220)
  );
}

function buildNotebookPageFolderPath(storageRootPath, entry) {
  const normalizedEntry = ensureObject(entry);
  const existingStorageFolder = cleanText(normalizedEntry.storageFolder, 2400);
  if (existingStorageFolder && isPathInside(storageRootPath, existingStorageFolder)) {
    return path.resolve(existingStorageFolder);
  }
  const projectFolder = sanitizeFolderName(normalizedEntry.projectName || 'Untitled_Project', 'Untitled_Project');
  const pageFolder = `${sanitizeFolderName(
    normalizedEntry.protocolName || normalizedEntry.id || 'Notebook_Page',
    'Notebook_Page'
  )}__${sanitizeFolderName(normalizedEntry.id, 'page')}`;
  return path.join(storageRootPath, 'Project', projectFolder, 'Notebook', pageFolder);
}

function compactNotebookEntryForFolder(entry) {
  return {
    ...ensureObject(entry),
    storageFolder: ''
  };
}

async function writeNotebookPageFolders(storageRootPath, snapshot, updatedAt) {
  const writtenPaths = [];
  const notebookEntries = asArray(snapshot.notebookEntries)
    .map((entry) => ensureObject(entry))
    .filter((entry) => !isWorkflowNotebookEntry(entry));
  for (const entry of notebookEntries) {
    const folderPath = buildNotebookPageFolderPath(storageRootPath, entry);
    const filePath = path.join(folderPath, 'page.json');
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schema_name: NOTEBOOK_SIDECAR_SCHEMA,
        schema_version: SIDECAR_SCHEMA_VERSION,
        updated_at: updatedAt,
        notebookEntry: compactNotebookEntryForFolder(entry)
      }, null, 2),
      'utf8'
    );
    writtenPaths.push(filePath);
  }
  return writtenPaths;
}

async function writeProjectMemoryFiles(storageRootPath, snapshot) {
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
    await fs.writeFile(filePath, buildProjectMemoryMarkdown(projectRecord), 'utf8');
    writtenPaths.push(filePath);
  }
  return writtenPaths;
}

async function syncBundleFromSnapshot({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = ''
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const bundlePaths = getBundlePaths({
    dataFilePath,
    fallbackDataFilePath,
    storagePath: safeSnapshot?.settings?.storagePath
  });
  if (!bundlePaths.dataFilePath) {
    return {
      bundlePaths,
      sidecarPaths: {}
    };
  }
  const updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(bundlePaths.dataFilePath), { recursive: true });
  await Promise.all([
    bundlePaths.papersRootPath ? fs.mkdir(bundlePaths.papersRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.assaysRootPath ? fs.mkdir(bundlePaths.assaysRootPath, { recursive: true }) : Promise.resolve(),
    bundlePaths.gelsRootPath ? fs.mkdir(bundlePaths.gelsRootPath, { recursive: true }) : Promise.resolve()
  ]);
  const protocolFilePaths = await writeProtocolFiles(bundlePaths.protocolsPath, safeSnapshot, updatedAt);
  const notebookPageFolderPaths = bundlePaths.storageRootPath
    ? await writeNotebookPageFolders(bundlePaths.storageRootPath, safeSnapshot, updatedAt)
    : [];
  const projectMemoryFilePaths = bundlePaths.storageRootPath
    ? await writeProjectMemoryFiles(bundlePaths.storageRootPath, safeSnapshot)
    : [];
  await fs.writeFile(
    bundlePaths.notebookPagesPath,
    JSON.stringify(buildNotebookPagesSidecar(safeSnapshot, updatedAt), null, 2),
    'utf8'
  );
  await writeSqliteBundleIndex(bundlePaths.sqlitePath, safeSnapshot);
  await writeChemicalSqliteBundleIndex(bundlePaths.chemicalsSqlitePath, safeSnapshot);
  const workflowSync = await syncWorkflowRootFromSnapshot({
    storagePath: safeSnapshot?.settings?.storagePath,
    snapshot: safeSnapshot
  });
  return {
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      protocolFilePaths,
      notebookPagesPath: bundlePaths.notebookPagesPath,
      notebookPageFolderPaths,
      projectMemoryFilePaths
    },
    workflowPaths: {
      workflowRootPath: workflowSync?.workflowRootPath || '',
      sqlitePath: workflowSync?.sqlitePath || ''
    },
    workflowSummary: workflowSync?.summary || null
  };
}

async function syncSqliteBundleFromSnapshot({
  sqlitePath,
  snapshot,
  mode = ''
} = {}) {
  const targetSqlitePath = String(sqlitePath || '').trim();
  if (!targetSqlitePath) {
    return {
      sqlitePath: ''
    };
  }
  await fs.mkdir(path.dirname(targetSqlitePath), { recursive: true });
  if (cleanText(mode, 40).toLowerCase() === 'chemical') {
    await writeChemicalSqliteBundleIndex(targetSqlitePath, ensureObject(snapshot));
  } else {
    await writeSqliteBundleIndex(targetSqlitePath, ensureObject(snapshot));
  }
  return {
    sqlitePath: targetSqlitePath
  };
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
