import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AGENT_AVAILABILITY_EVENT,
  isAgentAvailable,
  isAgentOffline,
  isCodexConnected,
  setAgentAvailability
} from '../src/renderer/lib/agent-availability.js';
import { createAgentChatRail } from '../src/renderer/app/navigation-shell/agent-rail.js';
import { createCodexAccountSettings } from '../src/renderer/modules/settings/codex-account.js';
import { normalizeCodexLoginStatus } from '../src/renderer/modules/settings/llm-model-catalog.js';

const require = createRequire(import.meta.url);

assert.equal(isCodexConnected({ cliAvailable: true, loggedIn: true, source: 'stored' }), true);
assert.equal(isCodexConnected({ loggedIn: false, source: 'stored', expired: true }), false,
  'an expired stored login without refresh capability stays offline');
assert.equal(isCodexConnected({ loggedIn: false, source: 'stored', expired: true, canRefresh: true }), true,
  'an expired stored login with a refresh token stays connected');
assert.equal(isCodexConnected({ loggedIn: true, source: 'env' }), true);
assert.equal(isCodexConnected({ loggedIn: false, source: 'env', expired: true }), false,
  'an expired environment token cannot refresh');
assert.equal(isCodexConnected({ loggedIn: false, source: 'none' }), false);
assert.equal(isCodexConnected({ loggedIn: false, source: 'login_in_progress' }), false);
assert.equal(isCodexConnected({ cliAvailable: false, loggedIn: true, source: 'stored' }), false,
  'a missing Codex CLI disconnects even a stored login');
assert.equal(isCodexConnected(null), false);

function createDocument() {
  const listeners = new Map();
  const elements = new Map();
  const classes = new Set();
  return {
    body: {
      dataset: {},
      classList: {
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name)
      }
    },
    defaultView: { CustomEvent: class { constructor(type) { this.type = type; } } },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { id, dataset: {}, hidden: false, classList: { toggle() {} }, setAttribute() {}, addEventListener() {} });
      }
      return elements.get(id);
    },
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]),
    dispatchEvent: (event) => (listeners.get(event.type) || []).forEach((listener) => listener(event))
  };
}

const doc = createDocument();
let announcements = 0;
doc.addEventListener(AGENT_AVAILABILITY_EVENT, () => { announcements += 1; });
assert.equal(isAgentAvailable(doc), false, 'AI stays hidden before the first status check');
assert.equal(isAgentOffline(doc), false, 'unknown is not offline, so an Agent startup view is not bounced');
setAgentAvailability(false, doc);
setAgentAvailability(false, doc);
assert.equal(isAgentOffline(doc), true);
assert.equal(announcements, 1, 'only a change is announced');

const apps = { 'papers-view': { agentChatRail: true }, 'plugin-x-view': { agentChatRail: true } };
let activeViewId = 'plugin-x-view';
const rail = createAgentChatRail({
  VIEWS: { PAPERS: 'papers-view' },
  documentObject: doc,
  getActiveViewId: () => activeViewId,
  getAppForView: (id) => apps[id] || null,
  resolveNavigationViewId: (id) => id,
  moduleRuntime: { renderAgentChatRail() {} },
  sharedLeftRailRuntime: { syncWidth() {} }
});
const railElement = doc.getElementById('universal-agent-chat-rail');
rail.syncState(activeViewId);
assert.equal(railElement.hidden, true, 'offline: a plugin view loses the chat rail');
activeViewId = 'papers-view';
rail.syncState(activeViewId);
assert.equal(railElement.hidden, false, 'offline: Papers keeps the rail for its PDF tools');
rail.open();
assert.equal(doc.body.classList.contains('has-agent-chat-rail-expanded'), false, 'offline: the chat never expands');
setAgentAvailability(true, doc);
assert.equal(announcements, 2);
assert.equal(rail.syncState(activeViewId), true, 'connecting restores the rail the user asked to open');
activeViewId = 'plugin-x-view';
rail.syncState(activeViewId);
assert.equal(railElement.hidden, false, 'connected: plugin views get the chat rail back');

const css = fs.readFileSync(new URL('../ui/css/base/core.css', import.meta.url), 'utf8');
assert.match(css, /body:not\(\[data-agent-availability="connected"\]\) :is\(\.hikari-agent-action, \[data-requires-agent\]\) \{\s*display: none !important;/,
  'CSS hides every marked AI control until Codex is connected');

const savedDocument = globalThis.document;
const savedWindow = globalThis.window;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-agent-availability-'));
try {
  // Exercise the real status reader and both IPC projections without reading live credentials.
  const { getCodexLoginStatus } = require('../src/main/lib/codex-cli-provider/login.js');
  const { registerSystemIpc } = require('../src/main/ipc/register-system-ipc.js');
  const { LLM } = require('../src/shared/ipc/channels.js');
  const runtime = {
    identity: 'availability-selfcheck', env: { CODEX_HOME: scratch, HIKARI_CODEX_HOME: scratch },
    availability: { cliAvailable: true }, diagnostics: { cliPath: 'fixture' }, version: 'fixture'
  };
  const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.fixture`;
  const readStatus = () => getCodexLoginStatus({ runtime, forceRefresh: true });
  fs.writeFileSync(path.join(scratch, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: accessToken } }));
  let status = await readStatus();
  assert.equal(status.loggedIn, false);
  assert.equal(status.canRefresh, false);
  assert.equal(isCodexConnected(normalizeCodexLoginStatus(status)), false);
  fs.writeFileSync(path.join(scratch, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: accessToken, refresh_token: 'fixture-refresh' } }));
  status = await readStatus();
  assert.equal(status.canRefresh, true);
  assert.equal(isCodexConnected(normalizeCodexLoginStatus(status)), true);
  const handlers = new Map();
  registerSystemIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    getCodexCliWorkingDirectory: () => scratch,
    getCodexLoginStatus: readStatus,
    clearCodexCliStoredLogin: async () => {
      fs.rmSync(path.join(scratch, 'auth.json'));
      return { ok: true };
    }
  });
  assert.equal((await handlers.get(LLM.CODEX_STATUS)()).canRefresh, true);
  const cleared = await handlers.get(LLM.CODEX_CLEAR_LOGIN)();
  assert.equal(cleared.status.canRefresh, false);
  assert.equal(cleared.status.cliAvailable, true);

  const accountDocument = createDocument();
  globalThis.document = accountDocument;
  const online = { ok: true, loggedIn: true, source: 'stored', cliAvailable: true };
  const offline = { ok: true, loggedIn: false, source: 'none', cliAvailable: true };
  const checks = [];
  let completeClear;
  const api = {
    getCodexLlmStatus: () => new Promise((resolve, reject) => checks.push({ resolve, reject })),
    clearCodexLlmLogin: () => new Promise((resolve) => { completeClear = resolve; })
  };
  globalThis.window = { hikariApi: api };
  const checkButton = {};
  const account = createCodexAccountSettings({
    state: { settings: {} }, persist() {}, checkCodexCliBtn: checkButton,
    llmModelCatalog: { hasCodexModels: () => true }
  });
  setAgentAvailability(true);
  const oldCheck = account.refreshCodexLoginStatus();
  const clearing = account.onClearCodexLogin();
  await account.refreshCodexLoginStatus();
  assert.equal(checks.length, 1, 'focus refreshes do not race a pending sign-out');
  checks[0].resolve(online);
  await oldCheck;
  assert.equal(checkButton.disabled, true, 'a stale completion cannot re-enable the status button during sign-out');
  completeClear({ ok: true, status: offline });
  await clearing;
  assert.equal(isAgentOffline(accountDocument), true);

  // A response delivered after sign-out must also remain ignored.
  const lateCheck = account.refreshCodexLoginStatus();
  const secondClear = account.onClearCodexLogin();
  completeClear({ ok: true, status: offline });
  await secondClear;
  checks[1].resolve(online);
  await lateCheck;
  assert.equal(isAgentOffline(accountDocument), true);
  const older = account.refreshCodexLoginStatus();
  const newer = account.refreshCodexLoginStatus();
  checks[3].resolve(online);
  await newer;
  checks[2].reject(new Error('obsolete failure'));
  await older;
  assert.equal(isAgentAvailable(accountDocument), true, 'an obsolete failure does not override newer connected status');
  const failed = account.refreshCodexLoginStatus();
  checks[4].reject(new Error('status unavailable'));
  await failed;
  assert.equal(isAgentOffline(accountDocument), true, 'a current status failure hides AI services');

  const { createPaperImportTransformer } = require('../src/main/core/services/create-paper-import-transformer.js');
  const { transformPaperRecordsToMarkdown } = require('../src/main/papers/parse/paper-markdown-import.js');
  const pdfPath = path.join(scratch, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-fixture');
  const inputs = [];
  const paperRuntime = { ingestPaperPdf: async (input) => {
    inputs.push(input);
    return { ok: true, status: 'ready' };
  } };
  let paperStatus = offline;
  let statusChecks = 0;
  const transform = createPaperImportTransformer({
    getCodexCliWorkingDirectory: () => scratch,
    getCodexLoginStatus: async () => {
      statusChecks += 1;
      if (paperStatus instanceof Error) throw paperStatus;
      return paperStatus;
    },
    paperKnowledgeDatabaseRuntime: paperRuntime
  });
  const batch = { storagePath: scratch, papers: [{ id: 'paper', title: 'Paper', storedFilePath: pdfPath }], skipExistingMarkdown: false };
  await transform({ ...batch, source: 'storage_scan' });
  assert.equal(inputs.at(-1).paper_intake, false, 'offline discovery still extracts the PDF without model intake');
  paperStatus = new Error('status unavailable');
  await transform({ ...batch, source: 'storage_import' });
  assert.equal(inputs.at(-1).paper_intake, false, 'failed status checks preserve local root import');
  paperStatus = online;
  await transform(batch);
  assert.equal(inputs.at(-1).paper_intake, true);
  paperStatus = { ...offline, source: 'stored', expired: true, canRefresh: true };
  await transform(batch);
  assert.equal(inputs.at(-1).paper_intake, true, 'refreshable credentials permit intake');
  paperStatus = { ...paperStatus, canRefresh: false };
  await transform(batch);
  assert.equal(inputs.at(-1).paper_intake, false, 'expired unrefreshable credentials skip intake');
  const beforeExplicitSkip = statusChecks;
  await transform({ ...batch, paperIntake: false });
  assert.equal(statusChecks, beforeExplicitSkip, 'an explicit local-only import does not need an account check');
  assert.equal(inputs.at(-1).paper_intake, false);
  await transformPaperRecordsToMarkdown({ ...batch, paperIntake: false, paperKnowledgeDatabaseRuntime: paperRuntime });
  assert.equal(inputs.at(-1).paper_intake, false, 'the batch API forwards an explicit intake skip');
} finally {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('PASS agent availability: credentials, status races, offline imports, rail state, and CSS gate');
