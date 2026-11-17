import { element } from './artwork.mjs';

// Keep a usable local strip on older hosts; newer Hikari hosts render these
// declarative controls beside the existing agent chat toggle.
const definitions = [
  ['pointer-tool', 'pointer', 'selection'], ['freehand-tool', 'lasso', 'selection'],
  ['add-menu', 'plus', 'edit'],
  ['palette-menu', 'palette', 'edit'], ['crop-raster', 'crop', 'edit'],
  ['group-selection', 'group', 'group'], ['ungroup-selection', 'ungroup', 'group'],
  ['align-menu', 'align', 'group'],
  ['layers-tab', 'layers', 'panels'],
  ['zoom-out', 'minus', 'zoom'], ['zoom-level', '', 'zoom'], ['zoom-in', 'plus', 'zoom'], ['zoom-fit', 'fit', 'zoom']
];
const menuIds = ['add-menu', 'palette-menu', 'align-menu'];
export function createWorkspaceTools({ hikari, document, onHosted = () => {} }) {
  const $ = id => document.getElementById(id), win = document.defaultView;
  let supported = false, hosted = false, signature = '', scheduled = false, inFlight = false;
  let anchoredMenu = null, menuTrigger = null;
  const tools = () => definitions.map(([id, icon, group]) => {
    const node = $(id), control = menuIds.includes(id) ? node.querySelector('summary') : node;
    const tool = { id, icon, group, label: id === 'zoom-level' ? node.textContent : control.title || control.getAttribute('aria-label') };
    if (id === 'zoom-level') { delete tool.icon; tool.kind = 'output'; }
    else {
      tool.disabled = Boolean(control.disabled);
      for (const [attr, key] of [['aria-pressed', 'pressed'], ['aria-expanded', 'expanded']]) if (control.hasAttribute(attr)) tool[key] = control.getAttribute(attr) === 'true';
    }
    return tool;
  });
  function setHosted(value) {
    if (hosted === value) return;
    hosted = value;
    document.body.classList.toggle('has-host-tools', value);
    $('workspace-tools').classList.toggle('is-hosted', value);
    onHosted(value);
  }
  async function sync() {
    scheduled = false;
    if (!supported || inFlight) return;
    const next = tools(), key = JSON.stringify(next);
    if (key === signature) return;
    inFlight = true;
    try {
      const result = await hikari.call('app.setWorkspaceTools', { tools: next });
      if (result.mounted) { signature = key; setHosted(true); }
    } catch { supported = false; signature = ''; setHosted(false); }
    finally { inFlight = false; if (supported && JSON.stringify(tools()) !== signature) schedule(); }
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(sync); } }
  function focus(id) {
    if (anchoredMenu?.id === id && menuTrigger?.getBoundingClientRect().width && !menuTrigger.disabled) {
      menuTrigger.focus({ preventScroll: true }); return;
    }
    if (!hosted) { (menuIds.includes(id) ? $(id)?.querySelector('summary') : $(id))?.focus({ preventScroll: true }); return; }
    void hikari.call('app.setWorkspaceTools', { tools: tools(), focusId: id }).catch(() => {});
  }
  function layoutMenu() {
    if (!anchoredMenu?.open || !menuTrigger) return;
    const anchor = menuTrigger.getBoundingClientRect(), panel = anchoredMenu.querySelector('.popover-panel');
    if (!anchor.width) { anchoredMenu.open = false; return; }
    const bounds = panel.getBoundingClientRect(), margin = 8;
    const left = Math.max(margin, Math.min(anchor.left, win.innerWidth - bounds.width - margin));
    const below = anchor.bottom + 6;
    const top = below + bounds.height <= win.innerHeight - margin ? below : Math.max(margin, anchor.top - bounds.height - 6);
    anchoredMenu.style.setProperty('--selection-menu-left', `${left}px`);
    anchoredMenu.style.setProperty('--selection-menu-top', `${top}px`);
  }
  function toggleMenu(id, trigger) {
    const menu = $(id), opening = !menu.open || menuTrigger !== trigger;
    document.querySelectorAll('.popover[open]').forEach(other => { if (other !== menu) other.open = false; });
    anchoredMenu = menu; menuTrigger = trigger;
    menu.classList.add('is-selection-menu'); menu.open = opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) { layoutMenu(); menu.querySelector('.popover-panel button:not(:disabled)')?.focus(); }
  }
  hikari.on('app.workspaceTool', ({ id, y }) => {
    if (!hosted || !definitions.some(entry => entry[0] === id)) return;
    if (!menuIds.includes(id)) { $(id)?.click(); return; }
    const menu = $(id);
    if (menuTrigger) menuTrigger.setAttribute('aria-expanded', 'false');
    anchoredMenu = menuTrigger = null; menu.classList.remove('is-selection-menu');
    document.querySelectorAll('.popover[open]').forEach(other => { if (other !== menu) other.open = false; });
    menu.open = !menu.open;
    if (menu.open) {
      const panel = menu.querySelector('.popover-panel');
      const top = Math.max(8, Math.min(Number(y) || 64, win.innerHeight - panel.getBoundingClientRect().height - 8));
      menu.style.setProperty('--tool-menu-top', `${top}px`);
      (panel.querySelector('button:not(:disabled)') || menu.querySelector('summary'))?.focus();
    }
  });
  for (const id of menuIds) {
    const menu = $(id);
    menu.querySelector('summary').addEventListener('click', () => {
      menuTrigger?.setAttribute('aria-expanded', 'false');
      anchoredMenu = menuTrigger = null; menu.classList.remove('is-selection-menu');
    });
    menu.addEventListener('toggle', () => {
      menu.querySelector('summary').setAttribute('aria-expanded', String(menu.open));
      if (anchoredMenu === menu) menuTrigger?.setAttribute('aria-expanded', String(menu.open));
      schedule();
      if (anchoredMenu === menu) { layoutMenu(); return; }
      if (hosted || !menu.open) return;
      const panel = menu.querySelector('.popover-panel'), top = menu.querySelector('summary').getBoundingClientRect().top;
      menu.style.setProperty('--tool-menu-top', `${Math.max(8, Math.min(top, win.innerHeight - panel.getBoundingClientRect().height - 8))}px`);
    });
    menu.addEventListener('keydown', event => {
      if (!menu.open || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...menu.querySelectorAll('.popover-panel button:not(:disabled)')];
      const index = buttons.indexOf(event.target);
      event.preventDefault(); event.stopPropagation();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0)
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    });
  }
  win.addEventListener('resize', layoutMenu);
  return {
    sync: schedule, focus, toggleMenu, layoutMenu, isHosted: () => hosted,
    connect(info) {
      if (!info?.layout?.workspaceTools?.available || info.permissions && !info.permissions.includes('layout')) return;
      supported = true; schedule();
    }
  };
}

const paths = {
  pointer: ['M5 3v17l5-5 4 7 3-2-4-7h7Z'],
  lasso: ['M7 18c-4-2-5-5-3-9S13 3 18 6s4 9-1 12-10 3-10 0 4-3 5-1-1 5-4 5'],
  assets: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  fit: ['M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  rail: ['m14 6-6 6 6 6'],
  layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
  download: ['M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5'],
  undo: ['M9 5 4 10l5 5', 'M4 10h10a6 6 0 0 1 0 12'],
  redo: ['m15 5 5 5-5 5', 'M20 10H10a6 6 0 0 0 0 12'],
  group: ['M3 3h18v18H3z', 'M7 7h6v6H7zM11 11h6v6h-6z'],
  ungroup: ['M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4', 'M7 7h6v6H7zM11 11h6v6h-6z'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  canvas: ['M3 5h18v14H3z'],
  ruler: ['m4 14 10-10 6 6-10 10H4v-6Z', 'm10 8 2 2m2-6 2 2m-8 6 2 2'],
  settings: ['M4 7h9m4 0h3M4 17h3m4 0h9', 'M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0M11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6M12 7h.01'],
  down: ['m7 10 5 5 5-5'],
  close: ['m6 6 12 12M6 18 18 6'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  edit: ['M4 16v4h4L20 8l-4-4Z', 'm14 6 4 4'],
  paste: ['M9 4H5v17h14V4h-4', 'M9 3h6v4H9z'],
  up: ['m7 13 5-5 5 5', 'M12 8v12M5 4h14'],
  lower: ['m7 11 5 5 5-5', 'M12 4v12M5 20h14'],
  trash: ['M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  hidden: ['m3 3 18 18M10.6 5.1 12 5c6 0 10 7 10 7a20 20 0 0 1-3.1 3.9M6.2 6.2A23 23 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.8-1.8'],
  alignLeft: ['M4 5h16M4 10h10M4 15h16M4 20h10'],
  alignCenter: ['M4 5h16M7 10h10M4 15h16M7 20h10'],
  alignRight: ['M4 5h16M10 10h10M4 15h16M10 20h10'],
  arrow: ['M12 19V5m-6 6 6-6 6 6'],
  image: ['M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5', 'M8 7h.01'],
  crop: ['M6 3v15h15M3 6h15v15'],
  palette: ['M12 3C7 3 3 6.6 3 11.5S7 20 11.5 20c1.4 0 2-.8 2-1.7 0-1.2-1-1.6-1-2.8 0-1 .8-1.5 1.8-1.5H17c2.4 0 4-1.6 4-4C21 6.6 17 3 12 3Z', 'M7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01'],
  align: ['M4 3v18M8 5h12v5H8zM8 14h8v5H8z'],
  objectLeft: ['M4 3v18M8 5h12v5H8zM8 14h8v5H8z'],
  objectRight: ['M20 3v18M4 5h12v5H4zM8 14h8v5H8z'],
  objectHorizontal: ['M12 2v3m0 5v4m0 5v3M4 5h16v5H4zM7 14h10v5H7z'],
  objectTop: ['M3 4h18M5 8h5v12H5zM14 8h5v8h-5z'],
  objectBottom: ['M3 20h18M5 4h5v12H5zM14 8h5v8h-5z'],
  objectVertical: ['M2 12h3m5 0h4m5 0h3M5 4h5v16H5zM14 7h5v10h-5z'],
  distributeHorizontal: ['M3 3v18M21 3v18M7 6h3v12H7zM14 6h3v12h-3z'],
  distributeVertical: ['M3 3h18M3 21h18M6 7h12v3H6zM6 14h12v3H6z']
};
export function icon(name) {
  const svg = element('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'ui-icon' });
  for (const d of paths[name] || paths.image) svg.append(element('path', { d }));
  return svg;
}
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => node.prepend(icon(node.dataset.icon)));
}

// An HTML overlay stays usable while the canvas SVG is redrawn or zoomed.
export function createSelectionToolbar({ document, onAction, onHide, onLayout }) {
  const bar = document.getElementById('selection-toolbar');
  const stage = document.getElementById('main-canvas');
  const buttons = [...bar.querySelectorAll('button')];
  const separator = bar.querySelector('.selection-toolbar-separator');
  const enabledButtons = () => buttons.filter(button => !button.hidden && !button.disabled);
  bar.addEventListener('click', event => {
    const button = event.target.closest('button[data-selection-action]');
    if (button && !button.hidden && !button.disabled) onAction(button.dataset.selectionAction, button);
  });
  bar.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const enabled = enabledButtons(), index = enabled.indexOf(event.target);
    enabled[event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + enabled.length) % enabled.length]?.focus();
  });
  function hide() {
    if (!bar.hidden) { bar.hidden = true; onHide(); }
  }
  function layout() {
    if (bar.hidden || bar.classList.contains('is-editing-group')) return;
    const area = stage.getBoundingClientRect(), wrap = bar.parentElement.getBoundingClientRect();
    const outlines = [...stage.querySelectorAll('.selection-member')].map(node => node.getBoundingClientRect())
      .filter(rect => rect.right > area.left && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom);
    if (!outlines.length || area.width < bar.offsetWidth + 16 || area.height < bar.offsetHeight + 16) { hide(); return; }
    const left = Math.max(area.left, Math.min(...outlines.map(rect => rect.left)));
    const right = Math.min(area.right, Math.max(...outlines.map(rect => rect.right)));
    const top = Math.min(...outlines.map(rect => rect.top)), bottom = Math.max(...outlines.map(rect => rect.bottom));
    const width = bar.offsetWidth, height = bar.offsetHeight, margin = 8;
    const x = Math.max(area.left + margin, Math.min(area.right - width - margin, (left + right - width) / 2));
    const preferredY = top - height - margin >= area.top + margin ? top - height - margin : bottom + margin;
    const y = Math.max(area.top + margin, Math.min(area.bottom - height - margin, preferredY));
    bar.style.setProperty('--selection-toolbar-left', `${x - wrap.left}px`);
    bar.style.setProperty('--selection-toolbar-top', `${y - wrap.top}px`);
    onLayout();
  }
  return {
    layout,
    sync({ visible, editingGroup, editGroup, group, ungroup, align }) {
      const enabled = { group, ungroup, align, 'edit-group': editGroup, 'done-group': editingGroup };
      for (const button of buttons) {
        const action = button.dataset.selectionAction;
        button.hidden = editingGroup ? action !== 'done-group' : action === 'done-group' || (action === 'edit-group' && !editGroup);
        button.disabled = !enabled[action];
      }
      separator.hidden = editingGroup;
      bar.classList.toggle('is-editing-group', editingGroup);
      if (!visible) { hide(); return; }
      bar.hidden = false; layout();
      const focused = document.activeElement;
      if (!bar.hidden && buttons.includes(focused) && (focused.hidden || focused.disabled)) enabledButtons()[0]?.focus({ preventScroll: true });
    }
  };
}

function installContextMenu({ document, menu, surfaces, resolveMenu, status }) {
  const window = document.defaultView;
  const buttons = [...menu.querySelectorAll('[role="menuitem"]')];
  let actions = {};
  let focusTrigger;
  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true; actions = {};
    if (restoreFocus) focusTrigger?.();
    focusTrigger = null;
  }
  function open(event, surface, keyboard = false) {
    const resolved = resolveMenu(event, surface, keyboard);
    if (!resolved) return;
    event.preventDefault();
    const { x, y } = resolved;
    document.querySelectorAll('.popover[open]').forEach(popover => { popover.open = false; });
    actions = resolved.actions;
    focusTrigger = resolved.focusTrigger;
    for (const button of buttons) {
      button.hidden = actions[button.dataset.contextAction]?.visible === false;
      button.disabled = !actions[button.dataset.contextAction]?.enabled;
      button.tabIndex = -1;
    }
    menu.querySelectorAll('[data-context-separator]').forEach(separator => {
      separator.hidden = actions[separator.dataset.contextSeparator]?.visible === false;
    });
    menu.hidden = false;
    const margin = 8, bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin))}px`;
    const first = buttons.find(button => !button.hidden && !button.disabled);
    if (first) { first.tabIndex = 0; first.focus({ preventScroll: true }); }
  }
  for (const surface of surfaces) {
    surface.addEventListener('contextmenu', event => open(event, surface));
    surface.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        open(event, surface, true); event.stopPropagation();
      }
    });
  }
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-context-action]');
    if (!button || button.hidden || button.disabled) return;
    const action = actions[button.dataset.contextAction];
    close(true);
    if (action?.enabled) Promise.resolve().then(() => action.run()).catch(error => status(error.message));
  });
  menu.addEventListener('contextmenu', event => event.preventDefault());
  menu.addEventListener('keydown', event => {
    if (menu.hidden) return;
    // Menu navigation must never move/delete the selected canvas components.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (buttons.includes(document.activeElement) && !document.activeElement.hidden && !document.activeElement.disabled) document.activeElement.click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = buttons.filter(button => !button.hidden && !button.disabled), index = enabled.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    buttons.forEach(button => { button.tabIndex = -1; });
    if (enabled[next]) { enabled[next].tabIndex = 0; enabled[next].focus({ preventScroll: true }); }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener('contextmenu', event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (!menu.contains(event.target)) close(); });
  document.addEventListener('scroll', event => { if (!menu.contains(event.target)) close(true); }, true);
  window.addEventListener('resize', () => close(true));
  window.addEventListener('blur', () => close());
  return { close };
}

function menuPoint(event, anchor, keyboard) {
  if (!keyboard && (event.clientX || event.clientY)) return { x: event.clientX, y: event.clientY };
  const bounds = anchor.getBoundingClientRect();
  return { x: bounds.left + Math.min(bounds.width, 24), y: bounds.top + Math.min(bounds.height, 24) };
}

export function installCanvasContextMenu({ document, canOpen, selectTarget, getActions, getContext = () => null, status, hitTest }) {
  const stage = document.getElementById('main-canvas');
  const layers = document.getElementById('layers');
  return installContextMenu({ document, menu: document.getElementById('canvas-context-menu'), surfaces: [stage, layers], status,
    resolveMenu(event, surface, keyboard) {
      if (!canOpen() || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.target.isContentEditable) return;
      const hit = surface === stage && !keyboard && hitTest ? hitTest(event)
        : event.target.closest('[data-object-id], [data-resize-id], [data-rotate-id], [data-layer-id]');
      const id = hit?.dataset.objectId || hit?.dataset.resizeId || hit?.dataset.rotateId || hit?.dataset.layerId;
      // Read the anchor before selection redraws and replaces its SVG/layer row.
      const { x, y } = menuPoint(event, hit || stage.querySelector('[data-object-id][aria-pressed="true"]') || surface, keyboard);
      const context = getContext({ surface, keyboard, clientX: x, clientY: y });
      if (id) selectTarget(id, { individual: event.altKey || surface === layers, forceIndividual: event.altKey });
      return { x, y, actions: getActions(context), focusTrigger: () => stage.focus({ preventScroll: true }) };
    }
  });
}

export function installIllustrationContextMenu({ document, getActions, focusRow, status }) {
  const list = document.getElementById('illustrations');
  return installContextMenu({ document, menu: document.getElementById('illustration-context-menu'), surfaces: [list], status,
    resolveMenu(event, _surface, keyboard) {
      const row = event.target.closest('[data-illustration-id]');
      if (!row || document.querySelector('dialog[open]')) return;
      const id = row.dataset.illustrationId;
      return { ...menuPoint(event, row, keyboard), actions: getActions(id), focusTrigger: () => focusRow(id) };
    }
  });
}

export function bindPopovers(document, onFigureMenuToggle) {
  // Native disclosures keep less-used actions out of the canvas workspace.
  document.addEventListener('click', event => {
    document.querySelectorAll('.popover[open]').forEach(menu => {
      // The select's finishing click must not dismiss the custom-size form it opened.
      const sizeControl = menu.classList.contains('canvas-options') && event.target.closest('#canvas-size');
      const selectionControl = menu.id === 'align-menu' && event.target.closest('#selection-align');
      if ((!menu.contains(event.target) && !sizeControl && !selectionControl) || event.target.closest('.popover-panel button:not(.image-generation-info-button, .palette-panel button)')) menu.open = false;
    });
  });
  document.querySelectorAll('.popover').forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('.popover[open]').forEach(other => { if (other !== menu) other.open = false; });
    if (menu.id === 'figure-menu') onFigureMenuToggle();
  }));
}
