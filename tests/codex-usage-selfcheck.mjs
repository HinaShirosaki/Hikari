import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createCodexAccountSettings } from '../src/renderer/modules/settings/codex-account.js';
import { createCodexUsageSettings } from '../src/renderer/modules/settings/codex-usage.js';

const require = createRequire(import.meta.url);
const { readCodexRateLimits, requestCodexCliUsage, usageFromCodexRateLimits } = require('../src/main/lib/codex-cli-provider/usage.js');
const { createLlmApi } = require('../src/main/preload/api/llm-api.js');
const { registerSystemIpc } = require('../src/main/ipc/register-system-ipc.js');
const { LLM } = require('../src/shared/ipc/channels.js');
const fiveHour = { usedPercent: 25.5, windowDurationMins: 300, resetsAt: 1900000000 };
const weekly = { usedPercent: 67, windowDurationMins: 10080, resetsAt: 1900400000 };
const limits = { rateLimits: { primary: fiveHour, secondary: weekly } };
assert.deepEqual(usageFromCodexRateLimits(limits), {
  fiveHour: { usedPercent: 25.5, resetsAt: fiveHour.resetsAt },
  weekly: { usedPercent: 67, resetsAt: weekly.resetsAt }
});
assert.equal(usageFromCodexRateLimits({ ...limits, rateLimitsByLimitId: {
  codex: { primary: weekly, secondary: { ...fiveHour, usedPercent: 0 } },
  codex_other: { primary: { ...fiveHour, usedPercent: 90 } }
} }).fiveHour.usedPercent, 0, 'prefer the Codex bucket and identify windows by duration');
for (const empty of [null, {}, { rateLimitsByLimitId: { codex_other: limits.rateLimits } },
  { rateLimits: { limitId: 'codex_other', primary: fiveHour } },
  { rateLimits: { primary: { ...fiveHour, usedPercent: null }, secondary: { ...weekly, usedPercent: NaN } } },
  { rateLimits: { primary: { ...fiveHour, windowDurationMins: 60 } } }]) {
  assert.deepEqual(usageFromCodexRateLimits(empty), { fiveHour: null, weekly: null });
}
assert.equal(usageFromCodexRateLimits({ rateLimits: { primary: { ...fiveHour, usedPercent: -5 } } }).fiveHour.usedPercent, 0);
assert.equal(usageFromCodexRateLimits({ rateLimits: { secondary: { ...weekly, usedPercent: 110 } } }).weekly.usedPercent, 100);

function transportFixture(reply) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  let kills = 0;
  child.kill = () => { kills += 1; };
  const requests = [];
  child.stdin.on('data', chunk => {
    const request = JSON.parse(String(chunk));
    requests.push(request);
    queueMicrotask(() => reply(child, request));
  });
  let launch;
  return { child, requests, get kills() { return kills; }, get launch() { return launch; },
    spawnProcess(...args) { launch = args; return child; } };
}
const runtime = { cwd: '/tmp', env: { HIKARI_CODEX_HOME: '/tmp/hikari-account', CODEX_HOME: '/tmp/other' },
  invocation: { command: 'fixture-node', argsPrefix: ['fixture-codex.js'] } };
const transport = transportFixture((child, request) => {
  if (request.method === 'initialize') child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
  if (request.method === 'account/rateLimits/read') {
    child.stdout.write(`${JSON.stringify({ method: 'account/rateLimits/updated', params: {} })}\n`);
    child.stdout.write(`${JSON.stringify({ id: 99, error: { message: 'unrelated' } })}\n`);
    const response = `${JSON.stringify({ id: 2, result: limits })}\n`;
    child.stdout.write(response.slice(0, 30));
    child.stdout.write(response.slice(30));
  }
});
const usage = await requestCodexCliUsage({ runtime, spawnProcess: transport.spawnProcess });
assert.equal(usage.ok, true);
assert.equal(usage.weekly.usedPercent, 67);
assert.deepEqual(transport.launch.slice(0, 2), ['fixture-node', ['fixture-codex.js', 'app-server']]);
assert.equal(transport.launch[2].env.CODEX_HOME, runtime.env.HIKARI_CODEX_HOME);
assert.deepEqual(transport.requests.map(request => request.method), ['initialize', 'initialized', 'account/rateLimits/read']);
assert.equal(transport.kills, 1, 'stop the status-only process after reading usage');
for (const fail of ['error', 'exit', 'timeout']) {
  const broken = transportFixture((child, request) => {
    if (fail === 'error') child.stdout.write(`${JSON.stringify({ id: request.id, error: { message: 'secret-token' } })}\n`);
    if (fail === 'exit') child.emit('exit', 1);
  });
  await assert.rejects(readCodexRateLimits({ ...runtime, spawnProcess: broken.spawnProcess, timeoutMs: 10 }), error => {
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
  assert.equal(broken.kills, 1);
}

const handlers = new Map();
registerSystemIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
  getCodexCliWorkingDirectory: () => '/tmp/account-fixture', requestCodexCliUsage: async options => {
    assert.equal(options.cwd, '/tmp/account-fixture');
    return usage;
  } });
const api = createLlmApi({ invoke: channel => handlers.get(channel)() });
assert.deepEqual(await api.getCodexLlmUsage(), usage, 'usage traverses the preload and IPC boundary');
registerSystemIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
  getCodexCliWorkingDirectory: () => '/tmp', requestCodexCliUsage: async () => { throw new Error('read failed'); } });
assert.deepEqual(await handlers.get(LLM.CODEX_USAGE)(), { ok: false, error: 'read failed' });

function elements() {
  const rows = Object.fromEntries(['fiveHour', 'weekly'].map(name => [name, {
    value: { textContent: '' }, reset: { textContent: '' },
    progress: { hidden: true, removeAttribute() { this.value = undefined; } },
    querySelector(selector) {
      return { '[data-codex-usage-value]': this.value, '[data-codex-usage-reset]': this.reset, progress: this.progress }[selector];
    }
  }]));
  return { rows, settingCodexUsage: {
    setAttribute(name, value) { this[name] = value; },
    querySelector: selector => rows[selector.match(/"(\w+)"/)[1]]
  }, settingCodexUsageStatus: {}, refreshCodexUsageBtn: {} };
}
globalThis.window = { hikariApi: { getCodexLlmUsage: async () => usage } };
const ui = elements();
let connected = true;
const controller = createCodexUsageSettings({ ...ui, isConnected: () => connected });
await controller.refresh();
assert.equal(ui.rows.fiveHour.value.textContent, '25.5% used');
assert.equal(ui.rows.weekly.progress.value, 67);
assert.match(ui.rows.weekly.reset.textContent, /^Resets /);
assert.equal(ui.settingCodexUsage['aria-busy'], 'false');
assert.equal(ui.refreshCodexUsageBtn.disabled, false);
let resolvePending;
window.hikariApi.getCodexLlmUsage = () => new Promise(resolve => { resolvePending = resolve; });
const pending = controller.refresh();
assert.equal(controller.refresh(), pending, 'coalesce simultaneous usage reads');
await Promise.resolve();
connected = false;
controller.clear();
resolvePending(usage);
await pending;
assert.equal(ui.rows.fiveHour.value.textContent, 'Unavailable', 'late reads do not restore signed-out usage');
assert.equal(ui.refreshCodexUsageBtn.disabled, true);
connected = true;
window.hikariApi.getCodexLlmUsage = () => { throw new Error('bridge failure'); };
await controller.refresh();
assert.match(ui.settingCodexUsageStatus.textContent, /Failed/);
window.hikariApi.getCodexLlmUsage = async () => ({ ok: true, fiveHour: null, weekly: null });
await controller.refresh();
assert.match(ui.settingCodexUsageStatus.textContent, /did not report/);
assert.equal(ui.rows.weekly.progress.hidden, true);
window.hikariApi.getCodexLlmUsage = async () => ({ ok: true, fiveHour: { usedPercent: 0 }, weekly: null });
await controller.refresh();
assert.equal(ui.rows.fiveHour.value.textContent, '0% used');
assert.equal(ui.rows.fiveHour.progress.hidden, false);
assert.equal(ui.rows.fiveHour.reset.textContent, '');

const accountUi = elements();
window.hikariApi.getCodexLlmStatus = async () => ({ ok: true, loggedIn: true, source: 'stored' });
window.hikariApi.clearCodexLlmLogin = async () => ({ ok: true, status: { ok: true, loggedIn: false, source: 'none' } });
window.hikariApi.getCodexLlmUsage = () => new Promise(resolve => { resolvePending = resolve; });
const account = createCodexAccountSettings({ ...accountUi, state: { settings: {} }, persist() {},
  llmModelCatalog: { hasCodexModels: () => true } });
await account.refreshCodexLoginStatus();
const accountPending = account.refreshCodexUsage();
await account.onClearCodexLogin();
resolvePending(usage);
await accountPending;
assert.equal(accountUi.rows.weekly.value.textContent, 'Unavailable');
assert.equal(accountUi.refreshCodexUsageBtn.disabled, true);
assert.match(accountUi.settingCodexUsageStatus.textContent, /Sign in/);
delete globalThis.window;
console.log('Codex usage selfcheck passed: quota mapping, RPC lifecycle, IPC, refresh, errors, and sign-out races.');
