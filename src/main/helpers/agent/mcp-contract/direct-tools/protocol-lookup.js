'use strict';

const {
  asArray,
  buildCommonLookupInputSchema,
  buildReadOnlyToolAnnotations,
  cleanText,
  normalizeLookupQuery,
  normalizeParserPayload,
  normalizeToolEnvelope,
  runAppTool,
  buildLookupResponse,
  toIntegerInRange
} = require('./shared.js');

const PROTOCOL_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'protocol_lookup',
  description: 'Look up local Hikari protocol records by protocol name, purpose, category, or step text.',
  annotations: buildReadOnlyToolAnnotations('Protocol lookup'),
  inputSchema: buildCommonLookupInputSchema()
});

async function callProtocolLookup(input = {}, context = {}, deps = {}) {
  const query = normalizeLookupQuery(input, context);
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'protocol_to_notebook',
    entities: {
      protocol_name: query,
      requested_output: 'protocol_lookup'
    },
    protocol_candidates: [query]
  });
  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'protocol-matching',
    args: {
      protocol_candidates: [query].filter(Boolean)
    },
    context: {
      ...context,
      message: query || context.message,
      parserPayload
    }
  });
  const envelope = normalizeToolEnvelope(result);
  const payload = result?.result && typeof result.result === 'object' ? result.result : result;
  const rankedMatches = asArray(payload?.ranked_matches || payload?.rankedMatches);
  const selectedProtocol = payload?.selected_protocol && typeof payload.selected_protocol === 'object'
    ? payload.selected_protocol
    : null;
  const protocols = (rankedMatches.length
    ? rankedMatches
    : (selectedProtocol ? [selectedProtocol] : envelope.items)
  ).slice(0, limit);

  return {
    ...buildLookupResponse({
      mcpToolName: PROTOCOL_LOOKUP_MCP_TOOL.name,
      appToolId: 'protocol-matching',
      query,
      envelope: result,
      items: protocols,
      source: 'protocol-matching',
      citationReason: 'Matched protocol records with the Hikari protocol-matching tool.',
      emptySummary: 'protocol_lookup returned no protocol matches.'
    }),
    ...(selectedProtocol ? { selected_protocol: selectedProtocol } : {}),
    ...(cleanText(payload?.selection_method || payload?.selectionMethod, 80)
      ? { selection_method: cleanText(payload.selection_method || payload.selectionMethod, 80) }
      : {}),
    ...(cleanText(payload?.rationale, 500) ? { rationale: cleanText(payload.rationale, 500) } : {})
  };
}

module.exports = {
  PROTOCOL_LOOKUP_MCP_TOOL,
  callProtocolLookup
};
