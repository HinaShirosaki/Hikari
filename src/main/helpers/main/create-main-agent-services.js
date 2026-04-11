'use strict';

const {
  defaultCleanText,
  defaultSafeParseJson,
  defaultToInputText,
  defaultExtractResponseText,
  defaultExtractClaudeResponseText,
  defaultExtractGeminiResponseText,
  requestOpenAiResponsesWithBackoff,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff
} = require('../agent/shared/agent-llm-utils.js');
const {
  runPythonSandbox,
  createManagedPythonSandboxRuntime
} = require('../agent/tools/agent-python-sandbox.js');
const {
  INTENT_PARSER_RESPONSE_SCHEMA,
  normalizeIntentParserPayload,
  buildIntentParserPrompt,
  buildInventorySearchTerms,
  mapCanonicalIntentToExecutionIntent,
  normalizeParserEntitiesToRoutingEntities
} = require('../agent/intent/agent-intent-parser');
const observability = require('../agent/shared/agent-observability');
const { createAgentControllerUtils } = require('../agent/shared/agent-controller-utils');
const { createAgentRuntimeRegistry } = require('../agent/shared/agent-runtime-registry.js');
const { createProtocolNotebookRuntime } = require('../agent/runtime/agent-protocol-notebook');
const { createAgentLookupRuntime } = require('../agent/runtime/agent-lookup-runtime');
const { createScienceReasoningLoopRuntime } = require('../agent/runtime/science-reasoning-loop/index.js');
const { createDeepResearchRuntime } = require('../agent/deep-research/index.js');
const { createAgentSessionRuntime } = require('../agent/runtime/agent-session-runtime.js');
const { createAgentScienceMainUtils } = require('../agent/runtime/agent-science-main-utils.js');
const { createAgentToolSmokeTestRuntime } = require('../agent/tools/agent-tool-smoke-test');
const { createAgentChatLogRuntime } = require('../agent/context/agent-chat-log.js');
const { normalizeToolInvocationArgs } = require('../agent/tools/agent-tool-loading.js');
const { createAgentToolCallRuntime } = require('../agent/tools/agent-tool-execution.js');
const { createAgentToolProviderRuntime } = require('../agent/tools/agent-tool-provide.js');
const { createNotebookDraftRuntime } = require('../agent/tools/agent-notebook-draft.js');
const { createLiteratureSearchRuntime } = require('../agent/tools/agent-literature-search.js');
const { createPurchaseRecommendationRuntime } = require('../agent/tools/agent-purchase-recommendation.js');
const { createPaperContextLoaderRuntime } = require('../agent/tools/agent-paper-context-loader.js');
const { createProtocolMatchingRuntime } = require('../agent/tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../agent/tools/agent-notebook-generation.js');
const { createAgentInventoryLookupRuntime } = require('../agent/tools/agent-inventory-lookup.js');
const { createAgentRecordLookupRuntime } = require('../agent/tools/agent-record-lookup.js');
const { createAgentRuntimeSupport } = require('../agent/runtime/agent-runtime-support.js');
const { registerAgentToolExecutors } = require('../agent/tools/register-agent-tool-executors.js');
const { asArray, clamp, createUniqueStrings } = require('./value-utils.js');

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
  const uniqueStrings = createUniqueStrings(cleanText);
  const sharedLlmTransportDeps = {
    toInputText,
    requestCodexCliText,
    getCodexCliWorkingDirectory,
    requestClaudeMessagesWithBackoff,
    requestGeminiGenerateContentWithBackoff,
    requestOpenAiResponsesWithBackoff,
    extractClaudeResponseText,
    extractGeminiResponseText,
    extractResponseText
  };

  const controllerUtils = createAgentControllerUtils({
    LLM_PROVIDERS,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_ENDPOINTS,
    DEFAULT_AGENT_MODELS,
    inferLlmProviderFromEndpoint,
    normalizeLlmProvider,
    defaultLlmEndpointForProvider,
    defaultAgentModelForProvider,
    asArray,
    cleanText,
    appendAgentChatLogEntry,
    buildIntentParserPrompt,
    normalizeIntentParserPayload,
    INTENT_PARSER_RESPONSE_SCHEMA,
    ...sharedLlmTransportDeps
  });
  const sharedAgentLlmDeps = {
    LLM_PROVIDERS,
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    ...sharedLlmTransportDeps,
    recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace
  };

  const agentRuntimeRegistry = createAgentRuntimeRegistry({
    cleanText
  });
  agentRuntimeRegistry.registerRuntimeFactory('inventory-lookup', createAgentInventoryLookupRuntime);
  agentRuntimeRegistry.registerRuntimeFactory('record-lookup', createAgentRecordLookupRuntime);
  agentRuntimeRegistry.registerRuntimeFactory('protocol-matching', createProtocolMatchingRuntime);
  agentRuntimeRegistry.registerRuntimeFactory('notebook-generation', createNotebookGenerationRuntime);

  const agentLookupRuntime = createAgentLookupRuntime({
    asArray,
    cleanText,
    uniqueStrings,
    getBundlePaths,
    hydrateSnapshotFromBundle,
    syncBundleFromSnapshot,
    buildInventorySearchTerms,
    getAgentRuntimeFactory: agentRuntimeRegistry.getRuntimeFactory
  });

  const agentRuntimeSupport = createAgentRuntimeSupport({
    renderPromptTemplate
  });

  const genericAgentToolRuntime = createAgentToolCallRuntime({
    asArray,
    cleanText
  });
  const agentToolProviderRuntime = createAgentToolProviderRuntime({
    cleanText
  });
  const agentToolRuntime = {
    normalizeToolInvocationArgs,
    normalizeAgentSnapshot: agentRuntimeSupport.normalizeAgentSnapshot,
    buildAgentSystemPrompt: agentRuntimeSupport.buildAgentSystemPrompt,
    async runAgentTool(toolName, args, rawSnapshot, options = {}) {
      const normalizedArgs = normalizeToolInvocationArgs(args);
      const snapshot = agentRuntimeSupport.normalizeAgentSnapshot(rawSnapshot);
      const envelope = await genericAgentToolRuntime.executeToolCall(
        {
          tool_name: toolName,
          arguments: normalizedArgs
        },
        {
          ...options,
          snapshot,
          dataFilePath: cleanText(snapshot?.data_file_path, 1600),
          fallbackDataFilePath: getDefaultDataFilePath()
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

  const scienceMainUtils = createAgentScienceMainUtils({
    asArray,
    cleanText,
    uniqueStrings,
    clamp,
    mapCanonicalIntentToExecutionIntent,
    normalizeParserEntitiesToRoutingEntities,
    normalizeRoutingPayload: agentRuntimeSupport.normalizeRoutingPayload,
    normalizeNotebookDraftPayload: (value) => value && typeof value === 'object' ? value : null,
    applyRoutingPlanPatch: (routing, patch = {}) => ({
      ...agentRuntimeSupport.normalizeRoutingPayload(routing),
      plan: {
        ...(agentRuntimeSupport.normalizeRoutingPayload(routing).plan || {}),
        ...(patch && typeof patch === 'object' ? patch : {})
      }
    }),
    pickTopMatches: agentRuntimeSupport.pickTopMatches,
    scoreByQuery: agentRuntimeSupport.scoreByQuery,
    normalizeQuery: agentRuntimeSupport.normalizeQuery
  });

  const agentSessionRuntime = createAgentSessionRuntime({
    ...sharedAgentLlmDeps
  });

  const protocolNotebookRuntime = createProtocolNotebookRuntime({
    ...sharedAgentLlmDeps,
    pickTopMatches: agentRuntimeSupport.pickTopMatches,
    runTool: agentToolRuntime.runAgentTool,
    recordLifecycleEvent: observability.recordLifecycleEvent,
    getAgentRuntimeFactory: agentRuntimeRegistry.getRuntimeFactory
  });

  const notebookDraftRuntime = createNotebookDraftRuntime({
    ...sharedAgentLlmDeps,
    recordLifecycleEvent: observability.recordLifecycleEvent,
    getAgentRuntimeFactory: agentRuntimeRegistry.getRuntimeFactory
  });

  const paperContextLoaderRuntime = createPaperContextLoaderRuntime({
    ...sharedAgentLlmDeps,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const literatureSearchRuntime = createLiteratureSearchRuntime({
    ...sharedAgentLlmDeps,
    paperContextLoaderRuntime,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const purchaseRecommendationRuntime = createPurchaseRecommendationRuntime({
    ...sharedAgentLlmDeps,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  const pythonSandboxToolRuntime = createManagedPythonSandboxRuntime({
    runPythonSandbox,
    sandboxRoot: getAgentPythonSandboxRoot()
  });

  registerAgentToolExecutors({
    cleanText,
    genericAgentToolRuntime,
    agentLookupRuntime,
    literatureSearchRuntime,
    purchaseRecommendationRuntime,
    pythonSandboxToolRuntime,
    notebookDraftRuntime,
    getAgentPythonSandboxRoot
  });

  const scienceReasoningLoopRuntime = createScienceReasoningLoopRuntime({
    ...sharedAgentLlmDeps,
    clamp,
    toolProvider: agentToolProviderRuntime,
    startAgentSession: agentSessionRuntime.startAgentSession,
    extractAgentSessionFunctionCalls: agentSessionRuntime.extractAgentSessionFunctionCalls,
    extractAgentSessionText: agentSessionRuntime.extractAgentSessionText,
    continueAgentSessionWithToolOutputs: agentSessionRuntime.continueAgentSessionWithToolOutputs,
    continueAgentSessionWithUserMessage: agentSessionRuntime.continueAgentSessionWithUserMessage,
    runTool: agentToolRuntime.runAgentTool,
    applyResponseLayerToOutput: scienceMainUtils.applyResponseLayerToOutput,
    applyValidationGateToOutput: scienceMainUtils.applyValidationGateToOutput,
    recordLifecycleEvent: observability.recordLifecycleEvent
  });

  const deepResearchRuntime = createDeepResearchRuntime({
    ...sharedAgentLlmDeps,
    clamp,
    toolProvider: agentToolProviderRuntime,
    applyResponseLayerToOutput: scienceMainUtils.applyResponseLayerToOutput,
    applyValidationGateToOutput: scienceMainUtils.applyValidationGateToOutput,
    recordLifecycleEvent: observability.recordLifecycleEvent
  });

  const agentToolSmokeTestRuntime = createAgentToolSmokeTestRuntime({
    runPythonSandbox,
    pythonSandboxRoot: getAgentPythonSandboxRoot()
  });
  const agentChatLogRuntime = createAgentChatLogRuntime();

  return {
    observability,
    controllerUtils,
    protocolNotebookRuntime,
    scienceReasoningLoopRuntime,
    deepResearchRuntime,
    scienceMainUtils,
    agentToolRuntime,
    agentChatLogRuntime,
    agentToolSmokeTestRuntime,
    agentLookupRuntime
  };
}

module.exports = {
  createMainAgentServices
};
