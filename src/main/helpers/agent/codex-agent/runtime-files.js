'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ENANA_AGENTS_BLOCK_START,
  ENANA_AGENTS_BLOCK_END,
  buildEnanaCodexAgentsBlock
} = require('./agent-instructions.js');

const CODEX_AGENTS_FILE = 'AGENTS.md';
const ENANA_MCP_CONFIG_START = '# ENANA_MCP_CONFIG_START';
const ENANA_MCP_CONFIG_END = '# ENANA_MCP_CONFIG_END';

function cleanText(value, _maxLength = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function tomlString(value = '') {
  return JSON.stringify(String(value || ''));
}

function resolveEnanaCodexMcpServerPath() {
  return path.join(__dirname, 'mcp-stdio-server.js');
}

function buildEnanaCodexMcpConfigBlock(options = {}) {
  const envEntries = {
    ENANA_CODEX_MCP: '1',
    ...(cleanText(options.workspace, 2400) ? { ENANA_CODEX_WORKSPACE: cleanText(options.workspace, 2400) } : {}),
    ...(cleanText(options.dataFilePath, 2400) ? { ENANA_AGENT_DATA_FILE: cleanText(options.dataFilePath, 2400) } : {}),
    ...(cleanText(options.storagePath, 2400) ? { ENANA_AGENT_STORAGE_PATH: cleanText(options.storagePath, 2400) } : {}),
    ...(cleanText(options.mcpHostUrl || process.env.ENANA_CODEX_MCP_HOST, 2400)
      ? { ENANA_CODEX_MCP_HOST: cleanText(options.mcpHostUrl || process.env.ENANA_CODEX_MCP_HOST, 2400) }
      : {}),
    ...(cleanText(options.mcpToken || process.env.ENANA_CODEX_MCP_TOKEN, 4000)
      ? { ENANA_CODEX_MCP_TOKEN: cleanText(options.mcpToken || process.env.ENANA_CODEX_MCP_TOKEN, 4000) }
      : {})
  };
  const envText = Object.entries(envEntries)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(', ');
  return [
    ENANA_MCP_CONFIG_START,
    '[mcp_servers.enana]',
    'command = "node"',
    `args = [${tomlString(resolveEnanaCodexMcpServerPath())}]`,
    `env = { ${envText} }`,
    ENANA_MCP_CONFIG_END
  ].join('\n');
}

async function ensureEnanaCodexAgentsFile(cwd = '') {
  const safeCwd = cleanText(cwd, 2400);
  if (!safeCwd) {
    return '';
  }
  await fs.mkdir(safeCwd, { recursive: true });
  const agentsPath = path.join(safeCwd, CODEX_AGENTS_FILE);
  const block = buildEnanaCodexAgentsBlock();
  let existing = '';
  try {
    existing = await fs.readFile(agentsPath, 'utf8');
  } catch {
    existing = '';
  }

  let nextContent = '';
  if (existing.includes(ENANA_AGENTS_BLOCK_START) && existing.includes(ENANA_AGENTS_BLOCK_END)) {
    const pattern = new RegExp(
      `${ENANA_AGENTS_BLOCK_START}[\\s\\S]*?${ENANA_AGENTS_BLOCK_END}`,
      'm'
    );
    nextContent = existing.replace(pattern, block);
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

async function ensureEnanaCodexMcpConfig(configPath = '', options = {}) {
  const targetPath = cleanText(configPath, 2400);
  if (!targetPath) {
    return '';
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const block = buildEnanaCodexMcpConfigBlock(options);
  let existing = '';
  try {
    existing = await fs.readFile(targetPath, 'utf8');
  } catch {
    existing = '';
  }

  let nextContent = '';
  if (existing.includes(ENANA_MCP_CONFIG_START) && existing.includes(ENANA_MCP_CONFIG_END)) {
    const pattern = new RegExp(
      `${ENANA_MCP_CONFIG_START}[\\s\\S]*?${ENANA_MCP_CONFIG_END}`,
      'm'
    );
    nextContent = existing.replace(pattern, block);
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
  ENANA_MCP_CONFIG_START,
  ENANA_MCP_CONFIG_END,
  resolveEnanaCodexMcpServerPath,
  buildEnanaCodexMcpConfigBlock,
  ensureEnanaCodexAgentsFile,
  ensureEnanaCodexMcpConfig
};
