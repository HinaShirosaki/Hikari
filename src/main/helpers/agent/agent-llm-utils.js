'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
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

async function requestJsonWithBackoff({
  endpoint,
  headers,
  body,
  retryStatuses = [429, 503],
  maxRetries = 3
} = {}) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

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
    await sleep(retryAfterMs);
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

  async function requestStructuredJsonPayload(options = {}) {
    const {
    provider,
    endpoint,
    apiKey,
    model,
    stage,
    systemPrompt,
    userPrompt,
    schema,
    traceContext = null,
    maxOutputTokens = null,
    openAiStrict = null,
    openAiAsDefaultProvider = false,
    defaultError = 'Structured JSON provider is not configured.'
    } = options;
    if (requestStructuredJsonPayloadOverride) {
      return requestStructuredJsonPayloadOverride({ ...options });
    }

    const system = cleanText(systemPrompt, 12000);
    const user = cleanText(userPrompt, 48000);
    const normalizedStage = cleanText(stage, 120) || 'agent_stage';

    try {
      if (provider === LLM_PROVIDERS.CODEX) {
        const prompt = [system, user, 'Return JSON only.'].filter(Boolean).join('\n\n');
        const raw = await requestCodexCliText({
          prompt,
          model,
          cwd: getCodexCliWorkingDirectory()
        });
        await recordAgentLlmTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Codex CLI.`,
          request_payload: { model, prompt },
          response_payload: raw
        });
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        return { ok: true, payload: parsed, raw };
      }

      if (provider === LLM_PROVIDERS.CLAUDE) {
        const body = {
          model,
          system: system || 'Return valid JSON only.',
          max_tokens: Number.isFinite(Number(maxOutputTokens)) ? Number(maxOutputTokens) : 1600,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: `${user}\n\nReturn JSON only.` }]
            }
          ]
        };
        const response = await requestClaudeMessagesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordAgentLlmTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Claude.`,
          request_payload: body,
          response_payload: response
        });
        const parsed = parseJsonObjectFromText(extractClaudeResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }

      if (provider === LLM_PROVIDERS.GEMINI) {
        const body = {
          systemInstruction: {
            parts: [{ text: system || 'Return valid JSON only.' }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: `${user}\n\nReturn JSON only.` }]
            }
          ],
          generationConfig: {
            ...(Number.isFinite(Number(maxOutputTokens)) ? { maxOutputTokens: Number(maxOutputTokens) } : {})
          }
        };
        const response = await requestGeminiGenerateContentWithBackoff({
          endpoint,
          apiKey,
          model,
          body
        });
        await recordAgentLlmTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Gemini.`,
          request_payload: body,
          response_payload: response
        });
        const parsed = parseJsonObjectFromText(extractGeminiResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }

      if ((provider === LLM_PROVIDERS.OPENAI || openAiAsDefaultProvider === true) && typeof requestOpenAiResponsesWithBackoff === 'function') {
        const format = {
          type: 'json_schema',
          name: normalizedStage.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'stage_result',
          schema
        };
        if (typeof openAiStrict === 'boolean') {
          format.strict = openAiStrict;
        }
        const body = {
          model,
          input: [
            toInputText('system', system || 'Return valid JSON only.'),
            toInputText('user', user)
          ],
          text: { format }
        };
        if (Number.isFinite(Number(maxOutputTokens))) {
          body.max_output_tokens = Number(maxOutputTokens);
        }
        const response = await requestOpenAiResponsesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordAgentLlmTrace(traceContext, {
          stage: normalizedStage,
          provider: provider === LLM_PROVIDERS.OPENAI ? provider : LLM_PROVIDERS.OPENAI,
          model,
          summary: `${normalizedStage} completed via OpenAI Responses.`,
          request_payload: body,
          response_payload: response
        });
        const parsed = parseJsonObjectFromText(extractResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }

    return {
      ok: false,
      error: defaultError
    };
  }

  return {
    LLM_PROVIDERS,
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson,
    toInputText,
    recordAgentLlmTrace,
    parseJsonObjectFromText,
    requestStructuredJsonPayload
  };
}

module.exports = {
  defaultAsArray,
  defaultCleanText,
  defaultSafeParseJson,
  defaultToInputText,
  defaultExtractResponseText,
  defaultExtractClaudeResponseText,
  defaultExtractGeminiResponseText,
  sleep,
  requestJsonWithBackoff,
  requestOpenAiResponsesWithBackoff,
  requestClaudeMessagesWithBackoff,
  buildGeminiGenerateContentUrl,
  requestGeminiGenerateContentWithBackoff,
  createAgentLlmRuntimeHelpers
};
