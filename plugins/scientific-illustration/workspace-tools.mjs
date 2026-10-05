// Keep a usable local strip on older hosts; newer Hikari hosts render these
// declarative controls beside the existing agent chat toggle.
const definitions = [
  ['pointer-tool', 'pointer', 'selection'], ['freehand-tool', 'lasso', 'selection'],
  ['add-menu', 'plus', 'edit'], ['undo', 'undo', 'edit'], ['redo', 'redo', 'edit'],
  ['group-selection', 'group', 'group'], ['ungroup-selection', 'ungroup', 'group'],
  ['layers-tab', 'layers', 'panels'], ['assets-tab', 'assets', 'panels'], ['toggle-scratch', 'scratch', 'panels'],
  ['zoom-out', 'minus', 'zoom'], ['zoom-level', '', 'zoom'], ['zoom-in', 'plus', 'zoom'], ['zoom-fit', 'fit', 'zoom']
];
export function createWorkspaceTools({ hikari, document, onHosted = () => {} }) {
  const $ = id => document.getElementById(id), win = document.defaultView;
  let supported = false, hosted = false, signature = '', scheduled = false, inFlight = false;
  const tools = () => definitions.map(([id, icon, group]) => {
    const node = $(id), control = id === 'add-menu' ? node.querySelector('summary') : node;
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
    if (!hosted) { (id === 'add-menu' ? $(id)?.querySelector('summary') : $(id))?.focus({ preventScroll: true }); return; }
    void hikari.call('app.setWorkspaceTools', { tools: tools(), focusId: id }).catch(() => {});
  }
  hikari.on('app.workspaceTool', ({ id, y }) => {
    if (!hosted || !definitions.some(entry => entry[0] === id)) return;
    if (id !== 'add-menu') { $(id)?.click(); return; }
    const menu = $('add-menu');
    document.querySelectorAll('.popover[open]').forEach(other => { if (other !== menu) other.open = false; });
    menu.open = !menu.open;
    if (menu.open) {
      const panel = menu.querySelector('.popover-panel');
      const top = Math.max(8, Math.min(Number(y) || 64, win.innerHeight - panel.getBoundingClientRect().height - 8));
      menu.style.setProperty('--tool-menu-top', `${top}px`);
      panel.querySelector('button')?.focus();
    }
  });
  $('add-menu').addEventListener('toggle', () => {
    const menu = $('add-menu');
    if (hosted || !menu.open) return;
    const panel = menu.querySelector('.popover-panel'), top = menu.querySelector('summary').getBoundingClientRect().top;
    menu.style.setProperty('--tool-menu-top', `${Math.max(8, Math.min(top, win.innerHeight - panel.getBoundingClientRect().height - 8))}px`);
  });
  return {
    sync: schedule, focus, isHosted: () => hosted,
    connect(info) {
      if (supported || hosted || !info?.layout?.workspaceTools?.available || info.permissions && !info.permissions.includes('layout')) return;
      supported = true; schedule();
    }
  };
}
