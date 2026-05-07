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
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
} = require('./notebook-lookup.js');
const {
  ASK_USER_MCP_TOOL,
  callAskUser
} = require('./ask-user.js');

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
    definition: NOTEBOOK_LOOKUP_MCP_TOOL,
    handler: callNotebookLookup
  },
  {
    definition: ASK_USER_MCP_TOOL,
    handler: callAskUser
  }
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
  getDirectMcpToolDefinitions,
  createDirectMcpToolRouter,
  MCP_LOOKUP_TOOLS,
  getMcpLookupToolDefinitions,
  createMcpLookupToolRouter
};
