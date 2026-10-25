// Real Protocols renderer with fictional records and local preview adapters.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initProtocolManagement } from '../../../../src/renderer/modules/protocol/index.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../../src/renderer/app/navigation-shell/app-dock.js';
import { applyAppearanceToDocument } from '../../../../src/renderer/app/appearance.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-24T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const iso = days => new Date(fixedNow - days * 86400000).toISOString();
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const state = structuredClone(defaultState);
state.settings.storagePath = '';
state.settings.plugins = [];
state.notebookEntries = [];
state.workflows = [];
state.workflowTemplates = [];
state.assays = [];
state.gelAnalyses = [];
const step = (id, text) => ({ id, text, placeholders: [] });
state.protocols = [
  { id: 'demo-labeling', name: 'Sample labeling checklist', purpose: 'Label sample tubes and verify them against the sample list.',
    materials: ['Sample tubes', 'Labels', 'Sample list'], steps: [step('label-1', 'Check the sample list.'), step('label-2', 'Label each tube with its sample ID.'), step('label-3', 'Verify that every tube matches the list.')],
    troubleshooting: 'If a label is unclear, replace it and check the sample ID again.', createdAt: iso(5), updatedAt: iso(3) },
  { id: 'demo-buffer', name: 'Buffer comparison worksheet', purpose: 'Record a planned comparison and its observations.',
    materials: ['Sample list', 'Notebook'], steps: [step('buffer-1', 'Record the sample IDs.'), step('buffer-2', 'Record each observation in the notebook.')],
    troubleshooting: 'Keep observations associated with the correct sample ID.', createdAt: iso(3), updatedAt: iso(2) },
  { id: 'demo-instrument', name: 'Instrument setup notes', purpose: 'Record the instrument identification and approved settings.',
    materials: ['Instrument checklist'], steps: [step('instrument-1', 'Record the instrument identification.'), step('instrument-2', 'Review the approved setup checklist.')],
    troubleshooting: 'Resolve missing setup information before continuing.', createdAt: iso(2), updatedAt: iso(1) }
];
const generated = { name: 'Sample labeling checklist · generated',
  purpose: 'Label sample tubes and verify every label against the sample list.',
  materials: ['Sample tubes', 'Labels', 'Sample list'],
  steps: ['Check the sample list before labeling.', 'Label each tube with [sample ID].', 'Verify that every label matches the sample list.'],
  troubleshooting: 'Replace any unclear label, then verify its sample ID against the list.' };
let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('protocol-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  agentGenerateProtocol: async request => { calls.push({ kind: 'generate', attachments: request.attachments.length }); return { ok: true, protocol: structuredClone(generated) }; },
  runDirectLlmPrompt: async request => {
    calls.push({ kind: 'polish', task: request.task });
    const lines = id => document.getElementById(id).value.split('\n').map(line => line.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean);
    return { ok: true, payload: {
      name: document.getElementById('protocol-name').value,
      purpose: 'Label sample tubes and verify each label against the sample list.',
      materials: lines('protocol-materials'),
      steps: lines('protocol-steps').map(text => text.replace('Check the sample list before labeling.', 'Verify the sample list before labeling.')),
      troubleshooting: 'Replace unclear labels and verify each sample ID against the list.'
    } };
  }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean),
    ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => 'protocol-management-view', getAppForView: id => APP_REGISTRY.find(app => app.viewId === id), resolveNavigationViewId: id => id
});
dock.renderAppNavigation('protocol-management-view');
dock.syncNavigationState('protocol-management-view');
document.getElementById('app-more-btn').addEventListener('click', () => dock.toggleMoreMenu());
const controller = initProtocolManagement({ state, persist, createId: () => crypto.randomUUID(), safeText,
  onProtocolsChanged() {}, __globals: { document, windowObject: window, hikariApi: window.hikariApi, FileReader } });
controller.renderList();
window.tutorial = { state, controller, calls, get writes() { return writes; } };
window.tutorialReady = true;
