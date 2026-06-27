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
  project_id: { type: 'string' },
  project_name: { type: 'string' },
  protocol_name: { type: 'string' }
});

const NOTEBOOK_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'notebook_lookup',
  description: 'Look up local Hikari notebook entries by project, protocol, result text, or entry identifier.',
  annotations: buildReadOnlyToolAnnotations('Notebook lookup'),
  inputSchema: buildCommonLookupInputSchema(PROJECT_FILTER_SCHEMA)
});

async function callNotebookLookup(input = {}, context = {}, deps = {}) {
  const query = normalizeLookupQuery(input, context);
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const projectId = cleanText(input.project_id || input.projectId, 120);
  const projectName = cleanText(input.project_name || input.projectName, 220);
  const protocolName = cleanText(input.protocol_name || input.protocolName, 220);
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'notebook_lookup',
    entities: {
      protocol_name: protocolName,
      project_id: projectId,
      project_name: projectName,
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
      project_id: projectId,
      project_name: projectName,
      protocol_name: protocolName,
      parser_payload: parserPayload
    }),
    context
  });
  const envelope = normalizeToolEnvelope(result);

  return buildLookupResponse({
    mcpToolName: NOTEBOOK_LOOKUP_MCP_TOOL.name,
    appToolId: 'notebook-lookup',
    query,
    envelope: result,
    items: envelope.items.slice(0, limit),
    citationReason: 'Matched notebook entries from local Hikari data.',
    emptySummary: 'notebook_lookup returned no notebook matches.'
  });
}

module.exports = {
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
};
