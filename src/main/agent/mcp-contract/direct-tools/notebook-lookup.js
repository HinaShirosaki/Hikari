'use strict';

const {
  buildCommonLookupInputSchema,
  buildReadOnlyToolAnnotations,
  cleanText,
  compactObject,
  normalizeLookupQuery,
  normalizeParserPayload,
  normalizeToolEnvelope,
  runAppTool,
  buildLookupResponse,
  toIntegerInRange
} = require('./shared.js');

const PROJECT_FILTER_SCHEMA = Object.freeze({
  project_name: { type: 'string' },
  protocol_name: { type: 'string' },
  notebook_state: { type: 'string', enum: ['planned', 'executed', 'suggested'] },
  detail: { type: 'string', enum: ['summary', 'full'] }
});

const NOTEBOOK_LOOKUP_INPUT_SCHEMA = Object.freeze({
  ...buildCommonLookupInputSchema(PROJECT_FILTER_SCHEMA),
  required: []
});

const NOTEBOOK_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'notebook_lookup',
  description: 'Search Hikari notebook pages by text, project, protocol, or state. Returns agent-safe content, UI targets, source coverage, and explicit storage-access status.',
  annotations: buildReadOnlyToolAnnotations('Notebook lookup'),
  inputSchema: NOTEBOOK_LOOKUP_INPUT_SCHEMA
});

async function callNotebookLookup(input = {}, context = {}, deps = {}) {
  const query = normalizeLookupQuery(input, context);
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const projectName = cleanText(input.project_name || input.projectName, 220);
  const protocolName = cleanText(input.protocol_name || input.protocolName, 220);
  const notebookState = cleanText(input.notebook_state || input.notebookState, 80).toLowerCase();
  const detail = cleanText(input.detail, 40).toLowerCase() === 'full' ? 'full' : 'summary';
  if (!query && !projectName && !protocolName && !notebookState) {
    return {
      ok: false,
      status: 'invalid_input',
      mcp_tool: NOTEBOOK_LOOKUP_MCP_TOOL.name,
      app_tool: 'notebook-lookup',
      error: 'Provide query or at least one project, protocol, or notebook_state filter.'
    };
  }
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'notebook_lookup',
    entities: {
      protocol_name: protocolName,
      project_name: projectName,
      notebook_state: notebookState,
      activity_type: query,
      requested_output: 'notebook_lookup'
    }
  });
  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'notebook-lookup',
    args: compactObject({
      query,
      limit,
      project_name: projectName,
      protocol_name: protocolName,
      notebook_state: notebookState,
      detail,
      parser_payload: parserPayload
    }),
    context
  });
  const envelope = normalizeToolEnvelope(result);

  const response = buildLookupResponse({
    mcpToolName: NOTEBOOK_LOOKUP_MCP_TOOL.name,
    appToolId: 'notebook-lookup',
    query,
    envelope: result,
    items: envelope.items.slice(0, limit),
    citationReason: 'Matched notebook entries from local Hikari data.',
    emptySummary: 'notebook_lookup returned no notebook matches.'
  });
  if (response.status === 'permission_denied') {
    response.summary = 'Notebook lookup could not verify local pages because Hikari lacks access to part of the configured storage.';
  } else if (response.status === 'partial') {
    response.summary = `${response.summary} Search coverage was incomplete because one or more notebook storage sources were unavailable.`;
  }
  return response;
}

module.exports = {
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
};
