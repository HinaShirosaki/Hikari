import { escapeHtml } from '../../../lib/html.js';
import { FALLBACK_CHAR_ADVANCE_PX } from '../constants.js';
import {
  computeSequenceLayoutMetrics,
  resolveSequenceBoundaryFromEvent
} from '../detail-layout.js';
import { createSequenceViewerSequenceEditingController } from '../detail-sequence-editing.js';
import { getRenderableFeaturesForRecord } from '../feature-model.js';
import { isPrimerBindingFeature, normalizeFeatureType } from '../feature-types.js';
import {
  normalizeHighlightSegments,
  renderDualStrandSequenceLinesHtml
} from '../rendering.js';
import { cleanText, clamp, normalizeSequenceText, reverseComplementIupac } from '../shared.js';
import { attachMapHoverLabel } from './map-hover.js';
import { attachMapZoomGestures } from './map-zoom.js';
import { buildSequenceMapSvg, getMapKind, resolveBaseFromPoint } from './sequence-map.js';

// Element keys the reused detail sequence-editing controller reads, mapped onto
// the Vector Builder's own dialog. Reusing that controller (rather than forking
// it) is what keeps base editing identical across both workspaces.
const EDITING_ELEMENT_MAP = {
  sequenceEditOverlay: 'vectorBuilderSequenceEditOverlay',
  sequenceEditTitle: 'vectorBuilderSequenceEditTitle',
  sequenceEditNote: 'vectorBuilderSequenceEditNote',
  sequenceEditInputWrap: 'vectorBuilderSequenceEditInputWrap',
  sequenceEditTextarea: 'vectorBuilderSequenceEditTextarea',
  sequenceEditDeleteMessage: 'vectorBuilderSequenceEditDeleteMessage',
  sequenceEditConfirmBtn: 'vectorBuilderSequenceEditConfirm'
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
    rootDocument
  });

  const editingElements = {};
  Object.entries(EDITING_ELEMENT_MAP).forEach(([key, elementKey]) => {
    editingElements[key] = elements[elementKey];
  });

  function getVisibleFeatures(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: false,
      includeRestriction: Boolean(vb().showCutters),
      restrictionVendorFilter: state.restrictionVendorFilter
    });
  }

  function getFeatureByIndex(record, index) {
    if (!record || !Number.isFinite(index) || index < 0) {
      return null;
    }
    return getVisibleFeatures(record)[index] || null;
  }

  function clearSelection(options = {}) {
    const current = vb();
    current.selectionAnchor = null;
    current.selectionFocus = null;
    current.isSelecting = false;
    if (!options?.preserveCursor) {
      current.cursorBase = null;
    }
  }

  function getSelectionRange(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const current = vb();
    const anchor = Number(current.selectionAnchor);
    const focus = Number(current.selectionFocus);
    if (!sequenceLength || !Number.isFinite(anchor) || !Number.isFinite(focus)) {
      return null;
    }
    const start = clamp(Math.min(anchor, focus), 0, sequenceLength);
    const end = clamp(Math.max(anchor, focus), 0, sequenceLength);
    return end > start ? { start, end } : null;
  }

  const sequenceEditing = createSequenceViewerSequenceEditingController({
    rootDocument,
    elements: editingElements,
    state: editingState,
    getSelectedRecord,
    getSequenceSelectionRange: getSelectionRange,
    clearSequenceSelection: clearSelection,
    hideFeatureContextMenu: () => hideContextMenu(),
    renderSequence: () => render(),
    renderSelectedFeatureDetail: () => {},
    setStatus,
    onApplySequenceEdit
  });

  function hideContextMenu() {
    if (elements.vectorBuilderContextMenu) {
      elements.vectorBuilderContextMenu.hidden = true;
    }
  }

  // Replace Feature works on the record's *recorded* features -- the annotations
  // actually stored in the GenBank -- not on the derived overlays (restriction
  // sites), which have nothing to rewrite, nor on primer binding sites.
  let featureReplaceIndex = -1;
  let featureReplaceQuery = '';
  let featureReplaceResults = [];

  function getRecordedFeaturesInRange(record, range) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const start = Math.max(0, Number(range?.start) || 0);
    const end = Math.max(start, Number(range?.end) || start);
    return (Array.isArray(record?.features) ? record.features : [])
      .map((feature, index) => ({ feature, index, range: getFeatureRange(feature, sequenceLength) }))
      .filter((entry) => entry.range
        && entry.range.start < end
        && start < entry.range.end
        && !isPrimerRelatedType(entry.feature?.type));
  }

  function hideFeatureReplaceDialog() {
    featureReplaceIndex = -1;
    if (elements.vectorBuilderFeatureReplaceOverlay) {
      elements.vectorBuilderFeatureReplaceOverlay.hidden = true;
    }
  }

  function setFeatureReplaceStatus(message, isError = false) {
    if (!elements.vectorBuilderFeatureReplaceStatus) {
      return;
    }
    elements.vectorBuilderFeatureReplaceStatus.textContent = String(message || '');
    elements.vectorBuilderFeatureReplaceStatus.style.color = isError ? 'var(--theme-danger)' : '';
  }

  function describeFeatureReplaceTarget(record) {
    const feature = (Array.isArray(record?.features) ? record.features : [])[featureReplaceIndex] || null;
    const range = getFeatureRange(feature, Math.max(0, Number(record?.sequence?.length) || 0));
    if (!feature || !range || !elements.vectorBuilderFeatureReplaceNote) {
      return;
    }
    elements.vectorBuilderFeatureReplaceNote.textContent =
      `Replacing ${feature.name || feature.type || 'feature'} at ${formatRangeLabel(range)} with a stored feature.`;
  }

  function renderFeatureReplaceResults() {
    const host = elements.vectorBuilderFeatureReplaceResults;
    if (!host) {
      return;
    }
    if (!featureReplaceQuery) {
      host.innerHTML = '<p class="small-note">Search by feature name or stored sequence.</p>';
      return;
    }
    if (!featureReplaceResults.length) {
      host.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(featureReplaceQuery)}".</p>`;
      return;
    }
    host.innerHTML = featureReplaceResults.map((feature) => {
      const length = Math.max(0, Number(feature?.sequenceLength) || normalizeSequenceText(feature?.sequence || '').length);
      const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
      return `
        <article class="sequence-viewer-protein-builder-feature-item">
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(feature?.name || 'feature')}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${length.toLocaleString()} bp | in ${hostCount} vector${hostCount === 1 ? '' : 's'}</p>
            </div>
            <button type="button" class="ghost-btn" data-vector-replace-feature-id="${escapeHtml(String(feature?.id || ''))}">Use This Feature</button>
          </div>
        </article>
      `;
    }).join('');
  }

  async function runFeatureReplaceSearch() {
    const query = cleanText(elements.vectorBuilderFeatureReplaceSearch?.value, 600);
    featureReplaceQuery = query;
    const storagePath = getStoragePath();
    const bridge = getBridge();

    if (!storagePath) {
      featureReplaceResults = [];
      renderFeatureReplaceResults();
      setFeatureReplaceStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }
    if (query.length < 2) {
      featureReplaceResults = [];
      renderFeatureReplaceResults();
      setFeatureReplaceStatus('Enter at least 2 characters to search stored features.');
      return;
    }
    if (!bridge?.sequenceLibrarySearchFeatures) {
      featureReplaceResults = [];
      renderFeatureReplaceResults();
      setFeatureReplaceStatus('Feature search API unavailable.', true);
      return;
    }

    setFeatureReplaceStatus(`Searching for "${query}"...`);
    try {
      const response = await bridge.sequenceLibrarySearchFeatures({ storagePath, query, limit: 24 });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to search stored features.');
      }
      featureReplaceResults = (Array.isArray(response.results) ? response.results : [])
        .filter((feature) => normalizeSequenceText(feature?.sequence || '').length > 0)
        .filter((feature) => !isPrimerRelatedType(feature?.type));
      renderFeatureReplaceResults();
      setFeatureReplaceStatus(`Found ${featureReplaceResults.length} stored feature${featureReplaceResults.length === 1 ? '' : 's'}.`);
    } catch (error) {
      featureReplaceResults = [];
      renderFeatureReplaceResults();
      setFeatureReplaceStatus(error?.message || 'Failed to search stored features.', true);
    }
  }

  function hideOverlays() {
    hideContextMenu();
    hideFeatureReplaceDialog();
    sequenceEditing.hideSequenceEditDialog();
  }

  function openFeatureReplaceDialog(record, range) {
    const candidates = getRecordedFeaturesInRange(record, range);
    if (!candidates.length) {
      setStatus('No replaceable feature in that range. Primer binding sites cannot be replaced.', true);
      return;
    }

    // Prefer whichever feature is already selected on the map.
    const selected = getFeatureByIndex(record, vb().selectedFeatureIndex);
    const preferred = candidates.find((entry) => entry.feature === selected) || candidates[0];
    featureReplaceIndex = preferred.index;
    featureReplaceQuery = '';
    featureReplaceResults = [];

    if (elements.vectorBuilderFeatureReplaceSelect) {
      elements.vectorBuilderFeatureReplaceSelect.innerHTML = candidates
        .map((entry) => `<option value="${entry.index}"${entry.index === featureReplaceIndex ? ' selected' : ''}>${escapeHtml(`${entry.feature.name || entry.feature.type || 'feature'} (${formatRangeLabel(entry.range)})`)}</option>`)
        .join('');
      elements.vectorBuilderFeatureReplaceSelect.value = String(featureReplaceIndex);
    }
    if (elements.vectorBuilderFeatureReplaceSearch) {
      elements.vectorBuilderFeatureReplaceSearch.value = '';
    }

    describeFeatureReplaceTarget(record);
    renderFeatureReplaceResults();
    const hasStorage = Boolean(getStoragePath());
    setFeatureReplaceStatus(
      hasStorage
        ? 'Search the stored feature database for a replacement.'
        : 'Set Storage Folder Path in Settings to search stored features.',
      !hasStorage
    );
    if (elements.vectorBuilderFeatureReplaceOverlay) {
      elements.vectorBuilderFeatureReplaceOverlay.hidden = false;
    }
    elements.vectorBuilderFeatureReplaceSearch?.focus?.();
  }

  async function applyFeatureReplace(storedFeatureId) {
    const stored = featureReplaceResults
      .find((item) => cleanText(item?.id, 200) === cleanText(storedFeatureId, 200));
    const record = getSelectedRecord();
    const target = (Array.isArray(record?.features) ? record.features : [])[featureReplaceIndex] || null;
    const range = getFeatureRange(target, Math.max(0, Number(record?.sequence?.length) || 0));
    if (!stored || !target || !range) {
      return;
    }

    const storedSequence = normalizeSequenceText(stored.sequence || '');
    if (!storedSequence.length) {
      setFeatureReplaceStatus('That stored feature has no sequence to insert.', true);
      return;
    }

    // Keep the site's orientation: dropping a stored (plus-strand) sequence onto
    // a reverse-strand feature has to go in as its reverse complement, or the
    // construct reads the wrong way round.
    const strand = Number(target.strand) === -1 ? -1 : 1;
    const replacement = strand === -1 ? reverseComplementIupac(storedSequence) : storedSequence;
    const targetIndex = featureReplaceIndex;
    const previousName = String(target.name || 'feature');
    const nextName = cleanText(stored.name, 140) || previousName;

    try {
      // Rewrite the bases through the shared edit action, which resizes the
      // feature's own span and feeds the Cloning Design handoff.
      await onApplySequenceEdit({ mode: 'replace', range, sequence: replacement });
    } catch (error) {
      setFeatureReplaceStatus(error?.message || 'Failed to replace the feature.', true);
      return;
    }

    const editedRecord = getSelectedRecord();
    const features = Array.isArray(editedRecord?.features) ? [...editedRecord.features] : [];
    if (features[targetIndex]) {
      features[targetIndex] = {
        ...features[targetIndex],
        name: nextName,
        type: normalizeFeatureType(cleanText(stored.type, 120)),
        strand,
        locationText: '',
        source: 'vector_builder',
        description: `Replaced from the stored feature database (${storedSequence.length} bp).`,
        segments: [{ start: range.start, end: range.start + replacement.length }]
      };
      const records = [...state.records];
      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, records.length - 1));
      const nextRecord = { ...records[selectedIndex], features };
      records[selectedIndex] = nextRecord;
      state.records = records;

      hideFeatureReplaceDialog();
      clearSelection();
      vb().selectedFeatureIndex = -1;
      render();

      try {
        await persistFeatureMutation(nextRecord, `Replaced ${previousName} with ${nextName}.`);
      } catch (error) {
        setStatus(error?.message || 'Replaced the feature but failed to save it.', true);
        return;
      }
    } else {
      hideFeatureReplaceDialog();
      render();
    }
    setStatus(`Replaced ${previousName} with stored feature ${nextName} (${replacement.length.toLocaleString()} bp).`);
  }

  function getFeatureRange(feature, sequenceLength) {
    const segments = Array.isArray(feature?.segments) ? feature.segments : [];
    if (!segments.length) {
      return null;
    }
    const start = Math.max(0, Math.min(...segments.map((segment) => Number(segment?.start) || 0)));
    const end = Math.min(sequenceLength, Math.max(...segments.map((segment) => Number(segment?.end) || 0)));
    return end > start ? { start, end } : null;
  }

  // The range every base-level action operates on: an explicit drag selection
  // wins, otherwise the selected feature's own span, otherwise the caret.
  function getActionContext(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const selection = getSelectionRange(record);
    if (selection) {
      return { range: selection, strand: 1, feature: null };
    }
    const feature = getFeatureByIndex(record, vb().selectedFeatureIndex);
    const featureRange = getFeatureRange(feature, sequenceLength);
    if (featureRange) {
      return {
        range: featureRange,
        strand: Number(feature?.strand) === -1 ? -1 : 1,
        feature,
        sequenceLength
      };
    }
    const cursor = Number(vb().cursorBase);
    if (Number.isFinite(cursor)) {
      return { range: { start: cursor, end: cursor }, strand: 1, feature: null, sequenceLength };
    }
    return null;
  }

  // A feature's termini are its first and last recorded segment boundaries, not
  // the edges of its flattened span. For a joined or origin-spanning feature the
  // flattened min/max lands inside an intron or on the wrong side of the origin.
  function getFeatureTerminus(feature, side, sequenceLength) {
    const segments = Array.isArray(feature?.segments) ? feature.segments : [];
    if (!segments.length) {
      return null;
    }
    const clamp = (value) => Math.min(Math.max(0, Number(value) || 0), Math.max(0, sequenceLength));
    const first = clamp(segments[0]?.start);
    const last = clamp(segments[segments.length - 1]?.end);
    const atFivePrime = side === 'five';
    return Number(feature?.strand) === -1
      ? (atFivePrime ? last : first)
      : (atFivePrime ? first : last);
  }

  function getActionRange(record) {
    return getActionContext(record)?.range || null;
  }

  // 5'/3' are read in the target's own orientation: a reverse-strand feature's
  // 5' end sits at the higher coordinate, so inserting "before 5'" there means
  // inserting at the end of its span, not the start. A bare drag selection has
  // no orientation, so it follows the plus strand.
  function resolveInsertAnchor(context, side) {
    const range = context?.range;
    if (!range) {
      return null;
    }
    if (range.end <= range.start) {
      return range.start;
    }
    const terminus = getFeatureTerminus(context.feature, side, context.sequenceLength);
    if (terminus !== null) {
      return terminus;
    }
    const atFivePrime = side === 'five';
    return Number(context.strand) === -1
      ? (atFivePrime ? range.end : range.start)
      : (atFivePrime ? range.start : range.end);
  }

  function renderContextMenu(record, event) {
    const menu = elements.vectorBuilderContextMenu;
    if (!menu) {
      return;
    }
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const range = getActionRange(record);
    const hasRange = Boolean(range && range.end > range.start);
    const rangeLabel = range ? formatRangeLabel(range) : '';
    const disabledRange = hasRange ? '' : ' disabled';

    // With a span selected, an insert has two meaningful sides; at a bare caret
    // there is only the one position, so offering sides would be noise.
    const insertBaseItems = hasRange
      ? `<button type="button" class="sequence-viewer-context-item" data-vector-action="insert-bases-five">Insert Bases Before 5'...</button>
      <button type="button" class="sequence-viewer-context-item" data-vector-action="insert-bases-three">Insert Bases After 3'...</button>`
      : '<button type="button" class="sequence-viewer-context-item" data-vector-action="insert-bases">Insert Bases...</button>';
    const insertProteinItems = hasRange
      ? `<button type="button" class="sequence-viewer-context-item" data-vector-action="protein-insert-five">Insert Protein Construct Before 5'...</button>
      <button type="button" class="sequence-viewer-context-item" data-vector-action="protein-insert-three">Insert Protein Construct After 3'...</button>`
      : '<button type="button" class="sequence-viewer-context-item" data-vector-action="protein-insert">Insert Protein Construct...</button>';

    menu.innerHTML = `
      ${rangeLabel ? `<p class="small-note">${escapeHtml(rangeLabel)}</p>` : ''}
      ${insertBaseItems}
      <button type="button" class="sequence-viewer-context-item" data-vector-action="replace-feature"${disabledRange}>Replace Feature...</button>
      <button type="button" class="sequence-viewer-context-item sequence-viewer-context-item-danger" data-vector-action="delete-bases"${disabledRange}>Delete Bases${hasRange ? ` (${(range.end - range.start).toLocaleString()} bp)` : ''}</button>
      <hr class="sequence-viewer-context-divider" />
      ${insertProteinItems}
      <button type="button" class="sequence-viewer-context-item" data-vector-action="protein-replace"${disabledRange}>Replace With Protein Construct...</button>
    `;
    menu.hidden = false;
    menu.dataset.sequenceLength = String(sequenceLength);
    positionFloatingMenu(menu, Number(event?.clientX) + 4, Number(event?.clientY) + 4);
  }

  function runContextAction(action) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      return;
    }
    const context = getActionContext(record);
    const range = context?.range || null;
    const caret = Number.isFinite(Number(vb().cursorBase))
      ? Number(vb().cursorBase)
      : Math.max(0, Number(range?.start) || 0);

    const insertSide = action.endsWith('-five')
      ? 'five'
      : (action.endsWith('-three') ? 'three' : null);
    const insertAt = insertSide ? resolveInsertAnchor(context, insertSide) : caret;
    const sideLabel = insertSide === 'five' ? "5'" : (insertSide === 'three' ? "3'" : '');
    const targetName = cleanText(context?.feature?.name, 120);

    if (action.startsWith('protein-insert') || action === 'protein-replace') {
      const isReplace = action === 'protein-replace';
      if (isReplace && !(range && range.end > range.start)) {
        setStatus('Select a range or feature before replacing it with a protein construct.', true);
        return;
      }
      const at = isReplace ? range.start : insertAt;
      hideOverlays();
      vb().insertTarget = {
        mode: isReplace ? 'replace' : 'insert',
        start: at,
        end: isReplace ? range.end : at,
        recordName: String(record?.name || 'vector'),
        label: isReplace
          ? `Replace ${formatRangeLabel(range)}`
          : `Insert at ${(at + 1).toLocaleString()}${sideLabel ? ` (${sideLabel}${targetName ? ` of ${targetName}` : ''})` : ''}`
      };
      onRequestProteinInsert(vb().insertTarget);
      return;
    }

    if (action.startsWith('insert-bases')) {
      hideContextMenu();
      sequenceEditing.openSequenceEditDialog('insert', { range: { start: insertAt, end: insertAt } });
      return;
    }
    if (!range || range.end <= range.start) {
      setStatus('Select bases or a feature first.', true);
      return;
    }
    if (action === 'replace-feature') {
      hideContextMenu();
      openFeatureReplaceDialog(record, range);
      return;
    }
    if (action === 'delete-bases') {
      hideContextMenu();
      sequenceEditing.openSequenceEditDialog('delete', { range });
    }
  }

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
    if (elements.vectorBuilderProteinBuilderBtn) {
      elements.vectorBuilderProteinBuilderBtn.disabled = !hasRecord;
    }
    if (elements.vectorBuilderCloningDesignBtn) {
      elements.vectorBuilderCloningDesignBtn.disabled = !hasRecord;
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
    setStatus(`Vector Builder open for ${record.name || 'the active record'}.`);
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

  // Protein Builder folded in: splice a built construct straight into the open
  // vector at the site picked on the map, instead of assembling against a
  // separate stored backbone. Goes through the shared sequence-edit action so
  // the Cloning Design handoff sees the edit like any other.
  async function applyProteinConstruct({ constructName, dnaConstruct } = {}) {
    const target = vb().insertTarget;
    const record = getSelectedRecord();
    const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
    if (!target) {
      setStatus('Pick an insertion site on the vector map first.', true);
      return false;
    }
    if (!record?.sequence?.length || !insertSequence.length) {
      setStatus('Build the construct DNA before inserting it into the vector.', true);
      return false;
    }

    const sequenceLength = record.sequence.length;
    const mode = target.mode === 'replace' ? 'replace' : 'insert';
    const start = clamp(Math.round(Number(target.start) || 0), 0, sequenceLength);
    const end = mode === 'replace'
      ? clamp(Math.round(Number(target.end) || start), start, sequenceLength)
      : start;
    if (mode === 'replace' && end <= start) {
      setStatus('The replacement target is empty. Select a range on the map again.', true);
      return false;
    }

    const label = cleanText(constructName, 140) || 'Protein construct';
    try {
      await onApplySequenceEdit({ mode, range: { start, end }, sequence: insertSequence });
    } catch (error) {
      setStatus(error?.message || 'Failed to insert the protein construct.', true);
      return false;
    }

    const editedRecord = getSelectedRecord();
    const nextFeatures = Array.isArray(editedRecord?.features) ? [...editedRecord.features] : [];
    nextFeatures.push({
      id: `vector_builder_insert_${Date.now().toString(36)}`,
      name: label,
      type: 'insert',
      strand: 1,
      source: 'vector_builder',
      description: `Protein Builder construct inserted at ${(start + 1).toLocaleString()}.`,
      segments: [{ start, end: start + insertSequence.length }]
    });

    let cursor = start;
    (Array.isArray(dnaConstruct?.parts) ? dnaConstruct.parts : []).forEach((part, index) => {
      const partSequence = normalizeSequenceText(part?.dnaSequence || '');
      if (!partSequence.length) {
        return;
      }
      nextFeatures.push({
        id: `vector_builder_insert_part_${Date.now().toString(36)}_${index}`,
        name: cleanText(part?.label, 160) || `Block ${index + 1}`,
        type: 'misc_feature',
        strand: 1,
        source: 'vector_builder',
        description: `Protein Builder DNA block (${partSequence.length} bp).`,
        segments: [{ start: cursor, end: cursor + partSequence.length }]
      });
      cursor += partSequence.length;
    });

    const records = [...state.records];
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, records.length - 1));
    const nextRecord = { ...records[selectedIndex], features: nextFeatures };
    records[selectedIndex] = nextRecord;
    state.records = records;

    vb().insertTarget = null;
    clearSelection();
    vb().selectedFeatureIndex = -1;
    hideOverlays();
    onNavigateVectorBuilder();
    render();

    try {
      await persistFeatureMutation(nextRecord, `Inserted ${label} (${insertSequence.length} bp) into the vector.`);
    } catch (error) {
      setStatus(error?.message || 'Inserted the construct but failed to save it.', true);
      return true;
    }
    setStatus(`Inserted ${label} (${insertSequence.length.toLocaleString()} bp) into ${nextRecord.name || 'the vector'}.`);
    return true;
  }

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

    elements.vectorBuilderCloningDesignBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      hideOverlays();
      onRequestCloningDesign();
    });

    elements.vectorBuilderProteinBuilderBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      runContextAction('protein-insert');
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

    elements.vectorBuilderFeatureReplaceSelect?.addEventListener('change', () => {
      const nextIndex = Number(elements.vectorBuilderFeatureReplaceSelect.value);
      if (!Number.isFinite(nextIndex)) {
        return;
      }
      featureReplaceIndex = nextIndex;
      describeFeatureReplaceTarget(getSelectedRecord());
    });

    // Enter in the search box searches; picking a result applies immediately.
    elements.vectorBuilderFeatureReplaceForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void runFeatureReplaceSearch();
    });
    elements.vectorBuilderFeatureReplaceSearchBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void runFeatureReplaceSearch();
    });
    elements.vectorBuilderFeatureReplaceResults?.addEventListener('click', (event) => {
      const featureId = event.target?.closest?.('[data-vector-replace-feature-id]')
        ?.dataset?.vectorReplaceFeatureId;
      if (featureId) {
        void applyFeatureReplace(featureId);
      }
    });
    elements.vectorBuilderFeatureReplaceClose?.addEventListener('click', hideFeatureReplaceDialog);
    elements.vectorBuilderFeatureReplaceCancel?.addEventListener('click', hideFeatureReplaceDialog);

    elements.vectorBuilderSequenceEditForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void sequenceEditing.applySequenceEditDialog();
    });
    elements.vectorBuilderSequenceEditClose?.addEventListener('click', () => sequenceEditing.hideSequenceEditDialog());
    elements.vectorBuilderSequenceEditCancel?.addEventListener('click', () => sequenceEditing.hideSequenceEditDialog());

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
