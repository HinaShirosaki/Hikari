'use strict';

const fs = require('fs/promises');
const path = require('path');
const { SAMPLES_ROOT_FOLDER_NAME } = require('../storage-paths');
const { readSampleContainers } = require('../sample-containers');
const { cleanText, keepLatestById, readJsonFile, readRecordFile } = require('../storage-utils');
const { readProtocolsFromSidecar } = require('./sqlite-inventory.js');
const { readRecordDocument } = require('../record-markdown/document-storage');

function hydrateSamplesRootFromStoragePath({ storagePath = '' } = {}) {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  return readSampleContainers(resolvedStoragePath ? path.join(resolvedStoragePath, SAMPLES_ROOT_FOLDER_NAME) : '');
}

async function readProtocolDirectory(protocolRootPath) {
  const directoryPath = cleanText(protocolRootPath, 2400);
  if (!directoryPath) {
    return {
      exists: false,
      ok: false,
      data: [],
      error: ''
    };
  }
  try {
    const stat = await fs.stat(directoryPath);
    if (!stat.isDirectory()) {
      const singleFile = await readJsonFile(directoryPath);
      return {
        exists: singleFile.exists,
        ok: singleFile.ok,
        data: singleFile.ok ? readProtocolsFromSidecar(singleFile.data) : [],
        error: singleFile.error || ''
      };
    }
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const protocols = [];
    const warnings = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = path.join(directoryPath, entry.name, 'protocol.json');
      const payload = await readRecordDocument(filePath, 'protocol');
      warnings.push(...payload.warnings);
      if (payload.ok) {
        protocols.push(...readProtocolsFromSidecar(payload.data));
      } else if (payload.exists && payload.error) {
        warnings.push(payload.error);
      }
    }
    return {
      exists: true,
      ok: protocols.length > 0,
      data: protocols,
      error: warnings.join('; ')
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        ok: false,
        data: [],
        error: ''
      };
    }
    return {
      exists: true,
      ok: false,
      data: [],
      error: String(error?.message || error)
    };
  }
}

// Scans <root>/*/<fileName> for { [key]: record }, the layout RECORD_FOLDERS
// records are saved in. An unreadable root or file is a warning, never a throw.
async function readRecordFolders(rootPath, { fileName, key }) {
  const directoryPath = cleanText(rootPath, 2400);
  const byId = new Map();
  const warnings = [];
  const result = () => ({ records: [...byId.values()].map((entry) => entry.value), warnings });
  if (!directoryPath) {
    return result();
  }
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      warnings.push(`Could not read ${directoryPath}: ${String(error?.message || error)}`);
    }
    return result();
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await readRecordFile(path.join(directoryPath, entry.name, fileName), key, warnings);
      if (found) {
        keepLatestById(byId, found);
      }
    }
  }
  return result();
}

function getLegacyProtocolsFilePath(bundlePaths) {
  const basePath = cleanText(bundlePaths?.basePath, 2400);
  return basePath ? `${basePath}.protocols.json` : '';
}

module.exports = {
  getLegacyProtocolsFilePath,
  hydrateSamplesRootFromStoragePath,
  readProtocolDirectory,
  readRecordFolders
};
