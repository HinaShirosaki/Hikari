'use strict';

const HIKARI_CODEX_MCP_TOOL_PREFIX = 'mcp__hikari__';

const HIKARI_MCP_TOOL_NAMES = Object.freeze([
  'inventory_lookup',
  'chemical_lookup',
  'notebook_lookup',
  'protocol_lookup',
  'protocol_generation',
  'notebook_draft',
  'notebook_generation',
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
    `- \`${toolName('notebook_lookup')}\`: search local notebook entries by project, protocol, result text, or identifier.`,
    `- \`${toolName('protocol_lookup')}\`: search local protocols through Hikari protocol matching.`,
    `- \`${toolName('protocol_generation')}\`: normalize a complete protocol JSON object into the app import format; set \`save: true\` in the same call to queue Hikari user approval for adding it to the Protocols module.`,
    `- \`${toolName('notebook_draft')}\`: prepare a planned biology notebook draft for explicit confirmation before creating a notebook page.`,
    `- \`${toolName('notebook_generation')}\`: generate a protocol-based notebook draft from selected protocol and project context.`,
    `- \`${toolName('literature_search')}\`: find papers, rank selected candidates, return download-ready metadata, and load bounded context from abstracts or already-ingested paper markdown without starting new PDF downloads automatically.`,
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
    '- Use active chat/view context before lookup tools. If the current turn includes hidden Assay context, retrieve the active assay data by parsing its `Assay plate data (TSV...)` block directly from the chat prompt.',
    '- Do not use local lookup tools for active Assay plate/result rows; if assay rows are missing from the hidden TSV, treat it as missing UI context and ask for or await refreshed context.',
    `- Use \`${toolName('notebook_lookup')}\` when local lookup needs notebook entries by project, protocol, result text, or identifier.`,
    `- Use \`${toolName('literature_search')}\` for finding papers, references, recent literature, or external scientific evidence.`,
    `- \`${toolName('literature_search')}\` is search-first: do not expect it to open publisher pages or download new PDFs. The user can click the paper download button, or you can use \`${toolName('paper_download')}\` only when the user explicitly asks to download a paper.`,
    `- For \`${toolName('literature_search')}\`, saved Preferred Journals from the current Hikari settings are already available in the request context. Treat them as soft ranking preferences even when the user says "from my preferred journals" or asks to use saved preferences. Do not call \`${toolName('memory')}\` just to rediscover them, and do not pass a hard \`journals\` filter unless the current request explicitly names a restrictive filter such as "only" or "exclusively" those journals.`,
    `- For a normal paper-discovery request, make at most one \`${toolName('literature_search')}\` call. When the request also needs Codex/web discovery, use Hikari API sources (\`pubmed\`, \`crossref\`, and \`europe_pmc\`) in that call and use native Codex web search separately; do not include Hikari's \`web\` source because it would re-enter Codex CLI from inside the active MCP request. Use the returned structured result to answer; do not launch follow-up title or DOI searches through \`${toolName('literature_search')}\` just to compensate for weak candidates unless the user explicitly asks to refine or repeat the search.`,
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
