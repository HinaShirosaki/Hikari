import { computeSequenceLayoutMetrics } from '../../detail-layout.js';
import {
  normalizeHighlightSegments,
  renderDualStrandSequenceLinesHtml
} from '../../rendering.js';
import {
  buildSequenceMapSvg,
  getMapKind,
  resolveBaseFromPoint
} from '../sequence-map.js';
import { PROTEIN_DIRECT_CLONING_MAX_AA } from '../../protein-builder/constants.js';

// Drawing the vector map and the paired sequence pane, plus the ring-drag
// selection those two views share.
function createVectorMapRendering({
  rootDocument,
  elements,
  state,
  vb,
  mapZoom,
  getSelectedRecord,
  getSelectionRange,
  getVisibleFeatures,
  getFeatureByIndex,
  clearSelection,
  hideContextMenu,
  hideOverlays,
  setStatus,
  onNavigateVectorBuilder
} = {}) {
  function renderMap(record) {
    const host = elements.vectorBuilderMap;
    if (!host) {
      return;
    }
    if (!record?.sequence?.length) {
      host.innerHTML = '<p class="small-note">Open a sequence record to build a vector.</p>';
      return;
    }
    const selection = getSelectionRange(record);
    const cursor = Number(vb().cursorBase);
    host.innerHTML = buildSequenceMapSvg(record, {
      features: getVisibleFeatures(record),
      selectedFeatureIndex: vb().selectedFeatureIndex,
      selection: selection || (Number.isFinite(cursor) ? { start: cursor, end: cursor } : null)
    });
    mapZoom.apply();
  }

  // Ring drag on a plasmid, track drag on a linear construct: same handler, the
  // map kind only changes how a pointer position inverts to a base.
  function resolveMapBase(record, event) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const svg = elements.vectorBuilderMap?.querySelector?.('svg');
    if (!sequenceLength || !svg || typeof svg.getBoundingClientRect !== 'function') {
      return null;
    }
    return resolveBaseFromPoint(
      svg.getBoundingClientRect(),
      event?.clientX,
      event?.clientY,
      sequenceLength,
      getMapKind(record)
    );
  }

  function renderSequencePane(record) {
    const host = elements.vectorBuilderSequence;
    if (!host) {
      return;
    }
    if (!record?.sequence?.length) {
      host.innerHTML = '<p class="small-note">No sequence loaded.</p>';
      return;
    }

    const previousScrollTop = Math.max(0, Number(host.scrollTop) || 0);
    const features = getVisibleFeatures(record);
    const selectedIndex = vb().selectedFeatureIndex;
    const selectedFeature = selectedIndex >= 0 ? features[selectedIndex] || null : null;
    const layout = computeSequenceLayoutMetrics(rootDocument, host);
    vb().sequenceLayout = layout;

    const selection = getSelectionRange(record);
    const highlights = selection
      ? [selection]
      : normalizeHighlightSegments(selectedFeature?.segments || [], record.sequence.length);

    host.innerHTML = renderDualStrandSequenceLinesHtml(record.sequence, highlights, {
      lineLength: layout.lineLength,
      charAdvancePx: layout.charAdvancePx,
      sequenceLineHeightPx: layout.lineHeightPx,
      lineFeatureOffsetPx: layout.lineFeatureOffsetPx,
      features,
      selectedFeatureIndex: selectedIndex,
      cursorBaseIndex: vb().cursorBase
    });
    host.scrollTop = previousScrollTop;
  }

  function syncControls(record) {
    const hasRecord = Boolean(record?.sequence?.length);
    if (elements.vectorBuilderTitle) {
      elements.vectorBuilderTitle.textContent = hasRecord
        ? String(record.name || 'Vector')
        : 'No sequence open';
    }
    if (elements.vectorBuilderCuttersToggle) {
      elements.vectorBuilderCuttersToggle.checked = Boolean(vb().showCutters);
      elements.vectorBuilderCuttersToggle.disabled = !hasRecord;
    }
    if (elements.vectorBuilderPrimersToggle) {
      elements.vectorBuilderPrimersToggle.checked = state.showPrimers !== false;
      elements.vectorBuilderPrimersToggle.disabled = !hasRecord;
    }
    if (elements.vectorBuilderProteinBuilderBtn) {
      elements.vectorBuilderProteinBuilderBtn.disabled = !hasRecord;
    }
    if (elements.vectorBuilderCloningDesignBtn) {
      const hideForLongProtein = Math.max(0, Number(state.sequenceEditDesignSource?.proteinInputAaLength) || 0)
        > PROTEIN_DIRECT_CLONING_MAX_AA;
      elements.vectorBuilderCloningDesignBtn.hidden = hideForLongProtein;
      elements.vectorBuilderCloningDesignBtn.disabled = !hasRecord || hideForLongProtein;
    }
  }

  function render() {
    if (!elements.vectorBuilderWorkspace) {
      return;
    }
    const record = getSelectedRecord();
    // Records mutate underneath us (edits, reloads); keep the local selection
    // index inside the current feature list instead of rendering a stale one.
    const featureCount = getVisibleFeatures(record).length;
    if (vb().selectedFeatureIndex >= featureCount) {
      vb().selectedFeatureIndex = -1;
    }
    syncControls(record);
    renderMap(record);
    renderSequencePane(record);
  }

  function open() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Open a sequence record before using Vector Builder.', true);
      return false;
    }
    hideOverlays();
    clearSelection();
    mapZoom.reset();
    onNavigateVectorBuilder();
    render();
    setStatus('');
    return true;
  }

  function selectFeature(index) {
    const record = getSelectedRecord();
    const feature = getFeatureByIndex(record, index);
    if (!feature) {
      return;
    }
    vb().selectedFeatureIndex = index;
    clearSelection();
    hideContextMenu();
    render();
  }

  function eventTargetsElement(event, element) {
    const target = event?.target || null;
    return Boolean(target && element && (target === element || element.contains?.(target)));
  }

  function deselectFeature() {
    if (!Number.isFinite(vb().selectedFeatureIndex) || vb().selectedFeatureIndex < 0) {
      return false;
    }
    vb().selectedFeatureIndex = -1;
    hideContextMenu();
    render();
    return true;
  }

  function beginRingSelection(event) {
    const record = getSelectedRecord();
    const base = resolveMapBase(record, event);
    if (!Number.isFinite(base)) {
      return;
    }
    const current = vb();
    current.selectedFeatureIndex = -1;
    current.selectionAnchor = base;
    current.selectionFocus = base;
    current.cursorBase = base;
    current.isSelecting = true;
    render();
  }

  function updateRingSelection(event) {
    if (!vb().isSelecting) {
      return;
    }
    const record = getSelectedRecord();
    const base = resolveMapBase(record, event);
    if (!Number.isFinite(base)) {
      return;
    }
    vb().selectionFocus = base;
    // Only the map redraws while dragging; the base pane is rebuilt on release.
    renderMap(record);
  }

  function endRingSelection() {
    if (!vb().isSelecting) {
      return;
    }
    vb().isSelecting = false;
    render();
  }

  return {
    renderMap,
    resolveMapBase,
    renderSequencePane,
    syncControls,
    render,
    open,
    selectFeature,
    eventTargetsElement,
    deselectFeature,
    beginRingSelection,
    updateRingSelection,
    endRingSelection
  };
}

export { createVectorMapRendering };
