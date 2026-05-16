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
  description: 'Prepare a planned Hikari biology notebook draft for explicit user confirmation before any notebook page is created.',
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
      message: { type: 'string' },
      project: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          project_id: { type: 'string' },
          project_name: { type: 'string' }
        }
      },
      project_id: { type: 'string' },
      project_name: { type: 'string' },
      workflow_id: { type: 'string', maxLength: 160 },
      workflowId: { type: 'string', maxLength: 160 },
      protocol_name: { type: 'string' },
      protocolName: { type: 'string' },
      protocol_candidates: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 5
      },
      protocolCandidates: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 5
      },
      evidence_context: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true
        },
        maxItems: 8
      },
      evidenceContext: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true
        },
        maxItems: 8
      },
      parser_payload: {
        type: 'object',
        additionalProperties: true
      },
      parserPayload: {
        type: 'object',
        additionalProperties: true
      }
    }
  }
});

function normalizeProject(input = {}, context = {}) {
  const inputProject = ensureObject(input.project);
  const contextProject = ensureObject(context.project);
  const projectId = cleanText(
    input.project_id
      || input.projectId
      || inputProject.id
      || inputProject.project_id
      || inputProject.projectId
      || context.projectId
      || contextProject.id
      || contextProject.project_id
      || contextProject.projectId,
    120
  );
  const projectName = cleanText(
    input.project_name
      || input.projectName
      || inputProject.name
      || inputProject.project_name
      || inputProject.projectName
      || inputProject.title
      || context.projectName
      || contextProject.name
      || contextProject.project_name
      || contextProject.projectName
      || contextProject.title,
    220
  );
  return compactObject({
    ...contextProject,
    ...inputProject,
    id: projectId,
    name: projectName,
    project_id: projectId,
    project_name: projectName
  });
}

function normalizeEvidenceContext(input = {}) {
  return asArray(input.evidence_context || input.evidenceContext)
    .map((entry) => cloneJson(entry, null))
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .slice(0, 8);
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
  const workflowId = cleanText(input.workflow_id || input.workflowId, 160);
  const protocolCandidates = uniqueStrings([
    ...asArray(input.protocol_candidates || input.protocolCandidates),
    input.protocol_name,
    input.protocolName
  ], 5);
  const evidenceContext = normalizeEvidenceContext(input);
  const message = cleanText(input.message || context.message, 3200);
  const parserPayload = normalizeParserPayload(input.parser_payload || input.parserPayload || context.parserPayload, {
    primary_intent: 'notebook_draft',
    entities: {
      project_id: cleanText(project.id || project.project_id, 120),
      project_name: cleanText(project.name || project.project_name, 220),
      workflow_id: workflowId,
      workflow_step: workflowId,
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
      workflow_id: workflowId,
      protocol_candidates: protocolCandidates,
      evidence_context: evidenceContext
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
