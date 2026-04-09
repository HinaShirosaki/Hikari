'use strict';

const {
  createAgentRequestAbortError,
  getAgentRequestAbortSignal,
  isAgentRequestAbortError,
  throwIfAgentRequestAborted
} = require('./agent-request-context.js');
const { createAgentLlmProviderBridge } = require('./agent-llm-provider-bridge.js');

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
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

function parsePdfDataUrl(pdfDataUrl) {
  const match = String(pdfDataUrl || '').trim().match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

function defaultToInputText(role, text) {
  return {
    role,
    content: [{ type: 'input_text', text: String(text || '') }]
  };
}

function defaultExtractResponseText(payload, asArray = defaultAsArray) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  asArray(payload?.output).forEach((item) => {
    if (item?.type === 'message') {
      asArray(item.content).forEach((content) => {
        if (content?.type === 'output_text' && content.text) {
          chunks.push(content.text);
        }
      });
    } else if (item?.type === 'output_text' && item.text) {
      chunks.push(item.text);
    }
  });
  return chunks.join('\n').trim();
}

function defaultExtractClaudeResponseText(payload, asArray = defaultAsArray) {
  return asArray(payload?.content)
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function defaultExtractGeminiResponseText(payload, asArray = defaultAsArray) {
  const candidate = Array.isArray(payload?.candidates) && payload.candidates.length > 0
    ? payload.candidates[0]
    : null;
  if (!candidate?.content?.parts) {
    return '';
  }
  return asArray(candidate.content.parts)
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sleepWithAbort(ms, signal) {
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    return Promise.reject(createAgentRequestAbortError(signal.reason || 'Agent request stopped.'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(createAgentRequestAbortError(signal.reason || 'Agent request stopped.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestJsonWithBackoff({
  endpoint,
  headers,
  body,
  retryStatuses = [429, 503],
  maxRetries = 3
} = {}) {
  const abortSignal = getAgentRequestAbortSignal();
  let attempt = 0;
  while (attempt <= maxRetries) {
    throwIfAgentRequestAborted('Agent request stopped before sending LLM request.');
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {})
      });
    } catch (error) {
      if (abortSignal?.aborted || isAgentRequestAbortError(error)) {
        throw createAgentRequestAbortError(abortSignal?.reason || error?.message || 'Agent request stopped.');
      }
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await sleepWithAbort(waitMs, abortSignal);
      attempt += 1;
      continue;
    }

    throwIfAgentRequestAborted('Agent request stopped while waiting for LLM response.');
    if (!retryStatuses.includes(response.status)) {
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`LLM API error (${response.status}): ${raw}`);
      }
      return response.json();
    }

    if (attempt >= maxRetries) {
      const raw = await response.text();
      throw new Error(`LLM API rate-limited (${response.status}): ${raw}`);
    }

    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
    await sleepWithAbort(retryAfterMs, abortSignal);
    attempt += 1;
  }

  throw new Error('LLM API request failed after retries.');
}

async function requestOpenAiResponsesWithBackoff({ endpoint, apiKey, body } = {}) {
  return requestJsonWithBackoff({
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body,
    retryStatuses: [429, 503]
  });
}

async function requestClaudeMessagesWithBackoff({ endpoint, apiKey, body } = {}) {
  return requestJsonWithBackoff({
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body,
    retryStatuses: [429, 503, 529]
  });
}

function buildGeminiGenerateContentUrl(endpoint, model, apiKey, fallbackEndpoint = 'https://generativelanguage.googleapis.com/v1beta') {
  const cleanEndpoint = defaultCleanText(endpoint, 300) || fallbackEndpoint;
  let url = cleanEndpoint.replace(/\/+$/, '');
  if (!url.includes(':generateContent')) {
    if (/\/models\/[^/?#]+$/i.test(url)) {
      url = `${url}:generateContent`;
    } else if (/\/models$/i.test(url)) {
      url = `${url}/${encodeURIComponent(model)}:generateContent`;
    } else {
      url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
}

async function requestGeminiGenerateContentWithBackoff({
  endpoint,
  apiKey,
  model,
  body,
  fallbackEndpoint
} = {}) {
  return requestJsonWithBackoff({
    endpoint: buildGeminiGenerateContentUrl(endpoint, model, apiKey, fallbackEndpoint),
    headers: {
      'Content-Type': 'application/json'
    },
    body,
    retryStatuses: [429, 503]
  });
}

function createAgentLlmRuntimeHelpers(deps = {}) {
  const LLM_PROVIDERS = deps.LLM_PROVIDERS && typeof deps.LLM_PROVIDERS === 'object'
    ? deps.LLM_PROVIDERS
    : {};
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
  const requestStructuredJsonPayloadOverride = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const requestClaudeMessagesWithBackoff = deps.requestClaudeMessagesWithBackoff;
  const requestGeminiGenerateContentWithBackoff = deps.requestGeminiGenerateContentWithBackoff;
  const requestOpenAiResponsesWithBackoff = deps.requestOpenAiResponsesWithBackoff;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : ((payload) => defaultExtractClaudeResponseText(payload, asArray));
  const extractGeminiResponseText = typeof deps.extractGeminiResponseText === 'function'
    ? deps.extractGeminiResponseText
    : ((payload) => defaultExtractGeminiResponseText(payload, asArray));
  const extractResponseText = typeof deps.extractResponseText === 'function'
    ? deps.extractResponseText
    : ((payload) => defaultExtractResponseText(payload, asArray));
  const toInputText = typeof deps.toInputText === 'function'
    ? deps.toInputText
    : defaultToInputText;
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  let llmProviderBridge = deps.llmProviderBridge && typeof deps.llmProviderBridge === 'object'
    ? deps.llmProviderBridge
    : null;

  function getLlmProviderBridge() {
    if (llmProviderBridge && typeof llmProviderBridge === 'object') {
      return llmProviderBridge;
    }
    // The shared provider bridge owns provider-specific request shaping,
    // including pdfDataUrl/fileName attachments for OpenAI input_file,
    // Gemini inlineData, and Claude document inputs.
    llmProviderBridge = createAgentLlmProviderBridge({
      LLM_PROVIDERS,
      asArray,
      cleanText,
      safeParseJson,
      toInputText,
      parsePdfDataUrl,
      requestCodexCliText,
      getCodexCliWorkingDirectory,
      requestClaudeMessagesWithBackoff,
      requestGeminiGenerateContentWithBackoff,
      requestOpenAiResponsesWithBackoff,
      extractClaudeResponseText,
      extractGeminiResponseText,
      extractResponseText,
      recordAgentLlmTrace,
      isAbortError: isAgentRequestAbortError
    });
    return llmProviderBridge;
  }

  async function requestAssistantText(options = {}) {
    if (requestAssistantTextOverride) {
      return requestAssistantTextOverride({ ...options });
    }
    return getLlmProviderBridge().requestAssistantText({ ...options });
  }

  async function requestStructuredJsonPayload(options = {}) {
    if (requestStructuredJsonPayloadOverride) {
      return requestStructuredJsonPayloadOverride({ ...options });
    }
    return getLlmProviderBridge().requestStructuredJsonPayload({ ...options });
  }

  return {
    LLM_PROVIDERS,
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    toInputText,
    recordAgentLlmTrace,
    requestAssistantText,
    requestStructuredJsonPayload
  };
}

module.exports = {
  defaultAsArray,
  defaultCleanText,
  defaultSafeParseJson,
  parsePdfDataUrl,
  defaultToInputText,
  defaultExtractResponseText,
  defaultExtractClaudeResponseText,
  defaultExtractGeminiResponseText,
  sleep,
  sleepWithAbort,
  requestJsonWithBackoff,
  requestOpenAiResponsesWithBackoff,
  requestClaudeMessagesWithBackoff,
  buildGeminiGenerateContentUrl,
  requestGeminiGenerateContentWithBackoff,
  createAgentLlmRuntimeHelpers
};
