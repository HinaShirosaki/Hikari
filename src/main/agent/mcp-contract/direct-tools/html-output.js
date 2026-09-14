'use strict';
const { createHash } = require('node:crypto');
const { validateValueAgainstSchema } = require('../../tools/tool-loading/schema-validation.js');
const MAX_HTML_BYTES = 512 * 1024;
const HTML_OUTPUT_MCP_TOOL = Object.freeze({
  name: 'html_output',
  description: 'Display a self-contained interactive HTML document inline in Hikari Agent Chat and preserve its source in chat history. Inline CSS and JavaScript work in an isolated frame. No network, local files, Hikari APIs, popups, downloads, or persistent browser storage. Maximum 512 KiB UTF-8.',
  annotations: { title: 'Display interactive HTML', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['title', 'html'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 220, description: 'Visible title and accessible frame label.' },
      html: { type: 'string', minLength: 1, maxLength: MAX_HTML_BYTES, description: 'Complete self-contained HTML document with inline CSS, JavaScript, and data. Use no CDN imports, fetch, relative assets, or local file paths.' },
      caption: { type: 'string', maxLength: 2000 },
      height: { type: 'integer', minimum: 16, maximum: 64, description: 'Initial frame height in rem (default 32); the frame scrolls for longer content.' }
    }
  }
});

async function callHtmlOutput(input = {}) {
  const fail = error => ({ ok: false, status: 'invalid_arguments', mcp_tool: 'html_output', error });
  const validation = validateValueAgainstSchema(input, HTML_OUTPUT_MCP_TOOL.inputSchema, HTML_OUTPUT_MCP_TOOL.inputSchema);
  if (!validation.ok) return fail(validation.error);
  if (!input.title.trim() || !input.html.trim() || input.html.includes('\0')) return fail('title and html must be nonempty; HTML must not contain NUL bytes.');
  if (Buffer.byteLength(input.html, 'utf8') > MAX_HTML_BYTES) return fail('HTML must be at most 512 KiB UTF-8.');
  const source = { type: 'html', title: input.title.trim(), caption: (input.caption || '').trim(), height: input.height || 32, html: input.html };
  return {
    ok: true, status: 'completed', mcp_tool: 'html_output',
    html_artifact: { ...source, id: createHash('sha256').update(JSON.stringify(source)).digest('hex') }
  };
}

function buildHtmlOutputMcpResponse(result) {
  const { html, ...metadata } = result.html_artifact;
  const structuredContent = { ...result, html_artifact: metadata };
  return {
    content: [
      { type: 'text', text: JSON.stringify(structuredContent) },
      { type: 'resource', resource: { uri: `hikari-html-artifact://${metadata.id}`, mimeType: 'text/html', text: html } }
    ],
    structuredContent, isError: false
  };
}
module.exports = { HTML_OUTPUT_MCP_TOOL, MAX_HTML_BYTES, callHtmlOutput, buildHtmlOutputMcpResponse };
