import { createPresentation } from "../i18n.mjs";
const i18nUi = createPresentation("gel");
const CATEGORIES = [
  ['image', 'Image', 'M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4M8 8h.01'],
  ['lanes', 'Lanes', 'M4 4v16M9 4v16M15 4v16M20 4v16M4 8h16M4 16h16'],
  ['ladder', 'Ladder', 'M6 3v18M18 3v18M6 6h12M6 10h12M6 14h12M6 18h12'],
  ['bands', 'Bands', 'M4 5h16M4 19h16M7 9h4v2H7zM14 13h4v2h-4z'],
  ['results', 'Results', 'M4 3v17h17M8 16v-5M13 16V7M18 16V4'],
  ['processed', 'Processed', '']
];

export function createGelToolDock({ documentObject: doc, onProcess, onSelect }) {
  const workspace = doc.querySelector('.gel-workspace');
  const viewer = doc.querySelector('.gel-viewer-panel');
  const inspector = doc.querySelector('.gel-inspector');
  const panel = doc.querySelector('.gel-tools-panel');
  const toolbar = doc.querySelector('.gel-viewer-toolbar');
  const figure = doc.getElementById('gel-figure-inspector');
  const layout = doc.getElementById('gel-open-figure-btn');
  if (!viewer || !inspector || !panel || !toolbar) return { destroy() {} };
  const view = doc.defaultView;
  const disposers = [];
  const get = id => doc.getElementById(`gel-${id}`);
  const listen = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    disposers.push(() => node.removeEventListener(type, handler, options));
  };
  function svg(path) {
    return `<svg class="gel-card-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}" /></svg>`;
  }
  viewer.classList.add('has-gel-tool-dock');
  panel.id = 'gel-tools-panel'; panel.setAttribute('aria-labelledby', 'gel-tool-panel-title');
  panel.removeAttribute('aria-label');
  const header = doc.createElement('header'); header.className = 'gel-tool-panel-head';
  i18nUi.setHtml(header, `<h3 id="gel-tool-panel-title">${i18nUi.html("Image")}</h3><button type="button" class="gel-tool-panel-close" data-i18n-aria-label="gel.full.ba68f196" aria-label="Hide tools" data-i18n-title="gel.full.ba68f196" title="Hide tools">${svg('m6 6 12 12M18 6 6 18')}</button>`);
  panel.prepend(header);
  const context = doc.createElement('div'); context.className = 'gel-tool-context';
  header.after(context);
  for (const id of ['crop-bar', 'finish-dividers-btn']) context.append(get(id));

  const categoryGroup = doc.createElement('div'); categoryGroup.className = 'gel-tool-categories';
  categoryGroup.setAttribute('role', 'group'); i18nUi.setAttribute(categoryGroup, "aria-label", i18nUi.message("Tool categories"));
  const pages = new Map(), buttons = new Map();
  for (const [key, label, path] of CATEGORIES) {
    const old = [...doc.querySelectorAll('.gel-tool-group')].find(node => node.dataset.gelSourceCategory === key);
    const page = doc.createElement('section'); page.className = 'gel-tool-group'; page.id = `gel-tool-page-${key}`;
    page.dataset.gelToolPanel = key; i18nUi.setAttribute(page, "aria-label", i18nUi.message("{p0} tools", { p0: label }));
    page.append(old.querySelector('.gel-tool-body')); old.replaceWith(page); pages.set(key, page);
    const button = key === 'processed' ? get('process-image-btn') : doc.createElement('button');
    button.type = 'button'; if (key !== 'processed') button.id = `gel-tool-${key}-btn`;
    button.className = 'gel-tool-icon-btn'; button.dataset.gelToolCategory = key;
    i18nUi.setAttribute(button, 'aria-label', i18nUi.owned(label)); i18nUi.setAttribute(button, "title", i18nUi.owned(label));
    button.setAttribute('aria-controls', 'gel-tools-panel');
    if (key !== 'processed') {
      i18nUi.setHtml(button, `${svg(path)}<span class="gel-card-label">${i18nUi.renderOwned(label)}</span>`);
      categoryGroup.append(button);
    }
    buttons.set(key, button);
  }
  // Crop is a mode, not a page: it sits with the tools but keeps its own handler.
  const crop = get('crop-mode-btn');
  buttons.get('image').after(crop);
  categoryGroup.append(layout); toolbar.prepend(categoryGroup); buttons.set('layout', layout);
  i18nUi.setAttribute(layout, "title", i18nUi.message("Layout")); i18nUi.setAttribute(layout, "aria-label", i18nUi.message("Layout")); layout.setAttribute('aria-controls', 'gel-tools-panel');
  for (const [id, label] of [['export-menu-btn', 'Export']]) {
    i18nUi.setAttribute(get(id), 'aria-label', i18nUi.owned(label)); i18nUi.setAttribute(get(id), "title", i18nUi.owned(label));
  }
  const actions = doc.querySelector('.gel-record-actions');
  actions.setAttribute('role', 'group'); i18nUi.setAttribute(actions, "aria-label", i18nUi.message("Save"));
  get('save-btn').setAttribute('form', 'gel-form'); toolbar.append(actions);
  const form = get('form'), name = form.querySelector('.gel-name-field');
  let active = 'image', processing = 'image', open = true, wasLayout = false, lastStep = '';
  const isLayout = () => workspace.classList.contains('is-showing-layout');
  const isCropping = () => !get('crop-bar').hidden;
  const isTrimming = () => Boolean(get('figure-preview')?.classList.contains('is-trimming'));
  function render() {
    viewer.classList.toggle('is-tools-collapsed', !open);
    panel.hidden = !open;
    const cropping = isCropping();
    i18nUi.setOwnedText(header.querySelector('h3'), (cropping ? i18nUi.message("Crop") : (active === 'layout' ? i18nUi.message("Layout") : CATEGORIES.find(([key]) => key === active)[1])));
    // Layout is the Stack's view, so its icon shows only there; gel tools wait for a gel.
    const stack = isLayout();
    layout.hidden = !stack;
    for (const [key, page] of pages) page.hidden = key !== active;
    name.hidden = active !== 'image';
    crop.inert = stack;
    for (const [key, button] of buttons) {
      const selected = open && !cropping && active === key;
      button.setAttribute('aria-expanded', String(selected));
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
      if (key !== 'layout') {
        button.disabled = stack || cropping;
        i18nUi.setAttribute(button, "title", (stack ? i18nUi.message("{p0} — select a gel", { p0: button.getAttribute('aria-label') }) : button.getAttribute('aria-label')));
      }
    }
    i18nUi.setAttribute(get('save-btn'), "aria-label", (isLayout() ? i18nUi.message("Save project") : i18nUi.message("Save gel")));
    i18nUi.setAttribute(get('save-btn'), "title", (isLayout() ? i18nUi.message("Save project") : i18nUi.message("Save gel")));
    const reset = get('reset-overrides-btn');
    reset.hidden = isLayout();
    reset.disabled = crop.disabled || stack || cropping;
    for (const button of [layout, get('process-image-btn'), reset, get('export-menu-btn'), ...actions.querySelectorAll('button')]) button.inert = isCropping() || (button === layout && isTrimming());
    onSelect?.(active);
  }
  function select(key) {
    if (isCropping() || isTrimming()) return;
    if (key === active && open) { open = false; render(); return; }
    if (isLayout()) onProcess();
    active = processing = key; open = true; render();
  }
  for (const [key, button] of buttons) {
    if (key === 'layout') continue;
    listen(button, 'click', () => select(key));
  }
  // The existing Layout action changes the canvas. Once it is showing, its
  // icon only toggles the inspector, leaving the canvas and selection intact.
  listen(layout, 'click', event => {
    if (!isLayout()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    active = 'layout'; open = !open; render();
  }, true);
  listen(header.querySelector('button'), 'click', () => {
    if (isCropping() || isTrimming()) return;
    open = false; render(); buttons.get(active).focus();
  });
  listen(toolbar, 'keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.target.closest('[popover]')) return;
    const enabled = [...toolbar.querySelectorAll('button')].filter(button => !button.disabled && !button.inert && button.checkVisibility());
    const index = enabled.indexOf(doc.activeElement); if (index < 0) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next].focus();
  });
  // A hidden required name field must reveal its category on validation.
  listen(form, 'invalid', () => { active = processing = 'image'; open = true; render(); }, true);
  function sync() {
    const showingLayout = isLayout();
    if (showingLayout !== wasLayout) {
      active = showingLayout ? 'layout' : processing; open = true; wasLayout = showingLayout;
    }
    if (isCropping()) open = true;
    const step = get('finish-dividers-btn').hidden ? '' : 'lanes';
    if (step && step !== lastStep && !showingLayout) { active = processing = step; open = true; }
    lastStep = step;
    if (isTrimming()) { active = 'layout'; open = true; }
    header.querySelector('button').disabled = isCropping() || isTrimming();
    render();
  }
  const observer = new view.MutationObserver(sync);
  observer.observe(workspace, { attributes: true, attributeFilter: ['class'] });
  observer.observe(get('figure-preview'), { attributes: true, attributeFilter: ['class'] });
  observer.observe(crop, { attributes: true, attributeFilter: ['disabled'] });
  for (const node of [figure, get('crop-bar'), get('finish-dividers-btn')]) observer.observe(node, { attributes: true, attributeFilter: ['hidden'], childList: true });
  sync();
  return { destroy() { observer.disconnect(); disposers.forEach(dispose => dispose()); } };
}
