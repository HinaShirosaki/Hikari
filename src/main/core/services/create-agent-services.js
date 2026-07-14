'use strict';
const {
  defaultCleanText,
  defaultSafeParseJson,
  createAgentLlmRuntimeHelpers
} = require('../../lib/llm/runtime-helpers.js');
const { createAgentLlmProviderBridge } = require('../../helpers/agent/shared/agent-llm-provider-bridge.js');
const {
  parsePdfDataUrl,
  defaultToInputText,
  defaultExtractResponseText,
  defaultExtractClaudeResponseText,
  defaultExtractGeminiResponseText,
  defaultExtractChatCompletionText,
  requestOpenAiResponsesWithBackoff,
  requestOpenAiCompatibleChatCompletionsWithBackoff,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff
} = require('../../helpers/main/llm/llm-provider-runtime.js');
const {
  runPythonSandbox,
  createManagedPythonSandboxRuntime
} = require('../../helpers/agent/tools/agent-python-sandbox.js');
const { buildInventorySearchTerms } = require('../../helpers/agent/shared/agent-inventory-search-terms.js');
const observability = require('../../helpers/agent/shared/agent-observability');
const { createAgentControllerUtils } = require('../../helpers/agent/shared/agent-controller-utils');
const { createAgentRuntimeRegistry } = require('../../helpers/agent/shared/agent-runtime-registry.js');
const { createAgentToolSmokeTestRuntime } = require('../../helpers/agent/tools/agent-tool-smoke-test');
const { createAgentChatLogRuntime } = require('../../helpers/agent/context/agent-chat-log.js');
const { createAgentSkillRuntime } = require('../../helpers/agent/skills/agent-skill-runtime.js');
const { normalizeToolInvocationArgs } = require('../../helpers/agent/tools/agent-tool-loading.js');
const { createAgentToolCallRuntime } = require('../../helpers/agent/tools/agent-tool-execution.js');
const { createAgentCommandLineRuntime } = require('../../helpers/agent/tools/agent-command-line.js');
const { createAgentSubAgentRuntime } = require('../../helpers/agent/tools/agent-sub-agent.js');
const { createAgentContainerRuntime } = require('../../helpers/agent/tools/agent-container.js');
const { createAgentAssayTableRuntime } = require('../../helpers/agent/tools/agent-assay-table.js');
const { createAgentPlotlyGraphRuntime } = require('../../helpers/agent/tools/agent-plotly-graph.js');
const { createAgentMemoryRuntime } = require('../../helpers/agent/context/agent-memory.js');
const { createNotebookDraftRuntime } = require('../../helpers/agent/tools/agent-notebook-draft.js');
const { createWebSearchRuntime } = require('../../helpers/agent/tools/agent-web-search.js');
const { createLiteratureSearchRuntime } = require('../../papers/search/agent-literature-search.js');
const { createLiteratureSearchWorkflowRuntime } = require('../../papers/workflow/agent-literature-search-workflow.js');
const { createPurchaseRecommendationRuntime } = require('../../helpers/agent/tools/agent-purchase-recommendation.js');
const { createProtocolGenerationRuntime } = require('../../helpers/agent/tools/agent-protocol-generation.js');
const { createProtocolSaveRuntime } = require('../../helpers/agent/tools/agent-protocol-save.js');
const { createPaperAnalysisRuntime } = require('../../papers/analysis/agent-paper-analysis.js');
const { createPaperContextLoaderRuntime } = require('../../papers/retrieve/agent-paper-context-loader.js');
const { createPaperDownloadRuntime } = require('../../papers/download/agent-paper-download.js');
const { createPaperKnowledgeDatabaseRuntime } = require('../../papers/store/agent-paper-knowledge-database.js');
const { createPaperWikiChunkerRuntime } = require('../../papers/retrieve/agent-paper-wiki-chunker.js');
const { createPaperWikiSearchRuntime } = require('../../papers/retrieve/agent-paper-wiki-search.js');
const { createPdfTextExtractionRuntime } = require('../../papers/parse/agent-pdf-text-extraction.js');
const { createProtocolMatchingRuntime } = require('../../helpers/agent/tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../../helpers/agent/tools/agent-notebook-generation.js');
const { createAgentInventoryLookupRuntime } = require('../../helpers/agent/tools/agent-inventory-lookup.js');
const { createAgentNotebookLookupRuntime } = require('../../helpers/agent/tools/agent-notebook-lookup.js');
const { createAgentLookupSupport } = require('../../helpers/agent/tools/agent-lookup-support.js');
const { createAgentRuntimeSupport } = require('../../helpers/agent/runtime/agent-runtime-support.js');
const { createAgentSubAppApi } = require('../../helpers/agent/runtime/agent-sub-app-api.js');
const { registerAgentToolExecutors } = require('../../helpers/agent/tools/register-agent-tool-executors.js');
const {
  createDirectLlmModuleRegistry,
  registerDefaultDirectLlmModules
} = require('../../helpers/main/llm/direct-llm-module-registry.js');
const { asArray, createUniqueStrings } = require('../../helpers/main/data/value-utils.js');
const { STORAGE } = require('../../../shared/ipc/channels');

function renderPromptTemplate(template, vars = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? ''));
}

function createMainAgentServices(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const safeParseJson = typeof deps.safeParseJson === 'function' ? deps.safeParseJson : defaultSafeParseJson;
  const toInputText = typeof deps.toInputText === 'function' ? deps.toInputText : defaultToInputText;
  const extractResponseText = typeof deps.extractResponseText === 'function'
    ? deps.extractResponseText
    : defaultExtractResponseText;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : defaultExtractClaudeResponseText;
  const extractGeminiResponseText = typeof deps.extractGeminiResponseText === 'function'
    ? deps.extractGeminiResponseText
    : defaultExtractGeminiResponseText;
  const extractChatCompletionText = typeof deps.extractChatCompletionText === 'function'
    ? deps.extractChatCompletionText
    : defaultExtractChatCompletionText;
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
  const appendAgentChatLogEntry = typeof deps.appendAgentChatLogEntry === 'function'
    ? deps.appendAgentChatLogEntry
    : (async () => {});
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

  const sharedLlmTransportDeps = {
    parsePdfDataUrl,
    toInputText,
    requestCodexCliText,
    getCodexCliWorkingDirectory,
    requestClaudeMessagesWithBackoff,
    requestGeminiGenerateContentWithBackoff,
    requestOpenAiCompatibleChatCompletionsWithBackoff,
    requestOpenAiResponsesWithBackoff,
    extractClaudeResponseText,
    extractGeminiResponseText,
    extractChatCompletionText,
    extractResponseText
  };

  const llmTraceRecorderRef = {
    current: async () => {}
  };
  const llmProviderBridge = createAgentLlmProviderBridge({
    LLM_PROVIDERS,
    asArray,
    cleanText,
    safeParseJson,
    recordAgentLlmTrace: (...args) => llmTraceRecorderRef.current(...args),
    ...sharedLlmTransportDeps
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
    appendAgentChatLogEntry,
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
    DEFAULT_LLM_PROVIDER,
    normalizeLlmProvider,
    defaultLlmEndpointForProvider,
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

  const agentRuntimeSupport = createAgentRuntimeSupport({
    renderPromptTemplate
  });
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
    buildAgentSystemPrompt: agentRuntimeSupport.buildAgentSystemPrompt,
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
  const paperAnalysisRuntime = createPaperAnalysisRuntime({
    ...sharedAgentLlmDeps,
    protocolGenerationRuntime
  });
  const subAgentRuntime = createAgentSubAgentRuntime({
    ...sharedAgentLlmDeps,
    runSubAgentTurn
  });
  const containerRuntime = createAgentContainerRuntime({});
  const assayTableRuntime = createAgentAssayTableRuntime({
    runPythonSandbox,
    getSandboxRoot: getAgentPythonSandboxRoot
  });
  const plotlyGraphRuntime = createAgentPlotlyGraphRuntime({});
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

  const agentToolSmokeTestRuntime = createAgentToolSmokeTestRuntime({
    runPythonSandbox,
    pythonSandboxRoot: getAgentPythonSandboxRoot()
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
    agentToolSmokeTestRuntime,
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
