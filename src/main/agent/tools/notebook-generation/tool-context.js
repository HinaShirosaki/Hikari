'use strict';

const { isAgentRequestAbortError } = require('../../../lib/llm/request-context.js');
const {
  PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA,
  PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT
} = require('./prompts.js');

// Optional inventory/tool lookup that grounds placeholder values, plus the
// structured LLM call that fills the remaining ones.
function createPlaceholderToolContext({
  asArray,
  cleanText,
  uniqueStrings,
  recordAgentLlmTrace,
  recordLifecycleEvent,
  requestStructuredJsonPayload,
  runTool,
  buildNotebookPlaceholderFillPrompt
} = {}) {
  function buildProtocolPlaceholderToolQuery({
    parserPayload = {},
    unresolvedPlaceholders = [],
    message = ''
  } = {}) {
    const entities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    const inventorySearch = parserPayload?.inventory_search && typeof parserPayload.inventory_search === 'object'
      ? parserPayload.inventory_search
      : {};

    const unresolvedTerms = asArray(unresolvedPlaceholders)
      .map((row) => cleanText(row?.display || row?.placeholder_key, 120))
      .filter(Boolean)
      .filter((value) => /\b(buffer|reagent|compound|chemical|inventory|stock|protein)\b/i.test(value))
      .slice(0, 3);

    const candidateQueries = uniqueStrings([
      ...asArray(inventorySearch.candidate_terms).slice(0, 4),
      cleanText(entities.inventory_item, 220),
      cleanText(entities.compound_name, 220),
      cleanText(entities.protein_name, 220),
      ...unresolvedTerms,
      cleanText(message, 220)
    ], 10);

    return cleanText(candidateQueries[0], 220);
  }

  async function maybeLookupProtocolPlaceholderToolContext({
    snapshot,
    parserPayload,
    unresolvedPlaceholders,
    message,
    traceContext = null,
    lifecycleRecorder = null
  }) {
    if (typeof runTool !== 'function') {
      return null;
    }
    const query = buildProtocolPlaceholderToolQuery({
      parserPayload,
      unresolvedPlaceholders,
      message
    });
    if (!query) {
      return null;
    }

    const args = {
      query,
      limit: 5,
      search_terms: [query]
    };
    try {
      const toolResult = await runTool('search_inventory', args, snapshot, {
        allowWriteTools: false
      });
      const items = asArray(toolResult?.items).slice(0, 5).map((item) => ({
        kind: cleanText(item?.kind, 40),
        id: cleanText(item?.id, 120),
        name: cleanText(item?.name, 220),
        quantity: cleanText(item?.quantity, 80),
        amount: cleanText(item?.amount, 80),
        location: cleanText(item?.location, 180),
        supplier: cleanText(item?.supplier, 180),
        matched_term: cleanText(item?.matched_term, 120)
      }));
      const summary = cleanText(toolResult?.summary, 320);
      await recordAgentLlmTrace(traceContext, {
        stage: 'protocol_placeholder_tool_lookup',
        summary: summary || `Placeholder tool lookup completed with ${items.length} inventory records.`,
        request_payload: {
          tool: 'search_inventory',
          args
        },
        response_payload: {
          item_count: items.length,
          items
        }
      });
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_placeholder_tool_lookup',
        status: 'ok',
        message: summary || `Resolved ${items.length} inventory records for placeholder context.`,
        meta: {
          tool_name: 'search_inventory',
          query,
          item_count: items.length
        }
      });
      return {
        tool_name: 'search_inventory',
        query,
        summary,
        items
      };
    } catch (error) {
      if (isAgentRequestAbortError(error)) {
        throw error;
      }
      const errorMessage = cleanText(error?.message || error, 320) || 'Placeholder tool lookup failed.';
      await recordAgentLlmTrace(traceContext, {
        stage: 'protocol_placeholder_tool_lookup',
        summary: errorMessage,
        request_payload: {
          tool: 'search_inventory',
          args
        },
        response_payload: {
          error: errorMessage
        }
      });
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_placeholder_tool_lookup',
        status: 'failed',
        message: errorMessage,
        meta: {
          tool_name: 'search_inventory',
          query
        }
      });
      return null;
    }
  }

  async function requestNotebookPlaceholderFill({
    message,
    conversation,
    parserPayload,
    selectedProtocol,
    project,
    placeholders,
    unresolvedPlaceholders,
    toolContext = null,
    traceContext = null
  }) {
    return requestStructuredJsonPayload({
      stage: 'notebook_fill',
      systemPrompt: PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
      userPrompt: buildNotebookPlaceholderFillPrompt({
        message,
        conversation,
        parserPayload,
        selectedProtocol,
        project,
        placeholders,
        unresolvedPlaceholders,
        toolContext
      }),
      schema: PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA,
      traceContext,
      defaultError: 'Notebook generation provider is not configured.'
    });
  }

  return {
    buildProtocolPlaceholderToolQuery,
    maybeLookupProtocolPlaceholderToolContext,
    requestNotebookPlaceholderFill
  };
}

module.exports = { createPlaceholderToolContext };
