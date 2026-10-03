import { createWorkspace, encodeText } from './workspace.mjs';
import { scene, renderPreview, objectGroup, element, stretchSvg } from './artwork.mjs';
import { initPluginLeftRailResizer } from './left-rail.mjs';
import { icon, mountIcons } from './icons.mjs';
import { COMPLEXITY_PROFILES } from './complexity.mjs';
import { resizeObject, scaleTextObject } from './geometry.mjs';
import { createCanvasViewport } from './viewport.mjs';
import { selectionBounds, resizeSelection, transformSelection } from './grouping.mjs';

const { hikari } = window.HikariPlugin;
const $ = id => document.getElementById(id);
const properties = $('properties');
// This panel only changes the editing view, never the saved scene or previews.
function showInspector(open) {
  const panel = $('layer-inspector'), toggle = $('toggle-layers');
  if (!open && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  panel.hidden = !open; panel.inert = !open;
  document.querySelector('.work-area').classList.toggle('is-inspector-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide layers and properties' : 'Show layers and properties');
  toggle.title = open ? 'Hide layers and properties' : 'Show layers and properties';
}
$('toggle-layers').addEventListener('click', () => showInspector($('layer-inspector').hidden));
$('close-layers').addEventListener('click', () => showInspector(false));
mountIcons();
let selectedId = '', selectedIds = [], activeCanvas = 'main', illustrationId = '', state, drag = null, pendingRaster = null, replaceRasterId = '', sourceTarget = null;
const status = text => { $('status').textContent = text; };
let chatContextKey = '';
function syncChatContext(id, title) {
  const key = JSON.stringify([id, title]);
  if (!id || chatContextKey === key) return;
  chatContextKey = key;
  void hikari.call('agent.setContext', { id, title, canvasIllustrationId: id }).catch(error => {
    chatContextKey = ''; status(`Chat could not follow this illustration: ${error.message}`);
  });
}
const workspace = createWorkspace({ hikari, onChange: render, onLibraryChange: renderIllustrations, onViewChange: renderView,
  onHistoryChange: ({ canUndo, canRedo }) => { $('undo').disabled = !canUndo; $('redo').disabled = !canRedo; }, onStatus: status });
const leftRail = initPluginLeftRailResizer({ commitWidth: width => hikari.call('app.setLeftRailWidth', { width }),
  commitFolded: folded => hikari.call('app.setLeftRailFolded', { folded }), onCommitError: error => status(error.message) });
const selected = () => selectedIds.length === 1 ? state?.objects.find(obj => obj.id === selectedId) : undefined;
const selectedObjects = () => state?.objects.filter(object => selectedIds.includes(object.id)) || [];
const selectedGroup = () => state?.groups.find(group => group.ids.length === selectedIds.length && group.ids.every(id => selectedIds.includes(id)));
function setSelection(ids) { selectedIds = [...new Set(ids)]; selectedId = selectedIds[0] || ''; }
function selectionTarget() {
  const objects = selectedObjects();
  if (objects.length < 2) return selected();
  const group = selectedGroup();
  return { ...selectionBounds(objects), id: group?.id || 'selection', type: 'group', name: group?.name || `${objects.length} components`, canvas: objects[0].canvas };
}
function transformOperation(patch) {
  const group = selectedGroup();
  return { op: 'transform', ...(group ? { id: group.id } : { ids: [...selectedIds] }), patch };
}
function canGroup() {
  return selectedIds.length > 1 && !selectedGroup() && !(state?.groups || []).some(group => group.ids.some(id => selectedIds.includes(id)) && group.ids.some(id => !selectedIds.includes(id)));
}
async function groupSelection() {
  if (!canGroup()) return;
  await edit([{ op: 'group', id: `group-${crypto.randomUUID()}`, name: 'Group', ids: [...selectedIds] }]);
}
async function ungroupSelection() {
  const groups = state?.groups.filter(group => group.ids.every(id => selectedIds.includes(id))) || [];
  if (groups.length) await edit(groups.map(group => ({ op: 'ungroup', id: group.id })));
}
for (const id of ['group-selection', 'menu-group-selection']) $(id).addEventListener('click', () => void groupSelection());
for (const id of ['ungroup-selection', 'menu-ungroup-selection']) $(id).addEventListener('click', () => void ungroupSelection());
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
  const svg = stage.querySelector('svg'), handles = svg?.querySelectorAll('.resize-handle');
  const matrix = svg?.getScreenCTM();
  if (!handles?.length || !matrix || !stage.getBoundingClientRect().width) return;
  const scale = Math.hypot(matrix.a, matrix.b); if (!scale) return;
  const size = 9 / scale;
  for (const handle of handles) {
    handle.setAttribute('width', size); handle.setAttribute('height', size);
    handle.setAttribute('x', Number(handle.dataset.cornerX) - size / 2);
    handle.setAttribute('y', Number(handle.dataset.cornerY) - size / 2);
  }
}
function renderZoom() {
  const view = viewport.get($(`${activeCanvas}-canvas`));
  $('canvas-zoom').setAttribute('aria-label', `${activeCanvas === 'main' ? 'Main' : 'Scratch'} canvas zoom`);
  $('zoom-level').textContent = `${Math.round(view.scale * 100)}%`;
  $('zoom-out').disabled = view.scale <= 0.1;
  $('zoom-in').disabled = view.scale >= 8;
  $('zoom-fit').setAttribute('aria-pressed', String(view.zoom === null));
}
const viewport = createCanvasViewport(stage => { syncSelectionSize(stage); renderZoom(); });
function renderCanvas(canvas, documentState = state) {
  const stage = $(`${canvas}-canvas`), focusedId = document.activeElement?.dataset.objectId;
  const pan = { x: stage.scrollLeft, y: stage.scrollTop };
  stage.replaceChildren(scene(documentState, canvas, { interactive: true, selectedId: selectedIds.length === 1 ? selectedId : '', selectedIds }));
  viewport.layout(stage);
  if (viewport.get(stage).zoom !== null) { stage.scrollLeft = pan.x; stage.scrollTop = pan.y; }
  if (focusedId && selectedIds.includes(focusedId)) stage.querySelector(`[data-object-id="${focusedId}"]`)?.focus({ preventScroll: true });
}
for (const [id, factor] of [['zoom-out', 1 / 1.25], ['zoom-in', 1.25]]) {
  $(id).addEventListener('click', () => {
    if (drag) return;
    const stage = $(`${activeCanvas}-canvas`);
    const object = stage.querySelector(`[data-object-id="${selectedId}"]`), box = object?.getBoundingClientRect();
    const area = stage.getBoundingClientRect();
    const visible = box && box.right > area.left && box.left < area.right && box.bottom > area.top && box.top < area.bottom;
    viewport.zoom(stage, factor, visible ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
    if (visible) {
      const resized = object.getBoundingClientRect(), margin = 10;
      if (resized.width + margin * 2 <= stage.clientWidth) {
        if (resized.left < area.left + margin) stage.scrollLeft -= area.left + margin - resized.left;
        else if (resized.right > area.left + stage.clientWidth - margin) stage.scrollLeft += resized.right - area.left - stage.clientWidth + margin;
      }
      if (resized.height + margin * 2 <= stage.clientHeight) {
        if (resized.top < area.top + margin) stage.scrollTop -= area.top + margin - resized.top;
        else if (resized.bottom > area.top + stage.clientHeight - margin) stage.scrollTop += resized.bottom - area.top - stage.clientHeight + margin;
      }
    }
  });
}
$('zoom-fit').addEventListener('click', () => { if (!drag) viewport.fit($(`${activeCanvas}-canvas`)); });
const pendingCanvasFits = new Set();
let canvasFitFrame = 0;
const canvasObserver = new ResizeObserver(entries => {
  entries.forEach(({ target }) => pendingCanvasFits.add(target));
  if (canvasFitFrame) return;
  // Fit on the next frame, outside ResizeObserver's layout delivery cycle.
  canvasFitFrame = requestAnimationFrame(() => {
    canvasFitFrame = 0;
    pendingCanvasFits.forEach(stage => viewport.layout(stage)); pendingCanvasFits.clear();
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
    illustrationId = id; setSelection([]); activeCanvas = 'main'; drag = null; pendingRaster = null;
    showInspector(false);
    viewport.reset();
    $('source-dialog').close(); $('raster-dialog').close(); $('prompt').value = ''; $('prompt').style.height = '';
  }
  state = next;
  syncChatContext(illustrationId, state.title);
  setSelection(selectedIds.filter(selected => state.objects.some(object => object.id === selected && object.canvas === activeCanvas)));
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
  renderZoom();
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
    activeCanvas = 'main'; setSelection([]); drag = null;
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
    const canvasObjects = state.objects.filter(object => object.canvas === canvas).reverse(), listedGroups = new Set();
    const objects = canvasObjects.flatMap(object => {
      const group = state.groups.find(group => group.ids.includes(object.id));
      if (!group) return [object];
      if (listedGroups.has(group.id)) return [];
      listedGroups.add(group.id);
      return canvasObjects.filter(member => group.ids.includes(member.id));
    });
    if (hasScratch && objects.length) {
      const heading = document.createElement('div'); heading.className = 'layer-group-heading'; heading.setAttribute('role', 'presentation');
      heading.textContent = canvas === 'main' ? 'Main' : 'Scratch'; $('layers').append(heading);
    }
    const drawnGroups = new Set();
    for (const object of objects) {
    const group = state.groups.find(group => group.ids.includes(object.id));
    if (group && !drawnGroups.has(group.id)) {
      drawnGroups.add(group.id);
      const row = document.createElement('div'); row.className = `layer grouped-layer${group.ids.every(id => selectedIds.includes(id)) ? ' is-selected' : ''}`;
      row.setAttribute('role', 'listitem'); row.dataset.layerId = group.id;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-select'; button.dataset.layerAction = 'select';
      button.setAttribute('aria-label', `Select group ${group.name}`); button.setAttribute('aria-pressed', String(group.ids.every(id => selectedIds.includes(id))));
      const preview = document.createElement('span'); preview.className = 'layer-preview'; preview.setAttribute('aria-hidden', 'true'); preview.append(icon('layers'));
      const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = group.name;
      const count = document.createElement('small'); count.className = 'group-count'; count.textContent = group.ids.length;
      button.append(preview, name, count); button.addEventListener('click', event => select(group.ids, { additive: event.shiftKey }));
      row.append(button); $('layers').append(row);
    }
    const row = document.createElement('div'); row.className = `layer${selectedIds.includes(object.id) ? ' is-selected' : ''}${object.visible ? '' : ' is-hidden'}${group ? ' group-child' : ''}`; row.setAttribute('role', 'listitem'); row.dataset.layerId = object.id;
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
    button.setAttribute('aria-pressed', String(selectedIds.includes(object.id))); button.addEventListener('click', event => select(object.id, { additive: event.shiftKey }));
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
  const object = selectionTarget(), group = selectedGroup(); properties.hidden = !object;
  for (const id of ['group-selection', 'menu-group-selection']) $(id).disabled = !canGroup();
  const canUngroup = state.groups.some(group => group.ids.every(id => selectedIds.includes(id)));
  for (const id of ['ungroup-selection', 'menu-ungroup-selection']) $(id).disabled = !canUngroup;
  $('selection-hint').hidden = Boolean(object) || !state.objects.length;
  if (!object) return;
  $('selection-type').textContent = object.type === 'group' ? `${selectedIds.length} layers` : object.type === 'text' ? 'Text' : object.type === 'vector' ? 'Vector' : 'Image';
  properties.elements.name.disabled = object.type === 'group' && !group;
  properties.querySelector('.object-basics').hidden = object.type === 'group';
  const weights = properties.elements.fontWeight;
  weights.querySelector('[data-custom-weight]')?.remove();
  if (object.type === 'text' && ![...weights.options].some(option => Number(option.value) === object.fontWeight)) {
    const option = document.createElement('option'); option.value = object.fontWeight; option.textContent = object.fontWeight; option.dataset.customWeight = ''; weights.append(option);
  }
  for (const input of properties.elements) {
    if (!input.name) continue;
    if (['width', 'height'].includes(input.name)) {
      input.title = object.type === 'group' ? 'Resize selected layers proportionally' : object.type === 'text' ? 'Resize text proportionally' : `${input.name === 'width' ? 'Width' : 'Height'} in pixels`;
      input.max = object.type === 'group' ? '64000' : '8000';
    }
    if (input.type === 'checkbox') input.checked = Boolean(object[input.name]);
    else input.value = object[input.name] ?? '';
  }
  $('text-properties').hidden = object.type !== 'text'; $('vector-properties').hidden = object.type !== 'vector'; $('replace-raster').hidden = object.type !== 'raster';
  properties.querySelectorAll('[data-text-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.textStyle === 'bold' ? object.fontWeight >= 700 : Boolean(object[button.dataset.textStyle]))));
  properties.querySelectorAll('[data-align]').forEach(button => button.setAttribute('aria-pressed', String(object.align === button.dataset.align)));
  const siblings = state.objects.filter(item => item.canvas === object.canvas);
  $('raise').disabled = selectedIds.includes(siblings.at(-1)?.id); $('lower').disabled = selectedIds.includes(siblings[0]?.id);
  $('transfer').textContent = object.canvas === 'main' ? 'Copy to scratch' : 'Copy to main';
}
function select(id, { reveal = true, additive = false } = {}) {
  if (reveal) showInspector(true);
  const ids = Array.isArray(id) ? id : [id], canvas = state.objects.find(object => object.id === ids[0])?.canvas;
  if (canvas !== activeCanvas) { activeCanvas = canvas || activeCanvas; setSelection([]); }
  setSelection(additive ? ids.every(id => selectedIds.includes(id)) ? selectedIds.filter(id => !ids.includes(id)) : [...selectedIds, ...ids] : ids);
  render(state);
  if (activeCanvas === 'scratch' && !workspace.getView().scratch_visible) void showScratch(true);
}
function editLabel(id) {
  if (state?.objects.find(object => object.id === id)?.type !== 'text') return;
  select(id); $('label-content').focus(); $('label-content').select();
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
  if (!input.name || !object || !input.validity.valid) return;
  let value = input.type === 'checkbox' ? input.checked : numeric.has(input.name) ? Number(input.value) : input.value;
  if (['fill', 'stroke', 'strokeWidth'].includes(input.name) && !input.value) value = null;
  const patch = { [input.name]: value };
  if (object.type === 'group') {
    if (input.name === 'name') { const group = selectedGroup(); if (group) void edit([{ op: 'update', id: group.id, patch }]); }
    else if (input.name === 'canvas') void transferSelection(value, false);
    else if (['x', 'y', 'width', 'height'].includes(input.name)) void edit([transformOperation(patch)]);
    return;
  }
  if (object.type === 'text' && ['width', 'height'].includes(input.name)) Object.assign(patch, scaleTextObject(object, value / object[input.name]));
  if (object.type === 'vector' && ['width', 'height'].includes(input.name)) patch.svg = stretchSvg(object.svg);
  void edit([{ op: 'update', id: object.id, patch }]).then(result => {
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
document.querySelectorAll('button[data-canvas]').forEach(button => button.addEventListener('click', () => { activeCanvas = button.dataset.canvas; setSelection([]); if (state) render(state); }));
$('add-text').addEventListener('click', async () => {
  const id = newId(); if ((await edit([{ op: 'upsert', object: { id, type: 'text', name: 'Label', canvas: activeCanvas, text: 'Label', x: 30, y: 30, width: 200, height: 50 } }]))?.ok) { select(id); $('label-content').focus(); $('label-content').select(); }
});
$('add-vector').addEventListener('click', async () => {
  const id = newId();
  if ((await edit([{ op: 'upsert', object: { id, type: 'vector', name: 'Component', canvas: activeCanvas, x: 40, y: 40, width: 160, height: 100,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect x="3" y="3" width="154" height="94" rx="18" fill="#dce9e0" stroke="#587a64" stroke-width="3"/></svg>' } }]))?.ok) select(id);
});
for (const [button, direction] of [['undo', 'undo'], ['redo', 'redo']]) $(button).addEventListener('click', () => void workspace.history(direction).catch(error => status(error.message)));
function selectionUnits() {
  const groups = state.groups.filter(group => group.ids.every(id => selectedIds.includes(id)));
  return [...groups.map(group => group.id), ...selectedIds.filter(id => !groups.some(group => group.ids.includes(id)))];
}
function deleteSelection() { if (selectedIds.length) void edit(selectionUnits().map(id => ({ op: 'delete', id }))); }
$('delete').addEventListener('click', deleteSelection);
$('duplicate').addEventListener('click', async () => {
  const object = selected();
  if (!object) { if (selectedIds.length) await transferSelection(activeCanvas, true, true); return; }
  const id = newId();
  if ((await edit([{ op: 'upsert', object: { ...object, id, name: `${object.name} copy`, x: object.x + 15, y: object.y + 15 } }]))?.ok) select(id);
});
async function transferSelection(canvas, copy, offset = false) {
  const units = selectionUnits(), revision = state.revision, originalSelection = [...selectedIds];
  const operations = units.map(id => ({ op: 'transfer', id, canvas, copy, ...(copy ? { new_id: newId() } : {}) }));
  if (offset) {
    for (const operation of [...operations]) {
      const group = state.groups.find(group => group.id === operation.id);
      const source = group ? selectionBounds(state.objects.filter(object => group.ids.includes(object.id))) : state.objects.find(object => object.id === operation.id);
      operations.push({ op: group ? 'transform' : 'update', id: operation.new_id, patch: { x: source.x + 15, y: source.y + 15 } });
    }
  }
  const result = await edit(operations, revision);
  if (result?.ok) {
    if (canvas === 'scratch') await showScratch(true);
    if (copy && offset) {
      const copied = operations.filter(operation => operation.op === 'transfer').flatMap(operation => state.groups.find(group => group.id === operation.new_id)?.ids || [operation.new_id]);
      select(copied);
    } else if (!copy) select(originalSelection);
  }
}
$('transfer').addEventListener('click', () => selectedIds.length && void transferSelection(activeCanvas === 'main' ? 'scratch' : 'main', true));
$('place-scratch').addEventListener('click', () => {
  const objects = state?.objects.filter(obj => obj.canvas === 'scratch') || [];
  if (!objects.length) return status('The scratch canvas is empty.');
  const groups = state.groups.filter(group => group.canvas === 'scratch');
  const ids = [...groups.map(group => group.id), ...objects.filter(object => !groups.some(group => group.ids.includes(object.id))).map(object => object.id)];
  void edit(ids.map(id => ({ op: 'transfer', id, canvas: 'main', copy: true, new_id: newId() })));
});
function reorder(offset) {
  if (!selectedIds.length) return;
  const ids = state.objects.filter(obj => obj.canvas === activeCanvas).map(obj => obj.id);
  const indices = ids.map((id, index) => selectedIds.includes(id) ? index : -1).filter(index => index >= 0);
  const edge = offset > 0 ? Math.max(...indices) : Math.min(...indices), neighbor = ids[edge + offset];
  if (!neighbor) return;
  const moving = ids.filter(id => selectedIds.includes(id)), rest = ids.filter(id => !selectedIds.includes(id));
  rest.splice(rest.indexOf(neighbor) + (offset > 0 ? 1 : 0), 0, ...moving);
  void edit([{ op: 'order', canvas: activeCanvas, ids: rest }]);
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
  let lastClick = null;
  stage.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!state || drag) return;
    if (activeCanvas !== key) { activeCanvas = key; setSelection([]); render(state); }
    viewport.zoom(stage, Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (!state || event.button !== 0) return;
    const hit = event.target.closest('[data-object-id], [data-resize-id]');
    if (!hit) { lastClick = null; activeCanvas = key; setSelection([]); render(state); return; }
    const id = hit.dataset.objectId || hit.dataset.resizeId;
    const start = point(stage.querySelector('svg'), event);
    if (hit.dataset.resizeDirection) {
      activeCanvas = key;
    } else {
      const group = !event.altKey && state.groups.find(group => group.ids.includes(id));
      const ids = group?.ids || [id];
      // Preserve a multi-selection when dragging one of its members.
      if (event.shiftKey || !ids.every(id => selectedIds.includes(id)) || activeCanvas !== key || event.altKey) select(ids, { reveal: false, additive: event.shiftKey });
      if (event.shiftKey) { lastClick = null; event.preventDefault(); return; }
    }
    const objects = selectedObjects(), object = objects.length === 1 ? objects[0] : selectionTarget();
    if (!object) return;
    drag = { pointerId: event.pointerId, id, object: { ...object }, objects: objects.map(object => ({ ...object })), ids: [...selectedIds], start, revision: state.revision, resizing: hit.dataset.resizeDirection, preview: null };
    if (drag.resizing && object.type === 'vector') drag.resizeSvg = stretchSvg(object.svg);
    render(state); stage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = point(stage.querySelector('svg'), event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    let patch;
    if (drag.resizing) {
      patch = drag.objects.length > 1 ? resizeSelection(drag.objects, drag.resizing, dx, dy) : resizeObject(drag.object, drag.resizing, dx, dy);
      if (drag.resizeSvg && (patch.width !== drag.object.width || patch.height !== drag.object.height)) patch.svg = drag.resizeSvg;
    }
    else patch = { x: Math.max(-16000, Math.min(16000, drag.object.x + dx)), y: Math.max(-16000, Math.min(16000, drag.object.y + dy)) };
    drag.preview = patch;
    const previews = drag.objects.length > 1 ? transformSelection(drag.objects, patch) : [{ ...drag.object, ...patch }];
    renderCanvas(key, { ...state, objects: state.objects.map(obj => previews.find(preview => preview.id === obj.id) || obj) });
  });
  const finish = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag; drag = null;
    if (event.type === 'pointercancel') { lastClick = null; render(state); return; }
    if (!finished.preview) {
      render(state);
      // Cancelling pointer-down's default prevents synthetic mouse clicks.
      // Recognize a double-click here, after capture, without moving the canvas
      // or opening the inspector in the middle of a drag/resize gesture.
      const now = performance.now();
      const doubleClick = lastClick?.id === finished.id && now - lastClick.time < 500
        && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 4;
      lastClick = doubleClick ? null : { id: finished.id, time: now, x: event.clientX, y: event.clientY };
      if (doubleClick) editLabel(finished.id);
      return;
    }
    lastClick = null;
    void edit([finished.objects.length > 1 ? { op: 'transform', ids: finished.ids, patch: finished.preview }
      : { op: 'update', id: finished.objects[0].id, patch: finished.preview }], finished.revision);
  };
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish);
  stage.addEventListener('focusin', event => {
    const id = event.target.dataset.objectId;
    if (id && !selectedIds.includes(id)) select(state.groups.find(group => group.ids.includes(id))?.ids || id, { reveal: false });
  });
  stage.addEventListener('dblclick', event => {
    // Selection redraws the SVG during pointer-down. Chromium can deliver the
    // resulting double-click to the stage after that original node is replaced.
    const hit = event.target.closest('[data-object-id]')
      || document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-object-id]');
    const id = stage.contains(hit) ? hit.dataset.objectId : '';
    if (id) editLabel(id);
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.popover[open]');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); return; }
    if (selectedIds.length) { setSelection([]); drag = null; render(state); event.preventDefault(); }
    return;
  }
  if (event.target.closest('input, textarea, select')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void workspace.history(event.shiftKey ? 'redo' : 'undo').catch(error => status(error.message)); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); void (event.shiftKey ? ungroupSelection() : groupSelection()); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && event.target.closest('.canvas-stage, #layers')) {
    event.preventDefault(); select(state.objects.filter(object => object.canvas === activeCanvas && object.visible).map(object => object.id), { reveal: false }); return;
  }
  const object = selectionTarget(); if (!object) return;
  if (event.key === 'Enter' && object.type === 'text' && (event.target.dataset.objectId || event.target.closest('.layer-select'))) {
    event.preventDefault(); showInspector(true); $('label-content').focus(); $('label-content').select(); return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault(); const amount = event.shiftKey ? 10 : 1, patch = { x: object.x + delta[0] * amount, y: object.y + delta[1] * amount };
    void edit([object.type === 'group' ? transformOperation(patch) : { op: 'update', id: object.id, patch }]);
  }
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
    // Hikari's item-scoped agent context directs Codex to read the canvas contract.
    // Keep that context out of the user message and its visible chat history.
    const result = await hikari.call('agent.chat', { message: prompt,
      context: { id: current.illustration_id, title: current.title, canvasIllustrationId: current.illustration_id } });
    if (!result.ok) throw new Error(result.error || (result.reason === 'composer_not_empty'
      ? 'The chat rail has a draft or attachments. Send or clear that draft before drawing.'
      : result.reason === 'busy' ? 'Codex is busy in this chat. Wait for it to finish or stop the current request.' : `Codex could not start: ${result.reason}`));
    if (illustrationId === current.illustration_id && $('prompt').value.trim() === prompt) {
      $('prompt').value = ''; $('prompt').style.height = '';
    }
    status('Codex is drawing. Follow its progress in the chat rail.');
  } catch (error) { status(error.message); }
  finally { $('generate').disabled = false; }
});
hikari.on('agent.canvas', async ({ id, request, assets, deadline, inspectionRunId }) => {
  const result = await workspace.request(request, deadline, assets, { inspectionRunId });
  await hikari.call('agent.respond', { id, result }).catch(error => status(error.message));
});
function theme(info) {
  const chatExpanded = info?.layout?.agentChatRail?.expanded === true;
  // Hosts without Codex report available:false; older hosts omit the field.
  const canDraw = info?.layout?.agentChatRail?.available !== false;
  $('prompt-form').hidden = chatExpanded || !canDraw;
  $('canvas-empty-hint').textContent = !canDraw ? 'Add a layer to start your figure.'
    : chatExpanded ? 'Describe your figure in the agent chat, or add a layer.' : 'Describe your figure below, or add a layer.';
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
