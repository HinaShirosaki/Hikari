'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  HIKARI_AGENTS_BLOCK_START,
  HIKARI_AGENTS_BLOCK_END,
  buildHikariCodexAgentsBlock
} = require('./agent-instructions.js');
const {
  HIKARI_MCP_TOOL_TIMEOUT_SEC
} = require('../mcp-contract/constants.js');
const {
  getEnabledHikariMcpToolNames
} = require('../mcp-contract/tool-availability.js');
const { resolveCodexMcpNodeBinary } = require('../../lib/codex-cli-provider/runtime-gateway.js');
const { isFilesystemRoot } = require('../../lib/path-safety.js');

const CODEX_AGENTS_FILE = 'AGENTS.md';
const HIKARI_MCP_CONFIG_START = '# HIKARI_MCP_CONFIG_START';
const HIKARI_MCP_CONFIG_END = '# HIKARI_MCP_CONFIG_END';

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function tomlString(value = '') {
  return JSON.stringify(String(value || ''));
}

function tomlStringArray(values = []) {
  return `[${values.map((value) => tomlString(value)).join(', ')}]`;
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function replaceManagedBlock(existing = '', start = '', end = '', block = '') {
  if (!existing.includes(start) || !existing.includes(end)) {
    return '';
  }
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  return existing.replace(pattern, block);
}

function removeManagedBlock(existing = '', start = '', end = '') {
  if (!existing.includes(start) || !existing.includes(end)) {
    return null;
  }
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  return existing.replace(pattern, '').trim();
}

function resolveUnpackedAsarPath(filePath = '') {
  const targetPath = cleanText(filePath);
  return targetPath.replace(/([/\\])app\.asar([/\\])/u, '$1app.asar.unpacked$2');
}

function resolveHikariAgentMcpServerPath() {
  const serverPath = path.join(__dirname, '..', 'mcp-contract', 'stdio-server.js');
  return resolveUnpackedAsarPath(serverPath);
}

function resolveHikariCodexMcpInvocation(options = {}) {
  const configured = cleanText(options.mcpCommandPath || options.commandPath || options.nodeCommand).trim();
  const serverPath = options.serverPath || resolveHikariAgentMcpServerPath();
  if (configured) return { command: configured, args: [serverPath] };

  // Prefer the tested bundled runtime over an unrelated, possibly old Node.
  const electronVersion = options.electronVersion ?? process.versions.electron;
  const executable = options.processExecPath ?? process.execPath;
  const defaultApp = options.defaultApp ?? process.defaultApp;
  if (electronVersion && executable && !defaultApp) {
    return { command: executable, args: ['--hikari-mcp-stdio'] };
  }

  const env = { ...process.env, ...getMcpConfigEnvSource(options) };
  if (options.envPath !== undefined) {
    Object.keys(env).filter((key) => key.toLowerCase() === 'path').forEach((key) => delete env[key]);
    env.PATH = options.envPath;
  }
  const node = resolveCodexMcpNodeBinary(env, options);
  if (node) return { command: node, args: [serverPath] };

  // Standalone Codex does not install Node. Packaged Hikari can run its own
  // MCP-only entry point using Electron's embedded Node, with RunAsNode still
  // disabled. No UI, app services, or single-instance lock are started.
  if (electronVersion && executable) {
    const appPath = options.appPath || path.resolve(__dirname, '..', '..', '..', '..');
    return {
      command: executable,
      args: [...(defaultApp ? [appPath] : []), '--hikari-mcp-stdio']
    };
  }
  throw new Error('Hikari MCP could not find a Node.js runtime. Install Node.js or set HIKARI_NODE_PATH to its executable, then restart Hikari.');
}

function resolveHikariCodexMcpCommandPath(options = {}) {
  return resolveHikariCodexMcpInvocation(options).command;
}

function resolveHikariCodexMcpServerPath() {
  return resolveHikariAgentMcpServerPath();
}

function addEnvEntry(envEntries, hikariKey, value, maxLength = 2400) {
  const text = cleanText(value, maxLength);
  if (!text) {
    return;
  }
  envEntries[hikariKey] = text;
}

function getMcpConfigEnvSource(options = {}) {
  const candidates = [
    options.envOverrides,
    options.mcpEnv,
    options.env
  ];
  return candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
  )) || {};
}

function readFirstEnvValue(envSource = {}, keys = []) {
  for (const key of keys) {
    const value = cleanText(envSource[key]);
    if (value) {
      return value;
    }
  }
  for (const key of keys) {
    const value = cleanText(process.env[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function parseRequestContext(value = '') {
  try {
    const parsed = JSON.parse(cleanText(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function withoutFileCapability(value) {
  if (!value) return '';
  const context = parseRequestContext(value);
  delete context.fileAccessToken;
  return JSON.stringify(context);
}

function buildHikariCodexMcpConfigBlock(options = {}) {
  const envEntries = {};
  const envSource = getMcpConfigEnvSource(options);
  const invocation = resolveHikariCodexMcpInvocation(options);
  addEnvEntry(envEntries, 'HIKARI_AGENT_MCP', '1', 40);
  addEnvEntry(envEntries, 'HIKARI_CODEX_MCP', '1', 40);
  addEnvEntry(envEntries, 'HIKARI_AGENT_MCP_WORKSPACE', options.workspace, 2400);
  addEnvEntry(envEntries, 'HIKARI_CODEX_WORKSPACE', options.workspace, 2400);
  // Bind native-image imports to this managed runtime, never to agent context.
  addEnvEntry(envEntries, 'HIKARI_CODEX_HOME', readFirstEnvValue(envSource, ['HIKARI_CODEX_HOME']), 2400);
  addEnvEntry(envEntries, 'HIKARI_AGENT_DATA_FILE', options.dataFilePath, 2400);
  addEnvEntry(envEntries, 'HIKARI_AGENT_STORAGE_PATH', options.storagePath, 2400);
  const mcpHostUrl = options.mcpHostUrl
    || readFirstEnvValue(envSource, [
      'HIKARI_AGENT_MCP_HOST',
      'HIKARI_CODEX_MCP_HOST'
    ]);
  const mcpToken = options.mcpToken
    || readFirstEnvValue(envSource, [
      'HIKARI_AGENT_MCP_TOKEN',
      'HIKARI_CODEX_MCP_TOKEN'
    ]);
  const agentRequestContext = readFirstEnvValue(envSource, [
    'HIKARI_AGENT_MCP_REQUEST_CONTEXT'
  ]);
  const codexRequestContext = readFirstEnvValue(envSource, [
    'HIKARI_CODEX_REQUEST_CONTEXT'
  ]) || agentRequestContext;
  const requestContext = parseRequestContext(codexRequestContext || agentRequestContext);
  const enabledToolNames = getEnabledHikariMcpToolNames(requestContext);
  addEnvEntry(envEntries, 'HIKARI_AGENT_MCP_HOST', mcpHostUrl, 2400);
  addEnvEntry(envEntries, 'HIKARI_AGENT_MCP_TOKEN', mcpToken, 4000);
  addEnvEntry(envEntries, 'HIKARI_CODEX_MCP_HOST', mcpHostUrl, 2400);
  addEnvEntry(envEntries, 'HIKARI_CODEX_MCP_TOKEN', mcpToken, 4000);
  addEnvEntry(envEntries, 'HIKARI_AGENT_MCP_REQUEST_CONTEXT', withoutFileCapability(agentRequestContext || codexRequestContext), 120000);
  addEnvEntry(envEntries, 'HIKARI_CODEX_REQUEST_CONTEXT', withoutFileCapability(codexRequestContext || agentRequestContext), 120000);
  const envText = Object.entries(envEntries)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(', ');
  return [
    HIKARI_MCP_CONFIG_START,
    '[mcp_servers.hikari]',
    'enabled = true',
    'required = true',
    `command = ${tomlString(invocation.command)}`,
    `args = ${tomlStringArray(invocation.args)}`,
    `enabled_tools = ${tomlStringArray(enabledToolNames)}`,
    'default_tools_approval_mode = "approve"',
    'startup_timeout_sec = 30',
    `tool_timeout_sec = ${HIKARI_MCP_TOOL_TIMEOUT_SEC}`,
    `env = { ${envText} }`,
    '',
    '[mcp_servers.hikari.tools.protocol_generation]',
    'approval_mode = "approve"',
    HIKARI_MCP_CONFIG_END
  ].join('\n');
}

async function ensureHikariCodexAgentsFile(cwd = '') {
  const safeCwd = cleanText(cwd);
  if (!safeCwd || isFilesystemRoot(safeCwd)) {
    return '';
  }
  await fs.mkdir(safeCwd, { recursive: true });
  const agentsPath = path.join(safeCwd, CODEX_AGENTS_FILE);
  const block = buildHikariCodexAgentsBlock();
  let existing = '';
  try {
    existing = await fs.readFile(agentsPath, 'utf8');
  } catch {
    existing = '';
  }

  let nextContent = '';
  nextContent = replaceManagedBlock(existing, HIKARI_AGENTS_BLOCK_START, HIKARI_AGENTS_BLOCK_END, block);
  if (nextContent) {
    // Existing managed block was replaced above.
  } else {
    nextContent = existing.trim()
      ? `${existing.replace(/\s+$/u, '')}\n\n${block}\n`
      : `${block}\n`;
  }

  if (nextContent !== existing) {
    await fs.writeFile(agentsPath, nextContent, 'utf8');
  }
  return agentsPath;
}

async function removeHikariCodexAgentsFileIfOnlyManaged(cwd = '') {
  const safeCwd = cleanText(cwd);
  if (!safeCwd || isFilesystemRoot(safeCwd)) {
    return false;
  }
  const agentsPath = path.join(safeCwd, CODEX_AGENTS_FILE);
  let existing = '';
  try {
    existing = await fs.readFile(agentsPath, 'utf8');
  } catch {
    return false;
  }

  const stripped = removeManagedBlock(existing, HIKARI_AGENTS_BLOCK_START, HIKARI_AGENTS_BLOCK_END);
  if (stripped === null) {
    return false;
  }

  if (stripped.trim()) {
    await fs.writeFile(agentsPath, `${stripped.replace(/\s+$/u, '')}\n`, 'utf8');
    return false;
  }

  await fs.rm(agentsPath, { force: true });
  return true;
}

async function ensureHikariCodexMcpConfig(configPath = '', options = {}) {
  const targetPath = cleanText(configPath);
  if (!targetPath) {
    return '';
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const block = buildHikariCodexMcpConfigBlock(options);
  let existing = '';
  try {
    existing = await fs.readFile(targetPath, 'utf8');
  } catch {
    existing = '';
  }

  let nextContent = '';
  nextContent = replaceManagedBlock(existing, HIKARI_MCP_CONFIG_START, HIKARI_MCP_CONFIG_END, block);
  if (nextContent) {
    // Existing managed block was replaced above.
  } else {
    nextContent = existing.trim()
      ? `${existing.replace(/\s+$/u, '')}\n\n${block}\n`
      : `${block}\n`;
  }

  if (nextContent !== existing) {
    await fs.writeFile(targetPath, nextContent, 'utf8');
  }
  return targetPath;
}

module.exports = {
  CODEX_AGENTS_FILE,
  HIKARI_MCP_CONFIG_START,
  HIKARI_MCP_CONFIG_END,
  resolveUnpackedAsarPath,
  resolveHikariAgentMcpServerPath,
  resolveHikariCodexMcpCommandPath,
  resolveHikariCodexMcpInvocation,
  resolveHikariCodexMcpServerPath,
  buildHikariCodexMcpConfigBlock,
  ensureHikariCodexAgentsFile,
  removeHikariCodexAgentsFileIfOnlyManaged,
  ensureHikariCodexMcpConfig
};
