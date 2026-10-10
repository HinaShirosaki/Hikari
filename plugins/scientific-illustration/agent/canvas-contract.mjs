// This request contract belongs to the portable plugin, not the host.
import { COMPLEXITY_LEVELS } from '../complexity.mjs';
const objectProperties = {
  id: { type: 'string', maxLength: 100, description: 'Logical object ID, unchanged by rendering. DOM and SVG fragment IDs are namespaced separately.' }, name: { type: 'string', maxLength: 200, description: 'Layer name shown to the user; defaults to id.' },
  type: { type: 'string', enum: ['vector', 'raster', 'text'] }, canvas: { type: 'string', enum: ['main', 'scratch'] },
  x: { type: 'number', description: 'Left of the unrotated object box, in canvas units.' }, y: { type: 'number', description: 'Top of the unrotated object box, in canvas units.' },
  width: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport width in canvas units. SVG aspect ratio may leave space inside this box. PNG import trims fully transparent borders, preserves x/y and fits the cropped aspect ratio at this width, adjusting size only at object limits. Read the returned raster_imports before positioning labels.' }, height: { type: 'number', minimum: 1, maximum: 8000, description: 'Object viewport height in canvas units.' },
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
      action: { type: 'string', enum: ['list', 'create', 'open', 'duplicate', 'read', 'render', 'apply', 'scratch', 'inspect', 'asset_list', 'asset_read', 'asset_render', 'asset_save', 'asset_delete'] }, canvas: { type: 'string', enum: ['main', 'scratch', 'both'], description: 'For render; defaults to both, including hidden scratch.' },
      asset_id: { type: 'string', maxLength: 100, description: 'Reusable asset ID from read.reusable_assets or asset_list. asset_read returns editable component sources; asset_render returns a PNG preview without changing canvas inspection.' },
      expected_assets_revision: { type: 'string', maxLength: 100, description: 'Required by asset_save and asset_delete; obtain from read or asset_list. Asset library is shared across illustrations.' },
      name: { type: 'string', minLength: 1, maxLength: 200, description: 'Required for asset_save. Short searchable name for the saved component snapshot.' },
      id: { type: 'string', maxLength: 100, description: 'asset_save: component or group ID, instead of ids or raster_asset.' },
      raster_asset: { type: 'string', maxLength: 100, description: 'asset_save: save an image supplied in plugin_canvas assets directly to the reusable library without placing it. Requires name and textFree:true; PNG transparent borders are trimmed. Save every Codex image_gen output, including unused candidates. Then place with apply insert_asset.' },
      textFree: { type: 'boolean', description: 'asset_save with raster_asset: confirm the image has no baked-in text.' },
      ids: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', maxLength: 100 }, description: 'asset_save: distinct component IDs on one canvas, instead of id. Preserves paint order, relative geometry and separate text layers. Saving does not edit the figure.' },
      inspection_id: { type: 'string', maxLength: 100, description: 'For inspect: returned by rendering both canvases at the current revision in this run. Any edit, undo/redo, reload or new run requires a fresh render. Inspection also saves newly built/changed groups with at least two artwork layers to reusable assets; a failed asset save blocks completion.' },
      review: { type: 'object', additionalProperties: false, required: ['layout', 'labels', 'artwork', 'science'], description: 'For inspect: what you observed in the rendered images.', properties: {
        layout: { type: 'string', minLength: 1, maxLength: 1000, description: 'Placement, scale, clipping and overlaps on main and scratch.' },
        labels: { type: 'string', minLength: 1, maxLength: 1000, description: 'Readability, alignment and separate editable text layers.' },
        artwork: { type: 'string', minLength: 1, maxLength: 1000, description: 'No baked-in text; vector/raster component appearance and selection bounds.' },
        science: { type: 'string', minLength: 1, maxLength: 1000, description: 'Scientific relationships, arrow direction and consistency with the user request; state any remaining uncertainty.' }
      } },
      visible: { type: 'boolean', description: 'Required for scratch action. True summons the scratch panel; false closes it. View-only: no revision/request_id required. Contents remain saved; visibility resets on illustration selection or reload.' },
      illustration_id: { type: 'string', maxLength: 100, description: 'Required for open/duplicate. Use on read/render/apply/scratch/inspect to pin the active illustration; a changed selection returns illustration_changed.' },
      title: { type: 'string', maxLength: 200, description: 'Optional title for create/duplicate. Rename existing figures using apply title operation.' },
      source: { type: ['object', 'null'], description: 'create only: optional source reference data (kind: protocol or paper-selection, id, title, content, selectedText, pageNumber, markdownRelativePath, markdownStatus, truncated). read returns it with the figure so subsequent agent turns retain the originating context. Content is limited to 200,000 characters and selectedText to 30,000.' },
      expected_library_revision: { type: 'string', maxLength: 100, description: 'Required for create/open/duplicate; obtain from list or read. List takes only action.' },
      include_assets: { type: 'boolean', description: 'read/asset_read only: include raster data URLs. SVG sources are always returned.' },
      expected_revision: { type: 'string', maxLength: 100 }, request_id: { type: 'string', maxLength: 100 },
      operations: { type: 'array', minItems: 1, maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['op'], properties: {
          op: { type: 'string', enum: ['upsert', 'update', 'delete', 'transfer', 'canvas', 'order', 'title', 'complexity', 'image_generation', 'group', 'ungroup', 'transform', 'rotate', 'insert_asset'] },
          asset_id: { type: 'string', maxLength: 100, description: 'insert_asset: saved reusable asset ID. Creates independent editable components with fresh IDs; multiple components become one named group. apply returns inserted_assets with ids, group_id and bounds. Deleting the saved asset never changes placed copies.' },
          x: { type: 'number', description: 'insert_asset: left of the rotated selection bounds, in destination canvas units. Defaults to centering.' },
          y: { type: 'number', description: 'insert_asset: top of the rotated selection bounds, in destination canvas units. Defaults to centering.' },
          width: { type: 'number', minimum: 1, description: 'insert_asset: proportional size of the complete selection bounds. Set width or height, or both at the same scale. Text fonts scale proportionally; rotations and internal placement are preserved. Defaults to saved size.' },
          height: { type: 'number', minimum: 1, description: 'insert_asset: proportional height of the complete selection bounds.' },
          object: { type: 'object', additionalProperties: false, required: ['id', 'type'], properties: objectProperties },
          id: { type: 'string', maxLength: 100, description: 'Component ID, or group ID for update/delete/transfer/ungroup/transform/rotate. group requires an unused ID.' },
          degrees: { type: 'number', minimum: -360, maximum: 360, description: 'rotate: clockwise angle to add to the selected components. Keeps their sizes, typography and relative positions rigidly related.' },
          pivot: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'rotate: optional center in canvas units. Defaults to the selected components\' bounds center; the UI uses the visible selection center for text.' },
          name: { type: 'string', maxLength: 200, description: 'Optional group name for group.' },
          patch: { type: 'object', description: 'update: object properties (set vector fill, stroke, or strokeWidth to null to restore original artwork); group update: name and/or x/y/width/height; canvas: width, height, background. transform: x/y and proportional width/height in canvas units. Set either dimension, or both at the same scale. Group resizing scales text fonts proportionally and preserves member rotations. Unsupported size/font limits reject the batch.' },
          canvas: { type: 'string', enum: ['main', 'scratch'] }, copy: { type: 'boolean' }, new_id: { type: 'string', maxLength: 100 },
          ids: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'order: every object on that canvas, back to front. group: at least two distinct component IDs on one canvas; include all members when merging existing groups. transform/rotate: component IDs on one canvas, instead of an id. Grouping/ungrouping preserves geometry and paint order; read returns groups with current bounds. Components remain individually editable. delete/transfer with a group ID affects all members; copies return fresh member IDs in groups.' },
          title: { type: 'string', maxLength: 200 },
          complexity: { type: 'string', enum: COMPLEXITY_LEVELS, description: 'For the complexity operation: saved figure detail level. Change only when the user requests it. Read returns matching drawing instructions.' },
          imageGenerationPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100, description: 'image_generation operation: saved target share of eligible illustrative artwork area. UI presets: 0, 25, 50, 75, 100; choose a preset unless the user specifies a custom whole percentage. null restores Automatic SVG-first choice. Excludes boxes, arrows, connectors, charts, exact geometry and separate text labels. A preference, not an asset/call quota. Change only when the user requests it; read returns matching preset instructions. Existing custom targets remain supported.' },
          raster_asset: { type: 'string', maxLength: 2400, description: 'ID of an image supplied in plugin_canvas assets. upsert/update only.' }
        }
      } }
    }
  }
});
