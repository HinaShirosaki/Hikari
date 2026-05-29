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

async function getCodexLoginStatus({ forceRefresh = false } = {}) {
  const now = Date.now();
  const cached = getLoginStatusCache();
  if (!forceRefresh && cached && now - cached.cachedAt < LOGIN_STATUS_CACHE_TTL_MS) {
    return cached;
  }

  const activeLogin = getActiveCodexLogin();
  if (activeLogin?.child && activeLogin.finished !== true) {
    return cacheLoginStatus({
      ok: true,
      loggedIn: false,
      source: 'login_in_progress',
      expired: false,
      sourcePath: cleanText(getCodexCliAuthFilePath(), 2400),
      message: 'Codex login is in progress. Finish the OpenAI sign-in flow in your browser.',
      cachedAt: now
    });
  }

  const explicitToken = readEnvironmentCodexToken();
  if (explicitToken) {
    const expired = isCodexCliAccessTokenExpired(explicitToken);
    return cacheLoginStatus({
      ok: true,
      loggedIn: expired !== true,
      source: 'env',
      expired,
      sourcePath: '',
      message: expired
        ? 'Codex ChatGPT OAuth token from the environment is expired.'
        : 'Codex ChatGPT OAuth token is available from the environment.',
      cachedAt: now
    });
  }

  const profile = readCodexCliOAuthProfile();
  const hasStoredTokens = profile.authMode === 'chatgpt' && Boolean(profile.accessToken || profile.refreshToken);
  const hasChatGptAccessToken = profile.authMode === 'chatgpt' && Boolean(profile.accessToken);
  return cacheLoginStatus({
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
  });
}

function readEnvironmentCodexToken() {
  return cleanText(
    process.env.HIKARI_CODEX_ACCESS_TOKEN
      || process.env.ENANA_CODEX_ACCESS_TOKEN
      || process.env.OPENAI_OAUTH_TOKEN
      || process.env.CHATGPT_OAUTH_TOKEN,
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
