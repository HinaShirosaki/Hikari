'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateValueAgainstSchema } = require('../../tools/tool-loading/schema-validation.js');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_OUTPUT_MCP_TOOL = Object.freeze({
  name: 'image_output',
  description: 'Display a saved analysis image inline in Hikari Agent Chat and preserve it in chat history. Save the image inside the Hikari storage workspace first. Supports PNG, JPEG, and WebP up to 5 MiB; does not generate images.',
  annotations: { title: 'Display analysis image', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['path', 'alt'],
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 2400, description: 'Image file path inside Hikari storage. Relative paths resolve from the storage workspace; absolute paths must remain inside it.' },
      alt: { type: 'string', minLength: 1, maxLength: 2000, description: 'Accessible description of the image and its key result.' },
      title: { type: 'string', maxLength: 220 },
      caption: { type: 'string', maxLength: 2000, description: 'Optional visible explanation, including units or analysis context.' }
    }
  }
});

function imageMimeType(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) && bytes.readUInt32BE(20)) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

async function callImageOutput(input = {}, _context = {}, deps = {}) {
  const fail = (status, error) => ({ ok: false, status, mcp_tool: 'image_output', error });
  const validation = validateValueAgainstSchema(input, IMAGE_OUTPUT_MCP_TOOL.inputSchema, IMAGE_OUTPUT_MCP_TOOL.inputSchema);
  if (!validation.ok || !input.path?.trim() || !input.alt?.trim()) return fail('invalid_arguments', validation.error || 'path and alt must be nonempty.');
  if (!deps.workspacePath) return fail('unavailable', 'Set a Hikari storage workspace before publishing images.');
  const io = deps.fs || fs;
  let handle;
  try {
    const root = await io.realpath(deps.workspacePath);
    const file = await io.realpath(path.resolve(root, input.path));
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return fail('invalid_path', 'The image must be inside the Hikari storage workspace.');
    }
    handle = await io.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return fail('invalid_image', 'The image path must be a regular file.');
    if (!stat.size || stat.size > MAX_IMAGE_BYTES) return fail('invalid_image', 'Images must be nonempty and at most 5 MiB.');
    // A bounded read also protects against files growing after stat().
    const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_IMAGE_BYTES) return fail('invalid_image', 'Images must be at most 5 MiB.');
    const bytes = buffer.subarray(0, size);
    const mimeType = imageMimeType(bytes);
    if (!mimeType) return fail('invalid_image', 'Expected PNG, JPEG, or WebP image bytes. Export SVG/PDF figures to PNG first.');
    const title = (input.title || path.basename(file)).trim();
    const caption = (input.caption || '').trim();
    const alt = input.alt.trim();
    return {
      ok: true, status: 'completed', mcp_tool: 'image_output',
      image_artifact: {
        type: 'image', id: createHash('sha256').update(bytes).update(JSON.stringify([title, caption, alt])).digest('hex'),
        title, caption, alt, mime_type: mimeType, byte_length: size,
        data_url: `data:${mimeType};base64,${bytes.toString('base64')}`
      }
    };
  } catch (error) {
    return fail(error.code === 'ENOENT' ? 'not_found' : 'read_failed', error.code === 'ENOENT'
      ? 'Image file not found. Save the image inside Hikari storage before calling image_output.'
      : 'Could not read the analysis image. Check the file path and read permissions.');
  } finally {
    await handle?.close();
  }
}

// Keep binary bytes in MCP image content, out of model-facing JSON text.
function buildImageOutputMcpResponse(result) {
  const { data_url: dataUrl, ...metadata } = result.image_artifact;
  const structuredContent = { ...result, image_artifact: metadata };
  return {
    content: [
      { type: 'text', text: JSON.stringify(structuredContent) },
      { type: 'image', mimeType: metadata.mime_type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
    ],
    structuredContent, isError: false
  };
}

module.exports = { IMAGE_OUTPUT_MCP_TOOL, MAX_IMAGE_BYTES, callImageOutput, buildImageOutputMcpResponse };
