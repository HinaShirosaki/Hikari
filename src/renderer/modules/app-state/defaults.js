import {
  DEFAULT_AGENT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS
} from '../llm-provider-config.generated.js';
import { VIEWS } from '../views.js';
import {
  DEFAULT_SAMPLE_INVENTORY_LOCATIONS,
  DEFAULT_SAMPLE_TYPE_LABELS
} from '../sample-inventory-settings.js';

export const STARTUP_DEFAULT_VIEW_IDS = new Set([
  VIEWS.HOME,
  VIEWS.PROTOCOL_MANAGEMENT,
  VIEWS.BIOLOGY_NOTEBOOK,
  VIEWS.LAB_COMMON_INVENTORY,
  VIEWS.SAMPLE_REGISTRY,
  VIEWS.ASSAY,
  VIEWS.GEL,
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
      hikariEmail: ''
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
      provider: DEFAULT_AGENT_LLM_PROVIDER,
      model: '',
      reasoningEffort: '',
      api: '',
      apiEndpoint: DEFAULT_LLM_ENDPOINTS[DEFAULT_AGENT_LLM_PROVIDER],
      apiKey: ''
    },
    agent: {
      developerMode: false,
      externalSkillsEnabled: true,
      disabledExternalSkillNames: []
    },
    inventoryLocations: ['Main Storage', 'Cold Room', 'Fume Hood'],
    sampleInventoryLocations: [...DEFAULT_SAMPLE_INVENTORY_LOCATIONS],
    sampleTypeLabels: { ...DEFAULT_SAMPLE_TYPE_LABELS },
    preferredJournals: [],
    preferredJournal: '',
    dashboard: {
      currentWorkflowId: '',
      workflowProgress: {},
      quickLogDraft: '',
      quickLogEntries: [],
      passageReminders: [],
      legacyPassageSamplesMigrated: false,
      incubationLocations: [],
      timerTemplates: [],
      activeTimers: []
    },
    startup: {
      defaultViewId: VIEWS.HOME,
      rememberLastView: false
    },
    plugins: []
  },
  inventory: {
    'Room Temp': [],
    '4 Degree': [],
    '-20 Degree': [],
    '-80 Degree': [],
    'Liquid Nitrogen': []
  }
};
