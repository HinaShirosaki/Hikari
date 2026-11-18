'use strict';

const path = require('node:path');
const { formatHikariExecActivity, formatHikariToolActivity } = require('../../../shared/hikari-mcp-activity.mjs');
const { cleanText } = require('./utils');
const { parseCodexToolArguments } = require('./event-values');

function basenameForCodexDisplay(value = '') {
  const text = cleanText(value, 1200);
  if (!text) {
    return '';
  }
  try {
    return path.basename(text.replace(/^file:\/\//u, '')) || text;
  } catch {
    return text.split(/[\\/]/u).filter(Boolean).pop() || text;
  }
}

function firstQuotedPath(value = '') {
  const text = cleanText(value, 4000);
  const quoted = text.match(/["']([^"']+\.(?:js|mjs|cjs|json|md|txt|css|html|ts|tsx|jsx|py|toml|yaml|yml|pdf))["']/iu);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const bare = text.match(/(?:^|\s)(\/[^\s"'`]+\.(?:js|mjs|cjs|json|md|txt|css|html|ts|tsx|jsx|py|toml|yaml|yml|pdf))/iu);
  return bare?.[1] || '';
}

function summarizeExecCommandForCodexProgress(args = {}, status = '') {
  const cmd = cleanText(args.cmd || args.command || args.input, 4000);
  if (!cmd) {
    return status === 'completed' ? 'Local command completed.' : 'Running local command.';
  }
  const targetPath = firstQuotedPath(cmd);
  const targetName = basenameForCodexDisplay(targetPath);
  const completed = status === 'completed';
  if (/^\s*(sed|cat|head|tail|nl)\b/u.test(cmd)) {
    return completed
      ? `Read ${targetName || 'workspace file'}.`
      : `Reading ${targetName || 'workspace file'}...`;
  }
  if (/^\s*rg\b/u.test(cmd)) {
    return completed
      ? `Search completed${targetName ? ` in ${targetName}` : ''}.`
      : `Searching${targetName ? ` ${targetName}` : ' workspace'}...`;
  }
  if (/^\s*(ls|find)\b/u.test(cmd)) {
    return completed ? 'Workspace listing completed.' : 'Listing workspace files...';
  }
  if (/^\s*node\b/u.test(cmd)) {
    return completed ? 'Node check completed.' : 'Running Node check...';
  }
  if (/^\s*(curl|wget)\b/u.test(cmd)) {
    return completed ? 'Network request completed.' : 'Calling local service...';
  }
  return completed ? 'Local command completed.' : 'Running local command...';
}

function stripMcpServerPrefix(name = '') {
  return cleanText(name, 160).replace(/^mcp__[a-z0-9-]+__/iu, '');
}

function looksLikeJsonBlob(value = '') {
  const text = cleanText(value, 80).trimStart();
  return text.startsWith('{') || text.startsWith('[');
}

// First non-empty scalar arg among `keys`, cleaned for display. Skips objects/arrays (raw JSON).
function firstArgValue(args = {}, keys = []) {
  const source = args && typeof args === 'object' ? args : {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 120);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  return '';
}

const TOOL_DETAIL_KEYS = {
  inventory_lookup: ['query'],
  chemical_lookup: ['query', 'cas', 'supplier'],
  notebook_lookup: ['query', 'entry_id', 'protocol_name', 'project_name', 'action'],
  protocol_lookup: ['query', 'project_name'],
  notebook_draft: ['protocol_name', 'protocolName', 'project_name', 'project', 'message'],
  notebook_append: ['section_title', 'page_title', 'notebook_entry_id'],
  protocol_edit: ['target_title', 'target_id'],
  notebook_generation: ['selected_protocol', 'project'],
  literature_search: ['query', 'topic', 'message'],
  paper_download: ['paper_title', 'doi'],
  paper_analysis: ['paper_title', 'message'],
  paper_intake_search_summaries: ['query'],
  paper_intake_search_experiments: ['query', 'technique'],
  paper_intake_list_project_summaries: ['project_name'],
  purchase_recommendation: ['query', 'message'],
  memory: ['query', 'key', 'project_name'],
  container: ['name', 'id'],
  assay_table: ['name', 'table_id', 'id'],
  html_output: ['title'],
  image_output: ['title', 'path'],
  plotly_graph: ['name', 'graph_id', 'id'],
  ask_user: ['question']
};

function summarizeCodexToolCallForProgress({
  toolName = '',
  status = '',
  argumentValue = null,
  outputText = '',
  directText = ''
} = {}) {
  const name = stripMcpServerPrefix(toolName) || 'codex-tool';
  const args = parseCodexToolArguments(argumentValue);
  const completed = status === 'completed';
  if (name === 'exec_command') {
    return summarizeExecCommandForCodexProgress(args, status);
  }
  if (name === 'exec' || name === 'functions.exec') {
    const activity = formatHikariExecActivity(args.code ?? args.input ?? argumentValue);
    if (activity) return activity;
  }
  if (name === 'codex-tool') {
    return completed ? 'Tool call completed.' : 'Running tool...';
  }
  // Only surface plain-text results/detail; never dump the raw JSON args or output shape.
  const result = looksLikeJsonBlob(outputText) ? '' : cleanText(outputText, 2000);
  const activity = formatHikariToolActivity(name, args);
  if (activity) {
    const value = firstArgValue(args, TOOL_DETAIL_KEYS[name]);
    const context = value ? ` (“${value}”)` : '';
    if (status === 'failed') return `Couldn’t finish ${activity[0].toLowerCase()}${activity.slice(1)}${context}.`;
    return `${activity}${context}…${completed && result ? ` ${result}` : ''}`;
  }
  const detail = looksLikeJsonBlob(directText) ? '' : cleanText(directText, 2000);
  if (completed && result) {
    return cleanText(`${name} — ${result}`, 2400);
  }
  if (detail) {
    return cleanText(`${name}: ${detail}`, 2400);
  }
  return completed ? `${name} completed.` : `${name} started.`;
}

function completeCodexProgressText(value = '', toolName = '') {
  const text = cleanText(value, 2400);
  if (/^Reading\s+(.+)\.\.\.$/u.test(text)) {
    return text.replace(/^Reading\s+(.+)\.\.\.$/u, 'Read $1.');
  }
  if (/^Searching\s+(.+)\.\.\.$/u.test(text)) {
    return text.replace(/^Searching\s+(.+)\.\.\.$/u, 'Search completed in $1.');
  }
  if (/^Listing\s+(.+)\.\.\.$/u.test(text)) {
    return text.replace(/^Listing\s+(.+)\.\.\.$/u, 'Listed $1.');
  }
  if (/^Running\s+(.+)\.\.\.$/u.test(text)) {
    return text.replace(/^Running\s+(.+)\.\.\.$/u, 'Completed $1.');
  }
  if (text) {
    return /[.…]$/u.test(text) ? text : `${text}.`;
  }
  const name = cleanText(toolName, 160);
  return name ? `${name} completed.` : 'Tool call completed.';
}

module.exports = {
  completeCodexProgressText,
  summarizeCodexToolCallForProgress
};

// ponytail: one self-check — the whole point is that MCP calls never render raw JSON.
if (require.main === module) {
  const assert = require('node:assert');
  const started = summarizeCodexToolCallForProgress({
    toolName: 'inventory_lookup',
    status: 'started',
    argumentValue: { query: 'SUMO1', limit: 5 }
  });
  assert.equal(started, 'Searching for samples (“SUMO1”)…', started);
  assert.ok(!/[{}[\]"]/u.test(started), 'no JSON punctuation in started summary');
  const completed = summarizeCodexToolCallForProgress({
    toolName: 'inventory_lookup',
    status: 'completed',
    argumentValue: { query: 'SUMO1' },
    outputText: 'Found 2 matching records.'
  });
  assert.match(completed, /Found 2/, completed);
  const jsonOutput = summarizeCodexToolCallForProgress({
    toolName: 'assay_table',
    status: 'completed',
    argumentValue: { action: 'get', id: 'a1' },
    outputText: '{"rows":[{"a":1}]}'
  });
  assert.equal(jsonOutput, 'Working with assay data (“a1”)…', jsonOutput);
  assert.ok(!jsonOutput.includes('{'), 'raw JSON output must be dropped');
  console.log('event-tool-summary self-check ok');
}
