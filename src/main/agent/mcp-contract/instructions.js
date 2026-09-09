'use strict';

const HIKARI_MCP_TOOL_NAMES = Object.freeze([
  'inventory_lookup',
  'chemical_lookup',
  'notebook_lookup',
  'protocol_lookup',
  'protocol_generation',
  'notebook_draft',
  'notebook_suggest',
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
  'sequence_list',
  'sequence_search',
  'sequence_get',
  'sequence_feature_edit',
  'sequence_protein_parts',
  'sequence_protein_build',
  'sequence_protein_get',
  'sequence_protein_edit',
  'sequence_mutagenesis_primers',
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
    '- Square brackets in step text mark placeholders only. Write concentrations as "Ca2+ concentration", not "[Ca2+]", so normalization does not turn notation into a user-fillable value.',
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
    `- \`${toolName('paper_analysis')}\`: read a specific local paper through one Codex sub-agent command and return exact line-backed context, sub-agent relevance comments, and saved local annotations.`,
    `- \`${toolName('paper_intake_search_summaries')}\`: search one-sentence summaries in the paper-intake knowledge base.`,
    `- \`${toolName('paper_intake_search_experiments')}\`: search structured experiment entries extracted during paper intake.`,
    `- \`${toolName('paper_intake_list_project_summaries')}\`: list paper-intake summaries for papers attached to a project.`,
    `- \`${toolName('purchase_recommendation')}\`: search and rank purchasable products.`,
    `- \`${toolName('container')}\`: store, name, list, read, update, and position-edit temporary string or number containers with short runtime IDs and optional source provenance.`,
    `- \`${toolName('assay_table')}\`: create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.`,
    `- \`${toolName('plotly_graph')}\`: create, update, read, and inspect Plotly.js graph specifications from canonical \`data\`, \`layout\`, and optional \`config\` arguments.`,
    `- \`${toolName('ask_user')}\`: prepare one blocking clarification question with suggested answer options and optional custom text input for Hikari to render.`,
    '',
    'Tool-use rules:',
    '- Use active chat/view context before lookup tools. If the current turn includes hidden Assay context, retrieve the active assay data by parsing its `Assay plate data (TSV...)` block directly from the chat prompt.',
    '- For Biology Notebook enrichment, read the complete hidden `notebook-page` context before searching. Treat its entry id, title, protocol steps, filled values, notes, tables, calculations, and linked sample identifiers as the active page state.',
    `- When asked to enrich or append useful information to the active notebook page, use \`${toolName('inventory_lookup')}\` for linked samples or proteins and \`${toolName('chemical_lookup')}\` for local chemical stock. Use native web search for authoritative preparation guidance when needed, and reserve \`${toolName('literature_search')}\` for claims that require research-paper evidence. A no-match means no saved local record was found; it does not prohibit a clearly labeled reference preparation for a standard, independently preparable laboratory solution whose identity is sufficiently defined.`,
    '- A reference preparation is not an inventory record. State its assumptions, chemical form, purity when relevant, target concentration, final volume, solvent, calculation, preparation steps, handling or sterilization, storage, stability, and safety-critical uncertainty. Make it executable from materials recorded on the page, found locally, or available in an ordinary source form. Do not stop at diluting an unverified stock or undefined base solution: include the missing stock or base formula with mass or volume arithmetic and any molecular-weight, density, or purity assumption needed, or identify it as a missing prerequisite and ask one focused question. Prefer one complete formulation over several partial recipes. Never present assumptions as recorded facts, and do not improvise formulas for proprietary mixtures, biological materials, or insufficiently identified substances.',
    `- Keep notebook append content bench-ready: only new actionable information; at most three short subsections and six bullets; normally under about 180 words; no repeated page context, duplicate section-title heading, tables, nested lists, tool names, search queries, failed-lookup transcripts, internal reasoning, or Sources heading. Put any decision-relevant lookup gap in the rationale as one short sentence. Pass one to three unique useful records or authoritative URLs through \`sources\`, excluding failed searches and the hidden page context, with compact labels and details.`,
    `- Call \`${toolName('notebook_append')}\` once only when useful new content is ready. Use the entry id and updated timestamp from hidden page context when available. If nothing safe and useful can be added, answer briefly without proposing an append. The tool proposes an append; it does not modify the lab record.`,
    '- Do not use local lookup tools for active Assay plate/result rows; if assay rows are missing from the hidden TSV, treat it as missing UI context and ask for or await refreshed context.',
    `- Use \`${toolName('notebook_lookup')}\` to discover notebook pages by text, project, protocol, or state. Treat \`access.complete: false\` as incomplete evidence, follow \`access.user_action\` for permission recovery, and never turn a partial lookup into a definitive no-match claim.`,
    `- Use \`${toolName('literature_search')}\` for finding papers, references, recent literature, or external scientific evidence.`,
    `- \`${toolName('literature_search')}\` is search-first: do not expect it to open publisher pages or download new PDFs. To get a local PDF, the user can click the paper download button or you can use \`${toolName('paper_download')}\` per its rule below.`,
    `- For \`${toolName('literature_search')}\`, saved Preferred Journals from the current Hikari settings are already available in the request context. Treat them as soft ranking preferences even when the user says "from my preferred journals" or asks to use saved preferences, and do not pass a hard \`journals\` filter unless the current request explicitly names a restrictive filter such as "only" or "exclusively" those journals.`,
    `- For a normal paper-discovery request, make at most one \`${toolName('literature_search')}\` call. When the request also needs Codex/web discovery, use Hikari API sources (\`pubmed\`, \`crossref\`, and \`europe_pmc\`) in that call and use native Codex web search separately; do not include Hikari's \`web\` source because it would re-enter Codex CLI from inside the active MCP request. Use the returned structured result to answer; do not launch follow-up title or DOI searches through \`${toolName('literature_search')}\` just to compensate for weak candidates unless the user explicitly asks to refine or repeat the search.`,
    '- Background experiment suggestions: when scheduled_task.task_type is notebook_suggestion, use notebook_suggest instead of notebook_draft. This tool is unavailable in all other workflows. Never call paper_download, create protocols, or request user approval in that background run; unknown values remain for review on the Suggested page.',
    `- Interactive paper-search download policy: after \`${toolName('literature_search')}\` returns selected papers, you MUST call \`${toolName('paper_download')}\` once for every distinct selected paper before answering, even when the user asked only to find papers. Pass each result's DOI and candidate PDF URLs when available, pass its title as \`paper_title\`, and pass the original \`literature_search.query\` as \`collection_name\` for every selected paper so one search shares one folder. This policy applies to normal interactive chat only; never download in a background experiment suggestion or metadata-only scheduled task whose context sets \`deny_paper_download: true\`. If a download cannot be completed, report that paper's tool result clearly and never imply it was saved.`,
    `- Use \`${toolName('paper_download')}\` when the user explicitly asks to download a paper PDF into app storage, or when a workflow needs a local PDF for deeper reading.`,
    `- Use \`${toolName('paper_analysis')}\` when the user asks to summarize a specific paper, extract findings, explain methods, or pull protocol-relevant details from paper text. Call it once and answer from \`loaded_context_blocks.source_lines\`. Always pass the user's complete analytical request as \`query\`; after a paper-reference clarification, preserve the earlier analytical request instead of replacing it with the title or DOI answer.`,
    `- Line-backed context blocks returned by \`${toolName('paper_analysis')}\` or \`${toolName('literature_search')}\` carry \`source_lines\`: verbatim application-extracted paper Markdown lines selected by \`line_ranges\`. Never attribute paper claims that are absent from \`source_lines\`. In paper-analysis output, \`analysis_comments\` and each block's \`relevance_reason\` are sub-agent comments explaining why the selected lines matter, while \`related_comments\` are saved local user annotations rather than paper evidence. When the user asks about notes or comments, report both categories separately; an empty \`related_comments\` array does not mean no analysis comments were returned. When citing a local \`source_path\`, use \`paper_title\` as the visible link label instead of the raw Markdown filename.`,
    `- Use \`${toolName('paper_intake_search_summaries')}\` or \`${toolName('paper_intake_search_experiments')}\` when already-ingested papers are enough and a full paper read is unnecessary.`,
    `- Use \`${toolName('paper_intake_list_project_summaries')}\` for a project-scoped roll-up of ingested paper summaries.`,
    `- Use \`${toolName('purchase_recommendation')}\` when the user asks what to buy, wants product or vendor options, price comparisons, or restocking suggestions for purchasable items.`,
    `- Use \`${toolName('container')}\` for temporary exact string or number storage, especially when a value should be named, reused, copied, or edited by string position without turning it into long-term memory.`,
    `- Use \`${toolName('assay_table')}\` when assay data should be transformed into a reusable table with arithmetic, summaries, grouped statistics, or Python-backed calculations.`,
    `- Use \`${toolName('plotly_graph')}\` when the user asks for a graph, chart, or custom visualization; call \`inspect\` after create/update and adjust the Plotly figure before answering when inspection reports issues.`,
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
    'Sequence Viewer rule:',
    'Use sequence_list/sequence_search, then sequence_get to select an exact entry and revision-bound feature reference. Use sequence_protein_get for N-to-C residue numbers and expected amino acids. Protein Builder chains use sequence_protein_parts and sequence_protein_build; apply their construct_id with sequence_protein_edit. Choose mutations from the user objective, never invent an unsupported biological benefit. Feature edits must explicitly select annotation_only or sequence_and_annotation. Every edit creates a temporary derivative and preserves its parent; do not call it saved. Reuse the exact request_id and arguments on retries. Use sequence_mutagenesis_primers after editing, report infeasible routes and hypothetical templates honestly, and use the returned open actions for review.',
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
