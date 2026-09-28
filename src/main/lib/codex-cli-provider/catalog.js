'use strict';

const { spawn } = require('node:child_process');
const { resolveCodexInvocation } = require('./paths');
const { cleanText, safeParseJson } = require('./utils');

const CODEX_MODEL_LIST_TIMEOUT_MS = 20000;
const EMPTY_CATALOG = Object.freeze({ ok: false, models: [], defaultModel: '', defaultReasoningEffort: '' });

// Hikari ships no model list: Codex says which models the signed-in account may
// use and which one is the default. Kept from the last successful request.
let codexCatalog = EMPTY_CATALOG;
let configuredCodexModel = '';
let configuredCodexReasoningEffort = '';

function normalizeCodexCliModel(model = '') {
  return String(cleanText(model, 120) || '').trim();
}

function normalizeCodexCliReasoningEffort(reasoningEffort = '') {
  return String(cleanText(reasoningEffort, 40) || '').trim().toLowerCase();
}

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
function listCodexModels({ env = process.env, timeoutMs = CODEX_MODEL_LIST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = resolveCodexInvocation(env);
    const child = spawn(invocation.command, [...invocation.argsPrefix, 'app-server'], { env, stdio: 'pipe' });
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

async function requestCodexCliCatalog({ listModels = listCodexModels, ...options } = {}) {
  codexCatalog = catalogFromCodexModelList(await listModels(options));
  return codexCatalog;
}

function getCodexCliCatalog() {
  return codexCatalog;
}

function findCodexCliModelConfig(model = '', catalog = null) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const target = normalizeCodexCliModel(model);
  if (!target) {
    return null;
  }
  return models.find((entry) => entry.id === target) || null;
}

function getCodexCliModel() {
  return configuredCodexModel;
}

function setCodexCliModel(model = '') {
  configuredCodexModel = normalizeCodexCliModel(model);
  return configuredCodexModel;
}

function getCodexCliReasoningEffort() {
  return configuredCodexReasoningEffort;
}

function setCodexCliReasoningEffort(reasoningEffort = '') {
  configuredCodexReasoningEffort = normalizeCodexCliReasoningEffort(reasoningEffort);
  return configuredCodexReasoningEffort;
}

// '' means "no -m": Codex then runs its own current default model.
function resolveCodexCliModel(model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : getCodexCliCatalog();
  const chosen = normalizeCodexCliModel(model) || configuredCodexModel;
  // A saved choice Codex no longer offers would fail every turn; use Codex's default.
  if (chosen && resolvedCatalog.models?.length && !findCodexCliModelConfig(chosen, resolvedCatalog)) {
    return '';
  }
  return chosen;
}

function resolveCodexCliReasoningEffort(reasoningEffort = '', model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : getCodexCliCatalog();
  const resolvedModel = resolveCodexCliModel(model, resolvedCatalog) || resolvedCatalog.defaultModel;
  const modelConfig = findCodexCliModelConfig(resolvedModel, resolvedCatalog);
  const explicitEffort = normalizeCodexCliReasoningEffort(reasoningEffort);

  if (modelConfig?.reasoningEfforts?.length) {
    if (modelConfig.reasoningEfforts.includes(explicitEffort)) {
      return explicitEffort;
    }
    if (modelConfig.reasoningEfforts.includes(configuredCodexReasoningEffort)) {
      return configuredCodexReasoningEffort;
    }
    return modelConfig.defaultReasoningEffort || '';
  }

  return explicitEffort || configuredCodexReasoningEffort;
}

module.exports = {
  catalogFromCodexModelList,
  findCodexCliModelConfig,
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  normalizeCodexCliModel,
  normalizeCodexCliReasoningEffort,
  requestCodexCliCatalog,
  resolveCodexCliModel,
  resolveCodexCliReasoningEffort,
  setCodexCliModel,
  setCodexCliReasoningEffort
};
