import { createPresentation } from './i18n.mjs';
import { selectionLayoutUnits } from './geometry.mjs';

const i18nUi = createPresentation('figura');

// Keep the input outside the SVG so selection redraws do not interrupt typing.
// Its screen transform follows the label through canvas zoom, pan and rotation.
function createCanvasTextEditor({ getContext, save, status }) {
  let session = null;
  // Measure HTML text with the same font settings as the input. Canvas text
  // measurement enables optical sizing, which underestimates some Inter labels.
  const surface = document.createElement('div'), measure = document.createElement('span'), baseline = document.createElement('span');
  surface.setAttribute('aria-hidden', 'true');
  Object.assign(surface.style, { position: 'fixed', width: '0', height: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' });
  Object.assign(measure.style, { display: 'inline-block', width: 'max-content', whiteSpace: 'pre',
    fontOpticalSizing: 'none', fontKerning: 'normal', fontSynthesis: 'style' });
  Object.assign(baseline.style, { display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline' });
  surface.append(measure); document.body.append(surface);

  function close({ focus = false } = {}) {
    if (!session) return;
    const { input, stage, id } = session;
    session = null;
    input.remove(); stage.classList.remove('is-editing-text');
    stage.querySelector(`[data-object-id="${id}"] text`)?.style.removeProperty('visibility');
    if (focus) stage.focus({ preventScroll: true });
  }

  function layout() {
    if (!session) return;
    const { input, stage, id } = session;
    const object = getContext().state?.objects.find(object => object.id === id);
    const group = stage.querySelector(`[data-object-id="${id}"]`), text = group?.querySelector('text');
    const matrix = group?.getScreenCTM();
    if (!object || !text || !matrix) { close(); return; }
    const scale = Math.hypot(matrix.a, matrix.b), padding = 4 / scale;
    const lines = input.value.split('\n'), lineHeight = object.fontSize * 1.2;
    const font = { fontFamily: object.fontFamily, fontSize: `${object.fontSize}px`,
      fontWeight: String(object.fontWeight), fontStyle: object.italic ? 'italic' : 'normal', lineHeight: `${lineHeight}px` };
    Object.assign(measure.style, font);
    measure.replaceChildren(baseline, document.createTextNode(input.value));
    const measured = measure.getBoundingClientRect();
    const firstBaseline = baseline.getBoundingClientRect().top - measured.top;
    const width = Math.max(object.width, 48 / scale, measured.width);
    const height = lines.length * lineHeight;
    const x = Number(text.getAttribute('x')) - width * ({ start: 0, middle: 0.5, end: 1 }[object.align]);
    const y = object.anchor === 'top' ? 0 : object.anchor === 'middle' ? (object.height - height) / 2 : object.height - height;
    // The field covers the label's whole box (it stands in for the hidden
    // selection frame); padding-top places the text at its anchored position.
    const textTop = y + object.fontSize - firstBaseline, top = Math.min(0, textTop);
    const bottom = Math.max(object.height, textTop + height);
    const transform = matrix.translate(x - padding, top - padding);
    // Fixed to the window, so clip to the stage's scrollport: a label scrolled
    // under the rulers, rails or tool bar must not paint over them.
    const view = stage.getBoundingClientRect(), inverse = transform.inverse();
    const left = view.left + stage.clientLeft, right = left + stage.clientWidth;
    const viewTop = view.top + stage.clientTop, viewBottom = viewTop + stage.clientHeight;
    const clip = [[left, viewTop], [right, viewTop], [right, viewBottom], [left, viewBottom]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse)).map(({ x, y }) => `${x}px ${y}px`).join(',');
    // The font shorthand resets optical sizing and kerning, changing variable
    // fonts such as Inter when switching from SVG to the editing field.
    Object.assign(input.style, { ...font, color: object.color,
      textAlign: { start: 'left', middle: 'center', end: 'right' }[object.align],
      textDecoration: object.underline ? 'underline' : 'none', padding: `${padding}px`, paddingTop: `${padding + textTop - top}px`,
      width: `${width + padding * 2 + 1}px`, height: `${bottom - top + padding * 2}px`, clipPath: `polygon(${clip})`,
      transform: `matrix(${transform.a},${transform.b},${transform.c},${transform.d},${transform.e},${transform.f})` });
    text.style.visibility = 'hidden'; stage.classList.add('is-editing-text');
  }

  async function commit({ focus = false } = {}) {
    const current = session;
    if (!current || current.saving) return;
    if (current.input.value === current.original) { close({ focus }); return; }
    current.saving = true; current.input.readOnly = true;
    const { state, illustrationId } = getContext();
    try {
      const result = await save({ id: current.id, text: current.input.value, revision: state.revision, illustrationId });
      if (session !== current) return;
      if (result?.ok) close({ focus });
      else {
        current.saving = false; current.input.readOnly = false;
        current.input.focus({ preventScroll: true });
      }
    } catch (error) {
      status(error.message);
      if (session === current) {
        current.saving = false; current.input.readOnly = false;
        current.input.focus({ preventScroll: true });
      }
    }
  }

  function open(id) {
    if (session?.id === id) { session.input.focus({ preventScroll: true }); return true; }
    const { state, illustrationId } = getContext();
    const object = state?.objects.find(object => object.id === id);
    const stage = document.getElementById('main-canvas');
    if (object?.type !== 'text' || !stage.querySelector(`[data-object-id="${id}"] text`)) return false;
    close();
    const input = document.createElement('textarea');
    input.id = 'canvas-text-editor'; input.className = 'canvas-text-editor';
    i18nUi.setAttribute(input, "aria-label", i18nUi.message("Edit label text")); input.maxLength = 3000;
    // Announced, not shown: a hover tooltip would sit on top of the canvas.
    input.setAttribute("aria-description", i18nUi.text("Enter to save · Shift+Enter for a new line · Escape to cancel"));
    input.wrap = 'off'; input.value = object.text;
    session = { id, illustrationId, stage, input, original: object.text, saving: false };
    input.addEventListener('input', layout);
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); }
      else if (event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey)) {
        event.preventDefault(); void commit({ focus: true });
      }
    });
    input.addEventListener('blur', () => void commit());
    document.body.append(input); layout();
    input.focus({ preventScroll: true }); input.select();
    return true;
  }

  function sync(next, illustrationId) {
    if (!session) return;
    const object = next.objects.find(object => object.id === session.id);
    if (illustrationId !== session.illustrationId || object?.type !== 'text' || !object.visible
      || object.text !== session.original && !(session.saving && object.text === session.input.value)) {
      close();
    }
  }
  document.addEventListener('pointerdown', event => {
    if (session && !session.input.contains(event.target)) void commit();
  }, true);
  document.addEventListener('scroll', layout, true);
  window.addEventListener('resize', layout);
  return { open, layout, sync, close, isActive: () => Boolean(session) };
}

// Keep the bundled/common suggestions and free-form entry on older hosts.
// A focus retries discovery after a temporary failure or an empty font list.
export function initFontPicker({ hikari, documentObject = document }) {
  const input = documentObject.getElementById('text-font');
  const list = documentObject.getElementById('fonts');
  const fallback = [...list.options].map(option => option.value);
  let loaded = false, pending = null;
  function load() {
    if (loaded) return Promise.resolve(true);
    if (!pending) {
      pending = Promise.resolve().then(() => hikari.call('app.listFonts')).then(result => {
        if (!Array.isArray(result?.families) || !result.families.length) return false;
        const names = new Map();
        for (const value of [...fallback, ...result.families]) {
          const name = typeof value === 'string' ? value.trim() : '';
          if (name && name.length <= 100 && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
        }
        const sorted = [...names.values()].sort((a, b) => a.localeCompare(b));
        list.replaceChildren(...sorted.map(name => {
          const option = documentObject.createElement('option'); option.value = name; return option;
        }));
        loaded = true;
        return true;
      }).catch(() => false).finally(() => { pending = null; });
    }
    return pending;
  }
  input.addEventListener('focus', () => { void load(); });
  void load();
  return { load };
}

// Preview outside the document model; persist one edit when an adjustment ends.
function createOpacityControl({ document, getContext, preview, save, status }) {
  const range = document.getElementById('opacity-range'), number = document.getElementById('opacity-number');
  let session = null, pending = null, writing = null, previous = '', generation = 0, sequence = 0, ignoreChange = false;
  let queue = Promise.resolve();
  const targetMatches = (a, b) => Boolean(a && b && a.illustrationId === b.illustrationId && a.id === b.object?.id);
  const context = () => { const current = getContext(); return current.object ? current : null; };
  const percent = value => Math.round(value * 1000) / 10;
  function display(value) {
    const text = String(percent(value));
    range.value = number.value = text;
    range.style.setProperty('--opacity-progress', `${text}%`);
    range.setAttribute('aria-valuetext', `${text}%`);
  }
  function sync() {
    const current = context(), key = current ? JSON.stringify([current.illustrationId, current.object.id, current.revision]) : '';
    if (previous !== key) {
      const ownSave = targetMatches(writing, current) && current?.object.opacity === writing.value;
      if (!ownSave) {
        generation++; ignoreChange ||= Boolean(session); session = pending = null;
      }
      previous = key;
    }
    range.disabled = number.disabled = !current;
    if (!current) return;
    const adjustment = session || pending;
    display(adjustment?.value ?? current.object.opacity);
    // A completed earlier save may redraw while a later adjustment is pending.
    if (adjustment) preview(current, adjustment.value);
  }
  function input(event) {
    if (ignoreChange || !event.target.validity.valid || event.target.value === '') return;
    const current = context(); if (!current) return;
    session ||= { illustrationId: current.illustrationId, id: current.object.id };
    if (!targetMatches(session, current)) return;
    session.value = Number(event.target.value) / 100;
    display(session.value); preview(current, session.value);
  }
  function restore() {
    session = null; sync();
    const current = context(); if (current) preview(current, pending?.value ?? current.object.opacity);
  }
  function change(event) {
    if (ignoreChange) { ignoreChange = false; restore(); return; }
    if (!event.target.validity.valid || event.target.value === '') { restore(); return; }
    const current = context(); if (!current) return;
    const intent = { illustrationId: current.illustrationId, id: current.object.id, value: Number(event.target.value) / 100,
      generation, sequence: ++sequence };
    session = null; pending = intent;
    queue = queue.then(async () => {
      const latest = context();
      if (intent.generation !== generation || !targetMatches(intent, latest)) return;
      if (latest.object.opacity === intent.value) return;
      writing = intent;
      try {
        const result = await save({ ...intent, revision: latest.revision });
        if (!result?.ok) throw new Error(result?.error || 'Could not save opacity.');
      } finally { writing = null; }
    }).catch(error => {
      status(error.message);
      if (intent.generation === generation) { generation++; session = pending = null; }
    }).finally(() => {
      if (pending === intent) pending = null;
      sync();
      const latest = context(); if (latest && !session && !pending) preview(latest, latest.object.opacity);
    });
  }
  for (const control of [range, number]) {
    control.addEventListener('pointerdown', () => { ignoreChange = false; });
    control.addEventListener('focus', () => { ignoreChange = false; });
    control.addEventListener('input', input);
    control.addEventListener('change', change);
    control.addEventListener('pointercancel', () => { ignoreChange = true; restore(); });
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); ignoreChange = true; restore(); }
      else {
        ignoreChange = false;
        if (event.key === 'Enter') { event.preventDefault(); change(event); }
      }
    });
  }
  return { sync };
}

// Recolor a vector layer one color at a time. Works on the validated SVG
// string, where paints are double-quoted presentation attributes.
// ponytail: hex paints only; named colors (white, red) get no swatch. Stored
// artwork is hex apart from none/url(), so add a name table only if imports need it.
const PAINT = /(\s(fill|stroke|stop-color)=")(#[\da-f]{6}|#[\da-f]{3})(?=")/gi;
const swatch = value => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase()
  : /^#[\da-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map(digit => digit + digit).join('')}`.toLowerCase() : '';

// A layer-wide fill/stroke override hides that channel of the SVG, so its own
// color is the swatch instead.
export function vectorColors(object) {
  const colors = new Set([swatch(object.fill ?? ''), swatch(object.stroke ?? '')]);
  for (const [, , name, value] of object.svg.matchAll(PAINT)) if (object[name] === undefined) colors.add(swatch(value));
  colors.delete('');
  return [...colors];
}

export function recolorVector(object, from, to) {
  const patch = {};
  for (const key of ['fill', 'stroke']) if (swatch(object[key] ?? '') === from) patch[key] = to;
  const svg = object.svg.replace(PAINT, (match, prefix, name, value) => object[name] === undefined && swatch(value) === from ? prefix + to : match);
  if (svg !== object.svg) patch.svg = svg;
  return patch;
}

// While a swatch is being edited, fade every painted shape of the rendered
// artwork that does not use its color and trace the ones that do with marching
// ants. A shape that uses it for only one of fill/stroke fades the other
// channel. The ants are sibling copies, so they share the shape's transforms
// and clipping. Re-rendering the canvas clears both.
function highlightVectorColor(artwork, color) {
  const rgb = `rgb(${[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(', ')})`;
  const gradientUses = id => [...artwork.ownerDocument.getElementById(id)?.querySelectorAll('stop') ?? []].some(stop => getComputedStyle(stop).stopColor === rgb);
  const uses = paint => paint === rgb || gradientUses(/^url\("?#([^")]+)/.exec(paint)?.[1]);
  for (const shape of artwork.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text')) {
    if (shape.closest('defs, clipPath, mask, pattern, marker')) continue;
    const style = getComputedStyle(shape), fill = uses(style.fill), stroke = uses(style.stroke);
    if (!fill || !stroke) shape.classList.add(fill ? 'color-dim-stroke' : stroke ? 'color-dim-fill' : 'color-dim');
    if (fill || stroke) shape.after(...['color-ants', 'color-ants color-ants-dash'].map(name => {
      const ants = shape.cloneNode(true); ants.removeAttribute('id'); ants.setAttribute('class', name); return ants;
    }));
  }
}

export function createSelectionProperties({
  document, workspace, getContext, selected, selectedGroup, selectionTarget, canGroup, select, openLayers,
  edit, renderCanvas, syncSelectionToolbar, syncTools, status
}) {
  const $ = id => document.getElementById(id);
  const properties = $('properties');
  const numeric = new Set(['fontSize']);
  const newId = () => `object-${crypto.randomUUID()}`;

  const opacityControl = createOpacityControl({ document,
    getContext: () => {
      const { state, illustrationId } = getContext();
      return { illustrationId, revision: state?.revision, object: selected() };
    },
    preview: (context, opacity) => {
      const { state, illustrationId, selectedIds } = getContext();
      if (!state || context.illustrationId !== illustrationId || context.object.id !== selectedIds[0]) return;
      renderCanvas('main', { ...state, objects: state.objects.map(object => object.id === context.object.id ? { ...object, opacity } : object) });
    },
    save: ({ illustrationId: targetId, id, value, revision }) => workspace.request({ action: 'apply', illustration_id: targetId,
      expected_revision: revision, request_id: crypto.randomUUID(), operations: [{ op: 'update', id, patch: { opacity: value } }] }),
    status
  });

  const textEditor = createCanvasTextEditor({ getContext, status,
    save: ({ id, text, revision, illustrationId: targetId }) => workspace.request({ action: 'apply', illustration_id: targetId,
      expected_revision: revision, request_id: crypto.randomUUID(), operations: [{ op: 'update', id, patch: { text } }] }).then(result => {
      if (!result.ok) status(result.error);
      return result;
    }) });
  function editLabel(id) {
    if (getContext().state?.objects.find(object => object.id === id)?.type !== 'text') return;
    // Inline editing must not open a panel and refit the canvas beneath the text.
    select(id, { reveal: false });
    if (!textEditor.open(id)) {
      openLayers(); $('label-content').focus(); $('label-content').select();
    }
  }

  function renderProperties() {
    const { state, selectedIds } = getContext();
    const object = selectionTarget(), group = selectedGroup();
    properties.hidden = !object;
    $('group-selection').disabled = !canGroup();
    const canUngroup = state.groups.some(group => group.ids.every(id => selectedIds.includes(id)));
    $('ungroup-selection').disabled = !canUngroup;
    const layoutCount = selectionLayoutUnits(state, selectedIds).length;
    document.querySelectorAll('[data-layout-action]').forEach(button => {
      button.disabled = layoutCount < (button.dataset.layoutAction.startsWith('distribute-') ? 3 : 2);
    });
    $('crop-raster').disabled = object?.type !== 'raster';
    syncTools();
    syncSelectionToolbar();
    opacityControl.sync();
    if (!object) return;
    i18nUi.setText($('selection-type'), (object.type === 'group' ? i18nUi.message("{p0} layers", { p0: selectedIds.length }) : (object.type === 'text' ? i18nUi.message("Text") : (object.type === 'vector' ? i18nUi.message("Vector") : (object.type === 'plot' ? i18nUi.message("Plot") : i18nUi.message("Image"))))));
    properties.elements.name.disabled = object.type === 'group' && !group;
    properties.querySelector('.property-heading').hidden = object.type === 'text';
    properties.querySelector('.object-basics').hidden = object.type === 'group';
    for (const input of properties.elements) {
      if (!input.name || input.name === 'opacity') continue;
      if (input.type === 'checkbox') input.checked = Boolean(object[input.name]);
      else input.value = object[input.name] ?? '';
    }
    $('text-properties').hidden = object.type !== 'text';
    const colors = object.type === 'vector' ? vectorColors(object) : [];
    $('vector-colors').hidden = !colors.length;
    $('vector-color-swatches').replaceChildren(...colors.map(value => {
      const swatch = document.createElement('input'); swatch.type = 'color'; swatch.value = swatch.dataset.color = value;
      swatch.setAttribute('list', 'palette-suggestions');
      i18nUi.setAttribute(swatch, 'title', i18nUi.message('Color {p0}', { p0: value })); i18nUi.setAttribute(swatch, 'aria-label', i18nUi.message('Color {p0}', { p0: value }));
      return swatch;
    }));
    properties.querySelectorAll('[data-text-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.textStyle === 'bold' ? object.fontWeight >= 700 : Boolean(object[button.dataset.textStyle]))));
    properties.querySelectorAll('[data-align]').forEach(button => button.setAttribute('aria-pressed', String(object.align === button.dataset.align)));
  }

  // The focused Colors swatch shows where its color is used on the canvas.
  function syncColorHighlight() {
    const stage = $('main-canvas'), swatch = document.activeElement?.closest('#vector-color-swatches input'), object = selected();
    for (const node of stage.querySelectorAll('.color-dim, .color-dim-fill, .color-dim-stroke')) node.classList.remove('color-dim', 'color-dim-fill', 'color-dim-stroke');
    for (const node of stage.querySelectorAll('.color-ants')) node.remove();
    const artwork = swatch && object?.type === 'vector' && stage.querySelector(`g[data-object-id="${CSS.escape(object.id)}"] > svg`);
    if (artwork) highlightVectorColor(artwork, swatch.value);
  }

  properties.addEventListener('submit', event => event.preventDefault());
  properties.querySelectorAll('[data-text-style], [data-align]').forEach(button => button.addEventListener('click', () => {
    const object = selected(); if (object?.type !== 'text') return;
    const key = button.dataset.textStyle;
    const patch = button.dataset.align ? { align: button.dataset.align } : key === 'bold' ? { fontWeight: object.fontWeight >= 700 ? 400 : 700 } : { [key]: !object[key] };
    void edit([{ op: 'update', id: object.id, patch }]);
  }));
  properties.addEventListener('change', event => {
    const input = event.target, object = selectionTarget();
    if (!input.name || input.name === 'opacity' || !object || !input.validity.valid) return;
    const value = input.type === 'checkbox' ? input.checked : numeric.has(input.name) ? Number(input.value) : input.value;
    const patch = { [input.name]: value };
    if (object.type === 'group') {
      if (input.name === 'name') { const group = selectedGroup(); if (group) void edit([{ op: 'update', id: group.id, patch }]); }
      return;
    }
    void edit([{ op: 'update', id: object.id, patch }]);
  });

  // Preview every picker move; the picker's change commits one undoable edit.
  $('vector-color-swatches').addEventListener('input', event => {
    const object = selected(); if (object?.type !== 'vector') return;
    const patch = recolorVector(object, event.target.dataset.color, event.target.value);
    const { state } = getContext();
    renderCanvas('main', { ...state, objects: state.objects.map(item => item.id === object.id ? { ...item, ...patch } : item) });
  });
  $('vector-color-swatches').addEventListener('focusin', syncColorHighlight);
  $('vector-color-swatches').addEventListener('focusout', () => queueMicrotask(syncColorHighlight));
  $('vector-color-swatches').addEventListener('change', event => {
    const object = selected(); if (object?.type !== 'vector') return;
    const patch = recolorVector(object, event.target.dataset.color, event.target.value);
    if (Object.keys(patch).length) void edit([{ op: 'update', id: object.id, patch }]);
    else renderCanvas('main');
  });

  $('add-text').addEventListener('click', async () => {
    const id = newId(); if ((await edit([{ op: 'upsert', object: { id, type: 'text', name: 'Label', canvas: 'main', text: 'Label', x: 30, y: 30, width: 200, height: 50 } }]))?.ok) { select(id); $('label-content').focus(); $('label-content').select(); }
  });

  return {
    render: renderProperties,
    syncColorHighlight,
    editLabel,
    syncText: textEditor.sync,
    layoutText: textEditor.layout,
    isEditingText: textEditor.isActive
  };
}
