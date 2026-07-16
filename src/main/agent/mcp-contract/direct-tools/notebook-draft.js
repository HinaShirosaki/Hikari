'use strict';

const {
  asArray,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  normalizeParserPayload,
  runAppTool,
  uniqueStrings
} = require('./shared.js');

const NOTEBOOK_DRAFT_MCP_TOOL = Object.freeze({
  name: 'notebook_draft',
  description: 'Select a protocol from candidates, fill known placeholder values from pending_values, and optionally apply small per-draft step_edits (replace a step by step_number, or append a step), then prepare a planned Hikari biology notebook draft on a copy — never the saved protocol — for explicit user confirmation before any notebook page is created. pending_values keys must exactly match placeholder_key values in <step-id>:<placeholder-id> form; display names are not accepted as keys. Unresolved placeholders are returned as follow-up questions.',
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
        maxItems: 5
      },
      pending_values: {
        type: 'object',
        additionalProperties: { type: 'string' }
      },
      step_edits: {
        type: 'array',
        maxItems: 60,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step_number: { type: 'integer', minimum: 1 },
            text: { type: 'string' }
          }
        }
      }
    }
  }
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
    id: projectId,
    name: projectName,
    resolution_source: cleanText(contextProject.resolution_source || contextProject.resolutionSource, 120)
  });
}

function resolveNotebookDraftPayload(result = {}) {
  const source = ensureObject(result);
  const resultPayload = ensureObject(source.result);
  const outputPayload = ensureObject(source.output);
  if (Object.keys(resultPayload).length) {
    return resultPayload;
  }
  if (Object.keys(outputPayload).length) {
    return outputPayload;
  }
  return source;
}

async function callNotebookDraft(input = {}, context = {}, deps = {}) {
  const project = normalizeProject(input, context);
  const protocolCandidates = uniqueStrings(asArray(input.protocol_candidates), 5);
  const pendingValues = ensureObject(input.pending_values);
  const message = cleanText(context.message, 3200);
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
  const payload = resolveNotebookDraftPayload(result);
  const status = cleanText(payload.status || result?.status, 80) || (result?.ok === false ? 'failed' : 'proposal_ready');
  const error = cleanText(payload.error || result?.error, 1200);
  const ok = result?.ok !== false
    && payload.ok !== false
    && !['error', 'failed'].includes(status);

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
  NOTEBOOK_DRAFT_MCP_TOOL,
  callNotebookDraft,
  normalizeProject
};
