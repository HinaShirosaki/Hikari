import { setPlateText } from '../localization.js';

// Tabulator owns range dragging and scrolling. This tool arms a fresh gesture,
// then turns its completed range into one analysis group.
export function createGroupSelection({ elements, getResultGrid, getSelection, onCommit }) {
  const host = elements.assayResultTable;
  const doc = host?.ownerDocument || globalThis.document;
  const win = doc?.defaultView || globalThis;
  const hint = elements.assayGroupSelectionHint;
  const buttons = { row: elements.assayAnalysisAddRowGroupBtn, column: elements.assayAnalysisAddColumnGroupBtn };
  let dimension = '';
  let gesture = null;
  let generation = 0;

  function cancel() {
    dimension = '';
    gesture = null;
    generation++;
    host?.removeAttribute?.('data-group-selection');
    if (hint) hint.hidden = true;
    Object.values(buttons).forEach(button => button?.setAttribute?.('aria-pressed', 'false'));
  }

  function start(axis) {
    if (dimension === axis) { cancel(); return; }
    if (!getResultGrid()) return;
    cancel();
    dimension = axis;
    host?.setAttribute?.('data-group-selection', axis);
    buttons[axis]?.setAttribute?.('aria-pressed', 'true');
    if (hint) hint.hidden = false;
    setPlateText(elements.assayGroupSelectionHintText, axis === 'row' ? 'groups.dragRowsHint' : 'groups.dragColumnsHint');
    const EventCtor = win.CustomEvent;
    if (EventCtor) host?.dispatchEvent?.(new EventCtor('assay:group-selection-start', { bubbles: true }));
  }

  host?.addEventListener?.('pointerdown', event => {
    if (!dimension || event.button !== 0 || event.isPrimary === false) return;
    const target = event.target.closest?.(dimension === 'row' ? '.tabulator-row .tabulator-cell' : '[tabulator-field^="c"]');
    if (!target || !host.contains(target)) return;
    gesture = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false, generation };
  }, true);
  doc?.addEventListener?.('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4;
  }, true);
  doc?.addEventListener?.('pointerup', event => {
    const completed = gesture;
    if (!completed || event.pointerId !== completed.pointerId) return;
    gesture = null;
    if (!completed.moved || !host.contains(event.target)) return;
    // Capture the dragged range before native mouseup/click can move its focus
    // back to a single header cell. Commit after the native gesture has ended.
    const selection = getSelection();
    win.requestAnimationFrame(() => {
      if (dimension && completed.generation === generation && onCommit(dimension, selection)) cancel();
    });
  }, true);
  doc?.addEventListener?.('pointercancel', () => { gesture = null; }, true);
  doc?.addEventListener?.('keydown', event => {
    if (!dimension || event.key !== 'Escape') return;
    event.preventDefault();
    const button = buttons[dimension];
    cancel();
    button?.focus?.({ preventScroll: true });
  }, true);
  win.addEventListener?.('blur', cancel);
  elements.assayGroupSelectionCancelBtn?.addEventListener?.('click', cancel);

  const workspace = host?.closest?.('#assay-analyze-workspace');
  if (workspace && win.MutationObserver) {
    const observer = new win.MutationObserver(() => {
      if (dimension && (host.closest('[hidden]') || (doc.body.dataset.activeView && doc.body.dataset.activeView !== 'assay-view'))) cancel();
    });
    observer.observe(workspace, { attributes: true, attributeFilter: ['data-workspace-view', 'data-data-tab'] });
    if (elements.assayResultsLayout) observer.observe(elements.assayResultsLayout, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-active-view'] });
  }
  return { start, cancel, isActive: () => Boolean(dimension) };
}
