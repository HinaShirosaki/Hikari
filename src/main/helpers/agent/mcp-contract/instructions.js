'use strict';

const HIKARI_CODEX_MCP_TOOL_PREFIX = 'mcp__hikari__';

const HIKARI_MCP_TOOL_NAMES = Object.freeze([
  'inventory_lookup',
  'chemical_lookup',
  'record_lookup',
  'protocol_lookup',
  'protocol_generation',
  'notebook_draft',
  'notebook_generation',
  'notebook_lookup',
  'literature_search',
  'paper_download',
  'paper_analysis',
  'paper_intake_search_summaries',
  'paper_intake_search_experiments',
  'paper_intake_list_project_summaries',
  'purchase_recommendation',
  'memory',
  'container',
  'assay_table',
  'plotly_graph',
  'ask_user'
]);

function buildHikariCodexMcpToolName(toolName = '') {
  return `${HIKARI_CODEX_MCP_TOOL_PREFIX}${String(toolName || '').trim()}`;
}

function buildHikariAgentMcpInstructionBodyLines() {
  const toolName = buildHikariCodexMcpToolName;
  return [
    'This MCP server is the Hikari app contract. Codex exposes this server\'s tools with the `mcp__hikari__` prefix. Use the prefixed Codex tool names for local Hikari data, protocols, notebooks, inventory, papers, memory, and structured app actions.',
    '',
    'Use the first-class prefixed MCP tools below as the complete Hikari app tool surface for this server.',
    '',
    'Direct Hikari MCP tools:',
    `- \`${toolName('inventory_lookup')}\`: search local inventory items, chemicals, personal containers, and samples.`,
    `- \`${toolName('chemical_lookup')}\`: search local chemical records by name, CAS, supplier, or storage hint.`,
    `- \`${toolName('record_lookup')}\`: search local projects, protocols, notebooks, workflows, gels, papers, and linked historical records; do not use it to provide active Assay data.`,
    `- \`${toolName('protocol_lookup')}\`: search local protocols through Hikari protocol matching.`,
    `- \`${toolName('protocol_generation')}\`: normalize a complete protocol JSON object into the app import format; set \`save: true\` in the same call to queue Hikari user approval for adding it to the Protocols module.`,
    `- \`${toolName('notebook_draft')}\`: prepare a planned biology notebook draft for explicit confirmation before creating a notebook page.`,
    `- \`${toolName('notebook_generation')}\`: generate a protocol-based notebook draft from selected protocol and project context.`,
    `- \`${toolName('notebook_lookup')}\`: search local notebook entries by project, protocol, result text, or identifier.`,
    `- \`${toolName('literature_search')}\`: find papers, download selected PDFs when possible, write paper markdown, and load bounded paper context blocks.`,
    `- \`${toolName('paper_download')}\`: download a paper PDF into Hikari storage.`,
    `- \`${toolName('paper_analysis')}\`: summarize or extract methods from a specific paper.`,
    `- \`${toolName('paper_intake_search_summaries')}\`: search one-sentence summaries in the paper-intake knowledge base.`,
    `- \`${toolName('paper_intake_search_experiments')}\`: search structured experiment entries extracted during paper intake.`,
    `- \`${toolName('paper_intake_list_project_summaries')}\`: list paper-intake summaries for papers attached to a project.`,
    `- \`${toolName('purchase_recommendation')}\`: search and rank purchasable products.`,
    `- \`${toolName('memory')}\`: recall, remember, forget, and list sparse long-term memory records.`,
    `- \`${toolName('container')}\`: store, name, read, copy, update, and position-edit temporary string or number containers with short runtime IDs.`,
    `- \`${toolName('assay_table')}\`: create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.`,
    `- \`${toolName('plotly_graph')}\`: create, update, read, and inspect Plotly.js graph specifications from Plotly figure arguments.`,
    `- \`${toolName('ask_user')}\`: prepare one blocking clarification question with suggested answer options and optional custom text input for Hikari to render.`,
    '',
    'Tool-use rules:',
    '- Prefer local Hikari records through direct MCP tools before guessing from conversation context.',
    `- Use \`${toolName('record_lookup')}\` when local lookup needs records beyond the specialized inventory, protocol, notebook, paper, or assay tools; active Assay data comes from Assay rail context and \`${toolName('assay_table')}\`, not record lookup.`,
    `- Use \`${toolName('literature_search')}\` for finding papers, references, recent literature, or external scientific evidence.`,
    `- Use \`${toolName('paper_download')}\` when the user explicitly asks to download a paper PDF into app storage, or when a workflow needs a local PDF for deeper reading.`,
    `- Use \`${toolName('paper_analysis')}\` when the user asks to summarize a specific paper, extract findings, explain methods, or pull protocol-relevant details from paper text.`,
    `- Use \`${toolName('paper_intake_search_summaries')}\` or \`${toolName('paper_intake_search_experiments')}\` when already-ingested papers are enough and a full paper read is unnecessary.`,
    `- Use \`${toolName('paper_intake_list_project_summaries')}\` for a project-scoped roll-up of ingested paper summaries.`,
    `- Use \`${toolName('container')}\` for temporary exact string or number storage, especially when a value should be named, reused, copied, or edited by string position without turning it into long-term memory.`,
    `- Use \`${toolName('assay_table')}\` when assay data should be transformed into a reusable table with arithmetic, summaries, grouped statistics, or Python-backed calculations.`,
    `- Use \`${toolName('plotly_graph')}\` when the user asks for a graph, chart, or custom visualization; call \`inspect\` after create/update and adjust the Plotly figure before answering when inspection reports issues.`,
    `- Use direct \`${toolName('protocol_generation')}\` only after complete protocol JSON already exists.`,
    `- When the user asks to generate, draft, create, prepare, build, or turn paper/method text into an experimental protocol, author complete protocol JSON first, then call \`${toolName('protocol_generation')}\` with \`save: true\`, then summarize the review-ready protocol.`,
    `- When the user asks to save or add a generated protocol, call \`${toolName('protocol_generation')}\` once with \`save: true\`; Hikari will ask the user to approve or reject the generated protocol.`,
    `- Use direct \`${toolName('notebook_draft')}\` for planned next-experiment notebook drafts.`,
    '',
    'Clarification rule:',
    `When one blocking user answer is required, call \`${toolName('ask_user')}\`. It returns a renderable \`final_response\` payload. Do not wait inside MCP for the human answer; the host app renders the options and sends the user answer as the next turn.`,
    '',
    'Verification rule:',
    'Separate observed evidence from inference. Cite loaded context blocks, local records, and paper records from tool outputs rather than invented source labels.'
  ];
}

function buildHikariAgentMcpInstructions() {
  return [
    '# Hikari Agent MCP Instructions',
    '',
    ...buildHikariAgentMcpInstructionBodyLines()
  ].join('\n');
}

module.exports = {
  HIKARI_CODEX_MCP_TOOL_PREFIX,
  HIKARI_MCP_TOOL_NAMES,
  buildHikariCodexMcpToolName,
  buildHikariAgentMcpInstructionBodyLines,
  buildHikariAgentMcpInstructions
};
