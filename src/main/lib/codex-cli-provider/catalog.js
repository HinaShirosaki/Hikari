'use strict';

const { spawn } = require('node:child_process');
const { cleanText, safeParseJson } = require('./utils');
const { prepareCodexRuntime, normalizeCodexCliModel, normalizeCodexCliReasoningEffort } = require('./runtime-gateway');

const CODEX_MODEL_LIST_TIMEOUT_MS = 20000;
const EMPTY_CATALOG = Object.freeze({ ok: false, models: [], defaultModel: '', defaultReasoningEffort: '' });

// Hikari ships no model list: Codex says which models the signed-in account may
// use and which one is the default. Kept from the last successful request.
let codexCatalog = EMPTY_CATALOG;
let catalogIdentity = '';
let catalogGeneration = 0;

// Maps app-server `model/list` entries to Hikari's catalog shape.
function catalogFromCodexModelList(entries = []) {
  const models = (Array.isArray(entries) ? entries : []).map((entry) => {
    const id = normalizeCodexCliModel(entry?.id || entry?.model);
    if (!id) {
      return null;
    }
    const reasoningEfforts = (Array.isArray(entry?.supportedReasoningEfforts) ? entry.supportedReasoningEfforts : [])
      .map((level) => normalizeCodexCliReasoningEffort(level?.reasoningEffort))
      .filter(Boolean);
    const defaultReasoningEffort = normalizeCodexCliReasoningEffort(entry?.defaultReasoningEffort);
    return {
      id,
      label: cleanText(entry?.displayName, 160) || id,
      hidden: entry?.hidden === true,
      isDefault: entry?.isDefault === true,
      reasoningEfforts,
      defaultReasoningEffort: reasoningEfforts.includes(defaultReasoningEffort) ? defaultReasoningEffort : ''
    };
  }).filter(Boolean);
  const defaultModel = models.find((entry) => entry.isDefault) || null;
  return {
    ok: models.length > 0,
    models,
    defaultModel: defaultModel?.id || '',
    defaultReasoningEffort: defaultModel?.defaultReasoningEffort || ''
  };
}

// Asks `codex app-server` for every model (hidden ones too, so a saved choice such
// as a reserve model still validates) over its JSON-RPC stdio protocol.
function listCodexModels({ env = process.env, invocation, cwd,
  timeoutMs = CODEX_MODEL_LIST_TIMEOUT_MS } = {}) {
  const managedHome = String(env.HIKARI_CODEX_HOME || '').trim();
  if (managedHome) env = { ...env, CODEX_HOME: managedHome };
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.argsPrefix, 'app-server'], { env, cwd, windowsHide: true, stdio: 'pipe' });
    const entries = [];
    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(entries);
    };
    const timer = setTimeout(() => finish(new Error('Codex did not return its model list in time.')), timeoutMs);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const requestPage = (id, cursor) => send({ id, method: 'model/list', params: { includeHidden: true, ...(cursor ? { cursor } : {}) } });
    child.on('error', finish);
    child.stdin.on('error', () => {});
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.on('exit', (code) => finish(new Error(
      `Codex exited (${code}) before listing its models.${stderr.trim() ? ` ${stderr.trim().slice(-400)}` : ''}`
    )));
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const message = safeParseJson(buffer.slice(0, index).trim(), null);
        buffer = buffer.slice(index + 1);
        if (!message || message.id === undefined) continue;
        if (message.error) {
          finish(new Error(cleanText(message.error.message, 400) || 'Codex could not list its models.'));
          return;
        }
        if (message.id === 1) {
          send({ method: 'initialized' });
          requestPage(2);
          continue;
        }
        entries.push(...(Array.isArray(message.result?.data) ? message.result.data : []));
        if (message.result?.nextCursor) requestPage(message.id + 1, message.result.nextCursor);
        else finish();
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'hikari', title: 'Hikari', version: '1' } } });
  });
}

async function requestCodexCliCatalog({ listModels = listCodexModels, runtime, ...options } = {}) {
  let generation = ++catalogGeneration;
  try {
    runtime ||= listModels === listCodexModels ? await prepareCodexRuntime(options) : null;
    generation = ++catalogGeneration;
    const catalog = catalogFromCodexModelList(await listModels({ ...options, ...runtime }));
    if (generation === catalogGeneration) {
      codexCatalog = catalog;
      catalogIdentity = runtime?.identity || '';
    }
    return catalog;
  } catch (error) {
    if (generation === catalogGeneration) { codexCatalog = EMPTY_CATALOG; catalogIdentity = ''; }
    throw error;
  }
}

function getCodexCliCatalog(runtime) {
  if (runtime && runtime.identity !== catalogIdentity) return EMPTY_CATALOG;
  return codexCatalog;
}

function invalidateCodexCliCatalog() {
  codexCatalog = EMPTY_CATALOG;
  catalogIdentity = '';
  catalogGeneration++;
}

module.exports = {
  catalogFromCodexModelList,
  getCodexCliCatalog,
  invalidateCodexCliCatalog,
  normalizeCodexCliModel,
  normalizeCodexCliReasoningEffort,
  requestCodexCliCatalog,
};
