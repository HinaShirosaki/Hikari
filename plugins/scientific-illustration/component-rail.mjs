import { createPresentation } from "./i18n.mjs";
const i18nUi = createPresentation("figura");
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
