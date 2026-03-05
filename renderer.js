import {
  VIEWS,
  TITLES,
  loadState,
  persistState,
  normalizeState,
  createId,
  trackGrowthEvent,
  safeText,
  cssEscape
} from './modules/shared.js';
import { initLabManagement } from './modules/lab-management.js';
import { initInstrumentManagement } from './modules/instrument-management.js';
import { initProtocolManagement } from './modules/protocol-management.js';
import { initLabNotebook } from './modules/lab-notebook.js';
import { initLabNotebook as initBiologyNotebook } from './modules/biology-notebook.js';
import { initPersonalInventory } from './modules/personal-inventory.js';
import { initSettings } from './modules/settings.js';
import { initProjectManagement } from './modules/project-management.js';
import { initWorkflowManagement } from './modules/workflow-management.js';
import { initCollaborationManagement } from './modules/collaboration-management.js';
import { initLabCommonInventory } from './modules/lab-common-inventory.js';
import { initSampleRegistry } from './modules/sample-registry.js';
import { initAssay } from './modules/assay.js';
import { initGelAnalysis } from './modules/gel-analysis.js';
import { initPapersManagement } from './modules/papers-management.js';
import { initToolBox } from './modules/tool-box.js';
import { initAgentChat } from './modules/agent-chat.js';
import {
  rebuildObjectGraph,
  queryNotebookEntriesByRelation,
  queryInstrumentUsageInRange
} from './modules/object-graph.js';

const state = loadState();

const pageSubtitle = document.getElementById('page-subtitle');
const homeBtn = document.getElementById('home-btn');
const exitBtn = document.getElementById('exit-btn');
const views = [...document.querySelectorAll('.view')];
const appNavButtons = [...document.querySelectorAll('.app-nav-btn[data-view]')];
const homeTiles = [...document.querySelectorAll('.tile[data-view]')];
const DEFAULT_APP_VIEW = VIEWS.LAB_MANAGEMENT;
let assay = null;
let gel = null;
let workflowManagement = null;
let agentChat = null;

function isNeutralCompactUi() {
  return state.settings?.appearance?.uiStyle !== 'classic';
}

function replaceState(nextState) {
  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.assign(state, nextState);
}

function persist() {
  state.objectGraph = rebuildObjectGraph(state);
  persistState(state);
  if (window.enanaApi && state.settings.autoSaveEna !== false) {
    window.enanaApi
      .autoSaveDataFile(state, state.settings.enaFilePath || '')
      .then((result) => {
        if (result?.ok && result.filePath && state.settings.enaFilePath !== result.filePath) {
          state.settings.enaFilePath = result.filePath;
          persistState(state);
        }
      })
      .catch(() => {});
  }
}

window.enanaGraph = {
  rebuild: () => {
    state.objectGraph = rebuildObjectGraph(state);
    persistState(state);
    return state.objectGraph;
  },
  entriesUsingReagentLot: (lot) => queryNotebookEntriesByRelation(state, {
    relation: 'uses_reagent_lot',
    targetType: 'reagent_lot',
    targetId: lot
  }),
  entriesUsingInstrumentLastMonth: (instrumentId) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).toISOString();
    return queryInstrumentUsageInRange(state, instrumentId, start, end);
  }
};

const labManagement = initLabManagement({
  state,
  persist,
  createId,
  safeText
});

const instrumentManagement = initInstrumentManagement({
  state,
  persist,
  createId,
  safeText
});

const synthesisNotebook = initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  notebookType: 'synthesis',
  onNotebookEntriesChanged: () => {
    projectManagement.renderNotebookPages();
    workflowManagement?.render();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderNotebookOptions();
    gel?.renderList();
  }
});

const biologyNotebook = initBiologyNotebook({
  state,
  persist,
  createId,
  safeText,
  notebookType: 'biology',
  onNotebookEntriesChanged: () => {
    projectManagement.renderNotebookPages();
    workflowManagement?.render();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderNotebookOptions();
    gel?.renderList();
  }
});

function refreshProtocolDependents() {
  synthesisNotebook.renderProtocolOptions();
  synthesisNotebook.renderEntries();
  biologyNotebook.renderProtocolOptions();
  biologyNotebook.renderEntries();
  workflowManagement?.render();
  assay?.renderNotebookOptions();
  assay?.renderList();
  gel?.renderNotebookOptions();
  gel?.renderList();
}

const protocol = initProtocolManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsChanged: refreshProtocolDependents,
  trackGrowthEvent
});

const projectManagement = initProjectManagement({
  state,
  persist,
  createId,
  safeText,
  onProjectsChanged: () => {
    synthesisNotebook.renderProjectOptions();
    synthesisNotebook.renderProtocolOptions();
    synthesisNotebook.renderEntries();
    biologyNotebook.renderProjectOptions();
    biologyNotebook.renderProtocolOptions();
    biologyNotebook.renderEntries();
    workflowManagement?.render();
    assay?.renderProjectOptions();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderProjectOptions();
    gel?.renderNotebookOptions();
    gel?.renderList();
    papers.render();
    agentChat?.render();
  }
});

agentChat = initAgentChat({
  state,
  persist,
  createId,
  safeText
});

workflowManagement = initWorkflowManagement({
  state,
  persist,
  createId,
  safeText,
  onWorkflowsChanged: () => {}
});

const papers = initPapersManagement({
  state,
  persist,
  createId,
  safeText,
  onCreateProtocolDraft: ({ method, paper }) => {
    const ok = protocol.addDraftFromExtractedMethod(method, paper);
    if (ok) {
      showView(VIEWS.PROTOCOL_MANAGEMENT);
    }
  }
});

const collaboration = initCollaborationManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsImported: () => {
    refreshProtocolDependents();
    protocol.renderList();
  },
  trackGrowthEvent
});

const labCommonInventory = initLabCommonInventory({
  state,
  persist,
  createId,
  safeText
});

const personalInventory = initPersonalInventory({
  state,
  persist,
  createId,
  safeText,
  cssEscape
});

const sampleRegistry = initSampleRegistry({
  state,
  persist,
  safeText
});

assay = initAssay({
  state,
  persist,
  createId,
  safeText,
  onAssaysChanged: () => {
    projectManagement.renderNotebookPages();
  }
});

gel = initGelAnalysis({
  state,
  persist,
  createId,
  safeText,
  onGelAnalysesChanged: () => {
    projectManagement.renderNotebookPages();
  }
});

initToolBox();

const settings = initSettings({
  state,
  persist,
  onStoragePathSaved: () => {
    synthesisNotebook.renderEntries();
    biologyNotebook.renderEntries();
  },
  onSaveEnaFile: async () => {
    if (!window.enanaApi) {
      return;
    }
    const result = await window.enanaApi.saveEnaFile(state, state.settings.enaFilePath || '');
    if (result?.ok && result.filePath) {
      state.settings.enaFilePath = result.filePath;
      persistState(state);
    }
  },
  onLoadEnaFile: async () => {
    if (!window.enanaApi) {
      return;
    }
    const result = await window.enanaApi.loadEnaFile();
    if (!result?.ok || !result.data) {
      return;
    }
    const loadedState = normalizeState(result.data);
    loadedState.settings.enaFilePath = result.filePath || loadedState.settings.enaFilePath;
    replaceState(loadedState);
    persistState(state);
    renderAll();
    showView(VIEWS.HOME);
  }
});

function showView(viewId) {
  let nextView = viewId;
  if (isNeutralCompactUi() && nextView === VIEWS.HOME) {
    nextView = DEFAULT_APP_VIEW;
  }

  views.forEach((view) => {
    view.classList.toggle('is-active', view.id === nextView);
  });
  [...appNavButtons, ...homeTiles].forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === nextView);
  });

  pageSubtitle.textContent = TITLES[nextView] || '';
  homeBtn.hidden = isNeutralCompactUi() || nextView === VIEWS.HOME;

  if (nextView === VIEWS.SYNTHESIS_NOTEBOOK) {
    synthesisNotebook.renderProjectOptions();
    synthesisNotebook.renderProtocolOptions();
    synthesisNotebook.renderEntries();
  }

  if (nextView === VIEWS.BIOLOGY_NOTEBOOK) {
    biologyNotebook.renderProjectOptions();
    biologyNotebook.renderProtocolOptions();
    biologyNotebook.renderEntries();
  }

  if (nextView === VIEWS.PROTOCOL_MANAGEMENT) {
    protocol.renderShareTargets();
    protocol.renderList();
  }

  if (nextView === VIEWS.PERSONAL_INVENTORY) {
    personalInventory.renderSections();
  }

  if (nextView === VIEWS.SAMPLE_REGISTRY) {
    sampleRegistry.render();
  }

  if (nextView === VIEWS.ASSAY) {
    assay.render();
  }

  if (nextView === VIEWS.GEL) {
    gel.render();
  }

  if (nextView === VIEWS.LAB_COMMON_INVENTORY) {
    labCommonInventory.renderAll();
  }

  if (nextView === VIEWS.COLLABORATION_MANAGEMENT) {
    collaboration.renderEmailSelectors();
  }

  if (nextView === VIEWS.PROJECT_MANAGEMENT) {
    projectManagement.render();
  }

  if (nextView === VIEWS.WORKFLOW_MANAGEMENT) {
    workflowManagement.render();
  }

  if (nextView === VIEWS.PAPERS) {
    papers.render();
  }

  if (nextView === VIEWS.AGENT) {
    agentChat.render();
  }

  if (nextView === VIEWS.INSTRUMENT_MANAGEMENT) {
    instrumentManagement.render();
  }
}

function setSearchInputValue(inputId, value) {
  const input = document.getElementById(inputId);
  if (!input) {
    return false;
  }

  input.value = String(value || '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function handleTelegramCommand(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const type = String(payload.type || '');
  if (type === 'open-view') {
    const viewId = String(payload.viewId || '').trim();
    if (viewId) {
      showView(viewId);
    }
    return;
  }

  if (type === 'search-chemicals') {
    showView(VIEWS.LAB_COMMON_INVENTORY);
    setSearchInputValue('chemical-search', payload.query);
    return;
  }

  if (type === 'search-samples') {
    showView(VIEWS.SAMPLE_REGISTRY);
    setSearchInputValue('sample-search', payload.query);
    return;
  }

  if (type === 'search-assays') {
    showView(VIEWS.ASSAY);
    setSearchInputValue('assay-search', payload.query);
    return;
  }

  if (type === 'search-gels') {
    showView(VIEWS.GEL);
    setSearchInputValue('gel-search', payload.query);
  }
}

function initTelegramCommandBridge() {
  if (!window.enanaApi?.onTelegramCommand) {
    return;
  }

  window.enanaApi.onTelegramCommand((payload) => {
    handleTelegramCommand(payload);
  });
}

function initNavigation() {
  [...homeTiles, ...appNavButtons].forEach((entry) => {
    entry.addEventListener('click', () => {
      showView(entry.dataset.view);
    });
  });

  homeBtn.addEventListener('click', () => showView(VIEWS.HOME));
  if (exitBtn) {
    exitBtn.addEventListener('click', () => window.close());
  }
}

window.addEventListener('enana:appearance-changed', () => {
  const activeViewId = views.find((view) => view.classList.contains('is-active'))?.id || VIEWS.HOME;
  showView(activeViewId);
});

function renderAll() {
  state.objectGraph = rebuildObjectGraph(state);
  labManagement.render();
  instrumentManagement.render();
  protocol.renderShareTargets();
  protocol.renderList();
  projectManagement.render();
  workflowManagement.render();
  collaboration.renderEmailSelectors();
  labCommonInventory.renderAll();
  synthesisNotebook.renderProjectOptions();
  synthesisNotebook.renderProtocolOptions();
  synthesisNotebook.renderEntries();
  biologyNotebook.renderProjectOptions();
  biologyNotebook.renderProtocolOptions();
  biologyNotebook.renderEntries();
  personalInventory.renderSections();
  sampleRegistry.render();
  assay.render();
  gel.render();
  settings.renderForms();
  settings.applyAppearance();
  papers.render();
  agentChat.render();
}

async function hydrateStateFromDataFile() {
  if (!window.enanaApi?.autoLoadDataFile) {
    return;
  }

  const preferredPath = typeof state.settings?.enaFilePath === 'string' ? state.settings.enaFilePath : '';
  const result = await window.enanaApi.autoLoadDataFile(preferredPath);
  if (!result?.ok) {
    return;
  }

  if (result.filePath && state.settings.enaFilePath !== result.filePath) {
    state.settings.enaFilePath = result.filePath;
  }

  if (result.data && typeof result.data === 'object') {
    const loadedState = normalizeState(result.data);
    loadedState.settings.enaFilePath = result.filePath || loadedState.settings.enaFilePath;
    replaceState(loadedState);
  }

  persistState(state);
}

async function initApp() {
  await hydrateStateFromDataFile();
  initNavigation();
  initTelegramCommandBridge();
  renderAll();
  showView(isNeutralCompactUi() ? DEFAULT_APP_VIEW : VIEWS.HOME);
}

initApp();
