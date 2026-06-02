import { VIEWS, TITLES } from '../modules/views.js';
import { createId, safeText, cssEscape } from '../modules/utils.js';
import {
  loadState,
  persistState,
  trackGrowthEvent
} from '../modules/app-state.js';
import {
  rebuildObjectGraph,
  queryNotebookEntriesByRelation
} from '../modules/object-graph.js';
import { APP_DOCK_ORDER, APP_REGISTRY } from '../modules/app-registry.generated.js';
import { createRendererModuleRuntime } from '../module-runtime.js';
import { createModuleRegistry, createRendererServices } from '../services/index.js';
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

  let moduleRuntime = null;
  let navigationShell = null;
  let topbarSearchController = null;

  function showView(viewId) {
    navigationShell?.showView(viewId);
  }

  function setSearchInputValue(inputId, value) {
    return navigationShell?.setSearchInputValue(inputId, value) || false;
  }

  function persist() {
    normalizeStateStoragePaths(state);
    state.objectGraph = rebuildObjectGraph(state);
    persistState(state);
    if (windowObject.enanaApi?.autoSaveDataFile && String(state.settings?.storagePath || '').trim()) {
      windowObject.enanaApi
        .autoSaveDataFile(state, '')
        .catch(() => {});
    }
  }

  function renderAll() {
    state.objectGraph = rebuildObjectGraph(state);
    moduleRuntime.renderAll();
  }

  const moduleRegistry = createModuleRegistry({
    showView,
    setSearchInputValue,
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
    rebuildObjectGraph,
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
    showView,
    views: VIEWS,
    apiBridge: windowObject.enanaApi || null,
    getApiBridge: () => windowObject.enanaApi || null,
    rootDocument: documentObject,
    onStoragePathSaved: async (storagePath, options = {}) => {
      const result = await storageImportController.runStorageRootImport(storagePath, {
        persistMergedState: true,
        resetWorkspace: options.resetWorkspace === true
      });
      renderAll();
      return result;
    }
  });

  navigationShell = createNavigationShell({
    VIEWS,
    TITLES,
    APP_DOCK_ORDER,
    APP_REGISTRY,
    navigationViewAliases: moduleRuntime.navigationViewAliases,
    moduleRuntime,
    sharedLeftRailRuntime,
    executeTopbarSearch: (query) => topbarSearchController?.executeTopbarSearch(query),
    getSearchSuggestions: (query, options) => topbarSearchController?.getSearchSuggestions(query, options) || [],
    applySearchSuggestion: (suggestion) => topbarSearchController?.applySuggestion(suggestion) || false,
    documentObject,
    windowObject
  });

  const openItemHandlers = createTopbarOpenItemHandlers({
    views: VIEWS,
    moduleRegistry,
    rendererServices,
    showView,
    documentObject,
    windowObject,
    cssEscape
  });

  topbarSearchController = createTopbarSearchController({
    state,
    VIEWS,
    TITLES,
    globalViewAliases,
    searchScopeTargets,
    showView,
    getActiveViewId: navigationShell.getActiveViewId,
    setSearchInputValue,
    topbarSearchInput: navigationShell.topbarSearchInput,
    apps: APP_REGISTRY,
    normalizeViewId: normalizeAppViewId,
    openItemHandlers,
    windowObject
  });

  windowObject.enanaApi?.onProtocolRecordSaved?.((payload) => {
    rendererServices.protocol.handleExternalProtocolRecordSaved(payload);
  });

  windowObject.enanaGraph = {
    rebuild: () => {
      state.objectGraph = rebuildObjectGraph(state);
      persistState(state);
      return state.objectGraph;
    },
    entriesUsingReagentLot: (lot) => queryNotebookEntriesByRelation(state, {
      relation: 'uses_reagent_lot',
      targetType: 'reagent_lot',
      targetId: lot
    })
  };

  async function initApp() {
    await storageImportController.hydrateStateFromStorageRoot();
    navigationShell.applyAppearanceSnapshot(state.settings?.appearance);
    navigationShell.renderAppNavigation();
    navigationShell.initNavigation();
    topbarSearchController.initTelegramCommandBridge();
    renderAll();
    navigationShell.enableLastViewPersistence();
    navigationShell.showView(navigationShell.resolveStartupViewId(state));
  }

  initApp()
    .then(() => {
      windowObject.dispatchEvent(createAppReadyEvent(windowObject));
    })
    .catch((error) => {
      console.error('Failed to initialize Hikari:', error);
      windowObject.dispatchEvent(createAppReadyEvent(windowObject, {
        detail: {
          error: true
        }
      }));
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
    topbarSearchController
  };
}
