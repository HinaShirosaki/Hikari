'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  hydrateProjectRootFromStoragePath,
  hydrateSamplesRootFromStoragePath,
  hydrateSnapshotFromBundle
} = require('./storage-hydration');
const { transformPaperRecordsToMarkdown } = require('../../../papers/parse/paper-markdown-import.js');
const { collectManifestEntries, isBundleCandidateName, isSqliteBundleCandidateName, looksLikeHikariSnapshot, normalizeBundleSummary, STORAGE_MANIFEST_FILE_NAME, toPosixRelative } = require('./storage-manifest');
const { getBundlePaths, getBundlePathsFromSqlitePath, resolveProtocolBundlePaths, resolveStorageRootLayout, SAMPLES_FILE_NAME, SAMPLES_ROOT_FOLDER_NAME } = require('./storage-paths');
const { summarizeSequenceLibrary } = require('./sequence-library-summary');
const { importWorkflowRoot, resolveWorkflowStoragePaths } = require('./workflow-storage');
const { asArray, cleanText, ensureObject, parseJsonObject, readJsonFile } = require('./storage-utils');

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

function mergePaperExperimentLinks(targetMap, links) {
  asArray(links).forEach((rawLink, index) => {
    const link = ensureObject(rawLink);
    const key = [
      cleanText(link.paperId, 220),
      cleanText(link.entryId, 220),
      cleanText(link.projectId, 220),
      cleanText(link.note, 600)
    ].join('::') || `paper_link_${index + 1}`;
    targetMap.set(key, link);
  });
}

async function importProtocolRoot({ storagePath = '' } = {}) {
  const protocolPaths = resolveProtocolBundlePaths({ storagePath });
  const protocolRootPath = cleanText(protocolPaths.protocolRootPath, 2400);
  if (!protocolRootPath) {
    return {
      protocols: [],
      protocolRootPath: '',
      sqlitePath: ''
    };
  }
  let entries = [];
  try {
    entries = await fs.readdir(protocolRootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        protocols: [],
        protocolRootPath,
        sqlitePath: protocolPaths.sqlitePath
      };
    }
    throw error;
  }

  const protocols = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(protocolRootPath, entry.name, 'protocol.json');
    const payload = await readJsonFile(filePath);
    if (!payload.ok) {
      continue;
    }
    const protocol = ensureObject(payload.data?.protocol);
    if (Object.keys(protocol).length) {
      protocols.push(protocol);
    }
  }

  return {
    protocols,
    protocolRootPath,
    sqlitePath: protocolPaths.sqlitePath
  };
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
  const storageLayout = resolveStorageRootLayout({ storagePath: resolvedStoragePath });
  if (storageLayout.paperMarkdownRootPath) {
    await fs.mkdir(storageLayout.paperMarkdownRootPath, { recursive: true });
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
    const bundlePaths = getBundlePaths({ dataFilePath: absPath, storagePath: resolvedStoragePath });
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
    const bundlePaths = getBundlePathsFromSqlitePath(absPath, { storagePath: resolvedStoragePath });
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
  const projectMap = new Map();
  const notebookMap = new Map();
  const sampleMap = new Map();
  const workflowTemplateMap = new Map();
  const workflowMap = new Map();
  const paperMap = new Map();
  const paperExperimentLinkMap = new Map();
  const assayMap = new Map();
  const gelAnalysisMap = new Map();
  const chemicalMap = new Map();
  const inventoryZoneMap = new Map();
  const blockMap = new Map();
  let lastLocationNumber = 0;
  let locationCodeMap = {};
  let locationCodeNextByLocation = {};
  const bundleSummaries = [];

  function mergeHydratedSnapshot(hydratedSnapshot) {
    const source = ensureObject(hydratedSnapshot);
    mergeByIdMap(projectMap, source.projects, 'project');
    mergeByIdMap(protocolMap, source.protocols, 'protocol');
    mergeByIdMap(notebookMap, source.notebookEntries, 'notebook');
    mergeByIdMap(sampleMap, source.samples, 'sample');
    mergeByIdMap(workflowTemplateMap, source.workflowTemplates, 'workflow_template');
    mergeByIdMap(workflowMap, source.workflows, 'workflow');
    mergeByIdMap(paperMap, source.papers, 'paper');
    mergePaperExperimentLinks(paperExperimentLinkMap, source.paperExperimentLinks);
    mergeByIdMap(assayMap, source.assays, 'assay');
    mergeByIdMap(gelAnalysisMap, source.gelAnalyses, 'gel');
    mergeByIdMap(chemicalMap, ensureObject(source.labInventory).chemicals, 'chemical');
    mergeInventoryMap(inventoryZoneMap, source.inventory);

    asArray(ensureObject(source.labInventory).blocks).forEach((block, index) => {
      const normalizedBlock = ensureObject(block);
      const blockKey = cleanText(normalizedBlock.hash, 240)
        || `${cleanText(normalizedBlock.index, 40)}_${cleanText(normalizedBlock.timestamp, 120)}_${index}`;
      blockMap.set(blockKey, normalizedBlock);
    });
    lastLocationNumber = Math.max(
      lastLocationNumber,
      Number(ensureObject(source.labInventory).lastLocationNumber) || 0
    );
    locationCodeMap = {
      ...locationCodeMap,
      ...ensureObject(ensureObject(source.labInventory).locationCodeMap)
    };
    locationCodeNextByLocation = {
      ...locationCodeNextByLocation,
      ...ensureObject(ensureObject(source.labInventory).locationCodeNextByLocation)
    };
  }

  const rootBundlePaths = getBundlePaths({ storagePath: resolvedStoragePath });
  const rootHydrated = await hydrateSnapshotFromBundle({
    snapshot: { settings: { storagePath: resolvedStoragePath } },
    bundlePaths: rootBundlePaths
  });
  const rootHydratedSnapshot = ensureObject(rootHydrated.snapshot);
  const rootSummary = normalizeBundleSummary(rootHydratedSnapshot);
  if (Object.values(rootSummary).some((value) => Number(value) > 0)) {
    mergeHydratedSnapshot(rootHydratedSnapshot);
    bundleSummaries.push({
      bundle_type: 'storage_root',
      data_file_path: '',
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, rootHydrated.bundlePaths.protocolsPath),
        notebook_pages_path: '',
        samples_path: toPosixRelative(resolvedStoragePath, rootHydrated.bundlePaths.samplesPath),
        sqlite_path: toPosixRelative(resolvedStoragePath, rootHydrated.bundlePaths.sqlitePath)
      },
      counts: rootSummary,
      migration: rootHydrated.migration || null
    });
  }

  for (const candidate of candidateFiles) {
    const candidatePath = candidate.path;
    const bundlePaths = candidate.bundlePaths || getBundlePaths({ dataFilePath: candidatePath, storagePath: resolvedStoragePath });
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

    const [notebookSidecarExists, sqliteExists, legacySqliteExists] = await Promise.all([
      fs.access(bundlePaths.notebookPagesPath).then(() => true).catch(() => false),
      fs.access(bundlePaths.sqlitePath).then(() => true).catch(() => false),
      fs.access(bundlePaths.legacySqlitePath || '').then(() => true).catch(() => false)
    ]);
    const hasAnySqlite = sqliteExists || legacySqliteExists;

    if (candidate.kind === 'data_bundle' && !looksLikeHikariSnapshot(parsed) && !notebookSidecarExists && !hasAnySqlite) {
      continue;
    }
    if (candidate.kind !== 'data_bundle' && !notebookSidecarExists && !hasAnySqlite) {
      continue;
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: candidate.kind === 'data_bundle' ? candidatePath : '',
      snapshot: parsed,
      bundlePaths
    });
    const hydratedSnapshot = ensureObject(hydrated.snapshot);
    const summary = normalizeBundleSummary(hydratedSnapshot);
    mergeHydratedSnapshot(hydratedSnapshot);

    bundleSummaries.push({
      bundle_type: candidate.kind,
      data_file_path: candidate.kind === 'data_bundle'
        ? toPosixRelative(resolvedStoragePath, candidatePath)
        : '',
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.protocolsPath),
        notebook_pages_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.notebookPagesPath),
        samples_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.samplesPath),
        sqlite_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.sqlitePath)
      },
      counts: summary,
      migration: hydrated.migration || null
    });
  }

  const protocolRoot = await importProtocolRoot({ storagePath: resolvedStoragePath });
  mergeByIdMap(protocolMap, protocolRoot.protocols, 'protocol');
  const projectRoot = await hydrateProjectRootFromStoragePath({ storagePath: resolvedStoragePath });
  mergeByIdMap(projectMap, projectRoot.projects, 'project');
  mergeByIdMap(notebookMap, projectRoot.notebookEntries, 'notebook');
  const samplesRoot = await hydrateSamplesRootFromStoragePath({ storagePath: resolvedStoragePath });
  mergeByIdMap(sampleMap, samplesRoot.samples, 'sample');

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
    projects: [...projectMap.values()],
    protocols: [...protocolMap.values()],
    notebookEntries: [...notebookMap.values()],
    samples: [...sampleMap.values()],
    workflowTemplates: [...workflowTemplateMap.values()],
    workflows: [...workflowMap.values()],
    papers: [...paperMap.values()],
    paperExperimentLinks: [...paperExperimentLinkMap.values()],
    assays: [...assayMap.values()],
    gelAnalyses: [...gelAnalysisMap.values()],
    labInventory: {
      chemicals: [...chemicalMap.values()],
      blocks: mergedBlocks,
      lastLocationNumber,
      locationCodeMap,
      locationCodeNextByLocation
    },
    inventory: mergedInventory
  };

  const workflowRoot = await importWorkflowRoot({ storagePath: resolvedStoragePath });
  mergeByIdMap(workflowTemplateMap, workflowRoot?.statePatch?.workflowTemplates, 'workflow_template');
  mergeByIdMap(workflowMap, workflowRoot?.statePatch?.workflows, 'workflow');
  mergeByIdMap(notebookMap, workflowRoot?.statePatch?.notebookEntries, 'notebook');
  mergeByIdMap(paperMap, workflowRoot?.statePatch?.papers, 'paper');
  mergePaperExperimentLinks(paperExperimentLinkMap, workflowRoot?.statePatch?.paperExperimentLinks);

  statePatch.projects = [...projectMap.values()];
  statePatch.workflowTemplates = [...workflowTemplateMap.values()];
  statePatch.workflows = [...workflowMap.values()];
  statePatch.notebookEntries = [...notebookMap.values()];
  statePatch.samples = [...sampleMap.values()];
  statePatch.papers = [...paperMap.values()];
  statePatch.paperExperimentLinks = [...paperExperimentLinkMap.values()];
  statePatch.assays = [...assayMap.values()];
  statePatch.gelAnalyses = [...gelAnalysisMap.values()];

  const paperMarkdown = await transformPaperRecordsToMarkdown({
    storagePath: resolvedStoragePath,
    papers: statePatch.papers,
    source: 'storage_import'
  });

  const sequenceLibrary = await summarizeSequenceLibrary(resolvedStoragePath);
  const workflowPaths = resolveWorkflowStoragePaths(resolvedStoragePath);
  const samplesRootPath = path.join(resolvedStoragePath, SAMPLES_ROOT_FOLDER_NAME);
  const samplesJsonPath = path.join(samplesRootPath, SAMPLES_FILE_NAME);
  const allWarnings = warnings
    .concat(asArray(projectRoot?.warnings))
    .concat(asArray(samplesRoot?.warnings))
    .concat(asArray(workflowRoot?.warnings))
    .concat(asArray(paperMarkdown?.warnings));
  const summary = {
    bundles: bundleSummaries.length,
    protocols: statePatch.protocols.length,
    notebookEntries: statePatch.notebookEntries.length,
    samples: statePatch.samples.length,
    workflowTemplates: statePatch.workflowTemplates.length,
    workflows: statePatch.workflows.length,
    papers: statePatch.papers.length,
    assays: statePatch.assays.length,
    gelAnalyses: statePatch.gelAnalyses.length,
    chemicals: statePatch.labInventory.chemicals.length,
    personalInventoryContainers: Object.values(statePatch.inventory)
      .reduce((sum, list) => sum + asArray(list).length, 0),
    sequenceEntries: Number(sequenceLibrary.entryCount) || 0,
    paperMarkdownTransformed: Number(paperMarkdown?.transformed) || 0,
    paperMarkdownSkipped: Number(paperMarkdown?.skipped) || 0,
    paperMarkdownFailed: Number(paperMarkdown?.failed) || 0
  };

  const discoveredFiles = await collectManifestEntries(resolvedStoragePath, 3);
  const manifest = {
    schema_name: 'hikari_storage_manifest',
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    root_path: resolvedStoragePath,
    discovered_files: discoveredFiles,
    bundles: bundleSummaries,
    protocol_storage: {
      relative_root_path: toPosixRelative(resolvedStoragePath, protocolRoot.protocolRootPath),
      relative_index_sqlite_path: toPosixRelative(resolvedStoragePath, protocolRoot.sqlitePath),
      protocols: statePatch.protocols.length
    },
    workflow_storage: {
      relative_root_path: toPosixRelative(resolvedStoragePath, workflowPaths.workflowRootPath),
      relative_status_sqlite_path: toPosixRelative(resolvedStoragePath, workflowPaths.sqlitePath),
      workflow_templates: statePatch.workflowTemplates.length,
      workflows: statePatch.workflows.length,
      papers: statePatch.papers.length
    },
    sample_storage: {
      relative_root_path: toPosixRelative(resolvedStoragePath, samplesRootPath),
      relative_samples_json_path: toPosixRelative(resolvedStoragePath, samplesJsonPath),
      samples: statePatch.samples.length
    },
    paper_markdown_storage: {
      relative_root_path: 'KnowledgeBase/papers.md',
      transformed: Number(paperMarkdown?.transformed) || 0,
      skipped: Number(paperMarkdown?.skipped) || 0,
      failed: Number(paperMarkdown?.failed) || 0
    },
    sequence_library: {
      relative_path: toPosixRelative(resolvedStoragePath, sequenceLibrary.path),
      exists: sequenceLibrary.exists,
      entry_count: sequenceLibrary.entryCount,
      status_counts: sequenceLibrary.statusCounts
    },
    summary,
    warnings: allWarnings
  };
  const manifestPath = path.join(resolvedStoragePath, STORAGE_MANIFEST_FILE_NAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    statePatch,
    summary,
    manifestPath,
    warnings: allWarnings,
    bundles: bundleSummaries,
    sequenceLibrary
  };
}

module.exports = {
  importStorageRoot,
  mergeByIdMap,
  mergeInventoryMap
};
