'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  buildHikariMcpToolName
} = require('../mcp-contract/instructions.js');

const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const OFFICIAL_MCP_SKILL_MARKER = 'HIKARI_OFFICIAL_MCP_SKILL';
const PROTOCOL_GENERATION_TOOL_NAME = buildHikariMcpToolName('protocol_generation');
const NOTEBOOK_DRAFT_TOOL_NAME = buildHikariMcpToolName('notebook_draft');
const PAPER_INTAKE_SEARCH_SUMMARIES_TOOL_NAME = buildHikariMcpToolName('paper_intake_search_summaries');
const PAPER_INTAKE_SEARCH_EXPERIMENTS_TOOL_NAME = buildHikariMcpToolName('paper_intake_search_experiments');
const PAPER_INTAKE_LIST_PROJECT_SUMMARIES_TOOL_NAME = buildHikariMcpToolName('paper_intake_list_project_summaries');
const CONTAINER_TOOL_NAME = buildHikariMcpToolName('container');
const ASSAY_TABLE_TOOL_NAME = buildHikariMcpToolName('assay_table');
const PLOTLY_GRAPH_TOOL_NAME = buildHikariMcpToolName('plotly_graph');

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
    id: 'paper-intake',
    directory: 'hikari-paper-intake',
    content: buildSkillMarkdown({
      id: 'paper-intake',
      name: 'hikari-paper-intake',
      description: 'Use immediately after a paper PDF is ingested into `knowledgebase/papers.md/{paper_id}/{paper-title}.md` to classify the document, produce a one-sentence summary, and list every experiment. Falls back to extracted figures or the original PDF only when the markdown is insufficient.',
      body: `
# Hikari Paper Intake

Trigger this skill the first time a freshly uploaded paper PDF lands as a title-named Markdown file under \`knowledgebase/papers.md/<paper_id>/\`. The transfer is what arms the skill: do not run it on user chat, on already-summarized papers, or before the Markdown file exists. Legacy libraries may still use \`paper.md\`.

## Inputs you can rely on

For the active \`<paper_id>\`, the following artifacts are written together:

- \`<paper-title>.md\` — primary Markdown rewrite of the paper (always read the exact path from metadata or tool output first, end to end).
- \`extracted.txt\` — raw text fallback when the markdown elides a section.
- \`meta.json\` — title, authors, DOI, and the source PDF path.
- \`figures/page-<N>-img-<i>.png\` — images extracted from the PDF, one file per figure. The paper Markdown references each one inline, at the section it belongs to, as \`![Figure on page N](figures/page-<N>-img-<i>.png)\`. The relative path in that link is the exact file on disk: open it directly to view that figure. Any figure on a page no section covered is listed under a trailing \`## Figures\` heading instead.
- Original PDF — path is in \`meta.json.source_pdf_path\` (legacy records may use \`pdf_path\`); only open it when text+figures still leave a question unanswered.

## Step 1 — Classify the document

Read the title-named paper Markdown file (and \`meta.json\` if the type is ambiguous). Pick exactly one class:

- **research_paper** — primary report of original experiments or analyses (computational, wet-lab, clinical, simulation). Has a Methods/Experiments section and reports new results.
- **review** — synthesizes prior literature without reporting new experiments. Includes systematic reviews and meta-analyses (meta-analyses are reviews here, not research_paper, even when they compute new statistics).
- **book / book_chapter** — long-form pedagogical or reference text, monograph, edited-volume chapter, or textbook excerpt.
- **other** — preprint commentary, editorial, perspective, thesis abstract, dataset descriptor, retraction notice, etc.

Default to **research_paper** only when a Methods/Experiments section is explicitly present and the paper reports new findings. If unsure between research_paper and review, choose **review**.

## Step 2 — Branch on the class

### research_paper (the main path)

Produce exactly two artifacts in your reply:

1. **One-sentence summary** — a single sentence (no semicolons stacked into multiple clauses, no bullet split) that names: the system/question studied, the core method, and the headline finding.
2. **Experiment list** — every distinct experiment the paper conducts, in the order presented. For each entry include:
   - a short experiment title (e.g., "Knockout viability assay in HEK293"),
   - the technique or assay used,
   - the variables compared or the hypothesis tested,
   - the figure or table that reports the result (e.g., "Fig. 2B", "Table 1"),
   - a one-line outcome.

   Cover ablations, controls run as separate experiments, supplementary experiments referenced in the main text, and computational/simulation experiments. Group sub-panels of the same experiment under one entry; do not invent experiments that are only described as future work.

### review / book / book_chapter / other (the alternative path)

Do **not** produce an experiment list — these documents do not conduct experiments. Instead reply with:

1. **One-sentence summary** — what the document covers and its central thesis or scope.
2. **Structure outline** — the document's own section/chapter headings with a one-line description each, in order.
3. **Notable claims or cited evidence** — up to five bullets, each tagged with the section it appears in.

State the detected class explicitly at the top of your reply (e.g., \`Document type: review\`) so the user can correct a misclassification.

## Step 3 — When to consult figures or the original PDF

Stay in the paper Markdown by default. Escalate only when you have a concrete question the markdown cannot answer:

- Open a file under \`figures/\` when a figure caption is the only place a quantitative result or experimental condition is reported, when reading a panel label is required to attribute results to an experiment, or when the markdown explicitly shows the figure inline and you need to see it to describe the outcome. The inline \`![...](figures/...)\` link already points at the exact image for that spot — read that path; you do not have to guess which file matches.
- Open the original PDF (from \`meta.json.source_pdf_path\`, or legacy \`pdf_path\`) only when the paper Markdown and \`extracted.txt\` both omit content you can see was present in the source (e.g., tables that were dropped, equations rendered as images without alt text, a supplementary section). Read the minimum page range needed.
- Never paste figure pixels or PDF pages into the reply; cite them by path or page number.

## Output rules

- Keep the one-sentence summary literally one sentence.
- Use the paper's own terminology for assay/technique names; do not paraphrase domain terms.
- If a section is missing from the paper Markdown and you did not escalate to the PDF, say so rather than guessing.
- Do not invoke this skill again for the same \`<paper_id>\` unless the markdown was regenerated.
`
    })
  }),
  Object.freeze({
    id: 'paper-retrieval',
    directory: 'hikari-paper-retrieval',
    content: buildSkillMarkdown({
      id: 'paper-retrieval',
      name: 'hikari-paper-retrieval',
      description: `Use Hikari MCP paper-intake retrieval tools to find already-ingested papers, summaries, and experiment entries from the local paper-intake knowledge base before reading full paper markdown.`,
      body: `
# Hikari Paper Retrieval MCP

Use this skill when the user asks about papers that are already in Hikari, asks which ingested paper covers a topic, asks what experiments an ingested paper ran, or asks for a project-level roll-up of previously ingested papers.

Do not use this skill to download new papers. For new external literature search or PDF download, use the literature or paper-download flow first. This skill is for the local paper-intake knowledge base produced after a title-named Markdown file exists under \`KnowledgeBase/papers.md/<paper_id>/\` and the paper-intake summary has been saved.

Direct tools:

- \`${PAPER_INTAKE_SEARCH_SUMMARIES_TOOL_NAME}\` — search ingested paper titles and one-sentence summaries by topic, finding, organism, method, molecule, or concept.
- \`${PAPER_INTAKE_SEARCH_EXPERIMENTS_TOOL_NAME}\` — search structured experiment entries by assay, technique, condition, variable, figure/table reference, or outcome.
- \`${PAPER_INTAKE_LIST_PROJECT_SUMMARIES_TOOL_NAME}\` — list ingested paper summaries attached to a known Hikari project.

Retrieval workflow:

1. Decide the narrowest retrieval mode:
   - Use \`${PAPER_INTAKE_SEARCH_SUMMARIES_TOOL_NAME}\` for "find papers about...", title/topic/finding questions, or when the user wants candidate papers.
   - Use \`${PAPER_INTAKE_SEARCH_EXPERIMENTS_TOOL_NAME}\` for "which paper did assay X?", "find experiments using technique Y", condition/outcome questions, or figure-level experiment lookup.
   - Use \`${PAPER_INTAKE_LIST_PROJECT_SUMMARIES_TOOL_NAME}\` when the user gives a project name, or has an active project, and wants papers attached to that project.
2. For either search tool, use a short keyword \`query\` and preserve technical terms such as assay names, proteins, cell lines, compounds, figure labels, and paper-specific tags. For the project roll-up, pass \`project_name\` when supplied or rely on active-project context; do not add \`query\`.
3. Inspect \`status\`, \`items\`, \`matched_terms\`, \`score\`, \`doc_type\`, \`paper_id\`, \`title\`, \`one_sentence_summary\`, \`experiment\`, and \`source_paths\`.
4. If the returned fields answer the question, answer from the tool result and cite the returned \`paper_id\`, \`title\`, and \`source_paths.paper_md\`.
5. If the user asks for details that are not in the summary or experiment entry, read the returned \`source_paths.paper_md\` from the current workspace before answering. Use \`extracted.txt\`, figures, or the original PDF only when that Markdown file leaves a concrete question unanswered.
6. If no intake item matches, say that the local paper-intake KB had no match. Then ask whether to search external literature or download/ingest a new paper if that would help.

Argument patterns:

- Topic search:
  \`{ "query": "MG-PACE compact degron molecular glue", "limit": 5 }\`
- Experiment search:
  \`{ "query": "phage-assisted continuous evolution SD40", "technique": "phage-assisted continuous evolution", "limit": 5 }\`
- Project roll-up:
  \`{ "project_name": "Atlas", "doc_types": ["research_paper"], "limit": 20 }\`

Answering rules:

- Prefer the paper-intake MCP result over memory or guesses for local paper availability.
- Do not imply a paper is attached to a project unless \`${PAPER_INTAKE_LIST_PROJECT_SUMMARIES_TOOL_NAME}\` or the returned \`project_ids\` supports it.
- Do not claim the full paper supports a detail unless you read the returned \`source_paths.paper_md\` or the detail appears in the returned \`experiment\` or \`one_sentence_summary\`.
- For reviews, books, or non-research documents, do not invent experiments; use \`doc_type\`, \`structure_outline\`, or \`notable_claims\` only when the returned record provides them.
- Keep citations local and concrete: use \`paper_id\`, title, and \`source_paths.paper_md\` rather than invented source labels. Use the paper title, not the raw Markdown basename, as the visible citation label.
`
    })
  }),
  Object.freeze({
    id: 'container',
    directory: 'hikari-container',
    content: buildSkillMarkdown({
      id: 'container',
      name: 'hikari-container',
      description: `Use Hikari MCP ${CONTAINER_TOOL_NAME} for temporary exact string or number containers, short reusable IDs, copied values, and position-based string edits.`,
      body: `
# Hikari Container MCP

Use this skill when a value should be held exactly for later reuse, comparison, or editing during the current Hikari/Codex run. Containers are temporary scratch values, not durable user memory.

Direct tool:

- Call the direct Hikari MCP tool \`${CONTAINER_TOOL_NAME}\`.

Container rules:

- Store only strings or finite numbers.
- Give each useful container a short human-readable \`name\`; the tool assigns the real short \`id\` such as \`1\`, \`2\`, or \`3\`.
- Use returned IDs exactly. Do not invent IDs, UUIDs, or long handles. If unsure, call \`list\` or \`read\` before editing.
- Prefer copied exact values from loaded context, tool output, selected text, files, or the user's message. Avoid directly authoring or retyping long strings or precise numbers into \`value\` when a copy source is available.
- Direct literals are feasible when the value is genuinely supplied in the current message, is tiny and unambiguous, or no machine-readable source exists. In that case, include a \`source\` such as \`"direct_literal:user_message"\`.
- Do not use \`${CONTAINER_TOOL_NAME}\` for durable preferences or project facts; use the Hikari memory tool only for long-term memory.

Actions:

- Create: \`{ "action": "create", "name": "threshold", "value": 0.42, "source": "copied:paper_table_1" }\`
- Read: \`{ "action": "read", "id": "1" }\`
- List: \`{ "action": "list", "limit": 20 }\`
- Update full value: \`{ "action": "update", "id": "1", "value": "new exact value", "source": "copied:user_selection" }\`
- Rename: \`{ "action": "rename", "id": "1", "new_name": "final threshold" }\`
- Delete: \`{ "action": "delete", "id": "1" }\`

String edit workflow:

1. Call \`read\` for the target container unless the exact current string and ID are already in the latest tool result.
2. Count offsets using zero-based indexes; \`start\` is inclusive and \`end\` is exclusive.
3. Call \`replace_range\`, for example \`{ "action": "replace_range", "id": "1", "start": 12, "end": 16, "replacement": "37 C" }\`.
4. Read the returned \`container.value\` as the source of truth after the edit.
`
    })
  }),
  Object.freeze({
    id: 'assay-plotly',
    directory: 'hikari-assay-plotly',
    content: buildSkillMarkdown({
      id: 'assay-plotly',
      name: 'hikari-assay-plotly',
      description: `Use Hikari MCP ${ASSAY_TABLE_TOOL_NAME} and ${PLOTLY_GRAPH_TOOL_NAME} to turn assay data into calculated tables and inspectable Plotly.js graphs.`,
      body: `
# Hikari Assay Table and Plotly MCP

Use this skill when the user asks to calculate, summarize, normalize, compare, graph, or re-plot assay data. It is especially useful inside the Assay right rail, where the active plate/results context is supplied automatically.

Direct tools:

- \`${ASSAY_TABLE_TOOL_NAME}\` — create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.
- \`${PLOTLY_GRAPH_TOOL_NAME}\` — create, update, read, and inspect Plotly.js graph specifications from regular Plotly figure arguments.

Table workflow:

1. Start from the active assay context or user-provided data and create an original table with \`${ASSAY_TABLE_TOOL_NAME}\`.
   - In the Assay right rail, the active assay context includes TSV blocks such as \`Assay plate data (TSV...)\` and sometimes \`Latest analysis table (TSV)\`.
   - To retrieve the data in a chat turn, find the \`Assay plate data (TSV...)\` block in the hidden context, read the header line, then parse each following non-empty TSV row until the next blank line or section. Each row becomes one object for \`create\`.
   - Convert that TSV into explicit \`rows\` for \`create\`; do not omit \`rows\` and merely refer to the active assay.
   - Preserve the columns \`well\`, \`row\`, \`column\`, \`sample\`, \`concentration\`, and \`result\` when they are present, because downstream calculations and Plotly traces often need the plate location as well as values.
   - If the block says rows exist but no body rows are present, say the active assay context omitted the row data and ask for a refreshed context.
   - Do not use local lookup tools to fetch the active assay plate data; the current plate data must come from the right-rail context TSV or from user-provided rows.
2. Use \`derive\` or \`add_column\` for common calculations: \`+\`, \`-\`, \`*\`, \`/\`, \`max\`, \`min\`, \`avg\`, \`sd\`, \`median\`, \`count\`, \`log10\`, \`ln\`, and \`pow\`.
3. Use row-wise \`operands\` when each row contains replicate columns. Example:
   \`{ "action": "derive", "table_id": "1", "include_source_columns": true, "columns": [{ "name": "avg_response", "op": "avg", "operands": ["rep1", "rep2", "rep3"] }, { "name": "sd_response", "op": "sd", "operands": ["rep1", "rep2", "rep3"] }] }\`
4. Use \`group_by\` plus \`source\` on each calculation-column object for grouped summaries. Example:
   \`{ "action": "derive", "table_id": "1", "group_by": ["condition", "dose"], "columns": [{ "name": "mean", "op": "avg", "source": "response" }, { "name": "sd", "op": "sd", "source": "response" }, { "name": "n", "op": "count", "source": "response" }] }\`
5. Use the \`python\` action only when built-in calculations are not enough. The tool stages \`input_table.json\` and \`tables.json\`; your code must write \`output_table.json\` with \`{ "columns": [...], "rows": [...] }\` or a JSON array of row objects. Prefer \`python3\`; the runtime falls back to \`python\` when needed.

Plotly workflow:

1. Build the table first when calculations, grouping, normalization, or replicate summaries are needed.
2. Call \`${PLOTLY_GRAPH_TOOL_NAME}\` with \`action: "create"\` and canonical Plotly arguments: \`data\`, \`layout\`, and optional \`config\`. Example:
   \`{ "action": "create", "name": "dose response", "data": [{ "type": "scatter", "mode": "markers", "x": [1, 10], "y": [20, 75] }], "layout": { "title": { "text": "Dose response" } }, "config": { "responsive": true, "displaylogo": false } }\`
3. Call \`inspect\` after every \`create\` or meaningful \`update\`. Treat returned \`issues\` and \`suggestions\` as the graph review loop.
4. Use \`update\` to adjust titles, axes, trace names, colors, error bars, log axes, or hover labels before answering.
5. In the final response, report the table id and graph id, and summarize the decisions made during inspection.

Common Plotly settings:

- Title: \`layout.title.text\`, with concise assay name and measurement.
- Axes: \`layout.xaxis.title.text\`, \`layout.yaxis.title.text\`, and \`layout.yaxis.type: "log"\` only when log scaling is scientifically appropriate.
- Scatter/line: \`{ "type": "scatter", "mode": "markers" }\`, \`"lines+markers"\` for trends, and \`marker.size\` around 8-11.
- Bar: \`{ "type": "bar" }\`, \`layout.barmode: "group"\` for side-by-side groups, \`"stack"\` only for additive quantities.
- Error bars: \`error_y: { "type": "data", "array": [...], "visible": true }\` for SD/SEM arrays.
- Dose response: use numeric dose on x, response on y, clear units, and log x-axis only if the dose spacing is logarithmic.
- Hover: set \`hovertemplate\` when well id, condition, dose, or replicate count matters.
- Export/render config: use \`config: { "responsive": true, "displaylogo": false }\` unless the user asks otherwise.

If these common settings are not enough, search the official Plotly.js documentation at the end of your reasoning loop, then return to \`${PLOTLY_GRAPH_TOOL_NAME}\` with the adjusted figure.
`
    })
  }),
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
- \`protocol.steps\`: ordered array of strings or step objects. Include timing, temperature, volumes, concentrations, incubation conditions, controls, and readouts inside the relevant step text. When a value should remain user-fillable, write a bracket placeholder directly in the step text, such as \`[volume]\`, \`[buffer]\`, \`[temperature]\`, or \`[time]\`.
- \`protocol.troubleshooting\`: caveats, quality checks, expected outcomes, failure modes, safety notes, and paper-specific limitations when available.
- \`result_summary\`: one sentence describing what was prepared.
- \`save: true\`: include this when the user asks to add, save, import, persist, or queue the generated protocol for review.

Placeholder usage:

- Produce an executable starting protocol, not a questionnaire. Fill routine, low-risk procedural parameters from evidence; when the source is silent, select a scientifically conventional starting value and identify it in troubleshooting as a recommended starting condition rather than a source-reported fact.
- Do not create placeholders for routine defaults such as replicate count, dilution factor, concentration-series point count, common staining or wash buffer, wash count, incubation time or temperature, acquisition volume, or minimum event target when a reasonable starting value can be selected.
- Reserve placeholders for genuinely user-, reagent-, sample-, or instrument-specific choices that would be unreliable to infer: exact biological sample or clone identity, reagent identity, stock concentration or solvent, affinity tag or catalog-specific reagent, and instrument-specific channel or detector settings.
- In materials, prefer a clear generic category such as \`the user's PD-L1 stable cell line\` over a bracket placeholder that does not map to an executable step.
- Aim for 0-3 unresolved placeholders and do not exceed 5 unless the source explicitly defines more independent choices. If more than 5 would remain, replace routine placeholders with labeled starting defaults or ask one blocking clarification before generation.
- Represent each real decision with one placeholder at its first executable use, then refer to the selected value later without creating duplicate placeholders for the same buffer, sample, or setting.
- Use meaningful placeholder names that match the value the user will fill, for example \`[plasmid identity]\`, \`[stock concentration]\`, or \`[detector channel]\`.
- If supplying structured step objects with explicit placeholder ids, bind each placeholder in \`text\` with \`{{ph:<id>}}\` and include matching \`placeholders: [{ id: "<id>", name: "<display name>" }]\`.
- Do not invent identity-, stock-, or instrument-specific values merely to remove a placeholder. Routine recommended starting conditions are allowed when clearly labeled as recommendations.

Workflow:

1. Gather the source evidence first: active paper markdown, selected methods text, local protocols, records, or user-provided procedure text.
2. Author the complete protocol JSON yourself from that evidence, using labeled starting defaults for routine settings and placeholders only for genuinely specific unresolved decisions.
3. Call \`${PROTOCOL_GENERATION_TOOL_NAME}\` once with \`{ protocol, result_summary, save: true }\` for generated protocols that should enter Hikari review.
4. Read the tool result and use the returned \`protocol\`, \`status\`, \`save_requested\`, and \`requires_user_approval\` fields as the source of truth.
5. Reply in normal assistant prose that the generated protocol is ready for review, and mention the normalized protocol name plus any important caveats or user-fillable placeholders.

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

- \`project_name\`: the selected or resolved Hikari project name when known.
- \`protocol_candidates\`: up to five likely protocol names, with the strongest candidate first.
- \`pending_values\`: known placeholder values. Every key must exactly match a \`placeholder_key\` in \`<step-id>:<placeholder-id>\` form from the normalized protocol or an earlier notebook-draft result; display names are not keys.
- \`step_edits\`: optional draft-only replacements by \`step_number\`, or appended step text when \`step_number\` is omitted. These edits never mutate the saved protocol.
- These are the only supported tool arguments. The host already supplies the current message and project context; do not send \`message\`, \`project_id\`, \`workflow_id\`, \`evidence_context\`, or \`parser_payload\`.

Placeholder fill rules:

- Put actual selected, user-provided, evidence-supported, or deliberately chosen routine starting values in \`pending_values\`. Never fill a placeholder with uncertainty prose such as \`not specified\`, \`unknown\`, or a generic restatement of its label.
- For a newly normalized protocol, derive keys from its returned step ids and placeholder ids: \`<step.id>:<placeholder.id>\`.
- After the first notebook-draft result, inspect \`missing_placeholders\`. If any values are already known or are safe routine starting choices, retry once using their exact returned \`placeholder_key\` values.
- Do not call a draft confirmation-ready while avoidable routine placeholders remain. Aim for 0-3 unresolved choices and review any result with more than 5; ask one blocking clarification only for genuinely sample-, reagent-, or instrument-specific decisions.

Workflow:

1. Resolve the project and experiment target from the selected project, user request, recent workflow state, protocol candidates, and loaded notebook history.
2. Gather local Hikari context first when it matters: protocol candidates, workflow progress, previous notebook results, relevant records, and paper-derived evidence.
3. Call \`${NOTEBOOK_DRAFT_TOOL_NAME}\` using only \`project_name\`, \`protocol_candidates\`, \`pending_values\`, and optional \`step_edits\`.
4. Read the tool result and use \`status\`, \`proposal_summary\`, \`proposal\`, \`notebook\`, \`missing_placeholders\`, and \`follow_up_questions\` as the source of truth.
5. Retry once with exact placeholder keys when known or routine values can be supplied, then return the confirmation-ready draft or the one genuinely blocking follow-up question.

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
