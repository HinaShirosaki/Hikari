import { escapeHtml } from '../../lib/html.js';
import { designPcrPrimerPair } from './cloning-assembly.js';
import {
  COMMON_SEQUENCE_FEATURE_TYPES,
  normalizeFeatureType
} from './feature-types.js';
import { cleanText, clamp, normalizeRecordName, normalizeSequenceText } from './shared.js';
import { isOrfFeature } from './orf-analysis.js';
import { renderPrimerCopyButton } from './primer-copy.js';
import { annotatePrimersOnSelectedRecord } from './primer-annotation.js';

function sanitizeFeatureType(type) {
  return normalizeFeatureType(type, 'misc_feature');
}

function buildManualFeatureId(type) {
  const prefix = sanitizeFeatureType(type).slice(0, 24) || 'feature';
  const stamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8) || 'feature';
  return `manual_${prefix}_${stamp}_${randomPart}`;
}

function formatBaseRangeLabel(range) {
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.max(start, Number(range?.end) || start);
  const length = Math.max(0, end - start);
  if (!length) {
    return '-';
  }
  return `${(start + 1).toLocaleString()}..${end.toLocaleString()} (${length.toLocaleString()} bp)`;
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }
  return number.toFixed(digits);
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function getFeatureOverallRange(feature, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  const segments = (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, safeLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, safeLength)
    }))
    .filter((segment) => segment.end > segment.start);
  if (!segments.length) {
    return null;
  }
  return {
    start: Math.min(...segments.map((segment) => segment.start)),
    end: Math.max(...segments.map((segment) => segment.end))
  };
}

function doesFeatureOverlapRange(feature, range) {
  if (!feature || !range) {
    return false;
  }
  return (Array.isArray(feature?.segments) ? feature.segments : []).some((segment) => (
    (Number(segment?.start) || 0) < range.end
    && range.start < (Number(segment?.end) || 0)
  ));
}

function isFeatureEditable(feature) {
  if (!feature || typeof feature !== 'object') {
    return false;
  }
  if (String(feature?.type || '').toLowerCase() === 'restriction_site') {
    return false;
  }
  return !isOrfFeature(feature);
}

function positionFloatingUi(element, clientX, clientY) {
  if (!element?.style) {
    return;
  }

  const rawX = Number(clientX);
  const rawY = Number(clientY);
  const fallbackX = Number.isFinite(rawX) ? rawX : 16;
  const fallbackY = Number.isFinite(rawY) ? rawY : 16;
  element.style.left = `${Math.max(8, fallbackX)}px`;
  element.style.top = `${Math.max(8, fallbackY)}px`;

  if (typeof element.getBoundingClientRect !== 'function') {
    return;
  }

  const rect = element.getBoundingClientRect();
  const viewportWidth = Number(globalThis?.innerWidth) || 0;
  const viewportHeight = Number(globalThis?.innerHeight) || 0;
  if (!viewportWidth && !viewportHeight) {
    return;
  }

  const left = viewportWidth > 0
    ? Math.max(8, Math.min(fallbackX, viewportWidth - rect.width - 8))
    : Math.max(8, fallbackX);
  const top = viewportHeight > 0
    ? Math.max(8, Math.min(fallbackY, viewportHeight - rect.height - 8))
    : Math.max(8, fallbackY);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

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

  function renderPrimerDesignTable(primers = []) {
    if (!primers.length) {
      return '<p class="small-note">No primer pair was generated for this sequence.</p>';
    }

    return `
      <div class="sequence-viewer-cloning-design-primer-table-wrap">
        <table class="sequence-viewer-cloning-design-primer-table">
          <thead>
            <tr>
              <th>Primer</th>
              <th>Role</th>
              <th>Sequence</th>
              <th>Length</th>
              <th>Tm</th>
              <th>GC</th>
            </tr>
          </thead>
          <tbody>
            ${primers.map((primer, index) => {
              const sequence = normalizeSequenceText(primer?.sequence || '');
              const primerName = cleanText(primer?.name, 160) || `Primer ${index + 1}`;
              return `
                <tr>
                  <td>
                    <div class="sequence-viewer-primer-copy-cell">
                      <span class="sequence-viewer-primer-copy-value">${escapeHtml(primerName)}</span>
                      ${renderPrimerCopyButton(primerName, 'name', 'primer name')}
                    </div>
                  </td>
                  <td>${escapeHtml(formatPrimerRole(primer?.role))}</td>
                  <td class="sequence-viewer-cloning-design-primer-seq">
                    <div class="sequence-viewer-primer-copy-cell sequence-viewer-primer-copy-cell-sequence">
                      <span class="sequence-viewer-primer-copy-value">${escapeHtml(sequence || '-')}</span>
                      ${renderPrimerCopyButton(sequence, 'sequence', 'primer sequence')}
                    </div>
                  </td>
                  <td>${Math.max(0, Number(primer?.length) || sequence.length).toLocaleString()} nt</td>
                  <td>${escapeHtml(formatNumber(primer?.tm, 1))} C</td>
                  <td>${escapeHtml(formatNumber(primer?.gcContent, 1))}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPrimerDesignWarnings(warnings = []) {
    const safeWarnings = (Array.isArray(warnings) ? warnings : [])
      .map((warning) => cleanText(warning, 500))
      .filter(Boolean);
    if (!safeWarnings.length) {
      return '';
    }
    return `
      <div class="sequence-viewer-primer-design-warnings">
        ${safeWarnings.map((warning) => `<p class="small-note sequence-viewer-primer-design-warning">${escapeHtml(warning)}</p>`).join('')}
      </div>
    `;
  }

  function resolvePrimerDesignTarget(record, context = {}) {
    const sequence = normalizeSequenceText(record?.sequence || '');
    if (!sequence.length) {
      return null;
    }

    const sequenceLength = sequence.length;
    const feature = context?.featureContext?.feature || null;
    const selectionRange = context?.selectionRange || null;
    const featureRange = getFeatureOverallRange(feature, sequenceLength);
    const sourceRange = selectionRange || featureRange;
    if (!sourceRange) {
      return null;
    }

    const start = clamp(Math.round(Number(sourceRange.start) || 0), 0, sequenceLength);
    const end = clamp(Math.round(Number(sourceRange.end) || start), start, sequenceLength);
    if (end <= start) {
      return null;
    }

    const featureName = cleanText(feature?.name, 160);
    const rangeLabel = formatBaseRangeLabel({ start, end });
    return {
      start,
      end,
      rangeLabel,
      label: featureName ? `${featureName} - ${rangeLabel}` : `Selection - ${rangeLabel}`,
      primerBaseName: normalizeRecordName(featureName || `selection_${start + 1}_${end}`, 'selection'),
      sequence: sequence.slice(start, end)
    };
  }

  function openPrimerDesignOverlay(context = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before designing primers.', true);
      return;
    }

    const target = resolvePrimerDesignTarget(record, context);
    if (!target) {
      setStatus('Select a sequence range or feature before designing primers.', true);
      return;
    }

    const primerPlan = designPcrPrimerPair(target.sequence, {
      name: target.primerBaseName
    });
    const primers = Array.isArray(primerPlan?.primers) ? primerPlan.primers : [];
    const thresholdLabel = cleanText(primerPlan?.selectedThresholdLevel, 80) || 'none';

    if (elements.primerDesignTitle) {
      elements.primerDesignTitle.textContent = 'Designed Primers';
    }
    if (elements.primerDesignNote) {
      elements.primerDesignNote.textContent = `PCR primer pair for ${target.label}.`;
    }
    if (elements.primerDesignResult) {
      elements.primerDesignResult.innerHTML = `
        <div class="sequence-viewer-primer-design-summary">
          <p><strong>Template:</strong> ${escapeHtml(target.label)}</p>
          <p><strong>Selected sequence:</strong> ${target.sequence.length.toLocaleString()} bp</p>
          <p><strong>Threshold profile:</strong> ${escapeHtml(thresholdLabel)}</p>
        </div>
        ${renderPrimerDesignTable(primers)}
        ${renderPrimerDesignWarnings(primerPlan?.warnings)}
      `;
    }

    hideFeatureContextMenu();
    if (elements.primerDesignOverlay) {
      elements.primerDesignOverlay.hidden = false;
    }
    elements.primerDesignCloseBtn?.focus?.();

    // Returned so a caller in another workspace can re-render once the primers
    // are on the record.
    return (async () => {
      const placed = await annotatePrimersOnSelectedRecord({
        state,
        primers,
        persistFeatureMutation,
        label: `Annotated ${primers.length} designed primer${primers.length === 1 ? '' : 's'} on the sequence.`
      });
      if (placed) {
        renderActiveRecord();
      }
    })();
  }

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
    renderActiveRecord();
    await persistFeatureMutation(current, `Deleted feature ${removedFeature?.name || 'feature'}.`);
  }

  return {
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
