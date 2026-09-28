'use strict';

// Agent chat-log tracing: conversation excerpts, request ids, and the redacted
// LLM trace entries written for every call.
function createAgentTracing({ asArray, cleanText } = {}) {
  function extractConversation(rawConversation) {
    return asArray(rawConversation)
      .slice(-10)
      .map((item) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        text: cleanText(item?.text, 2500)
      }))
      .filter((item) => item.text);
  }

  function buildAgentLogRequestId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function summarizeLlmForAgentLog(llm) {
    const source = llm && typeof llm === 'object' ? llm : {};
    return {
      provider: cleanText(source.provider, 80),
      apiEndpoint: cleanText(source.apiEndpoint || source.api, 300),
      model: cleanText(source.model, 120),
      apiKeyProvided: Boolean(cleanText(source.apiKey, 12))
    };
  }

  const SENSITIVE_TRACE_KEYS = new Set([
    'apikey',
    'api_key',
    'authorization',
    'x-api-key',
    'token',
    'access_token',
    'bearer'
  ]);

  function isSensitiveTraceKey(key) {
    const normalized = cleanText(key, 80).toLowerCase();
    if (!normalized) {
      return false;
    }
    if (SENSITIVE_TRACE_KEYS.has(normalized)) {
      return true;
    }
    return normalized.includes('token')
      || normalized.includes('secret')
      || normalized.includes('authorization')
      || normalized.includes('api_key')
      || normalized.includes('apikey');
  }

  function redactTracePayload(value, depth = 0, seen = new WeakSet()) {
    if (value == null) {
      return value;
    }
    if (typeof value === 'string') {
      return cleanText(value, 16000);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (depth >= 8) {
      return '[TRUNCATED_DEPTH]';
    }
    if (Array.isArray(value)) {
      return value.slice(0, 40).map((item) => redactTracePayload(item, depth + 1, seen));
    }
    if (typeof value === 'object') {
      if (seen.has(value)) {
        return '[CIRCULAR]';
      }
      seen.add(value);
      const out = {};
      Object.entries(value).slice(0, 120).forEach(([key, entryValue]) => {
        if (isSensitiveTraceKey(key)) {
          out[key] = '[REDACTED]';
          return;
        }
        out[key] = redactTracePayload(entryValue, depth + 1, seen);
      });
      return out;
    }
    return cleanText(String(value), 2000);
  }

  function createAgentLlmTraceContext({
    requestId = '',
    provider = '',
    model = ''
  } = {}) {
    return {
      requestId: cleanText(requestId, 80),
      provider: cleanText(provider, 80),
      model: cleanText(model, 120),
      rows: [],
      entries: []
    };
  }

  function formatAgentChatLogEntry(entry) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    });
  }

  function recordAgentLlmTrace(traceContext, event = {}) {
    const trace = traceContext && typeof traceContext === 'object' ? traceContext : null;
    if (!trace) {
      return;
    }
    const stage = cleanText(event.stage, 120) || 'llm';
    const provider = cleanText(event.provider, 80) || trace.provider;
    const model = cleanText(event.model, 120) || trace.model;
    const summary = cleanText(event.summary, 320);
    const timestamp = new Date().toISOString();
    const requestPayload = redactTracePayload(event.request_payload);
    const responsePayload = redactTracePayload(event.response_payload);
    // Background callers (scheduled tasks, notebook suggestions) pass a bare { requestId }.
    trace.rows ||= [];
    trace.entries ||= [];
    trace.rows.push({
      stage,
      provider,
      model,
      summary,
      timestamp
    });
    const requestId = cleanText(trace.requestId, 80);
    const logEntry = {
      type: 'agent-llm-trace',
      requestId,
      stage,
      provider,
      model,
      summary,
      timestamp,
      request_direction: 'app->llm',
      response_direction: 'llm->app',
      request_payload: requestPayload,
      response_payload: responsePayload
    };
    trace.entries.push(logEntry);
  }

  return {
    extractConversation,
    buildAgentLogRequestId,
    summarizeLlmForAgentLog,
    isSensitiveTraceKey,
    redactTracePayload,
    createAgentLlmTraceContext,
    formatAgentChatLogEntry,
    recordAgentLlmTrace
  };
}

module.exports = { createAgentTracing };
