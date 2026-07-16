'use strict';

const fs = require('fs/promises');
const path = require('path');
const { RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME } = require('./constants');
const { ensureLibraryDirectories, resolveLibraryPaths, toPosixRelative } = require('./paths');
const { clamp, cleanText } = require('./utils');
const {
  buildRecognizedBackboneListItem,
  normalizeRecognizedBackboneForStore
} = require('./recognized-utils');
const {
  readRecognizedBackboneStore,
  writeRecognizedBackboneStore
} = require('./recognized-store');

async function listRecognizedBackbones({ storagePath, query = '', limit = 50 }) {
  const safeQuery = cleanText(query, 600).toLowerCase();
  const safeLimit = clamp(Math.round(Number(limit) || 50), 1, 200);
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);

  const resultsById = new Map();
  const store = await readRecognizedBackboneStore(paths);
  store.backbones.forEach((backbone) => addListItem(resultsById, buildRecognizedBackboneListItem(backbone, paths), safeQuery));

  const artifactsRoot = path.join(paths.libraryRoot, RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME);
  await addArtifactBackbones({ artifactsRoot, paths, resultsById, safeQuery });

  const results = Array.from(resultsById.values());
  results.sort((left, right) => {
    const leftTime = Date.parse(String(left?.updatedAt || '')) || 0;
    const rightTime = Date.parse(String(right?.updatedAt || '')) || 0;
    return (rightTime - leftTime) || cleanText(left?.backboneName, 160).localeCompare(cleanText(right?.backboneName, 160));
  });
  return {
    query: cleanText(query, 600),
    results: results.slice(0, safeLimit)
  };
}

function addListItem(resultsById, item, safeQuery) {
  if (!item || !matchesRecognizedBackboneQuery(item, safeQuery)) {
    return;
  }
  resultsById.set(cleanText(item.id, 300), item);
}

function matchesRecognizedBackboneQuery(item, safeQuery) {
  if (!safeQuery) {
    return true;
  }
  return [
    item?.hostVectorName,
    item?.sourceRecordName,
    item?.backboneName,
    item?.promoterName,
    item?.variantMode
  ].join(' ').toLowerCase().includes(safeQuery);
}

async function addArtifactBackbones({ artifactsRoot, paths, resultsById, safeQuery }) {
  let entries = [];
  try {
    entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
  } catch (error) {
    if (String(error?.code || '') === 'ENOENT') {
      return;
    }
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry?.isFile?.() || !String(entry.name || '').toLowerCase().endsWith('.json')) {
      return;
    }
    const item = await readArtifactBackbone(paths, path.join(artifactsRoot, entry.name));
    if (item && matchesRecognizedBackboneQuery(item, safeQuery) && !resultsById.has(cleanText(item.id, 300))) {
      resultsById.set(cleanText(item.id, 300), item);
    }
  }));
}

async function readArtifactBackbone(paths, filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const normalized = normalizeRecognizedBackboneForStore(parsed);
    return buildRecognizedBackboneListItem(normalized, paths, filePath);
  } catch {
    return null;
  }
}

async function upsertRecognizedBackbone({ storagePath, backbone = {} }) {
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);

  const normalized = normalizeRecognizedBackboneForStore(backbone);
  const nowIso = new Date().toISOString();
  normalized.updated_at = nowIso;

  const store = await readRecognizedBackboneStore(paths);
  const existingIndex = store.backbones.findIndex((item) => cleanText(item?.id, 200) === normalized.id);
  if (existingIndex >= 0) {
    normalized.created_at = cleanText(store.backbones[existingIndex]?.created_at, 120) || normalized.created_at;
    store.backbones[existingIndex] = normalized;
  } else {
    normalized.created_at = cleanText(normalized?.created_at, 120) || nowIso;
    store.backbones.push(normalized);
  }
  store.updated_at = nowIso;

  const storePath = await writeRecognizedBackboneStore(paths, store);
  return {
    id: normalized.id,
    filePath: storePath,
    fileName: path.basename(storePath),
    relativePath: toPosixRelative(paths.storageRoot, storePath),
    entry: buildRecognizedBackboneListItem(normalized, paths, storePath)
  };
}

module.exports = {
  listRecognizedBackbones,
  upsertRecognizedBackbone
};
