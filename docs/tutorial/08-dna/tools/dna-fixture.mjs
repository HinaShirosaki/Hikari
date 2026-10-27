// Real DNA renderer; example sequences and desktop storage stay in memory.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initSequenceViewer } from '../../../../src/renderer/modules/sequence-viewer/index.js';
import { buildRecordGenbankText } from '../../../../src/renderer/modules/sequence-viewer/storage.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../../src/renderer/app/navigation-shell/app-dock.js';
import { applyAppearanceToDocument } from '../../../../src/renderer/app/appearance.js';

const fixedNow = new Date('2026-10-25T10:30:00-05:00').getTime();
const iso = days => new Date(fixedNow - days * 86400000).toISOString();
const state = structuredClone(defaultState);
state.settings.storagePath = '/Tutorial workspace';
state.settings.plugins = [];
state.projects = [{ id: 'demo-project', name: 'DNA practice · example' }];
state.protocols = [];
state.notebookEntries = [];
state.primerLibrary = [];
let seed = 7261;
const randomDna = length => Array.from({ length }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return 'ACGT'[seed >>> 30]; }).join('');
const coding = 'ATG' + 'GCTGGTGAACTGAAACAG'.repeat(22) + 'TAA';
const sequence = randomDna(180) + coding + randomDna(620);
const record = { name: 'Teaching vector · example', sequence, topology: 'circular', sourceFormat: 'genbank',
  features: [
    { id: 'demo-promoter', name: 'Example promoter', type: 'promoter', strand: 1, segments: [{ start: 40, end: 140 }] },
    { id: 'demo-cds', name: 'Teaching CDS', type: 'CDS', strand: 1, segments: [{ start: 180, end: 180 + coding.length }] },
    { id: 'demo-marker', name: 'Reference region', type: 'misc_feature', strand: -1, segments: [{ start: 820, end: 1050 }] },
    { id: 'demo-primer', name: 'Teaching F', type: 'primer_bind', strand: 1, primerSequence: sequence.slice(20, 44), segments: [{ start: 20, end: 44 }] },
    { id: 'demo-primer-r', name: 'Teaching R', type: 'primer_bind', strand: -1, segments: [{ start: 700, end: 724 }] }
  ] };
const entries = new Map();
const folders = [{ id: 'demo-folder', name: 'Teaching sequences', createdAt: iso(4), updatedAt: iso(1) }];
function addRecord(id, value, status = 'saved', folderId = 'demo-folder') {
  const entry = { id, name: value.name, status, folderId, topology: value.topology, sequenceLength: value.sequence.length,
    featureCount: value.features?.length || 0, sourceFormat: 'genbank', createdAt: iso(4), updatedAt: iso(1) };
  entries.set(id, { entry, gbkText: buildRecordGenbankText(value), alignments: [] });
}
addRecord('demo-vector', record);
addRecord('demo-linear', { name: 'Practice fragment · example', topology: 'linear', sequence: sequence.slice(150, 780), features: [] });
addRecord('demo-draft', { name: 'Draft fragment · example', topology: 'linear', sequence: sequence.slice(0, 210), features: [] }, 'temporary', '');
let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('dna-tutorial-preview', JSON.stringify(state)); };
const clone = value => structuredClone(value);
const bridge = {
  sequenceLibraryList: async ({ status }) => ({ ok: true, entries: [...entries.values()].filter(v => !status || v.entry.status === status).map(v => clone(v.entry)), folders: clone(folders) }),
  sequenceLibraryGet: async ({ id }) => entries.has(id) ? { ok: true, ...clone(entries.get(id)) } : { ok: false, error: 'Example entry not found.' },
  sequenceLibraryUpsert: async request => {
    const id = request.id || crypto.randomUUID();
    const previous = entries.get(id);
    const entry = { ...previous?.entry, id, name: request.name, status: request.status, topology: request.topology,
      sequenceLength: request.sequenceLength, featureCount: request.featureCount, sourceFormat: request.sourceFormat,
      folderId: previous?.entry.folderId || '', createdAt: previous?.entry.createdAt || iso(0), updatedAt: iso(0) };
    const value = { entry, gbkText: request.gbkText, alignments: request.alignmentSessions || previous?.alignments || [] };
    entries.set(id, value); calls.push({ kind: 'save', name: entry.name, status: entry.status });
    return { ok: true, ...clone(value) };
  },
  sequenceLibraryUpsertFolder: async ({ id, name }) => {
    let folder = folders.find(item => item.id === id);
    if (folder) folder.name = name; else { folder = { id: id || crypto.randomUUID(), name }; folders.push(folder); }
    return { ok: true, folder: clone(folder) };
  },
  sequenceLibraryMoveEntry: async ({ id, entryId, folderId }) => { const value = entries.get(id || entryId); if (value) value.entry.folderId = folderId; return { ok: true, entry: clone(value?.entry) }; },
  sequenceLibraryDeleteFolder: async ({ id }) => { const i = folders.findIndex(item => item.id === id); if (i >= 0) folders.splice(i, 1); for (const v of entries.values()) if (v.entry.folderId === id) v.entry.folderId = ''; return { ok: true }; },
  sequenceLibrarySearchFeatures: async () => ({ ok: true, features: [], matches: [] }),
  sequenceLibraryAnnotate: async () => ({ ok: true, dnaMatches: [], proteinMatches: [] }),
  writeTextToClipboard: async text => { window.tutorialCopied = text; return { ok: true }; },
  reportError: request => calls.push({ kind: 'error', ...request })
};
window.hikariApi = bridge;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.tutorialCopied = text; } } });
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const homeId = 'sequence-viewer-view', detailId = 'sequence-viewer-detail-view';
function show(id) {
  document.querySelectorAll('.view').forEach(el => { el.classList.toggle('is-active', el.id === id); el.hidden = el.id !== id; });
  document.body.dataset.activeView = id;
}
const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean), ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => homeId, getAppForView: id => APP_REGISTRY.find(app => app.viewId === id), resolveNavigationViewId: id => id === detailId ? homeId : id
});
dock.renderAppNavigation(homeId); dock.syncNavigationState(homeId);
const viewer = initSequenceViewer({ document, state, persist, createId: () => crypto.randomUUID(), apiBridge: bridge,
  getStoragePath: () => state.settings.storagePath, homeViewId: homeId, detailViewId: detailId,
  onNavigateHome: () => show(homeId), onNavigateDetail: () => show(detailId),
  ensureProjectRecord: name => { const project = { id: crypto.randomUUID(), name }; state.projects.push(project); return project; },
  saveProtocolRecord: protocol => { state.protocols.push(protocol); return protocol; }, onNotebookEntriesChanged() {} });
document.querySelector(`[data-view="${homeId}"]`)?.addEventListener('click', () => { show(homeId); viewer.render({ activeViewId: homeId }); });
document.getElementById('app-more-btn').addEventListener('click', () => dock.toggleMoreMenu());
show(homeId); viewer.render({ activeViewId: homeId });
const host = () => document.getElementById('sequence-viewer-sequence-host');
window.tutorial = { state, viewer, entries, folders, calls, record, sequence, bridge, show, get writes() { return writes; },
  readSequence: () => [...host().querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')].map(el => el.textContent).join(''),
  home: () => { show(homeId); viewer.render({ activeViewId: homeId }); },
  cursor: boundary => { const el = host().querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')[boundary]; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.top + 2 })); }
};
window.tutorial.select = (start, end) => {
  const base = index => host().querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')[index];
  const fire = (index, type, buttons) => { const el = base(index), r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: r.left + 1, clientY: r.top + r.height / 2 })); };
  fire(start, 'mousedown', 1); fire(end, 'mousemove', 1);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));
};
window.tutorialReady = true;
