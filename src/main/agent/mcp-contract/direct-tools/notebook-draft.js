'use strict';

const {
  asArray,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  normalizeParserPayload,
  resolveDirectToolPayload,
  runAppTool,
  uniqueStrings
} = require('./shared.js');

const NOTEBOOK_DRAFT_MCP_TOOL = Object.freeze({
  name: 'notebook_draft',
  description: 'Select a protocol from candidates, fill known placeholder values from pending_values, and optionally apply small per-draft step_edits (replace a step by step_number, or append a step), then prepare a planned Hikari biology notebook draft on a copy — never the saved protocol — for explicit user confirmation before any notebook page is created. pending_values keys must exactly match placeholder_key values (placeholder ids); display names are not accepted as keys. Unresolved placeholders are returned as follow-up questions.',
  annotations: Object.freeze({
    title: 'Notebook draft',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project_name: { type: 'string' },
      protocol_candidates: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 20
      },
      pending_values: {
        type: 'object',
        additionalProperties: { type: 'string' }
      },
      step_edits: {
        type: 'array',
        maxItems: 240,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step_number: { type: 'integer', minimum: 1 },
            text: { type: 'string' }
          }
        }
      },
      title: { type: 'string', maxLength: 220 },
      draft_id: { type: 'string', maxLength: 160, description: 'Returned proposal_id to update an existing draft instead of adding another page.' }
    }
  }
});

const SINGLE_DRAFT_SCHEMA = NOTEBOOK_DRAFT_MCP_TOOL.inputSchema;
const BATCH_NOTEBOOK_DRAFT_MCP_TOOL = Object.freeze({
  ...NOTEBOOK_DRAFT_MCP_TOOL,
  description: NOTEBOOK_DRAFT_MCP_TOOL.description + ' For several pages, supply drafts (1–20 items), each with its own title and protocol/values/edits. Omit drafts for one page. Reuse a returned proposal_id as draft_id when refining a page. Every page is reviewed separately; no pages are auto-saved.',
  inputSchema: { ...SINGLE_DRAFT_SCHEMA, properties: {
    ...SINGLE_DRAFT_SCHEMA.properties,
    drafts: { type: 'array', minItems: 1, maxItems: 20, items: SINGLE_DRAFT_SCHEMA }
  } }
});

function normalizeProject(input = {}, context = {}) {
  const contextProject = ensureObject(context.project);
  const projectId = cleanText(
    context.projectId
      || contextProject.id
      || contextProject.project_id
      || contextProject.projectId,
    120
  );
  const projectName = cleanText(
    input.project_name
      || context.projectName
      || contextProject.name
      || contextProject.project_name
      || contextProject.projectName
      || contextProject.title,
    220
  );
  return compactObject({
    id: input.project_name && cleanText(contextProject.name || context.projectName, 220).toLowerCase() !== projectName.toLowerCase()
      ? undefined : projectId,
    name: projectName,
    resolution_source: cleanText(contextProject.resolution_source || contextProject.resolutionSource, 120)
  });
}

async function callNotebookDraft(input = {}, context = {}, deps = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'drafts')) {
    if (!Array.isArray(input.drafts) || input.drafts.length < 1 || input.drafts.length > 20
      || input.drafts.some((item) => !item || typeof item !== 'object' || Array.isArray(item) || 'drafts' in item)) {
      return { ok: false, status: 'invalid_arguments', error: 'Supply 1–20 individual notebook drafts.' };
    }
    const results = [];
    for (const item of input.drafts) {
      try {
        results.push(await callNotebookDraft({ project_name: input.project_name, ...item }, context, deps));
      } catch (error) {
        results.push({ ok: false, status: 'failed', error: String(error?.message || error) });
      }
    }
    const notebooks = results.filter((result) => result.ok && result.notebook?.entry_template).map((result) => result.notebook);
    return {
      ok: notebooks.length > 0, status: notebooks.length === results.length ? 'proposal_ready' : 'partial',
      mcp_tool: 'notebook_draft', app_tool: 'notebook-draft',
      results: results.map(({ notebook, ...result }) => ({ ...result, proposal_id: notebook?.proposal?.proposal_id })), notebooks,
      notebook: notebooks[0] || null,
      summary: `Prepared ${notebooks.length} of ${results.length} notebook drafts for individual review.`
    };
  }
  const project = normalizeProject(input, context);
  const protocolCandidates = uniqueStrings(asArray(input.protocol_candidates), 20);
  const pendingValues = ensureObject(input.pending_values);
  const title = cleanText(input.title, 220);
  const message = [cleanText(context.message, 12000), title ? `Prepare this page: ${title}` : ''].filter(Boolean).join('\n');
  const parserPayload = normalizeParserPayload(context.parserPayload, {
    primary_intent: 'notebook_draft',
    entities: {
      project_id: cleanText(project.id || project.project_id, 120),
      project_name: cleanText(project.name || project.project_name, 220),
      protocol_name: protocolCandidates[0],
      requested_output: 'notebook_draft'
    },
    protocol_candidates: protocolCandidates
  });

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'notebook-draft',
    args: compactObject({
      project,
      protocol_candidates: protocolCandidates,
      pending_values: pendingValues,
      step_edits: asArray(input.step_edits)
    }),
    context: {
      ...context,
      message,
      parserPayload,
      project
    }
  });
  const payload = resolveDirectToolPayload(result);
  const status = cleanText(payload.status || result?.status, 80) || (result?.ok === false ? 'failed' : 'proposal_ready');
  const error = cleanText(payload.error || result?.error, 1200);
  const ok = result?.ok !== false
    && payload.ok !== false
    && !['error', 'failed'].includes(status);

  if (ok && payload.notebook?.entry_template) {
    const notebook = payload.notebook;
    const draftId = cleanText(input.draft_id, 160);
    notebook.proposal = { ...notebook.proposal, ...(title ? { title } : {}), ...(draftId ? { proposal_id: draftId } : {}) };
    if (title) notebook.entry_template.experimentName = title;
    if (draftId) notebook.entry_template.agentDraftMeta = { ...notebook.entry_template.agentDraftMeta, proposalId: draftId };
    payload.proposal = notebook.proposal;
  }

  return compactObject({
    ok,
    status,
    mcp_tool: NOTEBOOK_DRAFT_MCP_TOOL.name,
    app_tool: 'notebook-draft',
    summary: cleanText(payload.summary || result?.summary, 500),
    project_name: cleanText(payload.project_name || payload.projectName, 220),
    selected_protocol: cloneJson(payload.selected_protocol || payload.selectedProtocol, null),
    source_workflow: cloneJson(payload.source_workflow || payload.sourceWorkflow, null),
    missing_placeholders: asArray(payload.missing_placeholders || payload.missingPlaceholders),
    follow_up_questions: uniqueStrings(payload.follow_up_questions || payload.followUpQuestions, 10),
    proposal_summary: cleanText(payload.proposal_summary || payload.proposalSummary, 600),
    proposal: cloneJson(payload.proposal, null),
    notebook: cloneJson(payload.notebook, null),
    error
  });
}

module.exports = {
  NOTEBOOK_DRAFT_MCP_TOOL: BATCH_NOTEBOOK_DRAFT_MCP_TOOL,
  SINGLE_DRAFT_SCHEMA,
  callNotebookDraft,
  normalizeProject
};
