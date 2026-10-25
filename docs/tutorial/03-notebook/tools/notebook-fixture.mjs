// Real Notebook renderer with fictional records and local preview adapters.
// Never opens a research workspace: the storage path is a label, and every
// desktop call below answers from memory.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initLabNotebook } from '../../../../src/renderer/modules/biology-notebook/index.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../../src/renderer/app/navigation-shell/app-dock.js';
import { applyAppearanceToDocument } from '../../../../src/renderer/app/appearance.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-24T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const iso = (days, minutes = 0) => new Date(fixedNow - days * 86400000 - minutes * 60000).toISOString();
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const state = structuredClone(defaultState);
state.settings.storagePath = '/Tutorial workspace';
state.settings.plugins = [];
state.workflows = [];
state.workflowTemplates = [];
state.assays = [];
state.gelAnalyses = [];
state.papers = [];
state.projects = [
  { id: 'demo-stability', name: 'Protein stability · tutorial', description: 'Fictional teaching project: compare two buffers for a model protein.', createdAt: iso(12), updatedAt: iso(2) },
  { id: 'demo-plasmid', name: 'Plasmid prep · tutorial', description: '', createdAt: iso(9), updatedAt: iso(6) }
];
const ph = (id, name) => ({ id, name });
const step = (id, text, placeholders = []) => ({ id, text, placeholders });
state.protocols = [
  { id: 'demo-buffer-check', name: 'Buffer exchange check', purpose: 'Compare how a model protein looks after dilution into two buffers.',
    materials: ['Model protein', 'Buffer A', 'Buffer B'], troubleshooting: '', createdAt: iso(12), updatedAt: iso(12),
    steps: [
      step('b1', 'Thaw {{ph:b-protein}} on ice.', [ph('b-protein', 'protein')]),
      step('b2', 'Dilute to {{ph:b-conc}} in {{ph:b-buffer}}.', [ph('b-conc', 'concentration'), ph('b-buffer', 'buffer')]),
      step('b3', 'Incubate at {{ph:b-temp}} for {{ph:b-time}}.', [ph('b-temp', 'temperature'), ph('b-time', 'time')]),
      step('b4', 'Record the appearance of each tube.')
    ] },
  { id: 'demo-miniprep', name: 'Plasmid miniprep · example', purpose: 'Teaching outline of a plasmid preparation.',
    materials: ['Culture tube', 'Miniprep kit'], troubleshooting: '', createdAt: iso(9), updatedAt: iso(9),
    steps: [
      step('m1', 'Inoculate {{ph:m-plasmid}} into {{ph:m-volume}} of medium.', [ph('m-plasmid', 'plasmid'), ph('m-volume', 'volume')]),
      step('m2', 'Follow the kit instructions and record the yield.')
    ] },
  { id: 'demo-labels', name: 'Sample labeling checklist', purpose: 'Label tubes and check them against a sample list.',
    materials: ['Labels', 'Sample list'], troubleshooting: '', createdAt: iso(8), updatedAt: iso(8),
    steps: [step('l1', 'Label each tube with {{ph:l-id}}.', [ph('l-id', 'sample ID')]), step('l2', 'Check every label against the list.')] }
];
const page = (id, project, protocol, fields) => ({
  id, notebookType: 'biology', projectId: project.id, projectName: project.name,
  protocolId: protocol.id, protocolName: protocol.name, protocolSnapshot: structuredClone(protocol),
  values: {}, result: '', resultTables: [], resultTable: null, toolCalculations: [], sampleLinks: [],
  resultFiles: [], resultFileRecords: [], storageFolder: '', agentDraftStatus: '', agentDraftMeta: {}, selectionInsights: [],
  ...fields
});
const [stability, plasmid] = state.projects;
const [bufferCheck, miniprep] = state.protocols;
const bufferValues = buffer => ({ 'b-protein': 'Model protein A', 'b-conc': '1 mg/mL', 'b-buffer': buffer, 'b-temp': '4 °C', 'b-time': '30 min' });
state.notebookEntries = [
  page('demo-run-a', stability, bufferCheck, { experimentName: 'Buffer A pilot', values: bufferValues('Buffer A'),
    result: 'Fictional teaching note: the tube stayed clear after mixing.', notebookState: 'executed',
    createdAt: iso(4), executedAt: iso(4, -60), updatedAt: iso(4, -60) }),
  page('demo-run-b', stability, bufferCheck, { experimentName: 'Buffer B pilot', values: bufferValues('Buffer B'),
    result: 'Fictional teaching note: slight haze after 30 min.', notebookState: 'executed',
    createdAt: iso(3), executedAt: iso(3, -45), updatedAt: iso(3, -45) }),
  page('demo-run-repeat', stability, bufferCheck, { experimentName: 'Buffer B repeat', values: { 'b-buffer': 'Buffer B' },
    notebookState: 'planned', createdAt: iso(1), executedAt: '', updatedAt: iso(1) }),
  page('demo-suggested', stability, bufferCheck, { experimentName: 'Buffer B, longer incubation', values: { 'b-buffer': 'Buffer B', 'b-temp': '4 °C', 'b-time': '2 h' },
    result: 'Illustrative suggestion: repeat Buffer B with a 2 h incubation.', notebookState: 'suggested',
    agentDraftMeta: { source: 'experiment_suggestion', rationale: 'Illustrative example: tests whether a longer incubation changes the haze seen with Buffer B.' },
    createdAt: iso(0, 90), executedAt: '', updatedAt: iso(0, 90) }),
  page('demo-suggested-2', stability, bufferCheck, { experimentName: 'Buffer A, longer incubation', values: { 'b-buffer': 'Buffer A', 'b-temp': '4 °C', 'b-time': '2 h' },
    result: 'Illustrative suggestion: the matching Buffer A control.', notebookState: 'suggested',
    agentDraftMeta: { source: 'experiment_suggestion', rationale: 'Illustrative example: the control for the Buffer B suggestion.' },
    createdAt: iso(0, 90), executedAt: '', updatedAt: iso(0, 91) }),
  page('demo-miniprep-1', plasmid, miniprep, { experimentName: 'Miniprep pilot', values: { 'm-plasmid': 'Example plasmid', 'm-volume': '5 mL' },
    result: 'Fictional teaching note.', notebookState: 'executed', createdAt: iso(6), executedAt: iso(6, -30), updatedAt: iso(6, -30) })
];
state.inventory['-80 Degree'] = [{ id: 'demo-box', name: 'Tutorial box 1', type: 'box25', wells: [] }];
state.samples = [{ id: 'demo-protein-a', code: 'PRT-001', name: 'Model protein A', type: 'protein', lot: '', concentration: '2 mg/mL', notes: '',
  location: '-80 Degree · Tutorial box 1 · A1', inventoryLink: { section: '-80 Degree', containerId: 'demo-box', wellIndex: 0 },
  chemicalLinks: [], cellPassage: null, updatedAt: iso(5) }];

let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('notebook-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  ensureStorageDirectory: async () => ({ ok: true }),
  storeImportedFile: async ({ targetFolder, fileName }) => {
    calls.push({ kind: 'store', fileName });
    return { ok: true, fileName, filePath: `${targetFolder}/${fileName}`, relativePath: `ResultFiles/${fileName}` };
  },
  readFileBase64: async () => ({ ok: false, error: 'Documentation preview: no files are read.' }),
  listPaperFindingTasks: async () => ({ ok: true, tasks: [] }),
  reportError: ({ message }) => { calls.push({ kind: 'error', message }); }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean),
    ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => 'biology-notebook-view', getAppForView: id => APP_REGISTRY.find(app => app.viewId === id), resolveNavigationViewId: id => id
});
dock.renderAppNavigation('biology-notebook-view');
dock.syncNavigationState('biology-notebook-view');
const controller = initLabNotebook({ state, persist, createId: () => crypto.randomUUID(), safeText, notebookType: 'biology',
  onCreateLinkedAssay: request => calls.push({ kind: 'assay', ...request }),
  onCreateLinkedGel: request => calls.push({ kind: 'gel', ...request }),
  onProjectsChanged() {}, onNotebookEntriesChanged() {} });
controller.renderProjectOptions();
controller.renderProtocolOptions();
controller.renderEntries();
window.tutorial = { state, controller, calls, get writes() { return writes; } };
window.tutorialReady = true;
