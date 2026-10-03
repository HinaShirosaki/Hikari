// This request contract belongs to the portable plugin, not the host.
import { COMPLEXITY_LEVELS } from '../complexity.mjs';
const objectProperties = {
  id: { type: 'string', maxLength: 100, description: 'Logical object ID, unchanged by rendering. DOM and SVG fragment IDs are namespaced separately.' }, name: { type: 'string', maxLength: 200, description: 'Layer name shown to the user; defaults to id.' },
  type: { type: 'string', enum: ['vector', 'raster', 'text'] }, canvas: { type: 'string', enum: ['main', 'scratch'] },
  x: { type: 'number', description: 'Left of the unrotated object box, in canvas units.' }, y: { type: 'number', description: 'Top of the unrotated object box, in canvas units.' },
  width: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport width in canvas units. SVG aspect ratio may leave space inside this box; raster import sets height from width to match the image.' }, height: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport height in canvas units.' },
  rotation: { type: 'number', minimum: -360, maximum: 360, description: 'Clockwise degrees around the center of the object box; x/y remain its unrotated top-left.' }, opacity: { type: 'number', minimum: 0, maximum: 1 }, visible: { type: 'boolean' },
  svg: { type: 'string', maxLength: 300000, description: 'Complete SVG with xmlns and viewBox. Its preserveAspectRatio is honored (default xMidYMid meet); use none only for intentional stretching. A nonzero viewBox origin is supported. currentColor defaults to black, independent of theme; SVG color can override it. Presentation attributes only. Supported: g, defs, path, rect, circle, ellipse, line, polyline, polygon, clipPath, mask and gradients. No text, image, style, script, use or external references. One independently editable component per object.' },
  fill: { type: 'string', description: 'Optional vector-wide fill override: hex or none.' }, stroke: { type: 'string' }, strokeWidth: { type: 'number' },
  dataUrl: { type: 'string', maxLength: 7000000, description: 'Embedded PNG/JPEG/WebP. Prefer operation.raster_asset with plugin_canvas assets to import a file without transmitting base64.' },
  textFree: { type: 'boolean', description: 'Required true for raster, after checking the image has no baked-in text.' },
  text: { type: 'string', maxLength: 3000 }, fontFamily: { type: 'string', maxLength: 100, description: 'Inter is bundled and embedded in SVG exports and previews. Other fonts use installed system fonts.' }, fontSize: { type: 'number', minimum: 4, maximum: 300 },
  fontWeight: { type: 'number', minimum: 100, maximum: 900 }, color: { type: 'string' }, align: { type: 'string', enum: ['start', 'middle', 'end'] },
  anchor: { type: 'string', enum: ['top', 'middle', 'bottom'] }, italic: { type: 'boolean' }, underline: { type: 'boolean' }
};
export const CANVAS_TOOL_CONTRACT = Object.freeze({
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'open', 'duplicate', 'read', 'render', 'apply', 'scratch', 'inspect'] }, canvas: { type: 'string', enum: ['main', 'scratch', 'both'], description: 'For render; defaults to both, including hidden scratch.' },
      inspection_id: { type: 'string', maxLength: 100, description: 'For inspect: returned by rendering both canvases at the current revision in this run. Any edit, undo/redo, reload or new run requires a fresh render.' },
      review: { type: 'object', additionalProperties: false, required: ['layout', 'labels', 'artwork', 'science'], description: 'For inspect: what you observed in the rendered images.', properties: {
        layout: { type: 'string', minLength: 1, maxLength: 1000, description: 'Placement, scale, clipping and overlaps on main and scratch.' },
        labels: { type: 'string', minLength: 1, maxLength: 1000, description: 'Readability, alignment and separate editable text layers.' },
        artwork: { type: 'string', minLength: 1, maxLength: 1000, description: 'No baked-in text; vector/raster component appearance and selection bounds.' },
        science: { type: 'string', minLength: 1, maxLength: 1000, description: 'Scientific relationships, arrow direction and consistency with the user request; state any remaining uncertainty.' }
      } },
      visible: { type: 'boolean', description: 'Required for scratch action. True summons the scratch panel; false closes it. View-only: no revision/request_id required. Contents remain saved; visibility resets on illustration selection or reload.' },
      illustration_id: { type: 'string', maxLength: 100, description: 'Required for open/duplicate. Use on read/render/apply/scratch/inspect to pin the active illustration; a changed selection returns illustration_changed.' },
      title: { type: 'string', maxLength: 200, description: 'Optional title for create/duplicate. Rename existing figures using apply title operation.' },
      expected_library_revision: { type: 'string', maxLength: 100, description: 'Required for create/open/duplicate; obtain from list or read. List takes only action.' },
      include_assets: { type: 'boolean', description: 'Read only: include raster data URLs. SVG sources are always returned.' },
      expected_revision: { type: 'string', maxLength: 100 }, request_id: { type: 'string', maxLength: 100 },
      operations: { type: 'array', minItems: 1, maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['op'], properties: {
          op: { type: 'string', enum: ['upsert', 'update', 'delete', 'transfer', 'canvas', 'order', 'title', 'complexity', 'group', 'ungroup', 'transform'] },
          object: { type: 'object', additionalProperties: false, required: ['id', 'type'], properties: objectProperties },
          id: { type: 'string', maxLength: 100, description: 'Component ID, or group ID for update/delete/transfer/ungroup/transform. group requires an unused ID.' },
          name: { type: 'string', maxLength: 200, description: 'Optional group name for group.' },
          patch: { type: 'object', description: 'update: object properties (set vector fill, stroke, or strokeWidth to null to restore original artwork); group update: name and/or x/y/width/height; canvas: width, height, background. transform: x/y and proportional width/height in canvas units. Set either dimension, or both at the same scale. Group resizing scales text fonts proportionally and preserves member rotations. Unsupported size/font limits reject the batch.' },
          canvas: { type: 'string', enum: ['main', 'scratch'] }, copy: { type: 'boolean' }, new_id: { type: 'string', maxLength: 100 },
          ids: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'order: every object on that canvas, back to front. group: at least two distinct component IDs on one canvas; include all members when merging existing groups. transform: component IDs on one canvas, instead of a group id. Grouping/ungrouping preserves geometry and paint order; read returns groups with current bounds. Components remain individually editable. delete/transfer with a group ID affects all members; copies return fresh member IDs in groups.' },
          title: { type: 'string', maxLength: 200 },
          complexity: { type: 'string', enum: COMPLEXITY_LEVELS, description: 'For the complexity operation: saved figure detail level. Change only when the user requests it. Read returns matching drawing instructions.' },
          raster_asset: { type: 'string', maxLength: 2400, description: 'ID of an image supplied in plugin_canvas assets. upsert/update only.' }
        }
      } }
    }
  }
});
