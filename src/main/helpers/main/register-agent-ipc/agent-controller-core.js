'use strict';

const { createAgentIntentDispatcher } = require('./agent-intent-dispatcher');

function createAgentControllerCore({
  deps,
  cleanText,
  controllerUtils,
  observability,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  deepResearchRuntime,
  scienceMainUtils,
  agentToolRuntime,
  executeInventoryLookup,
  executeRecordLookup,
  getAgentChatLogPath,
  getDefaultDataFilePath,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  lifecycleService
} = {}) {
  const { normalizeJsonPayload, asArray } = lifecycleService;
  const intentDispatcher = createAgentIntentDispatcher({
    deps,
    cleanText,
    observability,
    protocolNotebookRuntime,
    scienceReasoningLoopRuntime,
    deepResearchRuntime,
    scienceMainUtils,
    agentToolRuntime,
    executeInventoryLookup,
    executeRecordLookup,
    getDefaultDataFilePath,
    lifecycleService
  });

  async function runAgentControllerCore(payload, runtime = {}) {
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    const message = cleanText(payload?.message, 3000);
    if (!message) {
      throw new Error('Message is required.');
    }

    const provider = controllerUtils.resolveAgentProvider(payload?.llm);
    const endpoint = controllerUtils.resolveAgentEndpoint(payload?.llm, provider);
    const model = controllerUtils.resolveAgentModel(payload?.llm, provider);
    const reasoningEffort = cleanText(payload?.llm?.reasoningEffort, 40).toLowerCase();
    const apiKey = provider === deps.LLM_PROVIDERS.CODEX ? '' : controllerUtils.resolveAgentApiKey(payload?.llm);
    if (provider !== deps.LLM_PROVIDERS.CODEX && !apiKey) {
      throw new Error('Missing LLM API key. Set it in Settings > LLM Model & API, or use LLM_API_KEY / ENANA_LLM_API_KEY.');
    }
    if (provider === deps.LLM_PROVIDERS.CODEX) {
      setCodexCliModel(model);
      setCodexCliReasoningEffort(reasoningEffort);
    }
    const conversation = controllerUtils.extractConversation(payload?.conversation);
    const hasLatestUserInConversation = Boolean(
      conversation.length > 0
      && conversation[conversation.length - 1].role === 'user'
      && conversation[conversation.length - 1].text === message
    );
    const rawSnapshot = normalizeJsonPayload(payload?.stateSnapshot, {});
    const snapshot = agentToolRuntime.normalizeAgentSnapshot(rawSnapshot);
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(payload, { settings: rawSnapshot?.settings || {} });
    const deepResearchEnabled = payload?.agent?.deepResearchEnabled === true;
    const traceContext = controllerUtils.createAgentLlmTraceContext({
      enabled: executionFlags.developerMode === true,
      requestId: cleanText(runtime?.requestId, 80),
      logPath: getAgentChatLogPath(),
      provider,
      model
    });
    if (runtime && typeof runtime === 'object') {
      runtime.traceContext = traceContext;
    }
    const projectId = cleanText(payload?.projectId, 80);
    const projectName = cleanText(payload?.projectName, 180);
    const promptConversation = hasLatestUserInConversation
      ? conversation
      : [...conversation, { role: 'user', text: message }];

    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only',
      status: 'ok',
      message: 'Running parser-first intent phraser pipeline.'
    });

    const parserResult = await controllerUtils.requestIntentParserPayload({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation: promptConversation,
      projectName,
      traceContext
    });
    if (!parserResult?.ok || !parserResult?.payload) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'parser_completed',
        status: 'failed',
        message: cleanText(parserResult?.error || 'Malformed parser output.', 320),
        failure_reasons: ['intent_parser_failed']
      });
      return {
        ok: false,
        provider,
        model: model || (provider === deps.LLM_PROVIDERS.CODEX ? 'codex-default' : ''),
        error: cleanText(`Intent parser failed: ${parserResult?.error || 'Malformed parser output.'}`, 360)
      };
    }
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'parser_completed',
      status: 'ok',
      routing_intent: cleanText(parserResult.payload.primary_intent, 80) || 'unclear',
      message: `Intent parser returned primary_intent=${cleanText(parserResult.payload.primary_intent, 80) || 'unknown'}.`,
      meta: {
        needs_clarification: parserResult.payload.needs_clarification === true
      }
    });

    const result = {
      ok: true,
      parser: parserResult.payload
    };

    await intentDispatcher.dispatchIntent({
      payload,
      context: {
        provider,
        endpoint,
        apiKey,
        model,
        message,
        promptConversation,
        snapshot,
        executionFlags,
        deepResearchEnabled,
        traceContext,
        projectId,
        projectName,
        parserPayload: parserResult.payload,
        lifecycleRecorder
      },
      result
    });

    if (executionFlags.developerMode === true) {
      result.developer_trace = asArray(traceContext?.rows);
    }
    return result;
  }

  async function runAgentController(payload, runtime = {}) {
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only_selected',
      status: 'ok',
      message: 'Using intent-only parser controller path.'
    });
    return runAgentControllerCore(payload, runtime && typeof runtime === 'object' ? runtime : {});
  }

  return {
    runAgentController,
    runAgentControllerCore
  };
}

module.exports = {
  createAgentControllerCore
};
