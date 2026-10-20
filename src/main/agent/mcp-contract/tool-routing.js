'use strict';

// One independently selectable route per tool. Keep prerequisite tools out of
// route text: each remains discoverable when another tool is disabled.
const HIKARI_MCP_TOOL_ROUTES = Object.freeze({
  inventory_lookup: 'Find personal samples, proteins or physical containers: "Where is my GFP sample?", "What samples do I have?" Search saved inventory; scratch values and chemical stock are different resources.',
  chemical_lookup: 'Check local chemical/reagent amounts, CAS, supplier or storage: "Do we have imidazole?", "Where is the NaCl?" A local no-match says nothing about vendor stock.',
  notebook_lookup: 'Find or read saved experimental notes, results or a specific notebook page: "What happened in the last purification?" Retrieve full page detail when needed; report incomplete storage access.',
  notebook_list: 'List notebook titles or pages by project, state or date: "Show all experiments from last week." Follow pagination and access coverage before claiming a complete list; do not use a capped search as a full list.',
  protocol_lookup: 'Find or reuse an existing saved lab procedure: "Show our Ni-NTA purification method." Search by purpose or step text as well as the name; do not fabricate a local protocol.',
  protocol_generation: 'Practical wet-lab how-to, recipe or preparation: "How to make 1L 10x PBS". Author complete protocol JSON and submit with save: true for review, even without "protocol", "generate" or "save" in the request. Respect text-only requests; use save: false for an unsaved structured preview. If a saved procedure may already cover it, retrieve and reuse that instead of queueing a near-duplicate.',
  notebook_draft: 'Plan a new experiment/page: "Set up tomorrow\'s purification", "Put this method in my notebook." Prepare a reviewable planned page with known values; generate a missing protocol first when necessary. Reuse the returned draft id for refinements.',
  notebook_suggest: 'Only in the background notebook_suggestion workflow: submit zero to five evidence-grounded next experiments through suggestions. Use this instead of interactive page drafting; no paper downloads or approval questions in this run.',
  notebook_append: 'Enrich the active notebook page: "Add buffer preparation notes to this experiment." Read supplied notebook-page context, then propose new evidence-backed content for approval; do not create another page or replace the existing record.',
  literature_search: 'Find external research papers, recent literature or paper-backed evidence: "Find studies on VHH thermostability." Pass the full research objective in message and a compact query; resume a running research_id until completion.',
  paper_download: 'Save a paper PDF into Hikari: "Download this DOI." Use the paper title and destination collection; reuse the same DOI/title and collection to check a running job. A browser download or link alone does not save a paper into Hikari.',
  paper_analysis: 'Read or explain a particular paper, findings, figures or methods: "Summarize this paper", "How did they measure binding?" Pass the complete analytical question and paper reference; answer from returned source lines, separating analysis comments from saved annotations.',
  paper_intake_search_summaries: 'Find an already-ingested paper by topic, title, DOI or finding: "Which saved paper discussed molecular glues?" Search local intake records; use library scope when appropriate and treat lexical matches as candidates.',
  paper_intake_search_experiments: 'Find published experiments by assay, condition, technique or outcome: "Which saved papers tested knockouts in HEK293?" This searches extracted paper experiments, not the user\'s notebook records.',
  paper_experiments_sql: 'Exact filters, joins, counts or grouped comparisons over extracted paper experiments: "Count assays by technique in my library." Use read-only SELECT and inspect truncation; constrain to current project membership explicitly when requested.',
  paper_intake_list_project_summaries: 'Review papers attached to a project: "What have we read for this project?" Resolve the project and list saved summaries; respect reported coverage and truncation.',
  purchase_recommendation: 'Source products, vendors, prices, cheaper alternatives or in-stock options: "Where can I buy 6-8 kDa dialysis tubing in stock?" Include specifications, stock, shipping and budget constraints in query. Call before recommending; native search may verify missing vendor details afterward. Never places orders.',
  memory: 'Recall or retain durable preferences/facts across chats: "Remember this preference for next time", "Forget that preference." Use the right project/global scope; forget by exact id or key. Current settings need no rediscovery and temporary scratch values are not long-term memory.',
  workspace_files: 'Read, search or change ordinary workspace files: "Find this text in my files", "Update this CSV." Start with status, use relative paths and granted locations, read before editing and submit the returned hash; use dedicated tools for managed records.',
  container: 'Hold or reuse an exact temporary string/number: "Keep this value for the next calculation", "Replace characters in this stored sequence." Use short runtime IDs; this is scratch storage, not physical inventory or durable memory.',
  assay_table: 'Calculate, summarize, normalize, fit or transform data: "Average replicates", "Blank-correct this plate." Create a scratch table from supplied rows or active Assay TSV before table calculations; preserve missing cells and keep calculated results traceable.',
  assay_plot: 'Change the active native Assay plot: "Make this axis logarithmic", "Color the controls red", "Add a threshold line." Read its current style/revision, then update with assay_id, expected_revision and request_id; styling does not change measurements or analysis.',
  plugin_canvas: 'Draw or edit within an installed canvas plugin: "Rearrange this illustration", "Add a label to this diagram." Resolve plugin_id from app context, read its contract, edit, render and inspect as required; a textual drawing description does not update the canvas.',
  plotly_graph: 'Create or revise a custom chat figure: "Plot this dose-response", "Add error bars to that graph." Use actual table/calculation data and canonical figure arguments, then inspect after creation/update. This is a scratch graph, separate from the native Assay plot.',
  image_output: 'Show a saved analysis image in chat: "Display the plot PNG." Publish the real storage-workspace file and descriptive alt text; a path in prose does not display it. This tool displays existing images, not generated artwork or remote vendor image URLs.',
  html_output: 'Interactive explanations, calculators, sliders, filters or data explorers in chat: "Let me vary the dilution factor." Author a complete self-contained HTML document and publish it; code pasted in the answer does not create the interactive preview.',
  sequence_list: 'Browse available saved/temporary DNA records: "What plasmids do I have?" Apply requested filters and pagination; listing does not read an entire construct.',
  sequence_search: 'Locate a construct, feature, DNA fragment or protein substring: "Find plasmids containing this sequence." Choose the explicit name/feature/DNA/protein search mode, then read the selected record before editing.',
  sequence_get: 'Inspect a DNA construct, annotations or ORFs: "Show this plasmid\'s features." Retrieve the exact entry, current revision and feature references; request full sequence or ORFs explicitly when needed.',
  sequence_feature_edit: 'Insert, replace or delete an annotated feature/DNA feature: "Replace this promoter", "Annotate this region." Read revision-bound references first, explicitly choose annotation_only or sequence_and_annotation, and submit a temporary derivative.',
  sequence_protein_parts: 'Choose available Protein Builder tags, linkers, domains or codon profiles: "Which His tags can I add?" Discover catalog IDs instead of inventing parts.',
  sequence_protein_build: 'Assemble an ordered protein chain/fusion: "Build His-tag, linker, then my protein." Use catalog/local/custom blocks and explicit codon choices; build the reusable construct rather than only describing it.',
  sequence_protein_get: 'Read a CDS/ORF as numbered amino acids and codons: "What residue is at position 42?" Use N-to-C residue numbering and returned expected amino acids before protein edits.',
  sequence_protein_edit: 'Mutate, insert, delete or replace a protein region: "Make K42A", "Add this tag at the N terminus." Read current protein/revision references, verify expected residues and submit operations as a temporary derivative.',
  sequence_mutagenesis_primers: 'Design cloning/mutagenesis primers for a recorded derivative: "Design primers for this mutation." Create/read the intended derivative first, compare feasible routes, and report template assumptions; never orders primers.',
  ask_user: 'One genuinely blocking choice cannot be inferred: ask a focused question with options. Return its final_response and end the turn; the next message resumes the task. Do not use this for routine defaults or repeat an answered clarification.'
});

// Sent with each chat turn, never in the MCP server instructions (Codex shows
// those only as tool-description data). Resumed turns pass compact: their
// session already holds the full routes, so only names are refreshed.
function buildHikariToolRoutingInstructionLines({ enabledToolNames, compact = false } = {}) {
  const enabled = Array.isArray(enabledToolNames) ? new Set(enabledToolNames) : null;
  const routes = Object.entries(HIKARI_MCP_TOOL_ROUTES).filter(([name]) => !enabled || enabled.has(name));
  const routeLines = !compact
    ? routes.map(([name, instruction]) => `- \`${name}\`: ${instruction}`)
    : routes.length
      ? [`- Available workflows this turn: ${routes.map(([name]) => `\`${name}\``).join(', ')}. Their full routes were given earlier in this session.`]
      : [];
  return [
    'Hikari workflow routing (apply before answering):',
    '- For interactive Hikari chat, infer the intended outcome from the latest request, ongoing conversation, and active view, including informal wording and the user\'s language. A question can request an action. Users do not need to name tools or app modules. Follow-ups such as "a cheaper one", "only in stock", or "make it 500 mL" retain the relevant prior workflow and constraints. Direct JSON-only utility calls follow their caller schema.',
    '- When the intended outcome matches an available workflow below, use that tool before the final answer; prose or native web search alone does not perform an app action. Use supplied context and already-sufficient results first; do not repeat reads or successful submissions just to satisfy a route. For mixed tasks, complete the necessary chain: retrieve sources, calculate/build, then submit/display. Choose tools by the requested object and operation, not by matching a keyword in quoted text, a paper, or a hypothetical example.',
    ...routeLines,
    '- Answer conceptual explanations, general discussion, and isolated arithmetic directly when no app workflow is requested. Preparation details supporting a notebook append, paper explanation, or another scoped task belong in that requested workflow; do not also create a protocol unless requested. Respect explicit user limits, tool availability, active-view scope, and background-task restrictions; never invoke a disabled tool or create an unrelated artifact. Ask only for a genuinely blocking detail, using safe stated defaults for routine choices.',
    '- Before finishing, check that every requested app outcome has a successful tool result or an honestly reported blocker. Approval-pending means ready for review, not saved. If a required tool fails or is unavailable, explain the limitation and label any prose fallback; never imply the app action completed.'
  ];
}

module.exports = { HIKARI_MCP_TOOL_ROUTES, buildHikariToolRoutingInstructionLines };
