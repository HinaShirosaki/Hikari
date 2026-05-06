'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(raw = '', fallback = {}) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createCodexAgentMcpHost(deps = {}) {
  const runTool = typeof deps.runTool === 'function' ? deps.runTool : null;
  const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : (() => ({}));
  const getContextDefaults = typeof deps.getContextDefaults === 'function'
    ? deps.getContextDefaults
    : (() => ({}));
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const hostname = cleanText(deps.hostname, 120) || '127.0.0.1';
  const token = cleanText(deps.token, 4000) || crypto.randomBytes(24).toString('hex');
  const maxBodyBytes = Math.max(1024, Math.min(10 * 1024 * 1024, Number(deps.maxBodyBytes) || 5 * 1024 * 1024));
  const previousHikariHostEnv = Object.prototype.hasOwnProperty.call(env, 'HIKARI_CODEX_MCP_HOST')
    ? env.HIKARI_CODEX_MCP_HOST
    : null;
  const previousHikariTokenEnv = Object.prototype.hasOwnProperty.call(env, 'HIKARI_CODEX_MCP_TOKEN')
    ? env.HIKARI_CODEX_MCP_TOKEN
    : null;
  const previousEnanaHostEnv = Object.prototype.hasOwnProperty.call(env, 'ENANA_CODEX_MCP_HOST')
    ? env.ENANA_CODEX_MCP_HOST
    : null;
  const previousEnanaTokenEnv = Object.prototype.hasOwnProperty.call(env, 'ENANA_CODEX_MCP_TOKEN')
    ? env.ENANA_CODEX_MCP_TOKEN
    : null;
  let server = null;
  let started = null;
  let hostUrl = '';

  function writeJson(response, statusCode, payload = {}) {
    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body, 'utf8')
    });
    response.end(body);
  }

  function readRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = '';
      let total = 0;
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        const text = String(chunk || '');
        total += Buffer.byteLength(text, 'utf8');
        if (total > maxBodyBytes) {
          reject(new Error('Hikari MCP host request is too large.'));
          request.destroy();
          return;
        }
        raw += text;
      });
      request.on('end', () => resolve(raw));
      request.on('error', reject);
    });
  }

  function isAuthorized(request) {
    if (!token) {
      return true;
    }
    const auth = cleanText(request.headers.authorization, 5000);
    const hikariHeaderToken = cleanText(request.headers['x-hikari-codex-mcp-token'], 5000);
    const enanaHeaderToken = cleanText(request.headers['x-enana-codex-mcp-token'], 5000);
    return auth === `Bearer ${token}` || hikariHeaderToken === token || enanaHeaderToken === token;
  }

  async function handleToolCall(request, response) {
    if (!runTool) {
      writeJson(response, 503, {
        ok: false,
        status: 'executor_unavailable',
        error: 'Hikari MCP tool execution is not connected to the app runtime.'
      });
      return;
    }
    if (!isAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        status: 'unauthorized',
        error: 'Hikari MCP host token is missing or invalid.'
      });
      return;
    }

    const body = parseJson(await readRequestBody(request), {});
    const toolId = cleanText(body.tool_id || body.toolId, 160);
    const args = ensureObject(body.args);
    const context = {
      ...ensureObject(getContextDefaults()),
      ...ensureObject(body.context),
      codexMcp: true
    };
    const snapshot = Object.keys(ensureObject(body.snapshot)).length
      ? ensureObject(body.snapshot)
      : ensureObject(getSnapshot());
    const result = await runTool(toolId, args, snapshot, context);
    writeJson(response, 200, {
      ok: result?.ok !== false,
      status: result?.ok === false ? 'failed' : 'completed',
      tool_id: toolId,
      output: result
    });
  }

  async function handleRequest(request, response) {
    try {
      const requestUrl = new URL(request.url || '/', `http://${hostname}`);
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(response, 200, {
          ok: true,
          name: 'hikari-codex-agent-mcp-host'
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/tool-call') {
        await handleToolCall(request, response);
        return;
      }
      writeJson(response, 404, {
        ok: false,
        error: 'Unknown Hikari MCP host route.'
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: cleanText(error?.message || error, 1200) || 'Hikari MCP host failed.'
      });
    }
  }

  async function ensureStarted() {
    if (hostUrl) {
      return {
        url: hostUrl,
        token
      };
    }
    if (started) {
      return started;
    }
    server = http.createServer((request, response) => {
      void handleRequest(request, response);
    });
    started = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, hostname, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        hostUrl = `http://${hostname}:${port}`;
        env.HIKARI_CODEX_MCP_HOST = hostUrl;
        env.HIKARI_CODEX_MCP_TOKEN = token;
        env.ENANA_CODEX_MCP_HOST = hostUrl;
        env.ENANA_CODEX_MCP_TOKEN = token;
        resolve({
          url: hostUrl,
          token
        });
      });
    });
    return started;
  }

  async function close() {
    if (!server) {
      return;
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    started = null;
    hostUrl = '';
    if (previousHikariHostEnv === null) {
      delete env.HIKARI_CODEX_MCP_HOST;
    } else {
      env.HIKARI_CODEX_MCP_HOST = previousHikariHostEnv;
    }
    if (previousHikariTokenEnv === null) {
      delete env.HIKARI_CODEX_MCP_TOKEN;
    } else {
      env.HIKARI_CODEX_MCP_TOKEN = previousHikariTokenEnv;
    }
    if (previousEnanaHostEnv === null) {
      delete env.ENANA_CODEX_MCP_HOST;
    } else {
      env.ENANA_CODEX_MCP_HOST = previousEnanaHostEnv;
    }
    if (previousEnanaTokenEnv === null) {
      delete env.ENANA_CODEX_MCP_TOKEN;
    } else {
      env.ENANA_CODEX_MCP_TOKEN = previousEnanaTokenEnv;
    }
  }

  return {
    ensureStarted,
    close,
    getHostUrl: () => hostUrl,
    getToken: () => token
  };
}

module.exports = {
  createCodexAgentMcpHost
};
