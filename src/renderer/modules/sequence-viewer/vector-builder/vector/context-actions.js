import { escapeHtml } from '../../../../lib/html.js';
import { cleanText } from '../../shared.js';

// The vector map's right-click menu: what the click landed on, which range it
// covers, and the edit each menu item runs.
function createVectorContextActions({
  elements,
  vb,
  getSelectedRecord,
  getSelectionRange,
  getFeatureByIndex,
  hideContextMenu,
  hideOverlays,
  openFeatureReplaceDialog,
  setStatus,
  sequenceEditing,
  formatRangeLabel,
  positionFloatingMenu,
  onRequestPrimerDesign,
  onRequestProteinInsert
} = {}) {
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
      <button type="button" class="sequence-viewer-context-item" data-vector-action="design-primer"${disabledRange}>Design Primer</button>
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
      sequenceEditing.openSequenceEditDialog('insert', {
        range: { start: insertAt, end: insertAt },
        feature: context?.feature
      });
      return;
    }
    if (!range || range.end <= range.start) {
      setStatus('Select bases or a feature first.', true);
      return;
    }
    if (action === 'design-primer') {
      hideContextMenu();
      // The detail workspace owns the dialog; the map only supplies the target
      // range, so both surfaces design primers the same way.
      onRequestPrimerDesign({ selectionRange: range });
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

  return {
    getFeatureRange,
    getActionContext,
    getFeatureTerminus,
    getActionRange,
    resolveInsertAnchor,
    renderContextMenu,
    runContextAction
  };
}

export { createVectorContextActions };
