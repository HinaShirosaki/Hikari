'use strict';

const {
  createAgentRequestAbortError,
  getAgentRequestAbortSignal,
  isAgentRequestAbortError,
  throwIfAgentRequestAborted
} = require('../../agent/shared/agent-request-context.js');

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

module.exports = {
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
  requestGeminiGenerateContentWithBackoff
};
