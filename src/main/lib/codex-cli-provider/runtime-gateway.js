'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { ensureCodexCliUpdated } = require('./cli-maintenance');
const { getCodexCliAvailability, resolveCodexBinary, resolveCodexInvocation,
  resolveCodexNodeBinary, resolveWorkingDirectory } = require('./paths');
const { cleanText } = require('./utils');
const exec = promisify(execFile);
const versionCache = new Map();
let configuredCodexModel = '';
let configuredCodexReasoningEffort = '';

function normalizeCodexCliModel(model = '') {
  return String(cleanText(model, 120) || '').trim();
}

function normalizeCodexCliReasoningEffort(reasoningEffort = '') {
  return String(cleanText(reasoningEffort, 40) || '').trim().toLowerCase();
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
function resolveCodexCliModel(model = '') {
  // Preserve the requested model. The selected CLI reports availability errors.
  return normalizeCodexCliModel(model) || configuredCodexModel;
}

function resolveCodexCliReasoningEffort(reasoningEffort = '', model = '', catalog = null) {
  return resolveCodexRequestSelection({ model, reasoningEffort, catalog }).reasoningEffort;
}

function normalizeExecutablePath(binary, options = {}) {
  const fileSystem = options.fs || fs;
  const paths = (options.platform || process.platform) === 'win32' ? path.win32 : path;
  try {
    const real = fileSystem.realpathSync(binary);
    // Multicall shims (Volta, mise) dispatch on their invoked name; keep it.
    const name = (value) => paths.basename(value).toLowerCase();
    return name(real) === name(binary) ? real : paths.resolve(options.cwd || process.cwd(), binary);
  } catch {
    // Preserve an unresolved command so setup reports it; explicit relative
    // paths become absolute and can never change meaning with the request cwd.
    return /[/\\]/u.test(binary) ? paths.resolve(options.cwd || process.cwd(), binary) : binary;
  }
}

function normalizeRuntimeEnvironment(env, options = {}) {
  const normalized = { ...env };
  const paths = (options.platform || process.platform) === 'win32' ? path.win32 : path;
  for (const key of ['HIKARI_CODEX_CLI', 'HIKARI_CODEX_BIN', 'HIKARI_CODEX_NODE_PATH']) {
    let value = String(env[key] || '').trim();
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    if (/^~[/\\]/u.test(value)) value = paths.join(options.homeDir || os.homedir(), value.slice(2));
    if (value) normalized[key] = value;
  }
  return normalized;
}

function resolveCodexRuntimeInvocation(env = process.env, options = {}) {
  env = normalizeRuntimeEnvironment(env, options);
  const binary = normalizeExecutablePath(resolveCodexBinary(env, options), options);
  const invocation = resolveCodexInvocation(env, { ...options, codexBinary: binary });
  return Object.freeze({ command: normalizeExecutablePath(invocation.command, options),
    argsPrefix: Object.freeze(invocation.argsPrefix.map(value => normalizeExecutablePath(value, options))) });
}

function resolveCodexMcpNodeBinary(env = process.env, options = {}) {
  env = normalizeRuntimeEnvironment(env, options);
  return resolveCodexNodeBinary('', env, options)
    || resolveCodexNodeBinary(resolveCodexBinary(env, options), env, options);
}

function runtimeIdentity(env, invocation) {
  // The key changes with login refresh, client replacement or a different home.
  // Hash credentials locally for cache invalidation; never return their bytes.
  let auth = '';
  try { auth = fs.readFileSync(path.join(env.CODEX_HOME, 'auth.json'), 'utf8'); } catch { /* not signed in */ }
  return createHash('sha256').update(JSON.stringify([env.CODEX_HOME, invocation, auth,
    env.HIKARI_CODEX_ACCESS_TOKEN || env.OPENAI_OAUTH_TOKEN || env.CHATGPT_OAUTH_TOKEN || ''])).digest('hex');
}

async function prepareCodexRuntime({ cwd = '', env = process.env, envOverrides = {}, allowMissingCli = false } = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  const modelDefaults = Object.freeze({ model: configuredCodexModel, reasoningEffort: configuredCodexReasoningEffort });
  await ensureCodexCliUpdated();
  // Select before preparing an isolated home, which may have no installed CLI.
  let invocation;
  try {
    invocation = resolveCodexRuntimeInvocation(env);
  }
  catch (error) {
    if (!allowMissingCli || error.code !== 'ENOENT') throw error;
    invocation = { command: resolveCodexBinary(env), argsPrefix: [] };
  }
  const { buildCodexCommandEnv } = require('./runtime-home');
  const baseEnv = await buildCodexCommandEnv(safeCwd, { env, envOverrides });
  baseEnv.CODEX_HOME = normalizeExecutablePath(baseEnv.CODEX_HOME);
  baseEnv.HIKARI_CODEX_HOME = baseEnv.CODEX_HOME;
  const executable = invocation.argsPrefix[0] || invocation.command;
  let stamp = '';
  try { const stat = fs.statSync(executable); stamp = `${stat.size}:${stat.mtimeMs}`; } catch { /* spawn reports the missing CLI */ }
  const versionKey = JSON.stringify([invocation, stamp]);
  if (!versionCache.has(versionKey)) {
    const pending = exec(invocation.command, [...invocation.argsPrefix, '--version'], {
      env: baseEnv, cwd: safeCwd, windowsHide: true, timeout: 10000
    }).then(({ stdout }) => /^codex-cli\s+(\S+)/m.exec(stdout)?.[1] || '').catch(() => '');
    versionCache.set(versionKey, pending);
    if (versionCache.size > 16) versionCache.delete(versionCache.keys().next().value);
  }
  const version = await versionCache.get(versionKey);
  // Context overrides are per request. They cannot select another CLI/home.
  const preparedEnv = { ...baseEnv, ...envOverrides, CODEX_HOME: baseEnv.CODEX_HOME,
    HIKARI_CODEX_HOME: baseEnv.HIKARI_CODEX_HOME };
  const identity = `${runtimeIdentity(preparedEnv, invocation)}:${version}:${stamp}`;
  const availability = getCodexCliAvailability({ ...baseEnv, HIKARI_CODEX_CLI: executable,
    ...(invocation.argsPrefix.length ? { HIKARI_CODEX_NODE_PATH: invocation.command } : {}) });
  return { cwd: safeCwd, env: preparedEnv, invocation, version, identity,
    availability,
    modelDefaults,
    diagnostics: { cliPath: executable, cliVersion: version, codexHome: baseEnv.CODEX_HOME } };
}

function resolveCodexRequestSelection({ runtime, model = '', reasoningEffort = '', catalog } = {}) {
  catalog ||= require('./catalog').getCodexCliCatalog(runtime);
  const defaults = runtime?.modelDefaults || { model: configuredCodexModel, reasoningEffort: configuredCodexReasoningEffort };
  const chosen = normalizeCodexCliModel(model) || defaults.model;
  const explicit = normalizeCodexCliReasoningEffort(reasoningEffort);
  const effort = explicit || defaults.reasoningEffort;
  const config = findCodexCliModelConfig(chosen || catalog.defaultModel, catalog);
  return { model: chosen, reasoningEffort: config?.reasoningEfforts?.length
    ? ([explicit, defaults.reasoningEffort].find(value => config.reasoningEfforts.includes(value)) || config.defaultReasoningEffort || '')
    : effort };
}

module.exports = { prepareCodexRuntime, resolveCodexRequestSelection, resolveCodexRuntimeInvocation, resolveCodexMcpNodeBinary,
  findCodexCliModelConfig, getCodexCliModel, getCodexCliReasoningEffort,
  normalizeCodexCliModel, normalizeCodexCliReasoningEffort,
  resolveCodexCliModel, resolveCodexCliReasoningEffort, setCodexCliModel, setCodexCliReasoningEffort };
