import { VIEWS, TITLES } from '../modules/views.js';
import { createId, safeText, cssEscape } from '../lib/app-utils.js';
import {
  loadState,
  persistState,
  trackGrowthEvent
} from '../modules/app-state/index.js';
import { APP_DOCK_ORDER, APP_REGISTRY } from '../modules/app-registry.generated.js';
import { createRendererModuleRuntime } from './module-runtime.js';
import {
  createModuleRegistry,
  createRendererServices,
  createUndoService,
  createUnsavedChangesService
} from '../services/index.js';
import {
  initSharedLeftRailResizers,
  SHARED_LEFT_RAIL_CHANGED_EVENT
} from '../app/shared-left-rail.js';
import { normalizeStateStoragePaths } from '../modules/app-state/storage-path-normalizer.js';
import {
  applyAppearanceSnapshot,
  createNavigationShell,
  normalizeViewId
} from '../app/navigation-shell.js';
import { createStorageImportController } from '../app/storage-import.js';
import { createStorageSetup } from '../app/storage-setup.js';
import { installPlugins } from '../app/plugin-loader.js';
import { createPluginBridge } from '../app/plugin-bridge.js';
import { createPluginServiceRegistry } from '../app/plugin-services.js';
import {
  buildSearchScopeMap,
  buildViewAliasMap,
  createTopbarSearchController
} from '../app/topbar-search.js';
import { createTopbarOpenItemHandlers } from '../app/topbar-open-handlers.js';
import { showTransientNotice } from '../lib/notify.js';

const APP_READY_EVENT = 'hikari:app-ready';

function createAppReadyEvent(windowObject, init) {
  const EventConstructor = windowObject.CustomEvent
    || (typeof CustomEvent === 'function' ? CustomEvent : null);
  return EventConstructor
    ? new EventConstructor(APP_READY_EVENT, init)
    : { type: APP_READY_EVENT, ...(init || {}) };
}

// Facade for view-routing surface exposed to modules, openItemHandlers, and the
// topbar search controller. Until `bind(navigationShell)` runs, the methods are
// safe no-ops; after binding they delegate. This replaces three `let` forward
// references and three `?.`-guarded inline closures.
function createViewController() {
  let target = null;
  return {
    bind(navigationShell) {
      target = navigationShell;
    },
    showView: (viewId) => {
      if (!target) {
        return;
      }
      target.showView(viewId);
    },
    setSearchInputValue: (inputId, value) => {
      if (!target) {
        return false;
      }
      return target.setSearchInputValue(inputId, value);
    },
    getActiveViewId: () => (target ? target.getActiveViewId() : null),
    getTopbarSearchInput: () => (target ? target.topbarSearchInput : null)
  };
}

// Facade for the search-routing callbacks consumed by the navigation shell's
// keyboard/suggestion handlers. The shell installs handlers at construction
// time; this facade lets us wire those handlers before the topbar search
// controller exists, then `bind(topbarSearchController)` once it does. Until
// then, calls return empty/false (no input can reach the shell synchronously
// during boot).
function createSearchController() {
  let target = null;
  return {
    bind(topbarSearchController) {
      target = topbarSearchController;
    },
    executeTopbarSearch: (query) => {
      if (!target) {
        return;
      }
      target.executeTopbarSearch(query);
    },
    getSearchSuggestions: (query, options) => (
      target ? (target.getSearchSuggestions(query, options) || []) : []
    ),
    applySuggestion: (suggestion) => (
      target ? (target.applySuggestion(suggestion) || false) : false
    )
  };
}

// Renderer entry point (called by renderer.js). Boot order matters:
// state -> plugins -> undo/services -> modules -> navigation -> search, then
// initApp() hydrates from the storage folder and opens the startup view.
// `hikari:app-ready` fires whether or not boot succeeded (detail.error on
// failure) so the loading cover always lifts.
export function startHikariCore({
  documentObject = document,
  windowObject = window
} = {}) {
  const state = loadState();
  // Plugin views and registry entries must exist before the navigation shell
  // and search maps below snapshot APP_REGISTRY and the `.view` sections.
  // The bridge is built here too so each frame can be registered as it mounts;
  // its dependencies are resolved lazily because rendererServices does not
  // exist yet and no plugin message can arrive before boot finishes.
  const pluginBridge = createPluginBridge({
    state,
    persist,
    onNotebookEntriesChanged: () => rendererServices?.notebook?.handleAgentNotebookEntriesChanged?.(),
    onFrameHistoryChanged: () => undoService?.syncButtons?.(),
    notify: showTransientNotice,
    windowObject,
    api: windowObject.hikariApi || null
  });
  // Service plugins register their converters here; the sequence viewer (and
  // any future consumer) reaches them through the module runtime below.
  const pluginServices = createPluginServiceRegistry({ windowObject });
  installPlugins({
    state,
    documentObject,
    appRegistry: APP_REGISTRY,
    bridge: pluginBridge,
    services: pluginServices,
    api: windowObject.hikariApi || null
  });
  windowObject.addEventListener?.('hikari:appearance-changed', () => {
    pluginBridge.broadcastAppContext('appearance');
  });
  windowObject.addEventListener?.('hikari:storage-changed', () => {
    pluginBridge.broadcastAppContext('storage');
  });
  windowObject.addEventListener?.(SHARED_LEFT_RAIL_CHANGED_EVENT, () => {
    pluginBridge.broadcastAppContext('layout');
  });
  const normalizeAppViewId = (viewId) => normalizeViewId(VIEWS, viewId);
  const globalViewAliases = buildViewAliasMap({
    apps: APP_REGISTRY,
    normalizeViewId: normalizeAppViewId
  });
  const searchScopeTargets = buildSearchScopeMap({
    apps: APP_REGISTRY,
    normalizeViewId: normalizeAppViewId
  });

  applyAppearanceSnapshot(state.settings?.appearance, documentObject);

  const sharedLeftRailRuntime = initSharedLeftRailResizers({
    document: documentObject,
    windowObject
  });

  // viewController and searchController are unbound facades at this point.
  // viewController is bound right after navigationShell is constructed.
  // searchController is bound right after topbarSearchController is constructed.
  // Until each is bound, its methods are safe no-ops — no user input can reach
  // their consumers synchronously during this constructor.
  const viewController = createViewController();
  const searchController = createSearchController();

  // moduleRuntime stays declared up-front because `renderAll` (defined here for
  // use in `onStoragePathSaved` below) and `moduleRuntime` mutually reference
  // each other; this is unrelated to the navigation/search wiring.
  let moduleRuntime = null;
  let undoService = null;
  let navigationShell = null;

  function persistStateNow() {
    normalizeStateStoragePaths(state);
    persistState(state);
    if (windowObject.hikariApi?.autoSaveDataFile && String(state.settings?.storagePath || '').trim()) {
      windowObject.hikariApi
        .autoSaveDataFile(state, '')
        .then((result) => {
          // autoSaveDataFile resolves { ok:false, error } on a write failure (it
          // does not throw), so the result must be inspected — otherwise a failed
          // durable save to the storage folder is lost silently.
          if (result && result.ok === false) {
            console.warn('Auto-save to the storage folder failed:', result.error);
          }
        })
        .catch((error) => {
          console.warn('Auto-save to the storage folder failed:', error);
        });
    }
  }

  // All module writes go through here. Once the undo service exists it saves via
  // persistStateNow and records the change as an undo step (see undoService).
  function persist(options = {}) {
    return undoService ? undoService.persist(options) : persistStateNow();
  }

  function renderAll() {
    moduleRuntime?.renderAll();
  }

  function renderRestoredState() {
    navigationShell?.applyAppearanceSnapshot(state.settings?.appearance);
    renderAll();
  }

  // A focused plugin frame becomes documentElement.activeElement in the host, but
  // clicking a history button moves focus onto the button — so remember the frame
  // rather than reading activeElement at command time.
  let lastFocusedPluginFrame = null;
  function trackPluginFrameFocus() {
    const active = documentObject?.activeElement;
    if (active?.tagName === 'IFRAME') {
      lastFocusedPluginFrame = active;
      return;
    }
    if (!active?.closest?.('.topbar-history-controls')) {
      lastFocusedPluginFrame = null;
    }
  }
  documentObject?.addEventListener?.('focusin', () => {
    trackPluginFrameFocus();
    undoService?.syncButtons?.();
  });
  windowObject?.addEventListener?.('blur', () => {
    trackPluginFrameFocus();
    undoService?.syncButtons?.();
  });

  undoService = createUndoService({
    state,
    persistState: persistStateNow,
    renderAll: renderRestoredState,
    documentObject,
    delegate: {
      claim: () => pluginBridge.getFrameHistory(lastFocusedPluginFrame?.contentWindow || null),
      run: (command) => pluginBridge.sendFrameHistoryCommand(
        lastFocusedPluginFrame?.contentWindow || null,
        command
      )
    }
  });

  const moduleRegistry = createModuleRegistry({
    pluginBridge,
    showView: viewController.showView,
    setSearchInputValue: viewController.setSearchInputValue,
    VIEWS
  });
  const rendererServices = createRendererServices(moduleRegistry, {
    protocol: {
      state,
      persist,
      createId
    },
    project: {
      state
    }
  });
  const storageImportController = createStorageImportController({
    state,
    persist,
    persistState,
    normalizeStateStoragePaths,
    windowObject
  });

  moduleRuntime = createRendererModuleRuntime({
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    rendererServices,
    moduleRegistry,
    trackGrowthEvent,
    pluginServices,
    showView: viewController.showView,
    views: VIEWS,
    apiBridge: windowObject.hikariApi || null,
    getApiBridge: () => windowObject.hikariApi || null,
    rootDocument: documentObject,
    windowObject,
    onStoragePathSaved: async (storagePath, options = {}) => {
      const result = await storageImportController.runStorageRootImport(storagePath, {
        persistMergedState: true,
        resetWorkspace: options.resetWorkspace === true
      });
      renderAll();
      return result;
    }
  });

  createUnsavedChangesService({
    moduleRegistry,
    api: windowObject.hikariApi || null,
    externalSources: () => pluginBridge.getUnsavedSources(),
    documentObject,
    windowObject
  });

  navigationShell = createNavigationShell({
    VIEWS,
    TITLES,
    APP_DOCK_ORDER,
    APP_REGISTRY,
    navigationViewAliases: moduleRuntime.navigationViewAliases,
    moduleRuntime,
    sharedLeftRailRuntime,
    executeTopbarSearch: searchController.executeTopbarSearch,
    getSearchSuggestions: searchController.getSearchSuggestions,
    applySearchSuggestion: searchController.applySuggestion,
    documentObject,
    windowObject
  });
  viewController.bind(navigationShell);

  const openItemHandlers = createTopbarOpenItemHandlers({
    views: VIEWS,
    moduleRegistry,
    rendererServices,
    showView: viewController.showView,
    documentObject,
    windowObject,
    cssEscape
  });

  const topbarSearchController = createTopbarSearchController({
    state,
    VIEWS,
    TITLES,
    globalViewAliases,
    searchScopeTargets,
    showView: viewController.showView,
    getActiveViewId: viewController.getActiveViewId,
    setSearchInputValue: viewController.setSearchInputValue,
    topbarSearchInput: viewController.getTopbarSearchInput(),
    apps: APP_REGISTRY,
    normalizeViewId: normalizeAppViewId,
    openItemHandlers,
    windowObject
  });
  searchController.bind(topbarSearchController);

  // Protocol files saved by another process (e.g. the agent) can arrive before
  // hydration; applying them then would be overwritten by the hydrated state, so
  // they queue until initApp drains them.
  let hydrationComplete = false;
  const pendingProtocolRecordEvents = [];

  function openStartupView() {
    const viewId = navigationShell.resolveStartupViewId(state);
    navigationShell.enableLastViewPersistence();
    navigationShell.showView(viewId);
  }

  const storageSetup = createStorageSetup({
    documentObject,
    windowObject,
    state,
    openStorageRoot: async (storagePath) => {
      const result = await storageImportController.runStorageRootImport(storagePath, {
        resetWorkspace: storagePath !== state.settings?.storagePath,
        syncSidecars: true
      });
      if (!result.ok) return result;
      if (result.sidecarSync?.ok !== true) {
        return { ok: false, error: result.sidecarSync?.error || 'Could not save this workspace. Please try again.' };
      }
      undoService.reset();
      renderAll();
      windowObject.dispatchEvent(new windowObject.CustomEvent('hikari:storage-changed'));
      return result;
    },
    onComplete: openStartupView
  });

  windowObject.hikariApi?.onPaperFileSaved?.(() => {
    moduleRuntime.modules.papers?.handleStoredPaperSaved?.();
  });

  windowObject.hikariApi?.onProtocolRecordSaved?.((payload) => {
    if (hydrationComplete) {
      rendererServices.protocol.handleExternalProtocolRecordSaved(payload);
    } else {
      pendingProtocolRecordEvents.push(payload);
    }
  });

  async function initApp() {
    // Under Electron the preload bridge is mandatory. Without this check a build
    // that lost its preload (packaging omission, corrupt install) boots into a
    // shell that reports ready while every IPC call throws.
    if (!windowObject.hikariApi && /\bElectron\//.test(windowObject.navigator?.userAgent || '')) {
      throw new Error('hikariApi bridge is missing: the preload script did not load');
    }
    const hydration = await storageImportController.hydrateStateFromStorageRoot();
    hydrationComplete = true;
    while (pendingProtocolRecordEvents.length) {
      const payload = pendingProtocolRecordEvents.shift();
      try {
        rendererServices.protocol.handleExternalProtocolRecordSaved(payload);
      } catch (error) {
        console.error('Failed to apply queued protocol record:', error);
        showTransientNotice('A protocol saved outside the app could not be applied.', { type: 'error' });
      }
    }
    undoService.reset();
    navigationShell.applyAppearanceSnapshot(state.settings?.appearance);
    navigationShell.renderAppNavigation();
    navigationShell.initNavigation();
    renderAll();
    // Keep workspace setup outside module navigation and last-view history.
    const storageError = state.settings?.storageImport?.error
      || (hydration?.sidecarSync?.ok === false
        ? hydration.sidecarSync.error || 'Could not save the workspace.' : '');
    if (!String(state.settings?.storagePath || '').trim() || storageError) {
      storageSetup.show();
      return;
    }
    openStartupView();
  }

  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  initApp()
    .then(() => {
      windowObject.dispatchEvent(createAppReadyEvent(windowObject));
      resolveReady({ ok: true });
    })
    .catch((error) => {
      console.error('Failed to initialize Hikari:', error);
      windowObject.dispatchEvent(createAppReadyEvent(windowObject, {
        detail: {
          error: true
        }
      }));
      resolveReady({ ok: false, error });
    });

  return {
    initApp,
    moduleRegistry,
    moduleRuntime,
    navigationShell,
    rendererServices,
    renderAll,
    state,
    storageImportController,
    topbarSearchController,
    whenReady: () => readyPromise
  };
}
