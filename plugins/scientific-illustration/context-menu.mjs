// This plugin is self-contained; the menu uses the same editor actions as the
// toolbar and shortcuts, without requiring a host menu or clipboard permission.
export function installCanvasContextMenu({ document, canOpen, selectTarget, getActions, status, hitTest }) {
  const menu = document.getElementById('canvas-context-menu');
  const stage = document.getElementById('main-canvas');
  const layers = document.getElementById('layers');
  const window = document.defaultView;
  const buttons = [...menu.querySelectorAll('[role="menuitem"]')];
  let actions = {};
  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true; actions = {};
    if (restoreFocus) stage.focus({ preventScroll: true });
  }
  function open(event, surface, keyboard = false) {
    if (!canOpen() || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.target.isContentEditable) return;
    event.preventDefault();
    const hit = surface === stage && !keyboard && hitTest ? hitTest(event)
      : event.target.closest('[data-object-id], [data-resize-id], [data-rotate-id], [data-layer-id]');
    const id = hit?.dataset.objectId || hit?.dataset.resizeId || hit?.dataset.rotateId || hit?.dataset.layerId;
    // Read the anchor before selection redraws and replaces its SVG/layer row.
    const anchor = (hit || stage.querySelector('[data-object-id][aria-pressed="true"]') || surface).getBoundingClientRect();
    if (id) selectTarget(id, { individual: event.altKey || surface === layers, forceIndividual: event.altKey });
    document.querySelectorAll('.popover[open]').forEach(popover => { popover.open = false; });
    actions = getActions();
    for (const button of buttons) {
      button.disabled = !actions[button.dataset.contextAction]?.enabled;
      button.tabIndex = -1;
    }
    menu.hidden = false;
    const margin = 8, bounds = menu.getBoundingClientRect();
    const x = keyboard || !event.clientX && !event.clientY ? anchor.left + Math.min(anchor.width, 24) : event.clientX;
    const y = keyboard || !event.clientX && !event.clientY ? anchor.top + Math.min(anchor.height, 24) : event.clientY;
    menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin))}px`;
    const first = buttons.find(button => !button.disabled);
    if (first) { first.tabIndex = 0; first.focus({ preventScroll: true }); }
  }
  for (const surface of [stage, layers]) {
    surface.addEventListener('contextmenu', event => open(event, surface));
    surface.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        open(event, surface, true); event.stopPropagation();
      }
    });
  }
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-context-action]');
    if (!button || button.disabled) return;
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
      if (buttons.includes(document.activeElement) && !document.activeElement.disabled) document.activeElement.click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = buttons.filter(button => !button.disabled), index = enabled.indexOf(document.activeElement);
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
