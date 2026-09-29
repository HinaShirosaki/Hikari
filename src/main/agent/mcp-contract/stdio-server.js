#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fs = require('node:fs');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

function loadOptionalResponseBuilder(modulePath, exportName) {
  try {
    const builder = require(modulePath)?.[exportName];
    return typeof builder === 'function' ? builder : null;
  } catch {
    return null;
  }
}

const buildHtmlOutputMcpResponse = loadOptionalResponseBuilder(
  './direct-tools/html-output.js',
  'buildHtmlOutputMcpResponse'
);
const buildImageOutputMcpResponse = loadOptionalResponseBuilder(
  './direct-tools/image-output.js',
  'buildImageOutputMcpResponse'
);
const { createAgentMcpGateway } = require('./gateway.js');
const { createAgentMcpHostToolRunner } = require('./host-client.js');
const { getDirectMcpToolDefinitions } = require('./direct-tools/index.js');
const { buildHikariAgentMcpInstructions } = require('./instructions.js');
const { ensureObject } = require('../../lib/normalize.js');
const { buildMcpToolResponseContent, isPaperAnalysisResult } = require('./result-shaping/paper-results.js');

const SERVER_NAME = 'hikari-agent-mcp';
const SERVER_VERSION = '0.1.0';

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function parseJsonObject(raw = '') {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function getPersistedAgentSettingsFromEnv(env = process.env) {
  const dataFilePath = cleanText(env.HIKARI_AGENT_DATA_FILE, 2400);
  if (!dataFilePath) {
    return {};
  }
  try {
    const persisted = parseJsonObject(fs.readFileSync(dataFilePath, 'utf8'));
    return ensureObject(ensureObject(persisted.settings).agent);
  } catch {
    return {};
  }
}

function getRequestContextFromEnv(env = process.env) {
  const context = parseJsonObject(
    env.HIKARI_AGENT_MCP_REQUEST_CONTEXT
      || env.HIKARI_CODEX_REQUEST_CONTEXT
  );
  // A token embedded in a shared/stale request snapshot is never authority.
  context.fileAccessToken = String(env.HIKARI_FILE_ACCESS_TOKEN || '');
  const persistedAgentSettings = getPersistedAgentSettingsFromEnv(env);
  if (!Object.keys(persistedAgentSettings).length) {
    return context;
  }
  const snapshot = ensureObject(context.snapshot);
  const settings = ensureObject(snapshot.settings || context.settings);
  const contextAgentSettings = ensureObject(settings.agent);
  const hasRequestToolSetting = Object.prototype.hasOwnProperty.call(contextAgentSettings, 'disabledMcpToolNames')
    || Object.prototype.hasOwnProperty.call(contextAgentSettings, 'disabled_mcp_tool_names');
  if (hasRequestToolSetting) {
    return context;
  }
  return {
    ...context,
    snapshot: {
      ...snapshot,
      settings: {
        ...settings,
        agent: {
          ...persistedAgentSettings,
          ...contextAgentSettings
        }
      }
    }
  };
}

function createMcpToolDefinitions(context = {}) {
  return getDirectMcpToolDefinitions(context);
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
    {
      capabilities: { tools: { listChanged: false } },
      instructions: buildHikariAgentMcpInstructions()
    }
  );
  let literatureSearchCalls = 0;
  let literatureSearchTurnKey = null;

  // The one-literature_search-per-turn budget is keyed on the request context's
  // turn id, not on process lifetime. Codex respawns this stdio server per request
  // today, so a bare counter happens to reset; keying it explicitly means a reused
  // server cannot carry a spent budget into the next turn and reject every later
  // search with a message that claims the current turn already used one.
  function claimLiteratureSearchCall(turnKey) {
    if (turnKey !== literatureSearchTurnKey) {
      literatureSearchTurnKey = turnKey;
      literatureSearchCalls = 0;
    }
    if (literatureSearchCalls >= 1) {
      return false;
    }
    literatureSearchCalls += 1;
    return true;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createMcpToolDefinitions(getRequestContextFromEnv(env))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = ensureObject(request?.params);
    const toolName = cleanText(params.name, 160);
    const requestContext = getRequestContextFromEnv(env);
    const turnKey = cleanText(requestContext.traceRequestId || requestContext.codexSessionId, 240);
    if (toolName === 'literature_search'
      && !ensureObject(params.arguments).research_id
      && !requestContext.snapshot?.literature_research?.id
      && !claimLiteratureSearchCall(turnKey)) {
      const result = {
        ok: false,
        status: 'rejected',
        mcp_tool: toolName,
        app_tool: 'literature-search',
        error: 'This Codex turn already completed one literature_search request. Use its structured result to answer, or ask the user to start a refinement turn.'
      };
      return {
        content: [{
          type: 'text',
          text: buildMcpToolResponseContent(toolName, result)
        }],
        structuredContent: result,
        isError: true
      };
    }
    const result = await gateway.callGatewayTool(
      toolName,
      ensureObject(params.arguments),
      {
        ...requestContext,
        mcpRequest: request
      }
    );
    if (toolName === 'html_output'
      && typeof buildHtmlOutputMcpResponse === 'function'
      && result?.ok === true
      && result.html_artifact?.html) return buildHtmlOutputMcpResponse(result);
    if (toolName === 'image_output'
      && typeof buildImageOutputMcpResponse === 'function'
      && result?.ok === true
      && result.image_artifact?.data_url) {
      return buildImageOutputMcpResponse(result);
    }
    const response = {
      content: [{
        type: 'text',
        text: buildMcpToolResponseContent(toolName, result)
      }],
      isError: result?.ok === false
    };
    // paper_analysis already carries every selected line and comment in its one
    // compact text payload. Repeating the full gateway result here made Codex
    // serialize two copies and truncate the otherwise-valid response.
    if (!isPaperAnalysisResult(toolName, result) && !/(?:^|__)notebook_draft$/.test(toolName)) {
      response.structuredContent = ensureObject(result);
    }
    return response;
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
  getRequestContextFromEnv,
  buildMcpToolResponseContent
};
