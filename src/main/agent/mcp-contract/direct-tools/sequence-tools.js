'use strict';
const { SEQUENCE_MCP_TOOLS: domainTools } = require('../../../../renderer/modules/sequence-viewer/main-process/mcp/tools');
const { validateValueAgainstSchema } = require('../../tools/tool-loading/schema-validation');
const SEQUENCE_MCP_TOOLS = domainTools.map(({ definition, handler }) => ({
  definition,
  handler(args = {}, context = {}, deps = {}) {
    const validation = validateValueAgainstSchema(args, definition.inputSchema, definition.inputSchema);
    if (!validation.ok) return { ok: false, status: 'invalid_arguments', mcp_tool: definition.name, app_tool: definition.name, error: validation.error };
    return handler(args, context, deps);
  }
}));
module.exports = { SEQUENCE_MCP_TOOLS };
