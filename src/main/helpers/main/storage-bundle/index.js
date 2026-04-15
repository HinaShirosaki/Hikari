'use strict';

const { STORAGE_MANIFEST_FILE_NAME } = require('./storage-manifest');
const { getBundlePaths, getBundlePathsFromSqlitePath } = require('./storage-paths');
const { discoverPapersFromStorageRoot } = require('./paper-discovery');
const { syncBundleFromSnapshot, syncSqliteBundleFromSnapshot } = require('./storage-sidecars');
const { hydrateSnapshotFromBundle } = require('./storage-hydration');
const { importStorageRoot } = require('./storage-import');
const {
  hydrateWorkflowRootFromStoragePath,
  importWorkflowRoot,
  syncWorkflowRootFromSnapshot
} = require('./workflow-storage');

module.exports = {
  STORAGE_MANIFEST_FILE_NAME,
  discoverPapersFromStorageRoot,
  getBundlePaths,
  getBundlePathsFromSqlitePath,
  syncBundleFromSnapshot,
  syncWorkflowRootFromSnapshot,
  syncSqliteBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  hydrateWorkflowRootFromStoragePath,
  importWorkflowRoot,
  importStorageRoot
};
