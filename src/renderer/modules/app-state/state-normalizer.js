import {
  defaultLlmEndpointForProvider,
  normalizeAgentLlmProvider,
  normalizeReasoningEffort
} from '../llm-provider-config.generated.js';
import { normalizePaperAgentChatSessions } from '../agent-chat/scoped-state.js';
import {
  normalizeSampleInventoryLocations,
  normalizeSampleTypeLabels
} from '../sample-inventory-settings.js';
import { defaultState, STARTUP_DEFAULT_VIEW_IDS } from './defaults.js';
import { normalizeAppearanceMode } from './appearance.js';
import {
  normalizeDashboardActiveTimers,
  normalizeDashboardIncubationLocations,
  normalizeDashboardPassageReminders,
  normalizeDashboardQuickLogEntries,
  normalizeDashboardTimerTemplates,
  normalizeWorkflowProgressMap
} from './dashboard-normalizers.js';
import { normalizePaperRecord } from './paper-normalizers.js';
import { normalizeSampleRecord } from './sample-normalizers.js';

export { defaultState };

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLlmSettings(rawLlm) {
  const legacyApi = String(rawLlm.api || '').trim();
  const legacyApiLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacyApi);
  const legacyCodexMarker = legacyApi.toLowerCase().startsWith('codex://');
  const legacyEndpoint = legacyApiLooksLikeEndpoint && !legacyCodexMarker ? legacyApi : '';
  const legacyApiKey = legacyApi && !legacyApiLooksLikeEndpoint ? legacyApi : '';
  const provider = normalizeAgentLlmProvider(rawLlm.provider, rawLlm.apiEndpoint || legacyApi || legacyEndpoint);
  const model = String(rawLlm.model || '').trim();
  const apiEndpoint = provider === 'codex'
    ? ''
    : (String(rawLlm.apiEndpoint || legacyEndpoint || '').trim() || defaultLlmEndpointForProvider(provider));
  return {
    ...defaultState.settings.llm,
    ...rawLlm,
    provider,
    model,
    reasoningEffort: normalizeReasoningEffort(provider, model, rawLlm.reasoningEffort, apiEndpoint),
    apiEndpoint,
    apiKey: provider === 'codex' ? '' : String(rawLlm.apiKey || legacyApiKey).trim(),
    api: legacyApi
  };
}

function normalizeSettings(source) {
  const rawSettings = asObject(source.settings);
  const rawPersonalInfo = asObject(rawSettings.personalInfo);
  const rawAppearance = asObject(rawSettings.appearance);
  const rawStorageImport = asObject(rawSettings.storageImport);
  const rawLlm = asObject(rawSettings.llm);
  const rawAgent = asObject(rawSettings.agent);
  const rawDashboard = asObject(rawSettings.dashboard);
  const rawStartup = asObject(rawSettings.startup);
  const rawDisabledExternalSkillNames = Array.isArray(rawAgent.disabledExternalSkillNames)
    ? rawAgent.disabledExternalSkillNames
    : (Array.isArray(rawAgent.disabled_external_skill_names) ? rawAgent.disabled_external_skill_names : null);

  return {
    ...structuredClone(defaultState.settings),
    storagePath: String(rawSettings.storagePath || '').trim(),
    personalInfo: {
      ...defaultState.settings.personalInfo,
      ...rawPersonalInfo
    },
    appearance: {
      ...defaultState.settings.appearance,
      ...rawAppearance,
      mode: normalizeAppearanceMode(rawAppearance.mode)
    },
    storageImport: {
      ...defaultState.settings.storageImport,
      ...rawStorageImport,
      summary: {
        ...defaultState.settings.storageImport.summary,
        ...asObject(rawStorageImport.summary)
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
      passageReminders: normalizeDashboardPassageReminders(rawDashboard.passageReminders),
      legacyPassageSamplesMigrated: rawDashboard.legacyPassageSamplesMigrated === true,
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
    llm: normalizeLlmSettings(rawLlm),
    agent: {
      ...defaultState.settings.agent,
      ...rawAgent,
      developerMode: rawAgent.developerMode === true,
      externalSkillsEnabled: rawAgent.externalSkillsEnabled !== false
        && rawAgent.external_skills_enabled !== false,
      disabledExternalSkillNames: rawDisabledExternalSkillNames
        ? rawDisabledExternalSkillNames.map((item) => String(item || '').trim()).filter(Boolean)
        : defaultState.settings.agent.disabledExternalSkillNames
    },
    inventoryLocations: Array.isArray(rawSettings.inventoryLocations)
      ? rawSettings.inventoryLocations
      : defaultState.settings.inventoryLocations,
    sampleInventoryLocations: normalizeSampleInventoryLocations(rawSettings.sampleInventoryLocations),
    sampleTypeLabels: normalizeSampleTypeLabels(rawSettings.sampleTypeLabels),
    preferredJournal: String(rawSettings.preferredJournal || '').trim()
  };
}

function normalizeGrowthMetrics(source) {
  const rawGrowthMetrics = asObject(source.growthMetrics);
  const rawGrowthCounters = asObject(rawGrowthMetrics.counters);
  return {
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
  };
}

export function normalizeState(parsed) {
  const source = parsed || {};
  return {
    ...structuredClone(defaultState),
    ...source,
    members: Array.isArray(source.members) ? source.members : [],
    instruments: Array.isArray(source.instruments) ? source.instruments : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    workflows: Array.isArray(source.workflows) ? source.workflows : [],
    workflowTemplates: Array.isArray(source.workflowTemplates) ? source.workflowTemplates : [],
    journalClubs: Array.isArray(source.journalClubs) ? source.journalClubs : [],
    papers: Array.isArray(source.papers) ? source.papers.map((paper) => normalizePaperRecord(paper)) : [],
    paperExperimentLinks: Array.isArray(source.paperExperimentLinks) ? source.paperExperimentLinks : [],
    knowledgeChats: asObject(source.knowledgeChats),
    agentChat: {
      ...defaultState.agentChat,
      projectId: String(source.agentChat?.projectId || ''),
      currentSessionId: String(source.agentChat?.currentSessionId || ''),
      sessions: Array.isArray(source.agentChat?.sessions) ? source.agentChat.sessions : [],
      messages: Array.isArray(source.agentChat?.messages) ? source.agentChat.messages : []
    },
    paperAgentChatSessions: normalizePaperAgentChatSessions(source.paperAgentChatSessions),
    notebookEntries: Array.isArray(source.notebookEntries) ? source.notebookEntries : [],
    synthesisChemistryDrafts: asObject(source.synthesisChemistryDrafts),
    assays: Array.isArray(source.assays) ? source.assays : [],
    gelAnalyses: Array.isArray(source.gelAnalyses) ? source.gelAnalyses : [],
    samples: (Array.isArray(source.samples) ? source.samples : []).map((sample) => normalizeSampleRecord(sample)),
    growthMetrics: normalizeGrowthMetrics(source),
    messages: Array.isArray(source.messages) ? source.messages : [],
    labInventory: {
      ...defaultState.labInventory,
      ...asObject(source.labInventory)
    },
    settings: normalizeSettings(source),
    inventory: {
      ...defaultState.inventory,
      ...asObject(source.inventory)
    }
  };
}
