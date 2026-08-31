'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { createAgentTracing } = require('./controller-utils/tracing.js');
const { createAgentResultSummary } = require('./controller-utils/result-summary.js');
const { createAgentLlmProviderResolvers } = require('./controller-utils/llm-provider.js');

function createAgentControllerUtils(deps = {}) {
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
  const inferLlmProviderFromEndpointOverride = typeof deps.inferLlmProviderFromEndpoint === 'function'
    ? deps.inferLlmProviderFromEndpoint
    : null;
  const normalizeLlmProviderOverride = typeof deps.normalizeLlmProvider === 'function'
    ? deps.normalizeLlmProvider
    : null;
  const normalizeAgentLlmProviderOverride = typeof deps.normalizeAgentLlmProvider === 'function'
    ? deps.normalizeAgentLlmProvider
    : null;
  const defaultLlmEndpointForProviderOverride = typeof deps.defaultLlmEndpointForProvider === 'function'
    ? deps.defaultLlmEndpointForProvider
    : null;
  const defaultAgentModelForProviderOverride = typeof deps.defaultAgentModelForProvider === 'function'
    ? deps.defaultAgentModelForProvider
    : null;
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
    });

  const {
    extractConversation,
    buildAgentLogRequestId,
    summarizeLlmForAgentLog,
    createAgentLlmTraceContext,
    formatAgentChatLogEntry,
    recordAgentLlmTrace
  } = createAgentTracing({ asArray, cleanText });

  const { summarizeAgentResultForLog } = createAgentResultSummary({ asArray, cleanText });

  const {
    resolveAgentApiKey,
    resolveAgentProvider,
    resolveAgentEndpoint,
    resolveAgentModel,
    resolveAgentLlmSource
  } = createAgentLlmProviderResolvers({
    LLM_PROVIDERS,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_ENDPOINTS,
    DEFAULT_AGENT_MODELS,
    cleanText,
    inferLlmProviderFromEndpointOverride,
    normalizeLlmProviderOverride,
    normalizeAgentLlmProviderOverride,
    defaultLlmEndpointForProviderOverride,
    defaultAgentModelForProviderOverride
  });

  const llmHelpers = createAgentLlmRuntimeHelpers({
    ...deps,
    LLM_PROVIDERS,
    asArray,
    cleanText,
    safeParseJson: typeof deps.safeParseJson === 'function' ? deps.safeParseJson : undefined,
    recordAgentLlmTrace
  });

  return {
    extractConversation,
    buildAgentLogRequestId,
    summarizeLlmForAgentLog,
    createAgentLlmTraceContext,
    recordAgentLlmTrace,
    summarizeAgentResultForLog,
    formatAgentChatLogEntry,
    resolveAgentApiKey,
    resolveAgentProvider,
    resolveAgentEndpoint,
    resolveAgentModel,
    resolveAgentLlmSource,
    requestText: llmHelpers.requestText,
    requestWebSearch: llmHelpers.requestWebSearch
  };
}

module.exports = {
  createAgentControllerUtils
};
