'use strict';

const { runAppTool, buildWriteToolAnnotations } = require('./shared.js');
const { validateValueAgainstSchema } = require('../../tools/tool-loading/schema-validation.js');
const { callImageOutput, imageMimeType, MAX_IMAGE_BYTES } = require('./image-output.js');

const PLUGIN_CANVAS_MCP_TOOL = Object.freeze({
  name: 'plugin_canvas',
  description: 'Read, edit and render an installed local plugin with agent:canvas permission. Begin with plugin_id and request:{action:"read"} to discover its own request schema and instructions. Render returns native images for visual inspection, even while the view is hidden. Optional assets import PNG/JPEG/WebP files inside Hikari storage (5 MiB each, 8 MiB combined). The host never imports plugin modules.',
  annotations: buildWriteToolAnnotations('Installed plugin canvases'),
  inputSchema: { type: 'object', additionalProperties: false, required: ['plugin_id', 'request'], properties: {
    plugin_id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    request: { type: 'object', description: 'Plugin-owned request. Start with {action:"read"}.' },
    assets: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'path'], properties: {
      id: { type: 'string', minLength: 1, maxLength: 100 },
      path: { type: 'string', minLength: 1, maxLength: 2400, description: 'PNG/JPEG/WebP path inside Hikari storage.' }
    } } }
  } }
});
async function callPluginCanvas(input = {}, context = {}, deps = {}) {
  const fail = (status, error) => ({ ok: false, status, error, mcp_tool: 'plugin_canvas' });
  const validation = validateValueAgainstSchema(input, PLUGIN_CANVAS_MCP_TOOL.inputSchema, PLUGIN_CANVAS_MCP_TOOL.inputSchema);
  if (!validation.ok) return fail('invalid_arguments', validation.error);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.plugin_id)) return fail('invalid_arguments', 'plugin_id must be a kebab-case plugin ID.');
  if (JSON.stringify(input.request).length > 12000000) return fail('invalid_arguments', 'Plugin requests must be at most 12 million characters.');
  const assets = Object.create(null);
  let size = 0;
  for (const asset of input.assets || []) {
    if (Object.hasOwn(assets, asset.id)) return fail('invalid_arguments', 'Asset IDs must be unique.');
    const image = await callImageOutput({ path: asset.path, alt: 'Plugin canvas asset' }, context, deps);
    if (!image.ok) return fail(image.status, image.error);
    size += image.image_artifact.byte_length;
    if (size > 8 * 1024 * 1024) return fail('invalid_arguments', 'Combined assets must be at most 8 MiB.');
    assets[asset.id] = { mime_type: image.image_artifact.mime_type, data_url: image.image_artifact.data_url };
  }
  const result = await runAppTool({ runTool: deps.runTool, toolId: 'plugin-canvas', args: { plugin_id: input.plugin_id, request: input.request, assets }, context });
  if (result?.ok && result.previews !== undefined) {
    if (!Array.isArray(result.previews) || result.previews.length > 8) return fail('invalid_response', 'Expected at most eight canvas previews.');
    for (const preview of result.previews) {
      const match = typeof preview?.data_url === 'string' && preview.data_url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return fail('invalid_response', 'Invalid canvas preview bytes.');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > MAX_IMAGE_BYTES || imageMimeType(bytes) !== match[1]) return fail('invalid_response', 'Expected PNG, JPEG or WebP previews up to 5 MiB each.');
    }
  }
  return { ...result, mcp_tool: 'plugin_canvas' };
}
function buildPluginCanvasMcpResponse(result) {
  const previews = result.previews || [];
  const structuredContent = { ...result, previews: previews.map(({ data_url: _dataUrl, ...metadata }) => metadata) };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }, ...previews.flatMap(preview => [
    { type: 'text', text: `${preview.canvas || 'Plugin'} canvas (${preview.width} × ${preview.height})` },
    { type: 'image', mimeType: preview.data_url.slice(5, preview.data_url.indexOf(';')), data: preview.data_url.split(',')[1] }
  ])], structuredContent, isError: result.ok === false };
}
module.exports = { PLUGIN_CANVAS_MCP_TOOL, callPluginCanvas, buildPluginCanvasMcpResponse };
