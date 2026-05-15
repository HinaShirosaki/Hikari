#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode
} = require('@modelcontextprotocol/sdk/types.js');

const { createAgentMcpGateway } = require('./gateway.js');
const { createAgentMcpHostToolRunner } = require('./host-client.js');
const { getDirectMcpToolDefinitions } = require('./direct-tools/index.js');
const { buildReadOnlyToolAnnotations } = require('./direct-tools/shared.js');

const SERVER_NAME = 'hikari-agent-mcp';
const SERVER_VERSION = '0.1.0';

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJsonObject(raw = '') {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function getRequestContextFromEnv(env = process.env) {
  return parseJsonObject(
    env.HIKARI_AGENT_MCP_REQUEST_CONTEXT
      || env.ENANA_AGENT_MCP_REQUEST_CONTEXT
      || env.HIKARI_CODEX_REQUEST_CONTEXT
      || env.ENANA_CODEX_REQUEST_CONTEXT
  );
}

function createMcpToolDefinitions() {
  return [
    ...getDirectMcpToolDefinitions(),
    {
      name: 'tool_search',
      description: 'Search Hikari app tools by natural-language goal.',
      annotations: buildReadOnlyToolAnnotations('Tool search'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 30 }
        }
      }
    },
    {
      name: 'tool_info',
      description: 'Load one Hikari tool manifest, including schema when requested.',
      annotations: buildReadOnlyToolAnnotations('Tool info'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_id'],
        properties: {
          tool_id: { type: 'string', minLength: 1 },
          detail_level: { type: 'string', enum: ['summary', 'schema', 'full'] }
        }
      }
    },
    {
      name: 'tool_call',
      description: 'Validate and call a Hikari app tool through the MCP bridge.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_id', 'args'],
        properties: {
          tool_id: { type: 'string', minLength: 1 },
          args: { type: 'object', additionalProperties: true }
        }
      }
    },
    {
      name: 'resource_search',
      description: 'Search Hikari MCP resources such as instructions and tool manifests.',
      annotations: buildReadOnlyToolAnnotations('Resource search'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 40 }
        }
      }
    },
    {
      name: 'resource_read',
      description: 'Read one Hikari MCP resource by URI.',
      annotations: buildReadOnlyToolAnnotations('Resource read'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['uri'],
        properties: {
          uri: { type: 'string', minLength: 1 }
        }
      }
    }
  ];
}

function createAgentMcpStdioServer(deps = {}) {
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : createAgentMcpHostToolRunner(deps);
  const gateway = deps.gateway || createAgentMcpGateway({
    ...deps,
    ...(runTool ? { runTool } : {})
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createMcpToolDefinitions()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = ensureObject(request?.params);
    const result = await gateway.callGatewayTool(
      params.name,
      ensureObject(params.arguments),
      {
        ...getRequestContextFromEnv(env),
        mcpRequest: request
      }
    );
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }],
      isError: result?.ok === false
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: gateway.resourceSearch({ query: '', limit: 40 }).results
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const params = ensureObject(request?.params);
    const result = gateway.resourceRead({ uri: params.uri });
    if (!result.ok) {
      throw new McpError(
        ErrorCode.InvalidParams,
        result.error || `Resource "${params.uri || 'unknown'}" is not available.`
      );
    }
    return {
      contents: [{
        uri: params.uri,
        mimeType: result.mimeType || 'application/json',
        text: typeof result.contents === 'string'
          ? result.contents
          : JSON.stringify(result.contents, null, 2)
      }]
    };
  });

  let transport = null;

  async function connect(externalTransport) {
    transport = externalTransport;
    await server.connect(externalTransport);
    return server;
  }

  async function start() {
    if (transport) {
      return server;
    }
    transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
  }

  async function close() {
    await server.close();
    transport = null;
  }

  return {
    server,
    gateway,
    connect,
    start,
    close
  };
}

if (require.main === module) {
  createAgentMcpStdioServer().start().catch((error) => {
    process.stderr.write(`Hikari MCP stdio server failed to start: ${error?.message || error}\n`);
    process.exit(1);
  });
}

const createCodexAgentMcpStdioServer = createAgentMcpStdioServer;

module.exports = {
  createMcpToolDefinitions,
  createAgentMcpStdioServer,
  createCodexAgentMcpStdioServer,
  getRequestContextFromEnv
};
