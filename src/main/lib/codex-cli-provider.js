const { spawn } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAgentRequestAbortError,
  getAgentRequestAbortSignal,
  isAgentRequestAbortError,
  onAgentRequestAbort,
  throwIfAgentRequestAborted
} = require('../helpers/agent/shared/agent-request-context.js');
const {
  buildHikariCodexAgentsInstructions,
  buildEnanaCodexAgentsInstructions
} = require('../helpers/agent/codex-agent/agent-instructions.js');
const {
  ensureHikariCodexAgentsFile,
  ensureHikariCodexMcpConfig
} = require('../helpers/agent/codex-agent/runtime-files.js');

const DEFAULT_TIMEOUT_MS = 180000;
const LOGIN_STATUS_TIMEOUT_MS = 12000;
const LOGIN_STATUS_CACHE_TTL_MS = 30000;
const CODEX_LOGIN_LAUNCH_GRACE_MS = 1500;
const OPENAI_CODEX_LOGIN_URL = 'https://chatgpt.com/auth/login';
const CODEX_TMP_DIR_NAME = 'codex-cli';
const CODEX_MODELS_CACHE_FILE = 'models_cache.json';
const CODEX_CONFIG_FILE = 'config.toml';
const CODEX_RUNTIME_HOME_DIR_NAME = 'codex-cli-home';
const CODEX_RUNTIME_HOME_FILES = Object.freeze([
  'auth.json',
  CODEX_CONFIG_FILE,
  CODEX_MODELS_CACHE_FILE,
  'installation_id',
  'version.json',
  '.codex-global-state.json'
]);
const CODEX_RUNTIME_HOME_DIRS = Object.freeze([
  '.tmp',
  'cache',
  'log',
  'plugins',
  'rules',
  'skills',
  'tmp'
]);

let loginStatusCache = null;
let configuredCodexModel = '';
let configuredCodexReasoningEffort = '';
let activeCodexLogin = null;

function invalidateCodexLoginStatusCache() {
  loginStatusCache = null;
}

function cleanText(value, _maxLength = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function extractCodexLoginUrl(text = '') {
  const match = String(text || '').match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/i);
  return cleanText(match?.[0] || '', 8000);
}

function looksLikePath(value) {
  const text = String(value || '');
  if (!text) {
    return false;
  }
  return text.includes('/') || text.includes('\\') || text.startsWith('.') || path.isAbsolute(text);
}

function isRunnableFile(candidatePath) {
  const target = String(candidatePath || '').trim();
  if (!target) {
    return false;
  }
  try {
    const stat = fsSync.statSync(target);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function splitPathEntries(pathValue) {
  return String(pathValue || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPathCommandCandidates(commandName) {
  const command = String(commandName || '').trim();
  if (!command) {
    return [];
  }

  const pathEntries = splitPathEntries(process.env.PATH);
  const extCandidates = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat', '.com']
    : [''];
  const items = [];
  pathEntries.forEach((entry) => {
    extCandidates.forEach((ext) => {
      items.push(path.join(entry, `${command}${ext}`));
    });
  });
  return items;
}

function resolveCodexBinary() {
  const explicit = String(
    process.env.HIKARI_CODEX_CLI
      || process.env.HIKARI_CODEX_BIN
      || process.env.ENANA_CODEX_CLI
      || process.env.ENANA_CODEX_BIN
      || ''
  ).trim();
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
    if (!looksLikePath(explicit)) {
      candidates.push(...buildPathCommandCandidates(explicit));
    }
  }

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Codex.app/Contents/Resources/codex',
      path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex'
    );
  } else if (process.platform === 'linux') {
    candidates.push('/usr/local/bin/codex', '/usr/bin/codex');
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'codex'));
  }
  if (process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), 'codex'));
  }

  candidates.push(...buildPathCommandCandidates('codex'));

  const seen = new Set();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (looksLikePath(value) && isRunnableFile(value)) {
      return value;
    }
  }

  return explicit || 'codex';
}

function pickExistingDirectory(candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || isFilesystemRoot(value)) {
      continue;
    }
    try {
      if (fsSync.statSync(value).isDirectory()) {
        return value;
      }
    } catch {
      // Keep scanning fallbacks.
    }
  }
  return '';
}

function isFilesystemRoot(candidatePath = '') {
  const value = String(candidatePath || '').trim();
  if (!value) {
    return false;
  }
  try {
    const resolved = path.resolve(value);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
}

function resolveWorkingDirectory(cwd = '') {
  const resolved = pickExistingDirectory([
    cwd,
    process.env.HIKARI_CODEX_WORKSPACE,
    process.env.HIKARI_APP_DATA_ROOT,
    process.env.ENANA_CODEX_WORKSPACE,
    process.env.ENANA_APP_DATA_ROOT,
    process.cwd(),
    os.homedir(),
    path.dirname(process.execPath)
  ]);
  return resolved || os.homedir() || process.cwd();
}

function sanitizeFileName(fileName, fallback = 'paper.pdf') {
  const raw = String(fileName || '').trim().replace(/[/\\]+/g, '_');
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  const normalized = safe || fallback;
  if (/\.pdf$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}.pdf`;
}

function sanitizeAttachmentFileName(fileName, fallback = 'attachment.bin') {
  const raw = String(fileName || '').trim().replace(/[/\\]+/g, '_');
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function parseBase64DataUrl(dataUrl = '') {
  const match = String(dataUrl || '').trim().match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[2]) {
    return null;
  }
  return {
    mimeType: cleanText(match[1], 120),
    buffer: Buffer.from(match[2], 'base64')
  };
}

function isMissingBinaryError(error) {
  if (!error) {
    return false;
  }
  if (error.code === 'ENOENT') {
    return true;
  }
  return /not found|enoent/i.test(String(error.message || ''));
}

function normalizeCodexCliModel(model = '') {
  return String(cleanText(model, 120) || '').trim();
}

function normalizeCodexCliReasoningEffort(reasoningEffort = '') {
  return String(cleanText(reasoningEffort, 40) || '').trim().toLowerCase();
}

function getNativeCodexCliHomeDirectory() {
  const configuredHome = String(process.env.CODEX_HOME || '').trim();
  if (configuredHome) {
    return configuredHome;
  }
  return path.join(os.homedir(), '.codex');
}

function getCodexCliHomeDirectory() {
  const appManagedHome = String(process.env.HIKARI_CODEX_HOME || process.env.ENANA_CODEX_HOME || '').trim();
  if (appManagedHome) {
    return appManagedHome;
  }
  return getNativeCodexCliHomeDirectory();
}

function getCodexCliCandidateHomeDirectories() {
  return [...new Set([
    getCodexCliHomeDirectory(),
    getNativeCodexCliHomeDirectory()
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function getCodexCliAuthFilePath() {
  return path.join(getCodexCliHomeDirectory(), 'auth.json');
}

function safeParseJson(rawValue = '', fallback = null) {
  try {
    return JSON.parse(String(rawValue || ''));
  } catch {
    return fallback;
  }
}

function collectTextFromCodexEventValue(value, maxLength = 4000) {
  if (typeof value === 'string') {
    return cleanText(value, maxLength);
  }
  if (Array.isArray(value)) {
    return cleanText(value.map((item) => collectTextFromCodexEventValue(item, maxLength)).filter(Boolean).join(''), maxLength);
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const directText = value.text
    || value.output_text
    || value.outputText
    || value.summary_text
    || value.summaryText
    || value.content
    || value.message
    || value.delta;
  if (typeof directText === 'string' && directText) {
    return cleanText(directText, maxLength);
  }
  if (Array.isArray(value.content) || Array.isArray(value.parts) || Array.isArray(value.summary)) {
    return cleanText([
      collectTextFromCodexEventValue(value.content, maxLength),
      collectTextFromCodexEventValue(value.parts, maxLength),
      collectTextFromCodexEventValue(value.summary, maxLength)
    ].filter(Boolean).join(''), maxLength);
  }
  const wrappedText = collectTextFromCodexEventValue(
    value.Ok
      || value.ok
      || value.Err
      || value.err
      || value.error
      || value.data
      || value.result,
    maxLength
  );
  if (wrappedText) {
    return wrappedText;
  }
  return '';
}

function stringifyCodexEventValue(value, maxLength = 2000) {
  if (typeof value === 'string') {
    return cleanText(value, maxLength);
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return cleanText(JSON.stringify(value), maxLength);
  } catch {
    return cleanText(String(value || ''), maxLength);
  }
}

function looksLikeJsonLine(value = '') {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

function parseCodexToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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

function buildCodexCliDisplayEvent({
  text = '',
  kind = '',
  eventType = '',
  status = '',
  toolName = '',
  stream = ''
} = {}) {
  const displayText = cleanText(text, 12000);
  if (!displayText) {
    return null;
  }
  return {
    type: 'codex_cli_display',
    event_type: cleanText(eventType, 160),
    display_kind: cleanText(kind, 80) || 'message',
    display_stream: cleanText(stream, 40),
    status: cleanText(status, 40),
    tool_name: cleanText(toolName, 160),
    display_text: displayText
  };
}

function buildCodexCliDisplayEventKey(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return '';
  }
  return [
    cleanText(event.type, 80),
    cleanText(event.event_type || event.eventType, 160),
    cleanText(event.display_kind || event.displayKind, 80),
    cleanText(event.display_stream || event.displayStream, 40),
    cleanText(event.status, 40),
    cleanText(event.tool_name || event.toolName, 160),
    cleanText(event.display_text || event.displayText || event.text, 12000)
  ].join('\u0001');
}

function emitCodexCliDisplayEvent(onStream, seenDisplayEvents, event = {}) {
  if (typeof onStream !== 'function') {
    return;
  }
  const displayEvent = event?.type === 'codex_cli_display'
    ? event
    : buildCodexCliDisplayEvent(event);
  if (!displayEvent) {
    return;
  }
  const displayKey = buildCodexCliDisplayEventKey(displayEvent);
  if (displayKey && seenDisplayEvents?.has(displayKey)) {
    return;
  }
  if (displayKey && seenDisplayEvents && typeof seenDisplayEvents.add === 'function') {
    seenDisplayEvents.add(displayKey);
  }
  try {
    onStream(displayEvent);
  } catch {
    // Keep display streaming best-effort; the final Codex response still resolves below.
  }
}

function extractCodexPlainOutputDisplayEvent(event = {}) {
  const source = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
  const type = cleanText(source.type, 120).toLowerCase();
  if (type !== 'codex_cli_output') {
    return null;
  }
  return buildCodexCliDisplayEvent({
    text: source.text,
    kind: source.stream === 'stderr' ? 'stderr' : 'stdout',
    eventType: type,
    stream: source.stream
  });
}

function buildCodexDisplayEventFromProgress(progressEvent = {}) {
  if (!progressEvent || typeof progressEvent !== 'object' || Array.isArray(progressEvent)) {
    return null;
  }
  const eventType = cleanText(progressEvent.event_type || progressEvent.eventType, 160);
  const progressType = cleanText(progressEvent.type, 80);
  if (progressType === 'codex_thinking') {
    return buildCodexCliDisplayEvent({
      text: progressEvent.thinking_text || progressEvent.thinkingText,
      kind: 'thinking',
      eventType
    });
  }
  if (progressType === 'codex_tool_call') {
    return buildCodexCliDisplayEvent({
      text: progressEvent.tool_call_text || progressEvent.toolCallText,
      kind: 'tool',
      eventType,
      status: progressEvent.status,
      toolName: progressEvent.tool_name || progressEvent.toolName
    });
  }
  return null;
}

function clampCodexSummaryText(value = '', maxLength = 2000) {
  const text = cleanText(value, maxLength);
  const limit = Math.max(120, Number(maxLength) || 2000);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3)}...`;
}

function pickCodexEventCredits(source = {}) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  return source.rate_limits?.credits
    || source.rateLimits?.credits
    || source.credits
    || null;
}

function isCodexWarningLine(line = '') {
  return /\bWARN\b/u.test(line)
    && /codex_core_(plugins|skills)::/u.test(line);
}

function summarizeCodexRawFailureOutput(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningfulLines = lines.filter((line) => !isCodexWarningLine(line));
  const selectedLines = meaningfulLines.length ? meaningfulLines : lines;
  return clampCodexSummaryText(selectedLines.join('\n') || '', 2000);
}

function summarizeCodexCommandFailure({ stdout = '', stderr = '' } = {}) {
  let reportedNoCredits = false;
  let completedWithoutAgentMessage = false;
  let jsonErrorText = '';

  String(stdout || '').split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const parsed = safeParseJson(trimmed, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }
    const { source, type } = getCodexJsonEventDescriptor(parsed);
    const credits = pickCodexEventCredits(source);
    if (credits && credits.has_credits === false && credits.unlimited !== true) {
      reportedNoCredits = true;
    }
    if (type === 'task_complete' && source.last_agent_message === null) {
      completedWithoutAgentMessage = true;
    }
    if (/error|failed|failure/u.test(type)) {
      const eventText = collectTextFromCodexEventValue(
        source.error
          || source.message
          || source.reason
          || source.status
          || source.data,
        2000
      );
      if (eventText && !jsonErrorText) {
        jsonErrorText = eventText;
      }
    }
  });

  if (reportedNoCredits) {
    return 'Codex CLI failed before producing an answer. The active Codex account reported no available credits.';
  }
  if (jsonErrorText) {
    return clampCodexSummaryText(jsonErrorText, 2000);
  }
  if (completedWithoutAgentMessage) {
    return 'Codex CLI finished without producing an assistant message.';
  }

  return summarizeCodexRawFailureOutput(stderr)
    || summarizeCodexRawFailureOutput(stdout)
    || 'Unknown error';
}

function isCodexEventObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getCodexJsonEventSource(event = {}) {
  const source = isCodexEventObject(event) ? event : {};
  const outerType = cleanText(source.type || source.event || source.kind, 120).toLowerCase();
  const payload = isCodexEventObject(source.payload) ? source.payload : null;
  if ((outerType === 'event_msg' || outerType === 'response_item') && payload) {
    return {
      outerType,
      source: payload,
      envelope: source
    };
  }
  return {
    outerType: '',
    source,
    envelope: source
  };
}

function getCodexJsonEventDescriptor(source = {}) {
  const normalized = getCodexJsonEventSource(source);
  const eventSource = normalized.source;
  const envelope = normalized.envelope;
  const item = isCodexEventObject(eventSource.item)
    ? eventSource.item
    : {};
  const invocation = isCodexEventObject(eventSource.invocation)
    ? eventSource.invocation
    : {};
  const message = isCodexEventObject(eventSource.message)
    ? eventSource.message
    : {};
  const call = isCodexEventObject(eventSource.call)
    ? eventSource.call
    : {};
  const response = isCodexEventObject(eventSource.response)
    ? eventSource.response
    : {};
  const type = cleanText(eventSource.type || eventSource.event || eventSource.kind, 120).toLowerCase();
  const itemType = cleanText(item.type || eventSource.item_type || eventSource.itemType || message.type || call.type || response.type, 120).toLowerCase();
  const name = cleanText(
    eventSource.name
      || eventSource.tool_name
      || eventSource.toolName
      || invocation.tool
      || invocation.name
      || item.name
      || item.tool_name
      || call.name,
    160
  ).toLowerCase();
  const phase = cleanText(eventSource.phase || envelope.phase || item.phase || message.phase, 80).toLowerCase();
  const outerType = cleanText(normalized.outerType, 120).toLowerCase();
  const combined = [type, itemType, name, phase, outerType].filter(Boolean).join(' ');
  return { source: eventSource, envelope, outerType, item, invocation, message, call, response, type, itemType, name, phase, combined };
}

function isCodexThinkingEvent(source = {}) {
  const { type, phase, combined } = getCodexJsonEventDescriptor(source);
  if (type === 'agent_message' && phase && phase !== 'final_answer') {
    return true;
  }
  return /reasoning|thinking|thought/u.test(combined);
}

function isCodexToolEvent(source = {}) {
  const { combined } = getCodexJsonEventDescriptor(source);
  return /tool|function_call|function-call|mcp|exec|command|shell|local_shell/u.test(combined);
}

function extractCodexJsonEventText(event = {}) {
  const descriptor = getCodexJsonEventDescriptor(event);
  const source = descriptor.source;
  const { item, message, type, phase, outerType } = descriptor;
  const eventType = phase ? `${type}:${phase}` : type;
  if (type === 'codex_cli_output') {
    return null;
  }
  const role = cleanText(source.role || message.role || item.role, 80).toLowerCase();
  if (type === 'user_message' || type === 'input_message' || type === 'user' || role === 'user') {
    return null;
  }
  if (isCodexThinkingEvent(event) || isCodexToolEvent(event)) {
    return null;
  }
  if (type === 'agent_message' && phase && phase !== 'final_answer') {
    return null;
  }
  const looksAssistant = !role || role === 'assistant' || role === 'agent';
  if (!looksAssistant) {
    return null;
  }

  const directDelta = source.delta
    || source.text_delta
    || source.textDelta
    || source.output_text_delta
    || source.outputTextDelta
    || source.message_delta
    || source.messageDelta
    || source.token;
  if (typeof directDelta === 'string' && directDelta) {
    return {
      deltaText: directDelta,
      fullText: '',
      eventType
    };
  }

  const deltaText = collectTextFromCodexEventValue(source.delta?.content || source.delta?.parts, 120000);
  if (deltaText) {
    return {
      deltaText,
      fullText: '',
      eventType
    };
  }

  const fullText = collectTextFromCodexEventValue(
    source.text
      || source.output_text
      || source.outputText
      || message.content
      || message.text
      || source.message
      || item.content
      || item.text
      || source.content
      || source.output,
    120000
  );
  if (fullText && (/message|assistant|agent|output|response/.test(type) || role || phase === 'final_answer' || outerType === 'response_item')) {
    return {
      deltaText: '',
      fullText,
      eventType
    };
  }
  return null;
}

function extractCodexJsonEventThinking(event = {}) {
  if (!isCodexThinkingEvent(event)) {
    return null;
  }
  const { source, item, type, phase } = getCodexJsonEventDescriptor(event);
  const text = collectTextFromCodexEventValue(
    source.delta
      || source.text_delta
      || source.textDelta
      || source.summary_delta
      || source.summaryDelta
      || source.thinking_delta
      || source.thinkingDelta
      || source.reasoning_delta
      || source.reasoningDelta
      || source.text
      || source.summary
      || source.thinking
      || source.reasoning
      || source.message
      || item.summary
      || item.content
      || item.text,
    4000
  );
  if (!text) {
    return null;
  }
  return {
    type: 'codex_thinking',
    event_type: phase ? `${type}:${phase}` : type,
    thinking_text: text
  };
}

function inferCodexToolStatus(type = '') {
  const text = cleanText(type, 160).toLowerCase();
  if (/fail|error|errored|rejected/u.test(text)) {
    return 'failed';
  }
  if (/function_call_output|tool_result|tool_result_end|mcp_tool_call_end|call_output/u.test(text)) {
    return 'completed';
  }
  if (/complete|completed|done|end|ended|finish|finished|success|succeeded/u.test(text)) {
    return 'completed';
  }
  if (/delta|output|stdout|stderr|stream/u.test(text)) {
    return 'streaming';
  }
  return 'started';
}

function extractCodexJsonEventToolCall(event = {}) {
  if (!isCodexToolEvent(event)) {
    return null;
  }
  const { source, item, invocation, call, type, name } = getCodexJsonEventDescriptor(event);
  const toolName = cleanText(
    source.tool_name
      || source.toolName
      || source.name
      || invocation.tool
      || invocation.name
      || item.name
      || item.tool_name
      || item.toolName
      || call.name
      || name,
    160
  ) || 'codex-tool';
  const argumentValue = source.arguments
    || source.args
    || source.input
    || source.command
    || source.arguments_delta
    || source.argumentsDelta
    || source.delta
    || invocation.arguments
    || invocation.args
    || invocation.input
    || item.arguments
    || item.args
    || item.input
    || item.command
    || call.arguments
    || call.args
    || call.input;
  const argsText = stringifyCodexEventValue(
    argumentValue,
    2000
  );
  const outputValue = source.output
    || source.result
    || source.stdout
    || source.stderr
    || invocation.output
    || invocation.result
    || item.output
    || item.result
    || call.output
    || call.result;
  const outputText = collectTextFromCodexEventValue(outputValue, 12000)
    || stringifyCodexEventValue(outputValue, 12000);
  const directText = collectTextFromCodexEventValue(
    source.text
      || source.message
      || source.summary
      || item.text
      || item.summary
      || item.content,
    2000
  );
  const status = inferCodexToolStatus(type);
  const detailText = directText
    || ((status === 'completed' || status === 'streaming') && outputText ? outputText : '')
    || argsText
    || outputText;
  const toolCallText = summarizeCodexToolCallForProgress({
    toolName,
    status,
    argumentValue,
    outputText,
    directText: detailText
  });
  return {
    type: 'codex_tool_call',
    event_type: type,
    status,
    tool_name: toolName,
    call_id: cleanText(source.call_id || source.callId || item.call_id || item.callId || call.call_id || call.callId, 160),
    tool_call_text: toolCallText,
    tool_output_text: outputText
  };
}

function extractCodexJsonEventProgress(event = {}) {
  return [
    extractCodexJsonEventThinking(event),
    extractCodexJsonEventToolCall(event)
  ].filter(Boolean);
}

function buildCodexProgressEventKey(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return '';
  }
  return [
    cleanText(event.type, 80),
    cleanText(event.event_type || event.eventType, 160),
    cleanText(event.status, 80),
    cleanText(event.tool_name || event.toolName, 160),
    cleanText(event.tool_call_text || event.toolCallText || event.thinking_text || event.thinkingText, 4000)
  ].join('\u0001');
}

async function findCodexSessionTranscriptPath(sessionId = '', cwd = '') {
  const cleanSessionId = normalizeCodexSessionId(sessionId);
  if (!cleanSessionId) {
    return '';
  }
  const roots = [...new Set([
    resolveCodexCliRuntimeHomeDirectory(cwd),
    ...getCodexCliCandidateHomeDirectories()
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  const queue = roots.map((root) => path.join(root, 'sessions'));
  let visited = 0;
  while (queue.length && visited < 4000) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(cleanSessionId)) {
        return entryPath;
      }
    }
  }
  return '';
}

async function replayCodexSessionProgressFromTranscript({
  sessionId = '',
  cwd = '',
  onStream = null,
  seenProgressEvents = new Set(),
  seenDisplayEvents = new Set()
} = {}) {
  if (!sessionId || typeof onStream !== 'function') {
    return '';
  }
  const transcriptPath = await findCodexSessionTranscriptPath(sessionId, cwd);
  if (!transcriptPath) {
    return '';
  }
  let raw = '';
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  raw.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const parsed = safeParseJson(trimmed, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }
    const extracted = extractCodexJsonEventText(parsed);
    if (extracted) {
      emitCodexCliDisplayEvent(onStream, seenDisplayEvents, {
        text: extracted.deltaText || extracted.fullText,
        kind: 'assistant',
        eventType: extracted.eventType
      });
    }
    extractCodexJsonEventProgress(parsed).forEach((progressEvent) => {
      const key = buildCodexProgressEventKey(progressEvent);
      if (key && seenProgressEvents.has(key)) {
        return;
      }
      if (key) {
        seenProgressEvents.add(key);
      }
      try {
        onStream(progressEvent);
      } catch {
        // Transcript replay is best-effort; the final Codex response still resolves below.
      }
      emitCodexCliDisplayEvent(
        onStream,
        seenDisplayEvents,
        buildCodexDisplayEventFromProgress(progressEvent)
      );
    });
  });
  return transcriptPath;
}

function normalizeCodexSessionId(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.slice(0, 240);
}

function extractCodexJsonEventSessionId(event = {}) {
  const { source, envelope } = getCodexJsonEventDescriptor(event);
  const type = cleanText(source.type || source.event || source.kind || envelope.type || envelope.event || envelope.kind, 120).toLowerCase();
  const candidates = [
    source.session_id,
    source.sessionId,
    source.conversation_id,
    source.conversationId,
    source.thread_id,
    source.threadId,
    source.session?.id,
    source.session?.session_id,
    source.session?.sessionId,
    source.conversation?.id,
    source.thread?.id,
    source.item?.session_id,
    source.item?.sessionId,
    source.item?.conversation_id,
    source.item?.conversationId,
    source.message?.session_id,
    source.message?.sessionId,
    source.message?.conversation_id,
    source.message?.conversationId,
    source.response?.session_id,
    source.response?.sessionId,
    source.metadata?.session_id,
    source.metadata?.sessionId,
    source.metadata?.conversation_id,
    source.metadata?.conversationId,
    source.payload?.id,
    source.payload?.session_id,
    source.payload?.sessionId,
    source.payload?.conversation_id,
    source.payload?.conversationId,
    envelope.session_id,
    envelope.sessionId,
    envelope.conversation_id,
    envelope.conversationId,
    envelope.thread_id,
    envelope.threadId,
    envelope.session?.id,
    envelope.session?.session_id,
    envelope.session?.sessionId,
    envelope.conversation?.id,
    envelope.thread?.id,
    envelope.metadata?.session_id,
    envelope.metadata?.sessionId,
    envelope.metadata?.conversation_id,
    envelope.metadata?.conversationId,
    envelope.payload?.id,
    envelope.payload?.session_id,
    envelope.payload?.sessionId,
    envelope.payload?.conversation_id,
    envelope.payload?.conversationId
  ];
  if (/session|conversation|thread/.test(type)) {
    candidates.push(source.id);
    candidates.push(envelope.id);
  }
  for (const candidate of candidates) {
    const sessionId = normalizeCodexSessionId(candidate);
    if (sessionId) {
      return sessionId;
    }
  }
  return '';
}

function extractCodexSessionIdFromText(text = '') {
  const source = String(text || '');
  if (!source) {
    return '';
  }
  const jsonStyle = source.match(/"(?:session_id|sessionId|conversation_id|conversationId|thread_id|threadId)"\s*:\s*"([^"]+)"/);
  if (jsonStyle?.[1]) {
    return normalizeCodexSessionId(jsonStyle[1]);
  }
  const labelStyle = source.match(/\b(?:session_id|sessionId|conversation_id|conversationId|thread_id|threadId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/);
  return normalizeCodexSessionId(labelStyle?.[1] || '');
}

function readCodexCliAuthFile() {
  const candidates = getCodexCliCandidateHomeDirectories();
  for (const homeDirectory of candidates) {
    try {
      const authPath = path.join(homeDirectory, 'auth.json');
      const parsed = safeParseJson(fsSync.readFileSync(authPath, 'utf8'), null);
      if (parsed && typeof parsed === 'object') {
        return {
          authFile: parsed,
          sourcePath: authPath
        };
      }
    } catch {
      // Continue to the next home candidate.
    }
  }
  return null;
}

function decodeJwtPayload(token = '') {
  const cleanToken = String(token || '').trim();
  const parts = cleanToken.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    return safeParseJson(Buffer.from(padded, 'base64').toString('utf8'), null);
  } catch {
    return null;
  }
}

function resolveCodexCliAccessTokenExpiry(accessToken = '') {
  const payload = decodeJwtPayload(accessToken);
  const expSeconds = Number(payload?.exp);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
    return 0;
  }
  return expSeconds * 1000;
}

function isCodexCliAccessTokenExpired(accessToken = '') {
  const expiresAt = resolveCodexCliAccessTokenExpiry(accessToken);
  return Boolean(expiresAt && Date.now() >= expiresAt);
}

function readCodexCliOAuthProfile() {
  const authFileState = readCodexCliAuthFile();
  const authFile = authFileState?.authFile;
  const authMode = cleanText(authFile?.auth_mode, 40).toLowerCase();
  const accessToken = cleanText(authFile?.tokens?.access_token, 20000);
  const refreshToken = cleanText(authFile?.tokens?.refresh_token, 20000);
  const accountId = cleanText(authFile?.tokens?.account_id, 400);
  const expiresAt = resolveCodexCliAccessTokenExpiry(accessToken);
  return {
    authMode,
    accessToken,
    refreshToken,
    accountId,
    expiresAt,
    expired: Boolean(expiresAt && Date.now() >= expiresAt),
    sourcePath: cleanText(authFileState?.sourcePath, 2400) || getCodexCliAuthFilePath()
  };
}

function resolveCodexCliRuntimeHomeDirectory(cwd = '') {
  const explicit = String(process.env.HIKARI_CODEX_HOME || process.env.ENANA_CODEX_HOME || '').trim();
  if (explicit) {
    return explicit;
  }
  const safeCwd = resolveWorkingDirectory(cwd);
  return path.join(safeCwd, 'Config', CODEX_RUNTIME_HOME_DIR_NAME);
}

async function pathExists(targetPath = '') {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeFileIfExists(targetPath = '') {
  if (!targetPath) {
    return false;
  }
  const existed = await pathExists(targetPath);
  if (!existed) {
    return false;
  }
  await fs.rm(targetPath, { force: true });
  return true;
}

async function ensureCodexCliAgentsFile(cwd = '') {
  return ensureHikariCodexAgentsFile(resolveWorkingDirectory(cwd));
}

async function copyFileIfChanged(sourcePath = '', targetPath = '') {
  if (!sourcePath || !targetPath) {
    return false;
  }
  try {
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isFile()) {
      return false;
    }
    let shouldCopy = true;
    try {
      const targetStats = await fs.stat(targetPath);
      shouldCopy = !targetStats.isFile()
        || targetStats.size !== sourceStats.size
        || Math.abs(targetStats.mtimeMs - sourceStats.mtimeMs) > 1;
    } catch {
      shouldCopy = true;
    }
    if (!shouldCopy) {
      return false;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getPathStats(targetPath = '', { followSymlink = false } = {}) {
  try {
    return followSymlink ? await fs.stat(targetPath) : await fs.lstat(targetPath);
  } catch {
    return null;
  }
}

async function isDirectoryLike(targetPath = '') {
  const stats = await getPathStats(targetPath);
  if (!stats) {
    return false;
  }
  if (stats.isDirectory()) {
    return true;
  }
  if (!stats.isSymbolicLink()) {
    return false;
  }
  const resolvedStats = await getPathStats(targetPath, { followSymlink: true });
  return Boolean(resolvedStats?.isDirectory());
}

async function copyPathIfMissing(sourcePath = '', targetPath = '') {
  const sourceStats = await getPathStats(sourcePath, { followSymlink: true });
  if (!sourceStats) {
    return false;
  }
  if (await getPathStats(targetPath)) {
    return false;
  }
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const symlinkType = sourceStats.isDirectory()
      ? (process.platform === 'win32' ? 'junction' : 'dir')
      : 'file';
    await fs.symlink(sourcePath, targetPath, symlinkType);
    return true;
  } catch {
    try {
      if (sourceStats.isDirectory()) {
        await fs.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: false });
      } else if (sourceStats.isFile()) {
        await copyFileIfChanged(sourcePath, targetPath);
      }
      return true;
    } catch {
      return false;
    }
  }
}

async function syncCodexCliRuntimePluginCacheEntry(sourcePath = '', targetPath = '', depth = 0) {
  const sourceStats = await getPathStats(sourcePath, { followSymlink: true });
  if (!sourceStats) {
    return false;
  }
  const targetStats = await getPathStats(targetPath);
  if (!targetStats) {
    return copyPathIfMissing(sourcePath, targetPath);
  }
  if (!sourceStats.isDirectory() || !(await isDirectoryLike(targetPath)) || depth >= 2) {
    return false;
  }
  let entries = [];
  try {
    entries = await fs.readdir(sourcePath, { withFileTypes: true });
  } catch {
    return false;
  }
  const results = await Promise.all(entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => syncCodexCliRuntimePluginCacheEntry(
      path.join(sourcePath, entry.name),
      path.join(targetPath, entry.name),
      depth + 1
    )));
  return results.some(Boolean);
}

async function syncCodexCliRuntimePluginCache(sourceHome = '', runtimeHome = '') {
  const sourceCacheRoot = path.join(sourceHome, 'plugins', 'cache');
  const targetCacheRoot = path.join(runtimeHome, 'plugins', 'cache');
  if (path.resolve(sourceCacheRoot) === path.resolve(targetCacheRoot)) {
    return false;
  }
  if (!(await isDirectoryLike(sourceCacheRoot))) {
    return false;
  }
  await fs.mkdir(targetCacheRoot, { recursive: true });
  let marketplaces = [];
  try {
    marketplaces = await fs.readdir(sourceCacheRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  const results = await Promise.all(marketplaces
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => syncCodexCliRuntimePluginCacheEntry(
      path.join(sourceCacheRoot, entry.name),
      path.join(targetCacheRoot, entry.name)
    )));
  return results.some(Boolean);
}

async function ensureCodexCliRuntimeHome(cwd = '') {
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(cwd);
  if (!runtimeHome) {
    return '';
  }
  await fs.mkdir(runtimeHome, { recursive: true });
  await Promise.all(CODEX_RUNTIME_HOME_DIRS.map((dirName) => (
    fs.mkdir(path.join(runtimeHome, dirName), { recursive: true }).catch(() => {})
  )));

  const sourceHome = getNativeCodexCliHomeDirectory();
  if (!sourceHome) {
    await ensureHikariCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
      workspace: resolveWorkingDirectory(cwd)
    });
    return runtimeHome;
  }
  const resolvedSource = path.resolve(sourceHome);
  const resolvedTarget = path.resolve(runtimeHome);
  if (resolvedSource === resolvedTarget || !(await pathExists(resolvedSource))) {
    await ensureHikariCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
      workspace: resolveWorkingDirectory(cwd)
    });
    return runtimeHome;
  }

  await Promise.all(CODEX_RUNTIME_HOME_FILES.map((fileName) => (
    copyFileIfChanged(
      path.join(resolvedSource, fileName),
      path.join(resolvedTarget, fileName)
    )
  )));
  await syncCodexCliRuntimePluginCache(resolvedSource, resolvedTarget);
  await ensureHikariCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
    workspace: resolveWorkingDirectory(cwd)
  });
  return runtimeHome;
}

async function launchCodexCliLogin({ cwd = process.cwd() } = {}) {
  invalidateCodexLoginStatusCache();
  const safeCwd = resolveWorkingDirectory(cwd);
  const env = await buildCodexCommandEnv(safeCwd);
  if (activeCodexLogin?.child && activeCodexLogin.finished !== true) {
    const knownUrl = cleanText(activeCodexLogin.loginUrl, 8000) || OPENAI_CODEX_LOGIN_URL;
    return {
      ok: true,
      launched: true,
      loginUrl: knownUrl,
      message: 'A Codex login is already in progress. Finish the OpenAI sign-in flow in your browser.'
    };
  }

  const child = spawn(resolveCodexBinary(), ['login'], {
    cwd: safeCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeCodexLogin = {
    child,
    loginUrl: '',
    stdout: '',
    stderr: '',
    finished: false
  };

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    activeCodexLogin.stdout += text;
    const loginUrl = extractCodexLoginUrl(`${activeCodexLogin.stdout}\n${activeCodexLogin.stderr}`);
    if (loginUrl) {
      activeCodexLogin.loginUrl = loginUrl;
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '');
    activeCodexLogin.stderr += text;
    const loginUrl = extractCodexLoginUrl(`${activeCodexLogin.stdout}\n${activeCodexLogin.stderr}`);
    if (loginUrl) {
      activeCodexLogin.loginUrl = loginUrl;
    }
  });

  child.once('close', () => {
    if (activeCodexLogin?.child === child) {
      activeCodexLogin.finished = true;
      invalidateCodexLoginStatusCache();
      setTimeout(() => {
        if (activeCodexLogin?.child === child) {
          activeCodexLogin = null;
        }
      }, 1000);
    }
  });

  child.once('error', () => {
    if (activeCodexLogin?.child === child) {
      activeCodexLogin.finished = true;
    }
  });

  const loginUrl = await new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const launchTimer = setTimeout(() => {
      const parsedUrl = extractCodexLoginUrl(`${activeCodexLogin?.stdout || ''}\n${activeCodexLogin?.stderr || ''}`);
      if (parsedUrl) {
        finishResolve(parsedUrl);
        return;
      }
      finishResolve(OPENAI_CODEX_LOGIN_URL);
    }, CODEX_LOGIN_LAUNCH_GRACE_MS);

    const checkForUrl = () => {
      const parsedUrl = extractCodexLoginUrl(`${activeCodexLogin?.stdout || ''}\n${activeCodexLogin?.stderr || ''}`);
      if (parsedUrl) {
        clearTimeout(launchTimer);
        finishResolve(parsedUrl);
      }
    };

    child.stdout.on('data', checkForUrl);
    child.stderr.on('data', checkForUrl);

    child.once('error', (error) => {
      clearTimeout(launchTimer);
      finishReject(error);
    });

    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }
      clearTimeout(launchTimer);
      const parsedUrl = extractCodexLoginUrl(`${activeCodexLogin?.stdout || ''}\n${activeCodexLogin?.stderr || ''}`);
      if (parsedUrl) {
        finishResolve(parsedUrl);
        return;
      }
      const details = cleanText(activeCodexLogin?.stderr || activeCodexLogin?.stdout || '', 2400);
      const error = new Error(
        `Codex login failed (exit ${code ?? 'unknown'}).${details ? ` ${details}` : ''}`
      );
      error.code = code;
      error.signal = signal;
      finishReject(error);
    });
  });

  activeCodexLogin.loginUrl = loginUrl;
  return {
    ok: true,
    launched: true,
    loginUrl,
    message: 'OpenAI login started for Codex. Finish the sign-in flow in your browser, then return to Settings.'
  };
}

async function clearCodexCliStoredLogin({ cwd = process.cwd() } = {}) {
  invalidateCodexLoginStatusCache();
  if (activeCodexLogin?.child && activeCodexLogin.finished !== true) {
    try {
      activeCodexLogin.child.kill('SIGTERM');
    } catch {
      // Ignore failures while stopping an in-progress login flow.
    }
    activeCodexLogin.finished = true;
    activeCodexLogin = null;
  }
  const targetPaths = new Set(
    [...getCodexCliCandidateHomeDirectories(), resolveCodexCliRuntimeHomeDirectory(cwd)]
      .map((homeDirectory) => String(homeDirectory || '').trim())
      .filter(Boolean)
      .map((homeDirectory) => path.resolve(path.join(homeDirectory, 'auth.json')))
  );

  const clearedPaths = [];
  for (const targetPath of targetPaths) {
    if (await removeFileIfExists(targetPath)) {
      clearedPaths.push(targetPath);
    }
  }

  return {
    ok: true,
    clearedPaths,
    hasEnvironmentToken: Boolean(cleanText(
      process.env.HIKARI_CODEX_ACCESS_TOKEN
        || process.env.ENANA_CODEX_ACCESS_TOKEN
        || process.env.OPENAI_OAUTH_TOKEN
        || process.env.CHATGPT_OAUTH_TOKEN,
      20000
    )),
    message: clearedPaths.length
      ? 'Cleared the stored Codex login. Saving Codex settings will start a fresh OpenAI sign-in.'
      : 'No stored Codex login was found to clear.'
  };
}

async function buildCodexCommandEnv(cwd = '') {
  const env = {
    ...process.env
  };
  const runtimeHome = await ensureCodexCliRuntimeHome(cwd).catch(() => '');
  if (runtimeHome) {
    env.CODEX_HOME = runtimeHome;
  }
  return env;
}

function parseCodexCliModelsCache(rawValue = '') {
  try {
    const parsed = JSON.parse(String(rawValue || ''));
    const models = Array.isArray(parsed?.models)
      ? parsed.models.map((entry) => {
        const id = cleanText(entry?.slug, 120);
        const label = cleanText(entry?.display_name, 160) || id;
        const reasoningEfforts = Array.isArray(entry?.supported_reasoning_levels)
          ? entry.supported_reasoning_levels
            .map((level) => normalizeCodexCliReasoningEffort(level?.effort))
            .filter(Boolean)
          : [];
        const defaultReasoningEffort = normalizeCodexCliReasoningEffort(entry?.default_reasoning_level);
        if (!id) {
          return null;
        }
        return {
          id,
          label,
          reasoningEfforts,
          defaultReasoningEffort: reasoningEfforts.includes(defaultReasoningEffort) ? defaultReasoningEffort : ''
        };
      }).filter(Boolean)
      : [];
    return {
      models,
      fetchedAt: cleanText(parsed?.fetched_at, 80),
      clientVersion: cleanText(parsed?.client_version, 80)
    };
  } catch {
    return {
      models: [],
      fetchedAt: '',
      clientVersion: ''
    };
  }
}

function parseCodexCliConfigDefaults(rawValue = '') {
  const source = String(rawValue || '');
  const modelMatch = source.match(/^\s*model\s*=\s*"([^"]+)"/m);
  const reasoningMatch = source.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
  return {
    defaultModel: normalizeCodexCliModel(modelMatch?.[1] || ''),
    defaultReasoningEffort: normalizeCodexCliReasoningEffort(reasoningMatch?.[1] || '')
  };
}

function findCodexCliModelConfig(model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : null;
  const models = Array.isArray(resolvedCatalog?.models) ? resolvedCatalog.models : [];
  const target = normalizeCodexCliModel(model);
  if (!target) {
    return null;
  }
  return models.find((entry) => entry.id === target) || null;
}

function getCodexCliCatalog() {
  let cacheInfo = {
    models: [],
    fetchedAt: '',
    clientVersion: ''
  };
  let modelsCachePath = path.join(getCodexCliHomeDirectory(), CODEX_MODELS_CACHE_FILE);
  for (const homeDirectory of getCodexCliCandidateHomeDirectories()) {
    const candidatePath = path.join(homeDirectory, CODEX_MODELS_CACHE_FILE);
    try {
      cacheInfo = parseCodexCliModelsCache(fsSync.readFileSync(candidatePath, 'utf8'));
      modelsCachePath = candidatePath;
      break;
    } catch {
      // Continue scanning fallbacks.
    }
  }

  let configDefaults = {
    defaultModel: '',
    defaultReasoningEffort: ''
  };
  let configPath = path.join(getCodexCliHomeDirectory(), CODEX_CONFIG_FILE);
  for (const homeDirectory of getCodexCliCandidateHomeDirectories()) {
    const candidatePath = path.join(homeDirectory, CODEX_CONFIG_FILE);
    try {
      configDefaults = parseCodexCliConfigDefaults(fsSync.readFileSync(candidatePath, 'utf8'));
      configPath = candidatePath;
      break;
    } catch {
      // Continue scanning fallbacks.
    }
  }

  const codexHome = path.dirname(modelsCachePath || configPath) || getCodexCliHomeDirectory();

  const models = cacheInfo.models;
  const fallbackModel = models[0]?.id || '';
  const defaultModel = findCodexCliModelConfig(configDefaults.defaultModel, { models })?.id
    || findCodexCliModelConfig(configuredCodexModel, { models })?.id
    || fallbackModel
    || configDefaults.defaultModel
    || configuredCodexModel
    || '';
  const defaultModelConfig = findCodexCliModelConfig(defaultModel, { models });
  const defaultReasoningEffort = defaultModelConfig?.reasoningEfforts?.includes(configDefaults.defaultReasoningEffort)
    ? configDefaults.defaultReasoningEffort
    : defaultModelConfig?.reasoningEfforts?.includes(configuredCodexReasoningEffort)
      ? configuredCodexReasoningEffort
      : defaultModelConfig?.defaultReasoningEffort
        || defaultModelConfig?.reasoningEfforts?.[0]
        || configDefaults.defaultReasoningEffort
        || configuredCodexReasoningEffort
        || '';

  return {
    ok: models.length > 0,
    codexHome,
    modelsCachePath,
    configPath,
    fetchedAt: cacheInfo.fetchedAt,
    clientVersion: cacheInfo.clientVersion,
    defaultModel,
    defaultReasoningEffort,
    models
  };
}

function getCodexCliModel() {
  return configuredCodexModel;
}

function setCodexCliModel(model = '') {
  const cleanModel = normalizeCodexCliModel(model);
  if (!cleanModel) {
    configuredCodexModel = '';
    return configuredCodexModel;
  }
  const catalog = getCodexCliCatalog();
  configuredCodexModel = findCodexCliModelConfig(cleanModel, catalog)?.id
    || normalizeCodexCliModel(catalog.defaultModel)
    || cleanModel;
  return configuredCodexModel;
}

function getCodexCliReasoningEffort() {
  return configuredCodexReasoningEffort;
}

function setCodexCliReasoningEffort(reasoningEffort = '') {
  configuredCodexReasoningEffort = normalizeCodexCliReasoningEffort(reasoningEffort);
  return configuredCodexReasoningEffort;
}

function resolveCodexCliModel(model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object'
    ? catalog
    : getCodexCliCatalog();
  const explicitModel = normalizeCodexCliModel(model);
  const explicitConfig = findCodexCliModelConfig(explicitModel, resolvedCatalog);
  if (explicitConfig?.id) {
    configuredCodexModel = explicitConfig.id;
    return explicitConfig.id;
  }
  const configuredConfig = findCodexCliModelConfig(configuredCodexModel, resolvedCatalog);
  if (configuredConfig?.id) {
    return configuredConfig.id;
  }
  const fallbackModel = normalizeCodexCliModel(resolvedCatalog.defaultModel);
  if (fallbackModel) {
    return fallbackModel;
  }
  return explicitModel || configuredCodexModel || 'gpt-5.4';
}

function resolveCodexCliReasoningEffort(reasoningEffort = '', model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object'
    ? catalog
    : getCodexCliCatalog();
  const resolvedModel = resolveCodexCliModel(model, resolvedCatalog);
  const modelConfig = findCodexCliModelConfig(resolvedModel, resolvedCatalog);
  const explicitEffort = normalizeCodexCliReasoningEffort(reasoningEffort);

  if (modelConfig?.reasoningEfforts?.length) {
    if (modelConfig.reasoningEfforts.includes(explicitEffort)) {
      return explicitEffort;
    }
    if (modelConfig.reasoningEfforts.includes(configuredCodexReasoningEffort)) {
      return configuredCodexReasoningEffort;
    }
    if (modelConfig.reasoningEfforts.includes(resolvedCatalog.defaultReasoningEffort)) {
      return resolvedCatalog.defaultReasoningEffort;
    }
    return modelConfig.defaultReasoningEffort || modelConfig.reasoningEfforts[0] || '';
  }

  return explicitEffort || configuredCodexReasoningEffort || normalizeCodexCliReasoningEffort(resolvedCatalog.defaultReasoningEffort);
}

function appendCodexCliModelArgs(args, {
  model = '',
  reasoningEffort = '',
  catalog = null
} = {}) {
  const resolvedCatalog = catalog && typeof catalog === 'object'
    ? catalog
    : getCodexCliCatalog();
  const resolvedModel = resolveCodexCliModel(model, resolvedCatalog);
  if (resolvedModel) {
    args.push('-m', resolvedModel);
  }
  const resolvedReasoningEffort = resolveCodexCliReasoningEffort(reasoningEffort, resolvedModel, resolvedCatalog);
  if (resolvedReasoningEffort) {
    args.push('-c', `model_reasoning_effort=${resolvedReasoningEffort}`);
  }
  return args;
}

function buildCodexCliExecArgs({
  outputFile = '',
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  disableToolSearch = false,
  streamJson = false
} = {}) {
  const catalog = getCodexCliCatalog();
  const args = [
    '-a', 'never',
    '-s', 'read-only'
  ];
  if (enableWebSearch === true) {
    args.push('--search');
  }
  if (disableToolSearch === true) {
    args.push('--disable', 'tool_search');
  }
  args.push(
    'exec',
    '--skip-git-repo-check',
    '--output-last-message', outputFile,
    '--color', 'never'
  );
  if (streamJson === true) {
    args.push('--json');
  }
  appendCodexCliModelArgs(args, { model, reasoningEffort, catalog });
  args.push('-');
  return args;
}

function buildCodexCliExecResumeArgs({
  outputFile = '',
  sessionId = '',
  useLastSession = false,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  disableToolSearch = false,
  streamJson = false
} = {}) {
  const catalog = getCodexCliCatalog();
  const args = [
    '-a', 'never',
    '-s', 'read-only'
  ];
  if (enableWebSearch === true) {
    args.push('--search');
  }
  if (disableToolSearch === true) {
    args.push('--disable', 'tool_search');
  }
  args.push(
    'exec',
    'resume',
    '--skip-git-repo-check',
    '--output-last-message', outputFile
  );
  if (streamJson === true) {
    args.push('--json');
  }
  appendCodexCliModelArgs(args, { model, reasoningEffort, catalog });
  const cleanSessionId = normalizeCodexSessionId(sessionId);
  if (cleanSessionId) {
    args.push(cleanSessionId);
  } else if (useLastSession === true) {
    args.push('--last');
  }
  args.push('-');
  return args;
}

async function runCodexCommand({
  args,
  cwd,
  env = process.env,
  input = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onJsonEvent = null
}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  await ensureCodexCliAgentsFile(safeCwd);
  return new Promise((resolve, reject) => {
    throwIfAgentRequestAborted('Agent request stopped before starting Codex CLI.');
    const child = spawn(resolveCodexBinary(), args, {
      cwd: safeCwd,
      env,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    let aborted = false;
    let jsonLineBuffer = '';
    let stderrLineBuffer = '';
    const abortSignal = getAgentRequestAbortSignal();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    const finishReject = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      unsubscribeAbort();
      reject(error);
    };

    const finishResolve = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      unsubscribeAbort();
      resolve(value);
    };

    const unsubscribeAbort = onAgentRequestAbort((reason) => {
      aborted = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill failures during shutdown.
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore force-kill failures after abort.
        }
      }, 1000);
      if (!child.killed && abortSignal?.aborted) {
        finishReject(reason || createAgentRequestAbortError('Agent request stopped.'));
      }
    });

    function emitPlainCodexOutputLine(line = '', stream = 'stdout') {
      if (typeof onJsonEvent !== 'function') {
        return;
      }
      const text = cleanText(line, 12000);
      if (!text || looksLikeJsonLine(text)) {
        return;
      }
      try {
        onJsonEvent({
          type: 'codex_cli_output',
          stream,
          text
        });
      } catch {
        // Streaming callbacks should not be able to fail the Codex request.
      }
    }

    function handleJsonLines(chunkText = '', force = false) {
      if (typeof onJsonEvent !== 'function') {
        return;
      }
      jsonLineBuffer += String(chunkText || '');
      const lines = jsonLineBuffer.split(/\r?\n/u);
      const pendingLine = lines.pop() || '';
      jsonLineBuffer = force ? '' : pendingLine;
      const parseLines = force ? lines.concat(pendingLine ? [pendingLine] : []) : lines;
      parseLines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        const parsed = safeParseJson(trimmed, null);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          try {
            onJsonEvent(parsed);
          } catch {
            // Streaming callbacks should not be able to fail the Codex request.
          }
          return;
        }
        emitPlainCodexOutputLine(trimmed, 'stdout');
      });
    }

    function handleStderrLines(chunkText = '', force = false) {
      if (typeof onJsonEvent !== 'function') {
        return;
      }
      stderrLineBuffer += String(chunkText || '');
      const lines = stderrLineBuffer.split(/\r?\n/u);
      const pendingLine = lines.pop() || '';
      stderrLineBuffer = force ? '' : pendingLine;
      const parseLines = force ? lines.concat(pendingLine ? [pendingLine] : []) : lines;
      parseLines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        const parsed = safeParseJson(trimmed, null);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          try {
            onJsonEvent(parsed);
          } catch {
            // Streaming callbacks should not be able to fail the Codex request.
          }
          return;
        }
        emitPlainCodexOutputLine(trimmed, 'stderr');
      });
    }

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdout += text;
      handleJsonLines(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      stderr += text;
      handleStderrLines(text);
    });

    child.on('error', (error) => {
      finishReject(error);
    });

    child.on('close', (code, signal) => {
      handleJsonLines('', true);
      handleStderrLines('', true);
      if (aborted || abortSignal?.aborted) {
        const abortError = isAgentRequestAbortError(abortSignal?.reason)
          ? abortSignal.reason
          : createAgentRequestAbortError('Agent request stopped.');
        abortError.stdout = stdout;
        abortError.stderr = stderr;
        abortError.signal = signal;
        finishReject(abortError);
        return;
      }
      if (timedOut) {
        const timeoutError = new Error(`Codex CLI timed out after ${Math.round((Number(timeoutMs) || DEFAULT_TIMEOUT_MS) / 1000)}s.`);
        timeoutError.code = 'ETIMEDOUT';
        timeoutError.stdout = stdout;
        timeoutError.stderr = stderr;
        finishReject(timeoutError);
        return;
      }

      if (code === 0) {
        finishResolve({ stdout, stderr, signal });
        return;
      }

      const failureSummary = summarizeCodexCommandFailure({ stdout, stderr });
      const error = new Error(`Codex CLI failed (exit ${code ?? 'unknown'}): ${failureSummary}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      finishReject(error);
    });

    if (input) {
      child.stdin.write(String(input));
    }
    child.stdin.end();
  });
}

async function getCodexLoginStatus({ cwd = process.cwd(), forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && loginStatusCache && now - loginStatusCache.cachedAt < LOGIN_STATUS_CACHE_TTL_MS) {
    return loginStatusCache;
  }

  if (activeCodexLogin?.child && activeCodexLogin.finished !== true) {
    const result = {
      ok: true,
      loggedIn: false,
      source: 'login_in_progress',
      expired: false,
      sourcePath: cleanText(getCodexCliAuthFilePath(), 2400),
      message: 'Codex login is in progress. Finish the OpenAI sign-in flow in your browser.',
      cachedAt: now
    };
    loginStatusCache = result;
    return result;
  }

  const explicitToken = cleanText(
    process.env.HIKARI_CODEX_ACCESS_TOKEN
      || process.env.ENANA_CODEX_ACCESS_TOKEN
      || process.env.OPENAI_OAUTH_TOKEN
      || process.env.CHATGPT_OAUTH_TOKEN,
    20000
  );
  if (explicitToken) {
    const expired = isCodexCliAccessTokenExpired(explicitToken);
    const result = {
      ok: true,
      loggedIn: expired !== true,
      source: 'env',
      expired,
      sourcePath: '',
      message: expired
        ? 'Codex ChatGPT OAuth token from the environment is expired.'
        : 'Codex ChatGPT OAuth token is available from the environment.',
      cachedAt: now
    };
    loginStatusCache = result;
    return result;
  }

  const profile = readCodexCliOAuthProfile();
  const hasStoredTokens = profile.authMode === 'chatgpt' && Boolean(profile.accessToken || profile.refreshToken);
  const hasChatGptAccessToken = profile.authMode === 'chatgpt' && Boolean(profile.accessToken);
  const result = {
    ok: true,
    loggedIn: hasChatGptAccessToken && profile.expired !== true,
    source: hasStoredTokens ? 'stored' : 'none',
    expired: profile.expired === true,
    sourcePath: hasStoredTokens ? profile.sourcePath : '',
    message: hasStoredTokens
      ? (profile.expired === true
        ? 'Stored Codex ChatGPT login is expired. Save Codex settings to sign in again.'
        : `Stored Codex ChatGPT login loaded from ${profile.sourcePath}.`)
      : 'Codex ChatGPT login is not stored yet. Save Codex settings to sign in.',
    cachedAt: now
  };
  loginStatusCache = result;
  return result;
}

async function createCodexOutputFilePath(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  const outputDir = path.join(safeCwd, 'Tmp', CODEX_TMP_DIR_NAME);
  await fs.mkdir(outputDir, { recursive: true });
  return path.join(outputDir, `last-message-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
}

async function stageCodexPromptAttachments({
  cwd = '',
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  imageUrl = '',
  attachments = []
} = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  const rawAttachments = Array.isArray(attachments) && attachments.length
    ? attachments.map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        kind: cleanText(source.kind, 40),
        name: sanitizeAttachmentFileName(source.name || 'attachment.bin'),
        dataUrl: cleanText(source.dataUrl || source.data_url, 400000)
      };
    })
    : [
      ...(pdfDataUrl ? [{
        kind: 'file',
        name: sanitizeFileName(fileName || 'paper.pdf'),
        dataUrl: String(pdfDataUrl)
      }] : []),
      ...(cleanText(imageDataUrl || imageUrl, 400000) ? [{
        kind: 'image',
        name: 'image.png',
        dataUrl: cleanText(imageDataUrl || imageUrl, 400000)
      }] : [])
    ];
  const normalized = rawAttachments.filter((attachment) => attachment.dataUrl);
  if (!normalized.length) {
    return [];
  }
  const attachmentDir = path.join(safeCwd, 'CodexAttachments');
  await fs.mkdir(attachmentDir, { recursive: true });
  const staged = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const attachment = normalized[index];
    const parsed = parseBase64DataUrl(attachment.dataUrl);
    if (!parsed?.buffer?.length) {
      continue;
    }
    const fallback = attachment.kind === 'image' ? `image-${index + 1}.png` : `attachment-${index + 1}.bin`;
    const filePath = path.join(attachmentDir, sanitizeAttachmentFileName(attachment.name, fallback));
    await fs.writeFile(filePath, parsed.buffer);
    staged.push({
      kind: attachment.kind || (parsed.mimeType.startsWith('image/') ? 'image' : 'file'),
      name: path.basename(filePath),
      mimeType: parsed.mimeType,
      path: filePath,
      relativePath: path.relative(safeCwd, filePath)
    });
  }
  return staged;
}

function buildCodexPromptWithStagedAttachments(prompt = '', stagedAttachments = []) {
  const cleanPrompt = String(prompt || '').trim();
  if (!stagedAttachments.length) {
    return cleanPrompt;
  }
  const attachmentRows = stagedAttachments.map((attachment) => (
    `- ${attachment.name} (${attachment.mimeType || attachment.kind || 'file'}): ${attachment.relativePath}`
  ));
  return [
    cleanPrompt,
    'Hikari staged the following input files in this Codex workspace. Read them from disk if they are relevant:',
    attachmentRows.join('\n')
  ].join('\n\n');
}

async function requestCodexCliText({
  prompt,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  cwd = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  imageUrl = '',
  attachments = [],
  envOverrides = {},
  stream = false,
  onStream = null,
  resumeSessionId = '',
  disableToolSearch = false,
  returnMetadata = false
}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Codex prompt.');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is required for Codex request.');
  }

  const safeCwd = resolveWorkingDirectory(cwd);
  if (cleanText(cwd, 2400)) {
    await ensureCodexCliAgentsFile(safeCwd);
  }

  const loginStatus = await getCodexLoginStatus({ cwd: safeCwd });
  if (!loginStatus.loggedIn) {
    throw new Error(loginStatus.message || 'Codex ChatGPT OAuth credentials are not configured.');
  }

  const stagedAttachments = await stageCodexPromptAttachments({
    cwd: safeCwd,
    fileName,
    pdfDataUrl,
    imageDataUrl,
    imageUrl,
    attachments
  });
  const promptWithAttachments = buildCodexPromptWithStagedAttachments(cleanPrompt, stagedAttachments);
  const outputFile = await createCodexOutputFilePath(safeCwd);
  const baseEnv = await buildCodexCommandEnv(safeCwd);
  const env = {
    ...baseEnv,
    ...(envOverrides && typeof envOverrides === 'object' ? envOverrides : {})
  };
  const streamingEnabled = stream === true && typeof onStream === 'function';
  const cleanResumeSessionId = normalizeCodexSessionId(resumeSessionId);
  const collectJsonEvents = streamingEnabled || returnMetadata === true || Boolean(cleanResumeSessionId);
  let codexSessionId = cleanResumeSessionId;
  let streamedText = '';
  const seenProgressEvents = new Set();
  const seenDisplayEvents = new Set();
  const activeToolCallsById = new Map();
  function handleJsonStreamEvent(event = {}) {
    const plainDisplayEvent = extractCodexPlainOutputDisplayEvent(event);
    if (plainDisplayEvent) {
      emitCodexCliDisplayEvent(onStream, seenDisplayEvents, plainDisplayEvent);
      return;
    }
    const extracted = extractCodexJsonEventText(event);
    if (extracted) {
      let deltaText = cleanText(extracted.deltaText, 120000);
      const fullText = cleanText(extracted.fullText, 120000);
      if (fullText) {
        if (fullText.startsWith(streamedText)) {
          deltaText = fullText.slice(streamedText.length);
        } else if (fullText !== streamedText) {
          deltaText = fullText;
        }
        streamedText = fullText;
      } else if (deltaText) {
        streamedText += deltaText;
      }
      if (streamedText || deltaText) {
        try {
          onStream({
            type: 'codex_stream',
            event_type: cleanText(extracted.eventType, 120),
            text_delta: deltaText,
            accumulated_text: streamedText
          });
        } catch {
          // Keep streaming best-effort; the final Codex response still resolves below.
        }
        emitCodexCliDisplayEvent(onStream, seenDisplayEvents, {
          text: deltaText || fullText,
          kind: 'assistant',
          eventType: extracted.eventType
        });
      }
    }
    extractCodexJsonEventProgress(event).forEach((progressEvent) => {
      if (progressEvent?.type === 'codex_tool_call') {
        const callId = cleanText(progressEvent.call_id || progressEvent.callId, 160);
        const status = cleanText(progressEvent.status, 40);
        if (callId && status !== 'completed' && status !== 'failed') {
          activeToolCallsById.set(callId, {
            tool_name: cleanText(progressEvent.tool_name || progressEvent.toolName, 160),
            tool_call_text: cleanText(progressEvent.tool_call_text || progressEvent.toolCallText, 2400)
          });
        } else if (callId && activeToolCallsById.has(callId)) {
          const previous = activeToolCallsById.get(callId) || {};
          if (!cleanText(progressEvent.tool_name, 160) || cleanText(progressEvent.tool_name, 160) === 'codex-tool') {
            progressEvent.tool_name = previous.tool_name || progressEvent.tool_name;
          }
          if (!cleanText(progressEvent.tool_call_text, 2400) || cleanText(progressEvent.tool_call_text, 2400) === 'Tool call completed.') {
            progressEvent.tool_call_text = completeCodexProgressText(previous.tool_call_text, previous.tool_name);
          }
          activeToolCallsById.delete(callId);
        }
      }
      const progressKey = buildCodexProgressEventKey(progressEvent);
      if (progressKey && seenProgressEvents.has(progressKey)) {
        return;
      }
      if (progressKey) {
        seenProgressEvents.add(progressKey);
      }
      try {
        onStream(progressEvent);
      } catch {
        // Keep streaming best-effort; the final Codex response still resolves below.
      }
      emitCodexCliDisplayEvent(
        onStream,
        seenDisplayEvents,
        buildCodexDisplayEventFromProgress(progressEvent)
      );
    });
  }
  function handleJsonEvent(event = {}) {
    if (!codexSessionId) {
      const sessionId = extractCodexJsonEventSessionId(event);
      if (sessionId) {
        codexSessionId = sessionId;
      }
    }
    if (streamingEnabled) {
      handleJsonStreamEvent(event);
    }
  }
  const args = cleanResumeSessionId
    ? buildCodexCliExecResumeArgs({
      outputFile,
      sessionId: cleanResumeSessionId,
      model,
      reasoningEffort,
      enableWebSearch,
      disableToolSearch,
      streamJson: collectJsonEvents
    })
    : buildCodexCliExecArgs({
      outputFile,
      model,
      reasoningEffort,
      enableWebSearch,
      disableToolSearch,
      streamJson: collectJsonEvents
    });

  const commandResult = await runCodexCommand({
    args,
    cwd: safeCwd,
    env,
    input: promptWithAttachments,
    timeoutMs,
    onJsonEvent: collectJsonEvents ? handleJsonEvent : null
  });

  throwIfAgentRequestAborted('Agent request stopped before reading Codex output.');
  let outputText = '';
  try {
    outputText = await fs.readFile(outputFile, 'utf8');
  } catch {
    outputText = '';
  }
  await removeFileIfExists(outputFile).catch(() => {});
  if (!codexSessionId) {
    codexSessionId = extractCodexSessionIdFromText(commandResult.stdout || commandResult.stderr || '');
  }
  if (streamingEnabled && codexSessionId) {
    await replayCodexSessionProgressFromTranscript({
      sessionId: codexSessionId,
      cwd: safeCwd,
      onStream,
      seenProgressEvents,
      seenDisplayEvents
    });
  }
  const resultText = cleanText(outputText || streamedText || commandResult.stdout, 120000);
  if (!resultText) {
    throw new Error('Codex CLI returned an empty response.');
  }
  if (returnMetadata === true) {
    return {
      text: resultText,
      metadata: {
        session_id: normalizeCodexSessionId(codexSessionId),
        resumed_session_id: cleanResumeSessionId,
        command: cleanResumeSessionId ? 'exec resume' : 'exec'
      }
    };
  }
  return resultText;
}

module.exports = {
  OPENAI_CODEX_LOGIN_URL,
  buildHikariCodexAgentsInstructions,
  buildEnanaCodexAgentsInstructions,
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs,
  clearCodexCliStoredLogin,
  ensureCodexCliAgentsFile,
  ensureCodexCliRuntimeHome,
  extractCodexJsonEventProgress,
  extractCodexJsonEventSessionId,
  extractCodexJsonEventText,
  extractCodexJsonEventThinking,
  extractCodexJsonEventToolCall,
  extractCodexLoginUrl,
  getCodexCliCatalog,
  getCodexCliAuthFilePath,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  invalidateCodexLoginStatusCache,
  launchCodexCliLogin,
  readCodexCliOAuthProfile,
  resolveCodexCliRuntimeHomeDirectory,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
};
