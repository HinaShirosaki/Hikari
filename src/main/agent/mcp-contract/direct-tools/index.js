'use strict';

const { ToolSchema } = require('@modelcontextprotocol/sdk/types.js');
const { isToolAllowedForContext } = require('../notebook-suggestion-policy.js');
const { isHikariMcpToolEnabled } = require('../tool-availability.js');

// Each entry is loaded independently. A missing dependency in one tool must not
// prevent the MCP server from advertising and running every other healthy tool.
const DIRECT_TOOL_MODULE_SPECS = Object.freeze([
  ['./inventory-lookup.js', 'INVENTORY_LOOKUP_MCP_TOOL', 'callInventoryLookup'],
  ['./chemical-lookup.js', 'CHEMICAL_LOOKUP_MCP_TOOL', 'callChemicalLookup'],
  ['./notebook-lookup.js', 'NOTEBOOK_LOOKUP_MCP_TOOL', 'callNotebookLookup'],
  ['./protocol-lookup.js', 'PROTOCOL_LOOKUP_MCP_TOOL', 'callProtocolLookup'],
  ['./protocol-generation.js', 'PROTOCOL_GENERATION_MCP_TOOL', 'callProtocolGeneration'],
  ['./notebook-suggest.js', 'NOTEBOOK_SUGGEST_MCP_TOOL', 'callNotebookSuggest'],
  ['./notebook-draft.js', 'NOTEBOOK_DRAFT_MCP_TOOL', 'callNotebookDraft'],
  ['./notebook-append.js', 'NOTEBOOK_APPEND_MCP_TOOL', 'callNotebookAppend'],
  ['./literature-search.js', 'LITERATURE_SEARCH_MCP_TOOL', 'callLiteratureSearch'],
  ['./paper-download.js', 'PAPER_DOWNLOAD_MCP_TOOL', 'callPaperDownload'],
  ['./paper-analysis.js', 'PAPER_ANALYSIS_MCP_TOOL', 'callPaperAnalysis'],
  ['../../../papers/store/intake/mcp/search-summaries.js', 'SEARCH_SUMMARIES_DEFINITION', 'callSearchSummaries'],
  ['../../../papers/store/intake/mcp/search-experiments.js', 'SEARCH_EXPERIMENTS_DEFINITION', 'callSearchExperiments'],
  ['../../../papers/store/intake/mcp/list-summaries.js', 'LIST_PROJECT_SUMMARIES_DEFINITION', 'callListProjectSummaries'],
  ['./purchase-recommendation.js', 'PURCHASE_RECOMMENDATION_MCP_TOOL', 'callPurchaseRecommendation'],
  ['./container.js', 'CONTAINER_MCP_TOOL', 'callContainer'],
  ['./assay-table.js', 'ASSAY_TABLE_MCP_TOOL', 'callAssayTable'],
  ['./plotly-graph.js', 'PLOTLY_GRAPH_MCP_TOOL', 'callPlotlyGraph'],
  ['./image-output.js', 'IMAGE_OUTPUT_MCP_TOOL', 'callImageOutput'],
  ['./html-output.js', 'HTML_OUTPUT_MCP_TOOL', 'callHtmlOutput'],
  ['./sequence-tools.js', 'SEQUENCE_MCP_TOOLS'],
  ['./ask-user.js', 'ASK_USER_MCP_TOOL', 'callAskUser']
]);

function errorMessage(error) {
  return String(error?.message || error || 'unknown error').trim().slice(0, 1000);
}

function reportToolLoadError({ modulePath = '', error } = {}) {
  process.stderr.write(`[hikari-mcp] Skipped tool module ${modulePath}: ${errorMessage(error)}\n`);
}

function isValidDirectTool(tool) {
  return Boolean(
    tool
    && tool.definition
    && typeof tool.definition.name === 'string'
    && tool.definition.name.trim()
    && typeof tool.handler === 'function'
    && ToolSchema.safeParse(tool.definition).success
  );
}

function loadDirectMcpTools({ loadModule = require, onLoadError = reportToolLoadError } = {}) {
  const tools = [];
  for (const [modulePath, definitionExport, handlerExport] of DIRECT_TOOL_MODULE_SPECS) {
    let loaded;
    try {
      loaded = loadModule(modulePath);
    } catch (error) {
      onLoadError({ modulePath, error });
      continue;
    }

    const candidates = handlerExport
      ? [{ definition: loaded?.[definitionExport], handler: loaded?.[handlerExport] }]
      : loaded?.[definitionExport];
    if (!Array.isArray(candidates)) {
      onLoadError({
        modulePath,
        error: new Error(`Invalid Hikari MCP tool exports from ${modulePath}.`)
      });
      continue;
    }
    for (const tool of candidates) {
      if (!isValidDirectTool(tool)) {
        onLoadError({
          modulePath,
          error: new Error(`Invalid Hikari MCP tool export from ${modulePath}.`)
        });
        continue;
      }
      tools.push(tool);
    }
  }
  return Object.freeze(tools);
}

const DIRECT_MCP_TOOLS = loadDirectMcpTools();

function getToolDefinitions(directTools, context = {}) {
  return directTools
    .filter((tool) => isToolAllowedForContext(tool.definition.name, context))
    .filter((tool) => isHikariMcpToolEnabled(tool.definition.name, context))
    .map((tool) => tool.definition);
}

function getDirectMcpToolDefinitions(context = {}) {
  return getToolDefinitions(DIRECT_MCP_TOOLS, context);
}

function createDirectMcpToolRouter(deps = {}) {
  const directTools = Array.isArray(deps.directMcpTools)
    ? deps.directMcpTools.filter(isValidDirectTool)
    : DIRECT_MCP_TOOLS;
  const handlers = new Map(
    directTools.map((tool) => [tool.definition.name, tool.handler])
  );

  function hasTool(name = '') {
    return handlers.has(String(name || ''));
  }

  async function callTool(name = '', args = {}, context = {}) {
    const toolName = String(name || '');
    const handler = handlers.get(toolName);
    if (typeof handler !== 'function') {
      return {
        ok: false,
        status: 'unknown_tool',
        mcp_tool: toolName,
        error: `Unknown Hikari direct MCP tool "${toolName || 'unknown'}".`
      };
    }
    if (!isHikariMcpToolEnabled(toolName, context)) {
      return {
        ok: false,
        status: 'disabled',
        mcp_tool: toolName,
        error: `The Hikari MCP tool "${toolName}" is switched off in Settings.`
      };
    }
    if (!isToolAllowedForContext(toolName, context)) {
      return { ok: false, status: 'rejected', mcp_tool: toolName, error: 'This tool is not available in this workflow.' };
    }
    try {
      return await handler(args, context, deps);
    } catch (error) {
      return {
        ok: false,
        status: 'tool_error',
        mcp_tool: toolName,
        error: `The Hikari MCP tool "${toolName}" failed: ${errorMessage(error)}`
      };
    }
  }

  return {
    hasTool,
    callTool,
    getToolDefinitions: (context = {}) => getToolDefinitions(directTools, context)
  };
}

module.exports = {
  getDirectMcpToolDefinitions,
  createDirectMcpToolRouter,
  loadDirectMcpTools
};
