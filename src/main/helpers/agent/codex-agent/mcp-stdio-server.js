#!/usr/bin/env node
'use strict';

const { createCodexAgentMcpGateway } = require('./mcp-gateway.js');
const { createCodexMcpHostToolRunner } = require('./mcp-host-client.js');
const { getDirectMcpToolDefinitions } = require('./mcp-tools/index.js');

function cleanText(value, maxLength = 1000) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

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
  return parseJsonObject(env.HIKARI_CODEX_REQUEST_CONTEXT || env.ENANA_CODEX_REQUEST_CONTEXT);
}

function createMcpToolDefinitions() {
  return [
    ...getDirectMcpToolDefinitions(),
    {
      name: 'tool_search',
      description: 'Search Hikari app tools by natural-language goal.',
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

function createJsonRpcError(code, message) {
  return {
    code,
    message: cleanText(message, 1000) || 'JSON-RPC error'
  };
}

function createCodexAgentMcpStdioServer(deps = {}) {
  const input = deps.input || process.stdin;
  const output = deps.output || process.stdout;
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : createCodexMcpHostToolRunner(deps);
  const gateway = deps.gateway || createCodexAgentMcpGateway({
    ...deps,
    ...(runTool ? { runTool } : {})
  });
  let buffer = Buffer.alloc(0);

  function writeMessage(message) {
    const body = JSON.stringify(message);
    output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  function sendResponse(id, result) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result
    });
  }

  function sendError(id, error) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error
    });
  }

  async function handleRequest(message) {
    const source = ensureObject(message);
    const id = source.id;
    const params = ensureObject(source.params);
    const method = cleanText(source.method, 160);
    const isNotification = !Object.prototype.hasOwnProperty.call(source, 'id');
    if (isNotification) {
      return;
    }

    try {
      if (method === 'initialize') {
        sendResponse(id, {
          protocolVersion: cleanText(params.protocolVersion, 80) || '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false }
          },
          serverInfo: {
            name: 'hikari-codex-agent',
            version: '0.1.0'
          }
        });
        return;
      }
      if (method === 'tools/list') {
        sendResponse(id, { tools: createMcpToolDefinitions() });
        return;
      }
      if (method === 'tools/call') {
        const result = await gateway.callGatewayTool(
          cleanText(params.name, 120),
          ensureObject(params.arguments),
          {
            ...getRequestContextFromEnv(deps.env || process.env),
            mcpRequest: source
          }
        );
        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }],
          isError: result?.ok === false
        });
        return;
      }
      if (method === 'resources/list') {
        sendResponse(id, {
          resources: gateway.resourceSearch({ query: '', limit: 40 }).results
        });
        return;
      }
      if (method === 'resources/read') {
        const result = gateway.resourceRead({ uri: params.uri });
        if (!result.ok) {
          sendError(id, createJsonRpcError(-32004, result.error));
          return;
        }
        sendResponse(id, {
          contents: [{
            uri: cleanText(params.uri, 1000),
            mimeType: cleanText(result.mimeType, 120) || 'application/json',
            text: typeof result.contents === 'string'
              ? result.contents
              : JSON.stringify(result.contents, null, 2)
          }]
        });
        return;
      }
      if (method === 'ping') {
        sendResponse(id, {});
        return;
      }
      sendError(id, createJsonRpcError(-32601, `Method "${method || 'unknown'}" is not supported.`));
    } catch (error) {
      sendError(id, createJsonRpcError(-32603, error?.message || 'Hikari MCP bridge failed.'));
    }
  }

  function drainBuffer() {
    while (buffer.length) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const headerText = buffer.slice(0, headerEnd).toString('utf8');
      const lengthMatch = /^Content-Length:\s*(\d+)\s*$/im.exec(headerText);
      if (!lengthMatch) {
        buffer = Buffer.alloc(0);
        return;
      }
      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        return;
      }
      const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.slice(bodyEnd);
      try {
        handleRequest(JSON.parse(body));
      } catch (error) {
        sendError(null, createJsonRpcError(-32700, error?.message || 'Invalid JSON-RPC message.'));
      }
    }
  }

  function start() {
    input.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      drainBuffer();
    });
    return gateway;
  }

  return {
    start,
    handleRequest,
    gateway
  };
}

if (require.main === module) {
  createCodexAgentMcpStdioServer().start();
}

module.exports = {
  createMcpToolDefinitions,
  createCodexAgentMcpStdioServer,
  getRequestContextFromEnv
};
