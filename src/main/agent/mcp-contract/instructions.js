'use strict';

const HIKARI_MCP_TOOL_NAMES = Object.freeze([
  'inventory_lookup',
  'chemical_lookup',
  'notebook_lookup',
  'protocol_lookup',
  'protocol_generation',
  'notebook_draft',
  'notebook_append',
  'literature_search',
  'paper_download',
  'paper_analysis',
  'paper_intake_search_summaries',
  'paper_intake_search_experiments',
  'paper_intake_list_project_summaries',
  'purchase_recommendation',
  'container',
  'assay_table',
  'plotly_graph',
  'sequence_viewer',
  'sequence_edit',
  'ask_user'
]);

function buildHikariMcpToolName(toolName = '') {
  return String(toolName || '').trim();
}

function buildProtocolNotebookHandoffInstructionLines() {
  const toolName = buildHikariMcpToolName;
  return [
    '- Generated protocols must be executable starting protocols, not questionnaires. Fill routine, low-risk procedural parameters from loaded evidence; when the source is silent, choose a scientifically conventional starting value and identify it in troubleshooting as a recommended starting condition rather than a source-reported fact.',
    '- Do not create placeholders for routine defaults such as replicate count, dilution factor, concentration-series point count, common staining or wash buffer, wash count, incubation time or temperature, acquisition volume, or minimum event target when a reasonable starting value can be selected.',
    '- Reserve placeholders for genuinely user-, reagent-, sample-, or instrument-specific choices that would be unreliable to infer, such as exact biological sample or clone identity, reagent identity, stock concentration or solvent, affinity tag or catalog-specific reagent, and instrument-specific channel or detector settings. In materials, prefer a clear generic category such as "the user\'s PD-L1 stable cell line" over a bracket placeholder that does not map to an executable step.',
    '- Aim for 0-3 unresolved placeholders and do not exceed 5 unless the source explicitly defines more independent choices. If more than 5 would remain, replace routine placeholders with labeled starting defaults or ask one blocking clarification before generating the protocol.',
    '- Represent each real decision with one placeholder at its first executable use, then refer to the selected value in later steps without creating duplicate placeholders for the same buffer, sample, or setting.',
    `- For a combined protocol-and-notebook request, call \`${toolName('protocol_generation')}\` first and then call \`${toolName('notebook_draft')}\`. The notebook tool accepts only \`project_name\`, \`protocol_candidates\`, \`pending_values\`, and optional \`step_edits\`; do not send \`message\`, \`project_id\`, \`workflow_id\`, \`evidence_context\`, or \`parser_payload\` as tool arguments.`,
    '- Every `pending_values` key must exactly match a `placeholder_key` in `<step-id>:<placeholder-id>` form from the normalized protocol or a prior notebook-draft result. Display names are not keys. Supply actual selected, user-provided, evidence-supported, or deliberately chosen starting values; never use uncertainty text such as "not specified" as a value.',
    `- Inspect \`${toolName('notebook_draft')}\` results. If \`missing_placeholders\` contains values already known or safe routine starting choices, retry once with exact \`placeholder_key\` entries. Do not describe the notebook draft as ready while avoidable routine placeholders remain; ask one blocking question only for the genuinely specific choices that still prevent execution.`
  ];
}

function buildHikariAgentMcpInstructionBodyLines() {
  const toolName = buildHikariMcpToolName;
  return [
    'This MCP server is the Hikari app contract. Use the raw tool names below for local Hikari data, protocols, notebooks, inventory, papers, and structured app actions.',
    '',
    'Use the first-class raw MCP tools below as the complete Hikari app tool surface for this server.',
    '',
    'Direct Hikari MCP tools:',
    `- \`${toolName('inventory_lookup')}\`: search local personal inventory: personal containers and samples (use \`${toolName('chemical_lookup')}\` for chemical stock).`,
    `- \`${toolName('chemical_lookup')}\`: search local chemical records by name, CAS, supplier, or storage hint.`,
    `- \`${toolName('notebook_lookup')}\`: search local notebook pages by text, project, protocol, or state, with agent-safe content and storage-access status.`,
    `- \`${toolName('protocol_lookup')}\`: search local protocols through Hikari protocol matching.`,
    `- \`${toolName('protocol_generation')}\`: normalize a complete protocol JSON object into the app import format; set \`save: true\` in the same call to queue Hikari user approval for adding it to the Protocols module.`,
    `- \`${toolName('notebook_draft')}\`: select a protocol from candidates, fill known placeholder values, and prepare a planned biology notebook draft for explicit confirmation before creating a notebook page.`,
    `- \`${toolName('notebook_append')}\`: prepare an evidence-backed markdown append proposal for the active biology notebook page; Hikari requires explicit confirmation before applying it.`,
    `- \`${toolName('literature_search')}\`: find papers, rank selected candidates, return download-ready metadata, and load bounded paper context blocks from abstracts or already-ingested paper markdown without starting new PDF downloads automatically.`,
    `- \`${toolName('paper_download')}\`: download a paper PDF into Hikari storage.`,
    `- \`${toolName('paper_analysis')}\`: read a specific local paper through one Codex sub-agent command and return exact line-backed context plus related local comments.`,
    `- \`${toolName('paper_intake_search_summaries')}\`: search one-sentence summaries in the paper-intake knowledge base.`,
    `- \`${toolName('paper_intake_search_experiments')}\`: search structured experiment entries extracted during paper intake.`,
    `- \`${toolName('paper_intake_list_project_summaries')}\`: list paper-intake summaries for papers attached to a project.`,
    `- \`${toolName('purchase_recommendation')}\`: search and rank purchasable products.`,
    `- \`${toolName('container')}\`: store, name, list, read, update, and position-edit temporary string or number containers with short runtime IDs and optional source provenance.`,
    `- \`${toolName('assay_table')}\`: create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.`,
    `- \`${toolName('plotly_graph')}\`: create, update, read, and inspect Plotly.js graph specifications from canonical \`data\`, \`layout\`, and optional \`config\` arguments.`,
    `- \`${toolName('sequence_viewer')}\`: read and compute over loaded sequence-viewer records (list, metadata, windowed slices, features, restriction/ORF/translation/GC analysis, compute-only cloning designs). Read-only, 1-based inclusive coordinates.`,
    `- \`${toolName('sequence_edit')}\`: propose a base edit or feature annotation change; returns a preview plus a pending-approval token and never applies the change itself.`,
    `- \`${toolName('ask_user')}\`: prepare one blocking clarification question with suggested answer options and optional custom text input for Hikari to render.`,
    '',
    'Tool-use rules:',
    '- Use active chat/view context before lookup tools. If the current turn includes hidden Assay context, retrieve the active assay data by parsing its `Assay plate data (TSV...)` block directly from the chat prompt.',
    '- For Biology Notebook enrichment, read the complete hidden `notebook-page` context before searching. Treat its entry id, title, protocol steps, filled values, notes, tables, calculations, and linked sample identifiers as the active page state.',
    `- When asked to enrich or append useful information to the active notebook page, use \`${toolName('inventory_lookup')}\` for linked samples or proteins, \`${toolName('chemical_lookup')}\` for local chemical stock, and \`${toolName('literature_search')}\` only when external evidence is actually needed. Never invent a missing concentration, molecular weight, recipe parameter, or source record.`,
    `- Finish active-page enrichment by calling \`${toolName('notebook_append')}\` once with only relevant, concise markdown and the exact records or URLs used as sources. Use the entry id and updated timestamp from hidden page context when available. The tool proposes an append; it does not modify the lab record.`,
    '- Do not use local lookup tools for active Assay plate/result rows; if assay rows are missing from the hidden TSV, treat it as missing UI context and ask for or await refreshed context.',
    `- Use \`${toolName('notebook_lookup')}\` to discover notebook pages by text, project, protocol, or state. Treat \`access.complete: false\` as incomplete evidence, follow \`access.user_action\` for permission recovery, and never turn a partial lookup into a definitive no-match claim.`,
    `- Use \`${toolName('literature_search')}\` for finding papers, references, recent literature, or external scientific evidence.`,
    `- \`${toolName('literature_search')}\` is search-first: do not expect it to open publisher pages or download new PDFs. To get a local PDF, the user can click the paper download button or you can use \`${toolName('paper_download')}\` per its rule below.`,
    `- For \`${toolName('literature_search')}\`, saved Preferred Journals from the current Hikari settings are already available in the request context. Treat them as soft ranking preferences even when the user says "from my preferred journals" or asks to use saved preferences, and do not pass a hard \`journals\` filter unless the current request explicitly names a restrictive filter such as "only" or "exclusively" those journals.`,
    `- For a normal paper-discovery request, make at most one \`${toolName('literature_search')}\` call. When the request also needs Codex/web discovery, use Hikari API sources (\`pubmed\`, \`crossref\`, and \`europe_pmc\`) in that call and use native Codex web search separately; do not include Hikari's \`web\` source because it would re-enter Codex CLI from inside the active MCP request. Use the returned structured result to answer; do not launch follow-up title or DOI searches through \`${toolName('literature_search')}\` just to compensate for weak candidates unless the user explicitly asks to refine or repeat the search.`,
    `- Use \`${toolName('paper_download')}\` when the user explicitly asks to download a paper PDF into app storage, or when a workflow needs a local PDF for deeper reading.`,
    `- Use \`${toolName('paper_analysis')}\` when the user asks to summarize a specific paper, extract findings, explain methods, or pull protocol-relevant details from paper text. Call it once, answer from \`loaded_context_blocks.source_lines\`, and treat \`related_comments\` as local user annotations rather than paper evidence.`,
    `- Use \`${toolName('paper_intake_search_summaries')}\` or \`${toolName('paper_intake_search_experiments')}\` when already-ingested papers are enough and a full paper read is unnecessary.`,
    `- Use \`${toolName('paper_intake_list_project_summaries')}\` for a project-scoped roll-up of ingested paper summaries.`,
    `- Use \`${toolName('purchase_recommendation')}\` when the user asks what to buy, wants product or vendor options, price comparisons, or restocking suggestions for purchasable items.`,
    `- Use \`${toolName('container')}\` for temporary exact string or number storage, especially when a value should be named, reused, copied, or edited by string position without turning it into long-term memory.`,
    `- Use \`${toolName('assay_table')}\` when assay data should be transformed into a reusable table with arithmetic, summaries, grouped statistics, or Python-backed calculations.`,
    `- Use \`${toolName('plotly_graph')}\` when the user asks for a graph, chart, or custom visualization; call \`inspect\` after create/update and adjust the Plotly figure before answering when inspection reports issues.`,
    `- Use \`${toolName('sequence_viewer')}\` to inspect loaded plasmid/sequence records and run restriction/ORF/translation/GC analysis or a compute-only \`design_cloning\` route. Coordinates are 1-based inclusive; read long sequences in <=20 kb windows with \`get_sequence\`.`,
    `- Use \`${toolName('sequence_edit')}\` only to propose base edits or feature annotations; it never applies changes. Read the record first with \`${toolName('sequence_viewer')}\` (which returns the \`target\` identity to echo back), then propose. Hikari renders an approve/reject card and applies only on approval; a \`TARGET_CHANGED\` error means re-read and re-propose.`,
    `- Use direct \`${toolName('protocol_generation')}\` only after complete protocol JSON already exists.`,
    `- When the user asks to generate, draft, create, prepare, build, or turn paper/method text into an experimental protocol, author complete protocol JSON first, then call \`${toolName('protocol_generation')}\` with \`save: true\`, then summarize the review-ready protocol.`,
    `- When the user asks to save or add a generated protocol, call \`${toolName('protocol_generation')}\` once with \`save: true\`; Hikari will ask the user to approve or reject the generated protocol.`,
    `- Use direct \`${toolName('notebook_draft')}\` for planned next-experiment notebook drafts.`,
    `- Use direct \`${toolName('notebook_append')}\` only to enrich the active page; do not use it to create a new page or to replace existing page content.`,
    ...buildProtocolNotebookHandoffInstructionLines(),
    '',
    'Clarification rule:',
    `When one blocking user answer is required, call \`${toolName('ask_user')}\` at most once for that unresolved issue. It returns a renderable \`final_response\` payload. Return that payload and end the current turn; this is a completed waiting state, not a failed or still-running agent. Do not call more tools, repeat the same question, or wait inside MCP. The host app renders the options and sends the answer as the next user turn; treat that latest message as the answer and resume the existing Codex session.`,
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
  HIKARI_MCP_TOOL_NAMES,
  buildHikariMcpToolName,
  buildProtocolNotebookHandoffInstructionLines,
  buildHikariAgentMcpInstructionBodyLines,
  buildHikariAgentMcpInstructions
};
