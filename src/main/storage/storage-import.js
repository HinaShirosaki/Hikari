'use strict';

const fs = require('fs/promises');
const path = require('path');
const { takeChemicalIndexAlerts } = require('./chemical-index-guard');
const { normalizeExperimentLogState, readExperimentLogSidecar } = require('./experiment-log-storage');
const {
  hydrateProjectRootFromStoragePath,
  hydrateSamplesRootFromStoragePath,
  hydrateSnapshotFromBundle
} = require('./storage-hydration');
const { isBundleCandidateName, looksLikeHikariSnapshot, normalizeBundleSummary } = require('./storage-discovery');
const { getBundlePaths, KNOWLEDGE_BASE_ROOT_FOLDER_NAME, PROJECT_ROOT_FOLDER_NAME, PROTOCOL_ROOT_FOLDER_NAME, resolveProtocolBundlePaths, resolveStorageRootLayout, SAMPLES_ROOT_FOLDER_NAME } = require('./storage-paths');
const { summarizeSequenceLibrary } = require('./sequence-library-summary');
const { importWorkflowRoot } = require('./workflow-storage');
const { asArray, cleanText, ensureObject, parseJsonObject, toPosixRelative } = require('./storage-utils');
const { addPaperExperimentLinks } = require('../../shared/paper-experiment-links.mjs');
const { readProtocolDirectory } = require('./hydration/protocol-directory');

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

async function importProtocolRoot({ storagePath = '' } = {}) {
  const protocolPaths = resolveProtocolBundlePaths({ storagePath });
  const protocolRootPath = cleanText(protocolPaths.protocolRootPath, 2400);
  if (!protocolRootPath) {
    return {
      protocols: [],
      protocolRootPath: ''
    };
  }
  const found = await readProtocolDirectory(protocolRootPath);

  return {
    protocols: found.data,
    protocolRootPath,
    warnings: found.error ? [found.error] : [],
    alerts: asArray(found.duplicates)
  };
}

const HIKARI_ROOT_FOLDER_NAMES = new Set([
  PROTOCOL_ROOT_FOLDER_NAME,
  PROJECT_ROOT_FOLDER_NAME,
  SAMPLES_ROOT_FOLDER_NAME,
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  'Workflow',
  'DNA'
]);

async function importStorageRootUnlocked({ storagePath = '', transformPaperRecordsToMarkdown = null } = {}) {
  const resolvedStoragePath = path.resolve(cleanText(storagePath, 2400));
  if (!resolvedStoragePath) {
    throw new Error('Missing storage path.');
  }
  const storageStat = await fs.stat(resolvedStoragePath);
  if (!storageStat.isDirectory()) {
    throw new Error('Storage path must be a directory.');
  }
  // Look before creating anything: a folder Hikari has used before has at least
  // one of its folders or a snapshot in it. The layout itself is the marker.
  const dirEntries = await fs.readdir(resolvedStoragePath, { withFileTypes: true });
  const recognized = dirEntries.some((entry) => (
    (entry.isDirectory() && HIKARI_ROOT_FOLDER_NAMES.has(entry.name))
    || (entry.isFile() && isBundleCandidateName(entry.name))
  ));

  const storageLayout = resolveStorageRootLayout({ storagePath: resolvedStoragePath });
  if (storageLayout.paperMarkdownRootPath) {
    await fs.mkdir(storageLayout.paperMarkdownRootPath, { recursive: true });
  }

  const warnings = [];
  const candidateFiles = [];

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
  const inventoryFolderMap = new Map();
  const blockMap = new Map();
  const quickLogMap = new Map();
  let quickLogDraft = '';
  let hasExperimentLogState = false;
  let lastLocationNumber = 0;
  let locationCodeMap = {};
  let locationCodeNextByLocation = {};
  const bundleSummaries = [];

  function containsExperimentLogState(snapshot) {
    const dashboard = ensureObject(ensureObject(snapshot).settings).dashboard;
    return Boolean(
      dashboard
      && typeof dashboard === 'object'
      && !Array.isArray(dashboard)
      && (
        Object.prototype.hasOwnProperty.call(dashboard, 'quickLogDraft')
        || Object.prototype.hasOwnProperty.call(dashboard, 'quickLogEntries')
      )
    );
  }

  function mergeExperimentLogState(snapshot) {
    if (!containsExperimentLogState(snapshot)) {
      return;
    }
    const normalized = normalizeExperimentLogState(ensureObject(ensureObject(snapshot).settings).dashboard);
    if (!hasExperimentLogState) {
      quickLogDraft = normalized.quickLogDraft;
    }
    normalized.quickLogEntries.forEach((entry) => {
      quickLogMap.set(entry.id, entry);
    });
    hasExperimentLogState = true;
  }

  function mergeHydratedSnapshot(hydratedSnapshot) {
    const source = ensureObject(hydratedSnapshot);
    mergeExperimentLogState(source);
    mergeByIdMap(projectMap, source.projects, 'project');
    mergeByIdMap(protocolMap, source.protocols, 'protocol');
    mergeByIdMap(notebookMap, source.notebookEntries, 'notebook');
    mergeByIdMap(sampleMap, source.samples, 'sample');
    mergeByIdMap(workflowTemplateMap, source.workflowTemplates, 'workflow_template');
    mergeByIdMap(workflowMap, source.workflows, 'workflow');
    mergeByIdMap(paperMap, source.papers, 'paper');
    addPaperExperimentLinks(paperExperimentLinkMap, source.paperExperimentLinks, { text: cleanText });
    mergeByIdMap(assayMap, source.assays, 'assay');
    mergeByIdMap(gelAnalysisMap, source.gelAnalyses, 'gel');
    mergeByIdMap(chemicalMap, ensureObject(source.labInventory).chemicals, 'chemical');
    mergeInventoryMap(inventoryZoneMap, source.inventory);
    mergeInventoryMap(inventoryFolderMap, source.inventoryFolders);

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
  if (
    Object.values(rootSummary).some((value) => Number(value) > 0)
    || containsExperimentLogState(rootHydratedSnapshot)
  ) {
    mergeHydratedSnapshot(rootHydratedSnapshot);
    bundleSummaries.push({
      bundle_type: 'storage_root',
      data_file_path: '',
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, rootHydrated.bundlePaths.protocolsPath),
        notebook_pages_path: '',
        samples_path: toPosixRelative(resolvedStoragePath, rootHydrated.bundlePaths.samplesRootPath)
      },
      counts: rootSummary,
      migration: rootHydrated.migration || null
    });
  }

  for (const candidate of candidateFiles) {
    const candidatePath = candidate.path;
    const bundlePaths = candidate.bundlePaths || getBundlePaths({ dataFilePath: candidatePath, storagePath: resolvedStoragePath });
    let parsed = {};
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

    const exists = (targetPath) => fs.access(targetPath || '').then(() => true).catch(() => false);
    const [notebookSidecarExists, hasSqliteIndex] = await Promise.all([
      exists(bundlePaths.notebookPagesPath),
      exists(bundlePaths.chemicalsSqlitePath)
    ]);

    if (!looksLikeHikariSnapshot(parsed) && !notebookSidecarExists && !hasSqliteIndex) {
      continue;
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: candidatePath,
      snapshot: parsed,
      bundlePaths
    });
    const hydratedSnapshot = ensureObject(hydrated.snapshot);
    const summary = normalizeBundleSummary(hydratedSnapshot);
    mergeHydratedSnapshot(hydratedSnapshot);

    bundleSummaries.push({
      bundle_type: candidate.kind,
      data_file_path: toPosixRelative(resolvedStoragePath, candidatePath),
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.protocolsPath),
        notebook_pages_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.notebookPagesPath),
        samples_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.samplesRootPath)
      },
      counts: summary,
      migration: hydrated.migration || null
    });
  }

  const protocolRoot = await importProtocolRoot({ storagePath: resolvedStoragePath });
  warnings.push(...asArray(protocolRoot.warnings));
  mergeByIdMap(protocolMap, protocolRoot.protocols, 'protocol');
  const projectRoot = await hydrateProjectRootFromStoragePath({
    storagePath: resolvedStoragePath,
    knownProjects: [...projectMap.values()]
  });
  mergeByIdMap(projectMap, projectRoot.projects, 'project');
  mergeByIdMap(notebookMap, projectRoot.notebookEntries, 'notebook');
  const samplesRoot = await hydrateSamplesRootFromStoragePath({ storagePath: resolvedStoragePath });
  mergeByIdMap(sampleMap, samplesRoot.samples, 'sample');
  mergeInventoryMap(inventoryZoneMap, samplesRoot.inventory);
  mergeInventoryMap(inventoryFolderMap, samplesRoot.inventoryFolders);
  const rootLayout = resolveStorageRootLayout({ storagePath: resolvedStoragePath });
  const experimentLogRoot = await readExperimentLogSidecar(rootLayout.experimentLogPath);
  if (experimentLogRoot.ok) {
    mergeExperimentLogState({
      settings: { dashboard: experimentLogRoot.data }
    });
  } else if (experimentLogRoot.exists && experimentLogRoot.error) {
    warnings.push(experimentLogRoot.error);
  }

  const mergedInventory = {};
  for (const [zone, zoneMap] of inventoryZoneMap.entries()) {
    mergedInventory[zone] = [...zoneMap.values()];
  }
  const mergedInventoryFolders = {};
  for (const [zone, zoneMap] of inventoryFolderMap.entries()) {
    mergedInventoryFolders[zone] = [...zoneMap.values()];
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
    inventory: mergedInventory,
    inventoryFolders: mergedInventoryFolders
  };
  if (hasExperimentLogState) {
    statePatch.settings = {
      dashboard: {
        quickLogDraft,
        quickLogEntries: [...quickLogMap.values()]
      }
    };
  }

  const workflowRoot = await importWorkflowRoot({ storagePath: resolvedStoragePath });
  mergeByIdMap(workflowTemplateMap, workflowRoot?.statePatch?.workflowTemplates, 'workflow_template');
  mergeByIdMap(workflowMap, workflowRoot?.statePatch?.workflows, 'workflow');
  mergeByIdMap(notebookMap, workflowRoot?.statePatch?.notebookEntries, 'notebook');
  mergeByIdMap(paperMap, workflowRoot?.statePatch?.papers, 'paper');
  addPaperExperimentLinks(paperExperimentLinkMap, workflowRoot?.statePatch?.paperExperimentLinks, { text: cleanText });

  statePatch.projects = [...projectMap.values()];
  statePatch.workflowTemplates = [...workflowTemplateMap.values()];
  statePatch.workflows = [...workflowMap.values()];
  statePatch.notebookEntries = [...notebookMap.values()];
  statePatch.samples = [...sampleMap.values()];
  statePatch.papers = [...paperMap.values()];
  statePatch.paperExperimentLinks = [...paperExperimentLinkMap.values()];
  statePatch.assays = [...assayMap.values()];
  statePatch.gelAnalyses = [...gelAnalysisMap.values()];

  const paperMarkdown = typeof transformPaperRecordsToMarkdown === 'function'
    ? await transformPaperRecordsToMarkdown({
        storagePath: resolvedStoragePath,
        papers: statePatch.papers,
        source: 'storage_import'
      })
    : { ok: false, status: 'unavailable', warnings: [] };

  const sequenceLibrary = await summarizeSequenceLibrary(resolvedStoragePath);
  const allWarnings = warnings
    .concat(asArray(projectRoot?.warnings))
    .concat(asArray(samplesRoot?.warnings))
    .concat(asArray(workflowRoot?.warnings))
    .concat(asArray(paperMarkdown?.warnings));
  const summary = {
    bundles: bundleSummaries.length,
    protocols: statePatch.protocols.length,
    notebookEntries: statePatch.notebookEntries.length,
    quickLogEntries: quickLogMap.size,
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

  const newestSnapshot = candidateFiles[candidateFiles.length - 1];
  return {
    statePatch,
    summary,
    recognized,
    lastSavedAt: newestSnapshot?.modifiedAt ? new Date(newestSnapshot.modifiedAt).toISOString() : '',
    warnings: allWarnings,
    // Problems the user must see, not just a line in the import summary.
    alerts: [...takeChemicalIndexAlerts(rootLayout.chemicalsSqlitePath), ...asArray(protocolRoot.alerts)],
    bundles: bundleSummaries,
    sequenceLibrary
  };
}

// Boot hydration and "Save Storage Path" can overlap; two imports interleaving
// their writes is how a sidecar ends up as two JSON documents in one file.
// ponytail: one global chain — imports are rare and seconds long.
let importChain = Promise.resolve();
function importStorageRoot(input) {
  const run = () => importStorageRootUnlocked(input);
  const result = importChain.then(run, run);
  importChain = result.catch(() => {});
  return result;
}

module.exports = {
  importStorageRoot,
  mergeByIdMap,
  mergeInventoryMap
};
