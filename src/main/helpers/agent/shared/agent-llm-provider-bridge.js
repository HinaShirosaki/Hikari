'use strict';

const { createCodexAgentLlmProvider } = require('./llm-providers/codex-agent-provider.js');
const { createOpenAiLlmProvider } = require('./llm-providers/openai-provider.js');
const { createClaudeLlmProvider } = require('./llm-providers/claude-provider.js');
const { createGeminiLlmProvider } = require('./llm-providers/gemini-provider.js');

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

function defaultToInputText(role, text) {
  return {
    role,
    content: [{ type: 'input_text', text: String(text || '') }]
  };
}

function defaultParsePdfDataUrl(pdfDataUrl) {
  const match = String(pdfDataUrl || '').trim().match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

function normalizeWebUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractSourceDomain(url) {
  const normalized = normalizeWebUrl(url);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
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
      return;
    }
    if (item?.type === 'output_text' && item.text) {
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

function createAgentLlmProviderBridge(deps = {}) {
  const LLM_PROVIDERS = deps.LLM_PROVIDERS && typeof deps.LLM_PROVIDERS === 'object'
    ? deps.LLM_PROVIDERS
    : {};
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const safeParseJson = typeof deps.safeParseJson === 'function' ? deps.safeParseJson : defaultSafeParseJson;
  const toInputText = typeof deps.toInputText === 'function' ? deps.toInputText : defaultToInputText;
  const parsePdfDataUrl = typeof deps.parsePdfDataUrl === 'function' ? deps.parsePdfDataUrl : defaultParsePdfDataUrl;
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
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const isAbortError = typeof deps.isAbortError === 'function'
    ? deps.isAbortError
    : (() => false);

  function parseJsonObjectFromText(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw !== 'string') {
      return null;
    }
    const parsed = safeParseJson(raw, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  }

  function normalizeWebSearchPayload(payload = {}, maxResults = 8) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const results = asArray(source.results || source.items || source.search_results)
      .map((item) => {
        const result = item && typeof item === 'object' ? item : {};
        const url = normalizeWebUrl(result.url || result.link);
        return {
          title: cleanText(result.title || result.name, 320),
          url,
          summary: cleanText(result.summary || result.snippet || result.description, 1200),
          source_domain: cleanText(result.source_domain, 120).toLowerCase() || extractSourceDomain(url)
        };
      })
      .filter((item) => item.url)
      .slice(0, Math.max(1, Number(maxResults) || 8));
    return {
      results,
      reasoning: cleanText(source.reasoning || source.summary, 600)
    };
  }

  function buildWebSearchPrompt({
    query = '',
    maxResults = 8,
    allowedDomains = [],
    userLocation = null,
    codexMode = false
  } = {}) {
    return [
      codexMode
        ? 'If internet access is available in this Codex environment, search the web for the requested query. If internet access is unavailable, return an empty results array and explain that in reasoning.'
        : 'Use web search to find relevant results for the requested query.',
      `Search query: ${cleanText(query, 800) || '-'}`,
      `Max results: ${Math.max(1, Number(maxResults) || 8)}`,
      `Allowed domains: ${asArray(allowedDomains).map((item) => cleanText(item, 160)).filter(Boolean).join(', ') || '-'}`,
      `User location: ${userLocation && typeof userLocation === 'object'
        ? JSON.stringify(userLocation)
        : '-'}`,
      'Return JSON only with this shape:',
      '{"results":[{"title":"...","url":"https://...","summary":"...","source_domain":"example.com"}],"reasoning":"brief note"}'
    ].join('\n\n');
  }

  async function recordTrace(traceContext, {
    stage,
    provider,
    model,
    summary,
    requestPayload,
    responsePayload
  }) {
    await recordAgentLlmTrace(traceContext, {
      stage,
      provider,
      model,
      summary,
      request_payload: requestPayload,
      response_payload: responsePayload
    });
  }

  const codexAgentProvider = createCodexAgentLlmProvider({
    asArray,
    cleanText,
    providerId: LLM_PROVIDERS.CODEX,
    toInputText,
    parsePdfDataUrl,
    requestOpenAiResponsesWithBackoff,
    requestCodexCliText,
    getWorkingDirectory: getCodexCliWorkingDirectory,
    extractResponseText,
    recordTrace,
    parseJsonObjectFromText,
    buildWebSearchPrompt,
    normalizeWebSearchPayload,
    isAbortError
  });
  const openAiProvider = createOpenAiLlmProvider({
    asArray,
    cleanText,
    providerId: LLM_PROVIDERS.OPENAI,
    toInputText,
    requestOpenAiResponsesWithBackoff,
    extractResponseText,
    recordTrace,
    parseJsonObjectFromText,
    buildWebSearchPrompt,
    normalizeWebSearchPayload,
    isAbortError
  });
  const claudeProvider = createClaudeLlmProvider({
    asArray,
    cleanText,
    providerId: LLM_PROVIDERS.CLAUDE,
    requestClaudeMessagesWithBackoff,
    extractClaudeResponseText,
    recordTrace,
    parseJsonObjectFromText,
    isAbortError
  });
  const geminiProvider = createGeminiLlmProvider({
    asArray,
    cleanText,
    providerId: LLM_PROVIDERS.GEMINI,
    requestGeminiGenerateContentWithBackoff,
    extractGeminiResponseText,
    recordTrace,
    parseJsonObjectFromText,
    isAbortError
  });

  function getProviderAdapter(provider = '') {
    if (provider === LLM_PROVIDERS.CODEX) {
      return codexAgentProvider;
    }
    if (provider === LLM_PROVIDERS.CLAUDE) {
      return claudeProvider;
    }
    if (provider === LLM_PROVIDERS.GEMINI) {
      return geminiProvider;
    }
    if (provider === LLM_PROVIDERS.OPENAI) {
      return openAiProvider;
    }
    return null;
  }

  async function requestText(options = {}) {
    const {
      provider,
      defaultError = 'Assistant text provider is not configured.'
    } = options;
    const adapter = getProviderAdapter(provider);
    if (!adapter || typeof adapter.requestText !== 'function') {
      return {
        ok: false,
        error: defaultError
      };
    }
    return adapter.requestText(options);
  }

  async function requestImageInput(options = {}) {
    const {
      provider,
      defaultError = 'Image input provider is not configured.'
    } = options;
    const adapter = getProviderAdapter(provider);
    if (!adapter || typeof adapter.requestImageInput !== 'function') {
      return {
        ok: false,
        error: defaultError
      };
    }
    return adapter.requestImageInput(options);
  }

  async function requestFileInput(options = {}) {
    const {
      provider,
      defaultError = 'File input provider is not configured.'
    } = options;
    const adapter = getProviderAdapter(provider);
    if (!adapter || typeof adapter.requestFileInput !== 'function') {
      return {
        ok: false,
        error: defaultError
      };
    }
    return adapter.requestFileInput(options);
  }

  async function requestWebSearch(options = {}) {
    const {
      provider,
      defaultError = 'Web search provider is not configured.'
    } = options;
    const adapter = getProviderAdapter(provider);
    if (!adapter || typeof adapter.requestWebSearch !== 'function') {
      return {
        ok: false,
        error: defaultError
      };
    }
    return adapter.requestWebSearch(options);
  }

  return {
    requestText,
    requestImageInput,
    requestFileInput,
    requestWebSearch
  };
}

module.exports = {
  createAgentLlmProviderBridge
};
