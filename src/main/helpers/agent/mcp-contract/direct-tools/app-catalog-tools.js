'use strict';

const {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload
} = require('../../tools/agent-tool-loading.js');
const {
  buildReadOnlyToolAnnotations,
  buildWriteToolAnnotations,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  runAppTool
} = require('./shared.js');

const CUSTOM_DIRECT_APP_TOOL_IDS = Object.freeze(new Set([
  'inventory-lookup',
  'notebook-draft',
  'protocol-generation'
]));

const READ_ONLY_APP_TOOL_IDS = Object.freeze(new Set([
  'record-lookup',
  'protocol-matching',
  'web-search',
  'purchase-recommendation'
]));

const OPEN_WORLD_APP_TOOL_IDS = Object.freeze(new Set([
  'web-search',
  'literature-search',
  'paper-download',
  'paper-analysis',
  'purchase-recommendation'
]));

function toDirectMcpToolName(appToolId = '') {
  return cleanText(appToolId, 160).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function titleFromToolId(appToolId = '') {
  return cleanText(appToolId, 160)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function schemaUsesSharedDefs(schema = {}) {
  try {
    return JSON.stringify(schema).includes('#/$defs/');
  } catch {
    return false;
  }
}

function buildDirectInputSchema(appToolId = '') {
  const schemaEntry = ensureObject(AGENT_TOOL_CALL_CATALOG[appToolId]);
  const inputSchema = cloneJson(schemaEntry.input_schema, {
    type: 'object',
    additionalProperties: true,
    properties: {}
  });
  if (schemaUsesSharedDefs(inputSchema)) {
    inputSchema.$defs = cloneJson(AGENT_TOOL_CALL_CATALOG.$defs, {});
  }
  return inputSchema;
}

function buildDirectToolAnnotations(appToolId = '') {
  const title = titleFromToolId(appToolId);
  const annotations = READ_ONLY_APP_TOOL_IDS.has(appToolId)
    ? buildReadOnlyToolAnnotations(title)
    : buildWriteToolAnnotations(title);
  if (OPEN_WORLD_APP_TOOL_IDS.has(appToolId)) {
    return {
      ...annotations,
      openWorldHint: true
    };
  }
  return annotations;
}

function buildGenericDirectToolDefinition(entry = {}) {
  const appToolId = cleanText(entry.name, 160);
  const directName = toDirectMcpToolName(appToolId);
  const schemaEntry = ensureObject(AGENT_TOOL_CALL_CATALOG[appToolId]);
  return Object.freeze({
    name: directName,
    description: cleanText(schemaEntry.description, 2400)
      || cleanText(entry.description, 1200)
      || `Call the Hikari ${appToolId} tool directly.`,
    annotations: buildDirectToolAnnotations(appToolId),
    inputSchema: buildDirectInputSchema(appToolId)
  });
}

function buildGenericDirectToolHandler(appToolId = '', directName = '') {
  return async function callGenericDirectAppTool(input = {}, context = {}, deps = {}) {
    const normalized = normalizeToolArgumentsPayload({
      tool_calls: [{
        tool_name: appToolId,
        arguments: ensureObject(input)
      }]
    }, {
      selectedToolNames: [appToolId]
    });
    if (!normalized.ok) {
      return {
        ok: false,
        status: 'invalid_arguments',
        mcp_tool: directName,
        app_tool: appToolId,
        error: normalized.error
      };
    }

    const result = await runAppTool({
      runTool: deps.runTool,
      toolId: appToolId,
      args: normalized.payload.tool_calls[0].arguments,
      context
    });
    const status = result?.ok === false
      ? (cleanText(result?.status, 80) || 'failed')
      : (cleanText(result?.status || result?.result?.status || result?.output?.status, 80) || 'completed');
    return compactObject({
      ok: result?.ok !== false,
      status,
      mcp_tool: directName,
      app_tool: appToolId,
      output: cloneJson(result, result),
      error: cleanText(result?.error || result?.result?.error || result?.output?.error, 1200)
    });
  };
}

const APP_CATALOG_DIRECT_MCP_TOOLS = Object.freeze(
  AGENT_TOOL_CATALOG
    .filter((entry) => !CUSTOM_DIRECT_APP_TOOL_IDS.has(entry.name))
    .map((entry) => {
      const appToolId = cleanText(entry.name, 160);
      const definition = buildGenericDirectToolDefinition(entry);
      return Object.freeze({
        appToolId,
        definition,
        handler: buildGenericDirectToolHandler(appToolId, definition.name)
      });
    })
);

module.exports = {
  APP_CATALOG_DIRECT_MCP_TOOLS,
  toDirectMcpToolName
};
