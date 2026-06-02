import { createSelectionInsightsController } from './modules/selection-insights/index.js';
import { rendererModuleManifests } from './module-manifests/index.js';
import {
  createManifestNavigationAliases,
  createManifestRenderEntries,
  initializeModuleManifests,
  renderModuleManifests
} from './module-manifests/runtime.js';

export function createRendererModuleRuntime(config = {}) {
  const state = config?.state || {};
  const persist = config?.persist || (() => {});
  const createId = config?.createId || (() => '');
  const safeText = config?.safeText || ((value) => String(value || ''));
  const cssEscape = config?.cssEscape || ((value) => String(value || ''));
  const rendererServices = config?.rendererServices || {};
  const moduleRegistry = config?.moduleRegistry;
  const trackGrowthEvent = config?.trackGrowthEvent || (() => {});
  const showView = config?.showView || (() => {});
  const views = config?.views || {};
  const onStoragePathSaved = config?.onStoragePathSaved || (async () => {});
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const apiBridge = config?.apiBridge || globalThis?.window?.enanaApi || globalThis?.enanaApi || null;
  const getApiBridge = typeof config?.getApiBridge === 'function'
    ? config.getApiBridge
    : () => apiBridge || globalThis?.window?.enanaApi || globalThis?.enanaApi || null;
  const modules = {};
  const selectionInsightsController = createSelectionInsightsController({
    state,
    persist,
    createId,
    safeText,
    rootDocument,
    windowObject: globalThis?.window || null
  });
  const manifestContext = {
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    rendererServices,
    moduleRegistry,
    trackGrowthEvent,
    showView,
    views,
    onStoragePathSaved,
    rootDocument,
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
    modules,
    navigationViewAliases,
    renderAll,
    renderAgentChatRail: () => modules.agentChatRail.render(),
    renderView
  };
}
