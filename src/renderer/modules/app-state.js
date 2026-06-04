import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider,
  defaultReasoningEffortForModel,
  normalizeReasoningEffort
} from './llm-provider-config.generated.js';
import { VIEWS } from './views.js';
import { createId } from './utils.js';
import { normalizePaperAgentChatSessions } from './agent-chat/scoped-state.js';

export const STORAGE_KEY = 'enana_state_v1';
const LEGACY_CHEMISTRY_DRAFT_KEY = 'enana_synthesis_chemistry_draft_v1';

const STARTUP_DEFAULT_VIEW_IDS = new Set([
  VIEWS.HOME,
  VIEWS.PROTOCOL_MANAGEMENT,
  VIEWS.BIOLOGY_NOTEBOOK,
  VIEWS.LAB_COMMON_INVENTORY,
  VIEWS.SAMPLE_REGISTRY,
  VIEWS.ASSAY,
  VIEWS.GEL,
  VIEWS.PROJECT_MANAGEMENT,
  VIEWS.WORKFLOW_MANAGEMENT,
  VIEWS.PAPERS,
  VIEWS.AGENT,
  VIEWS.SEQUENCE_VIEWER,
  VIEWS.TOOL_BOX,
  VIEWS.SETTING
]);

export const defaultState = {
  members: [],
  instruments: [],
  protocols: [],
  projects: [],
  workflows: [],
  workflowTemplates: [],
  journalClubs: [],
  papers: [],
  paperExperimentLinks: [],
  knowledgeChats: {},
  paperAgentChatSessions: {},
  agentChat: {
    projectId: '',
    deepResearchEnabled: false,
    currentSessionId: '',
    sessions: [],
    messages: []
  },
  messages: [],
  growthMetrics: {
    counters: {
      protocol_share_sent: 0,
      protocol_share_imported: 0,
      protocol_share_link_copied: 0,
      protocol_share_link_imported: 0
    },
    events: []
  },
  notebookEntries: [],
  synthesisChemistryDrafts: {},
  assays: [],
  gelAnalyses: [],
  samples: [],
  objectGraph: {
    nodes: {},
    edges: [],
    backlinks: {},
    updatedAt: ''
  },
  labInventory: {
    chemicals: [],
    blocks: [],
    lastLocationNumber: 0,
    locationCodeMap: {},
    locationCodeNextByLocation: {}
  },
  settings: {
    personalInfo: {
      name: '',
      position: '',
      institutionEmail: '',
      enanaEmail: ''
    },
    appearance: {
      fontSize: 16,
      themeColor: '#2688ff',
      mode: 'day',
      uiStyle: 'neutral-compact'
    },
    storagePath: '',
    pendingNotebookSampleCapture: null,
    storageImport: {
      lastImportedAt: '',
      manifestPath: '',
      summary: {
        bundles: 0,
        protocols: 0,
        notebookEntries: 0,
        workflowTemplates: 0,
        workflows: 0,
        papers: 0,
        chemicals: 0,
        personalInventoryContainers: 0,
        sequenceEntries: 0
      },
      warnings: [],
      error: ''
    },
    llm: {
      provider: DEFAULT_LLM_PROVIDER,
      model: '',
      reasoningEffort: '',
      api: '',
      apiEndpoint: DEFAULT_LLM_ENDPOINTS[DEFAULT_LLM_PROVIDER],
      apiKey: ''
    },
    agent: {
      developerMode: false,
      externalSkillsEnabled: true,
      disabledExternalSkillNames: []
    },
    inventoryLocations: ['Main Storage', 'Cold Room', 'Fume Hood'],
    dashboard: {
      currentWorkflowId: '',
      workflowProgress: {},
      quickLogDraft: '',
      quickLogEntries: [],
      incubationLocations: [],
      timerTemplates: [],
      activeTimers: []
    },
    startup: {
      defaultViewId: VIEWS.HOME,
      rememberLastView: false
    }
  },
  inventory: {
    'Room Temp': [],
    '4 Degree': [],
    '-20 Degree': [],
    '-80 Degree': [],
    'Liquid Nitrogen': []
  }
};

function normalizeCellPassage(rawValue) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const lastPassageDate = String(rawValue.lastPassageDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastPassageDate)) {
    return null;
  }
  const intervalDays = Math.round(Number(rawValue.intervalDays));
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    return null;
  }
  const normalized = {
    lastPassageDate,
    intervalDays
  };
  const passageNumber = Math.round(Number(rawValue.passageNumber));
  if (Number.isFinite(passageNumber) && passageNumber > 0) {
    normalized.passageNumber = passageNumber;
  }
  const deferredUntilDate = String(rawValue.deferredUntilDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(deferredUntilDate)) {
    normalized.deferredUntilDate = deferredUntilDate;
  }
  return normalized;
}

function normalizeSampleRecord(rawSample) {
  if (!rawSample || typeof rawSample !== 'object') {
    return rawSample;
  }
  const type = String(rawSample.type || '').trim().toLowerCase();
  if (type === 'cell_line') {
    return {
      ...rawSample,
      cellPassage: normalizeCellPassage(rawSample.cellPassage)
    };
  }
  if (Object.prototype.hasOwnProperty.call(rawSample, 'cellPassage')) {
    const { cellPassage, ...rest } = rawSample;
    return rest;
  }
  return rawSample;
}

function normalizeDashboardDateString(rawValue) {
  const value = String(rawValue || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function normalizeDashboardIncubationLocations(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  const seen = new Set();
  const locations = [];
  rawValue.forEach((item) => {
    const rawName = item && typeof item === 'object' && !Array.isArray(item)
      ? item.name
      : item;
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) {
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    locations.push({
      name,
      reminderDate: item && typeof item === 'object' && !Array.isArray(item)
        ? normalizeDashboardDateString(item.reminderDate || item.remindOnDate)
        : ''
    });
  });
  return locations;
}

function normalizeDashboardTimerTemplates(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    const durationMinutes = Math.round(Number(item.durationMinutes || item.minutes));
    if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }
    return {
      name,
      durationMinutes
    };
  }).filter(Boolean);
}

function normalizeDashboardActiveTimers(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    const durationMinutes = Math.round(Number(item.durationMinutes || item.minutes));
    const startedAtMs = Number(item.startedAtMs || item.startedAt || 0);
    const endAtMs = Number(item.endAtMs || item.endAt || 0);
    if (
      !name
      || !Number.isFinite(durationMinutes)
      || durationMinutes <= 0
      || !Number.isFinite(startedAtMs)
      || startedAtMs <= 0
      || !Number.isFinite(endAtMs)
      || endAtMs <= startedAtMs
    ) {
      return null;
    }
    return {
      name,
      durationMinutes,
      startedAtMs,
      endAtMs
    };
  }).filter(Boolean);
}

function normalizeDashboardQuickLogEntries(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const id = String(item.id || '').trim();
    const text = String(item.text || item.note || '').trim();
    const createdAt = String(item.createdAt || item.updatedAt || '').trim();
    const updatedAt = String(item.updatedAt || item.createdAt || '').trim() || createdAt;
    if (!id || !text || Number.isNaN(Date.parse(createdAt))) {
      return null;
    }
    return {
      id,
      text,
      createdAt,
      updatedAt
    };
  }).filter(Boolean).slice(-500);
}

function normalizeWorkflowProgressMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }
  const normalized = {};
  Object.entries(rawValue).forEach(([workflowId, rawBlockIds]) => {
    const key = String(workflowId || '').trim();
    if (!key) {
      return;
    }
    const seen = new Set();
    const blockIds = [];
    (Array.isArray(rawBlockIds) ? rawBlockIds : []).forEach((blockId) => {
      const normalizedId = String(blockId || '').trim();
      if (!normalizedId || seen.has(normalizedId)) {
        return;
      }
      seen.add(normalizedId);
      blockIds.push(normalizedId);
    });
    normalized[key] = blockIds;
  });
  return normalized;
}

function clampUnitInterval(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }
  return Math.min(Math.max(numeric, 0), 1);
}

export function normalizePaperComment(rawComment) {
  if (!rawComment || typeof rawComment !== 'object' || Array.isArray(rawComment)) {
    return null;
  }

  const id = String(rawComment.id || '').trim();
  const pageNumber = Math.round(Number(rawComment.pageNumber));
  const anchorX = clampUnitInterval(rawComment.anchorX);
  const anchorY = clampUnitInterval(rawComment.anchorY);
  const highlightId = String(rawComment.highlightId || '').trim();
  const text = String(rawComment.text || '').trim();
  const hasAnchor = Number.isFinite(anchorX) && Number.isFinite(anchorY);
  if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || (!hasAnchor && !highlightId) || !text) {
    return null;
  }

  const createdAt = String(rawComment.createdAt || rawComment.updatedAt || '').trim();
  const updatedAt = String(rawComment.updatedAt || rawComment.createdAt || '').trim();

  return {
    ...rawComment,
    id,
    pageNumber,
    ...(hasAnchor ? { anchorX, anchorY } : {}),
    ...(highlightId ? { highlightId } : {}),
    text,
    author: String(rawComment.author || 'Local user').trim() || 'Local user',
    createdAt,
    updatedAt
  };
}

export function normalizePaperHighlight(rawHighlight) {
  if (!rawHighlight || typeof rawHighlight !== 'object' || Array.isArray(rawHighlight)) {
    return null;
  }

  const id = String(rawHighlight.id || '').trim();
  const pageNumber = Math.round(Number(rawHighlight.pageNumber));
  const text = String(rawHighlight.text || '').trim();
  const kind = String(rawHighlight.kind || rawHighlight.type || '').trim().toLowerCase() === 'underline'
    ? 'underline'
    : 'highlight';
  const boxes = (Array.isArray(rawHighlight.boxes) ? rawHighlight.boxes : [])
    .map((box) => {
      if (!box || typeof box !== 'object' || Array.isArray(box)) {
        return null;
      }
      const x = clampUnitInterval(box.x);
      const y = clampUnitInterval(box.y);
      const width = clampUnitInterval(box.width);
      const height = clampUnitInterval(box.height);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
      }
      const normalizedWidth = Math.max(Math.min(width, 1 - x), 0);
      const normalizedHeight = Math.max(Math.min(height, 1 - y), 0);
      if (normalizedWidth <= 0 || normalizedHeight <= 0) {
        return null;
      }
      return {
        x,
        y,
        width: normalizedWidth,
        height: normalizedHeight
      };
    })
    .filter(Boolean);

  if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !text || !boxes.length) {
    return null;
  }

  const createdAt = String(rawHighlight.createdAt || rawHighlight.updatedAt || '').trim();
  const updatedAt = String(rawHighlight.updatedAt || rawHighlight.createdAt || '').trim();

  return {
    ...rawHighlight,
    id,
    pageNumber,
    text,
    kind,
    boxes,
    createdAt,
    updatedAt
  };
}

export function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object' || Array.isArray(rawPaper)) {
    return rawPaper;
  }

  const hasStoredPdfReference = Boolean(String(rawPaper.storedFilePath || '').trim())
    || Boolean(String(rawPaper.storedRelativePath || '').trim());

  return {
    ...rawPaper,
    pdfDataUrl: hasStoredPdfReference ? '' : String(rawPaper.pdfDataUrl || ''),
    highlights: Array.isArray(rawPaper.highlights)
      ? rawPaper.highlights.map((highlight) => normalizePaperHighlight(highlight)).filter(Boolean)
      : [],
    comments: Array.isArray(rawPaper.comments)
      ? rawPaper.comments.map((comment) => normalizePaperComment(comment)).filter(Boolean)
      : []
  };
}

export function normalizeState(parsed) {
  const source = parsed || {};
  const rawSettings = source.settings && typeof source.settings === 'object'
    ? source.settings
    : {};
  const rawPersonalInfo = rawSettings.personalInfo && typeof rawSettings.personalInfo === 'object'
    ? rawSettings.personalInfo
    : {};
  const rawAppearance = rawSettings.appearance && typeof rawSettings.appearance === 'object'
    ? rawSettings.appearance
    : {};
  const rawStorageImport = rawSettings.storageImport && typeof rawSettings.storageImport === 'object'
    ? rawSettings.storageImport
    : {};
  const rawLlm = rawSettings.llm && typeof rawSettings.llm === 'object'
    ? rawSettings.llm
    : {};
  const rawAgent = rawSettings.agent && typeof rawSettings.agent === 'object'
    ? rawSettings.agent
    : {};
  const rawDisabledExternalSkillNames = Array.isArray(rawAgent.disabledExternalSkillNames)
    ? rawAgent.disabledExternalSkillNames
    : (Array.isArray(rawAgent.disabled_external_skill_names) ? rawAgent.disabled_external_skill_names : null);
  const rawDashboard = rawSettings.dashboard && typeof rawSettings.dashboard === 'object'
    ? rawSettings.dashboard
    : {};
  const rawStartup = rawSettings.startup && typeof rawSettings.startup === 'object'
    ? rawSettings.startup
    : {};
  const rawGrowthMetrics = source.growthMetrics && typeof source.growthMetrics === 'object'
    ? source.growthMetrics
    : {};
  const rawGrowthCounters = rawGrowthMetrics.counters && typeof rawGrowthMetrics.counters === 'object'
    ? rawGrowthMetrics.counters
    : {};
  const legacyApi = String(rawLlm.api || '').trim();
  const legacyApiLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacyApi);
  const legacyCodexMarker = legacyApi.toLowerCase().startsWith('codex://');
  const legacyEndpoint = legacyApiLooksLikeEndpoint && !legacyCodexMarker ? legacyApi : '';
  const legacyApiKey = legacyApi && !legacyApiLooksLikeEndpoint ? legacyApi : '';
  const llmProvider = normalizeLlmProvider(rawLlm.provider, rawLlm.apiEndpoint || legacyApi || legacyEndpoint);
  const llmModel = String(rawLlm.model || '').trim();
  const llmEndpoint = llmProvider === 'codex'
    ? ''
    : (String(rawLlm.apiEndpoint || legacyEndpoint || '').trim()
      || defaultLlmEndpointForProvider(llmProvider));
  const llmReasoningEffort = normalizeReasoningEffort(
    llmProvider,
    llmModel,
    rawLlm.reasoningEffort,
    llmEndpoint
  );

  return {
    ...structuredClone(defaultState),
    ...source,
    instruments: Array.isArray(source.instruments) ? source.instruments : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    workflows: Array.isArray(source.workflows) ? source.workflows : [],
    workflowTemplates: Array.isArray(source.workflowTemplates) ? source.workflowTemplates : [],
    journalClubs: Array.isArray(source.journalClubs) ? source.journalClubs : [],
    papers: Array.isArray(source.papers) ? source.papers.map((paper) => normalizePaperRecord(paper)) : [],
    paperExperimentLinks: Array.isArray(source.paperExperimentLinks) ? source.paperExperimentLinks : [],
    knowledgeChats: source.knowledgeChats && typeof source.knowledgeChats === 'object' ? source.knowledgeChats : {},
    agentChat: {
      ...defaultState.agentChat,
      ...(source.agentChat && typeof source.agentChat === 'object' ? source.agentChat : {}),
      projectId: String(source.agentChat?.projectId || ''),
      deepResearchEnabled: source.agentChat?.deepResearchEnabled === true,
      currentSessionId: String(source.agentChat?.currentSessionId || ''),
      sessions: Array.isArray(source.agentChat?.sessions) ? source.agentChat.sessions : [],
      messages: Array.isArray(source.agentChat?.messages) ? source.agentChat.messages : []
    },
    paperAgentChatSessions: normalizePaperAgentChatSessions(source.paperAgentChatSessions),
    notebookEntries: Array.isArray(source.notebookEntries) ? source.notebookEntries : [],
    synthesisChemistryDrafts:
      source.synthesisChemistryDrafts && typeof source.synthesisChemistryDrafts === 'object'
        ? source.synthesisChemistryDrafts
        : {},
    assays: Array.isArray(source.assays) ? source.assays : [],
    gelAnalyses: Array.isArray(source.gelAnalyses) ? source.gelAnalyses : [],
    samples: (Array.isArray(source.samples) ? source.samples : []).map((sample) => normalizeSampleRecord(sample)),
    growthMetrics: {
      ...defaultState.growthMetrics,
      ...rawGrowthMetrics,
      counters: {
        ...defaultState.growthMetrics.counters,
        ...rawGrowthCounters,
        protocol_share_sent: Number(rawGrowthCounters.protocol_share_sent) || 0,
        protocol_share_imported: Number(rawGrowthCounters.protocol_share_imported) || 0,
        protocol_share_link_copied: Number(rawGrowthCounters.protocol_share_link_copied) || 0,
        protocol_share_link_imported: Number(rawGrowthCounters.protocol_share_link_imported) || 0
      },
      events: Array.isArray(rawGrowthMetrics.events) ? rawGrowthMetrics.events : []
    },
    objectGraph: {
      ...defaultState.objectGraph,
      ...(source.objectGraph || {})
    },
    messages: Array.isArray(source.messages) ? source.messages : [],
    labInventory: {
      ...defaultState.labInventory,
      ...(source.labInventory || {})
    },
    settings: {
      ...structuredClone(defaultState.settings),
      storagePath: String(rawSettings.storagePath || '').trim(),
      personalInfo: {
        ...defaultState.settings.personalInfo,
        ...rawPersonalInfo
      },
      appearance: {
        ...defaultState.settings.appearance,
        ...rawAppearance
      },
      storageImport: {
        ...defaultState.settings.storageImport,
        ...rawStorageImport,
        summary: {
          ...defaultState.settings.storageImport.summary,
          ...(rawStorageImport.summary && typeof rawStorageImport.summary === 'object'
            ? rawStorageImport.summary
            : {})
        },
        warnings: Array.isArray(rawStorageImport.warnings)
          ? rawStorageImport.warnings
          : defaultState.settings.storageImport.warnings,
        lastImportedAt: String(rawStorageImport.lastImportedAt || ''),
        manifestPath: String(rawStorageImport.manifestPath || ''),
        error: String(rawStorageImport.error || '')
      },
      dashboard: {
        ...defaultState.settings.dashboard,
        ...rawDashboard,
        currentWorkflowId: String(rawDashboard.currentWorkflowId || ''),
        workflowProgress: normalizeWorkflowProgressMap(rawDashboard.workflowProgress),
        quickLogDraft: String(rawDashboard.quickLogDraft || ''),
        quickLogEntries: normalizeDashboardQuickLogEntries(rawDashboard.quickLogEntries),
        incubationLocations: normalizeDashboardIncubationLocations(rawDashboard.incubationLocations),
        timerTemplates: normalizeDashboardTimerTemplates(rawDashboard.timerTemplates),
        activeTimers: normalizeDashboardActiveTimers(rawDashboard.activeTimers)
      },
      startup: {
        ...defaultState.settings.startup,
        defaultViewId: STARTUP_DEFAULT_VIEW_IDS.has(String(rawStartup.defaultViewId || '').trim())
          ? String(rawStartup.defaultViewId || '').trim()
          : defaultState.settings.startup.defaultViewId,
        rememberLastView: typeof rawStartup.rememberLastView === 'boolean'
          ? rawStartup.rememberLastView
          : defaultState.settings.startup.rememberLastView
      },
      llm: {
        ...defaultState.settings.llm,
        ...rawLlm,
        provider: llmProvider,
        model: llmModel,
        reasoningEffort: llmReasoningEffort,
        apiEndpoint: llmEndpoint,
        apiKey: llmProvider === 'codex' ? '' : String(rawLlm.apiKey || legacyApiKey).trim(),
        api: legacyApi
      },
      agent: {
        ...defaultState.settings.agent,
        ...rawAgent,
        developerMode: rawAgent.developerMode === true,
        externalSkillsEnabled: rawAgent.externalSkillsEnabled !== false && rawAgent.external_skills_enabled !== false,
        disabledExternalSkillNames: rawDisabledExternalSkillNames
          ? rawDisabledExternalSkillNames.map((item) => String(item || '').trim()).filter(Boolean)
          : defaultState.settings.agent.disabledExternalSkillNames
      },
      inventoryLocations: Array.isArray(rawSettings.inventoryLocations)
        ? rawSettings.inventoryLocations
        : defaultState.settings.inventoryLocations
    },
    inventory: {
      ...defaultState.inventory,
      ...(source.inventory || {})
    }
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw ? normalizeState(JSON.parse(raw)) : structuredClone(defaultState);
    const hasDrafts = state.synthesisChemistryDrafts && Object.keys(state.synthesisChemistryDrafts).length > 0;
    if (hasDrafts) {
      return state;
    }

    const legacyRaw = localStorage.getItem(LEGACY_CHEMISTRY_DRAFT_KEY);
    if (!legacyRaw) {
      return state;
    }

    const legacyDrafts = JSON.parse(legacyRaw);
    if (!legacyDrafts || typeof legacyDrafts !== 'object' || Array.isArray(legacyDrafts)) {
      localStorage.removeItem(LEGACY_CHEMISTRY_DRAFT_KEY);
      return state;
    }

    state.synthesisChemistryDrafts = legacyDrafts;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_CHEMISTRY_DRAFT_KEY);
    return state;
  } catch {
    return structuredClone(defaultState);
  }
}

export function persistState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function trackGrowthEvent(state, name, props = {}) {
  if (!state || typeof state !== 'object') {
    return;
  }

  if (!state.growthMetrics || typeof state.growthMetrics !== 'object') {
    state.growthMetrics = structuredClone(defaultState.growthMetrics);
  }

  if (!state.growthMetrics.counters || typeof state.growthMetrics.counters !== 'object') {
    state.growthMetrics.counters = { ...defaultState.growthMetrics.counters };
  }

  if (!Array.isArray(state.growthMetrics.events)) {
    state.growthMetrics.events = [];
  }

  const counterEvents = new Set([
    'protocol_share_sent',
    'protocol_share_imported',
    'protocol_share_link_copied',
    'protocol_share_link_imported'
  ]);

  if (counterEvents.has(name)) {
    const current = Number(state.growthMetrics.counters[name]) || 0;
    state.growthMetrics.counters[name] = current + 1;
  }

  state.growthMetrics.events.push({
    id: createId(),
    name: String(name || 'unknown'),
    props: props && typeof props === 'object' ? { ...props } : {},
    createdAt: new Date().toISOString()
  });

  if (state.growthMetrics.events.length > 500) {
    state.growthMetrics.events = state.growthMetrics.events.slice(-500);
  }
}
