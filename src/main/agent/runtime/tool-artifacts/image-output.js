'use strict';

const MAX_DATA_URL_LENGTH = Math.ceil(5 * 1024 * 1024 / 3) * 4 + 40;

function normalizeImageArtifact(source) {
  if (!source || source.type !== 'image' || typeof source.data_url !== 'string'
    || source.data_url.length > MAX_DATA_URL_LENGTH
    || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.data_url)) return null;
  const mimeType = source.data_url.slice(5, source.data_url.indexOf(';'));
  if (source.mime_type !== mimeType || !source.id || !source.alt) return null;
  return {
    type: 'image', id: String(source.id).slice(0, 100), mime_type: mimeType,
    title: String(source.title || '').slice(0, 220), alt: String(source.alt).slice(0, 2000),
    caption: String(source.caption || '').slice(0, 2000), data_url: source.data_url
  };
}

function extractImageArtifactFromToolOutput(toolName, output, depth = 0) {
  if (!/(?:^|__)image_output$/.test(String(toolName)) || depth > 8 || !output) return null;
  if (typeof output === 'string') {
    try { return extractImageArtifactFromToolOutput(toolName, JSON.parse(output), depth + 1); } catch { return null; }
  }
  if (typeof output !== 'object' || output.isError === true || output.ok === false) return null;
  const direct = normalizeImageArtifact(output.image_artifact || output);
  if (direct) return direct;
  // MCP uses one binary image block plus structured metadata, without duplicating base64 in JSON.
  const metadata = output.structuredContent?.image_artifact || output.structured_content?.image_artifact;
  const image = Array.isArray(output.content) && output.content.find(item => item?.type === 'image');
  if (metadata && image) {
    const artifact = normalizeImageArtifact({ ...metadata, data_url: `data:${image.mimeType};base64,${image.data}` });
    if (artifact) return artifact;
  }
  const candidates = Array.isArray(output) ? output : [output.image_artifact, output.meta?.image_artifact,
    output.structuredContent, output.structured_content, output.Ok, output.result, output.output,
    output.tool_result, output.tool_output, output.content, output.text];
  for (const candidate of candidates) {
    const artifact = extractImageArtifactFromToolOutput(toolName, candidate, depth + 1);
    if (artifact) return artifact;
  }
  return null;
}

function extractImageArtifactFromToolEvent(event = {}) {
  return extractImageArtifactFromToolOutput(event.tool_name || event.toolName, event);
}

function mergeImageArtifacts(existing = [], incoming = []) {
  const byId = new Map();
  for (const value of [...existing, ...incoming]) {
    const image = normalizeImageArtifact(value);
    if (image) byId.set(image.id, image);
  }
  return [...byId.values()];
}

module.exports = { normalizeImageArtifact, extractImageArtifactFromToolOutput, extractImageArtifactFromToolEvent, mergeImageArtifacts };
