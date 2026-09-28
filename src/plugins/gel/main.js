// Gel's host adapter. The workspace owns its UI and analysis code under
// ./workspace; this file supplies the narrow Hikari services it needs.

import { initGelAnalysis } from './workspace/index.js';
import { createId, safeText } from './lib/app-utils.js';
import { initPluginLeftRailResizer } from './left-rail.js';
import { installSearchFieldLens } from './lib/search-field-lens.js';
import { createGelStorageRecords } from './storage-records.js';

const hikari = window.HikariPlugin?.hikari;
const PLUGIN_STORAGE_ROOT = '.';
const SUPPORTED_STORAGE_VERSION = 2;
const state = {
  gelAnalyses: [],
  notebookEntries: [],
  projects: [],
  settings: { storagePath: '' }
};

const bootPanel = document.getElementById('boot');
const bootMessage = document.getElementById('boot-message');
const bootRetryButton = document.getElementById('boot-retry');
const host = document.getElementById('gel-host');

let persistFailure = '';
let workspaceReady = false;
let migrationChecked = false;
let gelController = null;
let refreshRequest = 0;
let startPromise = null;
let retryAction = null;
let unsubscribeContext = null;
let leftRailController = null;
let hostLayout = null;
let pendingStorageRefresh = false;
// What the last load reported. Held here rather than passed in, so a bare
// showReadyState() from a theme or layout change keeps showing it instead of
// silently clearing a warning the user has not acted on yet.
let loadWarnings = { artifactWarnings: 0, migrationError: '' };

function errorMessage(error, fallback = 'Unexpected plugin error.') {
  return String(error?.message || error || fallback).trim();
}

function setHostBusy(isBusy) {
  host?.setAttribute('aria-busy', String(Boolean(isBusy)));
}

function showBanner(message, { kind = 'warning', retry = null, busy = false } = {}) {
  if (!bootPanel || !bootMessage || !bootRetryButton) {
    return;
  }
  retryAction = typeof retry === 'function' ? retry : null;
  bootPanel.hidden = false;
  bootPanel.dataset.kind = kind;
  bootPanel.classList.toggle('plugin-gel__boot--error', kind === 'error');
  bootPanel.classList.toggle('plugin-gel__boot--warning', kind === 'warning');
  bootPanel.classList.toggle('plugin-gel__boot--loading', kind === 'loading');
  bootMessage.textContent = message;
  bootRetryButton.hidden = !retryAction;
  bootRetryButton.disabled = false;
  setHostBusy(busy);
}

function hideBanner() {
  if (!bootPanel) {
    return;
  }
  retryAction = null;
  bootPanel.hidden = true;
  delete bootPanel.dataset.kind;
  bootPanel.classList.remove(
    'plugin-gel__boot--error',
    'plugin-gel__boot--warning',
    'plugin-gel__boot--loading'
  );
  setHostBusy(false);
}

function showReadyState() {
  const { artifactWarnings, migrationError } = loadWarnings;
  setHostBusy(false);
  if (!state.settings.storagePath) {
    showBanner('Choose a storage folder in Hikari Settings before saving gels.', { kind: 'warning' });
  } else if (persistFailure) {
    showBanner(`Could not save gels: ${persistFailure}`, { kind: 'error' });
  } else if (migrationError) {
    showBanner(`Could not import legacy gels: ${migrationError}`, {
      kind: 'warning',
      retry: () => refreshHostData({ announce: true })
    });
  } else if (artifactWarnings) {
    showBanner(
      `${artifactWarnings} saved gel artifact${artifactWarnings === 1 ? '' : 's'} could not be restored. The record list is still available.`,
      { kind: 'warning', retry: () => refreshHostData({ announce: true }) }
    );
  } else {
    hideBanner();
  }
}


const { fromBase64Json, toStoredRecord } = createGelStorageRecords({ hikari, errorMessage });

async function persist() {
  if (!state.settings.storagePath) {
    const error = new Error('Choose a storage folder in Hikari Settings before saving gels.');
    persistFailure = error.message;
    showBanner(persistFailure, { kind: 'error' });
    throw error;
  }
  try {
    await hikari.call('storage.set', {
      value: {
        version: SUPPORTED_STORAGE_VERSION,
        gelAnalyses: state.gelAnalyses.map(toStoredRecord)
      }
    });
    persistFailure = '';
  } catch (error) {
    persistFailure = errorMessage(error, 'Could not save gels.');
    showBanner(`Could not save gels: ${persistFailure}`, { kind: 'error' });
    throw error;
  }
}

function applyHostContext(context = {}, { snapshot = false } = {}) {
  const storageWasConfigured = Boolean(state.settings.storagePath);
  const mode = context.appearance?.mode === 'night' ? 'night' : 'day';
  const fontSize = Math.max(10, Math.min(32, Number(context.appearance?.fontSize) || 16));
  document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  document.documentElement.style.setProperty('font-size', `${fontSize}px`);
  document.body.classList.add('ui-neutral-compact');
  document.body.classList.toggle('theme-night', mode === 'night');
  document.body.dataset.appearanceMode = mode;
  state.settings.storagePath = context.storage?.configured ? PLUGIN_STORAGE_ROOT : '';
  if (context.layout?.leftRail) {
    hostLayout = context.layout;
    leftRailController?.applyContext?.(hostLayout);
  }

  const shouldRefreshStorage = Boolean(state.settings.storagePath)
    && (context.changed === 'storage' || (!storageWasConfigured && !migrationChecked));

  if (!workspaceReady) {
    // A storage change that lands mid-boot has to be remembered: this early
    // return drops it and nothing re-reads the context once the workspace is
    // up, so the user would sit on an empty record list until some unrelated
    // context event happened to arrive. The app.info snapshot is excluded
    // because the boot's own load already runs against it.
    pendingStorageRefresh = pendingStorageRefresh || (!snapshot && shouldRefreshStorage);
    return;
  }
  showReadyState();
  if (shouldRefreshStorage) {
    void refreshHostData({ announce: true });
  }
}

async function readStoredJson(path) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return { value: null, warning: false };
  }
  try {
    const result = await hikari.call('files.read', { path: normalizedPath });
    return { value: fromBase64Json(result.dataBase64), warning: false };
  } catch {
    return { value: null, warning: true };
  }
}

async function hydrateStoredRecord(record) {
  if (record?.report || !(record?.recordJsonPath || record?.recordJsonRelativePath)) {
    return { record, warnings: 0 };
  }
  const [metadata, report] = await Promise.all([
    readStoredJson(record.recordJsonPath || record.recordJsonRelativePath),
    readStoredJson(record.analysisResultPath || record.analysisResultRelativePath)
  ]);
  return {
    record: {
      ...record,
      ...(metadata.value && typeof metadata.value === 'object' ? metadata.value : {}),
      report: report.value && typeof report.value === 'object' ? report.value : null
    },
    warnings: Number(metadata.warning) + Number(report.warning)
  };
}

function validateStoredValue(value) {
  if (value === null) {
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gel plugin storage is invalid. Expected an object or null.');
  }
  const version = value.version === undefined ? 1 : Number(value.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('Gel plugin storage has an invalid version. Expected a positive integer.');
  }
  if (version > SUPPORTED_STORAGE_VERSION) {
    throw new Error(`Gel plugin storage version ${version} is newer than this plugin supports.`);
  }
  if (value.gelAnalyses !== undefined && !Array.isArray(value.gelAnalyses)) {
    throw new Error('Gel plugin storage is invalid. "gelAnalyses" must be an array.');
  }
}

async function loadHostData() {
  const stored = await hikari.call('storage.get');
  validateStoredValue(stored.value);
  let records = Array.isArray(stored.value?.gelAnalyses) ? stored.value.gelAnalyses : [];

  // Incremental, not one-shot: a storage-root import merges legacy gels into
  // the host long after first run, and gating on "have I ever migrated" would
  // strand them with no way back. Passing the ids we hold makes a repeat call
  // return only what is genuinely new.
  //
  // Reported, not thrown: one unreadable legacy artifact or a full disk used to
  // fail the whole boot, taking down a workspace whose already-stored records
  // are perfectly usable. `migrationChecked` stays false so the next refresh
  // tries again.
  let migrationError = '';
  if (state.settings.storagePath) {
    const storedRecords = records;
    try {
      const migration = await hikari.call('migration.importLegacyGel', {
        skipIds: records.map((record) => record?.id).filter(Boolean)
      });
      const imported = Array.isArray(migration?.records) ? migration.records : [];
      if (imported.length) {
        const previousRecords = state.gelAnalyses;
        records = [...records, ...imported];
        state.gelAnalyses = records;
        try {
          await persist();
        } catch (error) {
          state.gelAnalyses = previousRecords;
          throw error;
        }
      }
      migrationChecked = true;
    } catch (error) {
      migrationError = errorMessage(error, 'Could not import legacy gels.');
      records = storedRecords;
    }
  } else if (stored.value !== null) {
    migrationChecked = true;
  }

  const hydrated = await Promise.all(records.map(hydrateStoredRecord));
  return {
    records: hydrated.map((entry) => entry.record),
    artifactWarnings: hydrated.reduce((sum, entry) => sum + entry.warnings, 0),
    migrationError
  };
}

async function refreshHostData({ announce = false } = {}) {
  const request = refreshRequest += 1;
  if (announce) {
    showBanner('Refreshing saved gels…', { kind: 'loading', busy: true });
  }
  try {
    const loaded = await loadHostData();
    if (request !== refreshRequest) {
      return;
    }
    state.gelAnalyses = loaded.records;
    persistFailure = '';
    loadWarnings = { artifactWarnings: loaded.artifactWarnings, migrationError: loaded.migrationError };
    gelController?.renderList?.();
    showReadyState();
  } catch (error) {
    if (request !== refreshRequest) {
      return;
    }
    showBanner(`Could not refresh saved gels: ${errorMessage(error)}`, {
      kind: 'error',
      retry: () => refreshHostData({ announce: true })
    });
  }
}

async function fetchWorkspaceMarkup() {
  const response = await fetch('./vendor/gel-view.html', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Gel workspace markup failed to load (${response.status}).`);
  }
  const markup = await response.text();
  if (!markup.includes('id="gel-form"') || !markup.includes('id="gel-canvas"')) {
    throw new Error('Gel workspace markup is incomplete. Expected #gel-form and #gel-canvas.');
  }
  return markup;
}

async function commitLeftRailWidth(width) {
  return hikari.call('app.setLeftRailWidth', { width });
}

function showLeftRailCommitError(error, width) {
  showBanner(`Could not remember the left rail width: ${errorMessage(error)}`, {
    kind: 'warning',
    retry: async () => {
      const result = await commitLeftRailWidth(width);
      leftRailController?.applyContext?.(result?.leftRail || {});
      showReadyState();
    }
  });
}

function optionalDependencyWarnings() {
  return [
    ['Cropper', window.Cropper],
    ['TIFF support', window.UTIF],
    ['advanced tables', window.Tabulator]
  ].filter(([, value]) => !value).map(([label]) => label);
}

async function start() {
  if (startPromise) {
    return startPromise;
  }
  startPromise = (async () => {
    if (!hikari) {
      throw new Error('The Hikari plugin client did not load.');
    }
    workspaceReady = false;
    host.hidden = true;
    setHostBusy(true);
    showBanner('Loading gel workspace…', { kind: 'loading', busy: true });

    const appInfo = await hikari.call('app.info');
    applyHostContext(appInfo, { snapshot: true });
    if (!unsubscribeContext) {
      unsubscribeContext = hikari.on('app.context', applyHostContext);
    }

    const [loaded, markup] = await Promise.all([loadHostData(), fetchWorkspaceMarkup()]);
    state.gelAnalyses = loaded.records;
    loadWarnings = { artifactWarnings: loaded.artifactWarnings, migrationError: loaded.migrationError };
    gelController?.destroy?.();
    leftRailController?.destroy?.();
    host.innerHTML = markup;
    document.getElementById('gel-view')?.classList.add('is-active');

    leftRailController = initPluginLeftRailResizer({
      documentObject: document,
      windowObject: window,
      initialLayout: hostLayout,
      commitWidth: commitLeftRailWidth,
      onCommitError: showLeftRailCommitError
    });

    gelController = initGelAnalysis({
      state,
      persist,
      createId,
      safeText,
      document,
      onGelAnalysesChanged: () => {},
      onHistoryChanged: reportHistoryState
    });
    gelController.render();
    workspaceReady = true;
    host.hidden = false;
    setHostBusy(false);

    const missingOptional = optionalDependencyWarnings();
    if (missingOptional.length) {
      showBanner(`Some Gel tools are unavailable: ${missingOptional.join(', ')}. Reload Hikari to retry.`, {
        kind: 'warning',
        retry: start
      });
    } else {
      showReadyState();
    }

    // A storage change that arrived while the workspace was still booting.
    if (pendingStorageRefresh) {
      pendingStorageRefresh = false;
      void refreshHostData({ announce: true });
    }
  })()
    .catch((error) => {
      workspaceReady = false;
      host.hidden = true;
      showBanner(`Gel could not start: ${errorMessage(error)}`, { kind: 'error', retry: start });
    })
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

bootRetryButton?.addEventListener('click', () => {
  if (!retryAction) {
    return;
  }
  const action = retryAction;
  bootRetryButton.disabled = true;
  Promise.resolve(action()).catch((error) => {
    showBanner(`Retry failed: ${errorMessage(error)}`, { kind: 'error', retry: action });
  });
});

window.addEventListener('pagehide', () => {
  leftRailController?.destroy?.();
});

// No beforeunload guard here on purpose: a subframe that cancels beforeunload
// vetoes the whole window close in Electron, silently — the red X just stops
// working. The dirty flag is pushed to the host instead, and the host asks us
// to save with an app.save broadcast before it lets the window go.
let reportedUnsaved = null;

function reportUnsavedState() {
  const unsaved = Boolean(persistFailure || gelController?.hasUnsavedChanges?.());
  if (unsaved === reportedUnsaved) {
    return;
  }
  reportedUnsaved = unsaved;
  hikari?.call('app.setUnsaved', { unsaved }).catch(() => {
    // A host that predates this verb simply keeps its old quit behaviour.
    reportedUnsaved = null;
  });
}

// ponytail: polled, not event-driven — the controller has no dirty-change
// event, and adding one means touching every input handler in the vendored
// modules. Push on change from the controller if this ever gets expensive.
window.setInterval(reportUnsavedState, 2000);

hikari?.on('app.save', () => {
  Promise.resolve(gelController?.saveUnsavedChanges?.())
    .catch(() => {})
    .finally(reportUnsavedState);
});

// Undo/redo. The workspace owns its own history because the host's global
// service snapshots the renderer's state object, which never holds this frame's
// in-progress lane and band edits.
//
// Two entry points, because neither covers the other: keyboard events inside a
// focused frame never reach the host document, and the host's toolbar buttons
// are outside this frame. `app.setHistory` is what lets those buttons light up.
let reportedHistory = '';

function reportHistoryState(historyState) {
  const history = {
    canUndo: historyState?.canUndo === true,
    canRedo: historyState?.canRedo === true
  };
  const signature = `${history.canUndo}:${history.canRedo}`;
  if (signature === reportedHistory) {
    return;
  }
  reportedHistory = signature;
  hikari?.call('app.setHistory', history).catch(() => {
    // A host that predates this verb keeps working; only its buttons stay dark.
    reportedHistory = '';
  });
}

hikari?.on('app.undo', () => {
  gelController?.undo?.();
});

hikari?.on('app.redo', () => {
  gelController?.redo?.();
});

function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

document.addEventListener('keydown', (event) => {
  const key = String(event.key || '').toLowerCase();
  if ((key !== 'z' && key !== 'y') || !(event.metaKey || event.ctrlKey) || event.altKey) {
    return;
  }
  // Let a focused field keep its own native undo.
  if (event.defaultPrevented || isEditableTarget(event.target)) {
    return;
  }
  event.preventDefault();
  if (key === 'y' || event.shiftKey) {
    gelController?.redo?.();
  } else {
    gelController?.undo?.();
  }
});

installSearchFieldLens();
void start();
