'use strict';
const {
  defaultCleanText,
  defaultSafeParseJson,
  createAgentLlmRuntimeHelpers
} = require('../../lib/llm/runtime-helpers.js');
const { createAgentLlmProviderBridge } = require('../../agent/shared/agent-llm-provider-bridge.js');
const {
  runPythonSandbox,
  createManagedPythonSandboxRuntime
} = require('../../agent/tools/agent-python-sandbox.js');
const { buildInventorySearchTerms } = require('../../agent/shared/agent-inventory-search-terms.js');
const observability = require('../../agent/shared/agent-observability');
const { createAgentControllerUtils } = require('../../agent/shared/agent-controller-utils');
const { createAgentRuntimeRegistry } = require('../../agent/shared/agent-runtime-registry.js');
const { createAgentChatLogRuntime } = require('../../agent/context/agent-chat-log.js');
const { createAgentSkillRuntime } = require('../../agent/skills/agent-skill-runtime.js');
const { normalizeToolInvocationArgs } = require('../../agent/tools/agent-tool-loading.js');
const { createAgentToolCallRuntime } = require('../../agent/tools/agent-tool-execution.js');
const { createAgentCommandLineRuntime } = require('../../agent/tools/agent-command-line.js');
const { createAgentSubAgentRuntime } = require('../../agent/tools/agent-sub-agent.js');
const { createAgentContainerRuntime } = require('../../agent/tools/agent-container.js');
const { createAgentAssayTableRuntime } = require('../../agent/tools/agent-assay-table.js');
const { createAgentPlotlyGraphRuntime } = require('../../agent/tools/agent-plotly-graph.js');
const { createSequenceAgentRuntime } = require('../../agent/tools/agent-sequence-viewer.js');
const { createAgentMemoryRuntime } = require('../../agent/context/agent-memory.js');
const { createNotebookDraftRuntime } = require('../../agent/tools/agent-notebook-draft.js');
const { createWebSearchRuntime } = require('../../agent/tools/agent-web-search.js');
const { createLiteratureSearchRuntime } = require('../../papers/search/agent-literature-search.js');
const { createLiteratureSearchWorkflowRuntime } = require('../../papers/workflow/agent-literature-search-workflow.js');
const { createPurchaseRecommendationRuntime } = require('../../agent/tools/agent-purchase-recommendation.js');
const { createProtocolGenerationRuntime } = require('../../agent/tools/agent-protocol-generation.js');
const { createProtocolSaveRuntime } = require('../../agent/tools/agent-protocol-save.js');
const { createPaperAnalysisRuntime } = require('../../papers/analysis/agent-paper-analysis.js');
const { createPaperContextLoaderRuntime } = require('../../papers/retrieve/agent-paper-context-loader.js');
const { createPaperDownloadRuntime } = require('../../papers/download/agent-paper-download.js');
const { createPaperKnowledgeDatabaseRuntime } = require('../../papers/store/agent-paper-knowledge-database.js');
const { createPaperWikiChunkerRuntime } = require('../../papers/retrieve/agent-paper-wiki-chunker.js');
const { createPaperWikiSearchRuntime } = require('../../papers/retrieve/agent-paper-wiki-search.js');
const { createPdfTextExtractionRuntime } = require('../../papers/parse/agent-pdf-text-extraction.js');
const { createProtocolMatchingRuntime } = require('../../agent/tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../../agent/tools/agent-notebook-generation.js');
const { createAgentInventoryLookupRuntime } = require('../../agent/tools/agent-inventory-lookup.js');
const { createAgentNotebookLookupRuntime } = require('../../agent/tools/agent-notebook-lookup.js');
const { createAgentLookupSupport } = require('../../agent/tools/agent-lookup-support.js');
const { createAgentRuntimeSupport } = require('../../agent/runtime/agent-runtime-support.js');
const { createAgentSubAppApi } = require('../../agent/runtime/agent-sub-app-api.js');
const { registerAgentToolExecutors } = require('../../agent/tools/register-agent-tool-executors.js');
const {
  createDirectLlmModuleRegistry,
  registerDefaultDirectLlmModules
} = require('../../lib/llm/direct-llm-module-registry.js');
const { asArray, createUniqueStrings } = require('../../data/value-utils.js');
const { STORAGE } = require('../../../shared/ipc/channels');

function createMainAgentServices(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const safeParseJson = typeof deps.safeParseJson === 'function' ? deps.safeParseJson : defaultSafeParseJson;
  const LLM_PROVIDERS = deps.LLM_PROVIDERS && typeof deps.LLM_PROVIDERS === 'object'
    ? deps.LLM_PROVIDERS
    : {};
  const DEFAULT_LLM_PROVIDER = typeof deps.DEFAULT_LLM_PROVIDER === 'string'
    ? deps.DEFAULT_LLM_PROVIDER
    : '';
  const DEFAULT_LLM_ENDPOINTS = deps.DEFAULT_LLM_ENDPOINTS && typeof deps.DEFAULT_LLM_ENDPOINTS === 'object'
    ? deps.DEFAULT_LLM_ENDPOINTS
    : {};
  const DEFAULT_AGENT_MODELS = deps.DEFAULT_AGENT_MODELS && typeof deps.DEFAULT_AGENT_MODELS === 'object'
    ? deps.DEFAULT_AGENT_MODELS
    : {};
  const inferLlmProviderFromEndpoint = typeof deps.inferLlmProviderFromEndpoint === 'function'
    ? deps.inferLlmProviderFromEndpoint
    : null;
  const normalizeLlmProvider = typeof deps.normalizeLlmProvider === 'function'
    ? deps.normalizeLlmProvider
    : null;
  const normalizeAgentLlmProvider = typeof deps.normalizeAgentLlmProvider === 'function'
    ? deps.normalizeAgentLlmProvider
    : null;
  const defaultLlmEndpointForProvider = typeof deps.defaultLlmEndpointForProvider === 'function'
    ? deps.defaultLlmEndpointForProvider
    : null;
  const defaultAgentModelForProvider = typeof deps.defaultAgentModelForProvider === 'function'
    ? deps.defaultAgentModelForProvider
    : null;
  const requestCodexCliText = typeof deps.requestCodexCliText === 'function'
    ? deps.requestCodexCliText
    : (async () => '');
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');
  const getAgentPythonSandboxRoot = typeof deps.getAgentPythonSandboxRoot === 'function'
    ? deps.getAgentPythonSandboxRoot
    : (() => '');
  const getAgentMemoryFilePath = typeof deps.getAgentMemoryFilePath === 'function'
    ? deps.getAgentMemoryFilePath
    : (() => cleanText(deps.agentMemoryFilePath, 2400));
  const getBundlePaths = typeof deps.getBundlePaths === 'function'
    ? deps.getBundlePaths
    : (() => ({}));
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : (async ({ snapshot = {} } = {}) => ({
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {},
      bundlePaths: {},
      sidecarPaths: {},
      migration: null
    }));
  const syncBundleFromSnapshot = typeof deps.syncBundleFromSnapshot === 'function'
    ? deps.syncBundleFromSnapshot
    : (async () => ({ bundlePaths: {}, sidecarPaths: {} }));
  const runSubAgentTurn = typeof deps.runSubAgentTurn === 'function'
    ? deps.runSubAgentTurn
    : (async () => ({
      assistant_message: '',
      metadata: {
        provider_ok: false
      }
    }));
  const uniqueStrings = createUniqueStrings(cleanText);

  const llmTraceRecorderRef = {
    current: async () => {}
  };
  const llmProviderBridge = createAgentLlmProviderBridge({
    LLM_PROVIDERS,
    asArray,
    cleanText,
    safeParseJson,
    recordAgentLlmTrace: (...args) => llmTraceRecorderRef.current(...args),
    requestCodexCliText,
    getCodexCliWorkingDirectory
  });

  const controllerUtils = createAgentControllerUtils({
    LLM_PROVIDERS,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_ENDPOINTS,
    DEFAULT_AGENT_MODELS,
    inferLlmProviderFromEndpoint,
    normalizeLlmProvider,
    normalizeAgentLlmProvider,
    defaultLlmEndpointForProvider,
    defaultAgentModelForProvider,
    asArray,
    cleanText,
    llmProviderBridge
  });
  llmTraceRecorderRef.current = controllerUtils.recordAgentLlmTrace;
  const sharedAgentLlmDeps = {
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    llmProviderBridge,
    recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace
  };
  const agentLlmRuntimeHelpers = createAgentLlmRuntimeHelpers({
    ...sharedAgentLlmDeps
  });
  const directLlmRegistry = registerDefaultDirectLlmModules(createDirectLlmModuleRegistry({
    cleanText,
    LLM_PROVIDERS,
    defaultAgentModelForProvider,
    requestText: agentLlmRuntimeHelpers.requestText,
    requestStructuredJsonPayload: agentLlmRuntimeHelpers.requestStructuredJsonPayload,
    requestImageInput: agentLlmRuntimeHelpers.requestImageInput,
    requestFileInput: agentLlmRuntimeHelpers.requestFileInput,
    requestWebSearch: agentLlmRuntimeHelpers.requestWebSearch
  }));

  const agentRuntimeRegistry = createAgentRuntimeRegistry({
    cleanText
  });
  agentRuntimeRegistry.registerRuntimeFactory('inventory-lookup', createAgentInventoryLookupRuntime);
  agentRuntimeRegistry.registerRuntimeFactory('protocol-matching', createProtocolMatchingRuntime);
  agentRuntimeRegistry.registerRuntimeFactory('notebook-generation', createNotebookGenerationRuntime);

  const agentRuntimeSupport = createAgentRuntimeSupport();
  const agentSkillRuntime = createAgentSkillRuntime({
    cleanText,
    extraSkillDirs: Array.isArray(deps.agentSkillDirs) ? deps.agentSkillDirs : []
  });

  let agentToolRuntime = null;
  const agentAppApi = createAgentSubAppApi({
    ...sharedAgentLlmDeps,
    pickTopMatches: agentRuntimeSupport.pickTopMatches,
    getAgentRuntimeFactory: agentRuntimeRegistry.getRuntimeFactory,
    getRunTool: () => agentToolRuntime?.runAgentTool || null
  });
  const protocolMatchingRuntime = createProtocolMatchingRuntime({
    ...sharedAgentLlmDeps
  });
  const notebookGenerationRuntime = createNotebookGenerationRuntime({
    ...sharedAgentLlmDeps
  });

  const lookupSupport = createAgentLookupSupport({
    asArray,
    cleanText,
    uniqueStrings,
    getBundlePaths,
    hydrateSnapshotFromBundle,
    syncBundleFromSnapshot
  });
  const inventoryLookupRuntime = createAgentInventoryLookupRuntime({
    ...lookupSupport,
    buildInventorySearchTerms
  });
  const notebookLookupRuntime = createAgentNotebookLookupRuntime({
    ...lookupSupport,
    agentAppApi
  });

  const genericAgentToolRuntime = createAgentToolCallRuntime({
    asArray,
    cleanText
  });
  agentToolRuntime = {
    normalizeToolInvocationArgs,
    normalizeAgentSnapshot: agentRuntimeSupport.normalizeAgentSnapshot,
    listSkills: agentSkillRuntime.listSkills,
    getSkill: agentSkillRuntime.getSkill,
    parseSkillInvocation: agentSkillRuntime.parseSkillInvocation,
    buildSkillsPromptPayload: agentSkillRuntime.buildSkillsPromptPayload,
    async runAgentTool(toolName, args, rawSnapshot, options = {}) {
      const normalizedArgs = normalizeToolInvocationArgs(args);
      const snapshot = agentRuntimeSupport.normalizeAgentSnapshot(rawSnapshot);
      const snapshotDataFilePath = cleanText(
        snapshot?.data_file_path || snapshot?.dataFilePath,
        1600
      );
      const optionDataFilePath = cleanText(
        options?.dataFilePath || options?.data_file_path,
        1600
      );
      const dataFilePath = snapshotDataFilePath || optionDataFilePath;
      const fallbackDataFilePath = cleanText(
        options?.fallbackDataFilePath
          || options?.fallback_data_file_path
          || dataFilePath,
        1600
      );
      const executionSnapshot = dataFilePath && !snapshotDataFilePath
        ? {
          ...snapshot,
          data_file_path: dataFilePath
        }
        : snapshot;
      const envelope = await genericAgentToolRuntime.executeToolCall(
        {
          tool_name: toolName,
          arguments: normalizedArgs
        },
        {
          ...options,
          snapshot: executionSnapshot,
          dataFilePath,
          fallbackDataFilePath
        }
      );
      const normalizedResult = envelope?.result && typeof envelope.result === 'object'
        ? envelope.result
        : {};

      return {
        ...envelope,
        result: normalizedResult,
        items: Array.isArray(envelope?.items) ? envelope.items : [],
        citations: Array.isArray(normalizedResult?.citations) ? normalizedResult.citations : []
      };
    }
  };

  const notebookDraftRuntime = createNotebookDraftRuntime({
    ...sharedAgentLlmDeps,
    agentAppApi,
    recordLifecycleEvent: observability.recordLifecycleEvent,
    getAgentRuntimeFactory: agentRuntimeRegistry.getRuntimeFactory
  });

  const protocolGenerationRuntime = createProtocolGenerationRuntime({
    ...sharedAgentLlmDeps
  });
  function emitProtocolSaved(payload = {}) {
    const BrowserWindow = deps.BrowserWindow || deps.electron?.BrowserWindow || null;
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
      return;
    }
    BrowserWindow.getAllWindows().forEach((windowRef) => {
      const webContents = windowRef?.webContents;
      if (webContents && typeof webContents.send === 'function' && !webContents.isDestroyed?.()) {
        webContents.send(STORAGE.PROTOCOL_RECORD_SAVED, payload);
      }
    });
  }
  const protocolSaveRuntime = createProtocolSaveRuntime({
    protocolGenerationRuntime,
    hydrateSnapshotFromBundle,
    syncBundleFromSnapshot,
    getDefaultDataFilePath,
    emitProtocolSaved
  });
  const subAgentRuntime = createAgentSubAgentRuntime({
    ...sharedAgentLlmDeps,
    runSubAgentTurn
  });
  const paperAnalysisRuntime = createPaperAnalysisRuntime({
    ...sharedAgentLlmDeps,
    protocolGenerationRuntime,
    subAgentRuntime
  });
  const containerRuntime = createAgentContainerRuntime({});
  const assayTableRuntime = createAgentAssayTableRuntime({
    runPythonSandbox,
    getSandboxRoot: getAgentPythonSandboxRoot
  });
  const plotlyGraphRuntime = createAgentPlotlyGraphRuntime({});
  const sequenceAgentRuntime = createSequenceAgentRuntime({
    BrowserWindow: deps.BrowserWindow || deps.electron?.BrowserWindow || null,
    ipcMain: deps.ipcMain || deps.electron?.ipcMain || null
  });
  const memoryRuntime = createAgentMemoryRuntime({
    ...sharedAgentLlmDeps,
    memoryFilePath: cleanText(getAgentMemoryFilePath(), 2400)
  });

  const pdfTextExtractionRuntime = createPdfTextExtractionRuntime({
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const paperContextLoaderRuntime = createPaperContextLoaderRuntime({
    ...sharedAgentLlmDeps,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    pdfTextExtractionRuntime
  });
  const paperWikiChunkerRuntime = createPaperWikiChunkerRuntime({});
  const paperWikiSearchRuntime = createPaperWikiSearchRuntime();
  const paperKnowledgeDatabaseRuntime = createPaperKnowledgeDatabaseRuntime({
    ...sharedAgentLlmDeps,
    pdfTextExtractionRuntime,
    paperWikiChunkerRuntime
  });
  const webSearchRuntime = createWebSearchRuntime({
    ...sharedAgentLlmDeps
  });
  const literatureSearchRuntime = createLiteratureSearchRuntime({
    ...sharedAgentLlmDeps,
    webSearchRuntime,
    paperContextLoaderRuntime,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const paperDownloadRuntime = createPaperDownloadRuntime({
    ...sharedAgentLlmDeps,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    enableDefaultBrowserSession: true,
    BrowserWindow: deps.BrowserWindow || deps.electron?.BrowserWindow || null,
    paperKnowledgeDatabaseRuntime
  });
  const literatureSearchWorkflowRuntime = createLiteratureSearchWorkflowRuntime({
    ...sharedAgentLlmDeps,
    createSubAgentRuntime: createAgentSubAgentRuntime,
    literatureSearchRuntime,
    paperContextLoaderRuntime,
    paperDownloadRuntime,
    paperKnowledgeDatabaseRuntime,
    subAgentRuntime
  });
  const purchaseRecommendationRuntime = createPurchaseRecommendationRuntime({
    ...sharedAgentLlmDeps,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const pythonSandboxToolRuntime = createManagedPythonSandboxRuntime({
    runPythonSandbox,
    sandboxRoot: getAgentPythonSandboxRoot(),
    requestStructuredJsonPayload: agentLlmRuntimeHelpers.requestStructuredJsonPayload
  });
  const commandLineToolRuntime = createAgentCommandLineRuntime({
    cleanText,
    defaultCwd: process.cwd()
  });

  registerAgentToolExecutors({
    cleanText,
    genericAgentToolRuntime,
    inventoryLookupRuntime,
    notebookLookupRuntime,
    webSearchRuntime,
    literatureSearchRuntime: literatureSearchWorkflowRuntime,
    purchaseRecommendationRuntime,
    pythonSandboxToolRuntime,
    commandLineRuntime: commandLineToolRuntime,
    notebookDraftRuntime,
    protocolMatchingRuntime,
    notebookGenerationRuntime,
    agentAppApi,
    subAgentRuntime,
    containerRuntime,
    assayTableRuntime,
    plotlyGraphRuntime,
    sequenceAgentRuntime,
    memoryRuntime,
    paperDownloadRuntime,
    paperAnalysisRuntime,
    paperWikiSearchRuntime,
    protocolGenerationRuntime,
    protocolSaveRuntime,
    getAgentPythonSandboxRoot,
    hydrateSnapshotFromBundle,
    getDefaultDataFilePath
  });

  const agentChatLogRuntime = createAgentChatLogRuntime({
    requestAssistantText: agentLlmRuntimeHelpers.requestAssistantText
  });

  return {
    observability,
    controllerUtils,
    agentToolRuntime,
    subAgentRuntime,
    agentSkillRuntime,
    agentChatLogRuntime,
    protocolGenerationRuntime,
    inventoryLookupRuntime,
    notebookLookupRuntime,
    agentAppApi,
    webSearchRuntime,
    paperDownloadRuntime,
    literatureSearchWorkflowRuntime,
    directLlmRegistry
  };
}

module.exports = {
  createMainAgentServices
};
