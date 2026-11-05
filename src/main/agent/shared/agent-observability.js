'use strict';

const fs = require('node:fs/promises');
const { extractPaperEvidenceFromToolEvent } = require('../runtime/tool-artifacts/paper-evidence.js');
const path = require('node:path');
const { asArray } = require('../../lib/normalize.js');
const { createUniqueStrings } = require('../../lib/value-utils.js');
const { pathExistsQuietly: pathExists } = require('../../lib/path-safety.js');

const DEFAULT_MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATIONS = 5;

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

const uniqueStrings = createUniqueStrings(cleanText, 0);

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 4) {
    return '[truncated-depth]';
  }
  if (typeof value === 'string') {
    return cleanText(value);
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
  return cleanText(String(value || ''));
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
  const summary = cleanText(source.summary || result.summary);
  // Lookup tools report one constant reason per call as citation_reason instead of
  // repeating it on every citation, so fall back to it when the row omits its own.
  const sharedReason = cleanText(source.citation_reason || result.citation_reason);
  return {
    ok: source.ok !== false,
    summary,
    items: items.slice(0, 5).map((item) => sanitizeJsonValue(item)),
    citations: citations.slice(0, 5).map((row) => ({
      source: cleanText(row?.source),
      pointer: cleanText(row?.pointer),
      reason: cleanText(row?.reason) || sharedReason
    })),
    error: cleanText(source.error)
  };
}

function createLifecycleRecorder({ requestId, onEvent = null } = {}) {
  return {
    requestId: cleanText(requestId),
    created_at: new Date().toISOString(),
    events: [],
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
    requestId: cleanText(event.requestId || recorder.requestId),
    stage: cleanText(event.stage),
    status: cleanText(event.status) || 'ok',
    message: cleanText(event.message),
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

  const toolName = cleanText(event.tool_name || event.toolName);
  if (toolName) {
    normalized.tool_name = toolName;
  }
  const responseType = cleanText(event.response_type || event.responseType);
  if (responseType) {
    normalized.response_type = responseType;
  }
  const routingIntent = cleanText(
    event.routing_intent
      || event.routingIntent
      || event.routing?.intent);
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
  // The audit summary is deliberately shallow. The evidence card needs the
  // full verified source lines before that summary drops nested tool output.
  const paperEvidence = extractPaperEvidenceFromToolEvent(event);
  if (paperEvidence.length) normalized.meta = { ...normalized.meta, paper_evidence: paperEvidence };
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
  const targetPath = cleanText(logPath);
  if (!targetPath) {
    throw new Error('logPath is required.');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const line = typeof entry === 'string' ? entry : JSON.stringify(entry);
  const payload = `${line}\n`;
  await rotateLogsIfNeeded(targetPath, Buffer.byteLength(payload), maxBytes, maxRotations);
  await fs.appendFile(targetPath, payload, 'utf8');
}

function classifyFailureReasons({
  result,
  routing,
  validation,
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
  if (plan.protocol_match?.needs_clarification === true) {
    const ambiguity = cleanText(plan.protocol_match?.ambiguity_reason).toLowerCase();
    if (ambiguity.includes('no_protocol') || !cleanText(plan.protocol_match?.selected_protocol_id)) {
      reasons.push('no_protocol_candidates');
    }
    if (ambiguity.includes('top_two') || ambiguity.includes('close') || ambiguity.includes('ambiguous')) {
      reasons.push('multiple_close_matches');
    }
  }
  if (cleanText(protocolNotebook.status) === 'needs_more_info') {
    if (!cleanText(protocolNotebook?.selected_protocol?.id)) {
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
    const toolName = cleanText(event?.tool_name);
    const message = cleanText(event?.message || event?.tool_output?.error).toLowerCase();
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

module.exports = {
  createLifecycleRecorder,
  recordLifecycleEvent,
  classifyFailureReasons,
  appendLogWithRotation
};
