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
  resolveDirectToolOk,
  runAppTool
} = require('./shared.js');

const CONTAINER_SUCCESS_STATUSES = Object.freeze([
  'completed',
  'created',
  'read',
  'listed',
  'updated',
  'replaced',
  'renamed',
  'deleted',
  'cleared'
]);

const CONTAINER_MCP_TOOL = Object.freeze({
  name: 'container',
  description: 'Store, name, list, read, update, and position-edit temporary string or number containers, with optional source provenance. Returns short runtime IDs such as 1, 2, or 3.',
  annotations: buildWriteToolAnnotations('Container'),
  inputSchema: cloneJson(AGENT_TOOL_CALL_CATALOG.container?.input_schema, {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'read', 'list', 'update', 'replace_range', 'rename', 'delete', 'clear']
      }
    }
  })
});

function resolveContainerPayload(result = {}) {
  const source = ensureObject(result);
  const resultPayload = ensureObject(source.result);
  const outputPayload = ensureObject(source.output);
  if (Object.keys(resultPayload).length) {
    return resultPayload;
  }
  if (Object.keys(outputPayload).length) {
    return outputPayload;
  }
  return source;
}

async function callContainer(input = {}, context = {}, deps = {}) {
  const normalized = normalizeToolArgumentsPayload({
    tool_calls: [{
      tool_name: 'container',
      arguments: ensureObject(input)
    }]
  }, {
    selectedToolNames: ['container']
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: CONTAINER_MCP_TOOL.name,
      app_tool: 'container',
      error: normalized.error
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'container',
    args: normalized.payload.tool_calls[0].arguments,
    context
  });
  const payload = resolveContainerPayload(result);
  const status = cleanText(payload.status || result?.status, 80)
    || (result?.ok === false ? 'failed' : 'invalid_response');
  const error = cleanText(payload.error || result?.error, 1200);
  const ok = resolveDirectToolOk({
    result,
    payload,
    status,
    successStatuses: CONTAINER_SUCCESS_STATUSES
  });

  return compactObject({
    ok,
    status,
    mcp_tool: CONTAINER_MCP_TOOL.name,
    app_tool: 'container',
    summary: cleanText(payload.summary || result?.summary, 500),
    container: cloneJson(payload.container, null),
    items: asArray(payload.items || result?.items),
    count: payload.count,
    total_count: payload.total_count,
    range: cloneJson(payload.range, null),
    id: cleanText(payload.id, 40),
    error
  });
}

module.exports = {
  CONTAINER_MCP_TOOL,
  callContainer,
  resolveContainerPayload
};
