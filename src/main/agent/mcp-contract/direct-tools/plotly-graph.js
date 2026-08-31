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
  runAppTool
} = require('./shared.js');

const PLOTLY_GRAPH_MCP_TOOL = Object.freeze({
  name: 'plotly_graph',
  description: 'Create, update, read, and inspect scratch Plotly.js graph specifications using canonical data, layout, and optional config arguments.',
  annotations: buildWriteToolAnnotations('Plotly graph'),
  inputSchema: cloneJson(AGENT_TOOL_CALL_CATALOG['plotly-graph']?.input_schema, {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'read', 'list', 'update', 'inspect', 'delete', 'clear']
      }
    }
  })
});

function resolvePlotlyGraphPayload(result = {}) {
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

async function callPlotlyGraph(input = {}, context = {}, deps = {}) {
  const normalized = normalizeToolArgumentsPayload({
    tool_calls: [{
      tool_name: 'plotly-graph',
      arguments: ensureObject(input)
    }]
  }, {
    selectedToolNames: ['plotly-graph']
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: PLOTLY_GRAPH_MCP_TOOL.name,
      app_tool: 'plotly-graph',
      error: normalized.error
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'plotly-graph',
    args: normalized.payload.tool_calls[0].arguments,
    context
  });
  const payload = resolvePlotlyGraphPayload(result);
  const status = cleanText(payload.status || result?.status, 80) || (result?.ok === false ? 'failed' : 'completed');
  const error = cleanText(payload.error || result?.error, 4000);
  const ok = result?.ok !== false
    && payload.ok !== false
    && !['error', 'failed', 'invalid_action', 'invalid_figure', 'not_found'].includes(status);

  return compactObject({
    ok,
    status,
    mcp_tool: PLOTLY_GRAPH_MCP_TOOL.name,
    app_tool: 'plotly-graph',
    summary: cleanText(payload.summary || result?.summary, 500),
    graph: cloneJson(payload.graph, null),
    inspection: cloneJson(payload.inspection, null),
    items: asArray(payload.items || result?.items),
    count: payload.count,
    total_count: payload.total_count,
    id: cleanText(payload.id, 40),
    error
  });
}

module.exports = {
  PLOTLY_GRAPH_MCP_TOOL,
  callPlotlyGraph,
  resolvePlotlyGraphPayload
};
