// Real Papers renderer with fictional records and local preview adapters.
// Never opens a research workspace: the storage path is a label, stored files
// live in memory, and the only PDF is the fictional example paper.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initPapersManagement } from '../../../../src/renderer/modules/papers/index.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../../src/renderer/app/navigation-shell/app-dock.js';
import { createAgentChatRail } from '../../../../src/renderer/app/navigation-shell/agent-rail.js';
import { applyAppearanceToDocument } from '../../../../src/renderer/app/appearance.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-24T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const iso = days => new Date(fixedNow - days * 86400000).toISOString();
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const root = '/Tutorial workspace';
const state = structuredClone(defaultState);
state.settings.storagePath = root;
state.settings.plugins = [];
state.settings.personalInfo.name = 'Tutorial reader';
state.projects = [
  { id: 'demo-stability', name: 'Protein stability · tutorial', createdAt: iso(12), updatedAt: iso(2) },
  { id: 'demo-plasmid', name: 'Plasmid prep · tutorial', createdAt: iso(9), updatedAt: iso(6) }
];
state.journalClubs = [{ id: 'demo-club', name: 'Journal club · tutorial', description: '' }];
const paper = (id, title, linkedType, linkedId, linkedName, days) => ({
  id, title, fileName: `${title}.pdf`, pdfDataUrl: '', storedFilePath: `${root}/Papers/${title}.pdf`, storedRelativePath: `Papers/${title}.pdf`,
  linkedType, linkedId, linkedName, summary: '', summaryStructured: null, summaryStatus: 'idle', methodsExtract: [], methodsStatus: 'idle',
  keyReagents: [], reagentsStatus: 'idle', keyFigures: [], highlights: [], comments: [], availabilityStatus: 'uploaded_pdf',
  ingestionStatus: 'uploaded', ingestionErrors: [], createdAt: iso(days), updatedAt: iso(days)
});
state.papers = [
  paper('demo-paper-storage', 'Example - storage temperature and aggregation', 'project', 'demo-stability', 'Protein stability · tutorial', 3),
  paper('demo-paper-yield', 'Example - plasmid yield from small cultures', 'project', 'demo-plasmid', 'Plasmid prep · tutorial', 8),
  paper('demo-paper-figure', 'Example - reading a stability figure', 'journal-club', 'demo-club', 'Journal club · tutorial', 15)
];
state.notebookEntries = [];
state.workflows = [];

// Illustrative saved analysis, read the same way as a real intake.json.
const knowledgeFolder = 'KnowledgeBase/papers.md/buffer-choice-example';
const brief = {
  one_sentence_summary: 'Illustrative brief: buffer A kept the model protein clear, while buffer B became hazy over time.',
  experiments: [
    { title: 'Buffer comparison', technique: 'Visual scoring of diluted protein against a dark background', variables: 'Buffer A or B; 30 min or 2 h at 4 °C',
      outcome: 'Buffer A stayed clear; buffer B became slightly hazy, then cloudy.', figure_ref: 'Table 1',
      evidence: 'Buffer A kept the protein solution clear at both time points.' }
  ],
  structure_outline: [
    { section: 'Methods', summary: 'Dilution to 1 mg/mL in each buffer, scored by two observers.' },
    { section: 'Discussion', summary: 'Suggests confirming the haze with absorbance at 340 nm.' }
  ],
  notable_claims: [{ section: 'Discussion', claim: 'Buffer B slowly destabilizes the model protein.' }]
};
const files = new Map();
const calls = [];
let finishIntake = () => {};
const decode = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
let writes = 0;
const persist = () => { writes++; localStorage.setItem('papers-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  discoverStoredPapers: async () => ({ ok: true, papers: [], journalClubs: [] }),
  storeImportedFile: async ({ targetFolder, fileName, dataBytes }) => {
    const filePath = `${targetFolder}/${fileName}`;
    files.set(filePath, new Uint8Array(dataBytes));
    calls.push({ kind: 'store', fileName });
    return { ok: true, fileName, filePath, relativePath: filePath.slice(root.length + 1) };
  },
  moveStoredFile: async ({ targetFolder, fileName }) => {
    calls.push({ kind: 'move', fileName });
    const filePath = `${targetFolder}/${fileName}`;
    return { ok: true, fileName, filePath, relativePath: filePath.slice(root.length + 1) };
  },
  // Intake waits for the capture script, so the Processing state can be shown.
  transformStoredPaperPdf: request => new Promise(resolve => {
    calls.push({ kind: 'intake', fileName: request.filePath.split('/').pop() });
    finishIntake = () => resolve({ ok: true, knowledgeStatus: 'ready',
      knowledgeMetaRelativePath: `${knowledgeFolder}/meta.json`, knowledgeMarkdownRelativePath: `${knowledgeFolder}/paper.md` });
  }),
  readFileBytes: async filePath => {
    if (filePath === `${root}/${knowledgeFolder}/intake.json`) return { ok: true, bytes: new TextEncoder().encode(JSON.stringify(brief)) };
    const stored = files.get(filePath) || (filePath.endsWith('.pdf') && window.tutorialPdfBase64 ? decode(window.tutorialPdfBase64) : null);
    // pdf.js transfers the buffer it is given, so every read returns a fresh copy, as IPC does.
    return stored ? { ok: true, bytes: stored.slice() } : { ok: false, error: 'ENOENT: documentation preview has no such file.' };
  },
  reportError: ({ message }) => { calls.push({ kind: 'error', message }); }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const getAppForView = id => APP_REGISTRY.find(app => app.viewId === id);
const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean),
    ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => 'papers-view', getAppForView, resolveNavigationViewId: id => id
});
dock.renderAppNavigation('papers-view');
dock.syncNavigationState('papers-view');
// The tool strip beside the PDF is the shell's agent rail, collapsed.
const rail = createAgentChatRail({ VIEWS: { PAPERS: 'papers-view' }, documentObject: document, getActiveViewId: () => 'papers-view',
  getAppForView, resolveNavigationViewId: id => id, moduleRuntime: {}, sharedLeftRailRuntime: { syncWidth() {} } });
rail.init();
rail.syncState('papers-view');
const controller = initPapersManagement({ state, persist, createId: () => crypto.randomUUID(), safeText, document, window,
  onCreateProtocolDraft() {},
  onAskSelectedText: selection => { calls.push({ kind: 'ask', text: selection.text }); return true; } });
controller.render();
window.tutorial = { state, controller, calls, finishIntake: () => finishIntake(), get writes() { return writes; } };
window.tutorialReady = true;
