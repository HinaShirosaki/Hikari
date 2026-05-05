'use strict';

const {
  buildCommonLookupInputSchema,
  compactObject,
  ensureObject,
  normalizeLookupQuery,
  normalizeParserPayload,
  runAppTool,
  buildLookupResponse,
  sanitizeInventorySearch,
  toIntegerInRange
} = require('./shared.js');

const INVENTORY_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'inventory_lookup',
  description: 'Look up local Hikari inventory items, including chemicals, personal containers, and samples.',
  inputSchema: buildCommonLookupInputSchema({
    inventory_search: {
      type: 'object',
      additionalProperties: false,
      properties: {
        normalized_query: { type: 'string' },
        candidate_terms: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10
        },
        search_mode: { type: 'string' }
      }
    }
  })
});

async function callInventoryLookup(input = {}, context = {}, deps = {}) {
  const query = normalizeLookupQuery(input, context);
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const inventorySearch = sanitizeInventorySearch(input.inventory_search || input.inventorySearch);
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'inventory_lookup',
    inventory_search: Object.keys(inventorySearch).length
      ? inventorySearch
      : { normalized_query: query },
    entities: {
      inventory_item: query,
      requested_output: 'inventory_lookup'
    }
  });
  const args = compactObject({
    query,
    limit,
    inventory_search: inventorySearch,
    parser_payload: parserPayload
  });
  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'inventory-lookup',
    args,
    context
  });

  return buildLookupResponse({
    mcpToolName: INVENTORY_LOOKUP_MCP_TOOL.name,
    appToolId: 'inventory-lookup',
    query,
    envelope: result,
    items: result?.result?.items || result?.items || [],
    citationReason: 'Matched local inventory records from Hikari data.',
    emptySummary: 'inventory_lookup returned no inventory matches.'
  });
}

module.exports = {
  INVENTORY_LOOKUP_MCP_TOOL,
  callInventoryLookup
};
