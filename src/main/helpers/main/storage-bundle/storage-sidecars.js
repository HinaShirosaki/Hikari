'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getBundlePaths } = require('./storage-paths');
const { writeSqliteBundleIndex } = require('./storage-sql-write');
const { asArray, ensureObject } = require('./storage-utils');

const PROTOCOL_SIDECAR_SCHEMA = 'enana_protocols';
const NOTEBOOK_SIDECAR_SCHEMA = 'enana_notebook_pages';
const SIDECAR_SCHEMA_VERSION = '1.0.0';

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

async function syncBundleFromSnapshot({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = ''
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  if (!bundlePaths.dataFilePath) {
    return {
      bundlePaths,
      sidecarPaths: {}
    };
  }
  const updatedAt = new Date().toISOString();
  const safeSnapshot = ensureObject(snapshot);
  await fs.mkdir(path.dirname(bundlePaths.dataFilePath), { recursive: true });
  await fs.writeFile(
    bundlePaths.protocolsPath,
    JSON.stringify(buildProtocolsSidecar(safeSnapshot, updatedAt), null, 2),
    'utf8'
  );
  await fs.writeFile(
    bundlePaths.notebookPagesPath,
    JSON.stringify(buildNotebookPagesSidecar(safeSnapshot, updatedAt), null, 2),
    'utf8'
  );
  await writeSqliteBundleIndex(bundlePaths.sqlitePath, safeSnapshot);
  return {
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath
    }
  };
}

module.exports = {
  NOTEBOOK_SIDECAR_SCHEMA,
  PROTOCOL_SIDECAR_SCHEMA,
  SIDECAR_SCHEMA_VERSION,
  buildNotebookPagesSidecar,
  buildProtocolsSidecar,
  syncBundleFromSnapshot
};
