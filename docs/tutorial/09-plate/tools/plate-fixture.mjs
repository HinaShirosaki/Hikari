// Real Plate renderer. All records and desktop storage operations stay in this preview.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initAssay } from '../../../../src/renderer/modules/assay/index.js';
import { parseCsvLine } from '../../../../src/renderer/modules/assay/shared.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../../src/renderer/app/navigation-shell/app-dock.js';
import { applyAppearanceToDocument } from '../../../../src/renderer/app/appearance.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-25T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const iso = days => new Date(fixedNow - days * 86400000).toISOString();
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const state = structuredClone(defaultState);
state.settings.storagePath = '/Tutorial workspace';
state.settings.plugins = [];
state.projects = [{ id: 'demo-project', name: 'Plate practice · example', createdAt: iso(5), updatedAt: iso(0) }];
state.notebookEntries = [];
state.samples = [
  { id: 'sample-a', sampleId: 'Sample A', name: 'Sample A', type: 'chemical', concentration: '1000 uM' },
  { id: 'sample-b', sampleId: 'Sample B', name: 'Sample B', type: 'chemical', concentration: '1000 uM' }
];
const concentrations = ['100', '50', '25', '12.5', '6.25', '3.125'];
const layout = [], results = {}, matrix = [];
for (let row = 0; row < 4; row++) {
  const values = [];
  for (let col = 0; col < 6; col++) {
    const well = String.fromCharCode(65 + row) + (col + 1);
    layout.push({ well, sampleId: row < 2 ? 'Sample A' : 'Sample B', concentration: concentrations[col] });
    const value = (row < 2 ? [4, 8, 18, 40, 70, 92] : [7, 15, 30, 55, 82, 104])[col] + (row % 2 ? 1 : -1);
    results[well] = String(value); values.push(String(value));
  }
  matrix.push(values);
}
state.assays = [{ id: 'demo-plate', assayNumber: 'A0001', name: 'Signal comparison · example', projectId: 'demo-project', projectName: state.projects[0].name,
  plateType: '24', sampleAxis: 'row', concentrationAxis: 'column', concentrationUnit: 'uM',
  sampleAxisValues: ['Sample A', 'Sample A', 'Sample B', 'Sample B'], concentrationAxisValues: concentrations,
  wellLayout: layout, resultValues: results, resultAttachments: [], notes: 'Fictional values for learning the interface.', createdAt: iso(2), updatedAt: iso(0) }];
let writes = 0, pendingPlot = Promise.resolve();
const calls = [];
const persist = () => { writes++; localStorage.setItem('plate-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  ensureStorageDirectory: async () => ({ ok: true }),
  writeJsonFile: async request => { calls.push({ kind: 'write-json', fileName: request.fileName }); return { ok: true }; },
  storeImportedFile: async request => {
    calls.push({ kind: 'store-file', fileName: request.fileName });
    return { ok: true, fileName: request.fileName, filePath: `${request.targetFolder}/${request.fileName}`, relativePath: `ResultFiles/${request.fileName}` };
  },
  parseAssayResultImportFile: async ({ fileName, dataBase64 }) => {
    const rows = atob(dataBase64).split(/\r?\n/).filter(line => line.trim()).map(parseCsvLine);
    calls.push({ kind: 'parse-import', fileName });
    return { ok: true, tables: [{ name: fileName, rows }] };
  },
  reportError: request => calls.push({ kind: 'error', ...request })
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const realReact = Plotly.react.bind(Plotly);
Plotly.react = (...args) => { pendingPlot = realReact(...args); return pendingPlot; };
const assay = initAssay({ state, persist, createId: () => crypto.randomUUID(), safeText, onAssaysChanged() {} });
const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean), ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => 'assay-view', getAppForView: id => APP_REGISTRY.find(app => app.viewId === id), resolveNavigationViewId: id => id
});
dock.renderAppNavigation('assay-view'); dock.syncNavigationState('assay-view');
document.getElementById('app-more-btn').addEventListener('click', () => dock.toggleMoreMenu());
document.getElementById('assay-view').classList.add('is-active');
assay.render();
document.getElementById('assay-browser-panel').open = true;
const matrixCsv = ['Result matrix 1', ',1,2,3,4,5,6', ...matrix.map((row, i) => String.fromCharCode(65 + i) + ',' + row.join(',')),
  '', 'Result matrix 2', ',1,2,3,4,5,6', ...matrix.map((row, i) => String.fromCharCode(65 + i) + ',' + row.map(value => Number(value) + 20).join(','))].join('\n') + '\n';
const layoutCsv = 'well,row,column,sample_id,concentration\n' + layout.map(item => `${item.well},${item.well[0]},${item.well.slice(1)},${item.sampleId},${item.concentration} uM`).join('\n') + '\n';
window.tutorial = { state, assay, calls, layout, results, matrix, matrixCsv, layoutCsv, get writes() { return writes; }, readyPlot: () => pendingPlot,
  grid: () => { const host=document.querySelector('#assay-result-table .tabulator'); return host ? Tabulator.findTable(host)[0] : null; },
  transformedGrid: () => { const host=document.querySelector('#assay-derived-plate-table .tabulator'); return host ? Tabulator.findTable(host)[0] : null; },
  activeAssay: () => state.assays.find(item => item.id === document.getElementById('assay-results-assay-select').value) };
window.tutorialReady = true;
