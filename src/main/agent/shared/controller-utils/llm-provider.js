'use strict';

// Resolves which provider, endpoint, model, and key an agent call should use,
// with host overrides taking precedence over the built-in defaults.
function createAgentLlmProviderResolvers({
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
} = {}) {
  function resolveAgentApiKey(llm) {
    const fromSettings = cleanText(llm?.apiKey, 300);
    if (fromSettings) {
      return fromSettings;
    }

    const explicit = cleanText(process.env.HIKARI_LLM_API_KEY, 300);
    if (explicit) {
      return explicit;
    }

    const generic = cleanText(process.env.LLM_API_KEY, 300);
    if (generic) {
      return generic;
    }
    return '';
  }

  function inferProviderFromEndpoint(endpoint) {
    if (inferLlmProviderFromEndpointOverride) {
      return cleanText(inferLlmProviderFromEndpointOverride(endpoint), 80).toLowerCase();
    }
    const value = cleanText(endpoint, 300).toLowerCase();
    if (!value) {
      return '';
    }
    if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('codex agent')) {
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

  function normalizeLlmProvider(provider, endpoint = '') {
    if (normalizeLlmProviderOverride) {
      return cleanText(normalizeLlmProviderOverride(provider, endpoint), 80).toLowerCase() || DEFAULT_LLM_PROVIDER;
    }
    const clean = cleanText(provider, 80).toLowerCase();
    if (Object.values(LLM_PROVIDERS).includes(clean)) {
      return clean;
    }
    return inferProviderFromEndpoint(endpoint) || DEFAULT_LLM_PROVIDER;
  }

  function defaultEndpointForProvider(provider) {
    if (defaultLlmEndpointForProviderOverride) {
      return cleanText(defaultLlmEndpointForProviderOverride(provider), 300)
        || DEFAULT_LLM_ENDPOINTS[DEFAULT_LLM_PROVIDER]
        || '';
    }
    const resolved = normalizeLlmProvider(provider);
    return DEFAULT_LLM_ENDPOINTS[resolved] || DEFAULT_LLM_ENDPOINTS[DEFAULT_LLM_PROVIDER];
  }

  function resolveAgentProvider(llm) {
    if (normalizeAgentLlmProviderOverride) {
      return cleanText(
        normalizeAgentLlmProviderOverride(llm?.provider, llm?.apiEndpoint || llm?.api),
        80
      ).toLowerCase() || DEFAULT_LLM_PROVIDER;
    }
    return normalizeLlmProvider(llm?.provider, llm?.apiEndpoint || llm?.api);
  }

  function resolveAgentEndpoint(llm, provider = DEFAULT_LLM_PROVIDER) {
    const endpoint = cleanText(llm?.apiEndpoint, 300);
    if (provider === LLM_PROVIDERS.CODEX) {
      return '';
    }
    if (endpoint && /^https?:\/\//i.test(endpoint)) {
      return endpoint;
    }
    return defaultEndpointForProvider(provider);
  }

  function resolveAgentModel(llm, provider = DEFAULT_LLM_PROVIDER) {
    const model = cleanText(llm?.model, 120);
    if (model) {
      return model;
    }
    if (defaultAgentModelForProviderOverride) {
      return cleanText(defaultAgentModelForProviderOverride(provider), 120)
        || cleanText(defaultAgentModelForProviderOverride(DEFAULT_LLM_PROVIDER), 120)
        || '';
    }
    if (Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_MODELS, provider)) {
      return DEFAULT_AGENT_MODELS[provider];
    }
    return DEFAULT_AGENT_MODELS[DEFAULT_LLM_PROVIDER];
  }

  function resolveAgentLlmSource(llm) {
    const provider = resolveAgentProvider(llm);
    const endpoint = resolveAgentEndpoint(llm, provider);
    const model = resolveAgentModel(llm, provider);
    const apiKey = provider === LLM_PROVIDERS.CODEX ? '' : resolveAgentApiKey(llm);
    return {
      provider,
      endpoint,
      apiKey,
      model
    };
  }

  return {
    resolveAgentApiKey,
    inferProviderFromEndpoint,
    normalizeLlmProvider,
    defaultEndpointForProvider,
    resolveAgentProvider,
    resolveAgentEndpoint,
    resolveAgentModel,
    resolveAgentLlmSource
  };
}

module.exports = { createAgentLlmProviderResolvers };
