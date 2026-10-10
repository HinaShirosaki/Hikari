import { FALLBACK_CHAR_ADVANCE_PX } from '../constants.js';
import { resolveSequenceBoundaryFromEvent } from '../detail-layout.js';
import { createSequenceViewerSequenceEditingController } from '../detail-sequence-editing.js';
import { isPrimerBindingFeature } from '../feature-types.js';
import { attachMapHoverLabel } from './map-hover.js';
import { attachMapZoomGestures } from './map-zoom.js';
import { createVectorFeatureReplace } from './vector/feature-replace.js';
import { createVectorContextActions } from './vector/context-actions.js';
import { createVectorProteinConstruct } from './vector/protein-construct.js';
import { createVectorMapRendering } from './vector/map-rendering.js';
import { createVectorSelection } from './vector/selection.js';

// Element keys the reused detail sequence-editing controller reads, mapped onto
// the Vector Builder's own dialog. Reusing that controller (rather than forking
// it) is what keeps base editing identical across both workspaces.
const EDITING_ELEMENT_MAP = {
  sequenceEditOverlay: 'vectorBuilderSequenceEditOverlay',
  sequenceEditTitle: 'vectorBuilderSequenceEditTitle',
  sequenceEditNote: 'vectorBuilderSequenceEditNote',
  sequenceEditInputWrap: 'vectorBuilderSequenceEditInputWrap',
  sequenceEditTextarea: 'vectorBuilderSequenceEditTextarea',
  sequenceEditTagWrap: 'vectorBuilderSequenceEditTagWrap',
  sequenceEditTagSelect: 'vectorBuilderSequenceEditTagSelect',
  sequenceEditTagOptions: 'vectorBuilderSequenceEditTagOptions',
  sequenceEditTagOrfSelect: 'vectorBuilderSequenceEditTagOrfSelect',
  sequenceEditTagOrientation: 'vectorBuilderSequenceEditTagOrientation',
  sequenceEditTagPreview: 'vectorBuilderSequenceEditTagPreview',
  sequenceEditDeleteMessage: 'vectorBuilderSequenceEditDeleteMessage',
  sequenceEditConfirmBtn: 'vectorBuilderSequenceEditConfirm',
  // Typing must not open the base editor over the Replace Feature dialog.
  featureEditorOverlay: 'vectorBuilderFeatureReplaceOverlay'
};

function positionFloatingMenu(element, clientX, clientY) {
  if (!element?.style) {
    return;
  }
  const viewWidth = Number(globalThis?.innerWidth) || 0;
  const viewHeight = Number(globalThis?.innerHeight) || 0;
  const width = Number(element.offsetWidth) || 200;
  const height = Number(element.offsetHeight) || 200;
  const left = viewWidth ? Math.min(Math.max(8, clientX), Math.max(8, viewWidth - width - 8)) : Math.max(8, clientX);
  const top = viewHeight ? Math.min(Math.max(8, clientY), Math.max(8, viewHeight - height - 8)) : Math.max(8, clientY);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

// Primer binding sites mark where an oligo anneals; they are not construct
// parts, so they are neither replaceable targets nor usable replacements.
// Matches the canonical primer_bind type plus looser vendor spellings.
function isPrimerRelatedType(type) {
  return isPrimerBindingFeature(type) || /primer/i.test(String(type || ''));
}

function formatRangeLabel(range) {
  const start = Math.max(0, Math.round(Number(range?.start) || 0));
  const end = Math.max(start, Math.round(Number(range?.end) || start));
  if (end <= start) {
    return `position ${(start + 1).toLocaleString()}`;
  }
  return `${(start + 1).toLocaleString()}-${end.toLocaleString()} (${(end - start).toLocaleString()} bp)`;
}

export function createSequenceViewerVectorBuilderController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const setStatus = config?.setStatus || (() => {});
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onApplySequenceEdit = config?.onApplySequenceEdit || (async () => {});
  const onNavigateVectorBuilder = config?.onNavigateVectorBuilder || (() => {});
  const onReturnToDetail = config?.onReturnToDetail || (() => {});
  const onRequestCloningDesign = config?.onRequestCloningDesign || (() => {});
  const onRequestPrimerDesign = config?.onRequestPrimerDesign || (() => {});
  const onRequestProteinInsert = config?.onRequestProteinInsert || (() => {});
  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');

  function vb() {
    if (!state.vectorBuilder || typeof state.vectorBuilder !== 'object') {
      state.vectorBuilder = {
        selectedFeatureIndex: -1,
        selectionAnchor: null,
        selectionFocus: null,
        cursorBase: null,
        isSelecting: false,
        showCutters: false,
        insertTarget: null,
        sequenceLayout: null,
        zoom: 1
      };
    }
    return state.vectorBuilder;
  }

  // The cursor is workspace-local, so the shared sequence-edit controller reads
  // and writes the Vector Builder's own copy rather than the detail workspace's.
  const editingState = {
    get sequenceCursorBase() { return vb().cursorBase; },
    set sequenceCursorBase(value) { vb().cursorBase = value; }
  };

  const mapZoom = attachMapZoomGestures({
    host: () => elements.vectorBuilderMap,
    getZoom: () => vb().zoom,
    setZoom: (value) => {
      vb().zoom = value;
    }
  });

  const mapHover = attachMapHoverLabel({
    host: () => elements.vectorBuilderMap,
    rootDocument,
    getFeature: (index) => getFeatureByIndex(getSelectedRecord(), index),
    getSequence: () => getSelectedRecord()?.sequence || ''
  });

  const editingElements = {};
  Object.entries(EDITING_ELEMENT_MAP).forEach(([key, elementKey]) => {
    editingElements[key] = elements[elementKey];
  });


  const {
    getVisibleFeatures,
    getFeatureByIndex,
    clearSelection,
    getSelectionRange,
    hideContextMenu,
    getRecordedFeaturesInRange
  } = createVectorSelection({
    state,
    vb,
    elements,
    getFeatureRange: (feature, sequenceLength) => getFeatureRange(feature, sequenceLength),
    isPrimerRelatedType
  });

  const sequenceEditing = createSequenceViewerSequenceEditingController({
    rootDocument,
    elements: editingElements,
    state: editingState,
    getSelectedRecord,
    getSelectedFeature: (record) => getFeatureByIndex(record, vb().selectedFeatureIndex),
    getVisibleFeatures,
    // Keyboard edits target what the right-click menu would: a drag selection,
    // else the selected feature's span, else nothing (insert at the caret).
    getSequenceSelectionRange: (record) => {
      const range = getActionRange(record);
      return range && range.end > range.start ? range : null;
    },
    clearSequenceSelection: clearSelection,
    hideFeatureContextMenu: () => hideContextMenu(),
    renderSequence: () => render(),
    renderSelectedFeatureDetail: () => {},
    setStatus,
    onApplySequenceEdit
  });






  const {
    render,
    open,
    selectFeature,
    deselectFeature,
    beginRingSelection,
    updateRingSelection,
    endRingSelection,
    renderMap,
    eventTargetsElement
  } = createVectorMapRendering({
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
    hideOverlays: () => hideOverlays(),
    setStatus,
    onNavigateVectorBuilder
  });

  const {
    getFeatureRange,
    getActionRange,
    renderContextMenu,
    runContextAction
  } = createVectorContextActions({
    elements,
    vb,
    getSelectedRecord,
    getSelectionRange,
    getFeatureByIndex,
    hideContextMenu,
    hideOverlays: () => hideOverlays(),
    openFeatureReplaceDialog: (record, range) => openFeatureReplaceDialog(record, range),
    setStatus,
    sequenceEditing,
    formatRangeLabel,
    positionFloatingMenu,
    onRequestPrimerDesign,
    onRequestProteinInsert
  });

  const { applyProteinConstruct } = createVectorProteinConstruct({
    state,
    vb,
    getSelectedRecord,
    setStatus,
    persistFeatureMutation,
    onApplySequenceEdit,
    onNavigateVectorBuilder,
    clearSelection,
    hideOverlays: () => hideOverlays(),
    render: () => render()
  });

  const {
    getSelectedFeatureReplaceId,
    getSelectedStoredFeature,
    setFeatureReplaceStatus,
    hideFeatureReplaceDialog,
    selectFeatureReplaceResult,
    selectFeatureReplaceHost,
    runFeatureReplaceSearch,
    hideOverlays,
    openFeatureReplaceDialog,
    applyFeatureReplace
  } = createVectorFeatureReplace({
    elements,
    state,
    vb,
    getSelectedRecord,
    getBridge,
    getStoragePath,
    setStatus,
    persistFeatureMutation,
    onApplySequenceEdit,
    sequenceEditing,
    clearSelection,
    hideContextMenu,
    getFeatureByIndex,
    getFeatureRange,
    getRecordedFeaturesInRange,
    formatRangeLabel,
    isPrimerRelatedType,
    render: () => render()
  });

  function bindEvents() {
    elements.vectorBuilderBackBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      hideOverlays();
      onReturnToDetail();
    });

    elements.vectorBuilderCuttersToggle?.addEventListener('change', () => {
      vb().showCutters = Boolean(elements.vectorBuilderCuttersToggle.checked);
      vb().selectedFeatureIndex = -1;
      render();
    });

    // Shared with the detail workspace's own Primers box, so both stay in step.
    elements.vectorBuilderPrimersToggle?.addEventListener('change', () => {
      state.showPrimers = Boolean(elements.vectorBuilderPrimersToggle.checked);
      vb().selectedFeatureIndex = -1;
      if (elements.primersToggle) {
        elements.primersToggle.checked = state.showPrimers;
      }
      render();
    });

    elements.vectorBuilderCloningDesignBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      hideOverlays();
      onRequestCloningDesign();
    });

    elements.vectorBuilderProteinBuilderBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      // Standalone: clearing the target keeps the stored-backbone assembly path
      // available. Targeted inserts come from the map's right-click menu, which
      // also lets the user pick the 5' or 3' side.
      vb().insertTarget = null;
      hideOverlays();
      onRequestProteinInsert(null);
    });

    // Selection belongs to the feature glyph itself. Clicking any ordinary
    // workspace background or control removes the active outline; menus and
    // dialogs are exempt so their feature-dependent actions still work.
    elements.vectorBuilderWorkspace?.addEventListener('mousedown', (event) => {
      const button = Number(event?.button);
      if ((Number.isFinite(button) && button !== 0)
        || event.target?.closest?.('[data-feature-index]')) {
        return;
      }
      const featureInteractionSurfaces = [
        elements.vectorBuilderContextMenu,
        elements.vectorBuilderFeatureReplaceOverlay,
        elements.vectorBuilderSequenceEditOverlay
      ];
      if (featureInteractionSurfaces.some((element) => eventTargetsElement(event, element))) {
        return;
      }
      deselectFeature();
    });

    elements.vectorBuilderMap?.addEventListener('mousedown', (event) => {
      if (Number(event?.button) !== 0) {
        return;
      }
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (trigger) {
        selectFeature(Number(trigger.dataset.featureIndex));
        return;
      }
      event.preventDefault?.();
      hideContextMenu();
      beginRingSelection(event);
    });

    mapZoom.bind();
    mapHover.bind();

    elements.vectorBuilderMap?.addEventListener('mousemove', updateRingSelection);
    elements.vectorBuilderMap?.addEventListener('mouseup', endRingSelection);
    elements.vectorBuilderMap?.addEventListener('mouseleave', endRingSelection);

    // Keyboard/AT activation of a focused feature arc or label.
    elements.vectorBuilderMap?.addEventListener('keydown', (event) => {
      if (event?.key !== 'Enter' && event?.key !== ' ') {
        return;
      }
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (!trigger) {
        return;
      }
      event.preventDefault?.();
      selectFeature(Number(trigger.dataset.featureIndex));
    });

    elements.vectorBuilderSequence?.addEventListener('mousedown', (event) => {
      if (Number(event?.button) !== 0) {
        return;
      }
      const record = getSelectedRecord();
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (trigger) {
        selectFeature(Number(trigger.dataset.featureIndex));
        return;
      }
      const boundary = resolveSequenceBoundaryFromEvent(
        event,
        record,
        Number(vb().sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX
      );
      if (!Number.isFinite(boundary)) {
        return;
      }
      event.preventDefault?.();
      hideContextMenu();
      const current = vb();
      current.selectedFeatureIndex = -1;
      current.selectionAnchor = boundary;
      current.selectionFocus = boundary;
      current.cursorBase = boundary;
      current.isSelecting = true;
      render();
    });

    elements.vectorBuilderSequence?.addEventListener('mousemove', (event) => {
      if (!vb().isSelecting) {
        return;
      }
      const boundary = resolveSequenceBoundaryFromEvent(
        event,
        getSelectedRecord(),
        Number(vb().sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX
      );
      if (!Number.isFinite(boundary)) {
        return;
      }
      vb().selectionFocus = boundary;
      renderMap(getSelectedRecord());
    });

    elements.vectorBuilderSequence?.addEventListener('mouseup', endRingSelection);

    const handleContextMenu = (event) => {
      const record = getSelectedRecord();
      if (!record?.sequence?.length) {
        return;
      }
      if (vb().isSelecting) {
        vb().isSelecting = false;
      }
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (trigger) {
        const index = Number(trigger.dataset.featureIndex);
        if (Number.isFinite(index) && index !== vb().selectedFeatureIndex) {
          vb().selectedFeatureIndex = index;
          clearSelection({ preserveCursor: true });
          render();
        }
      }
      event.preventDefault?.();
      renderContextMenu(record, event);
    };

    elements.vectorBuilderMap?.addEventListener('contextmenu', handleContextMenu);
    elements.vectorBuilderSequence?.addEventListener('contextmenu', handleContextMenu);

    elements.vectorBuilderContextMenu?.addEventListener('click', (event) => {
      const action = String(
        event?.target?.closest?.('[data-vector-action]')?.dataset?.vectorAction || ''
      ).trim();
      if (action) {
        runContextAction(action);
      }
    });

    // Enter in the search box searches; a result and a source vector are picked
    // first, and Confirm is what rewrites the feature.
    elements.vectorBuilderFeatureReplaceForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void runFeatureReplaceSearch();
    });
    elements.vectorBuilderFeatureReplaceSearch?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault();
      void runFeatureReplaceSearch();
    });
    elements.vectorBuilderFeatureReplaceResults?.addEventListener('click', (event) => {
      const featureId = event.target?.closest?.('[data-vector-replace-feature-id]')
        ?.dataset?.vectorReplaceFeatureId;
      if (featureId) {
        selectFeatureReplaceResult(featureId);
      }
    });
    elements.vectorBuilderFeatureReplaceResults?.addEventListener('keydown', (event) => {
      const key = String(event?.key || '');
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') {
        return;
      }
      const featureId = event.target?.closest?.('[data-vector-replace-feature-id]')
        ?.dataset?.vectorReplaceFeatureId;
      if (featureId) {
        event.preventDefault?.();
        selectFeatureReplaceResult(featureId);
      }
    });
    elements.vectorBuilderFeatureReplaceHosts?.addEventListener('click', (event) => {
      const hostId = event.target?.closest?.('[data-vector-replace-host-id]')
        ?.dataset?.vectorReplaceHostId;
      if (hostId) {
        selectFeatureReplaceHost(hostId);
      }
    });
    elements.vectorBuilderFeatureReplaceConfirm?.addEventListener('click', (event) => {
      event.preventDefault();
      if (!getSelectedStoredFeature()) {
        setFeatureReplaceStatus('Pick a stored feature before confirming.', true);
        return;
      }
      void applyFeatureReplace(getSelectedFeatureReplaceId());
    });
    elements.vectorBuilderFeatureReplaceClose?.addEventListener('click', hideFeatureReplaceDialog);
    elements.vectorBuilderFeatureReplaceCancel?.addEventListener('click', hideFeatureReplaceDialog);

    elements.vectorBuilderSequenceEditForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void sequenceEditing.applySequenceEditDialog();
    });
    elements.vectorBuilderSequenceEditClose?.addEventListener('click', () => sequenceEditing.hideSequenceEditDialog());
    elements.vectorBuilderSequenceEditCancel?.addEventListener('click', () => sequenceEditing.hideSequenceEditDialog());

    // Same keyboard editing as the detail workspace: type to insert at the
    // caret or replace the selection, Delete/Backspace to remove it.
    rootDocument?.addEventListener?.('keydown', (event) => {
      if (state.localWorkspaceMode !== 'vector') {
        return;
      }
      if (String(event?.key || '') === 'Escape') {
        hideContextMenu();
        hideOverlays();
        return;
      }
      if (sequenceEditing.openSequenceEditFromKeyboardEvent(event)) {
        hideContextMenu();
      }
    });

    rootDocument?.addEventListener?.('click', (event) => {
      if (elements.vectorBuilderContextMenu?.hidden !== false) {
        return;
      }
      if (event.target?.closest?.('#sequence-viewer-vector-builder-context-menu')) {
        return;
      }
      hideContextMenu();
    });
  }

  return {
    applyProteinConstruct,
    bindEvents,
    clearInsertTarget: () => {
      vb().insertTarget = null;
    },
    getInsertTarget: () => vb().insertTarget,
    hideOverlays,
    open,
    render
  };
}
