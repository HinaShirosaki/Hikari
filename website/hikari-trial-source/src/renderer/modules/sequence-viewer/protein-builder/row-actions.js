import { parseInputRecords } from '../parsing.js';
import { cleanText } from '../shared.js';
import { cloneLibraryRow, createFeatureRow } from './row-factory.js';

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

  ctx.addLibraryRow = function addLibraryRow(type, libraryId) {
    const row = cloneLibraryRow(state.nextRowId++, type, libraryId);
    if (!row) {
      return;
    }
    ctx.appendRow(row);
    ctx.invalidateDnaConstruct();
    ctx.render();
  };

  ctx.getSelectedSearchFeature = function getSelectedSearchFeature() {
    const selectedId = cleanText(state.featureSelectedId, 200);
    return selectedId
      ? (state.featureSearchResults || []).find((item) => cleanText(item?.id, 200) === selectedId) || null
      : null;
  };

  ctx.getSearchFeatureHosts = function getSearchFeatureHosts(feature) {
    return (Array.isArray(feature?.hosts) ? feature.hosts : [])
      .filter((entry) => cleanText(entry?.hostVectorId, 200));
  };

  ctx.getSelectedSearchHost = function getSelectedSearchHost() {
    const hostId = cleanText(state.featureHostId, 200);
    return ctx.getSearchFeatureHosts(ctx.getSelectedSearchFeature())
      .find((entry) => cleanText(entry?.hostVectorId, 200) === hostId) || null;
  };

  ctx.clearFeatureSelection = function clearFeatureSelection() {
    state.featureSelectedId = '';
    state.featureHostId = '';
    state.featureHostRequestId += 1;
    if (elements.proteinBuilderFeaturePicker) {
      elements.proteinBuilderFeaturePicker.open = true;
    }
    if (elements.proteinBuilderFeatureCodonOptimize) {
      elements.proteinBuilderFeatureCodonOptimize.checked = false;
    }
  };

  function revealFeatureSource() {
    if (elements.proteinBuilderFeaturePicker) {
      elements.proteinBuilderFeaturePicker.open = false;
    }
    if (elements.proteinBuilderFeatureHostsFold) {
      elements.proteinBuilderFeatureHostsFold.open = true;
    }
    if (elements.proteinBuilderFeaturePreviewFold) {
      elements.proteinBuilderFeaturePreviewFold.open = true;
    }
    // Selection removes the focused result from view; continue at the next step.
    elements.proteinBuilderFeatureHostsFold?.querySelector?.('summary')?.focus?.();
  }

  ctx.selectSearchFeature = function selectSearchFeature(featureId) {
    const safeId = cleanText(featureId, 200);
    if (!safeId || !(state.featureSearchResults || []).some((feature) => cleanText(feature?.id, 200) === safeId)) {
      return;
    }
    if (safeId === cleanText(state.featureSelectedId, 200)) {
      revealFeatureSource();
      return;
    }
    state.featureSelectedId = safeId;
    if (elements.proteinBuilderFeatureCodonOptimize) {
      // Preserve the existing stored-CDS behavior unless the user explicitly
      // opts into rebuilding this database feature with the selected table.
      elements.proteinBuilderFeatureCodonOptimize.checked = false;
    }
    // The first host is the most recently updated one, which is the vector most
    // likely still on the bench.
    state.featureHostId = cleanText(
      ctx.getSearchFeatureHosts(ctx.getSelectedSearchFeature())[0]?.hostVectorId,
      200
    );
    ctx.renderFeatureSearchResults();
    revealFeatureSource();
    void ctx.loadFeatureSourcePreview();
  };

  ctx.selectSearchFeatureHost = function selectSearchFeatureHost(hostId) {
    const safeId = cleanText(hostId, 200);
    if (!safeId || safeId === cleanText(state.featureHostId, 200)) {
      return;
    }
    state.featureHostId = safeId;
    if (elements.proteinBuilderFeaturePreviewFold) {
      elements.proteinBuilderFeaturePreviewFold.open = true;
    }
    ctx.renderFeatureSourcePanel();
    void ctx.loadFeatureSourcePreview();
  };

  ctx.loadFeatureSourcePreview = async function loadFeatureSourcePreview() {
    const host = ctx.getSelectedSearchHost();
    const hostId = cleanText(host?.hostVectorId, 200);
    state.featureHostRequestId += 1;
    const requestId = state.featureHostRequestId;
    if (!hostId || state.featureHostRecords.has(hostId)) {
      ctx.renderFeatureSourcePreview();
      return;
    }
    const bridge = ctx.getBridge();
    const storagePath = ctx.getStoragePath();
    if (!bridge?.sequenceLibraryGet || !storagePath) {
      ctx.renderFeatureSourcePreview('Plasmid preview needs the sequence library storage folder.');
      return;
    }
    ctx.renderFeatureSourcePreview();
    try {
      const response = await bridge.sequenceLibraryGet({ storagePath, id: hostId, includeGbk: true });
      if (!response?.ok) {
        throw new Error(response?.error || 'That vector could not be read.');
      }
      const parsed = parseInputRecords(String(response.gbkText || ''));
      const record = (Array.isArray(parsed?.records) ? parsed.records : [])[0] || null;
      // A read for a vector the user has already clicked past must not land.
      if (requestId !== state.featureHostRequestId) {
        return;
      }
      if (!record?.sequence?.length) {
        ctx.renderFeatureSourcePreview('That vector has no sequence to preview.');
        return;
      }
      state.featureHostRecords.set(hostId, record);
      ctx.renderFeatureSourcePreview();
    } catch (error) {
      if (requestId !== state.featureHostRequestId) {
        return;
      }
      ctx.renderFeatureSourcePreview(cleanText(error?.message || error, 200) || 'Plasmid preview unavailable.');
    }
  };

  ctx.addSelectedFeatureRow = function addSelectedFeatureRow() {
    const feature = ctx.getSelectedSearchFeature();
    if (!feature) {
      return false;
    }
    const host = ctx.getSelectedSearchHost();
    const hostRecord = host
      ? state.featureHostRecords.get(cleanText(host.hostVectorId, 200))
      : null;
    if (!hostRecord?.sequence?.length) {
      return false;
    }
    ctx.appendRow(createFeatureRow(state.nextRowId++, feature, {
      host,
      hostRecord,
      codonOptimize: Boolean(elements.proteinBuilderFeatureCodonOptimize?.checked)
    }));
    ctx.invalidateDnaConstruct();
    ctx.render();
    return true;
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
      ctx.clearFeatureSelection();
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }

    if (query.length < 2) {
      state.featureSearchResults = [];
      ctx.clearFeatureSelection();
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('');
      return;
    }

    const bridge = ctx.getBridge();
    if (!bridge?.sequenceLibrarySearchFeatures) {
      state.featureSearchResults = [];
      ctx.clearFeatureSelection();
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

      state.featureSearchResults = (Array.isArray(response.results) ? response.results : [])
        // Primers aren't useful as protein-builder blocks; hide primer/primer_bind features.
        .filter((feature) => !/primer/i.test(String(feature?.type || '')));
      ctx.clearFeatureSelection();
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus('');
    } catch (error) {
      state.featureSearchResults = [];
      ctx.clearFeatureSelection();
      ctx.renderFeatureSearchResults();
      ctx.setFeatureSearchStatus(error?.message || 'Failed to search stored features.', true);
    } finally {
      state.isSearchingFeatures = false;
      ctx.syncFeatureSearchControls();
    }
  };
}
