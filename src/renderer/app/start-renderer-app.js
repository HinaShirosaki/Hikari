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
} from './navigation-shell.js';
import { createStorageImportController } from './storage-import.js';
import {
  buildSearchScopeMap,
  buildViewAliasMap,
  createTopbarSearchController
} from './topbar-search.js';

const APP_READY_EVENT = 'hikari:app-ready';
const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';

export function startRendererApp() {
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

  applyAppearanceSnapshot(state.settings?.appearance, document);

  const sharedLeftRailRuntime = initSharedLeftRailResizers({
    document,
    windowObject: window
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
    if (window.enanaApi?.autoSaveDataFile && String(state.settings?.storagePath || '').trim()) {
      window.enanaApi
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
    VIEWS,
    sequenceViewerDetailViewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID
  });
  const rendererServices = createRendererServices(moduleRegistry);
  const storageImportController = createStorageImportController({
    state,
    persist,
    persistState,
    normalizeStateStoragePaths,
    rebuildObjectGraph,
    windowObject: window
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
    sequenceViewerDetailViewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID,
    apiBridge: window.enanaApi || null,
    getApiBridge: () => window.enanaApi || null,
    rootDocument: document,
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
    sequenceViewerDetailViewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID,
    moduleRuntime,
    sharedLeftRailRuntime,
    executeTopbarSearch: (query) => topbarSearchController?.executeTopbarSearch(query),
    getSearchSuggestions: (query, options) => topbarSearchController?.getSearchSuggestions(query, options) || [],
    applySearchSuggestion: (suggestion) => topbarSearchController?.applySuggestion(suggestion) || false,
    documentObject: document,
    windowObject: window
  });

  function clickItemBySelector(viewId, selector) {
    showView(viewId);
    const tryClick = () => {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        element.click();
        if (typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return true;
      }
      return false;
    };
    if (tryClick()) {
      return true;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tryClick();
      });
    });
    return true;
  }

  function openItemViaDataAttr(viewId, attrName, itemId) {
    if (!itemId) {
      return false;
    }
    const safeId = cssEscape(String(itemId));
    return clickItemBySelector(viewId, `[${attrName}="${safeId}"]`);
  }

  const openItemHandlers = {
    Notebook: (itemId) => {
      if (!itemId) {
        return false;
      }
      showView(VIEWS.BIOLOGY_NOTEBOOK);
      return moduleRegistry.get('biologyNotebook')?.openEntry?.(itemId) !== undefined;
    },
    Protocol: (itemId) => {
      if (!itemId) {
        return false;
      }
      showView(VIEWS.PROTOCOL_MANAGEMENT);
      moduleRegistry.get('protocol')?.editProtocol?.(itemId);
      return true;
    },
    Sample: (itemId) => openItemViaDataAttr(VIEWS.SAMPLE_REGISTRY, 'data-sample-open', itemId),
    Chemical: (itemId) => openItemViaDataAttr(VIEWS.LAB_COMMON_INVENTORY, 'data-chemical-open', itemId),
    Assay: (itemId) => openItemViaDataAttr(VIEWS.ASSAY, 'data-assay-open-results', itemId),
    Gel: (itemId) => openItemViaDataAttr(VIEWS.GEL, 'data-gel-edit', itemId),
    Project: (itemId) => openItemViaDataAttr(VIEWS.PROJECT_MANAGEMENT, 'data-project-select', itemId),
    Paper: (itemId) => openItemViaDataAttr(VIEWS.PAPERS, 'data-paper-view', itemId),
    Workflow: (itemId) => openItemViaDataAttr(VIEWS.WORKFLOW_MANAGEMENT, 'data-workflow-run-open', itemId)
  };

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
    windowObject: window
  });

  window.enanaGraph = {
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
      window.dispatchEvent(new CustomEvent(APP_READY_EVENT));
    })
    .catch((error) => {
      console.error('Failed to initialize Hikari:', error);
      window.dispatchEvent(new CustomEvent(APP_READY_EVENT, {
        detail: {
          error: true
        }
      }));
    });
}
