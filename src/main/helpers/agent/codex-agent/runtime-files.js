'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  HIKARI_AGENTS_BLOCK_START,
  HIKARI_AGENTS_BLOCK_END,
  ENANA_AGENTS_BLOCK_START,
  ENANA_AGENTS_BLOCK_END,
  buildHikariCodexAgentsBlock
} = require('./agent-instructions.js');

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

function buildHikariCodexMcpConfigBlock(options = {}) {
  const envEntries = {};
  addEnvAlias(envEntries, 'HIKARI_AGENT_MCP', 'ENANA_AGENT_MCP', '1', 40);
  addEnvAlias(envEntries, 'HIKARI_CODEX_MCP', 'ENANA_CODEX_MCP', '1', 40);
  addEnvAlias(envEntries, 'HIKARI_AGENT_MCP_WORKSPACE', 'ENANA_AGENT_MCP_WORKSPACE', options.workspace, 2400);
  addEnvAlias(envEntries, 'HIKARI_CODEX_WORKSPACE', 'ENANA_CODEX_WORKSPACE', options.workspace, 2400);
  addEnvAlias(envEntries, 'HIKARI_AGENT_DATA_FILE', 'ENANA_AGENT_DATA_FILE', options.dataFilePath, 2400);
  addEnvAlias(envEntries, 'HIKARI_AGENT_STORAGE_PATH', 'ENANA_AGENT_STORAGE_PATH', options.storagePath, 2400);
  const mcpHostUrl = options.mcpHostUrl
    || process.env.HIKARI_AGENT_MCP_HOST
    || process.env.ENANA_AGENT_MCP_HOST
    || process.env.HIKARI_CODEX_MCP_HOST
    || process.env.ENANA_CODEX_MCP_HOST;
  const mcpToken = options.mcpToken
    || process.env.HIKARI_AGENT_MCP_TOKEN
    || process.env.ENANA_AGENT_MCP_TOKEN
    || process.env.HIKARI_CODEX_MCP_TOKEN
    || process.env.ENANA_CODEX_MCP_TOKEN;
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
  const envText = Object.entries(envEntries)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(', ');
  return [
    HIKARI_MCP_CONFIG_START,
    '[mcp_servers.hikari]',
    'command = "node"',
    `args = [${tomlString(resolveHikariCodexMcpServerPath())}]`,
    `env = { ${envText} }`,
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
  resolveHikariCodexMcpServerPath,
  resolveEnanaCodexMcpServerPath,
  buildHikariCodexMcpConfigBlock,
  buildEnanaCodexMcpConfigBlock,
  ensureHikariCodexAgentsFile,
  ensureEnanaCodexAgentsFile,
  ensureHikariCodexMcpConfig,
  ensureEnanaCodexMcpConfig
};
