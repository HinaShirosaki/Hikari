'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  releaseOfficialMcpSkills,
  removeOfficialMcpSkills
} = require('../../agent/codex-agent/official-mcp-skills.js');
const {
  ensureHikariCodexAgentsFile,
  removeHikariCodexAgentsFileIfOnlyManaged
} = require('../../agent/codex-agent/runtime-files.js');
const {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME
} = require('./constants');
const {
  isFilesystemRoot,
  resolveCodexCliRuntimeHomeDirectory,
  resolveWorkingDirectory
} = require('./paths');

async function ensureCodexCliAgentsFile(cwd = '') {
  return ensureHikariCodexAgentsFile(resolveWorkingDirectory(cwd));
}

function resolveSkillRequestContext(options = {}) {
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : (options.envOverrides && typeof options.envOverrides === 'object' ? options.envOverrides : {});
  const serialized = env.HIKARI_AGENT_MCP_REQUEST_CONTEXT
    || env.HIKARI_CODEX_REQUEST_CONTEXT
    || '';
  try {
    const parsed = JSON.parse(String(serialized || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Codex always loads $CODEX_HOME/skills, but reads .agents/skills only from
// the cwd up to the nearest .git, so the runtime home is the one folder every
// run (project, no project, scheduled) sees exactly once. Only agent requests
// carry the tool settings, so other CLI commands leave the folder alone.
async function ensureCodexCliSkillFolder(cwd = '', options = {}) {
  const context = resolveSkillRequestContext(options);
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(cwd, options.env || process.env);
  if (!context || !runtimeHome || isFilesystemRoot(runtimeHome)) {
    return '';
  }
  const skillsPath = path.join(runtimeHome, CODEX_SKILLS_FOLDER_NAME);
  await releaseOfficialMcpSkills(skillsPath, context);
  return skillsPath;
}

async function ensureCodexCliWorkingDirectoryGuidance(cwd = '', options = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  await ensureCodexCliSkillFolder(safeCwd, options).catch(() => '');
  // Older builds released skills into the cwd too; Codex listed both copies.
  await removeOfficialMcpSkills(path.join(safeCwd, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME)).catch(() => []);
  // The runtime home owns the durable contract. Remove legacy workspace copies
  // while preserving user-authored guidance and the runtime-home copy itself.
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(safeCwd);
  if (!runtimeHome || path.resolve(safeCwd) !== path.resolve(runtimeHome)) {
    await removeHikariCodexAgentsFileIfOnlyManaged(safeCwd).catch(() => false);
  }
  return '';
}

async function ensureCodexCliGlobalAgentsFile(cwd = '') {
  const runtimeHome = resolveCodexCliRuntimeHomeDirectory(cwd);
  if (!runtimeHome || isFilesystemRoot(runtimeHome)) {
    return '';
  }
  await fs.mkdir(runtimeHome, { recursive: true });
  return ensureHikariCodexAgentsFile(runtimeHome);
}

module.exports = {
  ensureCodexCliAgentsFile,
  ensureCodexCliGlobalAgentsFile,
  ensureCodexCliSkillFolder,
  ensureCodexCliWorkingDirectoryGuidance,
  resolveSkillRequestContext
};
