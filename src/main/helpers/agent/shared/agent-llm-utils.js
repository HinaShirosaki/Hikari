'use strict';

const { getAgentRequestContext } = require('./agent-request-context.js');

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function defaultSafeParseJson(text, fallback = null) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Fallback below.
  }
  return fallback;
}

function createAgentLlmRuntimeHelpers(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : defaultCleanText;
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 50) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const safeParseJson = typeof deps.safeParseJson === 'function'
    ? deps.safeParseJson
    : defaultSafeParseJson;
  const requestAssistantTextOverride = typeof deps.requestAssistantText === 'function'
    ? deps.requestAssistantText
    : null;
  const requestTextOverride = typeof deps.requestText === 'function'
    ? deps.requestText
    : null;
  const requestImageInputOverride = typeof deps.requestImageInput === 'function'
    ? deps.requestImageInput
    : null;
  const requestFileInputOverride = typeof deps.requestFileInput === 'function'
    ? deps.requestFileInput
    : null;
  const requestStructuredJsonPayloadOverride = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const requestWebSearchOverride = typeof deps.requestWebSearch === 'function'
    ? deps.requestWebSearch
    : null;
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const llmProviderBridge = deps.llmProviderBridge && typeof deps.llmProviderBridge === 'object'
    ? deps.llmProviderBridge
    : null;

  function resolveLlmRequestOptions(options = {}) {
    const requestContextSource = getAgentRequestContext()?.llmSource
      && typeof getAgentRequestContext().llmSource === 'object'
      ? getAgentRequestContext().llmSource
      : {};
    const boundSource = options.llmSource && typeof options.llmSource === 'object'
      ? options.llmSource
      : (options.source && typeof options.source === 'object' ? options.source : {});
    const source = {
      ...requestContextSource,
      ...boundSource
    };
    const resolvedSource = {
      provider: cleanText(options.provider, 80) || cleanText(source.provider, 80),
      endpoint: cleanText(options.endpoint, 2000) || cleanText(source.endpoint, 2000),
      apiKey: cleanText(options.apiKey, 400) || cleanText(source.apiKey, 400),
      model: cleanText(options.model, 120) || cleanText(source.model, 120)
    };
    const resolved = {
      ...options,
      ...resolvedSource,
      llmSource: resolvedSource
    };
    delete resolved.source;
    return resolved;
  }

  function getCurrentLlmSource() {
    const requestContextSource = getAgentRequestContext()?.llmSource
      && typeof getAgentRequestContext().llmSource === 'object'
      ? getAgentRequestContext().llmSource
      : {};
    return {
      provider: cleanText(requestContextSource.provider, 80),
      endpoint: cleanText(requestContextSource.endpoint, 2000),
      apiKey: cleanText(requestContextSource.apiKey, 400),
      model: cleanText(requestContextSource.model, 120)
    };
  }

  function getCurrentLlmProvider() {
    return cleanText(getCurrentLlmSource().provider, 80);
  }

  function getBridgeMethod(methodName) {
    if (!llmProviderBridge || typeof llmProviderBridge !== 'object') {
      return null;
    }
    const candidate = llmProviderBridge[methodName];
    if (typeof candidate !== 'function') {
      return null;
    }
    return candidate.bind(llmProviderBridge);
  }

  function buildMissingBridgeResult(options = {}, fallbackError = 'LLM API bridge is not configured.') {
    return {
      ok: false,
      error: cleanText(options.defaultError, 600) || fallbackError
    };
  }

  async function requestText(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestTextOverride) {
      return requestTextOverride(requestOptions);
    }
    const bridgeRequestText = getBridgeMethod('requestText');
    if (!bridgeRequestText) {
      return buildMissingBridgeResult(requestOptions, 'Text generation bridge is not configured.');
    }
    return bridgeRequestText(requestOptions);
  }

  async function requestAssistantText(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestAssistantTextOverride) {
      return requestAssistantTextOverride(requestOptions);
    }
    return requestText(requestOptions);
  }

  async function requestImageInput(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestImageInputOverride) {
      return requestImageInputOverride(requestOptions);
    }
    const bridgeRequestImageInput = getBridgeMethod('requestImageInput');
    if (!bridgeRequestImageInput) {
      return buildMissingBridgeResult(requestOptions, 'Image input bridge is not configured.');
    }
    return bridgeRequestImageInput(requestOptions);
  }

  async function requestFileInput(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestFileInputOverride) {
      return requestFileInputOverride(requestOptions);
    }
    const bridgeRequestFileInput = getBridgeMethod('requestFileInput');
    if (!bridgeRequestFileInput) {
      return buildMissingBridgeResult(requestOptions, 'File input bridge is not configured.');
    }
    return bridgeRequestFileInput(requestOptions);
  }

  async function requestStructuredJsonPayload(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestStructuredJsonPayloadOverride) {
      return requestStructuredJsonPayloadOverride(requestOptions);
    }
    const normalizedFileData = cleanText(requestOptions.fileDataUrl || requestOptions.pdfDataUrl, 240000);
    const normalizedImageData = cleanText(requestOptions.imageDataUrl || requestOptions.imageUrl, 240000);
    const structuredRequest = {
      ...requestOptions,
      fileDataUrl: normalizedFileData,
      expectJson: true,
      defaultError: cleanText(requestOptions.defaultError, 600) || 'Structured JSON bridge is not configured.'
    };

    if (normalizedFileData) {
      return requestFileInput(structuredRequest);
    }
    if (normalizedImageData) {
      return requestImageInput({
        ...structuredRequest,
        imageDataUrl: cleanText(requestOptions.imageDataUrl, 240000),
        imageUrl: cleanText(requestOptions.imageUrl, 240000)
      });
    }
    return requestText(structuredRequest);
  }

  async function requestWebSearch(options = {}) {
    const requestOptions = resolveLlmRequestOptions(options);
    if (requestWebSearchOverride) {
      return requestWebSearchOverride(requestOptions);
    }
    const bridgeRequestWebSearch = getBridgeMethod('requestWebSearch');
    if (!bridgeRequestWebSearch) {
      return buildMissingBridgeResult(requestOptions, 'Web search bridge is not configured.');
    }
    return bridgeRequestWebSearch(requestOptions);
  }

  function createScopedLlmApi(source = {}) {
    const boundSource = source && typeof source === 'object' ? source : {};
    const bindOptions = (options = {}) => ({
      ...options,
      llmSource: {
        ...boundSource,
        ...(options.llmSource && typeof options.llmSource === 'object' ? options.llmSource : {}),
        ...(options.source && typeof options.source === 'object' ? options.source : {})
      }
    });

    return {
      requestText: (options = {}) => requestText(bindOptions(options)),
      requestAssistantText: (options = {}) => requestAssistantText(bindOptions(options)),
      requestImageInput: (options = {}) => requestImageInput(bindOptions(options)),
      requestFileInput: (options = {}) => requestFileInput(bindOptions(options)),
      requestStructuredJsonPayload: (options = {}) => requestStructuredJsonPayload(bindOptions(options)),
      requestWebSearch: (options = {}) => requestWebSearch(bindOptions(options))
    };
  }

  return {
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    recordAgentLlmTrace,
    getCurrentLlmSource,
    getCurrentLlmProvider,
    resolveLlmRequestOptions,
    createScopedLlmApi,
    requestText,
    requestAssistantText,
    requestImageInput,
    requestFileInput,
    requestStructuredJsonPayload,
    requestWebSearch
  };
}

module.exports = {
  defaultAsArray,
  defaultCleanText,
  defaultSafeParseJson,
  createAgentLlmRuntimeHelpers
};
