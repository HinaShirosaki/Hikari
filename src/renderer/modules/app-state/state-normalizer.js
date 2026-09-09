import {
  normalizeAgentLlmProvider,
  normalizeReasoningEffort
} from '../codex-model-catalog.generated.js';
import { normalizePaperAgentChatSessions } from './agent-chat-normalizer.js';
import {
  normalizeSampleInventoryLocations,
  normalizeSampleTypeHidden,
  normalizeSampleTypeLabels
} from '../../lib/inventory-settings.js';
import { defaultState, STARTUP_DEFAULT_VIEW_IDS } from './defaults.js';
import { normalizeAppearanceMode } from './appearance.js';
import { normalizePluginStorage } from '../../lib/plugin-storage.js';
import { mergeBundledPluginEntries } from '../../lib/bundled-plugins.js';
import { normalizePreferredJournalList } from '../../lib/preferred-journals.js';
import { normalizeNotebookPdfSettings } from '../../lib/notebook-pdf-settings.js';
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
import { migrateProteinBuilderCloningNotebookState } from '../sequence-viewer/protein-builder-cloning-notebook.js';

export { defaultState };

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLlmSettings(rawLlm) {
  const persistedCodexSettings = { ...rawLlm };
  delete persistedCodexSettings.api;
  delete persistedCodexSettings.apiEndpoint;
  delete persistedCodexSettings.apiKey;
  const provider = normalizeAgentLlmProvider();
  const model = String(rawLlm.model || '').trim();
  return {
    ...defaultState.settings.llm,
    ...persistedCodexSettings,
    provider,
    model,
    reasoningEffort: normalizeReasoningEffort(provider, model, rawLlm.reasoningEffort)
  };
}

function normalizePreferredJournals(rawSettings) {
  return Array.from(normalizePreferredJournalList([
    rawSettings.preferredJournals,
    rawSettings.preferred_journals,
    rawSettings.preferredJournal,
    rawSettings.preferred_journal
  ]));
}

function normalizePluginEntries(rawPlugins) {
  if (!Array.isArray(rawPlugins)) {
    return [];
  }
  const seenIds = new Set();
  return rawPlugins
    .map((entry) => {
      const raw = asObject(entry);
      // Only https survives here: the renderer grants allow-same-origin to
      // remote frames, so a persisted file:/http: URL must not reach one.
      let embedUrl = '';
      try {
        const parsed = new URL(String(raw.embedUrl || '').trim());
        embedUrl = parsed.protocol === 'https:' ? parsed.href : '';
      } catch {
        embedUrl = '';
      }
      // A service is local code (no embed/serve). Keep only well-formed
      // conversion pairs so a bad record cannot register a junk converter.
      let service = null;
      const rawConversions = asObject(raw.service).fileConversions;
      if (!embedUrl && !(raw.serve === true) && Array.isArray(rawConversions)) {
        const fileConversions = rawConversions
          .map((pair) => ({
            from: String(pair?.from || '').toLowerCase().trim().replace(/^\./, ''),
            to: String(pair?.to || '').toLowerCase().trim().replace(/^\./, '')
          }))
          .filter((pair) => /^[a-z0-9]+$/.test(pair.from) && /^[a-z0-9]+$/.test(pair.to));
        if (fileConversions.length) {
          service = { fileConversions };
        }
      }
      return {
        id: String(raw.id || '').trim(),
        name: String(raw.name || '').trim(),
        version: String(raw.version || '').trim(),
        description: String(raw.description || '').trim(),
        // A remote embed never holds host permissions, whatever the record says.
        permissions: (!embedUrl && Array.isArray(raw.permissions))
          ? raw.permissions.map((permission) => String(permission || '').trim()).filter(Boolean)
          : [],
        path: String(raw.path || '').trim(),
        entryUrl: String(raw.entryUrl || '').trim(),
        embedUrl,
        // A served plugin needs its folder path at boot to start the loopback
        // server, so `serve` only survives alongside one.
        serve: raw.serve === true && !embedUrl && Boolean(String(raw.path || '').trim()),
        service,
        bundled: raw.bundled === true,
        enabled: raw.enabled !== false
      };
    })
    .filter((entry) => {
      if (!entry.id || (!entry.entryUrl && !entry.embedUrl && !entry.serve) || seenIds.has(entry.id)) {
        return false;
      }
      seenIds.add(entry.id);
      return true;
    });
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
  const rawDisabledMcpToolNames = Array.isArray(rawAgent.disabledMcpToolNames)
    ? rawAgent.disabledMcpToolNames
    : (Array.isArray(rawAgent.disabled_mcp_tool_names) ? rawAgent.disabled_mcp_tool_names : null);
  const preferredJournals = normalizePreferredJournals(rawSettings);

  return {
    ...structuredClone(defaultState.settings),
    notebookSuggestionPauses: asObject(rawSettings.notebookSuggestionPauses),
    storagePath: String(rawSettings.storagePath || '').trim(),
    notebookPdf: normalizeNotebookPdfSettings(rawSettings.notebookPdf),
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
      externalSkillsEnabled: rawAgent.externalSkillsEnabled !== false
        && rawAgent.external_skills_enabled !== false,
      disabledExternalSkillNames: rawDisabledExternalSkillNames
        ? rawDisabledExternalSkillNames.map((item) => String(item || '').trim()).filter(Boolean)
        : defaultState.settings.agent.disabledExternalSkillNames,
      disabledMcpToolNames: rawDisabledMcpToolNames
        ? [...new Set(rawDisabledMcpToolNames.map((item) => String(item || '').trim()).filter(Boolean))]
        : defaultState.settings.agent.disabledMcpToolNames
    },
    inventoryLocations: Array.isArray(rawSettings.inventoryLocations)
      ? rawSettings.inventoryLocations
      : defaultState.settings.inventoryLocations,
    sampleInventoryLocations: normalizeSampleInventoryLocations(rawSettings.sampleInventoryLocations),
    sampleTypeLabels: normalizeSampleTypeLabels(rawSettings.sampleTypeLabels),
    sampleTypeHidden: normalizeSampleTypeHidden(rawSettings.sampleTypeHidden),
    preferredJournals,
    preferredJournal: preferredJournals.join('; '),
    plugins: mergeBundledPluginEntries(normalizePluginEntries(rawSettings.plugins)),
    pluginStorage: normalizePluginStorage(rawSettings.pluginStorage)
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
  const source = { ...asObject(parsed) };
  delete source.objectGraph;
  delete source.synthesisChemistryDrafts;
  const normalizedState = {
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
      messages: Array.isArray(source.agentChat?.messages) ? source.agentChat.messages : [],
      folders: Array.isArray(source.agentChat?.folders) ? source.agentChat.folders : [],
      sessionFolderIds: source.agentChat?.sessionFolderIds && typeof source.agentChat.sessionFolderIds === 'object' && !Array.isArray(source.agentChat.sessionFolderIds)
        ? source.agentChat.sessionFolderIds
        : {},
      selectedFolderId: String(source.agentChat?.selectedFolderId || 'general'),
      expandedFolderIds: Array.isArray(source.agentChat?.expandedFolderIds) ? source.agentChat.expandedFolderIds : [],
      folderExpansionInitialized: source.agentChat?.folderExpansionInitialized === true
        || (Array.isArray(source.agentChat?.expandedFolderIds) && source.agentChat.expandedFolderIds.length > 0)
    },
    paperAgentChatSessions: normalizePaperAgentChatSessions(source.paperAgentChatSessions),
    notebookEntries: Array.isArray(source.notebookEntries) ? source.notebookEntries : [],
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
    },
    inventoryFolders: {
      ...defaultState.inventoryFolders,
      ...asObject(source.inventoryFolders)
    }
  };
  migrateProteinBuilderCloningNotebookState(normalizedState);
  return normalizedState;
}
