'use strict';
const { definitions } = require('./schemas');
const { execute } = require('./service');
const SEQUENCE_MCP_TOOLS = definitions.map(definition => ({
  definition,
  async handler(args = {}, context = {}, deps = {}) {
    try {
      const storagePath = deps.sequenceStoragePath || deps.storagePath || context.snapshot?.settings?.storagePath;
      const result = await execute(definition.name, args, storagePath, context);
      return { ok: true, status: 'ok', mcp_tool: definition.name, app_tool: definition.name, ...result };
    } catch (error) {
      return { ok: false, status: error.code || 'sequence_error', mcp_tool: definition.name, app_tool: definition.name, error: error.message };
    }
  }
}));
module.exports = { SEQUENCE_MCP_TOOLS };
