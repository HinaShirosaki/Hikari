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
const topbarSearchInput = document.getElementById('topbar-search');
const views = [...document.querySelectorAll('.view')];
const appNavButtons = [...document.querySelectorAll('.app-nav-btn[data-view]')];
const homeTiles = [...document.querySelectorAll('.tile[data-view]')];
const DEFAULT_APP_VIEW = VIEWS.LAB_MANAGEMENT;

const GLOBAL_VIEW_ALIASES = new Map([
  ['home', VIEWS.HOME],
  ['members', VIEWS.LAB_MANAGEMENT],
  ['member', VIEWS.LAB_MANAGEMENT],
  ['instruments', VIEWS.INSTRUMENT_MANAGEMENT],
  ['instrument', VIEWS.INSTRUMENT_MANAGEMENT],
  ['protocols', VIEWS.PROTOCOL_MANAGEMENT],
  ['protocol', VIEWS.PROTOCOL_MANAGEMENT],
  ['collaborations', VIEWS.COLLABORATION_MANAGEMENT],
  ['collaboration', VIEWS.COLLABORATION_MANAGEMENT],
  ['synthesis', VIEWS.SYNTHESIS_NOTEBOOK],
  ['biology', VIEWS.BIOLOGY_NOTEBOOK],
  ['chemicals', VIEWS.LAB_COMMON_INVENTORY],
  ['chemical', VIEWS.LAB_COMMON_INVENTORY],
  ['samples', VIEWS.SAMPLE_REGISTRY],
  ['sample', VIEWS.SAMPLE_REGISTRY],
  ['sample-inventory', VIEWS.SAMPLE_REGISTRY],
  ['sampleinventory', VIEWS.SAMPLE_REGISTRY],
  ['assay', VIEWS.ASSAY],
  ['assays', VIEWS.ASSAY],
  ['gel', VIEWS.GEL],
  ['gels', VIEWS.GEL],
  ['inventory', VIEWS.SAMPLE_REGISTRY],
  ['projects', VIEWS.PROJECT_MANAGEMENT],
  ['project', VIEWS.PROJECT_MANAGEMENT],
  ['workflows', VIEWS.WORKFLOW_MANAGEMENT],
  ['workflow', VIEWS.WORKFLOW_MANAGEMENT],
  ['papers', VIEWS.PAPERS],
  ['paper', VIEWS.PAPERS],
  ['agent', VIEWS.AGENT],
  ['tools', VIEWS.TOOL_BOX],
  ['tool', VIEWS.TOOL_BOX],
  ['toolbox', VIEWS.TOOL_BOX],
  ['settings', VIEWS.SETTING],
  ['setting', VIEWS.SETTING]
]);

const SEARCH_SCOPE_TARGETS = new Map([
  ['chemical', { viewId: VIEWS.LAB_COMMON_INVENTORY, inputId: 'chemical-search', label: 'Chemicals' }],
  ['chemicals', { viewId: VIEWS.LAB_COMMON_INVENTORY, inputId: 'chemical-search', label: 'Chemicals' }],
  ['inventory', { viewId: VIEWS.SAMPLE_REGISTRY, inputId: 'sample-search', label: 'Sample & Inventory' }],
  ['sample', { viewId: VIEWS.SAMPLE_REGISTRY, inputId: 'sample-search', label: 'Sample & Inventory' }],
  ['samples', { viewId: VIEWS.SAMPLE_REGISTRY, inputId: 'sample-search', label: 'Sample & Inventory' }],
  ['assay', { viewId: VIEWS.ASSAY, inputId: 'assay-search', label: 'Assay' }],
  ['assays', { viewId: VIEWS.ASSAY, inputId: 'assay-search', label: 'Assay' }],
  ['gel', { viewId: VIEWS.GEL, inputId: 'gel-search', label: 'Gel' }],
  ['gels', { viewId: VIEWS.GEL, inputId: 'gel-search', label: 'Gel' }],
  ['project', { viewId: VIEWS.PROJECT_MANAGEMENT, inputId: '', label: 'Projects' }],
  ['projects', { viewId: VIEWS.PROJECT_MANAGEMENT, inputId: '', label: 'Projects' }],
  ['protocol', { viewId: VIEWS.PROTOCOL_MANAGEMENT, inputId: '', label: 'Protocols' }],
  ['protocols', { viewId: VIEWS.PROTOCOL_MANAGEMENT, inputId: '', label: 'Protocols' }],
  ['paper', { viewId: VIEWS.PAPERS, inputId: '', label: 'Papers' }],
  ['papers', { viewId: VIEWS.PAPERS, inputId: '', label: 'Papers' }],
  ['member', { viewId: VIEWS.LAB_MANAGEMENT, inputId: '', label: 'Members' }],
  ['members', { viewId: VIEWS.LAB_MANAGEMENT, inputId: '', label: 'Members' }],
  ['instrument', { viewId: VIEWS.INSTRUMENT_MANAGEMENT, inputId: '', label: 'Instruments' }],
  ['instruments', { viewId: VIEWS.INSTRUMENT_MANAGEMENT, inputId: '', label: 'Instruments' }]
]);

let assay = null;
let gel = null;
let workflowManagement = null;
let agentChat = null;

function isNeutralCompactUi() {
  return state.settings?.appearance?.uiStyle !== 'classic';
}

function normalizeViewId(viewId) {
  return viewId === VIEWS.PERSONAL_INVENTORY ? VIEWS.SAMPLE_REGISTRY : viewId;
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

let sampleRegistry = null;
const personalInventory = initPersonalInventory({
  state,
  persist,
  createId,
  safeText,
  cssEscape,
  onSamplesChanged: () => {
    sampleRegistry?.render();
  }
});

sampleRegistry = initSampleRegistry({
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
  let nextView = normalizeViewId(viewId);
  if (isNeutralCompactUi() && nextView === VIEWS.HOME) {
    nextView = DEFAULT_APP_VIEW;
  }

  const showSampleInventoryWorkspace = nextView === VIEWS.SAMPLE_REGISTRY;
  views.forEach((view) => {
    const isSampleInventorySection = view.id === VIEWS.SAMPLE_REGISTRY || view.id === VIEWS.PERSONAL_INVENTORY;
    const active = view.id === nextView || (showSampleInventoryWorkspace && isSampleInventorySection);
    view.classList.toggle('is-active', active);
  });
  [...appNavButtons, ...homeTiles].forEach((button) => {
    const buttonView = normalizeViewId(button.dataset.view);
    button.classList.toggle('is-active', buttonView === nextView);
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

  if (nextView === VIEWS.SAMPLE_REGISTRY) {
    personalInventory.renderSections();
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSearchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function tokenizeSearchQuery(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

function scoreTextByTokens(text, queryTokens, queryLower) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) {
    return 0;
  }

  if (!queryTokens.length) {
    return queryLower && haystack.includes(queryLower) ? 1 : 0;
  }

  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 1;
    }
  });
  if (queryLower && queryLower.length >= 3 && haystack.includes(queryLower)) {
    score += 2;
  }
  return score;
}

function getScopeTarget(scopeToken) {
  return SEARCH_SCOPE_TARGETS.get(normalizeSearchToken(scopeToken)) || null;
}

function parseTopbarSearch(rawValue) {
  const raw = String(rawValue || '').trim();
  const parsed = {
    raw,
    query: raw,
    queryLower: raw.toLowerCase(),
    tokens: tokenizeSearchQuery(raw),
    scopeToken: '',
    target: null,
    openViewId: ''
  };
  if (!raw) {
    return parsed;
  }

  // Scoped query syntax: "<scope>: <query>".
  const scopedMatch = raw.match(/^([a-z0-9][a-z0-9_\-\s]{0,30})\s*:\s*(.+)$/i);
  if (scopedMatch) {
    const scopeToken = normalizeSearchToken(scopedMatch[1]);
    const target = getScopeTarget(scopeToken);
    if (target) {
      const query = String(scopedMatch[2] || '').trim();
      parsed.scopeToken = scopeToken;
      parsed.target = target;
      parsed.query = query;
      parsed.queryLower = query.toLowerCase();
      parsed.tokens = tokenizeSearchQuery(query);
      return parsed;
    }
  }

  const [rawFirstToken = '', ...restParts] = raw.split(/\s+/);
  const firstToken = normalizeSearchToken(rawFirstToken);
  const trailingQuery = restParts.join(' ').trim();
  if (firstToken && trailingQuery) {
    const target = getScopeTarget(firstToken);
    if (target) {
      parsed.scopeToken = firstToken;
      parsed.target = target;
      parsed.query = trailingQuery;
      parsed.queryLower = trailingQuery.toLowerCase();
      parsed.tokens = tokenizeSearchQuery(trailingQuery);
      return parsed;
    }
  }

  if (firstToken && GLOBAL_VIEW_ALIASES.has(firstToken)) {
    parsed.openViewId = GLOBAL_VIEW_ALIASES.get(firstToken);
    parsed.query = trailingQuery;
    parsed.queryLower = trailingQuery.toLowerCase();
    parsed.tokens = tokenizeSearchQuery(trailingQuery);
  }
  return parsed;
}

function applySearchTarget(target, query) {
  if (!target || !target.viewId) {
    return false;
  }

  showView(target.viewId);
  if (target.inputId) {
    return setSearchInputValue(target.inputId, query);
  }
  return true;
}

function getActiveViewId() {
  const activeViews = views.filter((view) => view.classList.contains('is-active')).map((view) => view.id);
  if (activeViews.includes(VIEWS.SAMPLE_REGISTRY) || activeViews.includes(VIEWS.PERSONAL_INVENTORY)) {
    return VIEWS.SAMPLE_REGISTRY;
  }
  return activeViews[0] || (isNeutralCompactUi() ? DEFAULT_APP_VIEW : VIEWS.HOME);
}

function getScopeTargetForView(viewId) {
  let fallback = null;
  for (const target of SEARCH_SCOPE_TARGETS.values()) {
    if (target.viewId !== viewId) {
      continue;
    }
    if (target.inputId) {
      return target;
    }
    if (!fallback) {
      fallback = target;
    }
  }
  return fallback;
}

function protocolSearchText(protocol) {
  const stepsText = asArray(protocol?.steps)
    .map((step) => (typeof step === 'string' ? step : step?.text || step?.instruction || step?.title || ''))
    .join(' ');
  return [
    protocol?.name,
    protocol?.purpose,
    asArray(protocol?.materials).join(' '),
    stepsText,
    protocol?.troubleshooting
  ].join(' ');
}

function buildGlobalSearchCandidates() {
  const candidates = [];
  const addCandidate = (target, text) => {
    if (!target || !target.viewId) {
      return;
    }
    const searchText = String(text || '').trim();
    if (!searchText) {
      return;
    }
    candidates.push({ target, text: searchText });
  };

  const chemicalTarget = getScopeTarget('chemicals');
  asArray(state.labInventory?.chemicals).forEach((chemical) => {
    addCandidate(chemicalTarget, [
      chemical?.name,
      chemical?.casNumber,
      chemical?.vendor,
      chemical?.catalogNumber,
      chemical?.location,
      chemical?.unitSize,
      chemical?.amountInStock
    ].join(' '));
  });

  const sampleTarget = getScopeTarget('samples');
  asArray(state.samples).forEach((sample) => {
    addCandidate(sampleTarget, [
      sample?.code,
      sample?.name,
      sample?.type,
      sample?.lot,
      sample?.concentration,
      sample?.notes
    ].join(' '));
  });

  const assayTarget = getScopeTarget('assay');
  asArray(state.assays).forEach((assayItem) => {
    addCandidate(assayTarget, [
      assayItem?.assayNumber,
      assayItem?.name,
      assayItem?.projectName,
      assayItem?.plateLabel,
      assayItem?.notebookEntryProtocolName,
      assayItem?.notes,
      asArray(assayItem?.sampleAxisValues).join(' '),
      asArray(assayItem?.concentrationAxisValues).join(' ')
    ].join(' '));
  });

  const gelTarget = getScopeTarget('gel');
  asArray(state.gelAnalyses).forEach((record) => {
    addCandidate(gelTarget, [
      record?.name,
      record?.projectName,
      record?.notebookEntryProtocolName,
      record?.analysisType,
      record?.imageName,
      record?.report?.confidence?.label,
      asArray(record?.report?.warnings).join(' ')
    ].join(' '));
  });

  const projectTarget = getScopeTarget('projects');
  asArray(state.projects).forEach((project) => {
    addCandidate(projectTarget, [project?.name, project?.description].join(' '));
  });

  const protocolTarget = getScopeTarget('protocols');
  asArray(state.protocols).forEach((protocolItem) => {
    addCandidate(protocolTarget, protocolSearchText(protocolItem));
  });

  const paperTarget = getScopeTarget('papers');
  asArray(state.papers).forEach((paper) => {
    addCandidate(paperTarget, [
      paper?.title,
      paper?.linkedName,
      paper?.summary,
      paper?.fileName
    ].join(' '));
  });

  const memberTarget = getScopeTarget('members');
  asArray(state.members).forEach((member) => {
    addCandidate(memberTarget, [
      member?.name,
      member?.position,
      member?.institutionEmail,
      member?.enanaEmail
    ].join(' '));
  });

  const instrumentTarget = getScopeTarget('instruments');
  asArray(state.instruments).forEach((instrument) => {
    addCandidate(instrumentTarget, [
      instrument?.name,
      instrument?.nickname,
      asArray(instrument?.reservations)
        .map((reservation) => [reservation?.title, reservation?.date, reservation?.notes].join(' '))
        .join(' ')
    ].join(' '));
  });

  const workflowTarget = {
    viewId: VIEWS.WORKFLOW_MANAGEMENT,
    inputId: '',
    label: 'Workflows'
  };
  asArray(state.workflows).forEach((workflow) => {
    addCandidate(workflowTarget, [workflow?.name, workflow?.description].join(' '));
  });

  const synthesisNotebookTarget = {
    viewId: VIEWS.SYNTHESIS_NOTEBOOK,
    inputId: '',
    label: 'Synthesis Notebook'
  };
  const biologyNotebookTarget = {
    viewId: VIEWS.BIOLOGY_NOTEBOOK,
    inputId: '',
    label: 'Biology Notebook'
  };
  asArray(state.notebookEntries).forEach((entry) => {
    const target = entry?.notebookType === 'biology' ? biologyNotebookTarget : synthesisNotebookTarget;
    addCandidate(target, [
      entry?.projectName,
      entry?.protocolName,
      entry?.result,
      asArray(entry?.resultFiles).join(' '),
      entry?.updatedAt
    ].join(' '));
  });

  const personalInventoryTarget = {
    viewId: VIEWS.SAMPLE_REGISTRY,
    inputId: '',
    label: 'Sample & Inventory'
  };
  // Flatten inventory containers/wells so the global matcher can route to sample/inventory workspace.
  Object.entries(state.inventory || {}).forEach(([zone, containers]) => {
    asArray(containers).forEach((container) => {
      addCandidate(personalInventoryTarget, [
        zone,
        container?.name,
        container?.type,
        container?.singleContent,
        asArray(container?.wells)
          .map((well) => (typeof well === 'string' ? well : `${well?.name || ''} ${well?.content || ''}`))
          .join(' ')
      ].join(' '));
    });
  });

  return candidates;
}

function executeTopbarSearch(rawQuery) {
  const parsed = parseTopbarSearch(rawQuery);
  if (!parsed.raw) {
    if (topbarSearchInput) {
      topbarSearchInput.title = 'Type a query and press Enter.';
    }
    return false;
  }

  if (parsed.target) {
    const applied = applySearchTarget(parsed.target, parsed.query);
    if (topbarSearchInput) {
      const canFilter = Boolean(parsed.target.inputId && parsed.query);
      topbarSearchInput.title = applied
        ? (canFilter
          ? `Opened ${parsed.target.label} and searched for "${parsed.query}".`
          : `Opened ${parsed.target.label}.`)
        : 'Search target unavailable.';
    }
    return applied;
  }

  if (parsed.openViewId) {
    showView(parsed.openViewId);
    let appliedQuery = false;
    if (parsed.query) {
      const scopedTarget = getScopeTargetForView(parsed.openViewId);
      if (scopedTarget?.inputId) {
        setSearchInputValue(scopedTarget.inputId, parsed.query);
        appliedQuery = true;
      }
    }
    if (topbarSearchInput) {
      topbarSearchInput.title = appliedQuery
        ? `Opened ${TITLES[parsed.openViewId] || 'view'} and searched for "${parsed.query}".`
        : `Opened ${TITLES[parsed.openViewId] || 'view'}.`;
    }
    return true;
  }

  const activeViewId = getActiveViewId();
  const candidates = buildGlobalSearchCandidates();
  let bestCandidate = null;
  let bestScore = 0;
  // Score all known records and route to the strongest matching module.
  candidates.forEach((candidate) => {
    let score = scoreTextByTokens(candidate.text, parsed.tokens, parsed.queryLower);
    if (!score) {
      return;
    }
    if (candidate.target.viewId === activeViewId) {
      score += 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  });

  if (bestCandidate) {
    applySearchTarget(bestCandidate.target, parsed.query);
    if (topbarSearchInput) {
      const canFilter = Boolean(bestCandidate.target.inputId && parsed.query);
      topbarSearchInput.title = canFilter
        ? `Opened ${bestCandidate.target.label} and searched for "${parsed.query}".`
        : `Opened ${bestCandidate.target.label}.`;
    }
    return true;
  }

  const activeScopeTarget = getScopeTargetForView(activeViewId);
  if (activeScopeTarget?.inputId) {
    applySearchTarget(activeScopeTarget, parsed.query);
    if (topbarSearchInput) {
      topbarSearchInput.title = `Searched in current ${activeScopeTarget.label} view.`;
    }
    return true;
  }

  const aliasViewId = GLOBAL_VIEW_ALIASES.get(normalizeSearchToken(parsed.query));
  if (aliasViewId) {
    showView(aliasViewId);
    if (topbarSearchInput) {
      topbarSearchInput.title = `Opened ${TITLES[aliasViewId] || 'view'}.`;
    }
    return true;
  }

  if (topbarSearchInput) {
    topbarSearchInput.title = `No match found for "${parsed.query}". Try "assay: keyword" or "gel: keyword".`;
  }
  return false;
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
  if (topbarSearchInput) {
    topbarSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        executeTopbarSearch(topbarSearchInput.value);
        return;
      }
      if (event.key === 'Escape') {
        topbarSearchInput.value = '';
        topbarSearchInput.title = 'Search cleared.';
      }
    });
  }
}

window.addEventListener('enana:appearance-changed', () => {
  const activeViewId = getActiveViewId();
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
