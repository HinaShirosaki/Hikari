import { escapeHtml } from '../tool-box/common.js';
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_SEQUENCE_LINE_LENGTH,
  DUAL_STRAND_SCROLL_STEP,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  FEATURE_TOOLTIP_OFFSET_PX,
  DEFAULT_RESTRICTION_VENDOR_FILTER,
  PLANNOTATE_DEFAULT_OPTIONS
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
import {
  normalizeExternalPayload,
  parseInputRecords,
  summarizeFastqQuality
} from './parsing.js';
import {
  buildPlannotateFeaturesFromResult,
  getEnanaApiBridge,
  runPlannotateAnnotationForSequence
} from './plannotate.js';
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
  normalizeTopology,
  parseCssPixels
} from './shared.js';
import {
  buildCircularPreviewHtmlDocument,
  buildRecordGenbankText,
  readStoragePathFromLocalState
} from './storage.js';
import {
  DEFAULT_ORF_STOP_DISPLAY_MODE,
  normalizeOrfStopDisplayMode
} from './translation-style.js';

export function initSequenceViewer(options = {}) {
  const LIBRARY_STATUS_SAVED = 'saved';
  const LIBRARY_STATUS_TEMPORARY = 'temporary';
  const FILE_ACCEPT = '.gbk,.gb,.gbff,.fasta,.fa,.fas,.fna,.fastq,.fq,.txt,.seq';
  const rootDocument = options?.document || globalThis?.document || null;

  const homeWorkspace = rootDocument?.getElementById?.('sequence-viewer-home-workspace');
  const detailWorkspace = rootDocument?.getElementById?.('sequence-viewer-detail-workspace');
  const homePasteBtn = rootDocument?.getElementById?.('sequence-viewer-home-paste-btn');
  const homeOpenBtn = rootDocument?.getElementById?.('sequence-viewer-home-open-btn');
  const homeOpenInput = rootDocument?.getElementById?.('sequence-viewer-home-open-input');
  const homeStatusNote = rootDocument?.getElementById?.('sequence-viewer-home-status');
  const libraryFilterSavedBtn = rootDocument?.getElementById?.('sequence-viewer-library-filter-saved');
  const libraryFilterTemporaryBtn = rootDocument?.getElementById?.('sequence-viewer-library-filter-temporary');
  const libraryList = rootDocument?.getElementById?.('sequence-viewer-library-list');
  const previewHost = rootDocument?.getElementById?.('sequence-viewer-preview-host');
  const backBtn = rootDocument?.getElementById?.('sequence-viewer-back-btn');
  const saveBtn = rootDocument?.getElementById?.('sequence-viewer-save-btn');
  const saveNameInput = rootDocument?.getElementById?.('sequence-viewer-save-name');

  const modePasteBtn = rootDocument?.getElementById?.('sequence-viewer-mode-paste');
  const modeFileBtn = rootDocument?.getElementById?.('sequence-viewer-mode-file');
  const pastePanel = rootDocument?.getElementById?.('sequence-viewer-paste-panel');
  const filePanel = rootDocument?.getElementById?.('sequence-viewer-file-panel');
  const inputTextarea = rootDocument?.getElementById?.('sequence-viewer-textarea');
  const fileInput = rootDocument?.getElementById?.('sequence-viewer-file-input');
  const fileChooseBtn = rootDocument?.getElementById?.('sequence-viewer-file-choose');
  const fileNameLabel = rootDocument?.getElementById?.('sequence-viewer-file-name');
  const loadBtn = rootDocument?.getElementById?.('sequence-viewer-load-btn');
  const annotateBtn = rootDocument?.getElementById?.('sequence-viewer-annotate-btn');
  const orfToggle = rootDocument?.getElementById?.('sequence-viewer-orf-toggle');
  const orfStopModeSelect = rootDocument?.getElementById?.('sequence-viewer-orf-stop-mode');
  const restrictionNebToggle = rootDocument?.getElementById?.('sequence-viewer-restriction-neb-toggle');
  const restrictionThermoToggle = rootDocument?.getElementById?.('sequence-viewer-restriction-thermo-toggle');
  const clearBtn = rootDocument?.getElementById?.('sequence-viewer-clear-btn');
  const statusNote = rootDocument?.getElementById?.('sequence-viewer-status');
  const messageBox = rootDocument?.getElementById?.('sequence-viewer-messages');
  const recordSelect = rootDocument?.getElementById?.('sequence-viewer-record-select');

  const statFormat = rootDocument?.getElementById?.('sequence-viewer-stat-format');
  const statLength = rootDocument?.getElementById?.('sequence-viewer-stat-length');
  const statTopology = rootDocument?.getElementById?.('sequence-viewer-stat-topology');
  const statGc = rootDocument?.getElementById?.('sequence-viewer-stat-gc');
  const statAmbiguous = rootDocument?.getElementById?.('sequence-viewer-stat-ambiguous');
  const statQuality = rootDocument?.getElementById?.('sequence-viewer-stat-quality');
  const statFeatures = rootDocument?.getElementById?.('sequence-viewer-stat-features');
  const statRestrictionSites = rootDocument?.getElementById?.('sequence-viewer-stat-restriction-sites');

  const featureRailHost = rootDocument?.getElementById?.('sequence-viewer-feature-rail-host');
  const featureDetail = rootDocument?.getElementById?.('sequence-viewer-feature-detail');
  const sequenceHost = rootDocument?.getElementById?.('sequence-viewer-sequence-host');
  const featureContextMenu = rootDocument?.getElementById?.('sequence-viewer-feature-context-menu');
  const featureEditorOverlay = rootDocument?.getElementById?.('sequence-viewer-feature-editor-overlay');
  const featureEditorForm = rootDocument?.getElementById?.('sequence-viewer-feature-editor-form');
  const featureEditorTitle = rootDocument?.getElementById?.('sequence-viewer-feature-editor-title');
  const featureEditorNote = rootDocument?.getElementById?.('sequence-viewer-feature-editor-note');
  const featureEditorNameInput = rootDocument?.getElementById?.('sequence-viewer-feature-editor-name');
  const featureEditorTypeInput = rootDocument?.getElementById?.('sequence-viewer-feature-editor-type');
  const featureEditorStrandSelect = rootDocument?.getElementById?.('sequence-viewer-feature-editor-strand');
  const featureEditorStartInput = rootDocument?.getElementById?.('sequence-viewer-feature-editor-start');
  const featureEditorEndInput = rootDocument?.getElementById?.('sequence-viewer-feature-editor-end');
  const featureEditorDescriptionInput = rootDocument?.getElementById?.('sequence-viewer-feature-editor-description');
  const featureEditorCloseBtn = rootDocument?.getElementById?.('sequence-viewer-feature-editor-close');
  const featureEditorCancelBtn = rootDocument?.getElementById?.('sequence-viewer-feature-editor-cancel');

  const state = {
    mode: 'paste',
    fileName: '',
    fileText: '',
    records: [],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    warnings: [],
    errors: [],
    annotationWarnings: [],
    isAnnotating: false,
    orfViewEnabled: false,
    orfStopMode: normalizeOrfStopDisplayMode(orfStopModeSelect?.value || DEFAULT_ORF_STOP_DISPLAY_MODE),
    restrictionVendorFilter: {
      ...DEFAULT_RESTRICTION_VENDOR_FILTER
    },
    inputComposerVisible: true,
    libraryFilter: LIBRARY_STATUS_SAVED,
    libraryEntries: [],
    selectedLibraryEntryId: '',
    activeEntryId: '',
    activeEntryStatus: '',
    lastLibraryClickEntryId: '',
    lastLibraryClickAt: 0,
    sequenceSelectionAnchor: null,
    sequenceSelectionFocus: null,
    sequenceCursorBase: null,
    isSelectingSequence: false,
    sequenceLayout: {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: FALLBACK_CHAR_ADVANCE_PX,
      lineHeightPx: FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
      lineFeatureOffsetPx: DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX
    }
  };

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

  function getBridge() {
    return options?.apiBridge || options?.bridge || getEnanaApiBridge();
  }

  function getStoragePath() {
    return String(options?.storagePath || '').trim() || readStoragePathFromLocalState();
  }

  function hasStoragePath() {
    return Boolean(getStoragePath());
  }

  function setHomeStatus(message, isError = false) {
    if (!homeStatusNote) {
      return;
    }
    homeStatusNote.textContent = message;
    homeStatusNote.style.color = isError ? 'var(--danger)' : '';
  }

  const onNavigateHome = typeof options?.onNavigateHome === 'function'
    ? options.onNavigateHome
    : null;
  const onNavigateDetail = typeof options?.onNavigateDetail === 'function'
    ? options.onNavigateDetail
    : null;

  function setLocalWorkspaceVisibility(mode) {
    const next = mode === 'detail' ? 'detail' : 'home';
    if (homeWorkspace) {
      homeWorkspace.hidden = next !== 'home';
    }
    if (detailWorkspace) {
      detailWorkspace.hidden = next !== 'detail';
    }
  }

  function navigateToHome() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('home');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function navigateToDetail() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
  }

  function setLibraryFilter(status) {
    state.libraryFilter = status === LIBRARY_STATUS_TEMPORARY ? LIBRARY_STATUS_TEMPORARY : LIBRARY_STATUS_SAVED;
    if (libraryFilterSavedBtn) {
      libraryFilterSavedBtn.classList.toggle('sequence-viewer-library-switch-btn-active', state.libraryFilter === LIBRARY_STATUS_SAVED);
    }
    if (libraryFilterTemporaryBtn) {
      libraryFilterTemporaryBtn.classList.toggle('sequence-viewer-library-switch-btn-active', state.libraryFilter === LIBRARY_STATUS_TEMPORARY);
    }
  }

  function syncHomeControlsState() {
    const hasStorage = hasStoragePath();
    if (libraryFilterSavedBtn) {
      libraryFilterSavedBtn.disabled = !hasStorage;
    }
    if (libraryFilterTemporaryBtn) {
      libraryFilterTemporaryBtn.disabled = !hasStorage;
    }
    if (saveBtn) {
      saveBtn.disabled = !getSelectedRecord()?.sequence?.length;
    }
  }

  function renderPreviewFromHtml(entry, htmlText) {
    if (!previewHost) {
      return;
    }
    if (!entry || !String(htmlText || '').trim()) {
      previewHost.innerHTML = '<p class="small-note">Select a sequence in the library to preview.</p>';
      return;
    }

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(htmlText))}`;
    previewHost.innerHTML = `<iframe class="sequence-viewer-preview-frame" src="${dataUrl}" loading="lazy" title="${escapeHtml(entry.name || 'Sequence preview')}"></iframe>`;
  }

  function renderLibraryList() {
    if (!libraryList) {
      return;
    }
    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    if (!entries.length) {
      const noun = state.libraryFilter === LIBRARY_STATUS_SAVED ? 'saved' : 'unsaved';
      libraryList.innerHTML = `<p class="small-note">No ${noun} sequence entries.</p>`;
      return;
    }

    libraryList.innerHTML = entries
      .map((entry) => {
        const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
        const lengthLabel = `${Math.max(0, Number(entry.sequenceLength) || 0).toLocaleString()} bp`;
        const featureLabel = `${Math.max(0, Number(entry.featureCount) || 0).toLocaleString()} features`;
        const updated = String(entry.updatedAt || '').slice(0, 16).replace('T', ' ');
        return `
          <button
            type="button"
            class="sequence-viewer-library-item${active ? ' sequence-viewer-library-item-active' : ''}"
            data-sequence-entry-id="${escapeHtml(entry.id)}"
            title="${escapeHtml(entry.name || 'sequence')}"
          >
            <span class="sequence-viewer-library-item-name">${escapeHtml(entry.name || 'sequence')}</span>
            <span class="sequence-viewer-library-item-meta">${escapeHtml(lengthLabel)} · ${escapeHtml(entry.topology || 'linear')}</span>
            <span class="sequence-viewer-library-item-meta">${escapeHtml(featureLabel)} · updated ${escapeHtml(updated || '-')}</span>
          </button>
        `;
      })
      .join('');
  }

  async function loadSelectedLibraryPreview() {
    const entryId = cleanText(state.selectedLibraryEntryId, 200);
    const storagePath = getStoragePath();
    if (!entryId || !storagePath) {
      renderPreviewFromHtml(null, '');
      return;
    }
    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      renderPreviewFromHtml(null, '');
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: entryId,
        includeHtml: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load preview.');
      }
      renderPreviewFromHtml(response.entry, response.htmlText || '');
    } catch (error) {
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load preview.', true);
    }
  }

  async function refreshLibraryEntries(options = {}) {
    const storagePath = getStoragePath();
    syncHomeControlsState();
    if (!storagePath) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreviewFromHtml(null, '');
      setHomeStatus('Use New or Open to continue. Set Storage Folder Path in Settings to enable the saved/unsaved library.');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryList) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryList({
        storagePath,
        status: state.libraryFilter
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to list sequence entries.');
      }
      const entries = Array.isArray(response.entries) ? response.entries : [];
      state.libraryEntries = entries;

      const preferred = cleanText(options.selectedId, 200)
        || cleanText(state.selectedLibraryEntryId, 200);
      const nextSelected = entries.some((entry) => cleanText(entry.id, 200) === preferred)
        ? preferred
        : (entries[0]?.id || '');
      state.selectedLibraryEntryId = cleanText(nextSelected, 200);

      renderLibraryList();
      await loadSelectedLibraryPreview();
      if (!options.silent) {
        setHomeStatus(`Loaded ${entries.length} ${state.libraryFilter} sequence entr${entries.length === 1 ? 'y' : 'ies'}.`);
      }
    } catch (error) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load sequence library.', true);
    }
  }

  async function setSelectedLibraryEntry(entryId) {
    state.selectedLibraryEntryId = cleanText(entryId, 200);
    renderLibraryList();
    await loadSelectedLibraryPreview();
  }

  function resolveLibraryEntryIdFromEvent(event) {
    const target = event?.target;
    const direct = cleanText(target?.dataset?.sequenceEntryId, 200);
    if (direct) {
      return direct;
    }

    const viaClosest = cleanText(
      target?.closest?.('[data-sequence-entry-id]')?.dataset?.sequenceEntryId,
      200
    );
    if (viaClosest) {
      return viaClosest;
    }

    let cursor = target?.parentElement || target?.parentNode || null;
    while (cursor) {
      const resolved = cleanText(cursor?.dataset?.sequenceEntryId, 200);
      if (resolved) {
        return resolved;
      }
      cursor = cursor.parentElement || cursor.parentNode || null;
    }

    return '';
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
    if (!sequenceHoverTooltip) {
      return;
    }
    sequenceHoverTooltip.hidden = true;
  }

  function buildFeatureHoverTooltipHtml(feature, sequenceLength) {
    const strand = feature?.strand === -1 ? '-' : '+';
    const location = buildFeatureLocationText(feature, sequenceLength);
    const identity = Number.isFinite(feature?.identity) ? `${feature.identity.toFixed(2)}%` : '';
    const coverage = Number.isFinite(feature?.coverage) ? `${feature.coverage.toFixed(2)}%` : '';
    const source = String(feature?.mode || feature?.source || '-');
    const meta = [identity ? `Identity ${identity}` : '', coverage ? `Coverage ${coverage}` : '', source].filter(Boolean).join(' · ');

    return `
      <p class="sequence-viewer-feature-hover-title">${escapeHtml(feature?.name || '-')}</p>
      <p>${escapeHtml(feature?.type || '-')} · Strand ${strand}</p>
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

    if (rootDocument && sequenceHost && typeof sequenceHost.appendChild === 'function') {
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
        sequenceHost.appendChild(probe);

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
    if (!sequenceHost || typeof sequenceHost.clientWidth !== 'number') {
      return {
        lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
        charAdvancePx: typography.charAdvancePx,
        lineHeightPx: typography.lineHeightPx,
        lineFeatureOffsetPx: fallbackFeatureOffsetPx
      };
    }

    const hostWidth = Math.max(0, sequenceHost.clientWidth);
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
      const computed = globalThis.getComputedStyle(sequenceHost);
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

  function setInputComposerVisible(visible) {
    const shouldShow = visible !== false;
    state.inputComposerVisible = shouldShow;

    if (modePasteBtn) {
      modePasteBtn.hidden = !shouldShow;
    }
    if (modeFileBtn) {
      modeFileBtn.hidden = !shouldShow;
    }
    if (loadBtn) {
      loadBtn.hidden = !shouldShow;
    }

    if (pastePanel) {
      pastePanel.hidden = !shouldShow || state.mode !== 'paste';
    }
    if (filePanel) {
      filePanel.hidden = !shouldShow || state.mode !== 'file';
    }
  }

  function setMode(mode) {
    const resolved = mode === 'file' ? 'file' : 'paste';
    state.mode = resolved;

    if (modePasteBtn) {
      modePasteBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'paste');
    }
    if (modeFileBtn) {
      modeFileBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'file');
    }
    if (pastePanel) {
      pastePanel.hidden = !state.inputComposerVisible || resolved !== 'paste';
    }
    if (filePanel) {
      filePanel.hidden = !state.inputComposerVisible || resolved !== 'file';
    }
  }

  function setStatus(message, isError = false) {
    if (!statusNote) {
      return;
    }
    statusNote.textContent = message;
    statusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function updateMessages() {
    if (!messageBox) {
      return;
    }
    const rows = [
      ...state.errors.map((text) => `<p class="small-note" style="color:var(--danger);">${escapeHtml(text)}</p>`),
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`),
      ...state.annotationWarnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];

    messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
  }

  function getVisibleFeaturesForRecord(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: state.orfViewEnabled,
      restrictionVendorFilter: state.restrictionVendorFilter
    });
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
    const segments = getSequenceSelectionSegments(record);
    return segments[0] || null;
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
    if (!featureContextMenu) {
      return;
    }
    featureContextMenu.hidden = true;
    featureContextMenu.innerHTML = '';
  }

  function hideFeatureEditor() {
    featureEditorState = null;
    if (featureEditorOverlay) {
      featureEditorOverlay.hidden = true;
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
    const feature = getFeatureByIndexForRecord(record, state.selectedFeatureIndex);
    return resolveRecordFeatureContext(record, feature);
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
    if (!featureContextMenu) {
      return;
    }
    const selectionLabel = context?.selectionRange ? formatBaseRangeLabel(context.selectionRange) : '';
    const featureName = cleanText(context?.featureContext?.feature?.name, 120) || 'feature';
    featureContextMenuState = context;
    featureContextMenu.innerHTML = `
      ${selectionLabel ? `<p class="small-note">${escapeHtml(selectionLabel)}</p>` : ''}
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="add"${context?.selectionRange ? '' : ' disabled'}>Add Feature</button>
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="edit"${context?.featureContext ? '' : ' disabled'}>Edit ${escapeHtml(featureName)}</button>
      <button type="button" class="sequence-viewer-context-item" data-sequence-feature-action="delete"${context?.featureContext ? '' : ' disabled'}>Delete ${escapeHtml(featureName)}</button>
    `;
    featureContextMenu.hidden = false;
    positionFloatingUi(featureContextMenu, Number(event?.clientX) + 4, Number(event?.clientY) + 4);
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

    if (featureEditorTitle) {
      featureEditorTitle.textContent = mode === 'edit' ? 'Edit Feature' : 'Add Feature';
    }
    if (featureEditorNote) {
      featureEditorNote.textContent = note;
    }
    if (featureEditorNameInput) {
      featureEditorNameInput.value = suggestedName;
    }
    if (featureEditorTypeInput) {
      featureEditorTypeInput.value = sanitizeFeatureType(feature?.type || 'misc_feature');
    }
    if (featureEditorStrandSelect) {
      featureEditorStrandSelect.value = String(feature?.strand === -1 ? -1 : 1);
    }
    if (featureEditorStartInput) {
      featureEditorStartInput.value = String(Math.max(1, range.start + 1));
      featureEditorStartInput.min = '1';
      featureEditorStartInput.max = String(Math.max(1, sequenceLength));
    }
    if (featureEditorEndInput) {
      featureEditorEndInput.value = String(Math.max(1, range.end));
      featureEditorEndInput.min = '1';
      featureEditorEndInput.max = String(Math.max(1, sequenceLength));
    }
    if (featureEditorDescriptionInput) {
      featureEditorDescriptionInput.value = String(feature?.description || '');
    }

    hideFeatureContextMenu();
    if (featureEditorOverlay) {
      featureEditorOverlay.hidden = false;
    }
    featureEditorNameInput?.focus?.();
  }

  function readFeatureEditorPayload(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const startBase = clamp(Math.round(Number(featureEditorStartInput?.value) || 0), 1, Math.max(1, sequenceLength));
    const endBase = clamp(Math.round(Number(featureEditorEndInput?.value) || 0), 1, Math.max(1, sequenceLength));
    if (endBase < startBase) {
      throw new Error('Feature end must be greater than or equal to the start.');
    }

    return {
      name: normalizeRecordName(featureEditorNameInput?.value || 'feature', 'feature'),
      type: sanitizeFeatureType(featureEditorTypeInput?.value || 'misc_feature'),
      strand: String(featureEditorStrandSelect?.value || '1') === '-1' ? -1 : 1,
      description: cleanText(featureEditorDescriptionInput?.value || '', 4000),
      range: {
        start: startBase - 1,
        end: endBase
      }
    };
  }

  async function persistFeatureMutation(record, actionLabel) {
    if (!state.activeEntryId) {
      setStatus(`${actionLabel} Save the record to persist changes.`);
      return;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        name: saveNameInput?.value || record.name || 'sequence'
      });
      await refreshLibraryEntries({ selectedId: entry.id, silent: true });
      setStatus(`${actionLabel} Saved to ${entry.name}.`);
    } catch (error) {
      setStatus(`${actionLabel} Changes remain local: ${error?.message || 'Failed to save.'}`, true);
    }
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
    if (!annotateBtn) {
      return;
    }
    const record = getSelectedRecord();
    const hasRecord = Boolean(record?.sequence?.length);
    annotateBtn.disabled = state.isAnnotating || !hasRecord;
    if (saveBtn) {
      saveBtn.disabled = !hasRecord || !hasStoragePath();
    }
  }

  function syncOrfToggleState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    if (orfToggle) {
      orfToggle.checked = Boolean(state.orfViewEnabled);
      orfToggle.disabled = !hasRecord;
    }
    if (orfStopModeSelect) {
      orfStopModeSelect.value = normalizeOrfStopDisplayMode(state.orfStopMode);
      orfStopModeSelect.disabled = !hasRecord;
    }
  }

  function syncRestrictionVendorToggleState() {
    if (restrictionNebToggle) {
      restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (restrictionThermoToggle) {
      restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function updateRecordSelect() {
    if (!recordSelect) {
      return;
    }

    if (!state.records.length) {
      recordSelect.innerHTML = '<option value="">No records loaded</option>';
      recordSelect.disabled = true;
      return;
    }

    recordSelect.disabled = false;
    recordSelect.innerHTML = state.records
      .map((record, index) => {
        const selected = index === state.selectedRecordIndex ? ' selected' : '';
        const label = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
        return `<option value="${index}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderFeatureRail(record) {
    if (!featureRailHost) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const sequenceLength = Math.max(1, record?.sequence?.length || 1);

    if (!features.length) {
      featureRailHost.innerHTML = '<p class="small-note">No features to display.</p>';
      return;
    }

    const laidOut = assignFeatureLanes(features);
    const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
    const railHeight = Math.max(48, (laneCount * 18) + 18);

    const bars = laidOut
      .map((feature, index) => {
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
      })
      .join('');

    featureRailHost.innerHTML = `
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
    if (!featureDetail) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    if (!features.length || state.selectedFeatureIndex < 0) {
      featureDetail.innerHTML = buildSelectionDetailHtml(record);
      return;
    }

    const selected = features[state.selectedFeatureIndex] || null;
    featureDetail.innerHTML = formatSelectedFeatureDetailHtml(selected, record.sequence.length);
  }

  function renderSequence(record, options = {}) {
    if (!sequenceHost) {
      return;
    }
    hideSequenceHoverTooltip();

    const preserveScroll = Boolean(options?.preserveScroll);
    const previousScrollTop = preserveScroll ? Math.max(0, Number(sequenceHost.scrollTop) || 0) : 0;

    if (!record) {
      sequenceHost.innerHTML = '<p class="small-note">Load sequence data to begin.</p>';
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const selectedFeature = (features.length && state.selectedFeatureIndex >= 0)
      ? features[state.selectedFeatureIndex] || null
      : null;
    const orfTranslationContext = state.orfViewEnabled
      ? buildSelectedOrfTranslationContext(record.sequence, selectedFeature, {
        stopMode: state.orfStopMode
      })
      : null;

    const selectionHighlights = getSequenceSelectionSegments(record);
    const highlights = selectionHighlights.length
      ? selectionHighlights
      : normalizeHighlightSegments(selectedFeature?.segments || [], record.sequence.length);
    const {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    } = computeSequenceLayoutMetrics();
    state.sequenceLayout = {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    };
    sequenceHost.innerHTML = renderDualStrandSequenceLinesHtml(record.sequence, highlights, {
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
      sequenceHost.scrollTop = previousScrollTop;
    } else if (highlights.length) {
      const first = highlights[0];
      const firstLine = Math.max(0, Math.floor(first.start / lineLength));
      sequenceHost.scrollTop = Math.max(0, (firstLine * DUAL_STRAND_SCROLL_STEP) - 42);
    } else {
      sequenceHost.scrollTop = 0;
    }
  }

  function renderStats(record) {
    if (!record) {
      if (statFormat) statFormat.textContent = '-';
      if (statLength) statLength.textContent = '0';
      if (statTopology) statTopology.textContent = '-';
      if (statGc) statGc.textContent = '-';
      if (statAmbiguous) statAmbiguous.textContent = '-';
      if (statQuality) statQuality.textContent = '-';
      if (statFeatures) statFeatures.textContent = '0';
      if (statRestrictionSites) statRestrictionSites.textContent = '0';
      return;
    }

    const gc = computeGcPercent(record.sequence);
    const ambiguous = countAmbiguousBases(record.sequence);
    const qualitySummary = summarizeFastqQuality(record.quality);
    const allFeatures = getVisibleFeaturesForRecord(record);
    const restrictionFeatures = allFeatures
      .filter((feature) => String(feature?.type || '').toLowerCase() === 'restriction_site');
    const totalFeatures = allFeatures.length;

    if (statFormat) {
      statFormat.textContent = String(record.sourceFormat || '-').toUpperCase();
    }
    if (statLength) {
      statLength.textContent = record.sequence.length.toLocaleString();
    }
    if (statTopology) {
      statTopology.textContent = normalizeTopology(record.topology);
    }
    if (statGc) {
      statGc.textContent = `${gc.toFixed(2)}%`;
    }
    if (statAmbiguous) {
      statAmbiguous.textContent = ambiguous.toLocaleString();
    }
    if (statFeatures) {
      statFeatures.textContent = totalFeatures.toLocaleString();
    }
    if (statRestrictionSites) {
      statRestrictionSites.textContent = restrictionFeatures.length.toLocaleString();
    }
    if (statQuality) {
      statQuality.textContent = qualitySummary
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

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.annotationWarnings = [];
    state.isAnnotating = false;
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    hideFeatureContextMenu();
    hideFeatureEditor();

    updateRecordSelect();
    renderActiveRecord();
    if (saveNameInput && state.records.length) {
      saveNameInput.value = normalizeRecordName(state.records[0].name || 'sequence', 'sequence');
    }

    if (state.records.length) {
      setStatus(`${statusPrefix}: ${state.records.length} record(s).`);
    } else {
      setStatus(state.errors[0] || 'No records loaded.', true);
    }
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function loadCurrentInput() {
    const raw = state.mode === 'file'
      ? state.fileText
      : (inputTextarea?.value || '');

    if (!String(raw || '').trim()) {
      setRecords({ records: [], warnings: [], errors: ['Provide sequence input first.'] }, 'Idle');
      return;
    }

    const parsed = parseInputRecords(raw, { maxRecords: DEFAULT_MAX_RECORDS });
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setRecords(parsed, 'Loaded');
    setInputComposerVisible(!(Array.isArray(parsed.records) && parsed.records.length > 0));
  }

  async function persistRecordToLibrary(record, options = {}) {
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!storagePath) {
      throw new Error('Set Storage Folder Path in Settings before saving sequence entries.');
    }
    if (!bridge?.sequenceLibraryUpsert) {
      throw new Error('Sequence library storage API unavailable.');
    }
    const safeRecord = record && typeof record === 'object' ? record : null;
    if (!safeRecord?.sequence?.length) {
      throw new Error('No sequence record available to persist.');
    }

    const status = String(options?.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY).toLowerCase() === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const name = normalizeRecordName(
      options?.name || saveNameInput?.value || safeRecord.name || 'sequence',
      'sequence'
    );
    const gbkText = buildRecordGenbankText(safeRecord);
    if (!gbkText.trim()) {
      throw new Error('Failed to generate GenBank text for sequence entry.');
    }
    const htmlText = buildCircularPreviewHtmlDocument(safeRecord);
    const response = await bridge.sequenceLibraryUpsert({
      storagePath,
      id: cleanText(options?.id || state.activeEntryId, 200),
      name,
      status,
      sourceFormat: String(safeRecord.sourceFormat || ''),
      topology: normalizeTopology(safeRecord.topology || 'linear'),
      sequenceLength: safeRecord.sequence.length,
      featureCount: Array.isArray(safeRecord.features) ? safeRecord.features.length : 0,
      gbkText,
      htmlText
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to persist sequence entry.');
    }
    state.activeEntryId = cleanText(response.entry.id, 200);
    state.activeEntryStatus = String(response.entry.status || status).toLowerCase();
    if (saveNameInput) {
      saveNameInput.value = response.entry.name || name;
    }
    return response.entry;
  }

  async function persistAfterAnnotation(record) {
    const storagePath = getStoragePath();
    if (!storagePath) {
      state.annotationWarnings.push('pLannotate: Storage path not configured; annotation was not auto-saved.');
      return null;
    }
    const desiredStatus = state.activeEntryStatus === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const entry = await persistRecordToLibrary(record, {
      id: state.activeEntryId,
      status: desiredStatus,
      name: saveNameInput?.value || record.name || 'sequence'
    });
    await refreshLibraryEntries({ selectedId: entry.id, silent: true });
    return entry;
  }

  async function saveCurrentRecordAsSaved() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before saving.', true);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: LIBRARY_STATUS_SAVED,
        name: saveNameInput?.value || record.name || 'sequence'
      });
      state.activeEntryId = cleanText(entry.id, 200);
      state.activeEntryStatus = LIBRARY_STATUS_SAVED;
      await refreshLibraryEntries({ selectedId: entry.id, silent: true });
      setStatus(`Saved sequence as ${entry.name}.`);
      setHomeStatus(`Saved sequence entry: ${entry.name}.`);
    } catch (error) {
      setStatus(error?.message || 'Failed to save sequence.', true);
    }
  }

  async function openLibraryEntryInDetail(entryId) {
    const storagePath = getStoragePath();
    if (!storagePath) {
      setHomeStatus('Set Storage Folder Path in Settings before opening library entries.', true);
      return;
    }
    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }
    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: cleanText(entryId, 200),
        includeGbk: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load sequence entry.');
      }
      const parsed = parseInputRecords(String(response.gbkText || ''), { maxRecords: DEFAULT_MAX_RECORDS });
      if (!Array.isArray(parsed.records) || !parsed.records.length) {
        throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid records.');
      }

      state.activeEntryId = cleanText(response.entry.id, 200);
      state.activeEntryStatus = String(response.entry.status || '').toLowerCase();
      if (inputTextarea) {
        inputTextarea.value = String(response.gbkText || '');
      }
      if (saveNameInput) {
        saveNameInput.value = response.entry.name || parsed.records[0].name || 'sequence';
      }
      setMode('paste');
      setInputComposerVisible(false);
      setRecords(parsed, 'Loaded');
      navigateToDetail();
      setStatus(`Opened ${response.entry.name}.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open sequence entry.', true);
    }
  }

  function openParsedRecordsInDetail(parsed, rawText = '', statusPrefix = 'Loaded') {
    const hasRecords = Array.isArray(parsed?.records) && parsed.records.length > 0;
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (inputTextarea) {
      inputTextarea.value = rawText || '';
    }
    setMode('paste');
    setInputComposerVisible(!hasRecords);
    setRecords(parsed, statusPrefix);
    navigateToDetail();
  }

  async function annotateCurrentRecord() {
    if (state.isAnnotating) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before annotation.', true);
      return;
    }

    state.isAnnotating = true;
    state.annotationWarnings = [];
    syncAnnotateButtonState();
    updateMessages();
    setStatus(`Running pLannotate on ${record.name || 'record'}...`);

    try {
      const recordTopology = normalizeTopology(record.topology || 'linear');
      const result = await runPlannotateAnnotationForSequence(
        record.sequence,
        recordTopology,
        {
          ...PLANNOTATE_DEFAULT_OPTIONS,
          apiBridge: getBridge()
        }
      );
      const resultTopology = normalizeTopology(result?.topology || recordTopology);
      const plannotateFeatures = buildPlannotateFeaturesFromResult(result, record.sequence.length, resultTopology);

      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
      const nextRecords = [...state.records];
      const current = nextRecords[selectedIndex];
      if (!current) {
        throw new Error('Selected record no longer exists.');
      }

      const existingFeatures = Array.isArray(current.features) ? current.features : [];
      const retainedFeatures = existingFeatures.filter(
        (feature) => String(feature?.source || '').toLowerCase() !== 'plannotate'
      );

      current.features = [...retainedFeatures, ...plannotateFeatures];
      current.topology = resultTopology;

      state.records = nextRecords;
      state.selectedRecordIndex = selectedIndex;
      state.selectedFeatureIndex = -1;
      state.annotationWarnings = Array.isArray(result?.warnings)
        ? result.warnings.map((warning) => `pLannotate: ${String(warning)}`)
        : [];

      renderActiveRecord();
      try {
        await persistAfterAnnotation(current);
      } catch (persistError) {
        state.annotationWarnings.push(`pLannotate: ${String(persistError?.message || persistError)}`);
        updateMessages();
      }
      setStatus(`Completed: ${plannotateFeatures.length} pLannotate feature(s) on ${current.name || 'record'}.`);
    } catch (error) {
      setStatus(error?.message || 'Annotation failed.', true);
    } finally {
      state.isAnnotating = false;
      syncAnnotateButtonState();
    }
  }

  function clearAll() {
    if (inputTextarea) {
      inputTextarea.value = '';
    }
    if (fileInput) {
      fileInput.value = '';
    }
    if (fileNameLabel) {
      fileNameLabel.textContent = 'No file selected';
    }

    state.fileName = '';
    state.fileText = '';
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setMode('paste');
    setInputComposerVisible(true);
    hideFeatureContextMenu();
    hideFeatureEditor();
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    setStatus('Idle');
    if (saveNameInput) {
      saveNameInput.value = '';
    }
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

  modePasteBtn?.addEventListener('click', () => {
    setMode('paste');
  });

  modeFileBtn?.addEventListener('click', () => {
    setMode('file');
  });

  fileChooseBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      setStatus('Loading file...');
      state.fileText = await readFileAsText(file);
      state.fileName = String(file.name || '');
      if (fileNameLabel) {
        fileNameLabel.textContent = state.fileName || 'No file selected';
      }
      setStatus(`Loaded file: ${state.fileName || 'input'}`);
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (fileNameLabel) {
        fileNameLabel.textContent = 'No file selected';
      }
      setStatus(error.message || 'Failed to load file.', true);
    }
  });

  homePasteBtn?.addEventListener('click', () => {
    clearAll();
    navigateToDetail();
    setMode('paste');
    setInputComposerVisible(true);
    setStatus('Paste sequence text, then click Load.');
    inputTextarea?.focus?.();
    setHomeStatus('Opened a new sequence detail page.');
  });

  if (homeOpenInput && typeof homeOpenInput.setAttribute === 'function') {
    homeOpenInput.setAttribute('accept', FILE_ACCEPT);
  }

  homeOpenBtn?.addEventListener('click', () => {
    homeOpenInput?.click();
  });

  homeOpenInput?.addEventListener('change', async () => {
    const file = homeOpenInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      setHomeStatus(`Reading ${file.name}...`);
      const text = await readFileAsText(file);
      const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
      openParsedRecordsInDetail(parsed, text, 'Loaded');
      setStatus(`Opened ${file.name} in detail workspace.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open selected file.', true);
    } finally {
      homeOpenInput.value = '';
    }
  });

  loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCurrentInput();
  });

  annotateBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void annotateCurrentRecord();
  });

  orfToggle?.addEventListener('change', () => {
    setOrfViewEnabled(Boolean(orfToggle.checked));
  });

  orfStopModeSelect?.addEventListener('change', () => {
    state.orfStopMode = normalizeOrfStopDisplayMode(orfStopModeSelect.value);
    renderActiveRecord();
  });

  restrictionNebToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      neb: Boolean(restrictionNebToggle.checked)
    });
  });

  restrictionThermoToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      thermo: Boolean(restrictionThermoToggle.checked)
    });
  });

  clearBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    clearAll();
  });

  saveBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void saveCurrentRecordAsSaved();
  });

  backBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    navigateToHome();
    void refreshLibraryEntries({ silent: true });
  });

  libraryFilterSavedBtn?.addEventListener('click', () => {
    setLibraryFilter(LIBRARY_STATUS_SAVED);
    void refreshLibraryEntries({ silent: true });
  });

  libraryFilterTemporaryBtn?.addEventListener('click', () => {
    setLibraryFilter(LIBRARY_STATUS_TEMPORARY);
    void refreshLibraryEntries({ silent: true });
  });

  libraryList?.addEventListener('click', (event) => {
    const entryId = resolveLibraryEntryIdFromEvent(event);
    if (!entryId) {
      return;
    }
    if (Number.isFinite(Number(event?.detail)) && Number(event.detail) > 1) {
      return;
    }

    const now = Date.now();
    const previousEntryId = cleanText(state.lastLibraryClickEntryId, 200);
    const elapsedMs = now - (Number(state.lastLibraryClickAt) || 0);
    const isDoubleActivate = previousEntryId === entryId && elapsedMs >= 0 && elapsedMs <= 450;
    state.lastLibraryClickEntryId = entryId;
    state.lastLibraryClickAt = now;

    void setSelectedLibraryEntry(entryId);
    if (isDoubleActivate) {
      void openLibraryEntryInDetail(entryId);
    }
  });

  libraryList?.addEventListener('dblclick', (event) => {
    const entryId = resolveLibraryEntryIdFromEvent(event);
    if (!entryId) {
      return;
    }
    void setSelectedLibraryEntry(entryId);
    void openLibraryEntryInDetail(entryId);
  });

  recordSelect?.addEventListener('change', () => {
    state.selectedRecordIndex = clamp(Number(recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    hideFeatureContextMenu();
    hideFeatureEditor();
    renderActiveRecord();
    const selected = getSelectedRecord();
    if (selected && saveNameInput) {
      saveNameInput.value = normalizeRecordName(selected.name || 'sequence', 'sequence');
    }
  });

  featureRailHost?.addEventListener('click', (event) => {
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

  sequenceHost?.addEventListener('mousedown', (event) => {
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

  sequenceHost?.addEventListener('mousemove', (event) => {
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

  sequenceHost?.addEventListener('mouseleave', () => {
    hideSequenceHoverTooltip();
    if (state.isSelectingSequence) {
      return;
    }
    if (Number.isFinite(state.sequenceCursorBase)) {
      state.sequenceCursorBase = null;
      renderSequence(getSelectedRecord(), { preserveScroll: true });
    }
  });

  sequenceHost?.addEventListener('scroll', () => {
    hideSequenceHoverTooltip();
    hideFeatureContextMenu();
  });

  sequenceHost?.addEventListener('click', (event) => {
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

  sequenceHost?.addEventListener('mouseup', () => {
    if (!state.isSelectingSequence) {
      return;
    }
    state.isSelectingSequence = false;
    renderSequence(getSelectedRecord(), { preserveScroll: true });
    renderSelectedFeatureDetail(getSelectedRecord());
  });

  sequenceHost?.addEventListener('contextmenu', (event) => {
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

  featureContextMenu?.addEventListener('click', (event) => {
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

  featureEditorForm?.addEventListener('submit', (event) => {
    event.preventDefault?.();
    void applyFeatureEditorChanges();
  });

  featureEditorCloseBtn?.addEventListener('click', () => {
    hideFeatureEditor();
  });

  featureEditorCancelBtn?.addEventListener('click', () => {
    hideFeatureEditor();
  });

  featureEditorOverlay?.addEventListener('click', (event) => {
    if (event?.target === featureEditorOverlay) {
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

  function loadFromExternal(payload) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);

    setMode('paste');
    if (inputTextarea) {
      inputTextarea.value = record.sequence;
    }
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (saveNameInput) {
      saveNameInput.value = record.name || 'sequence';
    }

    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');
    setInputComposerVisible(!hasSequence);

    if (hasSequence) {
      navigateToDetail();
      setStatus(`Imported ${record.name} from ${record.sourceFormat || 'external'}.`);
    }
  }

  function render() {
    updateRecordSelect();
    renderActiveRecord();
    syncHomeControlsState();
    void refreshLibraryEntries({ silent: true });
  }

  setLibraryFilter(LIBRARY_STATUS_SAVED);
  setLocalWorkspaceVisibility('home');
  setMode('paste');
  setInputComposerVisible(true);
  setStatus('Paste sequence text, then click Load.');
  setHomeStatus('Choose New or Open to continue.');
  render();

  return {
    render,
    loadFromExternal
  };
}
