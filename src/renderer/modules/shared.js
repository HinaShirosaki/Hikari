export const VIEWS = {
  HOME: 'home-view',
  LAB_MANAGEMENT: 'lab-management-view',
  INSTRUMENT_MANAGEMENT: 'instrument-management-view',
  PROTOCOL_MANAGEMENT: 'protocol-management-view',
  COLLABORATION_MANAGEMENT: 'collaboration-management-view',
  SYNTHESIS_NOTEBOOK: 'synthesis-notebook-view',
  BIOLOGY_NOTEBOOK: 'biology-notebook-view',
  LAB_COMMON_INVENTORY: 'lab-common-inventory-view',
  SAMPLE_REGISTRY: 'sample-registry-view',
  ASSAY: 'assay-view',
  GEL: 'gel-view',
  PERSONAL_INVENTORY: 'personal-inventory-view',
  SETTING: 'setting-view',
  PROJECT_MANAGEMENT: 'project-management-view',
  WORKFLOW_MANAGEMENT: 'workflow-management-view',
  PAPERS: 'papers-view',
  AGENT: 'agent-view',
  SEQUENCE_VIEWER: 'sequence-viewer-view',
  TOOL_BOX: 'tool-box-view'
};

export const TITLES = {
  [VIEWS.HOME]: 'Dashboard overview, reminders, and app launcher.',
  [VIEWS.LAB_MANAGEMENT]: 'Manage members in card view.',
  [VIEWS.INSTRUMENT_MANAGEMENT]: 'Manage instruments and reservations by calendar.',
  [VIEWS.PROTOCOL_MANAGEMENT]: 'Create and edit protocols step by step.',
  [VIEWS.COLLABORATION_MANAGEMENT]: 'Collabrations module.',
  [VIEWS.SYNTHESIS_NOTEBOOK]: 'Synthesis notebook for chemistry workflows.',
  [VIEWS.BIOLOGY_NOTEBOOK]: 'Biology notebook for wet lab workflows.',
  [VIEWS.LAB_COMMON_INVENTORY]: 'Chemicals module.',
  [VIEWS.SAMPLE_REGISTRY]: 'Manage sample registry and personal inventory containers in one workspace.',
  [VIEWS.ASSAY]: 'Create assay plates or open existing assay numbers to paste spreadsheet results and analyze.',
  [VIEWS.GEL]: 'Analyze SDS-PAGE or Western blot gels with lane/band quantification and interpretation.',
  [VIEWS.PERSONAL_INVENTORY]: 'Manage sample registry and personal inventory containers in one workspace.',
  [VIEWS.SETTING]: 'Settings module.',
  [VIEWS.PROJECT_MANAGEMENT]: 'Manage projects for notebook context.',
  [VIEWS.WORKFLOW_MANAGEMENT]: 'Build editable workflows with protocol/text blocks and reusable templates.',
  [VIEWS.PAPERS]: 'Upload papers, link them to projects or journal clubs, and summarize with LLM.',
  [VIEWS.AGENT]: 'Ask the lab assistant agent with evidence-grounded context and decision records.',
  [VIEWS.SEQUENCE_VIEWER]: 'Load FASTA/FASTQ/GenBank or pasted sequence and inspect records with feature overlays.',
  [VIEWS.TOOL_BOX]: 'Tools: molarity calculator, peptide properties, and buffer preparer.'
};

export const STORAGE_KEY = 'enana_state_v1';
const LEGACY_CHEMISTRY_DRAFT_KEY = 'enana_synthesis_chemistry_draft_v1';
export const LLM_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  GEMINI: 'gemini',
  CLAUDE: 'claude',
  CODEX: 'codex'
});
export const DEFAULT_LLM_PROVIDER = LLM_PROVIDERS.OPENAI;
export const LLM_DEFAULT_ENDPOINTS = Object.freeze({
  [LLM_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/responses',
  [LLM_PROVIDERS.GEMINI]: 'https://generativelanguage.googleapis.com/v1beta',
  [LLM_PROVIDERS.CLAUDE]: 'https://api.anthropic.com/v1/messages',
  [LLM_PROVIDERS.CODEX]: 'codex://cli'
});

export function inferLlmProviderFromEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('openai-cli')) {
    return LLM_PROVIDERS.CODEX;
  }
  if (value.includes('anthropic.com')) {
    return LLM_PROVIDERS.CLAUDE;
  }
  if (value.includes('generativelanguage.googleapis.com') || value.includes('ai.google')) {
    return LLM_PROVIDERS.GEMINI;
  }
  if (value.includes('openai.com') || value.includes('/openai/')) {
    return LLM_PROVIDERS.OPENAI;
  }
  return '';
}

export function normalizeLlmProvider(provider, endpoint = '') {
  const clean = String(provider || '').trim().toLowerCase();
  if (Object.values(LLM_PROVIDERS).includes(clean)) {
    return clean;
  }
  return inferLlmProviderFromEndpoint(endpoint) || DEFAULT_LLM_PROVIDER;
}

export function defaultLlmEndpointForProvider(provider) {
  const resolved = normalizeLlmProvider(provider);
  return LLM_DEFAULT_ENDPOINTS[resolved] || LLM_DEFAULT_ENDPOINTS[DEFAULT_LLM_PROVIDER];
}

const STARTUP_DEFAULT_VIEW_IDS = new Set([
  VIEWS.HOME,
  VIEWS.LAB_MANAGEMENT,
  VIEWS.INSTRUMENT_MANAGEMENT,
  VIEWS.PROTOCOL_MANAGEMENT,
  VIEWS.COLLABORATION_MANAGEMENT,
  VIEWS.SYNTHESIS_NOTEBOOK,
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
  agentChat: {
    projectId: '',
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
    storageImport: {
      lastImportedAt: '',
      manifestPath: '',
      summary: {
        bundles: 0,
        protocols: 0,
        notebookEntries: 0,
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
      api: '',
      apiEndpoint: LLM_DEFAULT_ENDPOINTS[DEFAULT_LLM_PROVIDER],
      apiKey: ''
    },
    agent: {
      developerMode: false
    },
    enaFilePath: '',
    autoSaveEna: true,
    inventoryLocations: ['Main Storage', 'Cold Room', 'Fume Hood'],
    dashboard: {
      currentWorkflowId: '',
      workflowProgress: {}
    },
    startup: {
      defaultViewId: VIEWS.HOME,
      rememberLastView: false,
      autoLoadDataFileOnLaunch: true
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
  return {
    lastPassageDate,
    intervalDays
  };
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

export function normalizeState(parsed) {
  const source = parsed || {};
  const rawLlm = source.settings?.llm || {};
  const rawAgent = source.settings?.agent && typeof source.settings.agent === 'object'
    ? source.settings.agent
    : {};
  const rawStartup = source.settings?.startup && typeof source.settings.startup === 'object'
    ? source.settings.startup
    : {};
  const rawStorageImport = source.settings?.storageImport && typeof source.settings.storageImport === 'object'
    ? source.settings.storageImport
    : {};
  const rawGrowthMetrics = source.growthMetrics && typeof source.growthMetrics === 'object'
    ? source.growthMetrics
    : {};
  const rawGrowthCounters = rawGrowthMetrics.counters && typeof rawGrowthMetrics.counters === 'object'
    ? rawGrowthMetrics.counters
    : {};
  const legacyApi = String(rawLlm.api || '').trim();
  const legacyApiLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacyApi);
  const legacyEndpoint = legacyApiLooksLikeEndpoint ? legacyApi : '';
  const legacyApiKey = legacyApi && !legacyApiLooksLikeEndpoint ? legacyApi : '';
  const llmProvider = normalizeLlmProvider(rawLlm.provider, rawLlm.apiEndpoint || legacyEndpoint);
  const llmEndpoint = String(rawLlm.apiEndpoint || legacyEndpoint || '').trim()
    || defaultLlmEndpointForProvider(llmProvider);

  return {
    ...structuredClone(defaultState),
    ...source,
    instruments: Array.isArray(source.instruments) ? source.instruments : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    workflows: Array.isArray(source.workflows) ? source.workflows : [],
    workflowTemplates: Array.isArray(source.workflowTemplates) ? source.workflowTemplates : [],
    journalClubs: Array.isArray(source.journalClubs) ? source.journalClubs : [],
    papers: Array.isArray(source.papers) ? source.papers : [],
    paperExperimentLinks: Array.isArray(source.paperExperimentLinks) ? source.paperExperimentLinks : [],
    knowledgeChats: source.knowledgeChats && typeof source.knowledgeChats === 'object' ? source.knowledgeChats : {},
    agentChat: {
      ...defaultState.agentChat,
      ...(source.agentChat && typeof source.agentChat === 'object' ? source.agentChat : {}),
      projectId: String(source.agentChat?.projectId || ''),
      currentSessionId: String(source.agentChat?.currentSessionId || ''),
      sessions: Array.isArray(source.agentChat?.sessions) ? source.agentChat.sessions : [],
      messages: Array.isArray(source.agentChat?.messages) ? source.agentChat.messages : []
    },
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
      ...defaultState.settings,
      ...(source.settings || {}),
      personalInfo: {
        ...defaultState.settings.personalInfo,
        ...(source.settings?.personalInfo || {})
      },
      appearance: {
        ...defaultState.settings.appearance,
        ...(source.settings?.appearance || {})
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
        ...(source.settings?.dashboard || {}),
        currentWorkflowId: String(source.settings?.dashboard?.currentWorkflowId || ''),
        workflowProgress: normalizeWorkflowProgressMap(source.settings?.dashboard?.workflowProgress)
      },
      startup: {
        ...defaultState.settings.startup,
        ...rawStartup,
        defaultViewId: STARTUP_DEFAULT_VIEW_IDS.has(String(rawStartup.defaultViewId || '').trim())
          ? String(rawStartup.defaultViewId || '').trim()
          : defaultState.settings.startup.defaultViewId,
        rememberLastView: typeof rawStartup.rememberLastView === 'boolean'
          ? rawStartup.rememberLastView
          : defaultState.settings.startup.rememberLastView,
        autoLoadDataFileOnLaunch: typeof rawStartup.autoLoadDataFileOnLaunch === 'boolean'
          ? rawStartup.autoLoadDataFileOnLaunch
          : defaultState.settings.startup.autoLoadDataFileOnLaunch
      },
      llm: {
        ...defaultState.settings.llm,
        ...rawLlm,
        provider: llmProvider,
        apiEndpoint: llmEndpoint,
        apiKey: String(rawLlm.apiKey || legacyApiKey).trim(),
        api: legacyApi
      },
      agent: {
        ...defaultState.settings.agent,
        ...rawAgent,
        developerMode: rawAgent.developerMode === true
      },
      inventoryLocations: Array.isArray(source.settings?.inventoryLocations)
        ? source.settings.inventoryLocations
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

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export function safeText(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entityMap[char] || char;
  });
}

export function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}
