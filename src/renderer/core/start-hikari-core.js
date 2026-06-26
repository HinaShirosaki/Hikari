import { VIEWS, TITLES } from '../modules/views.js';
import { createId, safeText, cssEscape } from '../modules/utils.js';
import {
  loadState,
  persistState,
  trackGrowthEvent
} from '../modules/app-state.js';
import { APP_DOCK_ORDER, APP_REGISTRY } from '../modules/app-registry.generated.js';
import { createRendererModuleRuntime } from '../module-runtime.js';
import {
  createModuleRegistry,
  createRendererServices,
  createUndoService,
  createUnsavedChangesService
} from '../services/index.js';
import { initSharedLeftRailResizers } from '../shared-left-rail.js';
import { normalizeStateStoragePaths } from '../modules/storage-path-normalizer.js';
import {
  applyAppearanceSnapshot,
  createNavigationShell,
  normalizeViewId
} from '../app/navigation-shell.js';
import { createStorageImportController } from '../app/storage-import.js';
import {
  buildSearchScopeMap,
  buildViewAliasMap,
  createTopbarSearchController
} from '../app/topbar-search.js';
import { createTopbarOpenItemHandlers } from '../app/topbar-open-handlers.js';

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

export function startHikariCore({
  documentObject = document,
  windowObject = window
} = {}) {
  const state = loadState();
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

  undoService = createUndoService({
    state,
    persistState: persistStateNow,
    renderAll: renderRestoredState,
    documentObject
  });

  const moduleRegistry = createModuleRegistry({
    showView: viewController.showView,
    setSearchInputValue: viewController.setSearchInputValue,
    VIEWS
  });
  const rendererServices = createRendererServices(moduleRegistry, {
    protocol: {
      state,
      persist,
      createId
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

  let hydrationComplete = false;
  const pendingProtocolRecordEvents = [];

  windowObject.hikariApi?.onProtocolRecordSaved?.((payload) => {
    if (hydrationComplete) {
      rendererServices.protocol.handleExternalProtocolRecordSaved(payload);
    } else {
      pendingProtocolRecordEvents.push(payload);
    }
  });

  async function initApp() {
    await storageImportController.hydrateStateFromStorageRoot();
    hydrationComplete = true;
    while (pendingProtocolRecordEvents.length) {
      const payload = pendingProtocolRecordEvents.shift();
      try {
        rendererServices.protocol.handleExternalProtocolRecordSaved(payload);
      } catch (error) {
        console.error('Failed to apply queued protocol record:', error);
      }
    }
    undoService.reset();
    navigationShell.applyAppearanceSnapshot(state.settings?.appearance);
    navigationShell.renderAppNavigation();
    navigationShell.initNavigation();
    topbarSearchController.initTelegramCommandBridge();
    renderAll();
    navigationShell.enableLastViewPersistence();
    navigationShell.showView(navigationShell.resolveStartupViewId(state));
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
