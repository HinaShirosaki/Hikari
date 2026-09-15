'use strict';

const { createDirectAppTool } = require('./generic-app-tool.js');
const memory = createDirectAppTool('memory', {
  annotations: { title: 'Memory', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
});

async function callMemory(input = {}, context = {}, deps = {}) {
  const response = await memory.handler(input, context, deps);
  const payload = response.output?.result || response.output?.output || response.output;
  if (response.ok && payload?.ok === false) {
    return { ...response, ok: false, status: payload.status || 'failed', error: payload.error || 'Memory operation failed.' };
  }
  return response;
}

module.exports = {
  MEMORY_MCP_TOOL: memory.definition,
  callMemory
};
