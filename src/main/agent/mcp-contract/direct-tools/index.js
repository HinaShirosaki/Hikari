'use strict';

const {
  INVENTORY_LOOKUP_MCP_TOOL,
  callInventoryLookup
} = require('./inventory-lookup.js');
const {
  CHEMICAL_LOOKUP_MCP_TOOL,
  callChemicalLookup
} = require('./chemical-lookup.js');
const {
  PROTOCOL_LOOKUP_MCP_TOOL,
  callProtocolLookup
} = require('./protocol-lookup.js');
const {
  PROTOCOL_GENERATION_MCP_TOOL,
  callProtocolGeneration
} = require('./protocol-generation.js');
const {
  NOTEBOOK_DRAFT_MCP_TOOL,
  callNotebookDraft
} = require('./notebook-draft.js');
const {
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
} = require('./notebook-lookup.js');
const {
  ASK_USER_MCP_TOOL,
  callAskUser
} = require('./ask-user.js');
const {
  CONTAINER_MCP_TOOL,
  callContainer
} = require('./container.js');
const {
  ASSAY_TABLE_MCP_TOOL,
  callAssayTable
} = require('./assay-table.js');
const {
  PLOTLY_GRAPH_MCP_TOOL,
  callPlotlyGraph
} = require('./plotly-graph.js');
const {
  LITERATURE_SEARCH_MCP_TOOL,
  callLiteratureSearch
} = require('./literature-search.js');
const {
  PURCHASE_RECOMMENDATION_MCP_TOOL,
  callPurchaseRecommendation
} = require('./purchase-recommendation.js');
const {
  PAPER_DOWNLOAD_MCP_TOOL,
  callPaperDownload
} = require('./paper-download.js');
const {
  PAPER_ANALYSIS_MCP_TOOL,
  callPaperAnalysis
} = require('./paper-analysis.js');
const {
  PAPER_INTAKE_DIRECT_MCP_TOOLS
} = require('../../../papers/store/intake/mcp-tools.js');

const DIRECT_MCP_TOOLS = Object.freeze([
  {
    definition: INVENTORY_LOOKUP_MCP_TOOL,
    handler: callInventoryLookup
  },
  {
    definition: CHEMICAL_LOOKUP_MCP_TOOL,
    handler: callChemicalLookup
  },
  {
    definition: NOTEBOOK_LOOKUP_MCP_TOOL,
    handler: callNotebookLookup
  },
  {
    definition: PROTOCOL_LOOKUP_MCP_TOOL,
    handler: callProtocolLookup
  },
  {
    definition: PROTOCOL_GENERATION_MCP_TOOL,
    handler: callProtocolGeneration
  },
  {
    definition: NOTEBOOK_DRAFT_MCP_TOOL,
    handler: callNotebookDraft
  },
  {
    definition: LITERATURE_SEARCH_MCP_TOOL,
    handler: callLiteratureSearch
  },
  {
    definition: PAPER_DOWNLOAD_MCP_TOOL,
    handler: callPaperDownload
  },
  {
    definition: PAPER_ANALYSIS_MCP_TOOL,
    handler: callPaperAnalysis
  },
  ...PAPER_INTAKE_DIRECT_MCP_TOOLS,
  {
    definition: PURCHASE_RECOMMENDATION_MCP_TOOL,
    handler: callPurchaseRecommendation
  },
  {
    definition: CONTAINER_MCP_TOOL,
    handler: callContainer
  },
  {
    definition: ASSAY_TABLE_MCP_TOOL,
    handler: callAssayTable
  },
  {
    definition: PLOTLY_GRAPH_MCP_TOOL,
    handler: callPlotlyGraph
  },
  {
    definition: ASK_USER_MCP_TOOL,
    handler: callAskUser
  }
]);

function getDirectMcpToolDefinitions() {
  return DIRECT_MCP_TOOLS.map((tool) => tool.definition);
}

function createDirectMcpToolRouter(deps = {}) {
  const handlers = new Map(
    DIRECT_MCP_TOOLS.map((tool) => [tool.definition.name, tool.handler])
  );

  function hasTool(name = '') {
    return handlers.has(String(name || ''));
  }

  async function callTool(name = '', args = {}, context = {}) {
    const handler = handlers.get(String(name || ''));
    if (typeof handler !== 'function') {
      return {
        ok: false,
        status: 'unknown_tool',
        error: `Unknown Hikari direct MCP tool "${String(name || 'unknown')}".`
      };
    }
    return handler(args, context, deps);
  }

  return {
    hasTool,
    callTool,
    getToolDefinitions: getDirectMcpToolDefinitions
  };
}

module.exports = {
  getDirectMcpToolDefinitions,
  createDirectMcpToolRouter
};
