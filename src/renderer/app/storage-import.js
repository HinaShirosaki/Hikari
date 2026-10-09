import { defaultState } from '../modules/app-state/index.js';
import { syncMarkdownRecordState } from '../services/markdown-record-storage.js';
import { showTransientNotice } from '../lib/notify.js';
import { migrateProteinBuilderCloningNotebookState } from '../services/notebook-record-compat.js';
import { mergePaperExperimentLinks } from '../../shared/paper-experiment-links.mjs';
import {
  cloneDefaultValue,
  mergeInventoryMap,
  mergeLabInventory,
  mergePaperRecords,
  mergeRecordsById
} from './storage-import-merge.js';


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
  'inventory',
  'inventoryFolders'
];

const WORKSPACE_SETTINGS_KEYS = [
  'storageImport',
  'dashboard',
  // A plugin's blob indexes files under <root>/Plugins/<id>/, so it belongs to
  // the root it was written against. Carrying it across a root switch leaves
  // records whose every file read resolves into the new root and fails.
  'pluginStorage'
];

function buildStorageImportSummary(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
  return {
    lastImportedAt: new Date().toISOString(),
    summary: {
      bundles: Number(summary.bundles) || 0,
      protocols: Number(summary.protocols) || 0,
      notebookEntries: Number(summary.notebookEntries) || 0,
      quickLogEntries: Number(summary.quickLogEntries) || 0,
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
    summary: previous.summary && typeof previous.summary === 'object'
      ? previous.summary
      : {
        bundles: 0,
        protocols: 0,
        notebookEntries: 0,
        quickLogEntries: 0,
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


function describeOpenedRoot(result = {}) {
  const summary = result.summary || {};
  const counts = [
    [summary.protocols, 'protocol'],
    [summary.notebookEntries, 'notebook page'],
    [summary.papers, 'paper'],
    [summary.samples, 'sample'],
    [summary.chemicals, 'chemical'],
    [summary.sequenceEntries, 'sequence']
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, noun]) => `${count} ${noun}${Number(count) === 1 ? '' : 's'}`);
  if (!result.recognized) {
    return counts.length
      ? `Set up a new Hikari folder and imported ${counts.join(', ')}.`
      : 'Set up a new Hikari folder.';
  }
  const when = result.lastSavedAt ? new Date(result.lastSavedAt) : null;
  const saved = when && !Number.isNaN(when.getTime()) ? ` (last saved ${when.toLocaleDateString()})` : '';
  return counts.length
    ? `Opened Hikari folder${saved}: ${counts.join(', ')}.`
    : `Opened Hikari folder${saved}.`;
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
    const importedDashboard = patch.settings?.dashboard;
    if (importedDashboard && typeof importedDashboard === 'object' && !Array.isArray(importedDashboard)) {
      if (!state.settings || typeof state.settings !== 'object') {
        state.settings = cloneDefaultValue(defaultState.settings);
      }
      const currentDashboard = state.settings.dashboard
        && typeof state.settings.dashboard === 'object'
        && !Array.isArray(state.settings.dashboard)
        ? state.settings.dashboard
        : cloneDefaultValue(defaultState.settings.dashboard);
      state.settings.dashboard = {
        ...currentDashboard,
        quickLogDraft: String(importedDashboard.quickLogDraft || ''),
        quickLogEntries: Array.isArray(importedDashboard.quickLogEntries)
          ? importedDashboard.quickLogEntries
          : []
      };
    }
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
    state.inventoryFolders = mergeInventoryMap(state.inventoryFolders, patch.inventoryFolders);
    migrateProteinBuilderCloningNotebookState(state);
  }

  function updateStorageImportState(payload) {
    state.settings.storageImport = buildStorageImportSummary(payload);
  }

  // quiet: log only (launch reopen; the start page is the visible outcome).
  function updateStorageImportError(message, quiet = false) {
    const text = String(message || 'Storage import failed.');
    if (quiet) windowObject.hikariApi?.reportError?.({ source: 'renderer:notice', message: text });
    else showTransientNotice(text, { type: 'error' });
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
      return await syncMarkdownRecordState(windowObject.hikariApi, state);
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
    const quietErrors = options.quietErrors === true;
    try {
      const ensured = await ensureStorageRootDirectory(resolvedStoragePath);
      if (!ensured.ok) {
        updateStorageImportError(ensured.error || 'Unable to initialize the storage folder.', quietErrors);
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
        updateStorageImportError(result?.error || 'Storage import failed.', quietErrors);
        persistState(state);
        return {
          ok: false,
          refreshed: resetWorkspace,
          error: result?.error || 'Storage import failed.'
        };
      }

      mergeStorageImportPatch(result.statePatch);
      updateStorageImportState(result);
      // One notice for all alerts: each notice replaces the one on screen.
      const alerts = Array.isArray(result.alerts) ? result.alerts : [];
      if (alerts.length) {
        const more = alerts.length > 5 ? `\n\n…and ${alerts.length - 5} more.` : '';
        showTransientNotice(`${alerts.slice(0, 5).join('\n\n')}${more}`, { type: 'error', durationMs: 20000 });
      }
      let sidecarSync = null;
      if (persistMergedState) {
        persist({ resetHistory: true });
      } else {
        normalizeStateStoragePaths(state);
        persistState(state);
      }
      if (syncSidecars) {
        sidecarSync = await syncStateSidecarsFromStorageRoot();
      }
      // User just picked the folder: tell them what Hikari found there.
      if (persistMergedState) {
        showTransientNotice(describeOpenedRoot(result), { durationMs: 8000 });
      }
      return {
        ok: true,
        refreshed: resetWorkspace,
        summary: result.summary || {},
        warnings: result.warnings || [],
        recognized: result.recognized === true,
        sidecarSync
      };
    } catch (error) {
      updateStorageImportError(error?.message || 'Storage import failed.', quietErrors);
      persistState(state);
      return {
        ok: false,
        refreshed: resetWorkspace,
        error: error?.message || 'Storage import failed.'
      };
    }
  }

  async function hydrateStateFromStorageRoot() {
    let storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath) {
      // localStorage is the only place the renderer keeps the workspace root, and
      // it can be cleared out from under us. The auto-saved data file still knows
      // it, so recover from there instead of booting into an empty workspace.
      let recovered = null;
      try {
        recovered = await windowObject.hikariApi?.getLastStorageRoot?.();
      } catch {
        recovered = null;
      }
      storagePath = String(recovered?.storagePath || '').trim();
      if (!storagePath) {
        return;
      }
      if (!state.settings || typeof state.settings !== 'object') {
        state.settings = {};
      }
      state.settings.storagePath = storagePath;
    }
    return runStorageRootImport(storagePath, { persistMergedState: false, syncSidecars: true, quietErrors: true });
  }

  return {
    hydrateStateFromStorageRoot,
    mergeStorageImportPatch,
    refreshWorkspaceForStorageRoot,
    runStorageRootImport,
    syncStateSidecarsFromStorageRoot
  };
}
