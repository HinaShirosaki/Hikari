'use strict';

const { hasSupportedDataExtension } = require('./storage-paths');
const { asArray, ensureObject, toPosixRelative } = require('./storage-utils');

// Written by builds before 2026-09; never read. Skipped during discovery so an
// old folder does not raise a "not a snapshot" warning for it.
const LEGACY_STORAGE_MANIFEST_FILE_NAME = 'hikari-storage-manifest.json';

function normalizeBundleSummary(snapshot) {
  const source = ensureObject(snapshot);
  const labInventory = ensureObject(source.labInventory);
  let personalContainerCount = 0;
  Object.values(ensureObject(source.inventory)).forEach((containers) => {
    personalContainerCount += asArray(containers).length;
  });
  return {
    protocols: asArray(source.protocols).length,
    notebookEntries: asArray(source.notebookEntries).length,
    quickLogEntries: asArray(ensureObject(source.settings).dashboard?.quickLogEntries).length,
    samples: asArray(source.samples).length,
    workflowTemplates: asArray(source.workflowTemplates).length,
    workflows: asArray(source.workflows).length,
    papers: asArray(source.papers).length,
    assays: asArray(source.assays).length,
    gelAnalyses: asArray(source.gelAnalyses).length,
    chemicals: asArray(labInventory.chemicals).length,
    personalInventoryContainers: personalContainerCount
  };
}

function isBundleCandidateName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (!lower || lower === LEGACY_STORAGE_MANIFEST_FILE_NAME || /\.(?:pre-markdown|unreadable)\.json$/.test(lower)) {
    return false;
  }
  if (lower.endsWith('.index.sqlite')) {
    return false;
  }
  return hasSupportedDataExtension(lower);
}

function looksLikeHikariSnapshot(payload) {
  const source = ensureObject(payload);
  return [
    Array.isArray(source.protocols),
    Array.isArray(source.notebookEntries),
    source.settings && typeof source.settings === 'object',
    source.data_bundle && typeof source.data_bundle === 'object',
    source.labInventory && typeof source.labInventory === 'object',
    source.inventory && typeof source.inventory === 'object',
    Array.isArray(source.members),
    Array.isArray(source.projects)
  ].some(Boolean);
}

module.exports = {
  isBundleCandidateName,
  looksLikeHikariSnapshot,
  normalizeBundleSummary,
  toPosixRelative
};
