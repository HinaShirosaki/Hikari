import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText } from '../shared.js';
import { cloneLibraryRow, createCustomRow, createFeatureRow, createPoiRow } from './row-factory.js';

export function installProteinBuilderRowActions(ctx) {
  const { elements, state } = ctx;

  ctx.moveRow = function moveRow(rowId, direction) {
    const index = state.rows.findIndex((row) => row.id === rowId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.rows.length) {
      return;
    }
    const [row] = state.rows.splice(index, 1);
    state.rows.splice(targetIndex, 0, row);
    ctx.invalidateDnaConstruct();
  };

  ctx.removeRow = function removeRow(rowId) {
    state.rows = state.rows.filter((row) => row.id !== rowId);
    ctx.invalidateDnaConstruct();
  };

  ctx.addPoiRow = function addPoiRow() {
    if (state.rows.some((row) => row.type === 'poi')) {
      ctx.setBuilderStatus('POI block already exists in the chain.');
      return;
    }
    ctx.appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
    ctx.invalidateDnaConstruct();
    ctx.render();
  };

  ctx.addCustomRow = function addCustomRow() {
    ctx.appendRow(createCustomRow(state.nextRowId++));
    ctx.invalidateDnaConstruct();
    ctx.render();
  };

  ctx.addLibraryRow = function addLibraryRow(type, libraryId) {
    const row = cloneLibraryRow(state.nextRowId++, type, libraryId);
    if (!row) {
      return;
    }
    ctx.appendRow(row);
    ctx.invalidateDnaConstruct();
    ctx.render();
  };

  ctx.addFeatureRowById = function addFeatureRowById(featureId) {
    const feature = (state.featureSearchResults || []).find((item) => cleanText(item?.id, 200) === cleanText(featureId, 200));
    if (!feature) {
      return;
    }
    ctx.appendRow(createFeatureRow(state.nextRowId++, feature));
    ctx.invalidateDnaConstruct();
    ctx.render();
  };

  ctx.runFeatureSearch = async function runFeatureSearch(options = {}) {
    const query = cleanText(options?.query ?? elements.proteinBuilderFeatureSearchInput?.value, 600);
    state.featureSearchQuery = query;
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.value = query;
    }

    const storagePath = ctx.getStoragePath();
    if (!storagePath) {
      state.featureSearchResults = [];
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }

    if (query.length < 2) {
      state.featureSearchResults = [];
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('Enter at least 2 characters to search stored features.');
      return;
    }

    const bridge = ctx.getBridge();
    if (!bridge?.sequenceLibrarySearchFeatures) {
      state.featureSearchResults = [];
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('Feature search API unavailable.', true);
      return;
    }

    state.isSearchingFeatures = true;
    ctx.syncFeatureSearchControls();
    ctx.setFeatureSearchStatus(`Searching for "${query}"...`);

    try {
      const response = await bridge.sequenceLibrarySearchFeatures({ storagePath, query, limit: 24 });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to search stored features.');
      }

      state.featureSearchResults = Array.isArray(response.results) ? response.results : [];
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus(`Found ${state.featureSearchResults.length} matching feature${state.featureSearchResults.length === 1 ? '' : 's'}.`);
    } catch (error) {
      state.featureSearchResults = [];
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus(error?.message || 'Failed to search stored features.', true);
    } finally {
      state.isSearchingFeatures = false;
      ctx.syncFeatureSearchControls();
    }
  };
}
