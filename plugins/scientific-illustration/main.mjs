import { createPresentation, i18n } from './i18n.mjs';
import { createWorkspace } from './workspace.mjs';
import { interactionBox } from './artwork.mjs';
import { alignmentOperations, selectionBounds } from './geometry.mjs';
import { createCanvasView } from './canvas-view.mjs';
import { createCanvasGestures } from './canvas-gestures.mjs';
import { createFigureSettings } from './figure-settings.mjs';
import { createFigureExporter } from './figure-export.mjs';
import { createCanvasClipboard } from './clipboard.mjs';
import { createSelectionProperties, initFontPicker } from './selection-properties.mjs';
import { createComponentRail, createLayersPanel } from './layers-panel.mjs';
import { initAssetsPanel, initArtworkImport, initCanvasCrop } from './assets-panel.mjs';
import { createIllustrationLibraryView, initPluginLeftRailResizer } from './illustration-library.mjs';
import { bindPopovers, createSelectionToolbar, createWorkspaceTools, installCanvasContextMenu, mountIcons } from './workspace-tools.mjs';
import { createCanvasGeneration, createFigureAgent, installSourceActions } from './agent/figure-agent.mjs';

const i18nUi = createPresentation('figura');
const { hikari } = window.HikariPlugin;
const $ = id => document.getElementById(id);
const activeCanvas = 'main';
let selectedIds = [], editingGroupId = '', illustrationId = '', state;
const getContext = () => ({ state, illustrationId, selectedIds, editingGroupId });
const getIllustrationId = () => illustrationId;
const getCanvas = () => activeCanvas;
const status = text => { i18nUi.setOwnedText($('status'), text); };

initFontPicker({ hikari });
mountIcons();

const workspace = createWorkspace({
  hikari,
  onChange: render,
  onLibraryChange: library => libraryView.render(library),
  onAssetsChange: library => assetsPanel.render(library),
  onStatus: status
});
const leftRail = initPluginLeftRailResizer({
  commitWidth: width => hikari.call('app.setLeftRailWidth', { width }),
  commitFolded: folded => hikari.call('app.setLeftRailFolded', { folded }),
  onCommitError: error => status(error.message)
});
let leftRailHeaderRegistration = null;
const workspaceTools = createWorkspaceTools({ hikari, document, onHosted: () => { if (state) renderCanvas(activeCanvas); } });
const syncTools = workspaceTools.sync;
const componentRail = createComponentRail({
  document,
  focusTab: () => workspaceTools.focus('layers-tab'),
  onChange: name => {
    if (name && workspaceTools.isHosted()) void hikari.call('app.setAgentChatExpanded', { expanded: false }).catch(() => {});
    syncTools();
  }
});
const openLayers = componentRail.open;

const settings = createFigureSettings({ document, workspace, getContext, edit, status });
bindPopovers(document, settings.boundImagePreferences);
const agent = createFigureAgent({ document, hikari, workspace, getContext, settings, status });
const exportFigure = createFigureExporter({ document, hikari, workspace, getIllustrationId, flushImagePreferences: settings.flushImagePreferences, status });
const libraryView = createIllustrationLibraryView({
  document, workspace, exportFigure, status,
  flushImagePreferences: settings.flushImagePreferences,
  renderAssets: () => assetsPanel.render()
});
const showAssets = () => libraryView.show('assets');
const assetsPanel = initAssetsPanel({
  workspace, getCanvas, getIllustrationId, showAssets, status,
  getSelection: () => ({ ids: selectedIds, name: selectionTarget()?.name || 'Component' }),
  selectCopies: ids => select(ids, { reveal: false }),
  async sendToChat(message) {
    await settings.flushImagePreferences();
    return agent.sendToChat(message, { illustration_id: illustrationId, title: state?.title || '' });
  }
});
const artworkImport = initArtworkImport({ workspace, getCanvas, getIllustrationId, select, showAssets, status });
const canvasCrop = initCanvasCrop({
  workspace, getSelected: selected, getCanvas, getIllustrationId, status,
  onStart: () => { artworkImport.close(); componentRail.close(); },
  onActiveChange(active, focus) {
    $('crop-raster').setAttribute('aria-pressed', String(active));
    syncSelectionToolbar();
    syncTools();
    if (focus) workspaceTools.focus('crop-raster');
  },
  select: id => select(id, { reveal: false })
});
const layers = createLayersPanel({ document, workspace, getContext, edit, editLabel, select, status });
const properties = createSelectionProperties({
  document, workspace, getContext, selected, selectedGroup, selectionTarget, canGroup, select, openLayers,
  edit, renderCanvas, syncSelectionToolbar, syncTools, status
});

const selectionToolbar = createSelectionToolbar({ document,
  onAction: (action, button) => {
    if (action === 'align') workspaceTools.toggleMenu('align-menu', button);
    else if (action === 'edit-group') startGroupEdit();
    else if (action === 'done-group') finishGroupEdit();
    else $(action === 'group' ? 'group-selection' : 'ungroup-selection').click();
  },
  onHide: () => { if ($('align-menu').classList.contains('is-selection-menu')) $('align-menu').open = false; },
  onLayout: workspaceTools.layoutMenu
});
function syncSelectionToolbar() {
  const editingGroup = Boolean(editingGroupId);
  const showSelection = selectedIds.length > 1 && !gestures.isActive() && !properties.isEditingText();
  selectionToolbar.sync({ visible: !$('main-canvas').inert && (editingGroup || showSelection),
    editingGroup, editGroup: Boolean(selectedGroup()),
    group: !$('group-selection').disabled, ungroup: !$('ungroup-selection').disabled,
    align: [...document.querySelectorAll('[data-layout-action]')].some(button => !button.disabled) });
}

const canvas = createCanvasView({
  document, getContext,
  getDrag: () => gestures.getDrag(),
  isInteracting: () => gestures.isActive(),
  renderSelectionRegion: () => gestures.renderSelectionRegion(),
  onZoom: syncTools,
  onLayout: () => { properties.layoutText(); syncSelectionToolbar(); },
  onRender: properties.syncColorHighlight,
  onScroll: syncSelectionToolbar
});
const gestures = createCanvasGestures({
  document, getContext, hitTest: canvas.hit, isEditingText: properties.isEditingText,
  select, setSelection, targetIds, selectedObjects, selectionTarget, edit, editLabel,
  render, renderCanvas, syncSelectionToolbar, syncTools
});
const canvasClipboard = createCanvasClipboard({
  document, hikari, workspace, getContext, isInteracting: gestures.isActive, select, status
});

const canvasGeneration = createCanvasGeneration({ document, workspace, status,
  getContext: () => ({ document: state, illustrationId }), canGenerate: agent.canDraw,
  beforeSend: settings.flushImagePreferences, sendToChat: agent.sendToChat });
const canvasContextMenu = installCanvasContextMenu({ document, status,
  getContext: context => context.surface === $('main-canvas') ? canvasGeneration.capture(context) : null,
  hitTest: event => canvas.hit(event),
  canOpen: () => Boolean(state) && !gestures.isActive() && !document.querySelector('dialog[open], #canvas-crop-overlay'),
  selectTarget: (id, { individual, forceIndividual }) => {
    // Shared selection handles use a synthetic ID; keep their real members.
    const ids = targetIds(id, individual);
    if (!ids.length) return;
    if (forceIndividual || !ids.every(id => selectedIds.includes(id))) select(ids, { reveal: false });
  },
  getActions: target => ({
    copy: { enabled: Boolean(selectedIds.length), run: () => canvasClipboard.copy() },
    paste: { enabled: true, run: () => canvasClipboard.paste() },
    group: { enabled: canGroup(), run: groupSelection },
    ungroup: { enabled: state.groups.some(group => group.ids.every(id => selectedIds.includes(id))), run: ungroupSelection },
    'save-asset': { enabled: Boolean(selectedIds.length), run: () => assetsPanel.save() },
    'generate-here': { visible: Boolean(target), enabled: Boolean(target) && agent.canDraw() && !canvasGeneration.isSubmitting(), run: () => canvasGeneration.open(target) }
  })
});

function renderCanvas(key, documentState) { canvas.render(key, documentState); }
function editLabel(id) { properties.editLabel(id); }
function editingGroup() { return editingGroupId ? state?.groups.find(group => group.id === editingGroupId) : undefined; }
function setSelection(ids) {
  const group = editingGroup();
  if (!group || ids.some(id => !group.ids.includes(id))) editingGroupId = '';
  selectedIds = [...new Set(ids)];
}
function targetIds(id, individual = false) {
  const group = state.groups.find(group => group.id === id || (!individual && group.id !== editingGroupId && group.ids.includes(id)));
  return group?.ids || (state.objects.some(object => object.id === id) ? [id] : []);
}
function selected() { return selectedIds.length === 1 ? state?.objects.find(object => object.id === selectedIds[0]) : undefined; }
function selectedObjects() { return state?.objects.filter(object => selectedIds.includes(object.id)) || []; }
function selectedGroup() { return state?.groups.find(group => group.ids.length === selectedIds.length && group.ids.every(id => selectedIds.includes(id))); }

function startGroupEdit() {
  const group = selectedGroup();
  if (!group || gestures.isActive()) return;
  editingGroupId = group.id;
  select([], { reveal: false });
  $('main-canvas').focus({ preventScroll: true });
}

function finishGroupEdit() {
  const group = editingGroup();
  if (!group || gestures.isActive()) return;
  editingGroupId = '';
  select(group.ids, { reveal: false });
  const button = $('selection-edit-group');
  (button.closest('[hidden]') ? $('main-canvas') : button).focus({ preventScroll: true });
}

function select(id, { reveal = true, additive = false } = {}) {
  if (reveal) openLayers();
  const ids = Array.isArray(id) ? id : [id];
  if (!additive) setSelection(ids);
  else if (ids.every(id => selectedIds.includes(id))) setSelection(selectedIds.filter(id => !ids.includes(id)));
  else setSelection([...selectedIds, ...ids]);
  render(state);
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
document.querySelectorAll('[data-layout-action]').forEach(button => button.addEventListener('click', async () => {
  if (!state || gestures.isActive()) return;
  const operations = alignmentOperations(state, selectedIds, button.dataset.layoutAction, interactionBox);
  if (operations.length) await edit(operations);
  workspaceTools.focus('align-menu');
}));
const newId = () => `object-${crypto.randomUUID()}`;

function selectionUnits() {
  const groups = state.groups.filter(group => group.ids.every(id => selectedIds.includes(id)));
  return [...groups.map(group => group.id), ...selectedIds.filter(id => !groups.some(group => group.ids.includes(id)))];
}
function deleteSelection() { if (selectedIds.length) void edit(selectionUnits().map(id => ({ op: 'delete', id }))); }
$('delete').addEventListener('click', deleteSelection);
$('duplicate').addEventListener('click', async () => {
  const object = selected();
  if (!object) {
    if (selectedIds.length) await duplicateSelection();
    return;
  }
  const id = newId();
  if ((await edit([{ op: 'upsert', object: { ...object, id, name: `${object.name} copy`, x: object.x + 15, y: object.y + 15 } }]))?.ok) select(id);
});
async function duplicateSelection() {
  const copies = selectionUnits().map(id => ({ op: 'transfer', id, canvas: activeCanvas, copy: true, new_id: newId() }));
  const offsets = copies.map(({ id, new_id }) => {
    const group = state.groups.find(group => group.id === id);
    const source = group
      ? selectionBounds(state.objects.filter(object => group.ids.includes(object.id)))
      : state.objects.find(object => object.id === id);
    return { op: group ? 'transform' : 'update', id: new_id, patch: { x: source.x + 15, y: source.y + 15 } };
  });
  const result = await edit([...copies, ...offsets]);
  if (!result?.ok) return;
  select(copies.flatMap(({ new_id }) => state.groups.find(group => group.id === new_id)?.ids || [new_id]));
}

async function edit(operations, revision = state?.revision) {
  if (!revision) return status(i18nUi.text("The illustration is still opening."));
  const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: revision, request_id: crypto.randomUUID(), operations });
  if (!result.ok) { status(result.error); if (state) render(state); }
  return result;
}
function render(next, id = illustrationId) {
  layers.cancelOrder();
  properties.syncText(next, id);
  canvasContextMenu.close(true);
  gestures.syncDocument(next, id);
  canvasCrop.onDocumentChange(next, id);
  if (id !== illustrationId) {
    canvasGeneration.close();
    illustrationId = id;
    editingGroupId = '';
    setSelection([]);
    componentRail.close();
    assetsPanel.closeSave();
    artworkImport.close();
    canvas.reset();
    $('raster-dialog').close(); $('prompt').value = ''; $('prompt').style.height = '';
  }
  state = next;
  agent.syncChatContext(illustrationId, state.title);
  setSelection(selectedIds.filter(id => state.objects.some(object => object.id === id && object.canvas === activeCanvas)));
  renderCanvas(activeCanvas);
  settings.render(state, id);
  agent.syncComposer();
  layers.render(state, selectedIds);
  properties.render();
  properties.syncColorHighlight();
  if (!$('assets-panel').hidden) assetsPanel.render();
  canvas.renderZoom();
}

let keyboardTransform = Promise.resolve();
function queueKeyboardTransform(operations) {
  const id = illustrationId, ids = JSON.stringify(selectedIds);
  // Key repeat can outpace persistence. Build each relative edit from the last
  // committed geometry and revision instead of reusing the first key's patch.
  keyboardTransform = keyboardTransform.then(async () => {
    if (id !== illustrationId || ids !== JSON.stringify(selectedIds) || gestures.isActive()) return;
    const next = operations();
    if (next.length) await edit(next);
  }).catch(error => status(error.message));
}
function rotateWithKeyboard(degrees) {
  queueKeyboardTransform(() => {
    const objects = selectedObjects(), box = objects.length === 1 ? objects[0] : selectionBounds(objects.map(interactionBox));
    return box ? [{ op: 'rotate', ids: [...selectedIds], degrees,
      pivot: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }] : [];
  });
}
function nudgeWithKeyboard(dx, dy) {
  queueKeyboardTransform(() => {
    const object = selectionTarget();
    if (!object) return [];
    const patch = { x: object.x + dx, y: object.y + dy };
    return [object.type === 'group' ? transformOperation(patch) : { op: 'update', id: object.id, patch }];
  });
}

document.addEventListener('keydown', event => {
  if (canvasCrop.handleKey(event)) return;
  if (canvasClipboard.handleKey(event)) return;
  if (event.key === 'Escape') {
    if (gestures.isAreaSelecting()) { gestures.cancelAreaSelection(); event.preventDefault(); return; }
    if (gestures.isDragging()) {
      gestures.cancelDrag({ restoreSelection: true });
      render(state); event.preventDefault(); return;
    }
    if (document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.popover[open]');
    if (menu) {
      menu.open = false;
      if (['add-menu', 'palette-menu', 'align-menu'].includes(menu.id)) workspaceTools.focus(menu.id);
      else menu.querySelector('summary').focus();
      event.preventDefault(); return;
    }
    if (editingGroupId) { finishGroupEdit(); event.preventDefault(); return; }
    if (selectedIds.length) { setSelection([]); render(state); event.preventDefault(); }
    return;
  }
  if (event.defaultPrevented || document.querySelector('dialog[open]')
    || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || event.target.isContentEditable) return;
  if (event.target.closest('[data-rotate-id]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (!gestures.isDragging()) rotateWithKeyboard((['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1)
      * (event.shiftKey || ['Enter', ' '].includes(event.key) ? 15 : 1));
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const mode = { v: 'pointer', l: 'freehand' }[event.key.toLowerCase()];
    if (mode && !gestures.isDragging()) { gestures.setSelectionTool(mode); event.preventDefault(); return; }
  }
  if (gestures.isAreaSelecting()) return;
  if (!event.defaultPrevented && !event.altKey && (event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault(); void workspace.history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo').catch(error => status(error.message)); return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); void (event.shiftKey ? ungroupSelection() : groupSelection()); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && event.target.closest('.canvas-stage, #layers')) {
    const group = editingGroup();
    const ids = state.objects.filter(object => object.canvas === activeCanvas && object.visible && (!group || group.ids.includes(object.id))).map(object => object.id);
    event.preventDefault(); select(ids, { reveal: false }); return;
  }
  if (event.target.closest('.illustration-row')) return;
  const object = selectionTarget(); if (!object) return;
  if (event.key === 'Enter' && object.type === 'text' && (event.target.dataset.objectId || event.target.closest('.layer-select'))) {
    event.preventDefault(); editLabel(object.id); return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
    nudgeWithKeyboard(delta[0] * amount, delta[1] * amount);
  }
});

function theme(info) {
  if (info?.locale) i18n.setLocale(info.locale);
  agent.updateLayout(info?.layout?.agentChatRail, componentRail.close, () => workspaceTools.connect(info));
  document.body.classList.toggle('theme-night', info?.appearance?.mode === 'night');
  document.body.classList.toggle('theme-miku', info?.appearance?.mode === 'miku');
  document.documentElement.style.setProperty('--app-font-size', `${info?.appearance?.fontSize || 16}px`);
  leftRail.applyContext(info?.layout?.leftRail || {});
  if (Array.isArray(info?.permissions) && !info.permissions.includes('layout')) leftRail.destroy();
  else if (info?.layout?.leftRail?.headerToggleAvailable && !leftRailHeaderRegistration) {
    leftRailHeaderRegistration = hikari.call('app.setLeftRail', { available: true })
      .then(result => leftRail.setHeaderToggle(result?.mounted === true)).catch(() => {});
  }
}
i18n.subscribe(syncTools);
hikari.on('app.context', info => { theme(info); if (info.changed === 'storage') location.reload(); });
void hikari.call('app.info').then(theme).catch(() => {});
hikari.on('app.undo', () => void workspace.history('undo').catch(error => status(error.message)));
hikari.on('app.redo', () => void workspace.history('redo').catch(error => status(error.message)));
hikari.on('app.save', () => void workspace.flush().then(() => hikari.call('app.setUnsaved', { unsaved: false })).catch(error => status(error.message)));
// A narrow public controller is useful for same-origin integration fixtures.
window.illustrationWorkspace = workspace;
void installSourceActions({ hikari, workspace, beforeCreate: settings.pendingSave, status });
