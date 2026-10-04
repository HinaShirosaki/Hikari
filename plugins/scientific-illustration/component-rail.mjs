// Layers and Assets occupy one rail. A single state owns visibility, focus
// and every entry point. The toolbar switch opens, switches or folds the rail.
export function createComponentRail({ document, onChange = () => {} }) {
  const $ = id => document.getElementById(id), names = ['layers', 'assets'];
  const rail = $('layer-inspector');
  let active = null, lastPanel = 'layers';
  function openPanel(name, focusTab = false) {
    const previous = active, focused = document.activeElement;
    if (!name && rail.contains(focused)) $(`${lastPanel}-tab`).focus({ preventScroll: true });
    else if (name && (focusTab || (previous && previous !== name && $(`${previous}-panel`).contains(focused)))) $(`${name}-tab`).focus({ preventScroll: true });
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
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const focusedPanel = event.target.closest('button')?.id === 'assets-tab' ? 'assets' : 'layers';
    const name = event.key === 'Home' ? 'layers' : event.key === 'End' ? 'assets' : focusedPanel === 'layers' ? 'assets' : 'layers';
    openPanel(name, true);
  });
  openPanel(null);
  return { open: name => openPanel(name), close: () => openPanel(null), getActive: () => active };
}
