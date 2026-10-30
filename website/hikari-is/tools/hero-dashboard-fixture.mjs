// Documentation-only preview: real Home markup/controllers, fictional state,
// local in-memory desktop/AI adapters. Never opens a research workspace.
import { defaultState } from '../../../src/renderer/modules/app-state/index.js';
import { homeDashboardManifest } from '../../../src/renderer/module-manifests/home-dashboard.js';
import { APP_REGISTRY, APP_DOCK_ORDER } from '../../../src/renderer/modules/app-registry.generated.js';
import { createAppDock } from '../../../src/renderer/app/navigation-shell/app-dock.js';

const RealDate = Date;
const fixedNow = new RealDate('2026-10-29T10:30:00-05:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
};
const iso = (days = 0, minutes = 0) => new Date(fixedNow - days * 86400000 - minutes * 60000).toISOString();
const day = days => iso(days).slice(0, 10);
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const state = structuredClone(defaultState);
state.settings.storagePath = '';
state.settings.plugins = [];
state.projects = [{ id: 'demo-project', name: 'Enzyme stability screen' }];
state.protocols = [{ id: 'demo-protocol', name: 'Thermal stability assay', steps: [] }];
state.samples = [];
state.notebookEntries = [
  { id: 'demo-page', projectId: 'demo-project', experimentName: 'Buffer screen · enzyme A17', result: 'A17 retained 92% activity in buffer B. Repeat with a fresh aliquot.', notebookState: 'planned', createdAt: iso(0, 30), updatedAt: iso(0, 20) },
  { id: 'demo-page-2', projectId: 'demo-project', experimentName: 'Thermal shift · plate 04', result: 'Example observations.', notebookState: 'planned', createdAt: iso(1), updatedAt: iso(1) },
  { id: 'demo-page-3', projectId: 'demo-project', experimentName: 'A17 purification · fraction pool', result: '', notebookState: 'planned', createdAt: iso(2), updatedAt: iso(2) }
];
for (const entry of state.notebookEntries) {
  entry.projectName = state.projects[0].name;
  entry.protocolId = 'demo-protocol';
  entry.protocolName = entry.experimentName;
}
state.workflows = [];
state.assays = [];
state.papers = [];
state.gelAnalyses = [];
state.settings.dashboard = {
  timerTemplates: [{ name: 'Protein incubation', durationMinutes: 10 }, { name: 'Incubation', durationMinutes: 90 }],
  activeTimers: [{ name: 'Protein incubation', durationMinutes: 10, startedAtMs: fixedNow - 135000, endAtMs: fixedNow + 465000, isPaused: false, remainingMs: 0 }],
  passageReminders: [
    { id: 'demo-cell-1', name: 'HEK293T', cellPassage: { lastPassageDate: day(4), intervalDays: 3, passageNumber: 8 }, updatedAt: iso(4) },
    { id: 'demo-cell-2', name: 'CHO-K1', cellPassage: { lastPassageDate: day(3), intervalDays: 3, passageNumber: 5 }, updatedAt: iso(3) }
  ],
  incubationLocations: [{ name: '37°C shaker', reminderDate: day(0) }, { name: 'Cold room', reminderDate: '' }],
  quickLogDraft: 'A17 remained clear after 30 min at 42°C. Sample PROT-017 is in box B2, well C4. Plate 04 readout is ready for the notebook.',
  // Deterministic, varied history: busy experiment days, quieter weekends,
  // occasional missed days, and a week away from the bench.
  quickLogEntries: (() => {
    let seed = 2718;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const notes = ['Prepared fresh assay buffer.', 'Recorded the plate readout.', 'Checked sample concentrations.', 'Updated the purification notes.', 'Reviewed the thermal shift results.'];
    const logs = [];
    for (let daysAgo = 0; daysAgo < 123; daysAgo++) {
      const weekday = new Date(fixedNow - daysAgo * 86400000).getDay();
      const weekend = weekday === 0 || weekday === 6;
      if (daysAgo >= 55 && daysAgo <= 62) continue;
      if (random() < (weekend ? .86 : .23)) continue;
      const count = weekend ? 1 + Math.floor(random() * 2) : 1 + Math.floor(random() * 10);
      for (let n = 0; n < count; n++) {
        logs.push({ id: `hero-log-${daysAgo}-${n}`, text: notes[(daysAgo + n) % notes.length], createdAt: iso(daysAgo, n * 23), updatedAt: iso(daysAgo, n * 23) });
      }
    }
    return logs;
  })()

};
const tasks = [{
  id: 'demo-task', enabled: true, project: state.projects[0],
  metadata: { paper_finding: { project_name: state.projects[0].name, frequency_value: 1, frequency_unit: 'week' } },
  schedule: { timezone: 'America/Chicago' }, next_run_at: '2026-11-02T15:00:00Z',
  last_run: { completed_at: iso(0, 60), result: { papers: [{
    title: 'Buffer composition shapes enzyme stability during thermal stress',
    journal: 'Example Methods · fictional paper', published_at: '2026', authors: ['L. Chen & M. Rivera'],
    url: 'https://example.org/fictional-enzyme-study', summary: 'A fictional comparison of buffer conditions, aggregation, and retained enzyme activity.',
    relevance_reason: 'Related to your enzyme stability screen and buffer comparison.'
  }, { title: 'Linking thermal shifts to retained catalytic activity', journal: 'Example Biochemistry · fictional paper', published_at: '2026', authors: ['A. Patel'], url: 'https://example.org/fictional-thermal-study', summary: 'Fictional study comparing thermal shift measurements with an activity assay.', relevance_reason: 'A complementary readout for your plate 04 results.' }] } }
}];
let writes = 0;
const persist = () => { writes++; localStorage.setItem('tutorial-preview', JSON.stringify(state)); };
window.hikariApi = {
  listPaperFindingTasks: async () => ({ ok: true, tasks }),
  runPaperFindingTask: async () => ({ ok: true }),
  downloadFoundPaper: async () => ({ ok: false, error: 'Documentation preview: no network download is performed.' }),
  agentChat: async () => ({ ok: true, notebook_append: { status: 'proposal_ready', proposal: {
    proposal_id: 'demo-append', notebook_entry_id: 'demo-page', page_title: 'Buffer screen · enzyme A17',
    expected_updated_at: state.notebookEntries[0].updatedAt,
    content_markdown: 'Compared buffer A and buffer B in the pilot. Sample B looked clearer after mixing. Measurements are still pending.'
  }, save: { mode: 'confirm_before_append', applied: false, status: 'pending' } } })
};

const dock = createAppDock({ documentObject: document, windowObject: window, TITLES: {},
  dockNav: document.getElementById('app-dock-nav'), appDockDivider: document.querySelector('.app-dock-divider'),
  moreBtn: document.getElementById('app-more-btn'), moreMenu: document.getElementById('app-more-menu'),
  pageTitle: document.getElementById('page-title'), pageSubtitle: document.getElementById('page-subtitle'),
  expandedDockApps: [...APP_DOCK_ORDER.map(id => APP_REGISTRY.find(app => app.id === id)).filter(Boolean),
    ...APP_REGISTRY.filter(app => !APP_DOCK_ORDER.includes(app.id) && !app.hiddenFromNavigation)],
  getActiveViewId: () => 'home-view', getAppForView: id => APP_REGISTRY.find(app => app.viewId === id),
  resolveNavigationViewId: id => id
});
dock.renderAppNavigation('home-view');
dock.syncNavigationState('home-view');
document.getElementById('app-more-btn').addEventListener('click', () => dock.toggleMoreMenu());
const options = homeDashboardManifest.createOptions({ state, persist, createId: () => crypto.randomUUID(), safeText,
  showView: id => { window.tutorialLastNavigation = id; }, views: { BIOLOGY_NOTEBOOK: 'biology-notebook-view', PAPERS: 'papers-view' },
  modules: {}, apiBridge: window.hikariApi, rootDocument: document, windowObject: window,
  rendererServices: { notebook: { handleAgentNotebookEntriesChanged() {} }, protocol: { handleProtocolsChanged() {} } }
});
const controller = homeDashboardManifest.init(options);
controller.render();
window.tutorial = { state, controller, get writes() { return writes; }, fixedNow };
window.tutorialReady = true;
