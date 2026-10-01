import { createWorkspace, encodeText } from './workspace.mjs';
import { scene, renderPreview, objectGroup, element } from './artwork.mjs';
import { initPluginLeftRailResizer } from './left-rail.mjs';
import { icon, mountIcons } from './icons.mjs';
import { COMPLEXITY_PROFILES } from './complexity.mjs';
import { drawingPrompt } from './agent/workflow.mjs';

const { hikari } = window.HikariPlugin;
const $ = id => document.getElementById(id);
const properties = $('properties');
mountIcons();
let selectedId = '', activeCanvas = 'main', illustrationId = '', state, drag = null, pendingRaster = null, replaceRasterId = '', sourceTarget = null;
const status = text => { $('status').textContent = text; };
const workspace = createWorkspace({ hikari, onChange: render, onLibraryChange: renderIllustrations, onViewChange: renderView,
  onHistoryChange: ({ canUndo, canRedo }) => { $('undo').disabled = !canUndo; $('redo').disabled = !canRedo; }, onStatus: status });
const leftRail = initPluginLeftRailResizer({ commitWidth: width => hikari.call('app.setLeftRailWidth', { width }), onCommitError: error => status(error.message) });
const selected = () => state?.objects.find(obj => obj.id === selectedId);
const newId = () => `object-${crypto.randomUUID()}`;
const numeric = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fontSize', 'fontWeight', 'strokeWidth']);
// Native disclosures keep less-used actions out of the canvas workspace.
document.addEventListener('click', event => {
  document.querySelectorAll('.popover[open]').forEach(menu => {
    // The select's finishing click must not dismiss the custom-size form it opened.
    const sizeControl = menu.classList.contains('canvas-options') && event.target.closest('#canvas-size');
    if ((!menu.contains(event.target) && !sizeControl) || event.target.closest('.popover-panel button')) menu.open = false;
  });
});
document.querySelectorAll('.popover').forEach(menu => menu.addEventListener('toggle', () => {
  if (menu.open) document.querySelectorAll('.popover[open]').forEach(other => { if (other !== menu) other.open = false; });
}));
function syncSelectionSize(stage) {
  const svg = stage.querySelector('svg'), handle = svg?.querySelector('.resize-handle');
  const matrix = svg?.getScreenCTM();
  if (!handle || !matrix || !stage.getBoundingClientRect().width) return;
  const scale = Math.hypot(matrix.a, matrix.b); if (!scale) return;
  const object = selected(); if (!object) return;
  const size = 9 / scale;
  handle.setAttribute('width', size); handle.setAttribute('height', size);
  handle.setAttribute('x', Number(handle.dataset.cornerX) - size / 2);
  handle.setAttribute('y', Number(handle.dataset.cornerY) - size / 2);
}
function fitCanvas(stage) {
  const svg = stage.querySelector('svg'); if (!svg) return;
  const box = stage.getBoundingClientRect(), css = getComputedStyle(stage);
  const availableWidth = box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const availableHeight = box.height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
  if (availableWidth <= 0 || availableHeight <= 0) return;
  const ratio = svg.viewBox.baseVal.width / svg.viewBox.baseVal.height;
  const width = Math.min(availableWidth, availableHeight * ratio);
  svg.style.width = `${width}px`; svg.style.height = `${width / ratio}px`;
  syncSelectionSize(stage);
}
function renderCanvas(canvas, documentState = state) {
  const stage = $(`${canvas}-canvas`), focusedId = document.activeElement?.dataset.objectId;
  stage.replaceChildren(scene(documentState, canvas, { interactive: true, selectedId }));
  fitCanvas(stage);
  if (focusedId) stage.querySelector(`[data-object-id="${focusedId}"]`)?.focus({ preventScroll: true });
}
const pendingCanvasFits = new Set();
let canvasFitFrame = 0;
const canvasObserver = new ResizeObserver(entries => {
  entries.forEach(({ target }) => pendingCanvasFits.add(target));
  if (canvasFitFrame) return;
  // Fit on the next frame, outside ResizeObserver's layout delivery cycle.
  canvasFitFrame = requestAnimationFrame(() => {
    canvasFitFrame = 0;
    pendingCanvasFits.forEach(fitCanvas); pendingCanvasFits.clear();
  });
});
for (const canvas of ['main', 'scratch']) canvasObserver.observe($(`${canvas}-canvas`));

async function edit(operations, revision = state?.revision) {
  if (!revision) return status('The illustration is still opening.');
  const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: revision, request_id: crypto.randomUUID(), operations });
  if (!result.ok) { status(result.error); if (state) render(state); }
  return result;
}
function render(next, id = illustrationId) {
  if (id !== illustrationId) {
    illustrationId = id; selectedId = ''; activeCanvas = 'main'; drag = null; pendingRaster = null;
    $('source-dialog').close(); $('raster-dialog').close(); $('prompt').value = ''; $('prompt').style.height = '';
  }
  state = next;
  if (!selected()) selectedId = '';
  for (const key of ['main', 'scratch']) renderCanvas(key);
  $('scratch-size').textContent = `${state.canvases.scratch.width} × ${state.canvases.scratch.height}`;
  $('figure-title').value = state.title;
  $('complexity').value = state.complexity;
  $('complexity').title = COMPLEXITY_PROFILES[state.complexity].summary;
  $('canvas-empty').hidden = state.objects.some(object => object.canvas === 'main');
  $('prompt').placeholder = state.objects.length ? 'Describe a change…' : 'Describe your figure…';
  $('place-scratch').disabled = !state.objects.some(object => object.canvas === 'scratch');
  document.querySelectorAll('button[data-canvas]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.canvas === activeCanvas)));
  renderLayers(); renderProperties();
  renderCanvasProperties();
}
function renderCanvasProperties() {
  const canvas = state.canvases[activeCanvas], name = activeCanvas === 'main' ? 'Main canvas' : 'Scratch canvas';
  const size = $('canvas-size'), value = `${canvas.width}x${canvas.height}`;
  const preset = [...size.options].some(option => option.value === value);
  size.querySelector('[value="custom"]').textContent = preset ? 'Custom…' : `Custom · ${canvas.width} × ${canvas.height}`;
  size.value = preset ? value : 'custom';
  size.setAttribute('aria-label', `${name} size`); size.title = `${name} size: ${canvas.width} × ${canvas.height}`;
  $('canvas-settings-title').textContent = name;
  $('canvas-settings').setAttribute('aria-label', `${name} custom size and background`);
  $('canvas-settings').title = `${name} custom size and background`;
  const canvasForm = $('canvas-properties');
  for (const key of ['width', 'height', 'background']) canvasForm.elements[key].value = canvas[key];
}
function renderView({ scratch_visible: visible }) {
  const focusInScratch = $('scratch-workspace').contains(document.activeElement);
  $('scratch-workspace').hidden = !visible;
  document.querySelector('.workspace').classList.toggle('has-scratch', visible);
  $('toggle-scratch').setAttribute('aria-expanded', String(visible));
  if (!visible && activeCanvas === 'scratch') {
    activeCanvas = 'main'; selectedId = ''; drag = null;
    if (state) render(state);
  }
  if (!visible && focusInScratch) $('toggle-scratch').focus({ preventScroll: true });
}
async function showScratch(visible) {
  const result = await workspace.request({ action: 'scratch', illustration_id: illustrationId, visible });
  if (!result.ok) status(result.error);
}
$('toggle-scratch').addEventListener('click', () => void showScratch(!workspace.getView().scratch_visible));
$('close-scratch').addEventListener('click', () => void showScratch(false));
function renderIllustrations(library = workspace.getLibrary()) {
  if (!library) return;
  const focusedId = document.activeElement?.dataset.illustrationId;
  const query = $('illustration-search').value.trim().toLowerCase();
  const entries = library.illustrations.filter(item => item.title.toLowerCase().includes(query));
  $('illustrations').replaceChildren();
  for (const entry of entries) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `illustration-row${entry.id === library.active_illustration_id ? ' is-active' : ''}`;
    button.dataset.illustrationId = entry.id; button.setAttribute('aria-pressed', String(entry.id === library.active_illustration_id));
    button.title = entry.title || 'Untitled figure';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M5 3h14v18H5zM8 16l3-4 3 3 2-2'); icon.append(path);
    const title = document.createElement('span'); title.textContent = entry.title || 'Untitled figure';
    button.append(icon, title); button.addEventListener('click', () => {
      if (workspace.getLibrary().active_illustration_id !== entry.id) void manageIllustration('open', entry.id);
    });
    $('illustrations').append(button);
  }
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'rail-note'; empty.textContent = 'No illustrations match your search.'; $('illustrations').append(empty); }
  $('illustration-count').textContent = `${library.illustrations.length} illustration${library.illustrations.length === 1 ? '' : 's'}`;
  if (focusedId) [...$('illustrations').children].find(button => button.dataset.illustrationId === focusedId)?.focus({ preventScroll: true });
}
async function manageIllustration(action, id) {
  try {
    const result = await workspace.manage(action, id);
    if (!result.ok) status(result.error);
    else if (action !== 'open') { $('illustration-search').value = ''; renderIllustrations(); }
  } catch (error) { status(error.message); }
}
$('illustration-search').addEventListener('input', () => renderIllustrations());
$('new-illustration').addEventListener('click', () => void manageIllustration('create'));
$('duplicate-illustration').addEventListener('click', () => illustrationId && void manageIllustration('duplicate', illustrationId));
function renderLayers() {
  const focusedRow = document.activeElement?.closest('[data-layer-id]');
  const focusedId = focusedRow?.dataset.layerId, focusedAction = document.activeElement?.dataset.layerAction;
  $('layers').replaceChildren();
  $('layer-count').textContent = state.objects.length || '';
  const hasScratch = state.objects.some(object => object.canvas === 'scratch');
  for (const canvas of ['main', 'scratch']) {
    const objects = state.objects.filter(object => object.canvas === canvas).reverse();
    if (hasScratch && objects.length) {
      const heading = document.createElement('div'); heading.className = 'layer-group-heading'; heading.setAttribute('role', 'presentation');
      heading.textContent = canvas === 'main' ? 'Main' : 'Scratch'; $('layers').append(heading);
    }
    for (const object of objects) {
    const row = document.createElement('div'); row.className = `layer${object.id === selectedId ? ' is-selected' : ''}${object.visible ? '' : ' is-hidden'}`; row.setAttribute('role', 'listitem'); row.dataset.layerId = object.id;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-select'; button.dataset.layerAction = 'select';
    button.setAttribute('aria-label', `Select ${object.name}`); button.title = object.name;
    const preview = document.createElement('span'); preview.className = `layer-preview ${object.type}`; preview.setAttribute('aria-hidden', 'true');
    if (object.type === 'text') preview.textContent = 'T';
    else {
      const thumbnail = element('svg', { viewBox: `0 0 ${object.width} ${object.height}`, 'aria-hidden': 'true' });
      thumbnail.append(objectGroup({ ...object, x: 0, y: 0, rotation: 0, opacity: 1 })); preview.append(thumbnail);
    }
    const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = object.name;
    button.append(preview, name);
    button.setAttribute('aria-pressed', String(object.id === selectedId)); button.addEventListener('click', () => select(object.id));
    const visibility = document.createElement('button'); visibility.type = 'button'; visibility.className = 'layer-visibility icon-button'; visibility.dataset.layerAction = 'visibility';
    visibility.title = `${object.visible ? 'Hide' : 'Show'} ${object.name}`; visibility.setAttribute('aria-label', visibility.title); visibility.setAttribute('aria-pressed', String(object.visible));
    visibility.append(icon(object.visible ? 'eye' : 'hidden'));
    visibility.addEventListener('click', () => void edit([{ op: 'update', id: object.id, patch: { visible: !object.visible } }]));
    row.append(button, visibility); $('layers').append(row);
    }
  }
  if (!state.objects.length) {
    const empty = document.createElement('p'); empty.className = 'layers-empty'; empty.textContent = 'Your components and labels will appear here.'; $('layers').append(empty);
  }
  if (focusedId && focusedAction) $('layers').querySelector(`[data-layer-id="${focusedId}"] [data-layer-action="${focusedAction}"]`)?.focus({ preventScroll: true });
}
function renderProperties() {
  const object = selected(); properties.hidden = !object;
  $('selection-hint').hidden = Boolean(object) || !state.objects.length;
  if (!object) return;
  $('selection-type').textContent = object.type === 'text' ? 'Text' : object.type === 'vector' ? 'Vector' : 'Image';
  const weights = properties.elements.fontWeight;
  weights.querySelector('[data-custom-weight]')?.remove();
  if (object.type === 'text' && ![...weights.options].some(option => Number(option.value) === object.fontWeight)) {
    const option = document.createElement('option'); option.value = object.fontWeight; option.textContent = object.fontWeight; option.dataset.customWeight = ''; weights.append(option);
  }
  for (const input of properties.elements) {
    if (!input.name) continue;
    if (input.type === 'checkbox') input.checked = Boolean(object[input.name]);
    else input.value = object[input.name] ?? '';
  }
  $('text-properties').hidden = object.type !== 'text'; $('vector-properties').hidden = object.type !== 'vector'; $('replace-raster').hidden = object.type !== 'raster';
  properties.querySelectorAll('[data-text-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.textStyle === 'bold' ? object.fontWeight >= 700 : Boolean(object[button.dataset.textStyle]))));
  properties.querySelectorAll('[data-align]').forEach(button => button.setAttribute('aria-pressed', String(object.align === button.dataset.align)));
  const siblings = state.objects.filter(item => item.canvas === object.canvas);
  $('raise').disabled = siblings.at(-1)?.id === object.id; $('lower').disabled = siblings[0]?.id === object.id;
  $('transfer').textContent = object.canvas === 'main' ? 'Copy to scratch' : 'Copy to main';
}
function select(id) {
  selectedId = id; activeCanvas = selected()?.canvas || activeCanvas; render(state);
  if (activeCanvas === 'scratch' && !workspace.getView().scratch_visible) void showScratch(true);
}
properties.addEventListener('submit', event => event.preventDefault());
properties.querySelectorAll('[data-text-style], [data-align]').forEach(button => button.addEventListener('click', () => {
  const object = selected(); if (object?.type !== 'text') return;
  const key = button.dataset.textStyle;
  const patch = button.dataset.align ? { align: button.dataset.align } : key === 'bold' ? { fontWeight: object.fontWeight >= 700 ? 400 : 700 } : { [key]: !object[key] };
  void edit([{ op: 'update', id: object.id, patch }]);
}));
properties.addEventListener('change', event => {
  const input = event.target, object = selected();
  if (!input.name || !object || !input.validity.valid) return;
  let value = input.type === 'checkbox' ? input.checked : numeric.has(input.name) ? Number(input.value) : input.value;
  if (['fill', 'stroke', 'strokeWidth'].includes(input.name) && !input.value) value = null;
  void edit([{ op: 'update', id: object.id, patch: { [input.name]: value } }]).then(result => {
    if (result?.ok && input.name === 'canvas') select(object.id);
  });
});
$('canvas-properties').addEventListener('submit', event => event.preventDefault());
$('canvas-size').addEventListener('change', event => {
  if (!state) return;
  const value = event.target.value;
  if (value === 'custom') {
    renderCanvasProperties();
    $('canvas-settings').parentElement.open = true;
    const width = $('canvas-properties').elements.width;
    width.focus(); width.select();
    return;
  }
  $('canvas-settings').parentElement.open = false;
  const [width, height] = value.split('x').map(Number);
  void edit([{ op: 'canvas', canvas: activeCanvas, patch: { width, height } }]);
});
$('canvas-properties').addEventListener('change', event => {
  const input = event.target;
  if (input.name && input.validity.valid) void edit([{ op: 'canvas', canvas: activeCanvas, patch: { [input.name]: input.name === 'background' ? input.value : Number(input.value) } }]);
});
$('figure-title').addEventListener('change', () => void edit([{ op: 'title', title: $('figure-title').value }]));
document.querySelectorAll('button[data-canvas]').forEach(button => button.addEventListener('click', () => { activeCanvas = button.dataset.canvas; selectedId = ''; if (state) render(state); }));
$('add-text').addEventListener('click', async () => {
  const id = newId(); if ((await edit([{ op: 'upsert', object: { id, type: 'text', name: 'Label', canvas: activeCanvas, text: 'Label', x: 30, y: 30, width: 200, height: 50 } }]))?.ok) { select(id); $('label-content').focus(); $('label-content').select(); }
});
$('add-vector').addEventListener('click', async () => {
  const id = newId();
  if ((await edit([{ op: 'upsert', object: { id, type: 'vector', name: 'Component', canvas: activeCanvas, x: 40, y: 40, width: 160, height: 100,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect x="3" y="3" width="154" height="94" rx="18" fill="#dce9e0" stroke="#587a64" stroke-width="3"/></svg>' } }]))?.ok) select(id);
});
for (const [button, direction] of [['undo', 'undo'], ['redo', 'redo']]) $(button).addEventListener('click', () => void workspace.history(direction).catch(error => status(error.message)));
$('delete').addEventListener('click', () => selected() && void edit([{ op: 'delete', id: selectedId }]));
$('duplicate').addEventListener('click', async () => {
  const object = selected(); if (!object) return; const id = newId();
  if ((await edit([{ op: 'upsert', object: { ...object, id, name: `${object.name} copy`, x: object.x + 15, y: object.y + 15 } }]))?.ok) select(id);
});
$('transfer').addEventListener('click', async () => {
  const object = selected(); if (!object) return;
  const canvas = object.canvas === 'main' ? 'scratch' : 'main';
  const result = await edit([{ op: 'transfer', id: object.id, canvas, copy: true, new_id: newId() }]);
  if (result?.ok && canvas === 'scratch') await showScratch(true);
});
$('place-scratch').addEventListener('click', () => {
  const objects = state?.objects.filter(obj => obj.canvas === 'scratch') || [];
  if (!objects.length) return status('The scratch canvas is empty.');
  void edit(objects.map(object => ({ op: 'transfer', id: object.id, canvas: 'main', copy: true, new_id: newId() })));
});
function reorder(offset) {
  const object = selected(); if (!object) return;
  const ids = state.objects.filter(obj => obj.canvas === object.canvas).map(obj => obj.id);
  const index = ids.indexOf(object.id), other = Math.max(0, Math.min(ids.length - 1, index + offset));
  [ids[index], ids[other]] = [ids[other], ids[index]];
  void edit([{ op: 'order', canvas: object.canvas, ids }]);
}
$('raise').addEventListener('click', () => reorder(1)); $('lower').addEventListener('click', () => reorder(-1));
$('edit-artwork').addEventListener('click', () => {
  const object = selected(); if (object?.type !== 'vector') return;
  sourceTarget = { id: object.id, revision: state.revision }; $('svg-source').value = object.svg; $('source-error').textContent = ''; $('source-dialog').showModal();
});
$('cancel-source').addEventListener('click', () => $('source-dialog').close());
$('source-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await edit([{ op: 'update', id: sourceTarget.id, patch: { svg: $('svg-source').value } }], sourceTarget.revision);
  if (result?.ok) $('source-dialog').close(); else $('source-error').textContent = result?.error || 'Could not update the artwork.';
});
$('import').addEventListener('click', () => { replaceRasterId = ''; $('asset-input').click(); });
$('replace-raster').addEventListener('click', () => { replaceRasterId = selectedId; $('asset-input').click(); });
async function importRaster() {
  const { file, dataUrl, revision, canvas, replaceId } = pendingRaster;
  const id = replaceId || newId();
  const operation = replaceId ? { op: 'update', id, patch: { dataUrl, textFree: true } }
    : { op: 'upsert', object: { id, type: 'raster', name: file.name, canvas, x: 25, y: 25, width: 240, height: 180, dataUrl, textFree: true } };
  const result = await edit([operation], revision);
  if (result?.ok) { pendingRaster = null; $('raster-dialog').close(); select(id); }
  else $('raster-error').textContent = result?.error || 'Could not import the artwork.';
}
$('asset-input').addEventListener('change', async () => {
  const file = $('asset-input').files[0]; $('asset-input').value = ''; if (!file || !state) return;
  if (file.size > 5 * 1024 * 1024) return status('Artwork must be at most 5 MiB.');
  const revision = state.revision, canvas = activeCanvas, replaceId = replaceRasterId;
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    if (replaceId) return status('Use PNG, JPEG, or WebP to replace raster artwork.');
    const id = newId();
    if ((await edit([{ op: 'upsert', object: { id, type: 'vector', name: file.name, canvas, x: 25, y: 25, width: 240, height: 180, svg: await file.text() } }], revision))?.ok) select(id);
  } else {
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }).catch(() => '');
    pendingRaster = { file, dataUrl, revision, canvas, replaceId }; $('text-free').checked = false; $('raster-error').textContent = ''; $('raster-dialog').showModal();
  }
});
$('cancel-raster').addEventListener('click', () => { pendingRaster = null; $('raster-dialog').close(); });
$('raster-form').addEventListener('submit', event => { event.preventDefault(); if ($('text-free').checked && pendingRaster) void importRaster(); });

// Drag previews are transient. The final edit uses the revision captured on
// pointer-down, so an intervening agent edit cannot be silently overwritten.
function point(svg, event) { return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse()); }
for (const key of ['main', 'scratch']) {
  const stage = $(`${key}-canvas`);
  stage.addEventListener('pointerdown', event => {
    if (!state || event.button !== 0) return;
    const hit = event.target.closest('[data-object-id], [data-resize-id]');
    if (!hit) { activeCanvas = key; selectedId = ''; render(state); return; }
    const id = hit.dataset.objectId || hit.dataset.resizeId, object = state.objects.find(obj => obj.id === id);
    const start = point(stage.querySelector('svg'), event);
    drag = { pointerId: event.pointerId, id, object: { ...object }, start, revision: state.revision, resizing: Boolean(hit.dataset.resizeId), preview: null };
    select(id); stage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = point(stage.querySelector('svg'), event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    let patch;
    if (drag.resizing) {
      const angle = drag.object.rotation * Math.PI / 180;
      const width = Math.min(8000, Math.max(1, drag.object.width + dx * Math.cos(angle) + dy * Math.sin(angle)));
      const height = Math.min(8000, Math.max(1, drag.object.height - dx * Math.sin(angle) + dy * Math.cos(angle)));
      const dw = width - drag.object.width, dh = height - drag.object.height;
      patch = { width, height, x: drag.object.x + (Math.cos(angle) * dw - Math.sin(angle) * dh - dw) / 2, y: drag.object.y + (Math.sin(angle) * dw + Math.cos(angle) * dh - dh) / 2 };
    } else patch = { x: Math.max(-16000, Math.min(16000, drag.object.x + dx)), y: Math.max(-16000, Math.min(16000, drag.object.y + dy)) };
    drag.preview = patch;
    renderCanvas(key, { ...state, objects: state.objects.map(obj => obj.id === drag.id ? { ...drag.object, ...patch } : obj) });
  });
  const finish = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag; drag = null;
    if (event.type === 'pointercancel' || !finished.preview) { render(state); return; }
    void edit([{ op: 'update', id: finished.id, patch: finished.preview }], finished.revision);
  };
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish);
  stage.addEventListener('focusin', event => { const id = event.target.dataset.objectId; if (id && id !== selectedId) select(id); });
  stage.addEventListener('dblclick', event => {
    const id = event.target.closest('[data-object-id]')?.dataset.objectId;
    if (!id || state.objects.find(object => object.id === id)?.type !== 'text') return;
    select(id); $('label-content').focus(); $('label-content').select();
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.popover[open]');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); return; }
    if (selected()) { selectedId = ''; drag = null; render(state); event.preventDefault(); }
    return;
  }
  if (event.target.closest('input, textarea, select')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void workspace.history(event.shiftKey ? 'redo' : 'undo').catch(error => status(error.message)); return; }
  const object = selected(); if (!object) return;
  if (event.key === 'Enter' && object.type === 'text' && (event.target.dataset.objectId || event.target.closest('.layer-select'))) {
    event.preventDefault(); $('label-content').focus(); $('label-content').select(); return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void edit([{ op: 'delete', id: object.id }]); }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) { event.preventDefault(); const amount = event.shiftKey ? 10 : 1; void edit([{ op: 'update', id: object.id, patch: { x: object.x + delta[0] * amount, y: object.y + delta[1] * amount } }]); }
});
async function exportFigure(format) {
  try {
    await workspace.ready;
    const documentState = workspace.getDocument();
    const dataBase64 = format === 'svg' ? encodeText(await workspace.exportSvg('main'))
      : (await renderPreview(documentState, 'main', 8000)).data_url.split(',')[1];
    const result = await hikari.call('downloads.save', { fileName: `${documentState.title || 'figure'}.${format}`, dataBase64 });
    status(result.saved ? `Exported ${format.toUpperCase()}` : 'Export canceled');
  } catch (error) { status(error.message); }
}
$('export-svg').addEventListener('click', () => void exportFigure('svg')); $('export-png').addEventListener('click', () => void exportFigure('png'));
$('complexity').addEventListener('change', event => void edit([{ op: 'complexity', complexity: event.target.value }]));
$('prompt').addEventListener('input', () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(120, $('prompt').scrollHeight)}px`; });
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('prompt-form').requestSubmit(); }
});
$('prompt-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state) return status('The illustration is still opening.');
  $('generate').disabled = true;
  try {
    const prompt = $('prompt').value.trim();
    if (!prompt || prompt.length > 2300) throw new Error('Describe a figure in at most 2300 characters.');
    const complexity = $('complexity').value;
    // Read after queued edits so a level selected just before Send is durable.
    const current = await workspace.request({ action: 'read', illustration_id: illustrationId });
    if (!current.ok) throw new Error(current.error);
    if (current.complexity !== complexity) throw new Error('The complexity changed or could not be saved. Check the selected level and try again.');
    const result = await hikari.call('agent.chat', { message: drawingPrompt(current.illustration_id, current.complexity, prompt) });
    if (!result.ok) throw new Error(result.error || (result.reason === 'composer_not_empty'
      ? 'The chat rail has a draft or attachments. Send or clear that draft before drawing.'
      : result.reason === 'busy' ? 'Codex is busy in this chat. Wait for it to finish or stop the current request.' : `Codex could not start: ${result.reason}`));
    status('Codex is drawing. Follow its progress in the chat rail.');
  } catch (error) { status(error.message); }
  finally { $('generate').disabled = false; }
});
hikari.on('agent.canvas', async ({ id, request, assets, deadline }) => {
  const result = await workspace.request(request, deadline, assets);
  await hikari.call('agent.respond', { id, result }).catch(error => status(error.message));
});
function theme(info) {
  document.body.classList.toggle('theme-night', info?.appearance?.mode === 'night');
  document.documentElement.style.setProperty('--app-font-size', `${info?.appearance?.fontSize || 16}px`);
  leftRail.applyContext(info?.layout?.leftRail || {});
  if (Array.isArray(info?.permissions) && !info.permissions.includes('layout')) leftRail.destroy();
}
hikari.on('app.context', info => { theme(info); if (info.changed === 'storage') location.reload(); });
void hikari.call('app.info').then(theme).catch(() => {});
hikari.on('app.undo', () => void workspace.history('undo').catch(error => status(error.message)));
hikari.on('app.redo', () => void workspace.history('redo').catch(error => status(error.message)));
hikari.on('app.save', () => void workspace.flush().then(() => hikari.call('app.setUnsaved', { unsaved: false })).catch(error => status(error.message)));
// A narrow public controller is useful for same-origin integration fixtures.
window.illustrationWorkspace = workspace;
