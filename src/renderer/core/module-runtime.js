import { createSelectionInsightsController } from '../modules/selection-insights/index.js';
import { rendererModuleManifests } from '../module-manifests/index.js';
import { createModuleHistoryRuntime } from './module-history-runtime.js';
import {
  createManifestNavigationAliases,
  createManifestRenderEntries,
  initializeModuleManifests,
  renderModuleManifests
} from './manifest-runtime.js';

// Builds every feature module from src/renderer/module-manifests/ and returns
// the per-view render dispatch used by the navigation shell. All modules share
// one manifestContext; `modules` is filled in as each manifest initializes, so a
// manifest's createOptions can only see modules declared before it.
export function createRendererModuleRuntime(config = {}) {
  const state = config?.state || {};
  const persist = config?.persist || (() => {});
  const createId = config?.createId || (() => '');
  const safeText = config?.safeText || ((value) => String(value || ''));
  const cssEscape = config?.cssEscape || ((value) => String(value || ''));
  const rendererServices = config?.rendererServices || {};
  const moduleRegistry = config?.moduleRegistry;
  const trackGrowthEvent = config?.trackGrowthEvent || (() => {});
  const pluginServices = config?.pluginServices || null;
  const showView = config?.showView || (() => {});
  const views = config?.views || {};
  const onStoragePathSaved = config?.onStoragePathSaved || (async () => {});
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const windowObject = config?.windowObject || globalThis?.window || null;
  const apiBridge = config?.apiBridge || globalThis?.window?.hikariApi || globalThis?.hikariApi || null;
  const getApiBridge = typeof config?.getApiBridge === 'function'
    ? config.getApiBridge
    : () => apiBridge || globalThis?.window?.hikariApi || globalThis?.hikariApi || null;
  const modules = {};
  const selectionInsightsController = createSelectionInsightsController({
    state,
    persist,
    createId,
    safeText,
    rootDocument,
    windowObject
  });
  const manifestContext = {
    state,
    persist,
    getModuleHistory: config.getModuleHistory,
    createId,
    safeText,
    cssEscape,
    rendererServices,
    moduleRegistry,
    trackGrowthEvent,
    pluginServices,
    showView,
    views,
    onStoragePathSaved,
    runCloudSync: config.runCloudSync,
    rootDocument,
    windowObject,
    apiBridge,
    getApiBridge,
    modules,
    selectionInsightsController
  };

  initializeModuleManifests(moduleRegistry, rendererModuleManifests, manifestContext);

  const renderByViewId = new Map(createManifestRenderEntries(rendererModuleManifests, manifestContext));
  const navigationViewAliases = createManifestNavigationAliases(rendererModuleManifests, manifestContext);

  function renderView(viewId) {
    renderByViewId.get(viewId)?.();
  }

  function renderAll() {
    renderModuleManifests(rendererModuleManifests, manifestContext);
  }

  return {
    ...createModuleHistoryRuntime(rendererModuleManifests, manifestContext),
    modules,
    navigationViewAliases,
    renderAll,
    renderAgentChatRail: () => modules.agentChatRail.render(),
    renderView
  };
}
