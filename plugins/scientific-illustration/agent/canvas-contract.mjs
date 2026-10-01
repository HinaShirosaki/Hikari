// This request contract belongs to the portable plugin, not the host.
import { COMPLEXITY_LEVELS } from '../complexity.mjs';
const objectProperties = {
  id: { type: 'string', maxLength: 100, description: 'Logical object ID, unchanged by rendering. DOM and SVG fragment IDs are namespaced separately.' }, name: { type: 'string', maxLength: 200 },
  type: { type: 'string', enum: ['vector', 'raster', 'text'] }, canvas: { type: 'string', enum: ['main', 'scratch'] },
  x: { type: 'number', description: 'Left of the unrotated object box, in canvas units.' }, y: { type: 'number', description: 'Top of the unrotated object box, in canvas units.' },
  width: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport width in canvas units. SVG aspect ratio may leave space inside this box.' }, height: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport height in canvas units.' },
  rotation: { type: 'number', minimum: -360, maximum: 360, description: 'Clockwise degrees around the center of the object box; x/y remain its unrotated top-left.' }, opacity: { type: 'number', minimum: 0, maximum: 1 }, visible: { type: 'boolean' },
  svg: { type: 'string', maxLength: 300000, description: 'Complete text-free SVG with xmlns and viewBox. Its preserveAspectRatio is honored (default xMidYMid meet); use none only for intentional stretching. A nonzero viewBox origin is supported. currentColor defaults to black, independent of theme; SVG color can override it. Presentation attributes only. Supported: g, defs, path, rect, circle, ellipse, line, polyline, polygon, clipPath, mask and gradients. No text, image, style, script, use or external references. One independently editable component per object.' },
  fill: { type: 'string', description: 'Optional vector-wide fill override: hex or none.' }, stroke: { type: 'string' }, strokeWidth: { type: 'number' },
  dataUrl: { type: 'string', maxLength: 7000000, description: 'Embedded PNG/JPEG/WebP. Prefer operation.raster_asset with plugin_canvas assets to import a file without transmitting base64.' },
  textFree: { type: 'boolean', description: 'Required true for raster. Inspect the generated image and confirm there are no baked-in labels.' },
  text: { type: 'string', maxLength: 3000 }, fontFamily: { type: 'string', maxLength: 100, description: 'Inter is bundled and embedded in SVG exports and previews. Other fonts use installed system fonts.' }, fontSize: { type: 'number', minimum: 4, maximum: 300 },
  fontWeight: { type: 'number', minimum: 100, maximum: 900 }, color: { type: 'string' }, align: { type: 'string', enum: ['start', 'middle', 'end'] },
  anchor: { type: 'string', enum: ['top', 'middle', 'bottom'] }, italic: { type: 'boolean' }, underline: { type: 'boolean' }
};
export const CANVAS_TOOL_CONTRACT = Object.freeze({
  name: 'scientific-illustration',
  description: 'List, create, open and duplicate saved illustrations; read, edit and SEE their main and scratch canvases. Scratch is hidden by default: summon it only when needed with action:scratch, visible:true, and close with visible:false when finished. Hiding preserves contents and read/render access. Pin illustration_id on read/render/apply/scratch to protect against user selection changes. Library mutations require expected_library_revision and request_id. Apply requires expected_revision and request_id; artwork changes are acknowledged after durable persistence. Render returns native PNG images of either or BOTH canvases. Use text-free SVG first and independent text objects for ALL labels. Raster only when SVG is inadequate; inspect it for baked-in text. Every object has independent geometry and styles. Retry uncertain edits with identical arguments and request_id.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'open', 'duplicate', 'read', 'render', 'apply', 'scratch'] }, canvas: { type: 'string', enum: ['main', 'scratch', 'both'], description: 'For render; defaults to both, including hidden scratch.' },
      visible: { type: 'boolean', description: 'Required for scratch action. True summons the scratch panel; false closes it. View-only: no revision/request_id required. Contents remain saved; visibility resets on illustration selection or reload.' },
      illustration_id: { type: 'string', maxLength: 100, description: 'Required for open/duplicate. Use on read/render/apply/scratch to pin the active illustration; a changed selection returns illustration_changed.' },
      title: { type: 'string', maxLength: 200, description: 'Optional title for create/duplicate. Rename existing figures using apply title operation.' },
      expected_library_revision: { type: 'string', maxLength: 100, description: 'Required for create/open/duplicate; obtain from list or read. List takes only action.' },
      include_assets: { type: 'boolean', description: 'Read only: include raster data URLs. SVG sources are always returned.' },
      expected_revision: { type: 'string', maxLength: 100 }, request_id: { type: 'string', maxLength: 100 },
      operations: { type: 'array', minItems: 1, maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['op'], properties: {
          op: { type: 'string', enum: ['upsert', 'update', 'delete', 'transfer', 'canvas', 'order', 'title', 'complexity'] },
          object: { type: 'object', additionalProperties: false, required: ['id', 'type'], properties: objectProperties },
          id: { type: 'string', maxLength: 100 },
          patch: { type: 'object', description: 'update: object properties (set vector fill, stroke, or strokeWidth to null to restore original artwork); canvas: width, height, background.' },
          canvas: { type: 'string', enum: ['main', 'scratch'] }, copy: { type: 'boolean' }, new_id: { type: 'string', maxLength: 100 },
          ids: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Order every object on the specified canvas, back to front.' },
          title: { type: 'string', maxLength: 200 },
          complexity: { type: 'string', enum: COMPLEXITY_LEVELS, description: 'For the complexity operation: saved figure detail level. Change only when the user requests it. Read returns matching drawing instructions.' },
          raster_asset: { type: 'string', maxLength: 2400, description: 'ID of an image supplied in plugin_canvas assets. For upsert/update only. Set textFree: true in object/patch after visual inspection.' }
        }
      } }
    }
  }
});
