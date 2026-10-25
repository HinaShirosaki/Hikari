// Real Chemicals renderer with fictional records and local preview adapters.
// Never opens a research workspace: the storage path is a label, and every
// desktop call below answers from memory.
import { defaultState } from '../../../../src/renderer/modules/app-state/index.js';
import { initLabCommonInventory } from '../../../../src/renderer/modules/lab-common-inventory/index.js';
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
// Codes are left blank: the module assigns them on first render, as it does for older records.
const chemical = (id, name, casNumber, location, days, fields = {}) => ({
  id, name, casNumber, location, locationCode: '', locationNumber: 0, vendor: 'Example Supplier', catalogNumber: '', unitSize: '',
  price: '', amountInStock: '', url: '', expirationDate: '', updatedAt: iso(days), ...fields
});
state.labInventory = { blocks: [], lastLocationNumber: 0, locationCodeMap: {}, locationCodeNextByLocation: {}, chemicals: [
  chemical('demo-nacl', 'Sodium chloride', '7647-14-5', 'Main Storage', 9, { catalogNumber: 'EX-1001', unitSize: '1 kg', price: '$32', amountInStock: '2 bottles', expirationDate: '2028-03-01' }),
  chemical('demo-tris', 'Tris base', '77-86-1', 'Main Storage', 8, { catalogNumber: 'EX-1002', unitSize: '500 g', amountInStock: '1 bottle', expirationDate: '2027-06-30' }),
  chemical('demo-imidazole', 'Imidazole', '288-32-4', 'Main Storage', 2, { catalogNumber: 'EX-1003', unitSize: '100 g', price: '$58', amountInStock: '1 bottle',
    url: 'https://example.org/catalog/EX-1003', expirationDate: '2027-01-15' }),
  chemical('demo-glycerol', 'Glycerol', '56-81-5', 'Main Storage', 6, { catalogNumber: 'EX-1004', unitSize: '1 L', amountInStock: '3 bottles' }),
  chemical('demo-dtt', 'Dithiothreitol (DTT)', '3483-12-3', 'Cold Room', 5, { catalogNumber: 'EX-2001', unitSize: '5 g', amountInStock: '4 vials', expirationDate: '2026-11-20' }),
  chemical('demo-bsa', 'Bovine serum albumin', '9048-46-8', 'Cold Room', 4, { catalogNumber: 'EX-2002', unitSize: '50 g', amountInStock: '1 bottle', expirationDate: '2027-09-01' }),
  chemical('demo-ethanol', 'Ethanol, absolute', '64-17-5', 'Fume Hood', 7, { catalogNumber: 'EX-3001', unitSize: '2.5 L', amountInStock: '2 bottles' }),
  chemical('demo-hcl', 'Hydrochloric acid, 37%', '7647-01-0', 'Fume Hood', 3, { catalogNumber: 'EX-3002', unitSize: '1 L', amountInStock: '1 bottle', expirationDate: '2027-12-31' })
] };

let writes = 0;
const calls = [];
const persist = () => { writes++; localStorage.setItem('chemicals-tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  // Chemicals are written to the workspace's SQLite file by the desktop app; here the write is only recorded.
  syncSqliteBundle: async ({ mode, snapshot }) => { calls.push({ kind: 'sync', mode, count: snapshot.labInventory.chemicals.length }); return { ok: true }; },
  reportError: ({ message }) => { calls.push({ kind: 'error', message }); }
};
applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
document.getElementById('topbar-local-time').textContent = '10:30';
const inventory = initLabCommonInventory({ state, persist, createId: () => crypto.randomUUID(), safeText });
// The shell's own navigation and search, as start-hikari-core wires them.
let search;
const shell = createNavigationShell({ VIEWS, TITLES, APP_DOCK_ORDER, APP_REGISTRY, navigationViewAliases: [],
  moduleRuntime: { renderView: viewId => { if (viewId === VIEWS.LAB_COMMON_INVENTORY) inventory.renderAll(); } },
  sharedLeftRailRuntime: { ensureHandles() {}, syncWidth() {} },
  executeTopbarSearch: query => search.executeTopbarSearch(query),
  getSearchSuggestions: (query, options) => search.getSearchSuggestions(query, options),
  applySearchSuggestion: suggestion => search.applySuggestion(suggestion) });
const openItemHandlers = createTopbarOpenItemHandlers({ views: VIEWS, moduleRegistry: new Map(), rendererServices: {}, showView: shell.showView, cssEscape: CSS.escape });
search = createTopbarSearchController({ state, VIEWS, TITLES,
  globalViewAliases: buildViewAliasMap({ apps: APP_REGISTRY }), searchScopeTargets: buildSearchScopeMap({ apps: APP_REGISTRY }),
  showView: shell.showView, getActiveViewId: shell.getActiveViewId, setSearchInputValue: shell.setSearchInputValue,
  topbarSearchInput: shell.topbarSearchInput, apps: APP_REGISTRY, openItemHandlers });
shell.initNavigation();
shell.showView(VIEWS.LAB_COMMON_INVENTORY);
window.tutorial = { state, inventory, calls, get writes() { return writes; } };
window.tutorialReady = true;
