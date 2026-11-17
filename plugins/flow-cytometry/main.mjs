import {
  axesForPlot, createAxisControls, ensurePlotSettings, plotSettings, setPlotAxis, storePlotAxes
} from './axis-settings.mjs';
import { createFileRail } from './file-rail.mjs';
import { createGateDrawing } from './gate-drawing.mjs';
import { createGateLibrary, groupName, groupReference } from './gate-library.mjs';
import { createHistogramOverlay } from './histogram.mjs';
import { capturePlot, createLayoutEditor } from './layout-editor.mjs';
import { channelLabel, createPlot } from './plot.mjs';
import { createScatter3D } from './scatter-3d.mjs';

const $ = id => document.getElementById(id);
let active = null;
let activeGroup = null;
let gateAxesPreview = null;
let plotVersion = 0;
const currentView = () => activeGroup ?? active;
const channelLabels = sample => sample.channels.map(channel => channelLabel(channel, sample.scope.aliases));
const plotType = (sample, view) => gateAxesPreview ? 'density' : (plotSettings(sample, view).plotType ?? 'density');

const overlay = $('gate-overlay');
const plot = createPlot({
  chart: $('chart'), area: $('plot-area'), canvas: $('density'), axes: $('chart-axes'), overlay,
  outlines: $('gate-outlines'), preview: $('gate-preview'), handles: $('gate-handles'), notice: $('chart-notice')
});
const scatterPlot = createScatter3D({
  canvas: $('scatter-canvas'), reset: $('scatter-reset'),
  channels: $('scatter-channels'), notice: $('scatter-notice'), sampling: $('scatter-sampling')
});
const gateDrawing = createGateDrawing({
  overlay, plot, toolbar: $('gate-tools'), finish: $('finish-gate'),
  help: $('gate-instructions'), save: shape => gates.saveGate(active, currentView(), shape),
  findGate: id => currentView()?.gates.find(gate => gate.id === id && gate.counts && !gate.moving),
  selectGate(id) {
    const view = currentView();
    if (!view?.rendered || view.selectedGate === id) return;
    view.selectedGate = id;
    plot.gates(view.gates, id);
  },
  updateGate: (gate, shape) => void gates.updateGate(active, gate, shape)
});

const rail = createFileRail({
  analyze,
  button,
  importStatus,
  select,
  getActiveSample: () => active,
  onOpenSample: sample => gates.applyExisting(sample),
  onChannelNames: updateChannelLabels,
  canMoveSample: (sample, folder) => gates.canMoveIntoFolder(sample, folder),
  onMoveSample(sample, folder) {
    gates.moveIntoFolder(sample, folder);
    if (active === sample) syncPlotControls(active, currentView());
    if (active?.folder !== folder) refreshHistogramOverlay({ sampleId: sample.id });
  },
  onFolderChange(folder) {
    if (active?.folder === folder && !gateAxesPreview) void refreshPlot(active);
  },
  onFolderAdded: () => layouts.syncAddButton(),
  onCloseSample: sampleId => refreshHistogramOverlay({ sampleId }),
  onNewLayout: folder => layouts.create(folder)
});
const gates = createGateLibrary({
  analyze,
  button,
  select,
  getActiveSample: () => active,
  currentView,
  getSample: rail.getSample,
  listSamples: rail.listSamples,
  drawGates: view => plot.gates(view.gates, view.selectedGate),
  showGateErrors: updateSharedGateStatus,
  gateMessage: gateDrawing.message,
  cancelDrawing: gateDrawing.cancel,
  updateViewHeading,
  refreshView: refreshPlot,
  onGateChange: gateIds => refreshHistogramOverlay({ gateIds })
});
const histogramOverlay = createHistogramOverlay({
  listSamples: rail.listSamples,
  groupName,
  groupReference,
  onChange(view) {
    if (view === currentView()) void refreshPlot(active, view);
  }
});
const layouts = createLayoutEditor({
  button,
  hikari: window.HikariPlugin?.hikari,
  listFolders: rail.listFolders,
  revealFolder: rail.revealFolder,
  getPlot() {
    const view = currentView();
    if (!view || layouts.name || $('add-to-layout').disabled) return null;
    const type = plotType(active, view);
    gateDrawing.cancel();
    if (type === 'scatter-3d') scatterPlot.paintNow();
    const name = view.gate ? `${active.name} / ${groupName(view)}` : active.name;
    return { folder: active.folder, plot: capturePlot(type, name) };
  },
  onOpen() {
    gateDrawing.cancel();
    updateWorkspaceView();
  },
  onBack() {
    select(active?.id, activeGroup);
    $('file-title').focus();
  }
});

const pending = new Map();
let worker, workerError, nextRequest = 0;
function startWorker() {
  worker = new Worker(new URL('./analysis.mjs', import.meta.url), { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    const request = pending.get(data.request);
    if (!request) return;
    pending.delete(data.request);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  worker.addEventListener('error', () => {
    workerError = new Error('The analysis worker stopped. Reload Flow Cytometry to reopen your files.');
    for (const request of pending.values()) request.reject(workerError);
    pending.clear();
    importStatus(workerError.message, true);
  });
}
function analyze(action, id, payload = {}) {
  if (workerError) return Promise.reject(workerError);
  try {
    if (!worker) startWorker();
    return new Promise((resolve, reject) => {
      const request = ++nextRequest;
      worker.postMessage({ action, id, request, ...payload });
      pending.set(request, { resolve, reject });
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

function button(text, action, { icon, label = text, className } = {}) {
  const element = document.createElement('button');
  element.type = 'button';
  if (className) element.className = className;
  if (icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', '#i-' + icon);
    svg.append(use);
    element.append(svg);
  }
  element.append(text);
  element.setAttribute('aria-label', label);
  element.addEventListener('click', action);
  return element;
}

function importStatus(message, error = false) {
  $('import-status').textContent = message;
  $('import-status').hidden = !message;
  $('import-status').dataset.error = String(error);
}

function select(id, group = null, gate = null, { keepLayout = false } = {}) {
  const leftLayout = !keepLayout && layouts.close();
  if (active?.id === id && activeGroup === group) {
    if (leftLayout) updateWorkspaceView();
    const view = currentView();
    if (gate) showGate(active, view, gate);
    else if (leftLayout && view) {
      syncPlotControls(active, view);
      void refreshPlot(active, view);
    }
    return;
  }
  currentView()?.open.setAttribute('aria-current', 'false');
  active = rail.getSample(id) ?? null;
  activeGroup = group;
  gateAxesPreview = null;
  rail.reveal(active);
  const view = currentView();
  gateDrawing.cancel();
  updateWorkspaceView();
  if (layouts.name) {
    ++plotVersion;
    return;
  }
  if (!active) {
    ++plotVersion;
    plot.clear();
    scatterPlot.clear();
    histogramOverlay.clear();
    layouts.setPlotReady(false);
    return;
  }
  if (gate) {
    showGate(active, view, gate);
    return;
  }
  syncPlotControls(active, view);
  void refreshPlot(active, view);
}

function updateWorkspaceView() {
  const showingLayout = Boolean(layouts.name);
  currentView()?.open.setAttribute('aria-current', String(!showingLayout));
  $('viewer').hidden = showingLayout || !active;
  $('empty').hidden = showingLayout || Boolean(active);
  $('header-open').hidden = showingLayout || !active;
  updateViewHeading();
  updateFileNotice();
  updateSharedGateStatus();
}

function updateViewHeading() {
  const title = layouts.name
    ? `${layouts.folderName} / ${layouts.name}`
    : activeGroup ? groupName(activeGroup) : active?.name || 'Flow Cytometry';
  $('file-title').textContent = title;
}

function updateFileNotice() {
  const messages = [];
  if (active?.hasMore) messages.push('Only the first dataset is shown.');
  const compensation = active?.compensation;
  if (compensation?.applied) messages.push(`Applied ${compensation.keyword} compensation (${compensation.channels} channels).`);
  else if (compensation) messages.push(`${compensation.message} Showing recorded values (${compensation.keyword}).`);
  const notice = $('file-notice');
  notice.textContent = messages.join('\n');
  notice.hidden = Boolean(layouts.name) || messages.length === 0;
}

function updateSharedGateStatus() {
  const status = $('shared-gate-status');
  const errors = active ? [...active.gateErrors.values()] : [];
  status.textContent = errors.map(({ definition, message }) => `${definition.name}: ${message}`).join('\n');
  status.hidden = Boolean(layouts.name) || errors.length === 0;
}

function updateChannelLabels(scope) {
  if (active?.scope !== scope) return;
  const labels = channelLabels(active);
  axisControls.setLabels(labels);
  plot.setChannelLabels(labels);
  scatterPlot.setChannelLabels(labels);
}

const axisControls = createAxisControls((key, axis) => {
  const view = currentView();
  if (!view) return;
  setPlotAxis(active, view, plotType(active, view), gateAxesPreview, key, axis);
  void refreshPlot(active);
});

function syncPlotControls(sample, view) {
  const type = plotType(sample, view);
  const histogram = type === 'histogram';
  const scatter = type === 'scatter-3d';
  const density = !histogram && !scatter;
  $('show-density').setAttribute('aria-pressed', String(density));
  $('show-histogram').setAttribute('aria-pressed', String(histogram));
  const scatterButton = $('show-scatter-3d');
  scatterButton.setAttribute('aria-pressed', String(scatter));
  scatterButton.disabled = sample.channels.length < 3;
  scatterButton.title = scatterButton.disabled ? '3D scatter requires at least three channels' : '';
  $('plot-title').textContent = scatter ? '3D scatter' : histogram ? 'Histogram' : 'Event density';
  $('axes-title').textContent = histogram ? 'Histogram settings' : 'Axes';
  $('gate-tools').hidden = !density;
  $('density-footer').hidden = !density;
  $('chart').hidden = scatter;
  $('scatter-chart').hidden = !scatter;
  $('scatter-footer').hidden = !scatter;
  $('folder-axis-scope').hidden = !sample.folder;
  $('folder-axis-note').textContent = gateAxesPreview ? 'Showing this gate’s axes.' : 'Axes and scales are shared across this folder.';
  $('restore-folder-axes').hidden = !gateAxesPreview;
  axisControls.show(axesForPlot(sample, view, type, gateAxesPreview), channelLabels(sample), type, plotSettings(sample, view));
}

function setPlotType(type) {
  const view = currentView();
  if (!view || (!gateAxesPreview && plotType(active, view) === type)) return;
  if (type === 'scatter-3d' && active.channels.length < 3) return;
  gateAxesPreview = null;
  ensurePlotSettings(active, view, type);
  plotSettings(active, view).plotType = type;
  syncPlotControls(active, view);
  void refreshPlot(active, view);
}

$('show-density').addEventListener('click', () => setPlotType('density'));
$('show-histogram').addEventListener('click', () => setPlotType('histogram'));
$('show-scatter-3d').addEventListener('click', () => setPlotType('scatter-3d'));
$('restore-folder-axes').addEventListener('click', () => {
  gateAxesPreview = null;
  syncPlotControls(active, currentView());
  void refreshPlot(active);
});
axisControls.bins.addEventListener('change', () => {
  const view = currentView();
  if (!view || plotType(active, view) !== 'histogram') return;
  plotSettings(active, view).histogram.binCount = Number(axisControls.bins.value);
  void refreshPlot(active, view);
});
axisControls.smoothing.addEventListener('change', () => {
  const view = currentView();
  if (!view || plotType(active, view) !== 'histogram') return;
  const histogram = plotSettings(active, view).histogram;
  histogram.smoothing = Number(axisControls.smoothing.value);
  plot.setHistogramSmoothing(histogram.smoothing);
});
$('edit-histogram-overlay').addEventListener('click', () => {
  const view = currentView();
  if (view && plotType(active, view) === 'histogram') {
    histogramOverlay.open(active, view, axesForPlot(active, view, 'histogram').x);
  }
});

function refreshHistogramOverlay(change) {
  const view = currentView();
  if (view && plotType(active, view) === 'histogram' && histogramOverlay.includes(view, change)) {
    void refreshPlot(active, view);
  }
}

async function refreshPlot(sample, view = currentView()) {
  const preview = gateAxesPreview;
  const type = plotType(sample, view);
  const settings = plotSettings(sample, view);
  const histogram = type === 'histogram';
  const scatter = type === 'scatter-3d';
  const surface = scatter ? scatterPlot : plot;
  gateDrawing.cancel();
  const version = ++plotVersion;
  view.rendered = null;
  layouts.setPlotReady(false);
  plot.clear();
  scatterPlot.clear();
  histogramOverlay.clear();
  surface.message('Plotting events…');
  gateDrawing.setAvailable(false);
  try {
    const action = scatter ? 'scatter-3d' : histogram ? 'histogram' : 'plot';
    const axes = axesForPlot(sample, view, type, preview);
    const missing = Object.entries(axes).filter(([, axis]) => axis.channel < 0);
    if (missing.length) {
      const labels = missing.map(([key, axis]) => `${key.toUpperCase()} (${channelLabel(axis.detector, sample.folder.aliases)})`);
      throw new Error(`Unavailable axes in this file: ${labels.join(', ')}. Select a channel to update the folder axes.`);
    }
    const folderIds = sample.folder && !preview
      ? [...rail.listSamples()].filter(member => member.folder === sample.folder).map(member => member.id)
      : undefined;
    const comparison = histogram ? histogramOverlay.prepare(sample, view, axes.x) : null;
    const result = await analyze(action, sample.id, {
      axes, group: groupReference(view), binCount: settings.histogram?.binCount, folderIds,
      comparisons: comparison?.comparisons
    });
    if (currentView() !== view || version !== plotVersion) return;
    const { x, y, z, visible } = result;
    storePlotAxes(sample, view, type, preview, result);
    if (!histogram && !scatter) view.rendered = { x, y };
    axisControls.update(result);
    if (scatter) {
      const axes = [x, y, z];
      scatterPlot.show(result, axes, channelLabels(sample), settings.scatter.camera);
      scatterPlot.message(visible ? '' : 'No events in the current axis ranges.');
    } else {
      plot.show(result, channelLabels(sample), settings.histogram?.smoothing, comparison?.normalization);
      if (comparison) histogramOverlay.show(comparison, result);
      plot.gates(view.gates, view.selectedGate);
    }
    gateDrawing.setAvailable(!histogram && !scatter && visible > 0);
    layouts.setPlotReady(true);
  } catch (error) {
    if (currentView() !== view || version !== plotVersion) return;
    surface.message(error.message);
  }
}

function showGate(sample, view, gate) {
  view.selectedGate = gate.id;
  const axes = { x: { ...gate.x }, y: { ...gate.y } };
  if (sample.folder) gateAxesPreview = axes;
  else {
    view.plotType = 'density';
    view.axes = axes;
  }
  syncPlotControls(sample, view);
  void refreshPlot(sample, view);
}

const hikari = window.HikariPlugin?.hikari;
let folded = false;
function applyRail(layout) {
  if (!layout) return;
  if (Number.isFinite(layout.width)) document.documentElement.style.setProperty('--rail-width', `${layout.width}px`);
  if (typeof layout.folded !== 'boolean') return;
  folded = layout.folded;
  if (folded && $('file-rail').contains(document.activeElement)) $('file-title').focus();
  $('file-rail').hidden = folded;
  $('layout').classList.toggle('is-folded', folded);
  $('toggle-rail').setAttribute('aria-expanded', String(!folded));
  $('toggle-rail').setAttribute('aria-label', folded ? 'Show file rail' : 'Hide file rail');
}
function applyContext({ appearance, layout }) {
  if (appearance?.mode) {
    document.body.classList.toggle('theme-night', appearance.mode === 'night');
    document.body.classList.toggle('theme-miku', appearance.mode === 'miku');
  }
  if (Number.isFinite(appearance?.fontSize)) {
    document.documentElement.style.setProperty('--app-font-size', `${appearance.fontSize}px`);
  }
  applyRail(layout?.leftRail);
}
$('toggle-rail').addEventListener('click', () => applyRail({ folded: !folded }));
hikari?.on('app.context', applyContext);
hikari?.call('app.info').then(async info => {
  applyContext(info);
  layouts.setDownloadPermission(info.permissions?.includes('downloads') ?? false);
  if (!info.layout?.leftRail?.headerToggleAvailable) return;
  const result = await hikari.call('app.setLeftRail', { available: true });
  if (result.mounted) {
    applyRail(result.leftRail);
    $('toggle-rail').hidden = true;
  }
}).catch(() => {});
