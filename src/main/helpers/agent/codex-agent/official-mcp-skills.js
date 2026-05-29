'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const OFFICIAL_MCP_SKILL_MARKER = 'HIKARI_OFFICIAL_MCP_SKILL';

function buildSkillMarkdown({ id = '', name = '', description = '', body = '' } = {}) {
  return [
    '---',
    `name: "${name}"`,
    `description: "${description}"`,
    '---',
    '',
    `<!-- ${OFFICIAL_MCP_SKILL_MARKER}:${id} -->`,
    '',
    body.trim(),
    ''
  ].join('\n');
}

const OFFICIAL_MCP_SKILLS = Object.freeze([
  Object.freeze({
    id: 'protocol-generation',
    directory: 'hikari-protocol-generation',
    content: buildSkillMarkdown({
      id: 'protocol-generation',
      name: 'hikari-protocol-generation',
      description: 'Use Hikari MCP protocol_generation to normalize complete protocol JSON and queue protocol saves for user approval.',
      body: `
# Hikari Protocol Generation MCP

Use this skill when the user asks Codex to prepare, normalize, add, save, or import a wet-lab protocol for Hikari.

Workflow:

1. Build or collect a complete protocol JSON object first. Include a clear \`name\`, \`purpose\`, \`materials\`, and non-empty \`steps\`.
2. Call the direct Hikari MCP tool \`protocol_generation\`.
3. Set \`save: true\` only when the user explicitly asks to add, save, import, or persist the protocol. Hikari will queue user approval before adding it to Protocols.
4. Use the tool result as the source of truth for normalized protocol fields and approval status.

Do not call \`protocol_generation\` with prose alone. The MCP tool normalizes protocol JSON; it does not author missing protocol content internally.
`
    })
  }),
  Object.freeze({
    id: 'notebook-draft',
    directory: 'hikari-notebook-draft',
    content: buildSkillMarkdown({
      id: 'notebook-draft',
      name: 'hikari-notebook-draft',
      description: 'Use Hikari MCP notebook_draft to prepare planned next-experiment notebook drafts for user confirmation.',
      body: `
# Hikari Notebook Draft MCP

Use this skill when the user asks for a planned notebook draft, next experiment plan, workflow follow-up, or future biology notebook page.

Workflow:

1. Prefer local project, protocol, workflow, and notebook context from Hikari MCP tools before guessing.
2. Call the direct Hikari MCP tool \`notebook_draft\`.
3. Include \`project_id\` or \`project_name\` when known. Include \`workflow_id\`, \`protocol_name\`, or \`protocol_candidates\` when the draft should follow a specific workflow or protocol.
4. Include \`evidence_context\` only when evidence was actually loaded from records, literature, or paper analysis.
5. Return the confirmation-ready draft. Do not create or save the notebook page yourself.

If one blocking detail is missing, ask the user through the Hikari clarification flow instead of inventing values.
`
    })
  })
]);

function getCodexWorkspaceSkillRoot(workspacePath = '') {
  const root = String(workspacePath || '').trim();
  if (!root) {
    return '';
  }
  return path.join(root, CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME);
}

async function releaseOfficialMcpSkillsForWorkspace(workspacePath = '') {
  const skillRootPath = getCodexWorkspaceSkillRoot(workspacePath);
  return releaseOfficialMcpSkills(skillRootPath);
}

async function releaseOfficialMcpSkills(skillRootPath = '') {
  const root = String(skillRootPath || '').trim();
  if (!root) {
    return [];
  }
  await fs.mkdir(root, { recursive: true });
  const releases = [];
  for (const skill of OFFICIAL_MCP_SKILLS) {
    releases.push(await releaseOfficialMcpSkill(root, skill));
  }
  return releases.filter(Boolean);
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
  if (existing !== skill.content) {
    await fs.writeFile(skillPath, skill.content, 'utf8');
  }
  return { path: skillPath, status: 'released' };
}

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  OFFICIAL_MCP_SKILLS,
  getCodexWorkspaceSkillRoot,
  releaseOfficialMcpSkills,
  releaseOfficialMcpSkillsForWorkspace
};
