// Layers and Assets occupy one rail. A single state owns visibility, focus
// and every entry point. Right toolbar buttons open, switch or fold the rail.
export function createComponentRail({ document, onChange = () => {}, focusTab = name => document.getElementById(`${name}-tab`).focus({ preventScroll: true }) }) {
  const $ = id => document.getElementById(id), names = ['layers', 'assets'];
  const rail = $('layer-inspector');
  let active = null, lastPanel = 'layers';
  function openPanel(name, focusTabRequested = false) {
    const previous = active, focused = document.activeElement;
    if (!name && rail.contains(focused)) focusTab(lastPanel);
    else if (name && (focusTabRequested || (previous && previous !== name && $(`${previous}-panel`).contains(focused)))) focusTab(name);
    active = name;
    if (active) lastPanel = active;
    rail.hidden = !active; rail.inert = !active;
    rail.dataset.panel = active || '';
    rail.setAttribute('aria-label', active === 'assets' ? 'Reusable assets' : 'Layers and properties');
    document.querySelector('.work-area').classList.toggle('is-inspector-open', Boolean(active));
    for (const key of names) {
      const selected = key === active, panel = $(`${key}-panel`), tab = $(`${key}-tab`);
      panel.hidden = !selected; panel.inert = !selected;
      tab.setAttribute('aria-pressed', String(selected));
      tab.setAttribute('aria-expanded', String(selected));
      tab.title = `${selected ? 'Hide' : 'Show'} ${key === 'layers' ? 'layers and properties' : 'reusable assets'}`;
    }
    $('component-panel-title').textContent = active === 'assets' ? 'Assets' : 'Layers';
    $('layer-count').hidden = active !== 'layers';
    if (active !== previous) onChange(active);
  }
  for (const key of names) {
    $(`${key}-tab`).addEventListener('click', () => openPanel(active === key ? null : key));
  }
  $('close-layers').addEventListener('click', () => openPanel(null));
  $('component-panel-switch').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const focusedPanel = event.target.closest('button')?.id === 'assets-tab' ? 'assets' : 'layers';
    const name = event.key === 'Home' ? 'layers' : event.key === 'End' ? 'assets' : focusedPanel === 'layers' ? 'assets' : 'layers';
    openPanel(name, true);
  });
  openPanel(null);
  return { open: name => openPanel(name), close: () => openPanel(null), getActive: () => active };
}
