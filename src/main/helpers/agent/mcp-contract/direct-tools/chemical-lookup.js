'use strict';

const {
  buildCommonLookupInputSchema,
  buildReadOnlyToolAnnotations,
  compactObject,
  filterInventoryItemsByKind,
  normalizeLookupQuery,
  normalizeParserPayload,
  normalizeToolEnvelope,
  runAppTool,
  buildLookupResponse,
  sanitizeInventorySearch,
  toIntegerInRange,
  uniqueStrings,
  cleanText
} = require('./shared.js');

const CHEMICAL_LOOKUP_MCP_TOOL = Object.freeze({
  name: 'chemical_lookup',
  description: 'Look up local Hikari chemical records, including amount, CAS, supplier, and storage location.',
  annotations: buildReadOnlyToolAnnotations('Chemical lookup'),
  inputSchema: buildCommonLookupInputSchema({
    cas: { type: 'string' },
    supplier: { type: 'string' }
  })
});

async function callChemicalLookup(input = {}, context = {}, deps = {}) {
  const baseQuery = normalizeLookupQuery(input, context);
  const cas = cleanText(input.cas || input.cas_number || input.casNumber, 120);
  const supplier = cleanText(input.supplier || input.vendor, 180);
  const query = uniqueStrings([baseQuery, cas, supplier], 4).join(' ');
  const limit = toIntegerInRange(input.limit, 8, 1, 25);
  const appLimit = Math.min(25, Math.max(limit * 4, limit));
  const inventorySearch = sanitizeInventorySearch({
    ...(input.inventory_search || input.inventorySearch || {}),
    normalized_query: query,
    candidate_terms: uniqueStrings([baseQuery, cas, supplier], 10)
  });
  const parserPayload = normalizeParserPayload(input.parser_payload || context.parserPayload, {
    primary_intent: 'inventory_lookup',
    inventory_search: inventorySearch,
    entities: {
      compound_name: baseQuery || query,
      inventory_item: baseQuery || query,
      cas_number: cas,
      supplier,
      requested_output: 'chemical_lookup'
    }
  });
  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'inventory-lookup',
    args: compactObject({
      query,
      limit: appLimit,
      inventory_search: inventorySearch,
      parser_payload: parserPayload
    }),
    context
  });
  const envelope = normalizeToolEnvelope(result);
  const chemicalItems = filterInventoryItemsByKind(envelope.items, ['chemical']).slice(0, limit);

  return buildLookupResponse({
    mcpToolName: CHEMICAL_LOOKUP_MCP_TOOL.name,
    appToolId: 'inventory-lookup',
    query,
    envelope: result,
    items: chemicalItems,
    citationReason: 'Matched chemical records from local Hikari inventory.',
    emptySummary: 'chemical_lookup returned no chemical matches.'
  });
}

module.exports = {
  CHEMICAL_LOOKUP_MCP_TOOL,
  callChemicalLookup
};
