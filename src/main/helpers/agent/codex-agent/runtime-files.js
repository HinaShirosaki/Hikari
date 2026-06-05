'use strict';

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  HIKARI_AGENTS_BLOCK_START,
  HIKARI_AGENTS_BLOCK_END,
  ENANA_AGENTS_BLOCK_START,
  ENANA_AGENTS_BLOCK_END,
  buildHikariCodexAgentsBlock
} = require('./agent-instructions.js');
const {
  HIKARI_MCP_TOOL_NAMES
} = require('../mcp-contract/instructions.js');

const CODEX_AGENTS_FILE = 'AGENTS.md';
const HIKARI_MCP_CONFIG_START = '# HIKARI_MCP_CONFIG_START';
const HIKARI_MCP_CONFIG_END = '# HIKARI_MCP_CONFIG_END';
const ENANA_MCP_CONFIG_START = '# ENANA_MCP_CONFIG_START';
const ENANA_MCP_CONFIG_END = '# ENANA_MCP_CONFIG_END';

function cleanText(value, _maxLength = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function isFilesystemRoot(directoryPath = '') {
  const text = cleanText(directoryPath, 2400).trim();
  if (!text) {
    return false;
  }
  try {
    const resolved = path.resolve(text);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
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
  const targetPath = cleanText(filePath, 2400);
  if (targetPath.includes(`${path.sep}app.asar${path.sep}`)) {
    return targetPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return targetPath;
}

function resolveHikariAgentMcpServerPath() {
  const serverPath = path.join(__dirname, '..', 'mcp-contract', 'stdio-server.js');
  return resolveUnpackedAsarPath(serverPath);
}

function fileIsExecutable(filePath = '') {
  const target = cleanText(filePath, 2400);
  if (!target) {
    return false;
  }
  try {
    fsSync.accessSync(target, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandLooksLikeNode(commandPath = '') {
  return /^node(?:\.exe)?$/iu.test(path.basename(cleanText(commandPath, 2400)));
}

function findExecutableOnPath(commandName = 'node', envPath = process.env.PATH) {
  const command = cleanText(commandName, 240);
  if (!command) {
    return '';
  }
  if (command.includes(path.sep) && fileIsExecutable(command)) {
    return command;
  }
  const pathText = cleanText(envPath, 12000);
  if (!pathText) {
    return '';
  }
  const pathExts = process.platform === 'win32'
    ? cleanText(process.env.PATHEXT, 1200).split(path.delimiter).filter(Boolean)
    : [''];
  for (const dir of pathText.split(path.delimiter)) {
    const cleanDir = cleanText(dir, 2400);
    if (!cleanDir) {
      continue;
    }
    for (const ext of pathExts) {
      const candidate = path.join(cleanDir, `${command}${ext}`);
      if (fileIsExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

function resolveHikariCodexMcpCommandPath(options = {}) {
  const configured = cleanText(
    options.mcpCommandPath
      || options.commandPath
      || options.nodeCommand,
    2400
  );
  if (configured) {
    return configured;
  }
  const envNodeCommand = cleanText(
    process.env.HIKARI_CODEX_NODE_PATH
      || process.env.ENANA_CODEX_NODE_PATH
      || process.env.HIKARI_NODE_PATH
      || process.env.ENANA_NODE_PATH,
    2400
  );
  if (envNodeCommand) {
    return envNodeCommand;
  }
  const processExecPath = Object.prototype.hasOwnProperty.call(options, 'processExecPath')
    ? cleanText(options.processExecPath, 2400)
    : process.execPath;
  if (processExecPath && commandLooksLikeNode(processExecPath)) {
    return processExecPath;
  }
  const pathNode = findExecutableOnPath('node', options.envPath ?? process.env.PATH);
  if (pathNode) {
    return pathNode;
  }
  const commonNodePaths = Array.isArray(options.commonNodePaths)
    ? options.commonNodePaths
    : [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
      '/opt/local/bin/node'
    ];
  return commonNodePaths.find(fileIsExecutable) || 'node';
}

function resolveEnanaCodexMcpServerPath() {
  return resolveHikariAgentMcpServerPath();
}

function resolveHikariCodexMcpServerPath() {
  return resolveHikariAgentMcpServerPath();
}

function addEnvAlias(envEntries, hikariKey, enanaKey, value, maxLength = 2400) {
  const text = cleanText(value, maxLength);
  if (!text) {
    return;
  }
  envEntries[hikariKey] = text;
  envEntries[enanaKey] = text;
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
    const value = cleanText(envSource[key], 120000);
    if (value) {
      return value;
    }
  }
  for (const key of keys) {
    const value = cleanText(process.env[key], 120000);
    if (value) {
      return value;
    }
  }
  return '';
}

function buildHikariCodexMcpConfigBlock(options = {}) {
  const envEntries = {};
  const envSource = getMcpConfigEnvSource(options);
  const commandPath = resolveHikariCodexMcpCommandPath(options);
  addEnvAlias(envEntries, 'HIKARI_AGENT_MCP', 'ENANA_AGENT_MCP', '1', 40);
  addEnvAlias(envEntries, 'HIKARI_CODEX_MCP', 'ENANA_CODEX_MCP', '1', 40);
  addEnvAlias(envEntries, 'HIKARI_AGENT_MCP_WORKSPACE', 'ENANA_AGENT_MCP_WORKSPACE', options.workspace, 2400);
  addEnvAlias(envEntries, 'HIKARI_CODEX_WORKSPACE', 'ENANA_CODEX_WORKSPACE', options.workspace, 2400);
  addEnvAlias(envEntries, 'HIKARI_AGENT_DATA_FILE', 'ENANA_AGENT_DATA_FILE', options.dataFilePath, 2400);
  addEnvAlias(envEntries, 'HIKARI_AGENT_STORAGE_PATH', 'ENANA_AGENT_STORAGE_PATH', options.storagePath, 2400);
  const mcpHostUrl = options.mcpHostUrl
    || readFirstEnvValue(envSource, [
      'HIKARI_AGENT_MCP_HOST',
      'ENANA_AGENT_MCP_HOST',
      'HIKARI_CODEX_MCP_HOST',
      'ENANA_CODEX_MCP_HOST'
    ]);
  const mcpToken = options.mcpToken
    || readFirstEnvValue(envSource, [
      'HIKARI_AGENT_MCP_TOKEN',
      'ENANA_AGENT_MCP_TOKEN',
      'HIKARI_CODEX_MCP_TOKEN',
      'ENANA_CODEX_MCP_TOKEN'
    ]);
  const agentRequestContext = readFirstEnvValue(envSource, [
    'HIKARI_AGENT_MCP_REQUEST_CONTEXT',
    'ENANA_AGENT_MCP_REQUEST_CONTEXT'
  ]);
  const codexRequestContext = readFirstEnvValue(envSource, [
    'HIKARI_CODEX_REQUEST_CONTEXT',
    'ENANA_CODEX_REQUEST_CONTEXT'
  ]) || agentRequestContext;
  addEnvAlias(
    envEntries,
    'HIKARI_AGENT_MCP_HOST',
    'ENANA_AGENT_MCP_HOST',
    mcpHostUrl,
    2400
  );
  addEnvAlias(
    envEntries,
    'HIKARI_AGENT_MCP_TOKEN',
    'ENANA_AGENT_MCP_TOKEN',
    mcpToken,
    4000
  );
  addEnvAlias(
    envEntries,
    'HIKARI_CODEX_MCP_HOST',
    'ENANA_CODEX_MCP_HOST',
    mcpHostUrl,
    2400
  );
  addEnvAlias(
    envEntries,
    'HIKARI_CODEX_MCP_TOKEN',
    'ENANA_CODEX_MCP_TOKEN',
    mcpToken,
    4000
  );
  addEnvAlias(
    envEntries,
    'HIKARI_AGENT_MCP_REQUEST_CONTEXT',
    'ENANA_AGENT_MCP_REQUEST_CONTEXT',
    agentRequestContext || codexRequestContext,
    120000
  );
  addEnvAlias(
    envEntries,
    'HIKARI_CODEX_REQUEST_CONTEXT',
    'ENANA_CODEX_REQUEST_CONTEXT',
    codexRequestContext || agentRequestContext,
    120000
  );
  const envText = Object.entries(envEntries)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(', ');
  return [
    HIKARI_MCP_CONFIG_START,
    '[mcp_servers.hikari]',
    'enabled = true',
    'required = true',
    `command = ${tomlString(commandPath)}`,
    `args = [${tomlString(resolveHikariCodexMcpServerPath())}]`,
    `enabled_tools = ${tomlStringArray(HIKARI_MCP_TOOL_NAMES)}`,
    'default_tools_approval_mode = "approve"',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 120',
    `env = { ${envText} }`,
    '',
    '[mcp_servers.hikari.tools.protocol_generation]',
    'approval_mode = "approve"',
    HIKARI_MCP_CONFIG_END
  ].join('\n');
}

function buildEnanaCodexMcpConfigBlock(options = {}) {
  return buildHikariCodexMcpConfigBlock(options);
}

async function ensureHikariCodexAgentsFile(cwd = '') {
  const safeCwd = cleanText(cwd, 2400);
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
  nextContent = replaceManagedBlock(existing, HIKARI_AGENTS_BLOCK_START, HIKARI_AGENTS_BLOCK_END, block)
    || replaceManagedBlock(existing, ENANA_AGENTS_BLOCK_START, ENANA_AGENTS_BLOCK_END, block);
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
  const safeCwd = cleanText(cwd, 2400);
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

  const stripped = removeManagedBlock(existing, HIKARI_AGENTS_BLOCK_START, HIKARI_AGENTS_BLOCK_END)
    ?? removeManagedBlock(existing, ENANA_AGENTS_BLOCK_START, ENANA_AGENTS_BLOCK_END);
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

async function ensureEnanaCodexAgentsFile(cwd = '') {
  return ensureHikariCodexAgentsFile(cwd);
}

async function ensureHikariCodexMcpConfig(configPath = '', options = {}) {
  const targetPath = cleanText(configPath, 2400);
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
  nextContent = replaceManagedBlock(existing, HIKARI_MCP_CONFIG_START, HIKARI_MCP_CONFIG_END, block)
    || replaceManagedBlock(existing, ENANA_MCP_CONFIG_START, ENANA_MCP_CONFIG_END, block);
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

async function ensureEnanaCodexMcpConfig(configPath = '', options = {}) {
  return ensureHikariCodexMcpConfig(configPath, options);
}

module.exports = {
  CODEX_AGENTS_FILE,
  HIKARI_MCP_CONFIG_START,
  HIKARI_MCP_CONFIG_END,
  ENANA_MCP_CONFIG_START,
  ENANA_MCP_CONFIG_END,
  resolveUnpackedAsarPath,
  resolveHikariAgentMcpServerPath,
  resolveHikariCodexMcpCommandPath,
  resolveHikariCodexMcpServerPath,
  resolveEnanaCodexMcpServerPath,
  buildHikariCodexMcpConfigBlock,
  buildEnanaCodexMcpConfigBlock,
  ensureHikariCodexAgentsFile,
  removeHikariCodexAgentsFileIfOnlyManaged,
  ensureEnanaCodexAgentsFile,
  ensureHikariCodexMcpConfig,
  ensureEnanaCodexMcpConfig
};
