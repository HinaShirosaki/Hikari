'use strict';

const fs = require('fs/promises');
const path = require('path');
const { hasSupportedDataExtension } = require('./storage-paths');
const { asArray, cleanText, ensureObject, normalizeFileTimestamp } = require('./storage-utils');

const STORAGE_MANIFEST_FILE_NAME = 'enana-storage-manifest.json';

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join('/');
}

async function buildEntryMeta(rootPath, absPath, role = 'other') {
  try {
    const stat = await fs.stat(absPath);
    const isDirectory = stat.isDirectory();
    return {
      relative_path: toPosixRelative(rootPath, absPath) || '.',
      type: isDirectory ? 'directory' : 'file',
      role,
      size_bytes: isDirectory ? 0 : Math.max(0, Number(stat.size) || 0),
      modified_at: normalizeFileTimestamp(stat)
    };
  } catch {
    return null;
  }
}

function detectManifestRole(relativePath) {
  const normalized = String(relativePath || '').toLowerCase();
  if (!normalized || normalized === '.') {
    return 'root';
  }
  if (normalized === STORAGE_MANIFEST_FILE_NAME.toLowerCase()) {
    return 'storage_manifest';
  }
  if (normalized === 'protocol') {
    return 'protocol_root';
  }
  if (normalized.endsWith('/protocol.json') && normalized.startsWith('protocol/')) {
    return 'protocol_record';
  }
  if (normalized.endsWith('.protocols.json')) {
    return 'protocol_sidecar';
  }
  if (normalized.endsWith('.notebook-pages.json')) {
    return 'notebook_sidecar';
  }
  if (normalized === 'protocol/protocol.index.sqlite') {
    return 'protocol_index';
  }
  if (normalized === 'enana-chemicals.index.sqlite') {
    return 'chemical_inventory_index';
  }
  if (normalized.endsWith('.index.sqlite')) {
    return 'sqlite_index';
  }
  if (normalized === 'papers') {
    return 'papers_root';
  }
  if (normalized === 'assays') {
    return 'assays_root';
  }
  if (normalized === 'gels') {
    return 'gels_root';
  }
  if (normalized === 'sequenceviewer/sequence-library.sqlite') {
    return 'sequence_library_index';
  }
  if (normalized.startsWith('sequenceviewer/entries/')) {
    return 'sequence_entry_file';
  }
  if (normalized === 'workflow/workflow-status.sqlite') {
    return 'workflow_status_index';
  }
  if (normalized.endsWith('/template.json') && normalized.startsWith('workflow/')) {
    return 'workflow_template_metadata';
  }
  if (normalized.endsWith('/workflow.json') && normalized.startsWith('workflow/')) {
    return 'workflow_run_metadata';
  }
  if (normalized.endsWith('/relatedpapers/related-papers.json') && normalized.startsWith('workflow/')) {
    return 'workflow_related_papers';
  }
  if (normalized.endsWith('/page.json') && normalized.includes('/notebook/') && normalized.startsWith('workflow/')) {
    return 'workflow_notebook_page';
  }
  if (hasSupportedDataExtension(normalized)) {
    return 'data_file';
  }
  return 'other';
}

async function collectManifestEntries(rootPath, maxDepth = 3) {
  const rows = [];
  async function walk(currentPath, depth) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      const relativePath = toPosixRelative(rootPath, absPath);
      const role = detectManifestRole(relativePath);
      const meta = await buildEntryMeta(rootPath, absPath, role);
      if (meta) {
        rows.push(meta);
      }
      if (entry.isDirectory() && depth < maxDepth) {
        await walk(absPath, depth + 1);
      }
    }
  }
  await walk(rootPath, 0);
  rows.sort((left, right) => String(left.relative_path || '').localeCompare(String(right.relative_path || '')));
  return rows;
}

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
    workflowTemplates: asArray(source.workflowTemplates).length,
    workflows: asArray(source.workflows).length,
    papers: asArray(source.papers).length,
    chemicals: asArray(labInventory.chemicals).length,
    personalInventoryContainers: personalContainerCount
  };
}

function isBundleCandidateName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (!lower || lower === STORAGE_MANIFEST_FILE_NAME.toLowerCase()) {
    return false;
  }
  if (lower.endsWith('.index.sqlite')) {
    return false;
  }
  return hasSupportedDataExtension(lower);
}

function isSqliteBundleCandidateName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (!lower || lower === STORAGE_MANIFEST_FILE_NAME.toLowerCase()) {
    return false;
  }
  return lower.endsWith('.index.sqlite');
}

function looksLikeEnanaSnapshot(payload) {
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
  STORAGE_MANIFEST_FILE_NAME,
  buildEntryMeta,
  collectManifestEntries,
  detectManifestRole,
  isBundleCandidateName,
  isSqliteBundleCandidateName,
  looksLikeEnanaSnapshot,
  normalizeBundleSummary,
  toPosixRelative
};
