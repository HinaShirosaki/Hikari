'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION
} = require('./constants');
const { cleanText } = require('./utils');
const {
  emptyRecognizedBackboneStore,
  getRecognizedBackboneStorePath,
  normalizeRecognizedBackboneForStore
} = require('./recognized-utils');

async function readRecognizedBackboneStore(paths) {
  const storePath = getRecognizedBackboneStorePath(paths);
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    const backbones = Array.isArray(parsed?.backbones)
      ? parsed.backbones
      : (Array.isArray(parsed?.records) ? parsed.records : []);
    return {
      schema_name: RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
      schema_version: cleanText(parsed?.schema_version, 40) || RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION,
      updated_at: cleanText(parsed?.updated_at, 120),
      backbones: backbones
        .map((item) => {
          try {
            return normalizeRecognizedBackboneForStore(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    };
  } catch (error) {
    if (String(error?.code || '') !== 'ENOENT') {
      throw error;
    }
  }
  return emptyRecognizedBackboneStore();
}

async function writeRecognizedBackboneStore(paths, store) {
  const storePath = getRecognizedBackboneStorePath(paths);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify({
    schema_name: RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
    schema_version: RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION,
    updated_at: cleanText(store?.updated_at, 120) || new Date().toISOString(),
    backbones: Array.isArray(store?.backbones) ? store.backbones : []
  }, null, 2), 'utf8');
  return storePath;
}

module.exports = {
  readRecognizedBackboneStore,
  writeRecognizedBackboneStore
};
