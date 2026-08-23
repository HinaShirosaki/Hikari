import { cleanText, normalizeSequenceText } from '../shared.js';
import {
  buildProteinArchitectureName,
  buildProteinTargetLabel
} from '../sequence-naming.js';
import { DEFAULT_CHAIN } from './constants.js';
import { resolvePoiSourceFromRecord } from './record-dna.js';
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
    suggestedConstructName: '',
    constructNameEdited: false,
    statusMessage: '',
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
    getVectorInsertTarget: typeof config?.getVectorInsertTarget === 'function' ? config.getVectorInsertTarget : (() => null),
    onInsertIntoVector: typeof config?.onInsertIntoVector === 'function' ? config.onInsertIntoVector : (async () => false),
    onCancelVectorInsert: typeof config?.onCancelVectorInsert === 'function' ? config.onCancelVectorInsert : (() => {}),
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
    elements.proteinBuilderStatus.hidden = !state.statusMessage;
    elements.proteinBuilderStatus.style.color = state.statusError ? 'var(--theme-danger)' : '';
  };

  ctx.setFeatureSearchStatus = function setFeatureSearchStatus(message, isError = false) {
    if (!elements.proteinBuilderFeatureSearchStatus) {
      return;
    }
    elements.proteinBuilderFeatureSearchStatus.textContent = String(message || '');
    elements.proteinBuilderFeatureSearchStatus.style.color = isError ? 'var(--theme-danger)' : '';
  };

  // When the Vector Builder sent us here with a target site, the primary action
  // becomes "splice into the open vector" instead of the stored-backbone
  // assembly, which stays available as the standalone entry point.
  ctx.syncVectorInsertControls = function syncVectorInsertControls() {
    const target = ctx.getVectorInsertTarget();
    const active = Boolean(target);
    if (elements.proteinBuilderInsertVectorBtn) {
      elements.proteinBuilderInsertVectorBtn.hidden = !active;
      elements.proteinBuilderInsertVectorBtn.disabled = Boolean(state.isPreparingAssembly);
    }
    if (elements.proteinBuilderCancelVectorBtn) {
      elements.proteinBuilderCancelVectorBtn.hidden = !active;
    }
    if (elements.proteinBuilderAssembleBtn) {
      elements.proteinBuilderAssembleBtn.hidden = active;
    }
  };

  ctx.insertConstructIntoVector = async function insertConstructIntoVector() {
    if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
      ctx.buildCurrentDnaSequence();
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        ctx.setBuilderStatus('Resolve the construct errors before inserting it into the vector.', true);
        return;
      }
    }

    state.isPreparingAssembly = true;
    ctx.syncVectorInsertControls();
    try {
      const applied = await ctx.onInsertIntoVector({
        constructName: ctx.resolveConstructName(),
        dnaConstruct: state.dnaConstruct
      });
      if (applied) {
        ctx.setBuilderStatus('Inserted the construct into the open vector.');
      }
    } catch (error) {
      ctx.setBuilderStatus(error?.message || 'Failed to insert the construct into the vector.', true);
    } finally {
      state.isPreparingAssembly = false;
      ctx.syncVectorInsertControls();
    }
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
    state.suggestedConstructName = '';
    state.constructNameEdited = false;
    if (elements.proteinBuilderNameInput) {
      elements.proteinBuilderNameInput.value = '';
    }
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

  ctx.getCurrentDnaSource = function getCurrentDnaSource() {
    return resolvePoiSourceFromRecord(ctx.getSelectedRecord(), ctx.getSelectedFeature());
  };

  ctx.getSuggestedConstructName = function getSuggestedConstructName() {
    const sourceName = buildProteinTargetLabel({
      recordName: ctx.getSelectedRecord()?.name,
      targetName: cleanText(ctx.getCurrentDnaSource()?.label, 140) || 'Current DNA'
    });
    return buildProteinArchitectureName({
      parts: state.rows.map((row) => ({
        label: row.type === 'poi' ? sourceName : row.label,
        type: row.type
      }))
    });
  };

  ctx.syncSuggestedConstructName = function syncSuggestedConstructName() {
    const suggested = ctx.getSuggestedConstructName();
    const current = cleanText(elements.proteinBuilderNameInput?.value, 140).trim();
    if (elements.proteinBuilderNameInput && (
      !state.constructNameEdited
      || !current
      || current === state.suggestedConstructName
    )) {
      elements.proteinBuilderNameInput.value = suggested;
    }
    state.suggestedConstructName = suggested;
    return suggested;
  };

  ctx.resolveConstructName = function resolveConstructName() {
    return cleanText(elements.proteinBuilderNameInput?.value, 140).trim()
      || state.suggestedConstructName
      || ctx.getSuggestedConstructName();
  };

  ctx.getProteinBuilderPayload = function getProteinBuilderPayload() {
    return {
      constructName: ctx.resolveConstructName(),
      activeDnaSource: ctx.getCurrentDnaSource(),
      rows: ctx.currentRows()
    };
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
