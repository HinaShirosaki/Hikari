export const STACK_VIEW = 'stack';

export function rowsInStack(rows, stackIds) {
  const members = new Set(stackIds);
  return rows.filter(row => members.has(row.id));
}

export function renderGelLayers({ list, rows, focusedId, stacks, activeStackId, documentObject }) {
  list.replaceChildren();
  const members = new Set(stacks.flatMap(stack => stack.layerIds));
  function icon(type) {
    const svg = documentObject.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gel-nav-icon gel-figure-item-icon'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = documentObject.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', {
      gel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm1 5h3m3 0h2m3 0h1M6 14h2m3 0h3m3 0h1',
      stack: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
      layout: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 9h18M9 9v12'
    }[type]);
    svg.append(path); return svg;
  }
  function gelButton(row, nested = false) {
    const layer = documentObject.createElement('div'); layer.className = 'gel-figure-layer folder-tree-template__leaf';
    const button = documentObject.createElement('button'); button.type = 'button'; button.className = 'gel-figure-layer-focus folder-tree-template__leaf-control folder-tree-template__rail-leaf';
    button.dataset.figureRow = row.id; button.setAttribute('aria-current', row.id === focusedId ? 'page' : 'false');
    if (row.record) button.dataset.figureSavedRecord = row.record.id;
    button.classList.toggle('is-active', row.id === focusedId);
    if (nested) button.dataset.figureStackMember = row.id;
    button.draggable = false;
    button.title = 'Drag between stacks or outside them. Double-click to rename. Alt+Left moves outside; Alt+Right moves to the current stack.';
    const names = documentObject.createElement('span'); names.className = 'gel-figure-layer-names folder-tree-template__label folder-tree-template__leaf-label'; names.title = row.label;
    const name = documentObject.createElement('span'); name.textContent = row.label;
    names.append(name); button.append(icon('gel'), names); layer.append(button); return layer;
  }
  const root = documentObject.createElement('div'); root.className = 'gel-figure-root-layers'; root.dataset.figureDrop = 'root';
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Gels outside Stack');
  const outside = rows.filter(row => !members.has(row.id));
  for (const row of outside) root.append(gelButton(row));
  list.append(root);
  for (const entry of stacks) {
    const active = focusedId === STACK_VIEW && entry.id === activeStackId;
    const group = documentObject.createElement('div'); group.className = 'gel-figure-stack-group'; group.dataset.figureDrop = entry.id;
    const stack = documentObject.createElement('button'); stack.type = 'button'; stack.className = 'gel-figure-stack-layer folder-tree-template__leaf-control folder-tree-template__rail-leaf';
    stack.dataset.figureStackView = entry.id; stack.setAttribute('aria-current', active ? 'page' : 'false');
    stack.classList.toggle('is-active', active);
    stack.title = 'Double-click to rename.';
    const name = documentObject.createElement('span'); name.className = 'gel-figure-layer-names folder-tree-template__label'; name.textContent = entry.name; name.title = entry.name;
    stack.append(icon('stack'), name); group.append(stack);
    const children = documentObject.createElement('div'); children.className = 'gel-figure-stack-children';
    children.setAttribute('role', 'group'); children.setAttribute('aria-label', `${entry.name} contents`);
    for (const row of rowsInStack(rows, entry.layerIds)) {
      children.append(gelButton(row, true));
    }
    const layout = documentObject.createElement('button'); layout.type = 'button'; layout.className = 'gel-figure-layout-layer folder-tree-template__leaf-control folder-tree-template__rail-leaf';
    layout.dataset.figureLayoutView = entry.id; layout.title = 'Double-click to rename.';
    const layoutLabel = documentObject.createElement('span'); layoutLabel.className = 'gel-figure-layer-names folder-tree-template__label'; layoutLabel.textContent = entry.layoutName; layoutLabel.title = entry.layoutName;
    layout.append(icon('layout'), layoutLabel);
    layout.setAttribute('aria-current', active ? 'page' : 'false');
    layout.classList.toggle('is-active', active);
    const layoutLeaf = documentObject.createElement('div'); layoutLeaf.className = 'folder-tree-template__leaf';
    layoutLeaf.append(layout); children.append(layoutLeaf); group.append(children);
    list.append(group);
  }
}

// Replace only the name while preserving the row's icon, indent, and metadata.
export function startGelNavigationRename(button, { value, label, onCommit, onFinish }) {
  const documentObject = button.ownerDocument;
  const names = button.querySelector('.gel-figure-layer-names');
  const editor = documentObject.createElement('div');
  editor.className = `${button.className} gel-figure-rename-row`;
  editor.style.padding = documentObject.defaultView.getComputedStyle(button).padding;
  editor.setAttribute('role', 'group'); editor.setAttribute('aria-label', label);
  const input = documentObject.createElement('input');
  input.type = 'text'; input.className = `${names.className} folder-tree-template__rename-input`;
  input.value = value; input.maxLength = 120; input.setAttribute('aria-label', label);
  input.dataset.gelNavigationRename = '';
  for (const child of button.children) editor.append(child === names ? input : child.cloneNode(true));
  const previousDisplay = button.style.display;
  button.style.display = 'none'; button.before(editor);
  let settled = false;
  function finish(commit, refocus = false) {
    if (settled) return;
    settled = true;
    const name = input.value.trim();
    editor.remove(); button.style.display = previousDisplay;
    onFinish();
    const target = commit && name && name !== value ? onCommit(name) : button;
    if (refocus) target?.focus();
  }
  input.addEventListener('keydown', event => {
    if (!['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter', true);
  });
  input.addEventListener('blur', () => finish(true));
  for (const type of ['click', 'dblclick', 'contextmenu']) input.addEventListener(type, event => event.stopPropagation());
  input.focus(); input.select();
  return finish;
}

export function bindGelLayerDrag({ navigation, isBusy, onMove }) {
  const documentObject = navigation.ownerDocument;
  let drag = null;
  let ghost = null;
  let scrollFrame = 0;
  const view = documentObject.defaultView;
  const scrollRegion = navigation.querySelector('.left-rail-template__scroll');
  let ignoreClick = false;
  const disposers = [];
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  }
  function unmark() {
    navigation.querySelectorAll('.is-gel-drop-active').forEach(node => node.classList.remove('is-gel-drop-active'));
    navigation.querySelectorAll('[data-gel-drop-edge]').forEach(node => node.removeAttribute('data-gel-drop-edge'));
  }
  function clear() {
    if (scrollFrame) view.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const pointerId = drag?.pointerId; drag = null;
    if (pointerId != null && navigation.hasPointerCapture?.(pointerId)) navigation.releasePointerCapture(pointerId);
    ghost?.remove(); ghost = null;
    unmark(); navigation.classList.remove('is-dragging-gel');
    navigation.querySelectorAll('.is-dragging-gel-row').forEach(node => node.classList.remove('is-dragging-gel-row'));
  }
  function destination(event) {
    const hit = documentObject.elementFromPoint(event.clientX, event.clientY);
    if (!hit || !navigation.contains(hit)) return null;
    const group = hit.closest('[data-figure-drop]') || navigation.querySelector('[data-figure-drop="root"]');
    if (!group) return null;
    const button = hit.closest('[data-figure-row]');
    if (!button) return { group, beforeId: null };
    if (button.dataset.figureRow === drag.id) return { group, beforeId: drag.id };
    const bounds = button.getBoundingClientRect();
    const below = event.clientY > bounds.top + bounds.height / 2;
    const buttons = [...group.querySelectorAll('[data-figure-row]')].filter(node => node.dataset.figureRow !== drag.id);
    return { group, button, below, beforeId: (below ? buttons[buttons.indexOf(button) + 1] : button)?.dataset.figureRow || null };
  }
  function markDestination(event) {
    const target = destination(event); unmark();
    if (target) {
      target.group.classList.add('is-gel-drop-active');
      if (target.button) target.button.dataset.gelDropEdge = target.below ? 'after' : 'before';
    }
  }
  function scrollDuringDrag() {
    scrollFrame = 0;
    if (!drag?.active || !scrollRegion || isBusy()) return;
    const bounds = scrollRegion.getBoundingClientRect();
    if (drag.clientX < bounds.left || drag.clientX > bounds.right || drag.clientY < bounds.top || drag.clientY > bounds.bottom) return;
    const delta = drag.clientY < bounds.top + 28 ? -12 : drag.clientY > bounds.bottom - 28 ? 12 : 0;
    if (!delta) return;
    const previous = scrollRegion.scrollTop;
    scrollRegion.scrollTop += delta;
    markDestination(drag);
    if (scrollRegion.scrollTop !== previous) scrollFrame = view.requestAnimationFrame(scrollDuringDrag);
  }
  listen(navigation, 'pointerdown', event => {
    const button = event.target.closest('[data-figure-row]');
    if (!button || event.button !== 0 || isBusy()) return;
    clear(); drag = { id: button.dataset.figureRow, button, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
  });
  listen(documentObject, 'pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (isBusy()) { clear(); return; }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      drag.active = true;
      try { navigation.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
      drag.button.classList.add('is-dragging-gel-row'); navigation.classList.add('is-dragging-gel');
      ghost = documentObject.createElement('div'); ghost.className = 'gel-figure-drag-label'; ghost.textContent = drag.button.textContent;
      ghost.setAttribute('aria-hidden', 'true'); documentObject.body.append(ghost);
    }
    event.preventDefault();
    drag.clientX = event.clientX; drag.clientY = event.clientY;
    ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`;
    markDestination(event);
    if (!scrollFrame) scrollFrame = view.requestAnimationFrame(scrollDuringDrag);
  });
  listen(documentObject, 'pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) { clear(); return; }
    event.preventDefault();
    const id = drag.id, target = destination(event); clear();
    ignoreClick = true;
    documentObject.defaultView.requestAnimationFrame(() => { ignoreClick = false; });
    if (target && !isBusy()) onMove(id, target.group.dataset.figureDrop, target.beforeId);
  });
  listen(documentObject, 'pointercancel', event => { if (drag?.pointerId === event.pointerId) clear(); });
  listen(navigation, 'lostpointercapture', event => { if (drag?.pointerId === event.pointerId) clear(); });
  listen(navigation, 'click', event => {
    if (!ignoreClick) return;
    ignoreClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  listen(navigation, 'keydown', event => {
    const button = event.target.closest('[data-figure-row]');
    if (!button || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || isBusy()) return;
    event.preventDefault(); event.stopPropagation(); onMove(button.dataset.figureRow, event.key === 'ArrowRight' ? 'stack' : 'root');
  });
  return () => { clear(); disposers.forEach(dispose => dispose()); };
}
