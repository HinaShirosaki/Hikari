'use strict';

const fs = require('fs/promises');
const path = require('path');
const { SAMPLES_FILE_NAME, SAMPLES_ROOT_FOLDER_NAME } = require('../storage-paths');
const { asArray, cleanText, ensureObject, readJsonFile } = require('../storage-utils');
const { hasOwn, readProtocolsFromSidecar } = require('./sqlite-inventory.js');

async function hydrateSamplesRootFromStoragePath({
  storagePath = ''
} = {}) {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      exists: false,
      samples: [],
      inventory: {},
      inventoryFolders: {},
      warnings: []
    };
  }

  const samplesPath = path.join(resolvedStoragePath, SAMPLES_ROOT_FOLDER_NAME, SAMPLES_FILE_NAME);
  const payload = await readJsonFile(samplesPath);
  if (!payload.ok) {
    return {
      exists: false,
      samples: [],
      inventory: {},
      inventoryFolders: {},
      warnings: payload.exists && payload.error ? [payload.error] : []
    };
  }

  const source = ensureObject(payload.data);
  return {
    exists: true,
    samples: hasOwn(source, 'samples') ? asArray(source.samples) : [],
    inventory: ensureObject(source.inventory),
    inventoryFolders: ensureObject(source.inventoryFolders),
    warnings: []
  };
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
      const payload = await readJsonFile(filePath);
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

function getLegacyProtocolsFilePath(bundlePaths) {
  const basePath = cleanText(bundlePaths?.basePath, 2400);
  return basePath ? `${basePath}.protocols.json` : '';
}

function getLegacySqlitePath(bundlePaths) {
  const explicitLegacyPath = cleanText(bundlePaths?.legacySqlitePath, 2400);
  if (explicitLegacyPath) {
    return explicitLegacyPath;
  }
  const basePath = cleanText(bundlePaths?.basePath, 2400);
  return basePath ? `${basePath}.index.sqlite` : '';
}

module.exports = {
  getLegacyProtocolsFilePath,
  getLegacySqlitePath,
  hydrateSamplesRootFromStoragePath,
  readProtocolDirectory
};
