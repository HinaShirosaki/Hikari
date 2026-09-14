'use strict';
const MAX_HTML_BYTES = 512 * 1024;
function normalizeHtmlArtifact(source) {
  if (!source || source.type !== 'html' || !/^[a-f0-9]{64}$/.test(source.id)
    || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 220
    || typeof source.html !== 'string' || !source.html.trim() || source.html.includes('\0')
    || Buffer.byteLength(source.html, 'utf8') > MAX_HTML_BYTES) return null;
  return { type: 'html', id: source.id, title: source.title, html: source.html,
    caption: String(source.caption || '').slice(0, 2000),
    height: Number.isInteger(source.height) && source.height >= 16 && source.height <= 64 ? source.height : 32 };
}
function extractHtmlArtifactFromToolOutput(toolName, output, depth = 0) {
  if (!/(?:^|__)html_output$/.test(String(toolName)) || depth > 8 || !output) return null;
  if (typeof output === 'string') {
    try { return extractHtmlArtifactFromToolOutput(toolName, JSON.parse(output), depth + 1); } catch { return null; }
  }
  if (typeof output !== 'object' || output.isError === true || output.ok === false) return null;
  const direct = normalizeHtmlArtifact(output.html_artifact || output);
  if (direct) return direct;
  const metadata = output.structuredContent?.html_artifact || output.structured_content?.html_artifact;
  const resource = Array.isArray(output.content) && output.content.find(item => item?.type === 'resource' && item.resource?.mimeType === 'text/html')?.resource;
  if (metadata && resource) {
    const artifact = normalizeHtmlArtifact({ ...metadata, html: resource.text });
    if (artifact) return artifact;
  }
  const candidates = Array.isArray(output) ? output : [output.html_artifact, output.meta?.html_artifact,
    output.structuredContent, output.structured_content, output.Ok, output.result, output.output,
    output.tool_result, output.tool_output, output.content, output.text];
  for (const candidate of candidates) {
    const artifact = extractHtmlArtifactFromToolOutput(toolName, candidate, depth + 1);
    if (artifact) return artifact;
  }
  return null;
}
function extractHtmlArtifactFromToolEvent(event = {}) {
  return extractHtmlArtifactFromToolOutput(event.tool_name || event.toolName, event);
}
function mergeHtmlArtifacts(existing = [], incoming = []) {
  const byId = new Map();
  for (const source of [...existing, ...incoming]) {
    const artifact = normalizeHtmlArtifact(source);
    if (artifact) byId.set(artifact.id, artifact);
  }
  return [...byId.values()];
}
module.exports = { normalizeHtmlArtifact, extractHtmlArtifactFromToolOutput, extractHtmlArtifactFromToolEvent, mergeHtmlArtifacts };
