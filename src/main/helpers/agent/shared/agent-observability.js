'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATIONS = 5;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 120);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 4) {
    return '[truncated-depth]';
  }
  if (typeof value === 'string') {
    return cleanText(value, 280);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    Object.keys(value).slice(0, 20).forEach((key) => {
      output[key] = sanitizeJsonValue(value[key], depth + 1);
    });
    return output;
  }
  return cleanText(String(value || ''), 120);
}

function truncateToolOutput(toolOutput) {
  const source = toolOutput && typeof toolOutput === 'object' ? toolOutput : {};
  const result = source.result && typeof source.result === 'object' ? source.result : {};
  const items = asArray(source.items).length
    ? asArray(source.items)
    : asArray(result.items);
  const citations = asArray(source.citations).length
    ? asArray(source.citations)
    : asArray(result.citations);
  const summary = cleanText(source.summary || result.summary, 300);
  return {
    ok: source.ok !== false,
    summary,
    items: items.slice(0, 5).map((item) => sanitizeJsonValue(item)),
    citations: citations.slice(0, 5).map((row) => ({
      source: cleanText(row?.source, 120),
      pointer: cleanText(row?.pointer, 220),
      reason: cleanText(row?.reason, 260)
    })),
    error: cleanText(source.error, 300)
  };
}

function createLifecycleRecorder({ requestId, onEvent = null } = {}) {
  return {
    requestId: cleanText(requestId, 80),
    created_at: new Date().toISOString(),
    events: [],
    flushed_count: 0,
    onEvent: typeof onEvent === 'function' ? onEvent : null
  };
}

function recordLifecycleEvent(recorder, rawEvent = {}) {
  if (!recorder || typeof recorder !== 'object') {
    return null;
  }
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
  const normalized = {
    type: 'agent-lifecycle',
    requestId: cleanText(event.requestId || recorder.requestId, 80),
    stage: cleanText(event.stage, 40),
    status: cleanText(event.status, 20) || 'ok',
    message: cleanText(event.message, 360),
    timestamp: new Date().toISOString()
  };
  if (!normalized.stage) {
    return null;
  }
  if (normalized.stage === 'tool_call_started') {
    normalized.direction = 'llm->app';
  } else if (normalized.stage === 'tool_call_completed' || normalized.stage === 'tool_call_failed') {
    normalized.direction = 'app->llm';
  }

  const toolName = cleanText(event.tool_name || event.toolName, 120);
  if (toolName) {
    normalized.tool_name = toolName;
  }
  const responseType = cleanText(event.response_type || event.responseType, 80);
  if (responseType) {
    normalized.response_type = responseType;
  }
  const routingIntent = cleanText(
    event.routing_intent
      || event.routingIntent
      || event.routing?.intent,
    80
  );
  if (routingIntent) {
    normalized.routing_intent = routingIntent;
  }
  if (event.tool_args && typeof event.tool_args === 'object') {
    normalized.tool_args = sanitizeJsonValue(event.tool_args);
  } else if (event.toolArgs && typeof event.toolArgs === 'object') {
    normalized.tool_args = sanitizeJsonValue(event.toolArgs);
  }
  const toolOutput = event.tool_output && typeof event.tool_output === 'object'
    ? event.tool_output
    : (event.toolOutput && typeof event.toolOutput === 'object' ? event.toolOutput : null);
  if (toolOutput) {
    normalized.tool_output = truncateToolOutput(toolOutput);
  }

  const failureReasons = uniqueStrings(event.failure_reasons || event.failureReasons);
  if (failureReasons.length) {
    normalized.failure_reasons = failureReasons;
  }
  if (event.meta && typeof event.meta === 'object') {
    normalized.meta = sanitizeJsonValue(event.meta);
  }
  recorder.events.push(normalized);
  if (typeof recorder.onEvent === 'function') {
    try {
      recorder.onEvent(normalized);
    } catch {
      // Keep lifecycle recording resilient even if live progress publishing fails.
    }
  }
  return normalized;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function rotateLogsIfNeeded(logPath, incomingBytes, maxBytes, maxRotations) {
  let currentSize = 0;
  try {
    const stat = await fs.stat(logPath);
    currentSize = Number(stat.size) || 0;
  } catch {
    currentSize = 0;
  }

  if ((currentSize + incomingBytes) <= maxBytes) {
    return;
  }

  for (let index = maxRotations; index >= 1; index -= 1) {
    const target = `${logPath}.${index}`;
    if (index === maxRotations && await pathExists(target)) {
      await fs.rm(target, { force: true });
    }
    const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
    if (await pathExists(source)) {
      await fs.rename(source, target);
    }
  }
}

async function appendLogWithRotation({
  logPath,
  entry,
  maxBytes = DEFAULT_MAX_LOG_SIZE_BYTES,
  maxRotations = DEFAULT_MAX_ROTATIONS
} = {}) {
  const targetPath = cleanText(logPath, 1600);
  if (!targetPath) {
    throw new Error('logPath is required.');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const line = typeof entry === 'string' ? entry : JSON.stringify(entry);
  const payload = `${line}\n`;
  await rotateLogsIfNeeded(targetPath, Buffer.byteLength(payload), maxBytes, maxRotations);
  await fs.appendFile(targetPath, payload, 'utf8');
}

async function readLifecycleLogs({ logPath, requestId = '', limit = 1000 } = {}) {
  const targetPath = cleanText(logPath, 1600);
  if (!targetPath) {
    return [];
  }
  const files = [];
  for (let index = DEFAULT_MAX_ROTATIONS; index >= 1; index -= 1) {
    files.push(`${targetPath}.${index}`);
  }
  files.push(targetPath);

  const rows = [];
  for (const filePath of files) {
    if (!await pathExists(filePath)) {
      continue;
    }
    const raw = await fs.readFile(filePath, 'utf8');
    raw.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (!requestId || cleanText(parsed?.requestId, 80) === cleanText(requestId, 80)) {
          rows.push(parsed);
        }
      } catch {
        // Ignore malformed log lines.
      }
    });
  }

  if (limit > 0 && rows.length > limit) {
    return rows.slice(rows.length - limit);
  }
  return rows;
}

function classifyFailureReasons({
  result,
  routing,
  validation,
  error,
  lifecycleEvents
} = {}) {
  const reasons = [];
  const resolvedResult = result && typeof result === 'object' ? result : {};
  const resolvedRouting = routing && typeof routing === 'object'
    ? routing
    : (resolvedResult.routing && typeof resolvedResult.routing === 'object' ? resolvedResult.routing : {});
  const resolvedValidation = validation && typeof validation === 'object'
    ? validation
    : (resolvedResult.validation && typeof resolvedResult.validation === 'object' ? resolvedResult.validation : {});
  const plan = resolvedRouting.plan && typeof resolvedRouting.plan === 'object' ? resolvedRouting.plan : {};
  const protocolNotebook = resolvedResult.protocol_to_notebook && typeof resolvedResult.protocol_to_notebook === 'object'
    ? resolvedResult.protocol_to_notebook
    : {};

  if (resolvedValidation.passed === false || resolvedValidation.forced_clarification === true) {
    reasons.push('validation_failed');
  }
  if (
    String(resolvedResult.error || error || '').toLowerCase().includes('intent parser')
    || asArray(lifecycleEvents).some((event) => event?.stage === 'parser_completed' && event?.status === 'failed')
  ) {
    reasons.push('intent_parser_failed');
  }
  if (plan.protocol_match?.needs_clarification === true) {
    const ambiguity = cleanText(plan.protocol_match?.ambiguity_reason, 200).toLowerCase();
    if (ambiguity.includes('no_protocol') || !cleanText(plan.protocol_match?.selected_protocol_id, 80)) {
      reasons.push('no_protocol_candidates');
    }
    if (ambiguity.includes('top_two') || ambiguity.includes('close') || ambiguity.includes('ambiguous')) {
      reasons.push('multiple_close_matches');
    }
  }
  if (cleanText(protocolNotebook.status, 40) === 'needs_more_info') {
    if (!cleanText(protocolNotebook?.selected_protocol?.id, 120)) {
      reasons.push('no_protocol_candidates');
    }
    if (asArray(protocolNotebook?.missing_placeholders).length > 0) {
      reasons.push('missing_notebook_placeholders');
    }
  }
  if (plan.needs_deep_paper_reading === true && plan.paper_match?.deep_read_ready !== true) {
    reasons.push('pdf_missing');
  }

  asArray(lifecycleEvents).forEach((event) => {
    if (event?.stage !== 'tool_call_failed') {
      return;
    }
    const toolName = cleanText(event?.tool_name, 120);
    const message = cleanText(event?.message || event?.tool_output?.error, 320).toLowerCase();
    if (message.includes('unknown tool') || message.includes('not found')) {
      reasons.push('tool_not_found');
      return;
    }
    if (toolName === 'run_python_sandbox' || toolName === 'python-sandbox' || message.includes('python')) {
      reasons.push('python_exception');
      return;
    }
    reasons.push('tool_call_error');
  });

  return uniqueStrings(reasons);
}

async function replayRequestLifecycle({ requestId, logPath } = {}) {
  const normalizedRequestId = cleanText(requestId, 80);
  if (!normalizedRequestId) {
    return {
      ok: false,
      error: 'requestId is required.',
      requestId: '',
      events: [],
      summary: {}
    };
  }

  const rows = await readLifecycleLogs({
    logPath,
    requestId: normalizedRequestId,
    limit: 5000
  });
  const events = rows.filter((row) => cleanText(row?.type, 40) === 'agent-lifecycle');
  const traces = rows
    .filter((row) => cleanText(row?.type, 40) === 'agent-llm-trace')
    .map((row) => ({
      type: 'agent-llm-trace',
      requestId: cleanText(row?.requestId, 80),
      stage: cleanText(row?.stage, 120),
      provider: cleanText(row?.provider, 80),
      model: cleanText(row?.model, 120),
      summary: cleanText(row?.summary, 320),
      timestamp: cleanText(row?.timestamp, 80),
      request_payload: row?.request_payload && typeof row.request_payload === 'object'
        ? sanitizeJsonValue(row.request_payload)
        : sanitizeJsonValue(row?.request_payload),
      response_payload: row?.response_payload && typeof row.response_payload === 'object'
        ? sanitizeJsonValue(row.response_payload)
        : sanitizeJsonValue(row?.response_payload)
    }));
  const request = rows.find((row) => cleanText(row?.type, 80) === 'agent-chat-request') || null;
  const result = rows.find((row) => cleanText(row?.type, 80) === 'agent-chat-result')
    || rows.find((row) => cleanText(row?.type, 80) === 'agent-chat-error')
    || null;
  const failureReasons = classifyFailureReasons({
    result,
    routing: result?.routing,
    validation: result?.validation,
    error: result?.error,
    lifecycleEvents: events
  });

  return {
    ok: true,
    requestId: normalizedRequestId,
    request,
    result,
    events,
    traces,
    summary: {
      request_id: normalizedRequestId,
      event_count: events.length,
      trace_count: traces.length,
      stages: uniqueStrings(events.map((event) => cleanText(event?.stage, 40))),
      trace_stages: uniqueStrings(traces.map((trace) => cleanText(trace?.stage, 120))),
      trace_request_payload_count: traces.reduce((sum, trace) => sum + (trace?.request_payload ? 1 : 0), 0),
      trace_response_payload_count: traces.reduce((sum, trace) => sum + (trace?.response_payload ? 1 : 0), 0),
      started_at: cleanText(rows[0]?.timestamp, 80),
      ended_at: cleanText(rows[rows.length - 1]?.timestamp, 80),
      failure_reasons: failureReasons
    }
  };
}

module.exports = {
  createLifecycleRecorder,
  recordLifecycleEvent,
  classifyFailureReasons,
  appendLogWithRotation,
  readLifecycleLogs,
  replayRequestLifecycle
};
