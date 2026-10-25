// Real Samples renderer and top-bar search with fictional records and local
// preview adapters. Never opens a research workspace: the storage path is a
// label, and every desktop call below answers from memory.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initPersonalInventory } from '../../../../src/renderer/modules/personal-inventory/index.js';
import { createDefaultWells } from '../../../../src/renderer/lib/inventory-containers.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../../src/renderer/modules/app-registry.generated.js';
import { VIEWS, TITLES } from '../../../../src/renderer/modules/views.js';
import { createNavigationShell } from '../../../../src/renderer/app/navigation-shell.js';
import { createTopbarSearchController, buildSearchScopeMap, buildViewAliasMap } from '../../../../src/renderer/app/topbar-search.js';
import { createTopbarOpenItemHandlers } from '../../../../src/renderer/app/topbar-open-handlers.js';
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
const grid = (id, name, type, extra = {}) => ({ id, name, type, ...extra, wells: createDefaultWells({ type, ...extra }) });
state.inventoryFolders['-20 Degree'] = [{ id: 'demo-folder-plasmids', name: 'Plasmid stocks' }];
state.inventory['-20 Degree'] = [
  grid('demo-plasmid-box', 'Plasmid box A', 'box25', { folderId: 'demo-folder-plasmids' }),
  grid('demo-primer-box', 'Primer box', 'box49', { folderId: 'demo-folder-plasmids' }),
  { id: 'demo-antibody-tube', name: 'Antibody tube', type: 'single', wells: [], singleContent: '' }
];
state.inventory['-80 Degree'] = [grid('demo-protein-box', 'Protein box 1', 'box81'), grid('demo-glycerol-plate', 'Glycerol stock plate', 'plate96')];
state.inventory['Liquid Nitrogen'] = [grid('demo-cell-box', 'Cell line box', 'box100')];
const sample = (id, code, name, type, section, containerId, wellIndex, fields = {}) => ({
  id, code, name, type, lot: '', concentration: '', notes: 'Fictional teaching sample.', details: null,
  location: {}, inventoryLink: { section, containerId, wellIndex }, chemicalLinks: [], compoundStructure: null, cellPassage: null,
  updatedAt: iso(5), ...fields
});
const plasmid = (backbone, size) => ({ backbone, resistance: 'Kan', host_strain: 'DH5α', size_bp: size });
state.samples = [
  sample('demo-pl-1', 'PL-001', 'pDemo-GFP', 'plasmid', '-20 Degree', 'demo-plasmid-box', 0, { concentration: '120 ng/µL', lot: 'Prep 1', details: plasmid('pDemo vector', '5400') }),
  sample('demo-pl-2', 'PL-002', 'pDemo-mCherry', 'plasmid', '-20 Degree', 'demo-plasmid-box', 1, { concentration: '95 ng/µL', details: plasmid('pDemo vector', '5450') }),
  sample('demo-pl-3', 'PL-003', 'pDemo-empty', 'plasmid', '-20 Degree', 'demo-plasmid-box', 2, { concentration: '150 ng/µL', details: plasmid('pDemo vector', '4700') }),
  sample('demo-str-1', 'STR-001', 'Demo expression strain', 'strain', '-20 Degree', 'demo-plasmid-box', 5, { details: { species: 'E. coli', resistance: 'Cm' } }),
  sample('demo-pr-1', 'PR-001', 'GFP forward primer · example', 'primer', '-20 Degree', 'demo-primer-box', 0, { details: { direction: 'Forward', tm: '60' } }),
  sample('demo-pr-2', 'PR-002', 'GFP reverse primer · example', 'primer', '-20 Degree', 'demo-primer-box', 1, { details: { direction: 'Reverse', tm: '61' } }),
  sample('demo-ab-1', 'AB-001', 'Anti-GFP antibody · example', 'antibody', '-20 Degree', 'demo-antibody-tube', null,
    { concentration: '1 mg/mL', details: { target: 'GFP', host_species: 'Rabbit', clonality: 'Polyclonal', dilution: '1:1000' } }),
  sample('demo-prt-1', 'PRT-001', 'Model protein A', 'protein', '-80 Degree', 'demo-protein-box', 0, { concentration: '2 mg/mL', details: { molecular_weight: '27', tag: 'His6' } }),
  sample('demo-prt-2', 'PRT-002', 'Model protein B', 'protein', '-80 Degree', 'demo-protein-box', 1, { concentration: '1.5 mg/mL', details: { molecular_weight: '31', tag: 'His6' } }),
  sample('demo-gly-1', 'STR-002', 'Demo strain glycerol stock', 'strain', '-80 Degree', 'demo-glycerol-plate', 0, { details: { species: 'E. coli' } }),
  sample('demo-cl-1', 'CL-001', 'Demo cell line', 'cell_line', 'Liquid Nitrogen', 'demo-cell-box', 0, { details: { species: 'Human', medium: 'DMEM + 10% FBS' } })
];

let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('samples-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  // Plasmid names are suggested from the DNA library; these entries stand in for it.
  sequenceLibraryList: async () => ({ ok: true, entries: ['pDemo-GFP', 'pDemo-GFP-v2', 'pDemo-mCherry', 'pDemo-empty'].map(name => ({ name })) }),
  reportError: ({ message }) => { calls.push({ kind: 'error', message }); }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const inventory = initPersonalInventory({ state, persist, createId: () => crypto.randomUUID(), safeText,
  onInventoryChanged: () => calls.push({ kind: 'inventory-changed' }) });
// The shell's own navigation and search, as start-hikari-core wires them.
let search;
const shell = createNavigationShell({ VIEWS, TITLES, APP_DOCK_ORDER, APP_REGISTRY, navigationViewAliases: [],
  moduleRuntime: { renderView: viewId => { if (viewId === VIEWS.SAMPLE_REGISTRY) inventory.renderSections(); } },
  sharedLeftRailRuntime: { ensureHandles() {}, syncWidth() {} },
  executeTopbarSearch: query => search.executeTopbarSearch(query),
  getSearchSuggestions: (query, options) => search.getSearchSuggestions(query, options),
  applySearchSuggestion: suggestion => search.applySuggestion(suggestion) });
const openItemHandlers = createTopbarOpenItemHandlers({ views: VIEWS, moduleRegistry: new Map([['personalInventory', inventory]]),
  rendererServices: {}, showView: shell.showView, cssEscape: CSS.escape });
search = createTopbarSearchController({ state, VIEWS, TITLES,
  globalViewAliases: buildViewAliasMap({ apps: APP_REGISTRY }), searchScopeTargets: buildSearchScopeMap({ apps: APP_REGISTRY }),
  showView: shell.showView, getActiveViewId: shell.getActiveViewId, setSearchInputValue: shell.setSearchInputValue,
  topbarSearchInput: shell.topbarSearchInput, apps: APP_REGISTRY, openItemHandlers });
shell.initNavigation();
shell.showView(VIEWS.SAMPLE_REGISTRY);
window.tutorial = { state, inventory, calls, get writes() { return writes; } };
window.tutorialReady = true;
