'use strict';

const fs = require('fs/promises');
const path = require('path');
const { hydrateSnapshotFromBundle } = require('./storage-hydration');
const { collectManifestEntries, isBundleCandidateName, isSqliteBundleCandidateName, looksLikeEnanaSnapshot, normalizeBundleSummary, STORAGE_MANIFEST_FILE_NAME, toPosixRelative } = require('./storage-manifest');
const { getBundlePaths, getBundlePathsFromSqlitePath } = require('./storage-paths');
const { summarizeSequenceLibrary } = require('./sequence-library-summary');
const { asArray, cleanText, ensureObject, parseJsonObject } = require('./storage-utils');

function mergeByIdMap(targetMap, records, fallbackPrefix) {
  asArray(records).forEach((rawRecord, index) => {
    const record = ensureObject(rawRecord);
    const id = cleanText(record.id, 220) || `${fallbackPrefix}_${index + 1}`;
    targetMap.set(id, {
      ...record,
      id
    });
  });
}

function mergeInventoryMap(targetInventoryMap, inventoryPayload) {
  const source = ensureObject(inventoryPayload);
  Object.entries(source).forEach(([zoneName, rawContainers]) => {
    const zone = cleanText(zoneName, 220);
    if (!zone) {
      return;
    }
    if (!targetInventoryMap.has(zone)) {
      targetInventoryMap.set(zone, new Map());
    }
    const zoneMap = targetInventoryMap.get(zone);
    asArray(rawContainers).forEach((rawContainer, index) => {
      const container = ensureObject(rawContainer);
      const id = cleanText(container.id, 220) || `${zone}_${index + 1}`;
      zoneMap.set(id, {
        ...container,
        id
      });
    });
  });
}

async function importStorageRoot({ storagePath = '' } = {}) {
  const resolvedStoragePath = path.resolve(cleanText(storagePath, 2400));
  if (!resolvedStoragePath) {
    throw new Error('Missing storage path.');
  }
  const storageStat = await fs.stat(resolvedStoragePath);
  if (!storageStat.isDirectory()) {
    throw new Error('Storage path must be a directory.');
  }

  const warnings = [];
  const dirEntries = await fs.readdir(resolvedStoragePath, { withFileTypes: true });
  const candidateFiles = [];
  const discoveredBundleBases = new Set();

  for (const entry of dirEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!isBundleCandidateName(entry.name)) {
      continue;
    }
    const absPath = path.join(resolvedStoragePath, entry.name);
    const stat = await fs.stat(absPath);
    const bundlePaths = getBundlePaths({ dataFilePath: absPath });
    candidateFiles.push({
      kind: 'data_bundle',
      path: absPath,
      modifiedAt: Number(stat.mtimeMs) || 0,
      bundlePaths
    });
    if (bundlePaths.basePath) {
      discoveredBundleBases.add(bundlePaths.basePath);
    }
  }

  for (const entry of dirEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!isSqliteBundleCandidateName(entry.name)) {
      continue;
    }
    const absPath = path.join(resolvedStoragePath, entry.name);
    const bundlePaths = getBundlePathsFromSqlitePath(absPath);
    if (!bundlePaths.basePath || discoveredBundleBases.has(bundlePaths.basePath)) {
      continue;
    }
    const stat = await fs.stat(absPath);
    candidateFiles.push({
      kind: 'sqlite_only_bundle',
      path: absPath,
      modifiedAt: Number(stat.mtimeMs) || 0,
      bundlePaths
    });
    discoveredBundleBases.add(bundlePaths.basePath);
  }

  candidateFiles.sort((left, right) => left.modifiedAt - right.modifiedAt);

  const protocolMap = new Map();
  const notebookMap = new Map();
  const chemicalMap = new Map();
  const inventoryZoneMap = new Map();
  const blockMap = new Map();
  let lastLocationNumber = 0;
  let locationCodeMap = {};
  let locationCodeNextByLocation = {};
  const bundleSummaries = [];

  for (const candidate of candidateFiles) {
    const candidatePath = candidate.path;
    const bundlePaths = candidate.bundlePaths || getBundlePaths({ dataFilePath: candidatePath });
    let parsed = {};
    if (candidate.kind === 'data_bundle') {
      try {
        const raw = await fs.readFile(candidatePath, 'utf8');
        parsed = parseJsonObject(raw);
      } catch (error) {
        warnings.push(`Failed to read ${toPosixRelative(resolvedStoragePath, candidatePath)}: ${String(error?.message || error)}`);
        continue;
      }

      if (!parsed) {
        warnings.push(`Skipped ${toPosixRelative(resolvedStoragePath, candidatePath)} because JSON payload is invalid.`);
        continue;
      }
    }

    const sidecarExists = await Promise.all([
      fs.access(bundlePaths.protocolsPath).then(() => true).catch(() => false),
      fs.access(bundlePaths.notebookPagesPath).then(() => true).catch(() => false),
      fs.access(bundlePaths.sqlitePath).then(() => true).catch(() => false)
    ]);

    if (candidate.kind === 'data_bundle' && !looksLikeEnanaSnapshot(parsed) && !sidecarExists.some(Boolean)) {
      continue;
    }
    if (candidate.kind !== 'data_bundle' && !sidecarExists.some(Boolean)) {
      continue;
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: candidate.kind === 'data_bundle' ? candidatePath : '',
      snapshot: parsed,
      bundlePaths
    });
    const hydratedSnapshot = ensureObject(hydrated.snapshot);
    const summary = normalizeBundleSummary(hydratedSnapshot);
    mergeByIdMap(protocolMap, hydratedSnapshot.protocols, 'protocol');
    mergeByIdMap(notebookMap, hydratedSnapshot.notebookEntries, 'notebook');
    mergeByIdMap(chemicalMap, ensureObject(hydratedSnapshot.labInventory).chemicals, 'chemical');
    mergeInventoryMap(inventoryZoneMap, hydratedSnapshot.inventory);

    asArray(ensureObject(hydratedSnapshot.labInventory).blocks).forEach((block, index) => {
      const normalizedBlock = ensureObject(block);
      const blockKey = cleanText(normalizedBlock.hash, 240)
        || `${cleanText(normalizedBlock.index, 40)}_${cleanText(normalizedBlock.timestamp, 120)}_${index}`;
      blockMap.set(blockKey, normalizedBlock);
    });
    lastLocationNumber = Math.max(
      lastLocationNumber,
      Number(ensureObject(hydratedSnapshot.labInventory).lastLocationNumber) || 0
    );
    locationCodeMap = {
      ...locationCodeMap,
      ...ensureObject(ensureObject(hydratedSnapshot.labInventory).locationCodeMap)
    };
    locationCodeNextByLocation = {
      ...locationCodeNextByLocation,
      ...ensureObject(ensureObject(hydratedSnapshot.labInventory).locationCodeNextByLocation)
    };

    bundleSummaries.push({
      bundle_type: candidate.kind,
      data_file_path: candidate.kind === 'data_bundle'
        ? toPosixRelative(resolvedStoragePath, candidatePath)
        : '',
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.protocolsPath),
        notebook_pages_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.notebookPagesPath),
        sqlite_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.sqlitePath)
      },
      counts: summary,
      migration: hydrated.migration || null
    });
  }

  const mergedInventory = {};
  for (const [zone, zoneMap] of inventoryZoneMap.entries()) {
    mergedInventory[zone] = [...zoneMap.values()];
  }

  const mergedBlocks = [...blockMap.values()].sort((left, right) => {
    const leftIndex = Number(left.index) || 0;
    const rightIndex = Number(right.index) || 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left.timestamp || '').localeCompare(String(right.timestamp || ''));
  });

  const statePatch = {
    protocols: [...protocolMap.values()],
    notebookEntries: [...notebookMap.values()],
    labInventory: {
      chemicals: [...chemicalMap.values()],
      blocks: mergedBlocks,
      lastLocationNumber,
      locationCodeMap,
      locationCodeNextByLocation
    },
    inventory: mergedInventory
  };

  const sequenceLibrary = await summarizeSequenceLibrary(resolvedStoragePath);
  const summary = {
    bundles: bundleSummaries.length,
    protocols: statePatch.protocols.length,
    notebookEntries: statePatch.notebookEntries.length,
    chemicals: statePatch.labInventory.chemicals.length,
    personalInventoryContainers: Object.values(statePatch.inventory)
      .reduce((sum, list) => sum + asArray(list).length, 0),
    sequenceEntries: Number(sequenceLibrary.entryCount) || 0
  };

  const discoveredFiles = await collectManifestEntries(resolvedStoragePath, 3);
  const manifest = {
    schema_name: 'enana_storage_manifest',
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    root_path: resolvedStoragePath,
    discovered_files: discoveredFiles,
    bundles: bundleSummaries,
    sequence_library: {
      relative_path: toPosixRelative(resolvedStoragePath, sequenceLibrary.path),
      exists: sequenceLibrary.exists,
      entry_count: sequenceLibrary.entryCount,
      status_counts: sequenceLibrary.statusCounts
    },
    summary,
    warnings
  };
  const manifestPath = path.join(resolvedStoragePath, STORAGE_MANIFEST_FILE_NAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    statePatch,
    summary,
    manifestPath,
    warnings,
    bundles: bundleSummaries,
    sequenceLibrary
  };
}

module.exports = {
  importStorageRoot,
  mergeByIdMap,
  mergeInventoryMap
};
