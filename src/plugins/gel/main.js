// Gel's host adapter. The workspace owns its UI and analysis code under
// ./vendor; this file supplies the narrow Hikari services it needs.

import { initGelAnalysis } from './vendor/modules/gel/index.js';
import { createId, safeText } from './vendor/modules/utils.js';
import { initPluginLeftRailResizer } from './left-rail.js';

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

function showReadyState({ artifactWarnings = 0 } = {}) {
  setHostBusy(false);
  if (!state.settings.storagePath) {
    showBanner('Choose a storage folder in Hikari Settings before saving gels.', { kind: 'warning' });
  } else if (persistFailure) {
    showBanner(`Could not save gels: ${persistFailure}`, { kind: 'error' });
  } else if (artifactWarnings) {
    showBanner(
      `${artifactWarnings} saved gel artifact${artifactWarnings === 1 ? '' : 's'} could not be restored. The record list is still available.`,
      { kind: 'warning', retry: () => refreshHostData({ announce: true }) }
    );
  } else {
    hideBanner();
  }
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function fromBase64Json(dataBase64) {
  const binary = atob(String(dataBase64 || ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// The ported records manager still talks to window.hikariApi. This shim keeps
// its artifacts in the plugin namespace and converts bridge failures into the
// same { ok:false } shape the original module already understands.
window.hikariApi = {
  async storeImportedFile({ targetFolder, fileName, dataBase64 }) {
    try {
      const result = await hikari.call('files.write', {
        path: `${targetFolder}/${fileName}`,
        dataBase64
      });
      return { ok: true, filePath: result.path, relativePath: result.path, fileName };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not store the gel file.') };
    }
  },
  async writeJsonFile({ targetFolder, fileName, data }) {
    try {
      const result = await hikari.call('files.write', {
        path: `${targetFolder}/${fileName}`,
        dataBase64: toBase64(JSON.stringify(data ?? {}, null, 2))
      });
      return { ok: true, filePath: result.path, relativePath: result.path, fileName };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not store the gel metadata.') };
    }
  },
  async readFileBase64(path) {
    try {
      return { ok: true, ...(await hikari.call('files.read', { path })) };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not read the gel file.') };
    }
  },
  async exportTextFile({ content, fileName }) {
    return hikari.call('downloads.save', {
      fileName,
      dataBase64: toBase64(content)
    });
  }
};

function toStoredRecord(record) {
  const durableRecordPath = String(record?.recordJsonPath || record?.recordJsonRelativePath || '').trim();
  if (!durableRecordPath) {
    return record;
  }
  return {
    id: record.id,
    name: record.name,
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    notebookEntryId: record.notebookEntryId || '',
    notebookEntryProtocolName: record.notebookEntryProtocolName || '',
    notebookEntryType: record.notebookEntryType || '',
    imageName: record.imageName || '',
    analysisType: record.analysisType || 'sds-page',
    updatedAt: record.updatedAt || '',
    storageFolder: record.storageFolder || '',
    analysisResultPath: record.analysisResultPath || '',
    analysisResultRelativePath: record.analysisResultRelativePath || '',
    recordJsonPath: record.recordJsonPath || '',
    recordJsonRelativePath: record.recordJsonRelativePath || '',
    sourceImagePath: record.sourceImagePath || '',
    sourceImageRelativePath: record.sourceImageRelativePath || '',
    previewImagePath: record.previewImagePath || '',
    previewImageRelativePath: record.previewImageRelativePath || '',
    previewImageIsSource: Boolean(record.previewImageIsSource)
  };
}

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

function applyHostContext(context = {}) {
  const storageWasConfigured = Boolean(state.settings.storagePath);
  const mode = context.appearance?.mode === 'night' || context.appearance?.mode === 'miku'
    ? context.appearance.mode
    : 'day';
  const fontSize = Math.max(10, Math.min(32, Number(context.appearance?.fontSize) || 16));
  document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  document.documentElement.style.setProperty('font-size', `${fontSize}px`);
  document.body.classList.add('ui-neutral-compact');
  document.body.classList.toggle('theme-night', mode === 'night');
  document.body.classList.toggle('theme-miku', mode === 'miku');
  document.body.dataset.appearanceMode = mode;
  state.settings.storagePath = context.storage?.configured ? PLUGIN_STORAGE_ROOT : '';
  if (context.layout?.leftRail) {
    hostLayout = context.layout;
    leftRailController?.applyContext?.(hostLayout);
  }

  if (!workspaceReady) {
    return;
  }
  showReadyState();
  const shouldRefreshStorage = context.changed === 'storage'
    || (!storageWasConfigured && state.settings.storagePath && !migrationChecked);
  if (state.settings.storagePath && shouldRefreshStorage) {
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
  if (state.settings.storagePath) {
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
  } else if (stored.value !== null) {
    migrationChecked = true;
  }

  const hydrated = await Promise.all(records.map(hydrateStoredRecord));
  return {
    records: hydrated.map((entry) => entry.record),
    artifactWarnings: hydrated.reduce((sum, entry) => sum + entry.warnings, 0)
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
    gelController?.renderList?.();
    showReadyState({ artifactWarnings: loaded.artifactWarnings });
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
    applyHostContext(appInfo);
    if (!unsubscribeContext) {
      unsubscribeContext = hikari.on('app.context', applyHostContext);
    }

    const [loaded, markup] = await Promise.all([loadHostData(), fetchWorkspaceMarkup()]);
    state.gelAnalyses = loaded.records;
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
      onGelAnalysesChanged: () => {}
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
      showReadyState({ artifactWarnings: loaded.artifactWarnings });
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

window.addEventListener('beforeunload', (event) => {
  if (persistFailure || gelController?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('pagehide', () => {
  leftRailController?.destroy?.();
});

// The frame's own beforeunload never runs on quit — the host answers the close
// request without unloading us — so the dirty flag has to be pushed to the host
// instead, and the host asks us to save with an app.save broadcast.
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

void start();
