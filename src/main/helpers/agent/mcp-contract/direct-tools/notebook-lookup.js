'use strict';

const {
  buildCommonLookupInputSchema,
  cleanText,
  compactObject,
  filterRecordItems,
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
  inputSchema: buildCommonLookupInputSchema(PROJECT_FILTER_SCHEMA)
});

async function callNotebookLookup(input = {}, context = {}, deps = {}) {
  const query = normalizeLookupQuery(input, context);
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const appLimit = Math.min(25, Math.max(limit * 6, limit));
  const projectId = cleanText(input.project_id || input.projectId, 120);
  const projectName = cleanText(input.project_name || input.projectName, 220);
  const protocolName = cleanText(input.protocol_name || input.protocolName || query, 220);
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'record_lookup',
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
    toolId: 'record-lookup',
    args: compactObject({
      query,
      limit: appLimit,
      parser_payload: parserPayload
    }),
    context
  });
  const envelope = normalizeToolEnvelope(result);
  const notebooks = filterRecordItems(envelope.items, 'notebook', input).slice(0, limit);

  return buildLookupResponse({
    mcpToolName: NOTEBOOK_LOOKUP_MCP_TOOL.name,
    appToolId: 'record-lookup',
    query,
    envelope: result,
    items: notebooks,
    citationReason: 'Matched notebook entries from local Hikari data.',
    emptySummary: 'notebook_lookup returned no notebook matches.'
  });
}

module.exports = {
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
};
