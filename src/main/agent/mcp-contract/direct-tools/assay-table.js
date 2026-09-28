'use strict';

const {
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload
} = require('../../tools/agent-tool-loading.js');
const {
  asArray,
  buildWriteToolAnnotations,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  resolveDirectToolPayload,
  resolveDirectToolOk,
  runAppTool
} = require('./shared.js');

const ASSAY_TABLE_SUCCESS_STATUSES = Object.freeze([
  'completed',
  'created',
  'read',
  'listed',
  'derived',
  'python_completed',
  'deleted',
  'cleared'
]);

const ASSAY_TABLE_MCP_TOOL = Object.freeze({
  name: 'assay_table',
  description: 'Create scratch assay tables, derive calculated tables, add calculated columns, and run Python-backed table transforms.',
  annotations: buildWriteToolAnnotations('Assay table'),
  inputSchema: cloneJson(AGENT_TOOL_CALL_CATALOG['assay-table']?.input_schema, {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'read', 'list', 'derive', 'add_column', 'python', 'delete', 'clear']
      }
    }
  })
});

async function callAssayTable(input = {}, context = {}, deps = {}) {
  const normalized = normalizeToolArgumentsPayload({
    tool_calls: [{
      tool_name: 'assay-table',
      arguments: ensureObject(input)
    }]
  }, {
    selectedToolNames: ['assay-table']
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: ASSAY_TABLE_MCP_TOOL.name,
      app_tool: 'assay-table',
      error: normalized.error
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'assay-table',
    args: normalized.payload.tool_calls[0].arguments,
    context
  });
  const payload = resolveDirectToolPayload(result);
  const status = cleanText(payload.status || result?.status, 80)
    || (result?.ok === false ? 'failed' : 'invalid_response');
  const error = cleanText(payload.error || result?.error, 4000);
  const ok = resolveDirectToolOk({
    result,
    payload,
    status,
    successStatuses: ASSAY_TABLE_SUCCESS_STATUSES
  });

  return compactObject({
    ok,
    status,
    mcp_tool: ASSAY_TABLE_MCP_TOOL.name,
    app_tool: 'assay-table',
    summary: cleanText(payload.summary || result?.summary, 500),
    table: cloneJson(payload.table, null),
    items: asArray(payload.items || result?.items),
    count: payload.count,
    total_count: payload.total_count,
    source_table_id: cleanText(payload.source_table_id || payload.sourceTableId, 40),
    sandbox: cloneJson(payload.sandbox, null),
    id: cleanText(payload.id, 40),
    error
  });
}

module.exports = {
  ASSAY_TABLE_MCP_TOOL,
  callAssayTable,
  resolveAssayTablePayload: resolveDirectToolPayload
};
