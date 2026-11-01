// Keep a usable local strip on older hosts; newer Hikari hosts render these
// declarative controls beside the existing agent chat toggle.
const definitions = [
  ['pointer-tool', 'pointer', 'selection'], ['freehand-tool', 'lasso', 'selection'],
  ['add-menu', 'plus', 'edit'],
  ['crop-raster', 'crop', 'edit'],
  ['group-selection', 'group', 'group'], ['ungroup-selection', 'ungroup', 'group'],
  ['align-menu', 'align', 'group'],
  ['layers-tab', 'layers', 'panels'],
  ['zoom-out', 'minus', 'zoom'], ['zoom-level', '', 'zoom'], ['zoom-in', 'plus', 'zoom'], ['zoom-fit', 'fit', 'zoom']
];
const menuIds = ['add-menu', 'align-menu'];
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
