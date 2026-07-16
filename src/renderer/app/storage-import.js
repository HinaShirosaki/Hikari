import { defaultState } from '../modules/app-state.js';

const WORKSPACE_STATE_KEYS = [
  'members',
  'instruments',
  'protocols',
  'projects',
  'workflows',
  'workflowTemplates',
  'journalClubs',
  'papers',
  'paperExperimentLinks',
  'knowledgeChats',
  'agentChat',
  'messages',
  'notebookEntries',
  'assays',
  'gelAnalyses',
  'samples',
  'labInventory',
  'inventory'
];

const WORKSPACE_SETTINGS_KEYS = [
  'pendingNotebookSampleCapture',
  'storageImport',
  'dashboard'
];

function cloneDefaultValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mergeRecordsById(existingRecords, importedRecords, fallbackPrefix) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_existing_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_imported_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  return [...byId.values()];
}

function mergeInventoryMap(existingInventory, importedInventory) {
  const merged = {};
  const mergeZone = (zoneName, containers) => {
    const zone = String(zoneName || '').trim();
    if (!zone) {
      return;
    }
    const zoneMap = new Map(
      asArray(merged[zone]).map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const id = String(source.id || `${zone}_existing_${index + 1}`).trim();
        return [
          id,
          {
            ...source,
            id
          }
        ];
      })
    );
    asArray(containers).forEach((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const id = String(source.id || `${zone}_imported_${index + 1}`).trim();
      zoneMap.set(id, {
        ...source,
        id
      });
    });
    merged[zone] = [...zoneMap.values()];
  };

  Object.entries(existingInventory && typeof existingInventory === 'object' ? existingInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));
  Object.entries(importedInventory && typeof importedInventory === 'object' ? importedInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));

  return merged;
}

function mergePaperExperimentLinks(existingLinks, importedLinks) {
  const merged = new Map();
  const addLink = (rawLink, prefix, index) => {
    const source = rawLink && typeof rawLink === 'object' ? rawLink : {};
    const baseKey = [
      String(source.paperId || '').trim(),
      String(source.entryId || '').trim(),
      String(source.projectId || '').trim(),
      String(source.note || '').trim()
    ].join('::');
    const key = baseKey || `${prefix}_${index + 1}`;
    merged.set(key, {
      ...(merged.get(key) || {}),
      ...source
    });
  };
  asArray(existingLinks).forEach((link, index) => addLink(link, 'existing', index));
  asArray(importedLinks).forEach((link, index) => addLink(link, 'imported', index));
  return [...merged.values()];
}

function mergePaperRecords(existingRecords, importedRecords) {
  const merged = new Map();
  const pushRecord = (record, index, prefix) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${prefix}_${index + 1}`).trim();
    const previous = merged.get(id) || {};
    const next = {
      ...previous,
      ...source,
      id
    };
    if (!String(source.storedFilePath || '').trim()) {
      next.storedFilePath = String(previous.storedFilePath || '').trim();
    }
    if (!String(source.storedRelativePath || '').trim()) {
      next.storedRelativePath = String(previous.storedRelativePath || '').trim();
    }
    const hasStoredPdfReference = Boolean(String(next.storedFilePath || '').trim())
      || Boolean(String(next.storedRelativePath || '').trim());
    if (hasStoredPdfReference) {
      next.pdfDataUrl = '';
    } else if (!String(source.pdfDataUrl || '').trim()) {
      next.pdfDataUrl = String(previous.pdfDataUrl || '').trim();
    }
    merged.set(id, next);
  };
  asArray(existingRecords).forEach((record, index) => pushRecord(record, index, 'paper_existing'));
  asArray(importedRecords).forEach((record, index) => pushRecord(record, index, 'paper_imported'));
  return [...merged.values()];
}

function mergeLabInventory(existingLabInventory, importedLabInventory) {
  const mergedBlocksMap = new Map();
  asArray(existingLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });
  asArray(importedLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });

  const mergedBlocks = [...mergedBlocksMap.values()].sort((left, right) => {
    const leftIndex = Number(left?.index) || 0;
    const rightIndex = Number(right?.index) || 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left?.timestamp || '').localeCompare(String(right?.timestamp || ''));
  });

  return {
    ...existingLabInventory,
    ...importedLabInventory,
    chemicals: mergeRecordsById(existingLabInventory.chemicals, importedLabInventory.chemicals, 'chemical'),
    blocks: mergedBlocks,
    locationCodeMap: {
      ...(existingLabInventory.locationCodeMap && typeof existingLabInventory.locationCodeMap === 'object'
        ? existingLabInventory.locationCodeMap
        : {}),
      ...(importedLabInventory.locationCodeMap && typeof importedLabInventory.locationCodeMap === 'object'
        ? importedLabInventory.locationCodeMap
        : {})
    },
    locationCodeNextByLocation: {
      ...(existingLabInventory.locationCodeNextByLocation && typeof existingLabInventory.locationCodeNextByLocation === 'object'
        ? existingLabInventory.locationCodeNextByLocation
        : {}),
      ...(importedLabInventory.locationCodeNextByLocation && typeof importedLabInventory.locationCodeNextByLocation === 'object'
        ? importedLabInventory.locationCodeNextByLocation
        : {})
    },
    lastLocationNumber: Math.max(
      Number(existingLabInventory.lastLocationNumber) || 0,
      Number(importedLabInventory.lastLocationNumber) || 0
    )
  };
}

function buildStorageImportSummary(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
  return {
    lastImportedAt: new Date().toISOString(),
    manifestPath: String(source.manifestPath || '').trim(),
    summary: {
      bundles: Number(summary.bundles) || 0,
      protocols: Number(summary.protocols) || 0,
      notebookEntries: Number(summary.notebookEntries) || 0,
      workflowTemplates: Number(summary.workflowTemplates) || 0,
      workflows: Number(summary.workflows) || 0,
      papers: Number(summary.papers) || 0,
      assays: Number(summary.assays) || 0,
      gelAnalyses: Number(summary.gelAnalyses) || 0,
      chemicals: Number(summary.chemicals) || 0,
      personalInventoryContainers: Number(summary.personalInventoryContainers) || 0,
      sequenceEntries: Number(summary.sequenceEntries) || 0
    },
    warnings: Array.isArray(source.warnings) ? source.warnings.map((item) => String(item || '')) : [],
    error: ''
  };
}

function buildStorageImportError(previous, message) {
  return {
    ...previous,
    lastImportedAt: previous.lastImportedAt || '',
    manifestPath: previous.manifestPath || '',
    summary: previous.summary && typeof previous.summary === 'object'
      ? previous.summary
      : {
        bundles: 0,
        protocols: 0,
        notebookEntries: 0,
        workflowTemplates: 0,
        workflows: 0,
        papers: 0,
        assays: 0,
        gelAnalyses: 0,
        chemicals: 0,
        personalInventoryContainers: 0,
        sequenceEntries: 0
      },
    warnings: Array.isArray(previous.warnings) ? previous.warnings : [],
    error: String(message || '').trim()
  };
}

export function createStorageImportController({
  state,
  persist,
  persistState,
  normalizeStateStoragePaths,
  windowObject = window
}) {
  function refreshWorkspaceForStorageRoot(storagePath) {
    WORKSPACE_STATE_KEYS.forEach((key) => {
      state[key] = cloneDefaultValue(defaultState[key]);
    });

    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = cloneDefaultValue(defaultState.settings);
    }
    WORKSPACE_SETTINGS_KEYS.forEach((key) => {
      state.settings[key] = cloneDefaultValue(defaultState.settings[key]);
    });
    state.settings.storagePath = String(storagePath || '').trim();
  }

  function mergeStorageImportPatch(statePatch) {
    const patch = statePatch && typeof statePatch === 'object' ? statePatch : {};
    state.projects = mergeRecordsById(state.projects, patch.projects, 'project');
    state.protocols = mergeRecordsById(state.protocols, patch.protocols, 'protocol');
    state.notebookEntries = mergeRecordsById(state.notebookEntries, patch.notebookEntries, 'notebook');
    state.workflowTemplates = mergeRecordsById(state.workflowTemplates, patch.workflowTemplates, 'workflow_template');
    state.workflows = mergeRecordsById(state.workflows, patch.workflows, 'workflow');
    state.papers = mergePaperRecords(state.papers, patch.papers);
    state.paperExperimentLinks = mergePaperExperimentLinks(state.paperExperimentLinks, patch.paperExperimentLinks);
    state.assays = mergeRecordsById(state.assays, patch.assays, 'assay');
    state.gelAnalyses = mergeRecordsById(state.gelAnalyses, patch.gelAnalyses, 'gel');

    const existingLabInventory = state.labInventory && typeof state.labInventory === 'object'
      ? state.labInventory
      : {};
    const importedLabInventory = patch.labInventory && typeof patch.labInventory === 'object'
      ? patch.labInventory
      : {};
    state.labInventory = mergeLabInventory(existingLabInventory, importedLabInventory);
    state.inventory = mergeInventoryMap(state.inventory, patch.inventory);
  }

  function updateStorageImportState(payload) {
    state.settings.storageImport = buildStorageImportSummary(payload);
  }

  function updateStorageImportError(message) {
    const previous = state.settings.storageImport && typeof state.settings.storageImport === 'object'
      ? state.settings.storageImport
      : {};
    state.settings.storageImport = buildStorageImportError(previous, message);
  }

  async function ensureStorageRootDirectory(storagePath) {
    if (!windowObject.hikariApi?.ensureStorageDirectory) {
      return { ok: true, skipped: true };
    }
    try {
      const result = await windowObject.hikariApi.ensureStorageDirectory(storagePath);
      if (result?.ok === false) {
        return {
          ok: false,
          error: result.error || 'Unable to initialize the storage folder.'
        };
      }
      return { ok: true, path: result?.path || storagePath };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || 'Unable to initialize the storage folder.'
      };
    }
  }

  async function syncStateSidecarsFromStorageRoot() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !windowObject.hikariApi?.autoSaveDataFile) {
      return { ok: false, skipped: true };
    }
    try {
      return await windowObject.hikariApi.autoSaveDataFile(state, '');
    } catch (error) {
      return {
        ok: false,
        error: error?.message || 'Storage sidecar sync failed.'
      };
    }
  }

  async function runStorageRootImport(storagePath, options = {}) {
    const resolvedStoragePath = String(storagePath || '').trim();
    if (!resolvedStoragePath || !windowObject.hikariApi?.importStorageRoot) {
      return { ok: false, skipped: true };
    }

    const persistMergedState = options.persistMergedState === true;
    const resetWorkspace = options.resetWorkspace === true;
    const syncSidecars = options.syncSidecars === true;
    try {
      const ensured = await ensureStorageRootDirectory(resolvedStoragePath);
      if (!ensured.ok) {
        updateStorageImportError(ensured.error || 'Unable to initialize the storage folder.');
        persistState(state);
        return {
          ok: false,
          refreshed: false,
          error: ensured.error || 'Unable to initialize the storage folder.'
        };
      }

      if (resetWorkspace) {
        refreshWorkspaceForStorageRoot(resolvedStoragePath);
      }

      const result = await windowObject.hikariApi.importStorageRoot(resolvedStoragePath);
      if (!result?.ok) {
        updateStorageImportError(result?.error || 'Storage import failed.');
        persistState(state);
        return {
          ok: false,
          refreshed: resetWorkspace,
          error: result?.error || 'Storage import failed.'
        };
      }

      mergeStorageImportPatch(result.statePatch);
      updateStorageImportState(result);
      let sidecarSync = null;
      if (persistMergedState) {
        persist();
      } else {
        normalizeStateStoragePaths(state);
        persistState(state);
      }
      if (syncSidecars) {
        sidecarSync = await syncStateSidecarsFromStorageRoot();
      }
      return {
        ok: true,
        refreshed: resetWorkspace,
        summary: result.summary || {},
        warnings: result.warnings || [],
        manifestPath: result.manifestPath || '',
        sidecarSync
      };
    } catch (error) {
      updateStorageImportError(error?.message || 'Storage import failed.');
      persistState(state);
      return {
        ok: false,
        refreshed: resetWorkspace,
        error: error?.message || 'Storage import failed.'
      };
    }
  }

  async function hydrateStateFromStorageRoot() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath) {
      return;
    }
    return runStorageRootImport(storagePath, { persistMergedState: false, syncSidecars: true });
  }

  return {
    hydrateStateFromStorageRoot,
    mergeStorageImportPatch,
    refreshWorkspaceForStorageRoot,
    runStorageRootImport,
    syncStateSidecarsFromStorageRoot
  };
}
