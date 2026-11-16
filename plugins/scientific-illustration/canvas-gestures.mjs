import { element, interactionBox, stretchSvg } from './artwork.mjs';
import {
  angleDelta, rectanglePoints, regionSelection, resizeAnchor, resizeObject, resizeSelection,
  rotateComponents, selectionBounds, smartGuideTargets, snapTranslation, transformSelection
} from './geometry.mjs';

export function createCanvasGestures({
  document, getContext, hitTest, isEditingText, select, setSelection, targetIds, selectedObjects, selectionTarget,
  edit, editLabel, render, renderCanvas, syncSelectionToolbar, syncTools
}) {
  const $ = id => document.getElementById(id);
  const key = 'main';
  const stage = $('main-canvas');
  let drag = null, areaDrag = null, lastClick = null;

  function cancelDrag({ restoreSelection = false } = {}) {
    if (!drag) return;
    const stage = $(`${drag.canvas}-canvas`), pointerId = drag.pointerId;
    if (restoreSelection && drag.shiftClick) setSelection(drag.shiftClick.previousIds);
    drag = null;
    if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  }

  // Drag previews are transient. The final edit uses the revision captured on
  // pointer-down, so an intervening agent edit cannot be silently overwritten.
  function point(svg, event) { return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse()); }
  function cancelAreaSelection() {
    if (!areaDrag) return;
    const { canvas, pointerId } = areaDrag; areaDrag = null;
    const stage = $(`${canvas}-canvas`);
    stage.classList.remove('is-area-selecting'); stage.querySelector('.selection-region')?.remove();
    if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
    syncSelectionToolbar();
  }
  function renderSelectionRegion() {
    if (!areaDrag) return;
    const svg = $(`${areaDrag.canvas}-canvas`).querySelector('svg');
    let region = svg.querySelector('.selection-region');
    if (!region) { region = element('polygon', { class: 'selection-region', 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd', 'aria-hidden': 'true' }); svg.append(region); }
    const points = areaDrag.mode === 'rectangle' ? rectanglePoints(areaDrag.start, areaDrag.end) : areaDrag.points;
    region.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
  }
  function updateSelectionRegion(event, final = false) {
    const current = point($(`${areaDrag.canvas}-canvas`).querySelector('svg'), event);
    areaDrag.end = current;
    areaDrag.moved ||= Math.hypot(event.clientX - areaDrag.screen.x, event.clientY - areaDrag.screen.y) >= 4;
    if (areaDrag.mode === 'freehand') {
      const previous = areaDrag.points.at(-1), matrix = $(`${areaDrag.canvas}-canvas`).querySelector('svg').getScreenCTM();
      if (final || Math.hypot(current.x - previous.x, current.y - previous.y) * Math.hypot(matrix.a, matrix.b) >= 2) areaDrag.points.push(current);
      // Bound preview and hit-testing costs during long drawing gestures.
      if (areaDrag.points.length > 2048) areaDrag.points = areaDrag.points.filter((_, index) => index === 0 || index % 2 || index === areaDrag.points.length - 1);
    }
    renderSelectionRegion();
  }
  function setSelectionTool(mode) {
    cancelAreaSelection();
    $('selection-tool').value = mode;
    $('main-canvas').dataset.selectionTool = mode;
    $('pointer-tool').setAttribute('aria-pressed', String(mode === 'pointer'));
    $('freehand-tool').setAttribute('aria-pressed', String(mode === 'freehand'));
    syncTools();
  }
  $('pointer-tool').addEventListener('click', () => setSelectionTool('pointer'));
  $('freehand-tool').addEventListener('click', () => setSelectionTool('freehand'));
  $('selection-tool').addEventListener('change', event => setSelectionTool(event.target.value));
  setSelectionTool('pointer');

  stage.addEventListener('pointerdown', event => {
    if (isEditingText()) return;
    const { state, selectedIds } = getContext();
    if (!state || event.button !== 0 || event.ctrlKey && /Mac/i.test(navigator.platform) || drag || areaDrag || !event.isPrimary) return;
    let hit = hitTest(event);
    if (hit?.dataset.moveId && event.shiftKey) hit = null;
    const mode = $('selection-tool').value;
    // Select & move uses a rectangle on empty space. Freehand still permits
    // moving selected members, and resize handles always take precedence.
    const movingSelection = selectedIds.includes(hit?.dataset.objectId) || Boolean(hit?.dataset.moveId);
    if (!hit || mode === 'freehand' && !hit.dataset.resizeDirection && !hit.dataset.rotateId && !movingSelection) {
      lastClick = null;
      const start = point(stage.querySelector('svg'), event);
      areaDrag = { canvas: key, pointerId: event.pointerId, mode: mode === 'pointer' ? 'rectangle' : mode, start, end: start, points: [start],
        screen: { x: event.clientX, y: event.clientY }, moved: false, revision: state.revision, ids: [...selectedIds], additive: event.shiftKey, individual: event.altKey,
        hitId: hit?.dataset.objectId || '' };
      stage.classList.add('is-area-selecting'); renderSelectionRegion();
      syncSelectionToolbar();
      stage.focus({ preventScroll: true }); stage.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    const id = hit.dataset.objectId || hit.dataset.resizeId || hit.dataset.rotateId || hit.dataset.moveId;
    const start = point(stage.querySelector('svg'), event);
    let shiftClick = null;
    if (hit.dataset.objectId) {
      const ids = targetIds(id, event.altKey);
      // Preserve a multi-selection when dragging one of its members.
      if (event.shiftKey) {
        // Defer removing an already-selected member until a click completes:
        // dragging that same member with Shift should move the selection.
        shiftClick = { ids, previousIds: [...selectedIds] };
        if (!ids.every(id => selectedIds.includes(id))) select(ids, { reveal: false, additive: true });
      } else if (!ids.every(id => selectedIds.includes(id)) || event.altKey) select(ids, { reveal: false });
    }
    const currentIds = getContext().selectedIds;
    const objects = selectedObjects(), object = objects.length === 1 ? objects[0] : selectionTarget();
    if (!object) return;
    const boxes = objects.map(interactionBox);
    drag = { canvas: key, pointerId: event.pointerId, id, object: { ...object }, objects: objects.map(object => ({ ...object })), bounds: objects.length === 1 ? object : selectionBounds(boxes), ids: [...currentIds], start,
      screen: { x: event.clientX, y: event.clientY }, textClick: Boolean(hit.dataset.objectId && state.objects.find(object => object.id === id)?.type === 'text'),
      revision: state.revision, resizing: hit.dataset.resizeDirection, rotating: Boolean(hit.dataset.rotateId), gap: Boolean(hit.dataset.moveId), shiftClick, preview: null };
    if (!drag.resizing && !drag.rotating) {
      drag.snapBounds = selectionBounds(boxes);
      drag.snapTargets = smartGuideTargets(state, drag.ids, interactionBox);
    }
    if (drag.rotating) {
      drag.pivot = { x: drag.bounds.x + drag.bounds.width / 2, y: drag.bounds.y + drag.bounds.height / 2 };
      drag.lastAngle = Math.atan2(start.y - drag.pivot.y, start.x - drag.pivot.x) * 180 / Math.PI;
      drag.totalAngle = 0; drag.handlePlacement = JSON.parse(hit.dataset.placement);
    }
    if (drag.resizing && object.type === 'vector') drag.resizeSvg = stretchSvg(object.svg);
    render(state);
    if (drag.rotating || document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    const { state } = getContext();
    if (areaDrag?.canvas === key && areaDrag.pointerId === event.pointerId) { updateSelectionRegion(event); return; }
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Ignore click jitter before moving or snapping. Text handles need the same
    // guard because a second click can land on a newly revealed resize handle.
    if ((!drag.resizing || drag.objects.some(object => object.type === 'text')) && !drag.preview && !drag.rotating
      && Math.hypot(event.clientX - drag.screen.x, event.clientY - drag.screen.y) < 4) return;
    const current = point(stage.querySelector('svg'), event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    if (drag.rotating) {
      if (Math.hypot(current.x - drag.pivot.x, current.y - drag.pivot.y) < 1e-6) return;
      const angle = Math.atan2(current.y - drag.pivot.y, current.x - drag.pivot.x) * 180 / Math.PI;
      drag.totalAngle += angleDelta(drag.lastAngle, angle); drag.lastAngle = angle;
      const base = drag.objects.length === 1 ? drag.object.rotation : 0;
      drag.rotationDelta = event.shiftKey ? Math.round((base + drag.totalAngle) / 15) * 15 - base : drag.totalAngle;
      drag.preview = rotateComponents(drag.objects, drag.rotationDelta, drag.pivot);
      renderCanvas(key, { ...state, objects: state.objects.map(object => drag.preview.find(preview => preview.id === object.id) || object) });
      return;
    }
    let patch;
    if (drag.resizing) {
      patch = drag.objects.length > 1 ? resizeSelection(drag.objects, drag.resizing, dx, dy, drag.bounds) : resizeObject(drag.object, drag.resizing, dx, dy, drag.bounds, event.shiftKey);
      if (drag.objects.length > 1 && drag.objects.some(object => object.type === 'text')) {
        // Browser glyph metrics can round at fractional font sizes. Measure
        // the resized label again so its actual opposite handle stays fixed.
        const previews = transformSelection(drag.objects, patch);
        const boxes = previews.map(interactionBox), box = boxes.length === 1 ? boxes[0] : selectionBounds(boxes);
        const before = resizeAnchor(drag.bounds, drag.resizing), after = resizeAnchor(box, drag.resizing);
        patch.x += before.x - after.x; patch.y += before.y - after.y;
      }
      // A proportional resize keeps the artwork's fit; only free stretching changes it.
      if (drag.resizeSvg && !event.shiftKey && (patch.width !== drag.object.width || patch.height !== drag.object.height)) patch.svg = drag.resizeSvg;
    }
    else {
      // Cmd/Ctrl bypasses snapping; Alt at pointer-down already selects a single group member.
      const matrix = stage.querySelector('svg').getScreenCTM();
      if (event.shiftKey) drag.axis ||= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      else drag.axis = null;
      const snapped = snapTranslation(drag.snapBounds, drag.snapTargets, state.canvases[key], drag.axis === 'y' ? 0 : dx, drag.axis === 'x' ? 0 : dy,
        { scale: Math.hypot(matrix.a, matrix.b), axis: drag.axis, disabled: event.metaKey || event.ctrlKey || !$('smart-guides').checked });
      // Preserve the relative positions of a multi-selection at model limits.
      const limit = (axis, delta) => Math.max(-16000 - Math.min(...drag.objects.map(object => object[axis])),
        Math.min(16000 - Math.max(...drag.objects.map(object => object[axis])), delta));
      const moveX = limit('x', snapped.dx), moveY = limit('y', snapped.dy);
      drag.guides = snapped.guides.filter(guide => guide.axis === 'x' ? moveX === snapped.dx : moveY === snapped.dy);
      patch = { x: drag.object.x + moveX, y: drag.object.y + moveY };
    }
    drag.preview = patch;
    const previews = drag.objects.length > 1 ? transformSelection(drag.objects, patch) : [{ ...drag.object, ...patch }];
    renderCanvas(key, { ...state, objects: state.objects.map(obj => previews.find(preview => preview.id === obj.id) || obj) });
  });
  const finish = event => {
    const { state, editingGroupId } = getContext();
    if (areaDrag?.canvas === key && areaDrag.pointerId === event.pointerId) {
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') { cancelAreaSelection(); return; }
      updateSelectionRegion(event, true);
      const finished = areaDrag;
      const polygon = finished.mode === 'rectangle' ? rectanglePoints(finished.start, finished.end) : finished.points;
      const ids = finished.moved
        ? regionSelection(state, key, polygon, { individual: finished.individual, editingGroupId, getBounds: interactionBox })
        : finished.hitId ? targetIds(finished.hitId, finished.individual) : [];
      cancelAreaSelection();
      setSelection(finished.additive ? [...finished.ids, ...ids] : ids); render(state); return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Chromium can report capture loss when the SVG under the pointer is
    // replaced. Keep movement/resize alive until pointer-up or cancellation.
    if (event.type === 'lostpointercapture' && !drag.rotating) return;
    const finished = drag; drag = null;
    stage.querySelector('.smart-guides')?.remove();
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      if (finished.shiftClick) setSelection(finished.shiftClick.previousIds);
      lastClick = null; render(state); return;
    }
    if (finished.rotating) {
      lastClick = null;
      const degrees = angleDelta(0, finished.rotationDelta || 0);
      if (Math.abs(degrees) < 1e-8) { render(state); return; }
      void edit([{ op: 'rotate', ids: finished.ids, degrees, pivot: finished.pivot }], finished.revision);
      return;
    }
    if (!finished.preview) {
      if (finished.shiftClick) {
        const { ids, previousIds } = finished.shiftClick;
        setSelection(ids.every(id => previousIds.includes(id)) ? previousIds.filter(id => !ids.includes(id)) : [...previousIds, ...ids]);
        lastClick = null; render(state); return;
      }
      // A click (not a drag) in a gap still clears the selection, as empty canvas does.
      if (finished.gap) { lastClick = null; setSelection([]); render(state); return; }
      render(state);
      // Cancelling pointer-down's default prevents synthetic mouse clicks.
      // Recognize a double-click here, after capture, without moving the canvas
      // or opening the inspector in the middle of a drag/resize gesture.
      const now = performance.now();
      const textClick = finished.textClick || finished.resizing && finished.objects.length === 1 && finished.object.type === 'text';
      const doubleClick = textClick && lastClick?.id === finished.id && now - lastClick.time < 500
        && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 4;
      lastClick = finished.textClick && !doubleClick ? { id: finished.id, time: now, x: event.clientX, y: event.clientY } : null;
      if (doubleClick) editLabel(finished.id);
      return;
    }
    lastClick = null;
    void edit([finished.objects.length > 1 ? { op: 'transform', ids: finished.ids, patch: finished.preview }
      : { op: 'update', id: finished.objects[0].id, patch: finished.preview }], finished.revision);
  };
  stage.tabIndex = 0;
  // Chromium counts the script focus above as keyboard focus, so a click drew
  // the canvas focus ring (Electron 40 ignores focus({ focusVisible: false })).
  let pointerInput = false;
  document.addEventListener('pointerdown', () => { pointerInput = true; }, true);
  document.addEventListener('keydown', () => { pointerInput = false; }, true);
  stage.addEventListener('focus', () => stage.classList.toggle('pointer-focus', pointerInput));
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish); stage.addEventListener('lostpointercapture', finish);
  stage.addEventListener('focusin', event => {
    // Pointer selection uses painted pixels above (and in the context menu).
    // Native right-click focus must not select a transparent rectangular target.
    if (pointerInput) return;
    const { selectedIds } = getContext();
    const id = event.target.dataset.objectId;
    if (id && !selectedIds.includes(id)) select(targetIds(id), { reveal: false });
  });
  stage.addEventListener('dblclick', event => {
    if ($('selection-tool').value !== 'pointer' || isEditingText()) return;
    // Selection redraws the SVG during pointer-down. Chromium can deliver the
    // resulting double-click to the stage after that original node is replaced.
    const { state } = getContext();
    const target = event.target.closest('[data-object-id]');
    const hit = target && state.objects.find(object => object.id === target.dataset.objectId)?.type === 'text'
      ? target : hitTest(event, { handles: false });
    const id = stage.contains(hit) ? hit.dataset.objectId : '';
    if (id) editLabel(id);
  });

  function syncDocument(next, id) {
    const { illustrationId, selectedIds } = getContext();
    if (drag && (next.revision !== drag.revision || id !== illustrationId
      || JSON.stringify(selectedIds) !== JSON.stringify(drag.ids))) cancelDrag();
    if (areaDrag && (id !== illustrationId || next.revision !== areaDrag.revision)) cancelAreaSelection();
  }

  return {
    cancelAreaSelection,
    cancelDrag,
    getDrag: () => drag,
    isAreaSelecting: () => Boolean(areaDrag),
    isDragging: () => Boolean(drag),
    isActive: () => Boolean(drag || areaDrag),
    renderSelectionRegion,
    setSelectionTool,
    syncDocument
  };
}
