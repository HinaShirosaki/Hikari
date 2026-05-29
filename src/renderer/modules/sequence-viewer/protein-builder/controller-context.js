import { cleanText, normalizeSequenceText } from '../shared.js';
import { DEFAULT_CHAIN } from './constants.js';
import { cloneLibraryRow, createPoiRow } from './row-factory.js';

export function createProteinBuilderContext(config = {}) {
  const elements = config?.elements || {};
  const state = {
    nextRowId: 1,
    rows: [],
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    dnaConstruct: null,
    assemblyDialogOpen: false,
    isLoadingAssemblyBackbones: false,
    isPreparingAssembly: false,
    storedBackbones: [],
    selectedBackboneId: '',
    statusMessage: 'Linear chain: each block accepts one upstream and one downstream connection.',
    statusError: false
  };

  const ctx = {
    elements,
    state,
    getBridge: config?.getBridge || (() => null),
    getStoragePath: config?.getStoragePath || (() => ''),
    getSelectedRecord: config?.getSelectedRecord || (() => null),
    getSelectedFeature: config?.getSelectedFeature || (() => null),
    hasStoragePath: config?.hasStoragePath || (() => false),
    setStatus: config?.setStatus || (() => {}),
    onNavigateHome: typeof config?.onNavigateHome === 'function' ? config.onNavigateHome : (() => {}),
    onNavigateBuilder: typeof config?.onNavigateBuilder === 'function' ? config.onNavigateBuilder : (() => {}),
    loadExternalRecord: typeof config?.loadExternalRecord === 'function' ? config.loadExternalRecord : (() => {}),
    appState: config?.state && typeof config.state === 'object' ? config.state : null,
    persist: typeof config?.persist === 'function' ? config.persist : null,
    createId: typeof config?.createId === 'function' ? config.createId : null,
    onNotebookEntriesChanged: typeof config?.onNotebookEntriesChanged === 'function'
      ? config.onNotebookEntriesChanged
      : null
  };

  ctx.setBuilderStatus = function setBuilderStatus(message, isError = false) {
    state.statusMessage = String(message || '');
    state.statusError = isError === true;
    if (!elements.proteinBuilderStatus) {
      return;
    }
    elements.proteinBuilderStatus.textContent = state.statusMessage;
    elements.proteinBuilderStatus.style.color = state.statusError ? 'var(--danger)' : '';
  };

  ctx.setFeatureSearchStatus = function setFeatureSearchStatus(message, isError = false) {
    if (!elements.proteinBuilderFeatureSearchStatus) {
      return;
    }
    elements.proteinBuilderFeatureSearchStatus.textContent = String(message || '');
    elements.proteinBuilderFeatureSearchStatus.style.color = isError ? 'var(--danger)' : '';
  };

  ctx.syncFeatureSearchControls = function syncFeatureSearchControls() {
    const disabled = !ctx.hasStoragePath() || Boolean(state.isSearchingFeatures);
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.disabled = disabled;
    }
    if (elements.proteinBuilderFeatureSearchBtn) {
      elements.proteinBuilderFeatureSearchBtn.disabled = disabled;
    }
    if (elements.proteinBuilderAssembleBtn) {
      elements.proteinBuilderAssembleBtn.disabled = Boolean(state.isLoadingAssemblyBackbones || state.isPreparingAssembly);
    }
  };

  ctx.invalidateDnaConstruct = function invalidateDnaConstruct() {
    state.dnaConstruct = null;
  };

  ctx.appendRow = function appendRow(row, options = {}) {
    if (!row) {
      return;
    }
    const insertBeforePoi = options?.insertBeforePoi !== false;
    const poiIndex = state.rows.findIndex((item) => item.type === 'poi');
    if (insertBeforePoi && row.type !== 'poi' && poiIndex >= 0) {
      state.rows.splice(poiIndex, 0, row);
      return;
    }
    state.rows.push(row);
  };

  ctx.resetRows = function resetRows() {
    state.rows = [];
    ctx.invalidateDnaConstruct();
    DEFAULT_CHAIN.forEach((entry) => {
      if (entry.kind === 'library') {
        ctx.appendRow(cloneLibraryRow(state.nextRowId++, entry.type, entry.libraryId), { insertBeforePoi: false });
      }
      if (entry.kind === 'poi') {
        ctx.appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
      }
    });
  };

  ctx.currentRows = function currentRows() {
    return state.rows.map((row) => ({ ...row }));
  };

  ctx.getDnaBuildContextKey = function getDnaBuildContextKey() {
    const record = ctx.getSelectedRecord();
    const selectedFeature = ctx.getSelectedFeature();
    const recordKey = normalizeSequenceText(record?.sequence || '');
    const featureKey = selectedFeature
      ? [
          cleanText(selectedFeature?.name, 140),
          cleanText(selectedFeature?.type, 120),
          Number(selectedFeature?.strand) === -1 ? -1 : 1,
          (Array.isArray(selectedFeature?.segments) ? selectedFeature.segments : [])
            .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
            .join(',')
        ].join('|')
      : '';
    return `${recordKey}::${featureKey}`;
  };

  return ctx;
}
