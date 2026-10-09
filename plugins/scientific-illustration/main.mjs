import { createWorkspace, encodeText } from './workspace.mjs';
import { scene, renderPreview, objectGroup, element, stretchSvg, interactionBox, clearTextBounds, validateSvg } from './artwork.mjs';
import { initPluginLeftRailResizer } from './left-rail.mjs';
import { icon, mountIcons } from './icons.mjs';
import { COMPLEXITY_PROFILES } from './complexity.mjs';
import { imageGenerationSummary } from './image-generation.mjs';
import { resizeObject, scaleTextObject, resizeAnchor } from './geometry.mjs';
import { createCanvasViewport } from './viewport.mjs';
import { selectionBounds, resizeSelection, transformSelection } from './grouping.mjs';
import { initAssetsPanel } from './assets-panel.mjs';
import { initArtworkImport } from './artwork-import.mjs';
import { initCanvasCrop } from './canvas-crop.mjs';
import { createComponentRail } from './component-rail.mjs';
import { rectanglePoints, regionSelection } from './area-selection.mjs';
import { createWorkspaceTools } from './workspace-tools.mjs';
import { installSourceActions } from './source-context.mjs';
import { exportPowerPoint } from './powerpoint.mjs';
import { angleDelta, rotateComponents } from './rotation.mjs';
import { installCanvasClipboard } from './clipboard.mjs';

const { hikari } = window.HikariPlugin;
const $ = id => document.getElementById(id);
const properties = $('properties');
let assetsPanel, workspaceTools, artworkImport, canvasCrop;
const componentRail = createComponentRail({ document, focusTab: name => workspaceTools?.focus(`${name}-tab`), onChange: name => {
  if (name === 'assets') assetsPanel?.render();
  if (name && workspaceTools?.isHosted()) void hikari.call('app.setAgentChatExpanded', { expanded: false }).catch(() => {});
  workspaceTools?.sync();
} });
mountIcons();
let selectedId = '', selectedIds = [], activeCanvas = 'main', illustrationId = '', state, drag = null, sourceTarget = null;
let chatExpanded = false, canDraw = true;
let imagePreferenceSave = Promise.resolve(), pendingImagePreference = null;
let areaDrag = null;
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
  onAssetsChange: library => assetsPanel?.render(library),
  onStatus: status });
const leftRail = initPluginLeftRailResizer({ commitWidth: width => hikari.call('app.setLeftRailWidth', { width }),
  commitFolded: folded => hikari.call('app.setLeftRailFolded', { folded }), onCommitError: error => status(error.message) });
const selected = () => selectedIds.length === 1 ? state?.objects.find(obj => obj.id === selectedId) : undefined;
const selectedObjects = () => state?.objects.filter(object => selectedIds.includes(object.id)) || [];
const selectedGroup = () => state?.groups.find(group => group.ids.length === selectedIds.length && group.ids.every(id => selectedIds.includes(id)));
assetsPanel = initAssetsPanel({ workspace, getSelection: () => ({ ids: selectedIds, name: selectionTarget()?.name || 'Component' }),
  getCanvas: () => activeCanvas, getIllustrationId: () => illustrationId, selectCopies: ids => select(ids, { reveal: false }), showAssets: () => componentRail.open('assets'), status });
artworkImport = initArtworkImport({ workspace, getCanvas: () => activeCanvas, getIllustrationId: () => illustrationId,
  getSelected: selected, select, showAssets: () => componentRail.open('assets'), status });
canvasCrop = initCanvasCrop({ workspace, getSelected: selected, getCanvas: () => activeCanvas, getIllustrationId: () => illustrationId,
  onStart: () => { artworkImport.close(); componentRail.close(); },
  onActiveChange: (active, focus) => { $('crop-raster').setAttribute('aria-pressed', String(active)); workspaceTools?.sync(); if (focus) workspaceTools?.focus('crop-raster'); },
  select: id => select(id, { reveal: false }), status });
function setSelection(ids) { selectedIds = [...new Set(ids)]; selectedId = selectedIds[0] || ''; }
function cancelRotation() {
  if (!drag?.rotating) return;
  const stage = $(`${drag.canvas}-canvas`), pointerId = drag.pointerId;
  drag = null;
  if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
}
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
$('group-selection').addEventListener('click', () => void groupSelection());
$('ungroup-selection').addEventListener('click', () => void ungroupSelection());
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
  const frame = svg.querySelector('.selection'), rotate = frame?.querySelector('.rotation-handle');
  if (!rotate) return;
  const w = Number(frame.dataset.selectionWidth), h = Number(frame.dataset.selectionHeight), gap = 28 / scale;
  const frameMatrix = frame.getScreenCTM(), area = stage.getBoundingClientRect(), margin = 13;
  const candidates = [[w / 2, -gap, w / 2, 0], [w / 2, h + gap, w / 2, h],
    [w + gap, h / 2, w, h / 2], [-gap, h / 2, 0, h / 2], [w / 2, gap, w / 2, 0]];
  let placement = drag?.rotating && drag.canvas === stage.dataset.canvas ? drag.handlePlacement : undefined;
  if (!placement) placement = candidates.find(([x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform(frameMatrix);
    return p.x >= area.left + margin && p.x <= area.left + stage.clientWidth - margin
      && p.y >= area.top + margin && p.y <= area.top + stage.clientHeight - margin;
  });
  if (!placement) {
    const p = new DOMPoint(...candidates[0].slice(0, 2)).matrixTransform(frameMatrix);
    const clamped = new DOMPoint(Math.max(area.left + margin, Math.min(area.left + stage.clientWidth - margin, p.x)),
      Math.max(area.top + margin, Math.min(area.top + stage.clientHeight - margin, p.y))).matrixTransform(frameMatrix.inverse());
    placement = [clamped.x, clamped.y, w / 2, 0];
  }
  const [x, y, anchorX, anchorY] = placement, stem = frame.querySelector('.rotation-stem');
  rotate.setAttribute('transform', `translate(${x} ${y})`); rotate.dataset.placement = JSON.stringify(placement);
  rotate.querySelector('.rotation-hit').setAttribute('r', 12 / scale);
  rotate.querySelector('.rotation-knob').setAttribute('r', 6 / scale);
  for (const [key, value] of Object.entries({ x1: anchorX, y1: anchorY, x2: x, y2: y })) stem.setAttribute(key, value);
}
function renderZoom() {
  const view = viewport.get($(`${activeCanvas}-canvas`));
  $('canvas-zoom').setAttribute('aria-label', `${activeCanvas === 'main' ? 'Main' : 'Scratch'} canvas zoom`);
  $('zoom-level').textContent = `${Math.round(view.scale * 100)}%`;
  $('zoom-out').disabled = view.scale <= 0.1;
  $('zoom-in').disabled = view.scale >= 8;
  $('zoom-fit').setAttribute('aria-pressed', String(view.zoom === null));
  workspaceTools?.sync();
}
const viewport = createCanvasViewport(stage => { syncSelectionSize(stage); renderZoom(); });
function renderCanvas(canvas, documentState = state) {
  const stage = $(`${canvas}-canvas`), focusedId = document.activeElement?.dataset.objectId,
    focusedRotation = document.activeElement?.dataset.rotateId;
  const pan = { x: stage.scrollLeft, y: stage.scrollTop };
  const selectionBox = drag?.rotating && drag.canvas === canvas && drag.objects.length > 1
    ? { ...drag.bounds, id: 'selection', rotation: drag.rotationDelta || 0 } : undefined;
  stage.replaceChildren(scene(documentState, canvas, { interactive: true, selectedId: selectedIds.length === 1 ? selectedId : '', selectedIds, selectionBox }));
  stage.classList.toggle('is-rotating', Boolean(drag?.rotating && drag.canvas === canvas));
  viewport.layout(stage);
  if (viewport.get(stage).zoom !== null) { stage.scrollLeft = pan.x; stage.scrollTop = pan.y; }
  syncSelectionSize(stage);
  if (focusedId && selectedIds.includes(focusedId)) stage.querySelector(`[data-object-id="${focusedId}"]`)?.focus({ preventScroll: true });
  if (focusedRotation) stage.querySelector(`[data-rotate-id="${focusedRotation}"]`)?.focus({ preventScroll: true });
  if (areaDrag?.canvas === canvas) renderSelectionRegion();
}
document.fonts.addEventListener('loadingdone', () => {
  clearTextBounds();
  if (state && !drag && !areaDrag) for (const canvas of ['main', 'scratch']) renderCanvas(canvas);
});
for (const [id, factor] of [['zoom-out', 1 / 1.25], ['zoom-in', 1.25]]) {
  $(id).addEventListener('click', () => {
    if (drag || areaDrag) return;
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
$('zoom-fit').addEventListener('click', () => { if (!drag && !areaDrag) viewport.fit($(`${activeCanvas}-canvas`)); });
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
for (const canvas of ['main', 'scratch']) {
  const stage = $(`${canvas}-canvas`);
  stage.addEventListener('scroll', () => syncSelectionSize(stage), { passive: true });
}

async function edit(operations, revision = state?.revision) {
  if (!revision) return status('The illustration is still opening.');
  const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: revision, request_id: crypto.randomUUID(), operations });
  if (!result.ok) { status(result.error); if (state) render(state); }
  return result;
}
function render(next, id = illustrationId) {
  if (drag?.rotating && (next.revision !== drag.revision || id !== illustrationId
    || activeCanvas !== drag.canvas || JSON.stringify(selectedIds) !== JSON.stringify(drag.ids))) cancelRotation();
  canvasCrop?.onDocumentChange(next, id);
  if (areaDrag && (id !== illustrationId || activeCanvas !== areaDrag.canvas || next.revision !== areaDrag.revision)) cancelAreaSelection();
  if (id !== illustrationId) {
    illustrationId = id; setSelection([]); activeCanvas = 'main'; drag = null;
    componentRail.close();
    assetsPanel?.closeSave();
    artworkImport?.close();
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
  renderImagePreference(pendingImagePreference?.id === id ? pendingImagePreference.percent : state.imageGenerationPercent);
  $('canvas-empty').hidden = state.objects.some(object => object.canvas === 'main');
  syncComposer();
  $('place-scratch').disabled = !state.objects.some(object => object.canvas === 'scratch');
  document.querySelectorAll('button[data-canvas]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.canvas === activeCanvas)));
  renderLayers(); renderProperties();
  if (componentRail.getActive() === 'assets') assetsPanel?.render();
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
    cancelAreaSelection();
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
  $('group-selection').disabled = !canGroup();
  const canUngroup = state.groups.some(group => group.ids.every(id => selectedIds.includes(id)));
  $('ungroup-selection').disabled = !canUngroup;
  for (const id of ['save-selection-asset', 'menu-save-selection-asset']) $(id).disabled = !selectedIds.length;
  $('crop-raster').disabled = object?.type !== 'raster';
  workspaceTools?.sync();
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
  $('text-properties').hidden = object.type !== 'text'; $('vector-properties').hidden = object.type !== 'vector';
  $('replace-raster').hidden = object.type !== 'raster';
  properties.querySelectorAll('[data-text-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.textStyle === 'bold' ? object.fontWeight >= 700 : Boolean(object[button.dataset.textStyle]))));
  properties.querySelectorAll('[data-align]').forEach(button => button.setAttribute('aria-pressed', String(object.align === button.dataset.align)));
  const siblings = state.objects.filter(item => item.canvas === object.canvas);
  $('raise').disabled = selectedIds.includes(siblings.at(-1)?.id); $('lower').disabled = selectedIds.includes(siblings[0]?.id);
  $('transfer').textContent = object.canvas === 'main' ? 'Copy to scratch' : 'Copy to main';
}
function select(id, { reveal = true, additive = false } = {}) {
  if (reveal) componentRail.open('layers');
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

// Drag previews are transient. The final edit uses the revision captured on
// pointer-down, so an intervening agent edit cannot be silently overwritten.
function point(svg, event) { return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse()); }
function cancelAreaSelection() {
  if (!areaDrag) return;
  const { canvas, pointerId } = areaDrag; areaDrag = null;
  const stage = $(`${canvas}-canvas`);
  stage.classList.remove('is-area-selecting'); stage.querySelector('.selection-region')?.remove();
  if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
}
function renderSelectionRegion() {
  if (!areaDrag) return;
  const svg = $(`${areaDrag.canvas}-canvas`).querySelector('svg');
  let region = svg.querySelector('.selection-region');
  if (!region) { region = element('polygon', { class: 'selection-region', 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd', 'aria-hidden': 'true' }); svg.append(region); }
  const points = areaDrag.mode === 'rectangle' ? rectanglePoints(areaDrag.start, areaDrag.end) : areaDrag.points;
  region.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
}
function updateSelectionRegion(event, final = false) {
  const current = point($(`${areaDrag.canvas}-canvas`).querySelector('svg'), event);
  areaDrag.end = current;
  areaDrag.moved ||= Math.hypot(event.clientX - areaDrag.screen.x, event.clientY - areaDrag.screen.y) >= 4;
  if (areaDrag.mode === 'freehand') {
    const previous = areaDrag.points.at(-1), matrix = $(`${areaDrag.canvas}-canvas`).querySelector('svg').getScreenCTM();
    if (final || Math.hypot(current.x - previous.x, current.y - previous.y) * Math.hypot(matrix.a, matrix.b) >= 2) areaDrag.points.push(current);
    // Bound preview and hit-testing costs during long drawing gestures.
    if (areaDrag.points.length > 2048) areaDrag.points = areaDrag.points.filter((_, index) => index === 0 || index % 2 || index === areaDrag.points.length - 1);
  }
  renderSelectionRegion();
}
function setSelectionTool(mode) {
  cancelAreaSelection();
  $('selection-tool').value = mode;
  for (const canvas of ['main', 'scratch']) $(`${canvas}-canvas`).dataset.selectionTool = mode;
  $('pointer-tool').setAttribute('aria-pressed', String(mode === 'pointer'));
  $('freehand-tool').setAttribute('aria-pressed', String(mode === 'freehand'));
  workspaceTools?.sync();
}
$('pointer-tool').addEventListener('click', () => setSelectionTool('pointer'));
$('freehand-tool').addEventListener('click', () => setSelectionTool('freehand'));
$('selection-tool').addEventListener('change', event => setSelectionTool(event.target.value));
setSelectionTool('pointer');
for (const key of ['main', 'scratch']) {
  const stage = $(`${key}-canvas`);
  let lastClick = null;
  stage.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!state || drag || areaDrag) return;
    if (activeCanvas !== key) { activeCanvas = key; setSelection([]); render(state); }
    viewport.zoom(stage, Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (!state || event.button !== 0 || drag || areaDrag || !event.isPrimary) return;
    const hit = event.target.closest('[data-object-id], [data-resize-id], [data-rotate-id]');
    const mode = $('selection-tool').value;
    // Select & move uses a rectangle on empty space. Freehand still permits
    // moving selected members, and resize handles always take precedence.
    const movingSelection = activeCanvas === key && selectedIds.includes(hit?.dataset.objectId) && !event.shiftKey;
    if (!hit || mode === 'freehand' && !hit.dataset.resizeDirection && !hit.dataset.rotateId && !movingSelection) {
      lastClick = null;
      if (activeCanvas !== key) { activeCanvas = key; setSelection([]); render(state); }
      const start = point(stage.querySelector('svg'), event);
      areaDrag = { canvas: key, pointerId: event.pointerId, mode: mode === 'pointer' ? 'rectangle' : mode, start, end: start, points: [start],
        screen: { x: event.clientX, y: event.clientY }, moved: false, revision: state.revision, ids: [...selectedIds], additive: event.shiftKey, individual: event.altKey,
        hitId: hit?.dataset.objectId || '' };
      stage.classList.add('is-area-selecting'); renderSelectionRegion();
      stage.focus({ preventScroll: true }); stage.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    const id = hit.dataset.objectId || hit.dataset.resizeId || hit.dataset.rotateId;
    const start = point(stage.querySelector('svg'), event);
    if (hit.dataset.resizeDirection || hit.dataset.rotateId) {
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
    const boxes = objects.map(interactionBox);
    drag = { canvas: key, pointerId: event.pointerId, id, object: { ...object }, objects: objects.map(object => ({ ...object })), bounds: objects.length === 1 ? boxes[0] : selectionBounds(boxes), ids: [...selectedIds], start, revision: state.revision, resizing: hit.dataset.resizeDirection, rotating: Boolean(hit.dataset.rotateId), preview: null };
    if (drag.rotating) {
      drag.pivot = { x: drag.bounds.x + drag.bounds.width / 2, y: drag.bounds.y + drag.bounds.height / 2 };
      drag.lastAngle = Math.atan2(start.y - drag.pivot.y, start.x - drag.pivot.x) * 180 / Math.PI;
      drag.totalAngle = 0; drag.handlePlacement = JSON.parse(hit.dataset.placement);
    }
    if (drag.resizing && object.type === 'vector') drag.resizeSvg = stretchSvg(object.svg);
    render(state);
    if (drag.rotating || document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (areaDrag?.canvas === key && areaDrag.pointerId === event.pointerId) { updateSelectionRegion(event); return; }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = point(stage.querySelector('svg'), event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    if (drag.rotating) {
      if (Math.hypot(current.x - drag.pivot.x, current.y - drag.pivot.y) < 1e-6) return;
      const angle = Math.atan2(current.y - drag.pivot.y, current.x - drag.pivot.x) * 180 / Math.PI;
      drag.totalAngle += angleDelta(drag.lastAngle, angle); drag.lastAngle = angle;
      const base = drag.objects.length === 1 ? drag.object.rotation : 0;
      drag.rotationDelta = event.shiftKey ? Math.round((base + drag.totalAngle) / 15) * 15 - base : drag.totalAngle;
      drag.preview = rotateComponents(drag.objects, drag.rotationDelta, drag.pivot);
      renderCanvas(key, { ...state, objects: state.objects.map(object => drag.preview.find(preview => preview.id === object.id) || object) });
      return;
    }
    let patch;
    if (drag.resizing) {
      patch = drag.objects.length > 1 ? resizeSelection(drag.objects, drag.resizing, dx, dy, drag.bounds) : resizeObject(drag.object, drag.resizing, dx, dy, drag.bounds);
      if (drag.objects.some(object => object.type === 'text')) {
        // Browser glyph metrics can round at fractional font sizes. Measure
        // the resized label again so its actual opposite handle stays fixed.
        const previews = drag.objects.length > 1 ? transformSelection(drag.objects, patch) : [{ ...drag.object, ...patch }];
        const boxes = previews.map(interactionBox), box = boxes.length === 1 ? boxes[0] : selectionBounds(boxes);
        const before = resizeAnchor(drag.bounds, drag.resizing), after = resizeAnchor(box, drag.resizing);
        patch.x += before.x - after.x; patch.y += before.y - after.y;
      }
      if (drag.resizeSvg && (patch.width !== drag.object.width || patch.height !== drag.object.height)) patch.svg = drag.resizeSvg;
    }
    else patch = { x: Math.max(-16000, Math.min(16000, drag.object.x + dx)), y: Math.max(-16000, Math.min(16000, drag.object.y + dy)) };
    drag.preview = patch;
    const previews = drag.objects.length > 1 ? transformSelection(drag.objects, patch) : [{ ...drag.object, ...patch }];
    renderCanvas(key, { ...state, objects: state.objects.map(obj => previews.find(preview => preview.id === obj.id) || obj) });
  });
  const finish = event => {
    if (areaDrag?.canvas === key && areaDrag.pointerId === event.pointerId) {
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') { cancelAreaSelection(); return; }
      updateSelectionRegion(event, true);
      const finished = areaDrag;
      const polygon = finished.mode === 'rectangle' ? rectanglePoints(finished.start, finished.end) : finished.points;
      const ids = finished.moved ? regionSelection(state, key, polygon, { individual: finished.individual, getBounds: interactionBox })
        : finished.hitId ? !finished.individual && state.groups.find(group => group.ids.includes(finished.hitId))?.ids || [finished.hitId] : [];
      cancelAreaSelection();
      setSelection(finished.additive ? [...finished.ids, ...ids] : ids); render(state); return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.type === 'lostpointercapture' && !drag.rotating) return;
    const finished = drag; drag = null;
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') { lastClick = null; render(state); return; }
    if (finished.rotating) {
      lastClick = null;
      const degrees = angleDelta(0, finished.rotationDelta || 0);
      if (Math.abs(degrees) < 1e-8) { render(state); return; }
      void edit([{ op: 'rotate', ids: finished.ids, degrees, pivot: finished.pivot }], finished.revision);
      return;
    }
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
  stage.tabIndex = 0;
  stage.addEventListener('pointerup', finish); stage.addEventListener('pointercancel', finish); stage.addEventListener('lostpointercapture', finish);
  stage.addEventListener('focusin', event => {
    const id = event.target.dataset.objectId;
    if (id && !selectedIds.includes(id)) select(state.groups.find(group => group.ids.includes(id))?.ids || id, { reveal: false });
  });
  stage.addEventListener('dblclick', event => {
    if ($('selection-tool').value !== 'pointer') return;
    // Selection redraws the SVG during pointer-down. Chromium can deliver the
    // resulting double-click to the stage after that original node is replaced.
    const hit = event.target.closest('[data-object-id]')
      || document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-object-id]');
    const id = stage.contains(hit) ? hit.dataset.objectId : '';
    if (id) editLabel(id);
  });
}
let keyboardRotation = Promise.resolve();
function rotateWithKeyboard(degrees) {
  const id = illustrationId, canvas = activeCanvas, ids = JSON.stringify(selectedIds);
  keyboardRotation = keyboardRotation.then(async () => {
    if (id !== illustrationId || canvas !== activeCanvas || ids !== JSON.stringify(selectedIds) || drag) return;
    const boxes = selectedObjects().map(interactionBox), box = boxes.length === 1 ? boxes[0] : selectionBounds(boxes);
    if (box) await edit([{ op: 'rotate', ids: [...selectedIds], degrees,
      pivot: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }]);
  }).catch(error => status(error.message));
}
const canvasClipboard = installCanvasClipboard({ document, validateSvg, status,
  canHandle: event => {
    const target = event.target?.closest ? event.target : document.activeElement;
    return Boolean(state) && !drag && !areaDrag && !document.querySelector('dialog[open], #canvas-crop-overlay')
      && !target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      && !target?.isContentEditable;
  },
  getSelection: () => ({ scene: state, ids: [...selectedIds] }),
  paste: async (snapshot, offset) => {
    const id = illustrationId, canvas = activeCanvas;
    const result = await workspace.paste(snapshot, { illustrationId: id, canvas, offset });
    if (!result.ok) { status(result.error); return; }
    if (id === illustrationId && canvas === activeCanvas) select(result.pasted_ids, { reveal: false });
    status('Components pasted');
  }
});
document.addEventListener('keydown', event => {
  if (canvasCrop?.handleKey(event)) return;
  if (canvasClipboard.handleKey(event)) return;
  if (event.key === 'Escape') {
    if (areaDrag) { cancelAreaSelection(); event.preventDefault(); return; }
    if (drag?.rotating) {
      cancelRotation();
      render(state); event.preventDefault(); return;
    }
    if (document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.popover[open]');
    if (menu) {
      menu.open = false;
      if (menu.id === 'add-menu') workspaceTools.focus('add-menu');
      else menu.querySelector('summary').focus();
      event.preventDefault(); return;
    }
    if (selectedIds.length) { setSelection([]); drag = null; render(state); event.preventDefault(); }
    return;
  }
  if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.target.isContentEditable) return;
  if (event.target.closest('[data-rotate-id]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (!drag) rotateWithKeyboard((['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1)
      * (event.shiftKey || ['Enter', ' '].includes(event.key) ? 15 : 1));
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const mode = { v: 'pointer', l: 'freehand' }[event.key.toLowerCase()];
    if (mode && !drag) { setSelectionTool(mode); event.preventDefault(); return; }
  }
  if (areaDrag) return;
  if (!event.defaultPrevented && !event.altKey && (event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault(); void workspace.history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo').catch(error => status(error.message)); return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); void (event.shiftKey ? ungroupSelection() : groupSelection()); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && event.target.closest('.canvas-stage, #layers')) {
    event.preventDefault(); select(state.objects.filter(object => object.canvas === activeCanvas && object.visible).map(object => object.id), { reveal: false }); return;
  }
  const object = selectionTarget(); if (!object) return;
  if (event.key === 'Enter' && object.type === 'text' && (event.target.dataset.objectId || event.target.closest('.layer-select'))) {
    event.preventDefault(); componentRail.open('layers'); $('label-content').focus(); $('label-content').select(); return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault(); const amount = event.shiftKey ? 10 : 1, patch = { x: object.x + delta[0] * amount, y: object.y + delta[1] * amount };
    void edit([object.type === 'group' ? transformOperation(patch) : { op: 'update', id: object.id, patch }]);
  }
});
let exporting = false;
async function exportFigure(format) {
  if (exporting) return;
  exporting = true;
  const buttons = ['export-svg', 'export-png', 'export-pptx'].map($);
  buttons.forEach(button => { button.disabled = true; });
  try {
    await workspace.ready;
    const documentState = workspace.getDocument();
    if (format === 'pptx') status('Preparing PowerPoint…');
    const dataBase64 = format === 'pptx' ? await exportPowerPoint(documentState)
      : format === 'svg' ? encodeText(await workspace.exportSvg('main'))
      : (await renderPreview(documentState, 'main', 8000)).data_url.split(',')[1];
    const result = await hikari.call('downloads.save', { fileName: `${documentState.title || 'figure'}.${format}`, dataBase64 });
    status(result.saved ? `Exported ${format.toUpperCase()}` : 'Export canceled');
  } catch (error) { status(error.message); }
  finally { exporting = false; buttons.forEach(button => { button.disabled = false; }); }
}
$('export-svg').addEventListener('click', () => void exportFigure('svg')); $('export-png').addEventListener('click', () => void exportFigure('png'));
$('export-pptx').addEventListener('click', () => void exportFigure('pptx'));
$('complexity').addEventListener('change', event => void edit([{ op: 'complexity', complexity: event.target.value }]));
function chosenImagePercent() {
  const slider = $('image-generation-percent');
  // Keep existing/API targets exact until the user chooses a slider step.
  return $('image-generation-enabled').checked ? Number(slider.dataset.percent ?? slider.value) : null;
}
function renderImagePreference(percent) {
  const enabled = percent !== null;
  $('image-generation-enabled').checked = enabled;
  $('image-generation-percent').disabled = !enabled;
  $('image-generation-percent').value = enabled ? percent : 50;
  $('image-generation-percent').dataset.percent = enabled ? percent : 50;
  $('image-generation-value').textContent = enabled ? `${percent}%` : 'Auto';
  $('image-generation-summary').textContent = imageGenerationSummary(percent);
}
function saveImagePreference() {
  const preference = { id: illustrationId, percent: chosenImagePercent() };
  pendingImagePreference = preference;
  imagePreferenceSave = imagePreferenceSave.then(async () => {
    // Serialize rapid toggle/slider edits and pin their originating figure.
    const current = await workspace.request({ action: 'read', illustration_id: preference.id });
    if (!current.ok) throw new Error(current.error);
    const result = await workspace.request({ action: 'apply', illustration_id: preference.id, expected_revision: current.revision,
      request_id: crypto.randomUUID(), operations: [{ op: 'image_generation', imageGenerationPercent: preference.percent }] });
    if (!result.ok) throw new Error(result.error);
  }).catch(error => status(error.message)).finally(() => {
    if (pendingImagePreference === preference) {
      pendingImagePreference = null;
      if (state && illustrationId === preference.id) renderImagePreference(state.imageGenerationPercent);
    }
  });
}
$('image-generation-enabled').addEventListener('change', () => {
  renderImagePreference(chosenImagePercent()); saveImagePreference();
});
function showImageSliderPercent() {
  const slider = $('image-generation-percent');
  slider.dataset.percent = slider.value;
  $('image-generation-value').textContent = `${slider.value}%`;
  $('image-generation-summary').textContent = imageGenerationSummary(Number(slider.value));
}
$('image-generation-percent').addEventListener('input', showImageSliderPercent);
$('image-generation-percent').addEventListener('change', () => { showImageSliderPercent(); saveImagePreference(); });
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
    const imageGenerationPercent = chosenImagePercent();
    await imagePreferenceSave;
    // Read after queued edits so a level selected just before Send is durable.
    const current = await workspace.request({ action: 'read', illustration_id: illustrationId });
    if (!current.ok) throw new Error(current.error);
    if (current.complexity !== complexity) throw new Error('The complexity changed or could not be saved. Check the selected level and try again.');
    if (current.imageGenerationPercent !== imageGenerationPercent) throw new Error('The image generation preference changed or could not be saved. Check Figure options and try again.');
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
  const result = await workspace.request(request, deadline, assets, { inspectionRunId, agentRequest: true });
  await hikari.call('agent.respond', { id, result }).catch(error => status(error.message));
});
function syncComposer() {
  const hasComponents = Boolean(state?.objects.length);
  $('prompt-form').hidden = !state || hasComponents || chatExpanded || !canDraw;
  $('canvas-empty-hint').textContent = !canDraw ? 'Add a layer to start your figure.'
    : hasComponents ? 'Continue your figure in the agent chat, or add a layer.'
      : chatExpanded ? 'Describe your figure in the agent chat, or add a layer.' : 'Describe your figure below, or add a layer.';
}
function theme(info) {
  chatExpanded = info?.layout?.agentChatRail?.expanded === true;
  if (chatExpanded) componentRail.close();
  workspaceTools.connect(info);
  // Hosts without Codex report available:false; older hosts omit the field.
  canDraw = info?.layout?.agentChatRail?.available !== false;
  syncComposer();
  document.body.classList.toggle('theme-night', info?.appearance?.mode === 'night');
  document.documentElement.style.setProperty('--app-font-size', `${info?.appearance?.fontSize || 16}px`);
  leftRail.applyContext(info?.layout?.leftRail || {});
  if (Array.isArray(info?.permissions) && !info.permissions.includes('layout')) leftRail.destroy();
}
workspaceTools = createWorkspaceTools({ hikari, document, onHosted: () => { if (state) for (const canvas of ['main', 'scratch']) renderCanvas(canvas); } });
hikari.on('app.context', info => { theme(info); if (info.changed === 'storage') location.reload(); });
void hikari.call('app.info').then(theme).catch(() => {});
hikari.on('app.undo', () => void workspace.history('undo').catch(error => status(error.message)));
hikari.on('app.redo', () => void workspace.history('redo').catch(error => status(error.message)));
hikari.on('app.save', () => void workspace.flush().then(() => hikari.call('app.setUnsaved', { unsaved: false })).catch(error => status(error.message)));
// A narrow public controller is useful for same-origin integration fixtures.
window.illustrationWorkspace = workspace;
void installSourceActions({ hikari, workspace, beforeCreate: () => imagePreferenceSave, status });
