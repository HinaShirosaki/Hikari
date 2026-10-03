'use strict';

const { spawn } = require('node:child_process');
const {
  CODEX_LOGIN_LAUNCH_GRACE_MS,
  OPENAI_CODEX_LOGIN_URL
} = require('./constants');
const {
  getActiveCodexLogin,
  invalidateCodexLoginStatusCache,
  setActiveCodexLogin
} = require('./login-state');
const {
  createCodexCliNotFoundError,
  resolveWorkingDirectory
} = require('./paths');
const { cleanText } = require('./utils');
const { prepareCodexRuntime } = require('./runtime-gateway');

function extractCodexLoginUrl(text = '') {
  const match = String(text || '').match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/i);
  return cleanText(match?.[0] || '', 8000);
}

async function launchCodexCliLogin({ cwd = process.cwd() } = {}) {
  invalidateCodexLoginStatusCache();
  const safeCwd = resolveWorkingDirectory(cwd);
  const activeLogin = getActiveCodexLogin();
  if (activeLogin?.child && activeLogin.finished !== true) {
    const knownUrl = cleanText(activeLogin.loginUrl, 8000) || OPENAI_CODEX_LOGIN_URL;
    return {
      ok: true,
      launched: true,
      loginUrl: knownUrl,
      message: 'A Codex login is already in progress. Finish the OpenAI sign-in flow in your browser.'
    };
  }

  const { env, invocation } = await prepareCodexRuntime({ cwd: safeCwd });
  const child = spawn(invocation.command, [...invocation.argsPrefix, 'login'], {
    cwd: safeCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const loginState = setActiveCodexLogin({
    child,
    loginUrl: '',
    stdout: '',
    stderr: '',
    finished: false
  });

  child.stdout.on('data', (chunk) => updateLoginOutput(loginState, 'stdout', chunk));
  child.stderr.on('data', (chunk) => updateLoginOutput(loginState, 'stderr', chunk));
  child.once('close', () => markLoginFinished(child));
  child.once('error', () => {
    if (getActiveCodexLogin()?.child === child) {
      getActiveCodexLogin().finished = true;
    }
  });

  const loginUrl = await waitForLoginUrl(child, loginState);
  loginState.loginUrl = loginUrl;
  return {
    ok: true,
    launched: true,
    loginUrl,
    message: 'OpenAI login started for Codex. Finish the sign-in flow in your browser, then return to Settings.'
  };
}

function updateLoginOutput(loginState, streamName, chunk) {
  const text = String(chunk || '');
  loginState[streamName] += text;
  const loginUrl = extractCodexLoginUrl(`${loginState.stdout}\n${loginState.stderr}`);
  if (loginUrl) {
    loginState.loginUrl = loginUrl;
  }
}

function markLoginFinished(child) {
  const activeLogin = getActiveCodexLogin();
  if (activeLogin?.child === child) {
    activeLogin.finished = true;
    invalidateCodexLoginStatusCache();
    setTimeout(() => {
      if (getActiveCodexLogin()?.child === child) {
        setActiveCodexLogin(null);
      }
    }, 1000);
  }
}

function waitForLoginUrl(child, loginState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const finishReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const readBufferedUrl = () => extractCodexLoginUrl(`${loginState.stdout || ''}\n${loginState.stderr || ''}`);
    const launchTimer = setTimeout(() => {
      finishResolve(readBufferedUrl() || OPENAI_CODEX_LOGIN_URL);
    }, CODEX_LOGIN_LAUNCH_GRACE_MS);

    const checkForUrl = () => {
      const parsedUrl = readBufferedUrl();
      if (parsedUrl) {
        clearTimeout(launchTimer);
        finishResolve(parsedUrl);
      }
    };

    child.stdout.on('data', checkForUrl);
    child.stderr.on('data', checkForUrl);
    child.once('error', (error) => {
      clearTimeout(launchTimer);
      finishReject(error?.code === 'ENOENT' ? createCodexCliNotFoundError(error) : error);
    });
    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }
      clearTimeout(launchTimer);
      const parsedUrl = readBufferedUrl();
      if (parsedUrl) {
        finishResolve(parsedUrl);
        return;
      }
      const details = cleanText(loginState.stderr || loginState.stdout || '', 2400);
      const error = new Error(`Codex login failed (exit ${code ?? 'unknown'}).${details ? ` ${details}` : ''}`);
      error.code = code;
      error.signal = signal;
      finishReject(error);
    });
  });
}

module.exports = {
  extractCodexLoginUrl,
  launchCodexCliLogin
};
