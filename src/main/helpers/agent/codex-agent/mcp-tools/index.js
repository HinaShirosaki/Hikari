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
  NOTEBOOK_LOOKUP_MCP_TOOL,
  callNotebookLookup
} = require('./notebook-lookup.js');

const MCP_LOOKUP_TOOLS = Object.freeze([
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
    definition: NOTEBOOK_LOOKUP_MCP_TOOL,
    handler: callNotebookLookup
  }
]);

function getMcpLookupToolDefinitions() {
  return MCP_LOOKUP_TOOLS.map((tool) => tool.definition);
}

function createMcpLookupToolRouter(deps = {}) {
  const handlers = new Map(
    MCP_LOOKUP_TOOLS.map((tool) => [tool.definition.name, tool.handler])
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
        error: `Unknown Hikari MCP lookup tool "${String(name || 'unknown')}".`
      };
    }
    return handler(args, context, deps);
  }

  return {
    hasTool,
    callTool,
    getToolDefinitions: getMcpLookupToolDefinitions
  };
}

module.exports = {
  MCP_LOOKUP_TOOLS,
  getMcpLookupToolDefinitions,
  createMcpLookupToolRouter
};
