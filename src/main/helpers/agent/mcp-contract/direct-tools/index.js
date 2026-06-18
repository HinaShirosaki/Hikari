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
  RECORD_LOOKUP_MCP_TOOL,
  callRecordLookup
} = require('./record-lookup.js');
const {
  NOTEBOOK_GENERATION_MCP_TOOL,
  callNotebookGeneration
} = require('./notebook-generation.js');
const {
  MEMORY_MCP_TOOL,
  callMemory
} = require('./memory.js');
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
  PAPER_INTAKE_DIRECT_MCP_TOOLS,
  PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES
} = require('../../paper-intake/mcp-tools.js');

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
    definition: NOTEBOOK_LOOKUP_MCP_TOOL,
    handler: callNotebookLookup
  },
  {
    definition: ASK_USER_MCP_TOOL,
    handler: callAskUser
  },
  {
    definition: RECORD_LOOKUP_MCP_TOOL,
    handler: callRecordLookup
  },
  {
    definition: NOTEBOOK_GENERATION_MCP_TOOL,
    handler: callNotebookGeneration
  },
  {
    definition: MEMORY_MCP_TOOL,
    handler: callMemory
  },
  {
    definition: LITERATURE_SEARCH_MCP_TOOL,
    handler: callLiteratureSearch
  },
  {
    definition: PURCHASE_RECOMMENDATION_MCP_TOOL,
    handler: callPurchaseRecommendation
  },
  {
    definition: PAPER_DOWNLOAD_MCP_TOOL,
    handler: callPaperDownload
  },
  {
    definition: PAPER_ANALYSIS_MCP_TOOL,
    handler: callPaperAnalysis
  },
  ...PAPER_INTAKE_DIRECT_MCP_TOOLS
]);

const DIRECT_MCP_TOOL_NAMES = Object.freeze(
  DIRECT_MCP_TOOLS.map((tool) => tool.definition.name)
);

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

const MCP_LOOKUP_TOOLS = DIRECT_MCP_TOOLS;
const getMcpLookupToolDefinitions = getDirectMcpToolDefinitions;
const createMcpLookupToolRouter = createDirectMcpToolRouter;

module.exports = {
  DIRECT_MCP_TOOLS,
  DIRECT_MCP_TOOL_NAMES,
  PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES,
  getDirectMcpToolDefinitions,
  createDirectMcpToolRouter,
  MCP_LOOKUP_TOOLS,
  getMcpLookupToolDefinitions,
  createMcpLookupToolRouter
};
