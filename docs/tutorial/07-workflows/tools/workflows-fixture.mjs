// Real Workflows renderer with fictional records and local preview adapters.
// Never opens a research workspace: the storage path is a label, and every
// desktop call below answers from memory.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initWorkflowManagement } from '../../../../src/renderer/modules/workflow/index.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { VIEWS, TITLES } from '../../../../src/renderer/modules/views.js';
import { createNavigationShell } from '../../../../src/renderer/app/navigation-shell.js';
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
state.settings.storagePath = '/Tutorial workspace';
state.settings.plugins = [];
state.projects = [
  { id: 'demo-stability', name: 'Protein stability · tutorial', description: '', createdAt: iso(20), updatedAt: iso(2) },
  { id: 'demo-plasmid', name: 'Plasmid prep · tutorial', description: '', createdAt: iso(15), updatedAt: iso(6) }
];
const ph = (id, name) => ({ id, name });
const protocol = (id, name, steps) => ({ id, name, purpose: 'Fictional teaching protocol.', materials: [], troubleshooting: '', createdAt: iso(30), updatedAt: iso(30),
  steps: steps.map(([text, placeholders = []], index) => ({ id: `${id}-s${index + 1}`, text, placeholders })) });
state.protocols = [
  protocol('demo-expression', 'Protein expression · example', [['Grow {{ph:e-strain}} at {{ph:e-temp}}.', [ph('e-strain', 'strain'), ph('e-temp', 'temperature')]], ['Harvest the cells.']]),
  protocol('demo-purification', 'Purification · example', [['Load the lysate onto {{ph:p-column}}.', [ph('p-column', 'column')]], ['Elute with {{ph:p-buffer}}.', [ph('p-buffer', 'elution buffer')]]]),
  protocol('demo-buffer-check', 'Buffer exchange check', [['Dilute into {{ph:b-buffer}}.', [ph('b-buffer', 'buffer')]], ['Record the appearance of each tube.']]),
  protocol('demo-gel', 'Gel check · example', [['Run a {{ph:g-percent}} gel.', [ph('g-percent', 'gel percentage')]]]),
  protocol('demo-miniprep', 'Plasmid miniprep · example', [['Inoculate {{ph:m-plasmid}}.', [ph('m-plasmid', 'plasmid')]], ['Follow the kit instructions.']])
];
// Main path left to right; the gel check hangs below purification as an optional branch.
const block = (id, x, y, fields) => ({ id, x, y, assigneeId: '', type: fields.text ? 'text' : 'protocol', protocolId: '', text: '', ...fields });
state.workflowTemplates = [
  { id: 'demo-template-protein', name: 'Protein prep · tutorial', description: 'Fictional teaching template: express, purify, and check a model protein.',
    projectId: '', createdAt: iso(14), updatedAt: iso(14),
    blocks: [
      block('t-express', 40, 40, { protocolId: 'demo-expression' }),
      block('t-purify', 340, 40, { protocolId: 'demo-purification' }),
      block('t-check', 640, 40, { protocolId: 'demo-buffer-check' }),
      block('t-freeze', 940, 40, { text: 'Freeze aliquots at -80 °C and record them in Samples.' }),
      block('t-gel', 640, 220, { protocolId: 'demo-gel' })
    ],
    links: [
      { id: 'l1', fromBlockId: 't-express', toBlockId: 't-purify' },
      { id: 'l2', fromBlockId: 't-purify', toBlockId: 't-check' },
      { id: 'l3', fromBlockId: 't-check', toBlockId: 't-freeze' },
      { id: 'l4', fromBlockId: 't-purify', toBlockId: 't-gel' }
    ] },
  { id: 'demo-template-plasmid', name: 'Plasmid prep · tutorial', description: 'Fictional teaching template.', projectId: '', createdAt: iso(10), updatedAt: iso(10),
    blocks: [block('p-mini', 40, 40, { protocolId: 'demo-miniprep' }), block('p-seq', 340, 40, { text: 'Send the plasmid for sequencing.' })],
    links: [{ id: 'pl1', fromBlockId: 'p-mini', toBlockId: 'p-seq' }] }
];

let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('workflows-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  ensureStorageDirectory: async () => ({ ok: true }),
  storeImportedFile: async ({ targetFolder, fileName }) => {
    calls.push({ kind: 'store', fileName });
    return { ok: true, fileName, filePath: `${targetFolder}/${fileName}`, relativePath: `ResultFiles/${fileName}` };
  },
  reportError: ({ message }) => { calls.push({ kind: 'error', message }); }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const workflows = initWorkflowManagement({ state, persist, createId: () => crypto.randomUUID(), safeText,
  onOpenNotebookEntry: entryId => calls.push({ kind: 'open-notebook', entryId }),
  onCreateLinkedAssay: request => calls.push({ kind: 'assay', ...request }) });

// Three example processes at different stages, made the way New process makes them.
const done = days => ({ status: 'completed', completedAt: iso(days), updatedAt: iso(days) });
const process = (name, projectId, days, steps) => {
  const record = workflows.createProcess({ templateId: 'demo-template-protein', projectId, workflowName: name });
  record.createdAt = iso(days);
  record.updatedAt = iso(Math.max(0, days - 2));
  steps(record.blocks.map(item => item.id), record.entries[0].stepStates);
};
process('Protein prep · buffer A', 'demo-stability', 9, ([express, purify, check, freeze], steps) => {
  Object.assign(steps, { [express]: done(8), [purify]: done(6), [check]: done(4), [freeze]: done(3) });
});
process('Protein prep · buffer B', 'demo-stability', 4, ([express], steps) => {
  Object.assign(steps, { [express]: done(2) });
});
process('Protein prep · repeat', '', 3, ([express], steps) => {
  Object.assign(steps, { [express]: { status: 'failed', completedAt: '', updatedAt: iso(1), result: 'Example note: no growth overnight.' } });
});
workflows.openProcess(state.workflows[1].id);

const shell = createNavigationShell({ VIEWS, TITLES, APP_DOCK_ORDER, APP_REGISTRY, navigationViewAliases: [],
  moduleRuntime: { renderView: viewId => { if (viewId === VIEWS.WORKFLOW_MANAGEMENT) workflows.render(); } },
  sharedLeftRailRuntime: { ensureHandles() {}, syncWidth() {} },
  executeTopbarSearch() {}, getSearchSuggestions: () => [], applySearchSuggestion: () => false });
shell.initNavigation();
shell.showView(VIEWS.WORKFLOW_MANAGEMENT);
window.tutorial = { state, workflows, calls, get writes() { return writes; } };
window.tutorialReady = true;
