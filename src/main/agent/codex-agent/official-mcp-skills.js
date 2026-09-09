'use strict';

const fs = require('node:fs/promises');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const {
  isHikariMcpToolEnabled
} = require('../mcp-contract/tool-availability.js');

const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const OFFICIAL_MCP_SKILL_MARKER = 'HIKARI_OFFICIAL_MCP_SKILL';
const OFFICIAL_SKILLS_ROOT = path.join(__dirname, 'official-skills');
const OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS = Object.freeze({
  'assay-plotly': Object.freeze(['assay_table', 'plotly_graph']),
  container: Object.freeze(['container']),
  'notebook-draft': Object.freeze(['notebook_draft']),
  'paper-retrieval': Object.freeze([
    'paper_intake_search_summaries',
    'paper_intake_search_experiments',
    'paper_intake_list_project_summaries'
  ]),
  'protocol-generation': Object.freeze(['protocol_generation']),
  'sequence-viewer': Object.freeze([
    'sequence_list',
    'sequence_search',
    'sequence_get',
    'sequence_feature_edit',
    'sequence_protein_parts',
    'sequence_protein_build',
    'sequence_protein_get',
    'sequence_protein_edit',
    'sequence_mutagenesis_primers'
  ])
});

function getOfficialMcpSkillId(value = '') {
  const text = typeof value === 'object' && value !== null
    ? String(value.id || value.body || value.content || '')
    : String(value || '');
  if (Object.prototype.hasOwnProperty.call(OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS, text)) {
    return text;
  }
  return text.match(new RegExp(`${OFFICIAL_MCP_SKILL_MARKER}:([a-z0-9-]+)`, 'u'))?.[1] || '';
}

function getOfficialMcpSkillToolRequirements(skill = {}) {
  const id = getOfficialMcpSkillId(skill);
  return OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS[id] || [];
}

function getDisabledOfficialMcpSkillToolNames(skill = {}, context = {}) {
  return getOfficialMcpSkillToolRequirements(skill)
    .filter((toolName) => !isHikariMcpToolEnabled(toolName, context));
}

function isOfficialMcpSkillEnabled(skill = {}, context = {}) {
  return getDisabledOfficialMcpSkillToolNames(skill, context).length === 0;
}

// Skill text lives in official-skills/<directory>/SKILL.md plus any extra
// files it links to; this module only publishes them into a workspace.
function readSkillDirectory(directory) {
  const skillRoot = path.join(OFFICIAL_SKILLS_ROOT, directory);
  const content = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const id = content.match(new RegExp(`${OFFICIAL_MCP_SKILL_MARKER}:([a-z0-9-]+)`, 'u'))?.[1] || '';
  const files = {};
  const collect = (relativeDir) => {
    for (const entry of readdirSync(path.join(skillRoot, relativeDir), { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        collect(relativePath);
      } else if (relativePath !== 'SKILL.md') {
        files[relativePath] = readFileSync(path.join(skillRoot, relativePath), 'utf8');
      }
    }
  };
  collect('.');
  return Object.freeze({
    id,
    directory,
    content,
    files: Object.freeze(files),
    requiredMcpToolNames: getOfficialMcpSkillToolRequirements(id)
  });
}

const OFFICIAL_MCP_SKILLS = Object.freeze(
  readdirSync(OFFICIAL_SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkillDirectory(entry.name))
);

function getCodexWorkspaceSkillRoot(workspacePath = '') {
  const root = String(workspacePath || '').trim();
  if (!root) {
    return '';
  }
  return path.join(root, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME);
}

async function releaseOfficialMcpSkillsForWorkspace(workspacePath = '', context = {}) {
  const skillRootPath = getCodexWorkspaceSkillRoot(workspacePath);
  return releaseOfficialMcpSkills(skillRootPath, context);
}

async function releaseOfficialMcpSkills(skillRootPath = '', context = {}) {
  const root = String(skillRootPath || '').trim();
  if (!root) {
    return [];
  }
  await fs.mkdir(root, { recursive: true });
  const releases = [];
  for (const skill of OFFICIAL_MCP_SKILLS) {
    releases.push(isOfficialMcpSkillEnabled(skill, context)
      ? await releaseOfficialMcpSkill(root, skill)
      : await disableOfficialMcpSkill(root, skill, context));
  }
  return releases.filter(Boolean);
}

async function disableOfficialMcpSkill(skillRootPath, skill, context = {}) {
  const skillPath = path.join(skillRootPath, skill.directory, 'SKILL.md');
  const existing = await fs.readFile(skillPath, 'utf8').catch(() => '');
  if (existing && !existing.includes(`${OFFICIAL_MCP_SKILL_MARKER}:${skill.id}`)) {
    return { path: skillPath, status: 'preserved' };
  }
  if (existing) {
    await fs.unlink(skillPath).catch(() => {});
  }
  return {
    path: skillPath,
    status: 'disabled',
    disabled_mcp_tool_names: getDisabledOfficialMcpSkillToolNames(skill, context)
  };
}

async function releaseOfficialMcpSkill(skillRootPath, skill) {
  const skillDir = path.join(skillRootPath, skill.directory);
  const skillPath = path.join(skillDir, 'SKILL.md');
  let existing = '';
  try {
    existing = await fs.readFile(skillPath, 'utf8');
  } catch {
    existing = '';
  }
  if (existing && !existing.includes(OFFICIAL_MCP_SKILL_MARKER)) {
    return { path: skillPath, status: 'preserved' };
  }
  await fs.mkdir(skillDir, { recursive: true });
  // Publish the referenced guidance before the entrypoint that links to it.
  // A user-owned SKILL.md above preserves the entire skill directory.
  for (const [relativePath, content] of Object.entries(skill.files || {})) {
    const filePath = path.join(skillDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (await fs.readFile(filePath, 'utf8').catch(() => '') !== content) {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
  if (existing !== skill.content) {
    await fs.writeFile(skillPath, skill.content, 'utf8');
  }
  return { path: skillPath, status: 'released' };
}

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS,
  OFFICIAL_MCP_SKILLS,
  getDisabledOfficialMcpSkillToolNames,
  getCodexWorkspaceSkillRoot,
  getOfficialMcpSkillId,
  getOfficialMcpSkillToolRequirements,
  isOfficialMcpSkillEnabled,
  releaseOfficialMcpSkills,
  releaseOfficialMcpSkillsForWorkspace
};
