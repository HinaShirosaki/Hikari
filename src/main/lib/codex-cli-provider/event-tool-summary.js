'use strict';

const path = require('node:path');
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

function summarizeCodexToolCallForProgress({
  toolName = '',
  status = '',
  argumentValue = null,
  outputText = '',
  directText = ''
} = {}) {
  const name = cleanText(toolName, 160) || 'codex-tool';
  const args = parseCodexToolArguments(argumentValue);
  const completed = status === 'completed';
  if (name === 'exec_command') {
    return summarizeExecCommandForCodexProgress(args, status);
  }
  if (name === 'codex-tool') {
    return completed ? 'Tool call completed.' : 'Running tool...';
  }
  if (completed && outputText) {
    return cleanText(`${name}: ${outputText}`, 2400);
  }
  if (directText) {
    return cleanText(`${name}: ${directText}`, 2400);
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
    return text.endsWith('.') ? text : `${text}.`;
  }
  const name = cleanText(toolName, 160);
  return name ? `${name} completed.` : 'Tool call completed.';
}

module.exports = {
  completeCodexProgressText,
  summarizeCodexToolCallForProgress
};
