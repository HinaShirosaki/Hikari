'use strict';

const {
  buildCommonLookupInputSchema,
  buildReadOnlyToolAnnotations,
  compactObject,
  normalizeLookupQuery,
  normalizeParserPayload,
  runAppTool,
  buildLookupResponse,
  sanitizeInventorySearch,
  toIntegerInRange
} = require('./shared.js');

const INVENTORY_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'inventory_lookup',
  description: 'Look up local Hikari personal inventory items: personal containers and samples. For chemical stock, use chemical_lookup.',
  annotations: buildReadOnlyToolAnnotations('Inventory lookup'),
  inputSchema: buildCommonLookupInputSchema({
    inventory_search: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidate_terms: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10
        }
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
      : { candidate_terms: [query] },
    entities: {
      inventory_item: query,
      requested_output: 'inventory_lookup'
    }
  });
  const args = compactObject({
    query,
    limit,
    inventory_search: inventorySearch,
    parser_payload: parserPayload,
    kinds: ['personal_container', 'personal_sample']
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
