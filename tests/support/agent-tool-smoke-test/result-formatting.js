'use strict';

const { cloneJson, ensureObject } = require('../../../src/main/lib/normalize.js');
const { cleanText } = require('./utils.js');

function buildPreview(toolName, result) {
  const source = ensureObject(result);
  if (toolName === 'inventory-lookup') {
    return cleanText(source.items?.[0]?.name || source.items?.[0]?.id);
  }
  if (toolName === 'notebook-lookup') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.protocolName || source.items?.[0]?.id);
  }
  if (toolName === 'protocol-matching') {
    return cleanText(source.selected_protocol?.name);
  }
  if (toolName === 'notebook-generation') {
    return cleanText(source.rendered_step_preview || source.summary);
  }
  if (toolName === 'notebook-draft') {
    return cleanText(source.proposal?.title || source.selected_protocol?.name || source.summary);
  }
  if (toolName === 'python-sandbox') {
    return cleanText(source.readback_files?.[0]?.path);
  }
  if (toolName === 'sub-agent') {
    return cleanText(source.agent_id);
  }
  if (toolName === 'memory') {
    return cleanText(source.items?.[0]?.summary || source.items?.[0]?.key);
  }
  if (toolName === 'container') {
    return cleanText(source.container?.name || source.container?.id || source.items?.[0]?.name);
  }
  if (toolName === 'web-search') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.url);
  }
  if (toolName === 'literature-search') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.accession);
  }
  if (toolName === 'purchase-recommendation') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.vendor);
  }
  if (toolName === 'paper-download') {
    return cleanText(source.relative_path || source.file_name);
  }
  if (toolName === 'paper-analysis') {
    return cleanText(source.generated_protocol?.name || source.paper_title);
  }
  if (toolName === 'paper-search') {
    return cleanText(source.items?.[0]?.section_heading || source.items?.[0]?.title);
  }
  if (toolName === 'protocol-generation') {
    return cleanText(source.protocol?.name);
  }
  return '';
}

function buildResultMessage(toolName, result, fallbackSummary = '') {
  const source = ensureObject(result);
  const candidates = [];
  if (toolName === 'memory') {
    candidates.push(source.items?.[0]?.summary);
  }
  if (toolName === 'container') {
    candidates.push(source.container?.value_preview, source.container?.name);
  }
  if (toolName === 'web-search') {
    candidates.push(source.items?.[0]?.summary);
  }
  if (toolName === 'literature-search') {
    candidates.push(source.items?.[0]?.summary);
  }
  if (toolName === 'purchase-recommendation') {
    candidates.push(source.items?.[0]?.vendor);
  }
  candidates.push(
    source.summary,
    source.result_summary,
    source.message,
    source.answer,
    source.rationale,
    source.error,
    fallbackSummary
  );
  return cleanText(candidates.find((value) => cleanText(value, 6000)));
}

function normalizeToolSmokeItem(toolName, result, durationMs, options = {}) {
  const source = ensureObject(result);
  const summary = cleanText(source.summary || source.error || `${toolName} smoke test completed.`);
  const requestMessage = cleanText(options.requestMessage);
  return {
    tool_name: cleanText(toolName),
    ok: source.ok !== false,
    status: cleanText(source.status) || (source.ok === false ? 'error' : 'ok'),
    summary,
    request_message: requestMessage,
    result_message: buildResultMessage(toolName, source, summary),
    preview: buildPreview(toolName, source),
    error: source.ok === false ? cleanText(source.error) : '',
    duration_ms: Math.max(0, Number(durationMs) || 0),
    raw_result: cloneJson(source, {})
  };
}

module.exports = {
  buildPreview,
  buildResultMessage,
  normalizeToolSmokeItem
};
