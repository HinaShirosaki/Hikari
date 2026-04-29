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
  buildEnanaCodexAgentsInstructions
} = require('../helpers/agent/codex-agent/agent-instructions.js');
const {
  ensureEnanaCodexAgentsFile,
  ensureEnanaCodexMcpConfig
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

async function ensureCodexCliAgentsFile(cwd = '') {
  return ensureEnanaCodexAgentsFile(resolveWorkingDirectory(cwd));
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
    await ensureEnanaCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
      workspace: resolveWorkingDirectory(cwd)
    });
    return runtimeHome;
  }
  const resolvedSource = path.resolve(sourceHome);
  const resolvedTarget = path.resolve(runtimeHome);
  if (resolvedSource === resolvedTarget || !(await pathExists(resolvedSource))) {
    await ensureEnanaCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
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
  await ensureEnanaCodexMcpConfig(path.join(runtimeHome, CODEX_CONFIG_FILE), {
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
    'Enana staged the following input files in this Codex workspace. Read them from disk if they are relevant:',
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
  envOverrides = {}
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
  const args = buildCodexCliExecArgs({
    outputFile,
    model,
    reasoningEffort,
    enableWebSearch
  });

  const commandResult = await runCodexCommand({
    args,
    cwd: safeCwd,
    env,
    input: promptWithAttachments,
    timeoutMs
  });

  throwIfAgentRequestAborted('Agent request stopped before reading Codex output.');
  let outputText = '';
  try {
    outputText = await fs.readFile(outputFile, 'utf8');
  } catch {
    outputText = '';
  }
  await removeFileIfExists(outputFile).catch(() => {});
  const resultText = cleanText(outputText || commandResult.stdout, 120000);
  if (!resultText) {
    throw new Error('Codex CLI returned an empty response.');
  }
  return resultText;
}

module.exports = {
  OPENAI_CODEX_LOGIN_URL,
  buildEnanaCodexAgentsInstructions,
  buildCodexCliExecArgs,
  clearCodexCliStoredLogin,
  ensureCodexCliAgentsFile,
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
  resolveCodexCliRuntimeHomeDirectory,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
};
