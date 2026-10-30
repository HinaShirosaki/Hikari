import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { normalizeStackTrim } from './trim.js';

// The editor uses the full aligned image while the shaded margins show what
// will be removed. Normalized storage coordinates keep older projects portable.
export function createCanvasTrimEditor({ container, getPlan, onRender, onApply }) {
  const documentObject = container.ownerDocument;
  const view = documentObject.defaultView;
  let active = false;
  let draft = null;
  let initial = null;
  let overlay = null;
  let drag = null;
  const disposers = [];
  function listen(type, handler) {
    container.addEventListener(type, handler, true);
    disposers.push(() => container.removeEventListener(type, handler, true));
  }
  function geometry() {
    const canvas = container.querySelector('canvas');
    const plan = getPlan();
    if (!canvas || !plan) return null;
    const rect = canvas.getBoundingClientRect();
    return { canvas, plan, rect, scale: rect.width / plan.width };
  }
  function update() {
    const box = geometry();
    if (!active || !overlay || !box?.scale) return;
    const { canvas, plan, rect, scale } = box;
    Object.assign(overlay.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const start = plan.imageLeft * scale;
    const width = plan.fullImageWidth * scale;
    const left = draft.left / 100 * width;
    const right = draft.right / 100 * width;
    for (const edge of ['left', 'right']) {
      const handle = overlay.querySelector(`[data-trim-edge="${edge}"]`);
      handle.style.left = `${start + (edge === 'left' ? left : right)}px`;
      handle.setAttribute('aria-valuemax', String(Math.round(plan.fullImageWidth)));
      handle.setAttribute('aria-valuenow', String(Math.round(draft[edge] / 100 * plan.fullImageWidth)));
    }
    const before = overlay.querySelector('[data-trim-shade="left"]');
    const after = overlay.querySelector('[data-trim-shade="right"]');
    Object.assign(before.style, { left: `${start}px`, width: `${left}px` });
    Object.assign(after.style, { left: `${start + right}px`, width: `${width - right}px` });
  }
  const observer = view.ResizeObserver ? new view.ResizeObserver(update) : null;
  function render() {
    if (!active) return;
    overlay = documentObject.createElement('div'); overlay.className = 'gel-trim-overlay';
    for (const edge of ['left', 'right']) {
      const shade = documentObject.createElement('div'); shade.className = 'gel-trim-shade'; shade.dataset.trimShade = edge;
      const handle = documentObject.createElement('button'); handle.type = 'button'; handle.className = 'gel-trim-edge'; handle.dataset.trimEdge = edge;
      handle.setAttribute('role', 'slider'); handle.setAttribute('aria-orientation', 'horizontal'); handle.setAttribute('aria-valuemin', '0');
      i18nUi.setAttribute(handle, "aria-label", i18nUi.message("{p0} trim edge", { p0: edge === 'left' ? 'Left' : 'Right' }));
      i18nUi.setAttribute(handle, "title", i18nUi.message("Drag to set the trim edge. Arrow keys adjust; Shift moves farther."));
      overlay.append(shade, handle);
    }
    container.classList.add('is-trimming'); container.append(overlay);
    observer?.disconnect(); observer?.observe(container); observer?.observe(container.querySelector('canvas'));
    update();
  }
  function endDrag() {
    const pointerId = drag?.pointerId; drag = null;
    if (pointerId != null && container.hasPointerCapture?.(pointerId)) container.releasePointerCapture(pointerId);
  }
  function clear() {
    endDrag(); observer?.disconnect(); overlay?.remove(); overlay = null;
    container.classList.remove('is-trimming');
  }
  function setEdge(edge, value) {
    const width = getPlan()?.fullImageWidth;
    if (!(width > 0)) return;
    const minimum = 100.001 / width;
    draft[edge] = edge === 'left' ? Math.max(0, Math.min(draft.right - minimum, value))
      : Math.min(100, Math.max(draft.left + minimum, value));
    update();
  }
  function movePointer(event, edge) {
    const box = geometry();
    if (box?.scale) setEdge(edge, ((event.clientX - box.rect.left) / box.scale - box.plan.imageLeft) / box.plan.fullImageWidth * 100);
  }
  listen('pointerdown', event => {
    if (!active || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const box = geometry(); if (!box?.scale) return;
    let edge = event.target.closest('[data-trim-edge]')?.dataset.trimEdge;
    if (!edge) {
      const x = ((event.clientX - box.rect.left) / box.scale - box.plan.imageLeft) / box.plan.fullImageWidth * 100;
      if (x < 0 || x > 100 || event.clientY < box.rect.top || event.clientY > box.rect.bottom) return;
      edge = Math.abs(x - draft.left) <= Math.abs(x - draft.right) ? 'left' : 'right';
    }
    endDrag(); drag = { edge, pointerId: event.pointerId };
    try { container.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
    movePointer(event, edge); overlay.querySelector(`[data-trim-edge="${edge}"]`).focus({ preventScroll: true });
  });
  listen('pointermove', event => {
    if (!active) return;
    event.stopImmediatePropagation();
    if (drag?.pointerId === event.pointerId) movePointer(event, drag.edge);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(type, event => {
    if (!active || drag?.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation(); endDrag();
  });
  listen('keydown', event => {
    const edge = event.target.dataset.trimEdge;
    if (!active || !edge || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const box = geometry(); if (!box?.scale) return;
    const delta = (event.shiftKey ? 10 : 1) / box.scale / box.plan.fullImageWidth * 100;
    setEdge(edge, event.key === 'Home' ? 0 : event.key === 'End' ? 100 : draft[edge] + (event.key === 'ArrowLeft' ? -delta : delta));
  });
  return {
    isActive: () => active,
    isChanged: () => active && (draft.left !== initial.left || draft.right !== initial.right),
    render,
    start(crop) {
      draft = normalizeStackTrim({ mode: 'manual', left: crop.left, right: crop.right }); initial = { ...draft };
      active = true; onRender(); overlay.querySelector('[data-trim-edge="left"]').focus({ preventScroll: true });
    },
    apply() {
      if (!active) return;
      onApply(normalizeStackTrim(draft)); active = false; clear(); onRender();
    },
    cancel(redraw = true) {
      if (!active) return;
      active = false; clear(); if (redraw) onRender();
    },
    destroy() { active = false; clear(); disposers.forEach(dispose => dispose()); }
  };
}
