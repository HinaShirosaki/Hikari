import { saveLayout } from './layout-export.mjs';

const $ = id => document.getElementById(id);
const PLOT_DRAG = 'application/x-hikari-flow-layout-plot';
const SNAPSHOT_SIZE = 768;

function placeLayer(frame, source, copy, bounds) {
  const rect = source.getBoundingClientRect();
  Object.assign(copy.style, {
    left: (rect.left - bounds.left) / bounds.width * 100 + '%',
    top: (rect.top - bounds.top) / bounds.height * 100 + '%',
    width: rect.width / bounds.width * 100 + '%',
    height: rect.height / bounds.height * 100 + '%'
  });
  copy.classList.add('layout-plot-layer');
  copy.setAttribute('aria-hidden', 'true');
  frame.append(copy);
}

function copyPixels(source, pixelated) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, SNAPSHOT_SIZE / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = !pixelated;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (pixelated) canvas.classList.add('layout-pixelated');
  return canvas;
}

export function capturePlot(type, label) {
  const scatter = type === 'scatter-3d';
  const density = type === 'density';
  const chart = $(scatter ? 'scatter-chart' : 'chart');
  const canvas = $(scatter ? 'scatter-canvas' : 'density');
  const axes = $('chart-axes');
  const bounds = chart.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !canvas.width || !canvas.height) return null;
  const figure = document.createElement('figure');
  figure.className = 'layout-snapshot';
  const frame = document.createElement('div');
  frame.className = 'layout-plot-frame';
  frame.style.aspectRatio = `${bounds.width} / ${bounds.height}`;
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', (scatter ? canvas : axes).ariaLabel);
  placeLayer(frame, canvas, copyPixels(canvas, density), bounds);
  if (!scatter) {
    if (density) {
      const overlay = $('gate-overlay').cloneNode(false);
      overlay.removeAttribute('id');
      overlay.className.baseVal = 'gate-overlay';
      const outlines = $('gate-outlines').cloneNode(true);
      outlines.removeAttribute('id');
      for (const outline of outlines.children) outline.classList.remove('is-active');
      overlay.append(outlines);
      placeLayer(frame, $('gate-overlay'), overlay, bounds);
    }
    const copy = axes.cloneNode(true);
    copy.removeAttribute('id');
    placeLayer(frame, axes, copy, bounds);
  }
  figure.append(frame);

  const notes = document.createElement('figcaption');
  notes.className = 'layout-snapshot-notes';
  const notice = $(scatter ? 'scatter-notice' : 'chart-notice');
  if (!notice.hidden) notes.textContent = notice.textContent;
  if (scatter) {
    const mapping = document.createElement('p');
    mapping.textContent = $('scatter-channels').textContent;
    notes.append(mapping);
    if (!$('scatter-sampling').hidden) {
      const sampling = document.createElement('p');
      sampling.textContent = $('scatter-sampling').textContent;
      notes.append(sampling);
    }
  }
  const legend = density ? $('density-footer').querySelector('.legend')
    : scatter ? $('scatter-footer').querySelector('.legend') : $('histogram-legend');
  if (legend.textContent.trim()) {
    const copy = legend.cloneNode(true);
    copy.removeAttribute('id');
    notes.append(copy);
  }
  if (notes.hasChildNodes()) figure.append(notes);
  const kind = density ? 'Density' : scatter ? '3D scatter' : 'Histogram';
  return { name: label, kind, figure };
}

export function createLayoutEditor({ button, getPlot, listFolders, revealFolder, onOpen, onBack, hikari }) {
  const lastByFolder = new WeakMap();
  const grid = $('layout-grid');
  const dialog = $('layout-dialog');
  const target = $('layout-target');
  const folderTarget = $('layout-folder');
  const nameInput = $('layout-name');
  const addButton = $('add-to-layout');
  const exportStatus = $('layout-export-status');
  const exports = { png: $('export-layout-png'), pdf: $('export-layout-pdf') };
  let draft = null;
  let current = null;
  let plotReady = false;
  let nextLayout = 0;
  let nextPlot = 0;
  let drag = null;
  let exporting = false;
  let downloadAllowed = true;

  function syncAddButton() {
    const hasFolder = listFolders().length > 0;
    addButton.disabled = !plotReady || !hasFolder;
    addButton.title = hasFolder ? '' : 'Create a folder in the left rail to add a plot to a layout.';
  }
  syncAddButton();

  function syncExportButtons() {
    for (const control of Object.values(exports)) control.disabled = exporting || !downloadAllowed || !current?.tiles.length;
  }

  function exportMessage(message, error = false) {
    exportStatus.textContent = message;
    exportStatus.hidden = !message;
    exportStatus.dataset.error = String(error);
  }

  for (const [format, control] of Object.entries(exports)) control.addEventListener('click', async () => {
    if (exporting || !current?.tiles.length) return;
    const layout = current;
    exporting = true;
    syncExportButtons();
    exportMessage(`Preparing ${format.toUpperCase()}…`);
    try {
      const result = await saveLayout(layout, format, hikari);
      if (layout === current) exportMessage(result.saved ? `Exported ${result.fileName}.` : '');
    } catch (error) {
      if (layout === current) exportMessage(error.message, true);
    } finally {
      exporting = false;
      syncExportButtons();
    }
  });

  function showPermissionNotice() {
    if (!downloadAllowed) {
      exportMessage('Remove and re-add Flow Cytometry in Settings → Plugins, then reload Hikari to enable exports.', true);
    }
  }

  function renderRail(folder) {
    for (const row of folder.list.querySelectorAll(':scope > .layout-row')) row.remove();
    folder.list.append(...folder.layouts.map(layout => {
      const row = document.createElement('li');
      row.className = 'layout-row';
      const open = button('', () => show(layout), { icon: 'layout', label: 'View layout ' + layout.name, className: 'layout-select' });
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = layout.name;
      open.append(name);
      open.title = layout.name;
      open.setAttribute('aria-current', String(layout === current));
      open.dataset.layoutId = layout.id;
      row.append(open);
      return row;
    }));
  }

  function move(tile, index, focus = false) {
    const from = current.tiles.indexOf(tile);
    if (from === index || index < 0 || index >= current.tiles.length) return;
    current.tiles.splice(from, 1);
    current.tiles.splice(index, 0, tile);
    renderGrid(focus ? tile.id : null);
    $('layout-feedback').textContent = `${tile.name} moved to position ${index + 1}.`;
  }

  function tool(icon, label, action, disabled = false) {
    const control = button('', action, { icon, label, className: 'icon-button' });
    control.title = label;
    control.disabled = disabled;
    return control;
  }

  function plotCard(tile, index) {
    const card = document.createElement('article');
    card.className = 'layout-card';
    card.dataset.plotId = tile.id;
    card.tabIndex = -1;
    card.classList.toggle('is-wide', tile.wide && current.columns > 1);
    const header = document.createElement('header');
    header.className = 'layout-card-header';
    header.draggable = true;
    const caption = document.createElement('div');
    caption.className = 'layout-card-caption';
    const title = document.createElement('h3');
    title.textContent = tile.name;
    const kind = document.createElement('p');
    kind.className = 'muted';
    kind.textContent = tile.kind;
    caption.append(title, kind);
    const controls = document.createElement('div');
    controls.className = 'layout-card-actions';
    const widthLabel = tile.wide ? 'Restore width of ' : 'Widen ';
    const resize = tool('layout', widthLabel + tile.name, () => {
      tile.wide = !tile.wide;
      renderGrid(tile.id);
    }, current.columns === 1);
    resize.setAttribute('aria-pressed', String(tile.wide));
    controls.append(
      tool('move-earlier', 'Move earlier: ' + tile.name, () => move(tile, index - 1, true), index === 0),
      tool('move-later', 'Move later: ' + tile.name, () => move(tile, index + 1, true), index === current.tiles.length - 1),
      resize,
      tool('close', 'Remove plot ' + tile.name, () => {
        current.tiles.splice(index, 1);
        const neighbor = current.tiles[Math.min(index, current.tiles.length - 1)];
        renderGrid(neighbor?.id);
        if (!neighbor) $('layout-back').focus();
      })
    );
    header.append(caption, controls);
    card.append(header, tile.figure);
    return card;
  }

  function resetDrag() {
    drag = null;
    grid.querySelector('.is-drop-target')?.classList.remove('is-drop-target');
  }

  function renderGrid(focusId) {
    resetDrag();
    grid.style.setProperty('--layout-columns', current.columns);
    grid.replaceChildren(...current.tiles.map(plotCard));
    $('layout-empty').hidden = current.tiles.length > 0;
    syncExportButtons();
    if (focusId) grid.querySelector(`[data-plot-id="${focusId}"]`)?.focus();
  }

  function show(layout) {
    const previous = current?.folder;
    const { folder } = layout;
    current = layout;
    lastByFolder.set(folder, layout);
    $('layout-editor').hidden = false;
    $('layout-columns').value = layout.columns;
    $('layout-feedback').textContent = '';
    exportMessage('');
    showPermissionNotice();
    if (previous && previous !== folder) renderRail(previous);
    renderRail(folder);
    revealFolder(folder);
    renderGrid();
    onOpen();
    const open = folder.list.querySelector(`[data-layout-id="${layout.id}"]`);
    if (open?.getClientRects().length) open.focus();
    else $('layout-back').focus();
  }

  function close() {
    if (!current) return false;
    const { folder } = current;
    current = null;
    resetDrag();
    grid.replaceChildren();
    $('layout-editor').hidden = true;
    renderRail(folder);
    return true;
  }

  function showDraft(kind, folder, plot = null) {
    const folders = folder ? [] : listFolders();
    if (!folder && !folders.length) return;
    draft = { kind, folder, plot, folders };
    const adding = kind === 'add';
    $('layout-dialog-title').textContent = adding ? 'Add to layout' : kind === 'rename' ? 'Rename layout' : 'New layout';
    $('save-layout').textContent = adding ? 'Add plot' : kind === 'rename' ? 'Save name' : 'Create';
    $('layout-folder-field').hidden = folderTarget.disabled = Boolean(folder);
    const location = $('layout-dialog-location');
    location.textContent = folder?.name ?? '';
    location.hidden = !folder;
    if (!folder) {
      folderTarget.replaceChildren(new Option('Choose a folder…', ''), ...folders.map(item => new Option(item.name, item.id)));
    }
    nameInput.value = kind === 'rename' ? current.name : `Layout ${nextLayout + 1}`;
    syncDraftFolder();
    dialog.showModal();
    if (!folder) folderTarget.focus();
    else if (nameInput.disabled) target.focus();
    else nameInput.select();
  }

  function draftFolder() {
    return draft.folder ?? draft.folders.find(folder => folder.id === folderTarget.value);
  }

  function syncDraftFolder() {
    if (!draft) return;
    const folder = draftFolder();
    const choosingLayout = draft.kind === 'add' && Boolean(folder);
    $('save-layout').disabled = !folder;
    $('layout-target-field').hidden = target.disabled = !choosingLayout;
    if (choosingLayout) {
      target.replaceChildren(...folder.layouts.map(layout => new Option(layout.name, layout.id)), new Option('New layout', ''));
      target.value = lastByFolder.get(folder)?.id ?? '';
    }
    syncDraftName();
  }

  function syncDraftName() {
    if (!draft) return;
    const usesName = Boolean(draftFolder()) && (draft.kind !== 'add' || target.value === '');
    $('layout-name-field').hidden = !usesName;
    nameInput.disabled = !usesName;
  }

  $('rename-layout').addEventListener('click', () => {
    if (current) showDraft('rename', current.folder);
  });
  addButton.addEventListener('click', () => {
    const source = getPlot();
    if (source?.plot) showDraft('add', source.folder, source.plot);
  });
  folderTarget.addEventListener('change', syncDraftFolder);
  target.addEventListener('change', syncDraftName);
  $('cancel-layout').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) draft = null;
  });
  $('layout-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!draft) return;
    const { kind, plot } = draft;
    const folder = draftFolder();
    const name = nameInput.value.trim();
    if (!folder) return;
    if (!nameInput.disabled && !name) {
      nameInput.focus();
      return;
    }
    let layout = kind === 'rename' ? current : kind === 'add' ? folder.layouts.find(item => item.id === target.value) : null;
    if (!layout) {
      const id = String(++nextLayout);
      layout = { id, name, folder, columns: 2, tiles: [] };
      folder.layouts.push(layout);
    } else if (kind === 'rename') {
      layout.name = name;
    }
    if (plot) layout.tiles.push({ ...plot, id: ++nextPlot, wide: false });
    dialog.close();
    show(layout);
  });
  $('layout-columns').addEventListener('change', event => {
    if (!current) return;
    current.columns = Number(event.target.value);
    renderGrid();
  });
  $('delete-layout').addEventListener('click', () => {
    if (!current) return;
    const { folder } = current;
    folder.layouts = folder.layouts.filter(layout => layout !== current);
    const next = folder.layouts.at(-1);
    if (next) show(next);
    else {
      lastByFolder.delete(folder);
      onBack();
    }
  });
  $('layout-back').addEventListener('click', onBack);

  grid.addEventListener('dragstart', event => {
    const header = event.target.closest('.layout-card-header');
    if (!header || event.target.closest('button')) {
      event.preventDefault();
      return;
    }
    const tile = current?.tiles.find(item => String(item.id) === header.parentElement.dataset.plotId);
    if (!tile) return;
    event.dataTransfer.setData(PLOT_DRAG, String(tile.id));
    event.dataTransfer.effectAllowed = 'move';
    drag = tile;
  });
  grid.addEventListener('dragover', event => {
    if (!drag || !event.dataTransfer.types.includes(PLOT_DRAG)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const card = event.target.closest('.layout-card');
    grid.querySelector('.is-drop-target')?.classList.remove('is-drop-target');
    if (card && card.dataset.plotId !== String(drag.id)) card.classList.add('is-drop-target');
  });
  grid.addEventListener('drop', event => {
    if (!drag || !event.dataTransfer.types.includes(PLOT_DRAG)) return;
    event.preventDefault();
    const card = event.target.closest('.layout-card');
    const index = card ? current.tiles.findIndex(tile => String(tile.id) === card.dataset.plotId) : current.tiles.length - 1;
    move(drag, index);
    resetDrag();
  });
  grid.addEventListener('dragend', resetDrag);

  return {
    create(folder) { showDraft('new', folder); },
    close,
    get name() { return current?.name; },
    get folderName() { return current?.folder.name; },
    setDownloadPermission(allowed) {
      downloadAllowed = allowed;
      syncExportButtons();
      if (current) showPermissionNotice();
    },
    syncAddButton,
    setPlotReady(ready) {
      plotReady = ready;
      syncAddButton();
    }
  };
}
