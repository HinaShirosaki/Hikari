'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  releaseOfficialMcpSkills
} = require('../../agent/codex-agent/official-mcp-skills.js');
const {
  ensureHikariCodexAgentsFile,
  removeHikariCodexAgentsFileIfOnlyManaged
} = require('../../agent/codex-agent/runtime-files.js');
const {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_PROJECT_MEMORY_FILE,
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

async function hasCodexProjectMemoryFile(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  try {
    const stats = await fs.stat(path.join(safeCwd, CODEX_PROJECT_MEMORY_FILE));
    return stats.isFile();
  } catch {
    return false;
  }
}

async function ensureCodexCliProjectSkillFolder(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  if (!safeCwd || isFilesystemRoot(safeCwd)) {
    return '';
  }
  const skillsPath = path.join(safeCwd, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME);
  await fs.mkdir(skillsPath, { recursive: true });
  await releaseOfficialMcpSkills(skillsPath).catch(() => []);
  return skillsPath;
}

async function ensureCodexCliWorkingDirectoryGuidance(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  if (await hasCodexProjectMemoryFile(safeCwd)) {
    await ensureCodexCliProjectSkillFolder(safeCwd).catch(() => '');
    await removeHikariCodexAgentsFileIfOnlyManaged(safeCwd).catch(() => false);
    return '';
  }
  return ensureCodexCliAgentsFile(safeCwd);
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
  ensureCodexCliProjectSkillFolder,
  ensureCodexCliWorkingDirectoryGuidance,
  hasCodexProjectMemoryFile
};
