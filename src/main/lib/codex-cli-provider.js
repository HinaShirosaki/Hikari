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
const CODEX_TMP_DIR_NAME = 'codex-cli';
const CODEX_MODELS_CACHE_FILE = 'models_cache.json';
const CODEX_CONFIG_FILE = 'config.toml';

let loginStatusCache = null;
let configuredCodexModel = '';
let configuredCodexReasoningEffort = '';

function cleanText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function looksLikePath(value) {
  const text = String(value || '').trim();
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
  return cleanText(model, 120);
}

function normalizeCodexCliReasoningEffort(reasoningEffort = '') {
  return cleanText(reasoningEffort, 40).toLowerCase();
}

function getCodexCliHomeDirectory() {
  const configuredHome = String(process.env.CODEX_HOME || '').trim();
  if (configuredHome) {
    return configuredHome;
  }
  return path.join(os.homedir(), '.codex');
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
  const codexHome = getCodexCliHomeDirectory();
  const modelsCachePath = path.join(codexHome, CODEX_MODELS_CACHE_FILE);
  const configPath = path.join(codexHome, CODEX_CONFIG_FILE);

  let cacheInfo = {
    models: [],
    fetchedAt: '',
    clientVersion: ''
  };
  try {
    cacheInfo = parseCodexCliModelsCache(fsSync.readFileSync(modelsCachePath, 'utf8'));
  } catch {
    // Fall back to config defaults when the model cache is unavailable.
  }

  let configDefaults = {
    defaultModel: '',
    defaultReasoningEffort: ''
  };
  try {
    configDefaults = parseCodexCliConfigDefaults(fsSync.readFileSync(configPath, 'utf8'));
  } catch {
    // Keep defaults empty when config.toml is unavailable.
  }

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
  return explicitModel || configuredCodexModel;
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

function buildCodexCliExecArgs({ outputFile = '', model = '', reasoningEffort = '' } = {}) {
  const catalog = getCodexCliCatalog();
  const args = [
    '-a', 'never',
    '-s', 'read-only',
    'exec',
    '--skip-git-repo-check',
    '--output-last-message', outputFile,
    '--color', 'never'
  ];
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

async function runCodexCommand({ args, cwd, input = '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    throwIfAgentRequestAborted('Agent request stopped before starting Codex CLI.');
    const safeCwd = resolveWorkingDirectory(cwd);
    const child = spawn(resolveCodexBinary(), args, {
      cwd: safeCwd,
      env: process.env,
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
  const safeCwd = resolveWorkingDirectory(cwd);
  if (!forceRefresh && loginStatusCache && now - loginStatusCache.cachedAt < LOGIN_STATUS_CACHE_TTL_MS) {
    return loginStatusCache;
  }

  try {
    const { stdout, stderr } = await runCodexCommand({
      args: ['login', 'status'],
      cwd: safeCwd,
      timeoutMs: LOGIN_STATUS_TIMEOUT_MS
    });
    const combined = `${stdout}\n${stderr}`.trim();
    const loggedIn = /\blogged in\b/i.test(combined) && !/\bnot logged in\b/i.test(combined);
    const statusLine = combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /\b(logged in|not logged in)\b/i.test(line))
      || cleanText(combined || 'Unable to detect Codex login state.', 240);

    const result = {
      ok: true,
      loggedIn,
      message: statusLine,
      cachedAt: now
    };
    loginStatusCache = result;
    return result;
  } catch (error) {
    const missingBinary = isMissingBinaryError(error);
    const result = {
      ok: false,
      loggedIn: false,
      message: missingBinary
        ? 'Codex CLI was not found. Install Codex CLI and ensure `codex` is on PATH.'
        : cleanText(error?.message || error, 320),
      cachedAt: now
    };
    loginStatusCache = result;
    return result;
  }
}

async function requestCodexCliText({
  prompt,
  model = '',
  reasoningEffort = '',
  cwd = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fileName = '',
  pdfDataUrl = ''
}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Codex CLI prompt.');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is required for Codex CLI request.');
  }
  const safeCwd = resolveWorkingDirectory(cwd);

  const loginStatus = await getCodexLoginStatus({ cwd: safeCwd });
  if (!loginStatus.ok) {
    throw new Error(loginStatus.message || 'Failed to verify Codex CLI login status.');
  }
  if (!loginStatus.loggedIn) {
    throw new Error('Codex CLI is not logged in. Run `codex login` and sign in with ChatGPT.');
  }

  const baseTmpDir = path.join(safeCwd, 'tmp', CODEX_TMP_DIR_NAME);
  await fs.mkdir(baseTmpDir, { recursive: true });
  const runDir = path.join(baseTmpDir, `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
  await fs.mkdir(runDir, { recursive: true });

  const outputFile = path.join(runDir, 'last-message.txt');
  let finalPrompt = cleanPrompt;

  try {
    if (pdfDataUrl) {
      throwIfAgentRequestAborted('Agent request stopped before preparing Codex CLI PDF input.');
      const pdfBuffer = parsePdfDataUrl(pdfDataUrl);
      if (!pdfBuffer) {
        throw new Error('Failed to parse PDF data for Codex CLI request.');
      }
      const pdfPath = path.join(runDir, sanitizeFileName(fileName || 'paper.pdf'));
      await fs.writeFile(pdfPath, pdfBuffer);
      finalPrompt = [
        cleanPrompt,
        `Local PDF path: ${pdfPath}`,
        'Use this PDF as source evidence. You may run local read-only shell commands to inspect it. Do not modify project files.'
      ].join('\n\n');
    }

    const args = buildCodexCliExecArgs({
      outputFile,
      model,
      reasoningEffort
    });

    await runCodexCommand({
      args,
      cwd: safeCwd,
      input: `${finalPrompt}\n`,
      timeoutMs
    });

    throwIfAgentRequestAborted('Agent request stopped before reading Codex CLI output.');
    const resultText = cleanText(await fs.readFile(outputFile, 'utf8'), 120000);
    if (!resultText) {
      throw new Error('Codex CLI returned an empty response.');
    }
    return resultText;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  buildCodexCliExecArgs,
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
};
