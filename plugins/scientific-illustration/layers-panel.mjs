import { createPresentation } from './i18n.mjs';
import { element, objectGroup } from './artwork.mjs';
import { icon } from './workspace-tools.mjs';

const i18nUi = createPresentation('figura');

// The Layers rail. A single state owns visibility, focus and every entry point;
// the right toolbar's Layers button opens or folds it.
export function createComponentRail({ document, onChange = () => {}, focusTab = () => document.getElementById('layers-tab').focus({ preventScroll: true }) }) {
  const $ = id => document.getElementById(id), rail = $('layer-inspector'), tab = $('layers-tab');
  let open = false;
  function openPanel(next) {
    if (!next && rail.contains(document.activeElement)) focusTab('layers');
    const changed = next !== open;
    open = next;
    rail.hidden = !open; rail.inert = !open;
    document.querySelector('.work-area').classList.toggle('is-inspector-open', open);
    tab.setAttribute('aria-pressed', String(open)); tab.setAttribute('aria-expanded', String(open));
    i18nUi.setAttribute(tab, "title", open ? i18nUi.message("Hide layers and properties") : i18nUi.message("Show layers and properties"));
    if (changed) onChange(open ? 'layers' : null);
  }
  tab.addEventListener('click', () => openPanel(!open));
  $('close-layers').addEventListener('click', () => openPanel(false));
  openPanel(false);
  return { open: () => openPanel(true), close: () => openPanel(false), getActive: () => open ? 'layers' : null };
}

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

function createLayerOrder({ element, getContext, save, status }) {
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

export function createLayersPanel({ document, workspace, getContext, edit, editLabel, select, status }) {
  const $ = id => document.getElementById(id);

  let lastLayerClick = null;
  function renderLayers(state, selectedIds) {
    const scrollTop = $('layers').scrollTop;
    const focusedRow = document.activeElement?.closest('[data-layer-id]');
    const focusedId = focusedRow?.dataset.layerId, focusedAction = document.activeElement?.dataset.layerAction;
    $('layers').replaceChildren();
    i18nUi.setText($('layer-count'), (state.objects.length || ''));
    const canvasObjects = [...state.objects].reverse(), listedGroups = new Set();
    const objects = canvasObjects.flatMap(object => {
      const group = state.groups.find(group => group.ids.includes(object.id));
      if (!group) return [object];
      if (listedGroups.has(group.id)) return [];
      listedGroups.add(group.id);
      return canvasObjects.filter(member => group.ids.includes(member.id));
    });
    const drawnGroups = new Set();
    for (const object of objects) {
      const group = state.groups.find(group => group.ids.includes(object.id));
      if (group && !drawnGroups.has(group.id)) {
        drawnGroups.add(group.id);
        const row = document.createElement('div'); row.className = `layer grouped-layer${group.ids.every(id => selectedIds.includes(id)) ? ' is-selected' : ''}`;
        row.setAttribute('role', 'listitem'); row.dataset.layerId = group.id;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-select'; button.dataset.layerAction = 'select';
        i18nUi.setAttribute(button, "aria-label", i18nUi.message("Select group {p0}", { p0: group.name })); button.setAttribute('aria-pressed', String(group.ids.every(id => selectedIds.includes(id))));
        const preview = document.createElement('span'); preview.className = 'layer-preview'; preview.setAttribute('aria-hidden', 'true'); preview.append(icon('layers'));
        const name = document.createElement('span'); name.className = 'layer-name'; i18nUi.setText(name, group.name);
        const count = document.createElement('small'); count.className = 'group-count'; i18nUi.setText(count, group.ids.length);
        button.append(preview, name, count); button.addEventListener('click', event => select(group.ids, { additive: event.shiftKey }));
        row.append(button); $('layers').append(row);
      }
      const row = document.createElement('div'); row.className = `layer${selectedIds.includes(object.id) ? ' is-selected' : ''}${object.visible ? '' : ' is-hidden'}${group ? ' group-child' : ''}`; row.setAttribute('role', 'listitem'); row.dataset.layerId = object.id;
      const layerLabel = object.type === 'text' ? object.text.replace(/\s+/g, ' ').trim() || i18nUi.message("Text") : object.name;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-select'; button.dataset.layerAction = 'select';
      i18nUi.setAttribute(button, "aria-label", i18nUi.message("Select {p0}", { p0: layerLabel })); i18nUi.setAttribute(button, "title", layerLabel);
      const preview = document.createElement('span'); preview.className = `layer-preview ${object.type}`; preview.setAttribute('aria-hidden', 'true');
      if (object.type === 'text') i18nUi.setText(preview, 'T');
      else {
        const thumbnail = element('svg', { viewBox: `0 0 ${object.width} ${object.height}`, 'aria-hidden': 'true' });
        thumbnail.append(objectGroup({ ...object, x: 0, y: 0, rotation: 0, opacity: 1 })); preview.append(thumbnail);
      }
      const name = document.createElement('span'); name.className = 'layer-name'; i18nUi.setText(name, layerLabel);
      button.append(preview, name);
      button.setAttribute('aria-pressed', String(selectedIds.includes(object.id)));
      button.addEventListener('click', event => {
        // Selection replaces the row, so the second native click can have a new target.
        const now = performance.now();
        const doubleClick = object.type === 'text' && event.detail > 0 && !event.shiftKey
          && lastLayerClick?.id === object.id && now - lastLayerClick.time < 500
          && Math.hypot(event.clientX - lastLayerClick.x, event.clientY - lastLayerClick.y) < 4;
        lastLayerClick = event.detail > 0 && !doubleClick ? { id: object.id, time: now, x: event.clientX, y: event.clientY } : null;
        if (doubleClick) editLabel(object.id);
        else select(object.id, { additive: event.shiftKey });
      });
      if (object.type === 'text') button.addEventListener('dblclick', () => editLabel(object.id));
      const visibility = document.createElement('button'); visibility.type = 'button'; visibility.className = 'layer-visibility icon-button'; visibility.dataset.layerAction = 'visibility';
      i18nUi.setAttribute(visibility, "title", i18nUi.message(object.visible ? 'Hide {name}' : 'Show {name}', { name: layerLabel })); i18nUi.setAttribute(visibility, 'aria-label', i18nUi.message(object.visible ? 'Hide {name}' : 'Show {name}', { name: layerLabel })); visibility.setAttribute('aria-pressed', String(object.visible));
      visibility.append(icon(object.visible ? 'eye' : 'hidden'));
      visibility.addEventListener('click', () => void edit([{ op: 'update', id: object.id, patch: { visible: !object.visible } }]));
      row.append(button, visibility); $('layers').append(row);
    }
    if (!state.objects.length) {
      const empty = document.createElement('p'); empty.className = 'layers-empty'; i18nUi.setText(empty, i18nUi.message("Your components and labels will appear here.")); $('layers').append(empty);
    }
    $('layers').querySelectorAll('.layer-select').forEach(button => {
      button.setAttribute('aria-describedby', 'layer-order-hint');
      button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    });
    $('layers').scrollTop = scrollTop;
    if (focusedId && focusedAction) $('layers').querySelector(`[data-layer-id="${focusedId}"] [data-layer-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  }

  const layerOrder = createLayerOrder({ element: $('layers'),
    getContext: () => {
      const { state, illustrationId, selectedIds } = getContext();
      return { document: state, illustrationId, selectedIds: [...selectedIds] };
    }, status,
    save: async ({ document, illustrationId: targetId, moving, order }) => {
      const result = await workspace.request({ action: 'apply', illustration_id: targetId, expected_revision: document.revision,
        request_id: crypto.randomUUID(), operations: [{ op: 'order', canvas: 'main', ids: order }] });
      if (!result.ok) status(result.error);
      else if (getContext().illustrationId === targetId) select(moving, { reveal: false });
    } });

  return { render: renderLayers, cancelOrder: layerOrder.cancel };
}
