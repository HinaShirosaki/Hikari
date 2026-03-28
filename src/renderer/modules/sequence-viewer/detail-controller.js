import { escapeHtml } from '../tool-box/common.js';
import {
  DEFAULT_SEQUENCE_LINE_LENGTH,
  DUAL_STRAND_SCROLL_STEP,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  FEATURE_TOOLTIP_OFFSET_PX
} from './constants.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  getRenderableFeaturesForRecord,
  hashTypeToColor
} from './feature-model.js';
import {
  buildSelectedOrfTranslationContext,
  isOrfFeature
} from './orf-analysis.js';
import { summarizeFastqQuality } from './parsing.js';
import {
  formatSelectedFeatureDetailHtml,
  normalizeHighlightSegments,
  renderDualStrandSequenceLinesHtml
} from './rendering.js';
import { normalizeRestrictionVendorFilter } from './restriction-analysis.js';
import {
  cleanText,
  clamp,
  computeGcPercent,
  countAmbiguousBases,
  normalizeRecordName,
  parseCssPixels
} from './shared.js';
import { normalizeOrfStopCodonVisibility } from './translation-style.js';

export function createSequenceViewerDetailController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};

  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const updateMessages = config?.updateMessages || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onRequestAnnotation = config?.onRequestAnnotation || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestClear = config?.onRequestClear || (() => {});
  const onRequestSave = config?.onRequestSave || (() => {});
  const onNavigateHome = config?.onNavigateHome || (() => {});
  const onRefreshLibraryEntries = config?.onRefreshLibraryEntries || (() => {});

  const sequenceHoverTooltip = (() => {
    if (
      !rootDocument
      || typeof rootDocument.createElement !== 'function'
      || !rootDocument.body
      || typeof rootDocument.body.appendChild !== 'function'
    ) {
      return null;
    }
    const tooltip = rootDocument.createElement('div');
    tooltip.className = 'sequence-viewer-feature-hover-tooltip';
    tooltip.hidden = true;
    rootDocument.body.appendChild(tooltip);
    return tooltip;
  })();

  let featureContextMenuState = null;
  let featureEditorState = null;

  function getVisibleFeaturesForRecord(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: state.orfViewEnabled,
      restrictionVendorFilter: state.restrictionVendorFilter
    });
  }

  function getFeatureByIndexForRecord(record, index) {
    if (!record || !Number.isFinite(index) || index < 0) {
      return null;
    }
    const features = getVisibleFeaturesForRecord(record);
    return features[index] || null;
  }

  function findFeatureIndexByIdentity(features, feature) {
    if (!Array.isArray(features) || !features.length || !feature) {
      return -1;
    }

    const featureId = cleanText(feature.id, 240);
    if (featureId) {
      const byId = features.findIndex((item) => cleanText(item?.id, 240) === featureId);
      if (byId >= 0) {
        return byId;
      }
    }

    const source = cleanText(feature.source, 120);
    const name = cleanText(feature.name, 240);
    const type = cleanText(feature.type, 120);
    const strand = feature?.strand === -1 ? -1 : 1;
    const segmentKey = (Array.isArray(feature?.segments) ? feature.segments : [])
      .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
      .join(',');

    return features.findIndex((item) => {
      if (!item) {
        return false;
      }
      const itemSegmentKey = (Array.isArray(item?.segments) ? item.segments : [])
        .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
        .join(',');
      return cleanText(item.source, 120) === source
        && cleanText(item.name, 240) === name
        && cleanText(item.type, 120) === type
        && (item?.strand === -1 ? -1 : 1) === strand
        && itemSegmentKey === segmentKey;
    });
  }

  function hideSequenceHoverTooltip() {
    if (sequenceHoverTooltip) {
      sequenceHoverTooltip.hidden = true;
    }
  }

  function buildFeatureHoverTooltipHtml(feature, sequenceLength) {
    const strand = feature?.strand === -1 ? '-' : '+';
    const location = buildFeatureLocationText(feature, sequenceLength);
    const identity = Number.isFinite(feature?.identity) ? `${feature.identity.toFixed(2)}%` : '';
    const coverage = Number.isFinite(feature?.coverage) ? `${feature.coverage.toFixed(2)}%` : '';
    const source = String(feature?.mode || feature?.source || '-');
    const meta = [identity ? `Identity ${identity}` : '', coverage ? `Coverage ${coverage}` : '', source]
      .filter(Boolean)
      .join(' | ');

    return `
      <p class="sequence-viewer-feature-hover-title">${escapeHtml(feature?.name || '-')}</p>
      <p>${escapeHtml(feature?.type || '-')} | Strand ${strand}</p>
      <p>${escapeHtml(location)}</p>
      <p>${escapeHtml(meta)}</p>
    `;
  }

  function showSequenceHoverTooltip(event, feature, sequenceLength) {
    if (!sequenceHoverTooltip || !feature) {
      return;
    }

    sequenceHoverTooltip.innerHTML = buildFeatureHoverTooltipHtml(feature, sequenceLength);
    sequenceHoverTooltip.hidden = false;

    const rawX = Number(event?.clientX);
    const rawY = Number(event?.clientY);
    const startX = Number.isFinite(rawX) ? rawX + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const startY = Number.isFinite(rawY) ? rawY + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const tooltipRect = sequenceHoverTooltip.getBoundingClientRect();
    const viewportWidth = Number(globalThis?.innerWidth) || 0;
    const viewportHeight = Number(globalThis?.innerHeight) || 0;

    let left = Math.max(8, startX);
    let top = Math.max(8, startY);

    if (viewportWidth > 0) {
      left = Math.min(left, Math.max(8, viewportWidth - tooltipRect.width - 8));
    }
    if (viewportHeight > 0) {
      top = Math.min(top, Math.max(8, viewportHeight - tooltipRect.height - 8));
    }

    sequenceHoverTooltip.style.left = `${left}px`;
    sequenceHoverTooltip.style.top = `${top}px`;
  }

  function measureSequenceTypography() {
    let charAdvancePx = FALLBACK_CHAR_ADVANCE_PX;
    let lineHeightPx = FALLBACK_SEQUENCE_LINE_HEIGHT_PX;

    if (rootDocument && elements.sequenceHost && typeof elements.sequenceHost.appendChild === 'function') {
      let probe = null;
      try {
        probe = rootDocument.createElement('span');
        probe.className = 'sequence-viewer-seq-text';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.whiteSpace = 'nowrap';
        probe.style.display = 'inline-block';
        probe.style.width = 'auto';
        const sampleLength = 40;
        probe.textContent = 'A'.repeat(sampleLength);
        elements.sequenceHost.appendChild(probe);

        const measuredAdvance = probe.getBoundingClientRect().width / sampleLength;
        if (Number.isFinite(measuredAdvance) && measuredAdvance > 0) {
          charAdvancePx = measuredAdvance;
        }

        if (typeof globalThis.getComputedStyle === 'function') {
          const computed = globalThis.getComputedStyle(probe);
          const measuredLineHeight = parseCssPixels(computed?.lineHeight);
          if (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0) {
            lineHeightPx = measuredLineHeight;
          } else {
            const measuredFontSize = parseCssPixels(computed?.fontSize);
            if (Number.isFinite(measuredFontSize) && measuredFontSize > 0) {
              lineHeightPx = measuredFontSize * 1.35;
            }
          }
        }
      } catch {
        // Keep fallback typography metrics.
      } finally {
        probe?.remove?.();
      }
    }

    return {
      charAdvancePx: Math.max(1, charAdvancePx),
      lineHeightPx: Math.max(8, lineHeightPx)
    };
  }

  function computeSequenceLayoutMetrics() {
    const typography = measureSequenceTypography();
    const fallbackFeatureOffsetPx = DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX;
    if (!elements.sequenceHost || typeof elements.sequenceHost.clientWidth !== 'number') {
      return {
        lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
        charAdvancePx: typography.charAdvancePx,
        lineHeightPx: typography.lineHeightPx,
        lineFeatureOffsetPx: fallbackFeatureOffsetPx
      };
    }

    const hostWidth = Math.max(0, elements.sequenceHost.clientWidth);
    if (!hostWidth) {
      return {
        lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
        charAdvancePx: typography.charAdvancePx,
        lineHeightPx: typography.lineHeightPx,
        lineFeatureOffsetPx: fallbackFeatureOffsetPx
      };
    }

    const compact = hostWidth <= 640;
    const coordColumn = compact ? 58 : 74;
    const dualGap = compact ? 8 : 10;
    const strandEndColumn = compact ? 24 : 28;
    const strandEndGap = DEFAULT_STRAND_COLUMN_GAP_PX;
    const lineFeatureOffsetPx = strandEndColumn + strandEndGap;

    let hostPadding = 0;
    if (typeof globalThis.getComputedStyle === 'function') {
      const computed = globalThis.getComputedStyle(elements.sequenceHost);
      hostPadding = parseCssPixels(computed?.paddingLeft) + parseCssPixels(computed?.paddingRight);
    }

    const usableWidth = Math.max(
      120,
      hostWidth - hostPadding - coordColumn - dualGap - (strandEndColumn * 2) - (strandEndGap * 2) - 12
    );
    const lineLength = clamp(Math.floor(usableWidth / Math.max(4.2, typography.charAdvancePx)), 24, 280);

    return {
      lineLength,
      charAdvancePx: typography.charAdvancePx,
      lineHeightPx: typography.lineHeightPx,
      lineFeatureOffsetPx
    };
  }

  function sanitizeFeatureType(type) {
    const cleaned = String(type || 'misc_feature')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || 'misc_feature';
  }

  function buildManualFeatureId(type) {
    const prefix = sanitizeFeatureType(type).slice(0, 24) || 'feature';
    const stamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 8) || 'feature';
    return `manual_${prefix}_${stamp}_${randomPart}`;
  }

  function clearSequenceSelection(options = {}) {
    const preserveCursor = Boolean(options?.preserveCursor);
    state.sequenceSelectionAnchor = null;
    state.sequenceSelectionFocus = null;
    state.isSelectingSequence = false;
    if (!preserveCursor) {
      state.sequenceCursorBase = null;
    }
  }

  function getSequenceSelectionSegments(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return [];
    }

    const anchor = Number(state.sequenceSelectionAnchor);
    const focus = Number(state.sequenceSelectionFocus);
    if (!Number.isFinite(anchor) || !Number.isFinite(focus)) {
      return [];
    }

    const start = clamp(Math.min(anchor, focus), 0, sequenceLength);
    const end = clamp(Math.max(anchor, focus), 0, sequenceLength);
    if (end <= start) {
      return [];
    }
    return [{ start, end }];
  }

  function getSequenceSelectionRange(record) {
    return getSequenceSelectionSegments(record)[0] || null;
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

  function hideFeatureContextMenu() {
    featureContextMenuState = null;
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

  function renderFeatureContextMenu(context, event) {
    if (!elements.featureContextMenu) {
      return;
    }
    const selectionLabel = context?.selectionRange ? formatBaseRangeLabel(context.selectionRange) : '';
    const featureName = cleanText(context?.featureContext?.feature?.name, 120) || 'feature';
    featureContextMenuState = context;
    elements.featureContextMenu.innerHTML = `
      ${selectionLabel ? `<p class="small-note">${escapeHtml(selectionLabel)}</p>` : ''}
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="add"${context?.selectionRange ? '' : ' disabled'}>Add Feature</button>
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
      updatedFeature = {
        ...previousFeature,
        name: payload.name,
        type: payload.type,
        strand: payload.strand,
        description: payload.description,
        segments: preserveSegments
          ? (Array.isArray(previousFeature?.segments) ? previousFeature.segments : [])
          : [{ start: payload.range.start, end: payload.range.end }],
        locationText: ''
      };
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

  function resolveSequenceBoundaryFromEvent(event, record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return null;
    }

    const target = event?.target;
    const lineElement = target?.closest?.('.sequence-viewer-dual-line') || null;
    if (!lineElement) {
      return null;
    }

    const lineStart = Number(lineElement?.dataset?.lineStart);
    const lineEnd = Number(lineElement?.dataset?.lineEnd);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineEnd <= lineStart) {
      return null;
    }

    const lineSpan = lineEnd - lineStart;
    const seqTextElement = lineElement.querySelector?.('.sequence-viewer-strand-row-top .sequence-viewer-seq-text');
    const rawX = Number(event?.clientX);
    const safeAdvance = Math.max(1, Number(state.sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);

    let relativeX = null;
    if (seqTextElement && Number.isFinite(rawX) && typeof seqTextElement.getBoundingClientRect === 'function') {
      const rect = seqTextElement.getBoundingClientRect();
      if (Number.isFinite(rect?.left) && Number.isFinite(rect?.width) && rect.width > 0) {
        relativeX = clamp(rawX - rect.left, 0, rect.width);
      }
    }

    if (!Number.isFinite(relativeX)) {
      const fallbackOffsetX = Number(event?.offsetX);
      if (Number.isFinite(fallbackOffsetX)) {
        relativeX = Math.max(0, fallbackOffsetX);
      }
    }
    if (!Number.isFinite(relativeX)) {
      return null;
    }

    const localBoundary = clamp(Math.round(relativeX / safeAdvance), 0, lineSpan);
    return clamp(lineStart + localBoundary, 0, sequenceLength);
  }

  function syncAnnotateButtonState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    if (elements.annotateBtn) {
      elements.annotateBtn.disabled = state.isAnnotating || !hasRecord;
    }
    if (elements.recognizeBackboneBtn) {
      elements.recognizeBackboneBtn.disabled = !hasRecord || !hasStoragePath() || Boolean(state.isRecognizingBackbone);
    }
    if (elements.saveBtn) {
      elements.saveBtn.disabled = !hasRecord || !hasStoragePath();
    }
  }

  function syncOrfToggleState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    const stopVisibility = normalizeOrfStopCodonVisibility(state.orfStopVisibility);
    if (elements.orfToggle) {
      elements.orfToggle.checked = Boolean(state.orfViewEnabled);
      elements.orfToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTagToggle) {
      elements.orfStopTagToggle.checked = Boolean(stopVisibility.TAG);
      elements.orfStopTagToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTaaToggle) {
      elements.orfStopTaaToggle.checked = Boolean(stopVisibility.TAA);
      elements.orfStopTaaToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTgaToggle) {
      elements.orfStopTgaToggle.checked = Boolean(stopVisibility.TGA);
      elements.orfStopTgaToggle.disabled = !hasRecord;
    }
  }

  function readOrfStopVisibilityFromControls() {
    return normalizeOrfStopCodonVisibility({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    });
  }

  function syncRestrictionVendorToggleState() {
    if (elements.restrictionNebToggle) {
      elements.restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (elements.restrictionThermoToggle) {
      elements.restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function updateRecordSelect() {
    if (!elements.recordSelect) {
      return;
    }
    if (!state.records.length) {
      elements.recordSelect.innerHTML = '<option value="">No records loaded</option>';
      elements.recordSelect.disabled = true;
      return;
    }

    elements.recordSelect.disabled = false;
    elements.recordSelect.innerHTML = state.records
      .map((record, index) => {
        const selected = index === state.selectedRecordIndex ? ' selected' : '';
        const label = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
        return `<option value="${index}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderFeatureRail(record) {
    if (!elements.featureRailHost) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const sequenceLength = Math.max(1, record?.sequence?.length || 1);
    if (!features.length) {
      elements.featureRailHost.innerHTML = '<p class="small-note">No features to display.</p>';
      return;
    }

    const laidOut = assignFeatureLanes(features);
    const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
    const railHeight = Math.max(48, (laneCount * 18) + 18);

    const bars = laidOut.map((feature, index) => {
      const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
      const color = hashTypeToColor(colorKey);
      const locationText = buildFeatureLocationText(feature, sequenceLength);
      return (Array.isArray(feature.segments) ? feature.segments : [])
        .map((segment) => {
          const left = ((segment.start / sequenceLength) * 100).toFixed(3);
          const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100).toFixed(3);
          const top = (feature.lane * 18) + 8;
          const isActive = index === state.selectedFeatureIndex;
          const title = `${feature.name || '-'} (${locationText})`;
          return `
            <button
              class="sequence-viewer-feature-bar${isActive ? ' sequence-viewer-feature-bar-active' : ''}"
              type="button"
              data-feature-index="${index}"
              style="left:${left}%;width:${width}%;top:${top}px;background:${color};"
              title="${escapeHtml(title)}"
            ></button>
          `;
        })
        .join('');
    }).join('');

    elements.featureRailHost.innerHTML = `
      <div class="sequence-viewer-feature-rail" style="height:${railHeight}px;">
        ${bars}
      </div>
      <div class="sequence-viewer-feature-axis">
        <span style="left:0%;">1</span>
        <span style="left:25%;">${Math.max(1, Math.round(sequenceLength * 0.25)).toLocaleString()}</span>
        <span style="left:50%;">${Math.max(1, Math.round(sequenceLength * 0.5)).toLocaleString()}</span>
        <span style="left:75%;">${Math.max(1, Math.round(sequenceLength * 0.75)).toLocaleString()}</span>
        <span style="left:100%;">${sequenceLength.toLocaleString()}</span>
      </div>
    `;
  }

  function renderSelectedFeatureDetail(record) {
    if (!elements.featureDetail) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    if (!features.length || state.selectedFeatureIndex < 0) {
      elements.featureDetail.innerHTML = buildSelectionDetailHtml(record);
      return;
    }

    const selected = features[state.selectedFeatureIndex] || null;
    elements.featureDetail.innerHTML = formatSelectedFeatureDetailHtml(selected, record.sequence.length);
  }

  function renderSequence(record, options = {}) {
    if (!elements.sequenceHost) {
      return;
    }
    hideSequenceHoverTooltip();

    const preserveScroll = Boolean(options?.preserveScroll);
    const previousScrollTop = preserveScroll ? Math.max(0, Number(elements.sequenceHost.scrollTop) || 0) : 0;

    if (!record) {
      elements.sequenceHost.innerHTML = '<p class="small-note">Load sequence data to begin.</p>';
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const selectedFeature = (features.length && state.selectedFeatureIndex >= 0)
      ? features[state.selectedFeatureIndex] || null
      : null;
    const orfTranslationContext = state.orfViewEnabled
      ? buildSelectedOrfTranslationContext(record.sequence, selectedFeature, {
        stopVisibility: state.orfStopVisibility
      })
      : null;

    const selectionHighlights = getSequenceSelectionSegments(record);
    const highlights = selectionHighlights.length
      ? selectionHighlights
      : normalizeHighlightSegments(selectedFeature?.segments || [], record.sequence.length);
    const { lineLength, charAdvancePx, lineHeightPx, lineFeatureOffsetPx } = computeSequenceLayoutMetrics();
    state.sequenceLayout = {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    };

    elements.sequenceHost.innerHTML = renderDualStrandSequenceLinesHtml(record.sequence, highlights, {
      lineLength,
      charAdvancePx,
      sequenceLineHeightPx: lineHeightPx,
      lineFeatureOffsetPx,
      features,
      selectedFeatureIndex: state.selectedFeatureIndex,
      cursorBaseIndex: state.sequenceCursorBase,
      orfTranslationContext
    });

    if (preserveScroll) {
      elements.sequenceHost.scrollTop = previousScrollTop;
    } else if (highlights.length) {
      const first = highlights[0];
      const firstLine = Math.max(0, Math.floor(first.start / lineLength));
      elements.sequenceHost.scrollTop = Math.max(0, (firstLine * DUAL_STRAND_SCROLL_STEP) - 42);
    } else {
      elements.sequenceHost.scrollTop = 0;
    }
  }

  function renderStats(record) {
    if (!record) {
      if (elements.statFormat) elements.statFormat.textContent = '-';
      if (elements.statLength) elements.statLength.textContent = '0';
      if (elements.statTopology) elements.statTopology.textContent = '-';
      if (elements.statGc) elements.statGc.textContent = '-';
      if (elements.statAmbiguous) elements.statAmbiguous.textContent = '-';
      if (elements.statQuality) elements.statQuality.textContent = '-';
      if (elements.statFeatures) elements.statFeatures.textContent = '0';
      if (elements.statRestrictionSites) elements.statRestrictionSites.textContent = '0';
      return;
    }

    const gc = computeGcPercent(record.sequence);
    const ambiguous = countAmbiguousBases(record.sequence);
    const qualitySummary = summarizeFastqQuality(record.quality);
    const allFeatures = getVisibleFeaturesForRecord(record);
    const restrictionFeatures = allFeatures.filter(
      (feature) => String(feature?.type || '').toLowerCase() === 'restriction_site'
    );

    if (elements.statFormat) {
      elements.statFormat.textContent = String(record.sourceFormat || '-').toUpperCase();
    }
    if (elements.statLength) {
      elements.statLength.textContent = record.sequence.length.toLocaleString();
    }
    if (elements.statTopology) {
      elements.statTopology.textContent = String(record.topology || 'linear');
    }
    if (elements.statGc) {
      elements.statGc.textContent = `${gc.toFixed(2)}%`;
    }
    if (elements.statAmbiguous) {
      elements.statAmbiguous.textContent = ambiguous.toLocaleString();
    }
    if (elements.statFeatures) {
      elements.statFeatures.textContent = allFeatures.length.toLocaleString();
    }
    if (elements.statRestrictionSites) {
      elements.statRestrictionSites.textContent = restrictionFeatures.length.toLocaleString();
    }
    if (elements.statQuality) {
      elements.statQuality.textContent = qualitySummary
        ? `Q${qualitySummary.min.toFixed(1)} / ${qualitySummary.mean.toFixed(1)} / ${qualitySummary.max.toFixed(1)}`
        : 'n/a';
    }
  }

  function renderActiveRecord() {
    const record = getSelectedRecord();
    renderStats(record);
    renderSequence(record);
    renderFeatureRail(record);
    renderSelectedFeatureDetail(record);
    syncAnnotateButtonState();
    syncOrfToggleState();
    syncRestrictionVendorToggleState();
    updateMessages();
  }

  function setOrfViewEnabled(nextEnabled) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.orfViewEnabled = Boolean(nextEnabled);

    if (!state.orfViewEnabled && isOrfFeature(selectedFeature)) {
      state.selectedFeatureIndex = -1;
    } else if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  function setRestrictionVendorFilter(nextFilter) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.restrictionVendorFilter = normalizeRestrictionVendorFilter(nextFilter);

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  function bindEvents() {
    elements.annotateBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void onRequestAnnotation();
    });

    elements.recognizeBackboneBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void onRequestRecognizeBackbone();
    });

    elements.orfToggle?.addEventListener('change', () => {
      setOrfViewEnabled(Boolean(elements.orfToggle.checked));
    });

    const handleOrfStopToggleChange = () => {
      state.orfStopVisibility = readOrfStopVisibilityFromControls();
      renderActiveRecord();
    };

    elements.orfStopTagToggle?.addEventListener('change', handleOrfStopToggleChange);
    elements.orfStopTaaToggle?.addEventListener('change', handleOrfStopToggleChange);
    elements.orfStopTgaToggle?.addEventListener('change', handleOrfStopToggleChange);

    elements.restrictionNebToggle?.addEventListener('change', () => {
      setRestrictionVendorFilter({
        ...state.restrictionVendorFilter,
        neb: Boolean(elements.restrictionNebToggle.checked)
      });
    });

    elements.restrictionThermoToggle?.addEventListener('change', () => {
      setRestrictionVendorFilter({
        ...state.restrictionVendorFilter,
        thermo: Boolean(elements.restrictionThermoToggle.checked)
      });
    });

    elements.clearBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      onRequestClear();
    });

    elements.saveBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void onRequestSave();
    });

    elements.backBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      onNavigateHome();
      void onRefreshLibraryEntries({ silent: true });
    });

    elements.recordSelect?.addEventListener('change', () => {
      state.selectedRecordIndex = clamp(Number(elements.recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
      state.selectedFeatureIndex = -1;
      clearSequenceSelection();
      hideFeatureContextMenu();
      hideFeatureEditor();
      renderActiveRecord();
      const selected = getSelectedRecord();
      if (selected && elements.saveNameInput) {
        elements.saveNameInput.value = normalizeRecordName(selected.name || 'sequence', 'sequence');
      }
    });

    elements.featureRailHost?.addEventListener('click', (event) => {
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (!trigger) {
        return;
      }
      const index = Number(trigger.dataset.featureIndex);
      if (!Number.isFinite(index)) {
        return;
      }
      state.selectedFeatureIndex = index;
      clearSequenceSelection();
      hideFeatureContextMenu();
      renderActiveRecord();
    });

    elements.sequenceHost?.addEventListener('mousedown', (event) => {
      const button = Number(event?.button);
      if (Number.isFinite(button) && button !== 0) {
        return;
      }
      const featureTrigger = event.target?.closest?.('[data-feature-index]') || null;
      if (featureTrigger) {
        return;
      }
      const record = getSelectedRecord();
      const boundary = resolveSequenceBoundaryFromEvent(event, record);
      if (!Number.isFinite(boundary)) {
        return;
      }
      event.preventDefault?.();
      hideFeatureContextMenu();
      state.isSelectingSequence = true;
      state.sequenceSelectionAnchor = boundary;
      state.sequenceSelectionFocus = boundary;
      state.sequenceCursorBase = boundary;
      renderSequence(record, { preserveScroll: true });
      renderSelectedFeatureDetail(record);
    });

    elements.sequenceHost?.addEventListener('mousemove', (event) => {
      const record = getSelectedRecord();
      let rerenderNeeded = false;

      if (state.isSelectingSequence) {
        const boundary = resolveSequenceBoundaryFromEvent(event, record);
        if (Number.isFinite(boundary)) {
          if (state.sequenceSelectionFocus !== boundary) {
            state.sequenceSelectionFocus = boundary;
            rerenderNeeded = true;
          }
          if (state.sequenceCursorBase !== boundary) {
            state.sequenceCursorBase = boundary;
            rerenderNeeded = true;
          }
        }
        hideSequenceHoverTooltip();
        if (rerenderNeeded) {
          renderSequence(record, { preserveScroll: true });
          renderSelectedFeatureDetail(record);
        }
        return;
      }

      hideSequenceHoverTooltip();
      const boundary = resolveSequenceBoundaryFromEvent(event, record);
      if (Number.isFinite(boundary)) {
        if (state.sequenceCursorBase !== boundary) {
          state.sequenceCursorBase = boundary;
          rerenderNeeded = true;
        }
      } else if (Number.isFinite(state.sequenceCursorBase)) {
        state.sequenceCursorBase = null;
        rerenderNeeded = true;
      }

      if (rerenderNeeded) {
        renderSequence(record, { preserveScroll: true });
      }
    });

    elements.sequenceHost?.addEventListener('mouseover', (event) => {
      const record = getSelectedRecord();
      const trigger = event.target?.closest?.('[data-feature-index]');
      if (!trigger || !record?.sequence?.length) {
        hideSequenceHoverTooltip();
        return;
      }
      const index = Number(trigger.dataset.featureIndex);
      if (!Number.isFinite(index) || index < 0) {
        hideSequenceHoverTooltip();
        return;
      }
      const feature = getVisibleFeaturesForRecord(record)[index] || null;
      if (!feature) {
        hideSequenceHoverTooltip();
        return;
      }
      showSequenceHoverTooltip(event, feature, record.sequence.length);
    });

    elements.sequenceHost?.addEventListener('mouseout', (event) => {
      if (!event?.relatedTarget?.closest?.('[data-feature-index]')) {
        hideSequenceHoverTooltip();
      }
    });

    elements.sequenceHost?.addEventListener('mouseleave', () => {
      hideSequenceHoverTooltip();
      if (state.isSelectingSequence) {
        return;
      }
      if (Number.isFinite(state.sequenceCursorBase)) {
        state.sequenceCursorBase = null;
        renderSequence(getSelectedRecord(), { preserveScroll: true });
      }
    });

    elements.sequenceHost?.addEventListener('scroll', () => {
      hideSequenceHoverTooltip();
      hideFeatureContextMenu();
    });

    elements.sequenceHost?.addEventListener('click', (event) => {
      hideFeatureContextMenu();
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      if (!trigger) {
        return;
      }
      const index = Number(trigger.dataset.featureIndex);
      if (!Number.isFinite(index)) {
        return;
      }
      state.selectedFeatureIndex = index;
      clearSequenceSelection({ preserveCursor: true });
      renderActiveRecord();
    });

    elements.sequenceHost?.addEventListener('mouseup', () => {
      if (!state.isSelectingSequence) {
        return;
      }
      state.isSelectingSequence = false;
      renderSequence(getSelectedRecord(), { preserveScroll: true });
      renderSelectedFeatureDetail(getSelectedRecord());
    });

    elements.sequenceHost?.addEventListener('contextmenu', (event) => {
      const record = getSelectedRecord();
      hideSequenceHoverTooltip();
      if (state.isSelectingSequence) {
        state.isSelectingSequence = false;
      }
      const context = resolveFeatureActionContext(record, event);
      if (!context?.selectionRange && !context?.featureContext) {
        hideFeatureContextMenu();
        return;
      }
      event.preventDefault?.();
      renderSelectedFeatureDetail(record);
      renderFeatureContextMenu(context, event);
    });

    elements.featureContextMenu?.addEventListener('click', (event) => {
      const action = cleanText(
        event?.target?.closest?.('[data-sequence-feature-action]')?.dataset?.sequenceFeatureAction,
        40
      );
      if (!action) {
        return;
      }
      if (action === 'add') {
        openFeatureEditor('add', featureContextMenuState);
        return;
      }
      if (action === 'edit') {
        openFeatureEditor('edit', featureContextMenuState);
        return;
      }
      if (action === 'delete') {
        void deleteFeatureFromContext(featureContextMenuState);
      }
    });

    elements.featureEditorForm?.addEventListener('submit', (event) => {
      event.preventDefault?.();
      void applyFeatureEditorChanges();
    });

    elements.featureEditorCloseBtn?.addEventListener('click', () => {
      hideFeatureEditor();
    });

    elements.featureEditorCancelBtn?.addEventListener('click', () => {
      hideFeatureEditor();
    });

    elements.featureEditorOverlay?.addEventListener('click', (event) => {
      if (event?.target === elements.featureEditorOverlay) {
        hideFeatureEditor();
      }
    });

    globalThis.addEventListener?.('mouseup', () => {
      if (!state.isSelectingSequence) {
        return;
      }
      state.isSelectingSequence = false;
      renderSequence(getSelectedRecord(), { preserveScroll: true });
      renderSelectedFeatureDetail(getSelectedRecord());
    });

    globalThis.addEventListener?.('click', (event) => {
      if (!event?.target?.closest?.('#sequence-viewer-feature-context-menu')) {
        hideFeatureContextMenu();
      }
    });

    globalThis.addEventListener?.('keydown', (event) => {
      if (String(event?.key || '') === 'Escape') {
        hideFeatureContextMenu();
        hideFeatureEditor();
      }
    });

    globalThis.addEventListener?.('resize', () => {
      renderSequence(getSelectedRecord(), { preserveScroll: true });
    });
  }

  return {
    bindEvents,
    clearSequenceSelection,
    findFeatureIndexByIdentity,
    getVisibleFeaturesForRecord,
    hideFeatureContextMenu,
    hideFeatureEditor,
    renderActiveRecord,
    renderSelectedFeatureDetail,
    renderSequence,
    setOrfViewEnabled,
    setRestrictionVendorFilter,
    syncAnnotateButtonState,
    syncOrfToggleState,
    syncRestrictionVendorToggleState,
    updateRecordSelect
  };
}
