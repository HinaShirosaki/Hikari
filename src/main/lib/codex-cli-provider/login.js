'use strict';

const path = require('node:path');
const { LOGIN_STATUS_CACHE_TTL_MS } = require('./constants');
const { removeFileIfExists } = require('./fs-utils');
const {
  getActiveCodexLogin,
  getLoginStatusCache,
  invalidateCodexLoginStatusCache,
  setActiveCodexLogin,
  setLoginStatusCache
} = require('./login-state');
const {
  extractCodexLoginUrl,
  launchCodexCliLogin
} = require('./login-launch');
const {
  getCodexCliAuthFilePath,
  getCodexCliCandidateHomeDirectories,
  resolveCodexCliRuntimeHomeDirectory
} = require('./paths');
const {
  isCodexCliAccessTokenExpired,
  readCodexCliOAuthProfile
} = require('./auth-profile');
const { cleanText } = require('./utils');
const { getCodexCliUpdateStatus } = require('./cli-maintenance');
const { prepareCodexRuntime } = require('./runtime-gateway');

async function clearCodexCliStoredLogin({ cwd = process.cwd() } = {}) {
  invalidateCodexLoginStatusCache();
  const activeLogin = getActiveCodexLogin();
  if (activeLogin?.child && activeLogin.finished !== true) {
    try {
      activeLogin.child.kill('SIGTERM');
    } catch {
      // Ignore failures while stopping an in-progress login flow.
    }
    activeLogin.finished = true;
    setActiveCodexLogin(null);
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
    hasEnvironmentToken: Boolean(readEnvironmentCodexToken()),
    message: clearedPaths.length
      ? 'Cleared the stored Codex login. Saving Codex settings will start a fresh OpenAI sign-in.'
      : 'No stored Codex login was found to clear.'
  };
}

async function getCodexLoginStatus(options = {}) {
  const runtime = options.runtime || await prepareCodexRuntime({ ...options, allowMissingCli: true });
  const cachedStatus = await readCodexLoginStatus({ ...options, runtime });
  const status = { ...cachedStatus };
  delete status.runtimeIdentity;
  const update = getCodexCliUpdateStatus();
  // Do not cache discovery: an install or removal must be reflected immediately.
  return {
    ...status, ...runtime.availability,
    cliPath: runtime.diagnostics.cliPath,
    cliVersion: runtime.version,
    cliUpdateStatus: update.status || '',
    cliUpdateError: update.error || ''
  };
}

async function readCodexLoginStatus({ forceRefresh = false, runtime } = {}) {
  const env = runtime.env;
  const now = Date.now();
  const cached = getLoginStatusCache();
  if (!forceRefresh && cached?.runtimeIdentity === runtime.identity && now - cached.cachedAt < LOGIN_STATUS_CACHE_TTL_MS) {
    return cached;
  }

  const activeLogin = getActiveCodexLogin();
  if (activeLogin?.child && activeLogin.finished !== true) {
    return cacheLoginStatus({
      ok: true,
      loggedIn: false,
      source: 'login_in_progress',
      expired: false,
      canRefresh: false,
      sourcePath: cleanText(getCodexCliAuthFilePath(env), 2400),
      message: 'Codex login is in progress. Finish the OpenAI sign-in flow in your browser.',
      cachedAt: now, runtimeIdentity: runtime.identity
    });
  }

  const explicitToken = readEnvironmentCodexToken(env);
  if (explicitToken) {
    const expired = isCodexCliAccessTokenExpired(explicitToken);
    return cacheLoginStatus({
      ok: true,
      loggedIn: expired !== true,
      source: 'env',
      expired,
      canRefresh: false,
      sourcePath: '',
      message: expired
        ? 'Codex ChatGPT OAuth token from the environment is expired.'
        : 'Codex ChatGPT OAuth token is available from the environment.',
      cachedAt: now, runtimeIdentity: runtime.identity
    });
  }

  const profile = readCodexCliOAuthProfile(env);
  const hasStoredTokens = profile.authMode === 'chatgpt' && Boolean(profile.accessToken || profile.refreshToken);
  const hasChatGptAccessToken = profile.authMode === 'chatgpt' && Boolean(profile.accessToken);
  return cacheLoginStatus({
    ok: true,
    loggedIn: hasChatGptAccessToken && profile.expired !== true,
    source: hasStoredTokens ? 'stored' : 'none',
    expired: profile.expired === true,
    canRefresh: profile.authMode === 'chatgpt' && Boolean(profile.refreshToken),
    sourcePath: hasStoredTokens ? profile.sourcePath : '',
    message: hasStoredTokens
      ? (profile.expired === true
        ? 'Stored Codex ChatGPT login is expired. Save Codex settings to sign in again.'
        : `Stored Codex ChatGPT login loaded from ${profile.sourcePath}.`)
      : 'Codex ChatGPT login is not stored yet. Save Codex settings to sign in.',
    cachedAt: now, runtimeIdentity: runtime.identity
  });
}

function readEnvironmentCodexToken(env = process.env) {
  return cleanText(
    env.HIKARI_CODEX_ACCESS_TOKEN
      || env.OPENAI_OAUTH_TOKEN
      || env.CHATGPT_OAUTH_TOKEN,
    20000
  );
}

function cacheLoginStatus(result) {
  setLoginStatusCache(result);
  return result;
}

module.exports = {
  clearCodexCliStoredLogin,
  extractCodexLoginUrl,
  getCodexLoginStatus,
  invalidateCodexLoginStatusCache,
  launchCodexCliLogin
};
