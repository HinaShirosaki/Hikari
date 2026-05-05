'use strict';

const http = require('node:http');
const https = require('node:https');

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

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        ...headers
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += String(chunk || '');
      });
      response.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = raw ? JSON.parse(raw) : {};
        } catch {
          parsedBody = { ok: false, error: raw || 'Invalid Hikari MCP host response.' };
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsedBody);
          return;
        }
        const error = new Error(cleanText(parsedBody?.error || raw, 1200) || `Hikari MCP host returned ${response.statusCode}.`);
        error.statusCode = response.statusCode;
        error.payload = parsedBody;
        reject(error);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function createCodexMcpHostToolRunner(options = {}) {
  const hostUrl = cleanText(
    options.hostUrl || process.env.HIKARI_CODEX_MCP_HOST || process.env.ENANA_CODEX_MCP_HOST,
    2000
  ).replace(/\/+$/u, '');
  const token = cleanText(
    options.token || process.env.HIKARI_CODEX_MCP_TOKEN || process.env.ENANA_CODEX_MCP_TOKEN,
    4000
  );
  if (!hostUrl) {
    return null;
  }

  return async (toolId, args, snapshot = {}, context = {}) => {
    const response = await postJson(
      `${hostUrl}/tool-call`,
      {
        tool_id: toolId,
        args: ensureObject(args),
        snapshot: ensureObject(snapshot),
        context: ensureObject(context)
      },
      token ? { Authorization: `Bearer ${token}` } : {}
    );
    return response && Object.prototype.hasOwnProperty.call(response, 'output')
      ? response.output
      : response;
  };
}

module.exports = {
  createCodexMcpHostToolRunner,
  postJson
};
