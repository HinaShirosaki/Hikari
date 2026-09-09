import { escapeHtml } from '../../lib/html.js';
import { COMMON_SEQUENCE_FEATURE_TYPES } from './feature-types.js';
import { clamp, cleanText, normalizeRecordName } from './shared.js';
import { createPrimerDesignOverlay } from './detail-feature-editing/primer-design.js';
import {
  buildManualFeatureId,
  doesFeatureOverlapRange,
  formatBaseRangeLabel,
  getFeatureOverallRange,
  isFeatureEditable,
  positionFloatingUi,
  sanitizeFeatureType
} from './detail-feature-editing/feature-ranges.js';

export function createSequenceViewerFeatureEditingController(config = {}) {
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getVisibleFeaturesForRecord = config?.getVisibleFeaturesForRecord || (() => []);
  const getFeatureByIndexForRecord = config?.getFeatureByIndexForRecord || (() => null);
  const findFeatureIndexByIdentity = config?.findFeatureIndexByIdentity || (() => -1);
  const getSequenceSelectionRange = config?.getSequenceSelectionRange || (() => null);
  const clearSequenceSelection = config?.clearSequenceSelection || (() => {});
  const renderActiveRecord = config?.renderActiveRecord || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onRequestPrimerOrder = config?.onRequestPrimerOrder || (() => {});

  let featureEditorState = null;

  function populateFeatureTypeOptions() {
    if (!elements.featureEditorTypeOptions) {
      return;
    }
    elements.featureEditorTypeOptions.innerHTML = COMMON_SEQUENCE_FEATURE_TYPES
      .map((entry) => `<option value="${escapeHtml(entry.value)}" label="${escapeHtml(entry.label)}"></option>`)
      .join('');
  }

  populateFeatureTypeOptions();

  function hideFeatureContextMenu() {
    if (!elements.featureContextMenu) {
      return;
    }
    elements.featureContextMenu.hidden = true;
    elements.featureContextMenu.innerHTML = '';
  }

  function hideFeatureEditor() {
    featureEditorState = null;
    if (elements.featureEditorOverlay) {
      elements.featureEditorOverlay.hidden = true;
    }
  }

  function hidePrimerDesignOverlay() {
    if (elements.primerDesignOverlay) {
      elements.primerDesignOverlay.hidden = true;
    }
  }

  function resolveRecordFeatureContext(record, feature) {
    if (!record || !isFeatureEditable(feature)) {
      return null;
    }
    const recordFeatures = Array.isArray(record?.features) ? record.features : [];
    const recordFeatureIndex = findFeatureIndexByIdentity(recordFeatures, feature);
    if (recordFeatureIndex < 0) {
      return null;
    }
    return {
      feature: recordFeatures[recordFeatureIndex],
      recordFeatureIndex
    };
  }

  function resolveSelectionFeatureContext(record, selectionRange) {
    if (!record || !selectionRange) {
      return null;
    }
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const candidates = (Array.isArray(record?.features) ? record.features : [])
      .map((feature, recordFeatureIndex) => ({
        feature,
        recordFeatureIndex,
        overallRange: getFeatureOverallRange(feature, sequenceLength)
      }))
      .filter(({ feature }) => isFeatureEditable(feature))
      .filter(({ feature }) => doesFeatureOverlapRange(feature, selectionRange));
    if (!candidates.length) {
      return null;
    }

    const exact = candidates.filter(({ overallRange }) => (
      overallRange
      && overallRange.start === selectionRange.start
      && overallRange.end === selectionRange.end
    ));
    if (exact.length === 1) {
      return exact[0];
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    return null;
  }

  function getSelectedEditableFeatureContext(record) {
    return resolveRecordFeatureContext(record, getFeatureByIndexForRecord(record, state.selectedFeatureIndex));
  }

  function buildSelectionDetailHtml(record) {
    const selectionRange = getSequenceSelectionRange(record);
    if (!selectionRange) {
      return '<p class="small-note">Select a feature in the bottom track to view details.</p>';
    }
    const editableContext = resolveSelectionFeatureContext(record, selectionRange);
    const guidance = editableContext
      ? `Right-click the highlighted sequence to add a feature or edit/delete ${editableContext.feature?.name || 'the overlapping feature'}.`
      : 'Right-click the highlighted sequence to add a feature.';
    return `
      <p><strong>Selection:</strong> ${escapeHtml(formatBaseRangeLabel(selectionRange))}</p>
      <p class="small-note">${escapeHtml(guidance)}</p>
    `;
  }


  const { openPrimerDesignOverlay, getDesignedPrimers } = createPrimerDesignOverlay({
    state,
    elements,
    getSelectedRecord,
    setStatus,
    renderActiveRecord,
    persistFeatureMutation,
    hideFeatureContextMenu
  });

  function renderFeatureContextMenu(context, event) {
    if (!elements.featureContextMenu) {
      return;
    }
    const selectionLabel = context?.selectionRange ? formatBaseRangeLabel(context.selectionRange) : '';
    const featureName = cleanText(context?.featureContext?.feature?.name, 120) || 'feature';
    elements.featureContextMenu.innerHTML = `
      ${selectionLabel ? `<p class="small-note">${escapeHtml(selectionLabel)}</p>` : ''}
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="add"${context?.selectionRange ? '' : ' disabled'}>Add Feature</button>
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="design-primer">Design Primer</button>
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="edit"${context?.featureContext ? '' : ' disabled'}>Edit ${escapeHtml(featureName)}</button>
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="delete"${context?.featureContext ? '' : ' disabled'}>Delete ${escapeHtml(featureName)}</button>
    `;
    elements.featureContextMenu.hidden = false;
    positionFloatingUi(elements.featureContextMenu, Number(event?.clientX) + 4, Number(event?.clientY) + 4);
  }

  function resolveFeatureActionContext(record, event) {
    const visibleFeatures = getVisibleFeaturesForRecord(record);
    const clickedFeatureIndex = Number(
      event?.target?.closest?.('[data-feature-index]')?.dataset?.featureIndex
    );
    let featureContext = null;
    if (Number.isFinite(clickedFeatureIndex) && clickedFeatureIndex >= 0) {
      featureContext = resolveRecordFeatureContext(record, visibleFeatures[clickedFeatureIndex] || null);
    }

    const selectionRange = getSequenceSelectionRange(record);
    if (!featureContext && selectionRange) {
      featureContext = resolveSelectionFeatureContext(record, selectionRange);
    }
    if (!featureContext && !selectionRange) {
      featureContext = getSelectedEditableFeatureContext(record);
    }

    return {
      selectionRange,
      featureContext
    };
  }

  function openFeatureEditor(mode, context = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before editing features.', true);
      return;
    }
    if (mode !== 'add' && mode !== 'edit') {
      return;
    }

    const sequenceLength = Math.max(0, Number(record.sequence.length) || 0);
    const selectionRange = context?.selectionRange || null;
    const featureContext = context?.featureContext || null;
    const feature = featureContext?.feature || null;
    const originalRange = getFeatureOverallRange(feature, sequenceLength);
    const range = selectionRange || originalRange;

    if (!range) {
      setStatus('Select a sequence range before adding or editing a feature.', true);
      return;
    }
    if (mode === 'edit' && !featureContext) {
      setStatus('Select an editable feature before editing.', true);
      return;
    }

    const suggestedName = mode === 'edit'
      ? normalizeRecordName(feature?.name || 'feature', 'feature')
      : normalizeRecordName(`feature_${(Array.isArray(record?.features) ? record.features.length : 0) + 1}`, 'feature');
    const note = mode === 'edit'
      ? (selectionRange
        ? `Editing ${feature?.name || 'feature'} with the currently selected range ${formatBaseRangeLabel(selectionRange)}.`
        : `Editing ${feature?.name || 'feature'} at ${formatBaseRangeLabel(originalRange)}.`)
      : `Creating a feature for the selected range ${formatBaseRangeLabel(range)}.`;

    featureEditorState = {
      mode,
      recordFeatureIndex: Number(featureContext?.recordFeatureIndex),
      hadSelectionRange: Boolean(selectionRange),
      originalRange
    };

    if (elements.featureEditorTitle) {
      elements.featureEditorTitle.textContent = mode === 'edit' ? 'Edit Feature' : 'Add Feature';
    }
    if (elements.featureEditorNote) {
      elements.featureEditorNote.textContent = note;
    }
    if (elements.featureEditorNameInput) {
      elements.featureEditorNameInput.value = suggestedName;
    }
    if (elements.featureEditorTypeInput) {
      elements.featureEditorTypeInput.value = sanitizeFeatureType(feature?.type || 'misc_feature');
    }
    if (elements.featureEditorStrandSelect) {
      elements.featureEditorStrandSelect.value = String(feature?.strand === -1 ? -1 : 1);
    }
    if (elements.featureEditorStartInput) {
      elements.featureEditorStartInput.value = String(Math.max(1, range.start + 1));
      elements.featureEditorStartInput.min = '1';
      elements.featureEditorStartInput.max = String(Math.max(1, sequenceLength));
    }
    if (elements.featureEditorEndInput) {
      elements.featureEditorEndInput.value = String(Math.max(1, range.end));
      elements.featureEditorEndInput.min = '1';
      elements.featureEditorEndInput.max = String(Math.max(1, sequenceLength));
    }
    if (elements.featureEditorDescriptionInput) {
      elements.featureEditorDescriptionInput.value = String(feature?.description || '');
    }

    hideFeatureContextMenu();
    if (elements.featureEditorOverlay) {
      elements.featureEditorOverlay.hidden = false;
    }
    elements.featureEditorNameInput?.focus?.();
  }

  function readFeatureEditorPayload(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const startBase = clamp(
      Math.round(Number(elements.featureEditorStartInput?.value) || 0),
      1,
      Math.max(1, sequenceLength)
    );
    const endBase = clamp(
      Math.round(Number(elements.featureEditorEndInput?.value) || 0),
      1,
      Math.max(1, sequenceLength)
    );
    if (endBase < startBase) {
      throw new Error('Feature end must be greater than or equal to the start.');
    }

    return {
      name: normalizeRecordName(elements.featureEditorNameInput?.value || 'feature', 'feature'),
      type: sanitizeFeatureType(elements.featureEditorTypeInput?.value || 'misc_feature'),
      strand: String(elements.featureEditorStrandSelect?.value || '1') === '-1' ? -1 : 1,
      description: cleanText(elements.featureEditorDescriptionInput?.value || '', 4000),
      range: {
        start: startBase - 1,
        end: endBase
      }
    };
  }

  async function applyFeatureEditorChanges() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length || !featureEditorState) {
      return;
    }

    let payload;
    try {
      payload = readFeatureEditorPayload(record);
    } catch (error) {
      setStatus(error?.message || 'Feature details are invalid.', true);
      return;
    }

    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[selectedIndex];
    if (!current) {
      setStatus('Selected record no longer exists.', true);
      return;
    }

    const nextFeatures = Array.isArray(current.features) ? [...current.features] : [];
    let updatedFeature = null;
    let actionLabel = 'Updated feature.';

    if (featureEditorState.mode === 'edit') {
      const targetIndex = Number(featureEditorState.recordFeatureIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= nextFeatures.length) {
        setStatus('Feature is no longer available for editing.', true);
        return;
      }

      const previousFeature = nextFeatures[targetIndex] || {};
      const preserveSegments = Boolean(
        !featureEditorState.hadSelectionRange
        && featureEditorState.originalRange
        && payload.range.start === featureEditorState.originalRange.start
        && payload.range.end === featureEditorState.originalRange.end
      );
      const nextSegments = preserveSegments
        ? (Array.isArray(previousFeature?.segments) ? previousFeature.segments : [])
        : [{ start: payload.range.start, end: payload.range.end }];
      updatedFeature = {
        ...previousFeature,
        name: payload.name,
        type: payload.type,
        strand: payload.strand,
        description: payload.description,
        segments: nextSegments,
        locationText: ''
      };
      if (
        payload.type !== previousFeature?.type
        || payload.strand !== previousFeature?.strand
        || !preserveSegments
      ) {
        delete updatedFeature.translation;
        delete updatedFeature.proteinSequence;
      }
      nextFeatures[targetIndex] = updatedFeature;
      actionLabel = `Updated feature ${updatedFeature.name}.`;
    } else {
      updatedFeature = {
        id: buildManualFeatureId(payload.type),
        name: payload.name,
        type: payload.type,
        strand: payload.strand,
        description: payload.description,
        source: 'manual',
        locationText: '',
        segments: [{ start: payload.range.start, end: payload.range.end }]
      };
      nextFeatures.push(updatedFeature);
      actionLabel = `Added feature ${updatedFeature.name}.`;
    }

    current.features = nextFeatures;
    state.records = nextRecords;
    clearSequenceSelection();
    state.selectedFeatureIndex = findFeatureIndexByIdentity(getVisibleFeaturesForRecord(current), updatedFeature);

    hideFeatureEditor();
    renderActiveRecord();
    await persistFeatureMutation(current, actionLabel);
  }

  async function deleteFeatureFromContext(context = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      return;
    }

    const recordFeatureIndex = Number(context?.featureContext?.recordFeatureIndex);
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[selectedIndex];
    if (!current) {
      return;
    }

    const nextFeatures = Array.isArray(current.features) ? [...current.features] : [];
    if (!Number.isFinite(recordFeatureIndex) || recordFeatureIndex < 0 || recordFeatureIndex >= nextFeatures.length) {
      setStatus('Select an editable feature before deleting.', true);
      return;
    }

    const [removedFeature] = nextFeatures.splice(recordFeatureIndex, 1);
    current.features = nextFeatures;
    state.records = nextRecords;
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    hideFeatureContextMenu();
    hideFeatureEditor();
    // Deleting clears the selection, so without this the sequence pane would
    // scroll back to base 1 instead of staying where the feature was.
    renderActiveRecord({ preserveScroll: true });
    await persistFeatureMutation(current, `Deleted feature ${removedFeature?.name || 'feature'}.`);
  }

  return {
    orderDesignedPrimers: () => onRequestPrimerOrder(getDesignedPrimers()),
    applyFeatureEditorChanges,
    buildSelectionDetailHtml,
    deleteFeatureFromContext,
    hideFeatureContextMenu,
    hideFeatureEditor,
    hidePrimerDesignOverlay,
    openPrimerDesignOverlay,
    openFeatureEditor,
    renderFeatureContextMenu,
    resolveFeatureActionContext
  };
}
