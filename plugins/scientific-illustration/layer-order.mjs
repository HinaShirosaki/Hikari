// Layer rows run front to back; model order runs back to front. Groups move as
// one unit, retaining their members' paint order and all object properties.
export function layerUnitIds(document, id) {
  const group = document.groups.find(group => group.id === id || group.ids.includes(id));
  return group ? group.ids : document.objects.some(object => object.id === id) ? [id] : [];
}

export function movingLayerIds(document, id, selection) {
  const source = layerUnitIds(document, id);
  const selected = source.some(member => selection.includes(member));
  const moving = new Set((selected ? selection : source).flatMap(member => layerUnitIds(document, member)));
  return document.objects.filter(object => moving.has(object.id)).map(object => object.id);
}

export function reorderedLayers(document, moving, target, after = false) {
  const targetIds = layerUnitIds(document, target);
  if (!moving.length || !targetIds.length || targetIds.some(id => moving.includes(id))) return null;
  const order = document.objects.map(object => object.id).reverse();
  const rest = order.filter(id => !moving.includes(id));
  const positions = targetIds.map(id => rest.indexOf(id));
  const index = after ? Math.max(...positions) + 1 : Math.min(...positions);
  rest.splice(index, 0, ...order.filter(id => moving.includes(id)));
  return rest.every((id, index) => id === order[index]) ? null : rest.reverse();
}

export function createLayerOrder({ element, getContext, save, status }) {
  const document = element.ownerDocument, window = document.defaultView;
  let gesture = null, animation = 0, suppressClick = false, writing = false;
  const rows = () => [...element.querySelectorAll('[data-layer-id]')];
  const contextMatches = session => {
    const current = getContext();
    return current.document?.revision === session.document.revision && current.illustrationId === session.illustrationId;
  };
  function clearMarkers() {
    rows().forEach(row => { row.classList.remove('is-ordering'); delete row.dataset.orderDrop; });
  }
  function cancel() {
    const previous = gesture; gesture = null;
    window.cancelAnimationFrame(animation); animation = 0;
    element.classList.remove('is-ordering'); clearMarkers();
    if (previous && element.hasPointerCapture(previous.pointerId)) element.releasePointerCapture(previous.pointerId);
  }
  function targetAt(session) {
    rows().forEach(row => { delete row.dataset.orderDrop; });
    const bounds = element.getBoundingClientRect(), { x, y } = session;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const available = rows().filter(row => !layerUnitIds(session.document, row.dataset.layerId).some(id => session.moving.includes(id)));
    const row = available.find(row => y < row.getBoundingClientRect().bottom) || available.at(-1);
    if (!row) return null;
    const rect = row.getBoundingClientRect(), after = y > rect.top + rect.height / 2;
    const target = row.dataset.layerId, ids = layerUnitIds(session.document, target);
    const unitRows = available.filter(row => layerUnitIds(session.document, row.dataset.layerId).some(id => ids.includes(id)));
    const marker = after ? unitRows.at(-1) : unitRows[0];
    marker.dataset.orderDrop = after ? 'after' : 'before';
    return { target, after };
  }
  function scroll() {
    animation = 0;
    if (!gesture?.active) return;
    const rect = element.getBoundingClientRect(), { x, y } = gesture;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const distance = y < rect.top + 30 ? y - rect.top - 30 : y > rect.bottom - 30 ? y - rect.bottom + 30 : 0;
      if (distance) element.scrollTop += distance / 3;
    }
    gesture.target = targetAt(gesture);
    animation = window.requestAnimationFrame(scroll);
  }
  async function commit(session, target) {
    const order = target && reorderedLayers(session.document, session.moving, target.target, target.after);
    if (!order || writing || !contextMatches(session)) return;
    writing = true;
    try { await save({ ...session, order }); }
    catch (error) { status(error.message); }
    finally { writing = false; }
  }
  element.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || event.isPrimary === false || writing) return;
    const row = event.target.closest('.layer-select')?.closest('[data-layer-id]');
    const context = getContext();
    if (!row || !context.document) return;
    cancel();
    gesture = { ...context, moving: movingLayerIds(context.document, row.dataset.layerId, context.selectedIds),
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
  });
  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!event.buttons) { cancel(); return; }
    if (!contextMatches(gesture)) { cancel(); return; }
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.active && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 5) return;
    if (!gesture.active) {
      gesture.active = true; suppressClick = true;
      element.setPointerCapture(event.pointerId); element.classList.add('is-ordering');
      rows().filter(row => layerUnitIds(gesture.document, row.dataset.layerId).some(id => gesture.moving.includes(id)))
        .forEach(row => row.classList.add('is-ordering'));
      animation = window.requestAnimationFrame(scroll);
    }
    event.preventDefault(); gesture.target = targetAt(gesture);
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const session = gesture, target = session.active ? targetAt({ ...session, x: event.clientX, y: event.clientY }) : null;
    cancel();
    if (session.active) { event.preventDefault(); void commit(session, target); }
  });
  document.addEventListener('pointercancel', event => { if (gesture?.pointerId === event.pointerId) cancel(); });
  // Document listeners continue the gesture if Chromium transfers capture
  // between iframe targets; a released pointer or blur still cancels it.
  element.addEventListener('click', event => {
    if (suppressClick && event.detail) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gesture?.active) { cancel(); event.preventDefault(); event.stopPropagation(); }
  }, true);
  window.addEventListener('blur', cancel);
  element.addEventListener('keydown', event => {
    if (!event.altKey || event.metaKey || event.ctrlKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const row = event.target.closest('.layer-select')?.closest('[data-layer-id]'), context = getContext();
    if (!row || !context.document || writing) return;
    event.preventDefault(); event.stopPropagation();
    const moving = movingLayerIds(context.document, row.dataset.layerId, context.selectedIds);
    const displayed = rows(), movingRows = displayed.filter(row => layerUnitIds(context.document, row.dataset.layerId).some(id => moving.includes(id)));
    const after = event.key === 'ArrowDown';
    const index = displayed.indexOf(after ? movingRows.at(-1) : movingRows[0]);
    const target = displayed[index + (after ? 1 : -1)]?.dataset.layerId;
    if (target) void commit({ ...context, moving }, { target, after });
  });
  return { cancel };
}
