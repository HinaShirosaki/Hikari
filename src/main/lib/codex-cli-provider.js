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

const DEFAULT_TIMEOUT_MS = 180000;
const LOGIN_STATUS_TIMEOUT_MS = 12000;
const LOGIN_STATUS_CACHE_TTL_MS = 30000;
const CODEX_LOGIN_LAUNCH_GRACE_MS = 1500;
const OPENAI_CODEX_BACKEND_API_BASE_URL = 'https://chatgpt.com/backend-api';
const OPENAI_CODEX_RESPONSES_ENDPOINT = `${OPENAI_CODEX_BACKEND_API_BASE_URL}/codex/responses`;
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
  const explicit = String(process.env.ENANA_CODEX_CLI || process.env.ENANA_CODEX_BIN || '').trim();
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
    if (!value) {
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

function resolveWorkingDirectory(cwd = '') {
  const resolved = pickExistingDirectory([
    cwd,
    process.cwd(),
    path.dirname(process.execPath),
    os.homedir()
  ]);
  return resolved || process.cwd();
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

function parsePdfDataUrl(pdfDataUrl) {
  const match = String(pdfDataUrl || '').trim().match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  return Buffer.from(match[1], 'base64');
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
  const appManagedHome = String(process.env.ENANA_CODEX_HOME || '').trim();
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

function resolveCodexCliResponsesEndpoint(endpoint = '') {
  const raw = cleanText(endpoint, 2400);
  if (!raw || raw.toLowerCase().startsWith('codex://')) {
    return OPENAI_CODEX_RESPONSES_ENDPOINT;
  }
  if (!/^https?:\/\//i.test(raw)) {
    return OPENAI_CODEX_RESPONSES_ENDPOINT;
  }
  const normalized = raw.replace(/\/+$/, '');
  if (/\/backend-api\/codex$/i.test(normalized)) {
    return `${normalized}/responses`;
  }
  if (/\/backend-api\/codex\/responses$/i.test(normalized)) {
    return normalized;
  }
  if (/https?:\/\/chatgpt\.com\/backend-api\/responses$/i.test(normalized)) {
    return `${OPENAI_CODEX_BACKEND_API_BASE_URL}/codex/responses`;
  }
  if (/\/responses$/i.test(normalized)) {
    return normalized;
  }
  if (/\/backend-api$/i.test(normalized)) {
    return `${normalized}/codex/responses`;
  }
  return normalized;
}

function resolveCodexCliAccountId(explicitAccountId = '') {
  const provided = cleanText(explicitAccountId, 400);
  if (provided) {
    return provided;
  }
  const envAccountId = cleanText(
    process.env.ENANA_CODEX_ACCOUNT_ID
      || process.env.OPENAI_CODEX_ACCOUNT_ID
      || process.env.CHATGPT_ACCOUNT_ID,
    400
  );
  if (envAccountId) {
    return envAccountId;
  }
  const profile = readCodexCliOAuthProfile();
  return cleanText(profile.accountId, 400);
}

function resolveCodexCliAccessToken(explicitToken = '') {
  const provided = cleanText(explicitToken, 20000);
  if (provided && !isCodexCliAccessTokenExpired(provided)) {
    return provided;
  }

  const envToken = cleanText(
    process.env.ENANA_CODEX_ACCESS_TOKEN
      || process.env.OPENAI_OAUTH_TOKEN
      || process.env.CHATGPT_OAUTH_TOKEN,
    20000
  );
  if (envToken && !isCodexCliAccessTokenExpired(envToken)) {
    return envToken;
  }

  const profile = readCodexCliOAuthProfile();
  if (profile.expired === true) {
    return '';
  }
  return cleanText(profile.accessToken, 20000);
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  output.forEach((item) => {
    if (item?.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : [];
      content.forEach((entry) => {
        if (entry?.type === 'output_text' && entry.text) {
          chunks.push(String(entry.text));
        }
      });
      return;
    }
    if (item?.type === 'output_text' && item.text) {
      chunks.push(String(item.text));
    }
  });
  return chunks.join('\n').trim();
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

function parseCodexSseEvents(raw = '') {
  return String(raw || '')
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/);
      const event = cleanText(
        (lines.find((line) => line.startsWith('event:')) || '').slice(6),
        200
      );
      const dataText = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      return {
        event,
        dataText,
        data: safeParseJson(dataText, null)
      };
    });
}

function buildCodexResponsePayloadFromSse(raw = '') {
  const events = parseCodexSseEvents(raw);
  const outputItems = [];
  const outputTextChunks = [];
  let responseEnvelope = null;

  events.forEach((entry) => {
    const payload = entry.data && typeof entry.data === 'object' ? entry.data : null;
    if (!payload) {
      return;
    }
    if (payload.type === 'response.output_text.done' && payload.text) {
      outputTextChunks.push(String(payload.text));
      return;
    }
    if (payload.type === 'response.output_item.done' && payload.item && typeof payload.item === 'object') {
      outputItems.push(payload.item);
      return;
    }
    if (payload.type === 'response.completed' && payload.response && typeof payload.response === 'object') {
      responseEnvelope = payload.response;
    }
  });

  const reconstructedText = cleanText(outputTextChunks.join(''), 120000);
  const normalizedOutput = outputItems.map((item) => {
    const normalized = item && typeof item === 'object' ? item : {};
    if (normalized.type === 'message') {
      const content = Array.isArray(normalized.content) ? normalized.content : [];
      return {
        ...normalized,
        content: content.map((entry) => (entry && typeof entry === 'object' ? entry : {}))
      };
    }
    if (normalized.type === 'function_call') {
      return {
        ...normalized,
        arguments: String(normalized.arguments || '')
      };
    }
    return normalized;
  });

  return {
    ...(responseEnvelope && typeof responseEnvelope === 'object' ? responseEnvelope : {}),
    output: normalizedOutput,
    output_text: reconstructedText,
    _raw_event_stream: String(raw || '')
  };
}

async function requestCodexResponsesJson({
  endpoint,
  apiKey,
  accountId = '',
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryStatuses = [429, 503],
  maxRetries = 3
} = {}) {
  const abortSignal = getAgentRequestAbortSignal();
  let attempt = 0;

  while (attempt <= maxRetries) {
    throwIfAgentRequestAborted('Agent request stopped before sending Codex request.');
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort(createAgentRequestAbortError('Codex request timed out.'));
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    const relayAbort = () => {
      timeoutController.abort(abortSignal?.reason || createAgentRequestAbortError('Agent request stopped.'));
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', relayAbort, { once: true });
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'CodexBar'
      };
      const resolvedAccountId = cleanText(accountId, 400);
      if (resolvedAccountId) {
        headers['ChatGPT-Account-Id'] = resolvedAccountId;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutController.signal
      });
      clearTimeout(timeoutHandle);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', relayAbort);
      }

      if (!retryStatuses.includes(response.status)) {
        if (!response.ok) {
          throw new Error(`Codex API error (${response.status}): ${await response.text()}`);
        }
        const raw = await response.text();
        const parsedJson = safeParseJson(raw, null);
        if (parsedJson && typeof parsedJson === 'object') {
          return parsedJson;
        }
        return buildCodexResponsePayloadFromSse(raw);
      }

      if (attempt >= maxRetries) {
        throw new Error(`Codex API rate-limited (${response.status}): ${await response.text()}`);
      }

      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
      await sleepWithAbort(retryAfterMs, abortSignal);
      attempt += 1;
    } catch (error) {
      clearTimeout(timeoutHandle);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', relayAbort);
      }
      if (isAgentRequestAbortError(error) || abortSignal?.aborted) {
        throw createAgentRequestAbortError(abortSignal?.reason || error?.message || 'Agent request stopped.');
      }
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await sleepWithAbort(waitMs, abortSignal);
      attempt += 1;
    }
  }

  throw new Error('Codex API request failed after retries.');
}

function resolveCodexCliRuntimeHomeDirectory(cwd = '') {
  const explicit = String(process.env.ENANA_CODEX_HOME || '').trim();
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
    return runtimeHome;
  }
  const resolvedSource = path.resolve(sourceHome);
  const resolvedTarget = path.resolve(runtimeHome);
  if (resolvedSource === resolvedTarget || !(await pathExists(resolvedSource))) {
    return runtimeHome;
  }

  await Promise.all(CODEX_RUNTIME_HOME_FILES.map((fileName) => (
    copyFileIfChanged(
      path.join(resolvedSource, fileName),
      path.join(resolvedTarget, fileName)
    )
  )));
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
      process.env.ENANA_CODEX_ACCESS_TOKEN
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

function buildCodexCliExecArgs({ outputFile = '', model = '', reasoningEffort = '', enableWebSearch = false } = {}) {
  const catalog = getCodexCliCatalog();
  const args = [
    '-a', 'never',
    '-s', 'read-only'
  ];
  if (enableWebSearch === true) {
    args.push('--search');
  }
  args.push(
    'exec',
    '--skip-git-repo-check',
    '--output-last-message', outputFile,
    '--color', 'never'
  );
  const resolvedModel = resolveCodexCliModel(model, catalog);
  if (resolvedModel) {
    args.push('-m', resolvedModel);
  }
  const resolvedReasoningEffort = resolveCodexCliReasoningEffort(reasoningEffort, resolvedModel, catalog);
  if (resolvedReasoningEffort) {
    args.push('-c', `model_reasoning_effort=${resolvedReasoningEffort}`);
  }
  args.push('-');
  return args;
}

async function runCodexCommand({ args, cwd, env = process.env, input = '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    throwIfAgentRequestAborted('Agent request stopped before starting Codex CLI.');
    const safeCwd = resolveWorkingDirectory(cwd);
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

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      finishReject(error);
    });

    child.on('close', (code, signal) => {
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

      const error = new Error(
        `Codex CLI failed (exit ${code ?? 'unknown'}): ${cleanText(stderr || stdout || 'Unknown error', 2000)}`
      );
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
    process.env.ENANA_CODEX_ACCESS_TOKEN
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

async function requestCodexCliText({
  prompt,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  imageUrl = '',
  attachments = [],
  endpoint = '',
  apiKey = ''
}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Codex prompt.');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is required for Codex request.');
  }

  const loginStatus = await getCodexLoginStatus({ cwd });
  if (!loginStatus.loggedIn) {
    throw new Error(loginStatus.message || 'Codex ChatGPT OAuth credentials are not configured.');
  }

  const resolvedEndpoint = resolveCodexCliResponsesEndpoint(endpoint);
  const resolvedApiKey = resolveCodexCliAccessToken(apiKey);
  if (!resolvedApiKey) {
    throw new Error('Codex ChatGPT OAuth credentials are not configured. Run `codex login` first.');
  }
  const resolvedAccountId = resolveCodexCliAccountId();

  const resolvedModel = resolveCodexCliModel(model);
  const resolvedReasoningEffort = resolveCodexCliReasoningEffort(reasoningEffort, resolvedModel);
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        kind: cleanText(source.kind, 40),
        name: sanitizeFileName(source.name || 'attachment'),
        dataUrl: cleanText(source.dataUrl || source.data_url, 400000)
      };
    }).filter((attachment) => attachment.dataUrl)
    : [];
  const normalizedImageData = cleanText(imageDataUrl || imageUrl, 400000);
  const effectiveAttachments = normalizedAttachments.length
    ? normalizedAttachments
    : [
      ...(pdfDataUrl ? [{
        kind: 'file',
        name: sanitizeFileName(fileName || 'paper.pdf'),
        dataUrl: String(pdfDataUrl)
      }] : []),
      ...(normalizedImageData ? [{
        kind: 'image',
        name: 'image',
        dataUrl: normalizedImageData
      }] : [])
    ];
  const requestInput = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: cleanPrompt },
        ...effectiveAttachments.map((attachment) => (
          attachment.kind === 'image'
            ? {
              type: 'input_image',
              image_url: attachment.dataUrl
            }
            : {
              type: 'input_file',
              filename: attachment.name,
              file_data: attachment.dataUrl
            }
        ))
      ]
    }
  ];

  const body = {
    model: resolvedModel,
    instructions: 'Follow the user input and attached context exactly. If the input requests JSON only, return JSON only.',
    input: requestInput,
    store: false,
    stream: true
  };
  if (resolvedReasoningEffort) {
    body.reasoning = {
      effort: resolvedReasoningEffort
    };
  }
  if (enableWebSearch === true) {
    body.tools = [{ type: 'web_search' }];
    body.tool_choice = 'auto';
  }

  const response = await requestCodexResponsesJson({
    endpoint: resolvedEndpoint,
    apiKey: resolvedApiKey,
    accountId: resolvedAccountId,
    body,
    timeoutMs
  });

  throwIfAgentRequestAborted('Agent request stopped before reading Codex output.');
  const resultText = cleanText(extractResponseText(response), 120000);
  if (!resultText) {
    throw new Error('Codex provider returned an empty response.');
  }
  return resultText;
}

module.exports = {
  OPENAI_CODEX_RESPONSES_ENDPOINT,
  OPENAI_CODEX_LOGIN_URL,
  buildCodexCliExecArgs,
  clearCodexCliStoredLogin,
  ensureCodexCliRuntimeHome,
  extractCodexLoginUrl,
  getCodexCliCatalog,
  getCodexCliAuthFilePath,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  invalidateCodexLoginStatusCache,
  launchCodexCliLogin,
  readCodexCliOAuthProfile,
  resolveCodexCliAccessToken,
  resolveCodexCliResponsesEndpoint,
  resolveCodexCliRuntimeHomeDirectory,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
};
