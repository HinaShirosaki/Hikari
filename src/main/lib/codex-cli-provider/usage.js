'use strict';

const { spawn } = require('node:child_process');
const { prepareCodexRuntime } = require('./runtime-gateway');
const { safeParseJson } = require('./utils');

function normalizeUsageWindow(window) {
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    resetsAt: typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt)
      && window.resetsAt > 0 ? window.resetsAt : null
  };
}

function usageFromCodexRateLimits(result = {}) {
  // Model-specific buckets have independent quotas. Only show the Codex bucket.
  const legacy = result?.rateLimits;
  const limits = result?.rateLimitsByLimitId?.codex
    || (!legacy?.limitId || legacy.limitId === 'codex' ? legacy : null);
  const windows = [limits?.primary, limits?.secondary];
  return {
    fiveHour: normalizeUsageWindow(windows.find(window => window?.windowDurationMins === 300)),
    weekly: normalizeUsageWindow(windows.find(window => window?.windowDurationMins === 10080))
  };
}

// Read-only app-server RPC, using the same CLI and managed account as execution.
function readCodexRateLimits({ env = process.env, invocation, cwd, timeoutMs = 15000,
  spawnProcess = spawn } = {}) {
  if (env.HIKARI_CODEX_HOME) env = { ...env, CODEX_HOME: env.HIKARI_CODEX_HOME };
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, [...invocation.argsPrefix, 'app-server'], {
      env, cwd, windowsHide: true, stdio: 'pipe'
    });
    let buffer = '';
    let settled = false;
    let initialized = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out. Try refreshing.')), timeoutMs);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error', () => finish(new Error('Could not start Codex to read account usage.')));
    child.on('exit', () => finish(new Error('Codex closed before returning account usage.')));
    child.stdin.on('error', () => finish(new Error('Could not request Codex account usage.')));
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        finish(new Error('Codex returned an invalid account usage response.'));
        return;
      }
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const message = safeParseJson(buffer.slice(0, index).trim(), null);
        buffer = buffer.slice(index + 1);
        if (!message || message.id !== (initialized ? 2 : 1)) continue;
        if (message.error) {
          // Do not forward raw server errors or stderr, which may include account data.
          finish(new Error('Codex account usage is unavailable. Try refreshing or signing in again.'));
          return;
        }
        if (!Object.hasOwn(message, 'result')) continue;
        if (!initialized) {
          initialized = true;
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else {
          finish(null, message.result);
          return;
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'hikari', title: 'Hikari', version: '1' } } });
  });
}

async function requestCodexCliUsage({ runtime, readRateLimits = readCodexRateLimits, ...options } = {}) {
  runtime ||= await prepareCodexRuntime(options);
  const result = await readRateLimits({ ...options, ...runtime });
  return { ok: true, ...usageFromCodexRateLimits(result) };
}

module.exports = { readCodexRateLimits, requestCodexCliUsage, usageFromCodexRateLimits };
