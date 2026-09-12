import { initPapersManagement } from '/src/renderer/modules/papers/index.js';
import { createPapersPdfViewer } from '/src/renderer/modules/papers/pdf-viewer/index.js';
import { createNavigationShell } from '/src/renderer/app/navigation-shell.js';
import { initSharedLeftRailResizers } from '/src/renderer/app/shared-left-rail.js';
import { VIEWS, TITLES } from '/src/renderer/modules/views.js';

const registry = await (await fetch('/ui/config/app-registry.json')).json();
const paper = { id: 'review-paper', title: 'Papers workspace verification', fileName: 'reading-fixture.pdf', linkedType: 'project', linkedId: 'review-project', comments: [], highlights: [] };
paper.knowledgeMetaRelativePath = 'KnowledgeBase/papers.md/review-paper/meta.json';
const state = { projects: [{ id: 'review-project', name: 'Reading review' }], journalClubs: [], papers: [paper], settings: { storagePath: '/review-workspace' } };
const briefRecord = {
  paper_id: 'review-paper', doc_type: 'research_paper',
  one_sentence_summary: 'A comparative workflow connects binding strength, specificity, and thermal stability to identify antibody candidates for further validation.',
  experiments: [
    { title: 'Binding across a concentration series', technique: 'ELISA', variables: 'Candidate identity and antigen concentration', outcome: 'The leading candidates retained a concentration-dependent response across replicate measurements.', figure_ref: 'Figure 2A–C', evidence: 'Example evidence excerpt for interface verification; this is a demonstration record.' },
    { title: 'Specificity against related targets', technique: 'Cross-reactivity assay', outcome: 'Binding was compared across a panel of related targets.', figure_ref: 'Figure 3' },
    { title: 'Thermal stability of purified candidates', technique: 'Differential scanning fluorimetry', outcome: 'Candidate stability was compared under a common buffer condition.', figure_ref: 'Figure 4' }
  ]
};
window.hikariApi = { async readFileBytes(path) {
  if(path !== '/review-workspace/KnowledgeBase/papers.md/review-paper/intake.json') throw new Error('Unexpected brief path');
  return {ok:true,bytes:new TextEncoder().encode(JSON.stringify(briefRecord)).buffer};
} };
let viewer;
const papers = initPapersManagement({ state, persist() {}, createId: () => crypto.randomUUID(), safeText: (text) => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])), document, window,
  createPdfViewer: (elements) => { viewer = createPapersPdfViewer(elements); return viewer; }
});
const sharedLeftRailRuntime = initSharedLeftRailResizers({ document, windowObject: window });
const navigation = createNavigationShell({ VIEWS, TITLES, APP_DOCK_ORDER: registry.dockOrder, APP_REGISTRY: registry.apps,
  moduleRuntime: { renderView(view) { if(view === VIEWS.PAPERS) papers.render(); }, renderAgentChatRail() {} },
  sharedLeftRailRuntime, executeTopbarSearch() {}, documentObject: document, windowObject: window
});
navigation.initNavigation();
navigation.showView(VIEWS.PAPERS);
window.review = { navigation, papers, viewer, state, paper, briefRecord };
const bytes = new Uint8Array(await (await fetch('/artifacts/papers-bars-review/reading-fixture.pdf')).arrayBuffer());
const opened = await viewer.openPaper({ paper, resolveBytes: async () => bytes });
papers.render();
document.getElementById('app-loading-cover')?.remove();
document.body.classList.remove('app-is-loading');
window.review.ready = opened;
