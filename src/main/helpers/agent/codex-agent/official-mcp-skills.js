'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  buildHikariCodexMcpToolName
} = require('../mcp-contract/instructions.js');

const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const OFFICIAL_MCP_SKILL_MARKER = 'HIKARI_OFFICIAL_MCP_SKILL';
const PROTOCOL_GENERATION_TOOL_NAME = buildHikariCodexMcpToolName('protocol_generation');
const NOTEBOOK_DRAFT_TOOL_NAME = buildHikariCodexMcpToolName('notebook_draft');

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
      description: `Use Hikari MCP ${PROTOCOL_GENERATION_TOOL_NAME} to normalize complete protocol JSON and queue protocol saves for user approval.`,
      body: `
# Hikari Protocol Generation MCP

Use this skill when the user asks Codex to prepare, normalize, add, save, or import a wet-lab protocol for Hikari.
Also use it when the user asks to turn paper methods, selected paper text, local records, or a draft procedure into a Protocols-module candidate.

Direct tool:

- Call the direct Hikari MCP tool \`${PROTOCOL_GENERATION_TOOL_NAME}\`.

Protocol JSON checklist:

- \`protocol.name\`: concise protocol title suitable for the Protocols module.
- \`protocol.purpose\`: short experimental goal, including the biological system or assay when known.
- \`protocol.materials\`: array of reagents, samples, equipment, strains, plasmids, cell lines, buffers, and controls supported by the loaded evidence.
- \`protocol.steps\`: ordered array of strings or step objects. Include timing, temperature, volumes, concentrations, incubation conditions, controls, and readouts inside the relevant step text.
- \`protocol.troubleshooting\`: caveats, quality checks, expected outcomes, failure modes, safety notes, and paper-specific limitations when available.
- \`result_summary\`: one sentence describing what was prepared.
- \`save: true\`: include this when the user asks to add, save, import, persist, or queue the generated protocol for review.

Workflow:

1. Gather the source evidence first: active paper markdown, selected methods text, local protocols, records, or user-provided procedure text.
2. Author the complete protocol JSON yourself from that evidence.
3. Call \`${PROTOCOL_GENERATION_TOOL_NAME}\` once with \`{ protocol, result_summary, save: true }\` for generated protocols that should enter Hikari review.
4. Read the tool result and use the returned \`protocol\`, \`status\`, \`save_requested\`, and \`requires_user_approval\` fields as the source of truth.
5. Reply in normal assistant prose that the generated protocol is ready for review, and mention the normalized protocol name plus any important caveats.

The \`${PROTOCOL_GENERATION_TOOL_NAME}\` tool expects complete protocol JSON and returns the normalized protocol fields plus approval status.
`
    })
  }),
  Object.freeze({
    id: 'notebook-draft',
    directory: 'hikari-notebook-draft',
    content: buildSkillMarkdown({
      id: 'notebook-draft',
      name: 'hikari-notebook-draft',
      description: `Use Hikari MCP ${NOTEBOOK_DRAFT_TOOL_NAME} to prepare planned next-experiment notebook drafts for user confirmation.`,
      body: `
# Hikari Notebook Draft MCP

Use this skill when the user asks for a planned notebook draft, next experiment plan, workflow follow-up, or future biology notebook page.

Direct tool:

- Call the direct Hikari MCP tool \`${NOTEBOOK_DRAFT_TOOL_NAME}\`.

Draft context checklist:

- \`message\`: the user's notebook-draft request or planning goal.
- \`project_id\` or \`project_name\`: include the selected or resolved Hikari project when known.
- \`workflow_id\`: include the workflow step identifier when the next experiment should follow a workflow.
- \`protocol_name\` or \`protocol_candidates\`: include likely protocol names when the draft should be based on a protocol.
- \`evidence_context\`: include compact summaries from records, protocol lookup, notebook lookup, literature, or paper analysis that were actually loaded for this turn.
- \`parser_payload\`: include intent/entity hints when the surrounding Hikari run already prepared them.

Workflow:

1. Resolve the project and experiment target from the selected project, user request, recent workflow state, protocol candidates, and loaded notebook history.
2. Gather local Hikari context first when it matters: protocol candidates, workflow progress, previous notebook results, relevant records, and paper-derived evidence.
3. Call \`${NOTEBOOK_DRAFT_TOOL_NAME}\` with the resolved project fields, workflow/protocol hints, and evidence context.
4. Read the tool result and use \`status\`, \`proposal_summary\`, \`proposal\`, \`notebook\`, \`missing_placeholders\`, and \`follow_up_questions\` as the source of truth.
5. Return the confirmation-ready draft for user approval. Include concise next-step context and any follow-up questions reported by the tool.

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
