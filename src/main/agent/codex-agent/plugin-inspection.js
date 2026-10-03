'use strict';

const { randomUUID } = require('node:crypto');

// The host enforces completion, while each portable plugin owns its review
// contract. Inspection receipts are scoped to a fresh run, never a chat session.
async function beginPluginInspection(input, requestCanvas) {
  const pluginId = input.agent?.pluginCanvasId;
  if (!pluginId) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId) || typeof requestCanvas !== 'function') {
    throw new Error('Canvas inspection is unavailable. Open the plugin in a Hikari build with inspection support.');
  }
  const runId = randomUUID();
  const request = request => requestCanvas({ plugin_id: pluginId, request, inspectionRunId: runId });
  const canvasIllustrationId = input.agent?.pluginCanvasIllustrationId;
  const initial = await request({ action: 'read', ...(canvasIllustrationId ? { illustration_id: canvasIllustrationId } : {}) });
  if (!initial?.ok) throw new Error(initial?.error || 'Could not open the canvas for inspection.');
  if (initial.inspection?.required !== true) return null;
  const illustrationId = initial.illustration_id;
  if (!illustrationId) throw new Error('The canvas did not identify the illustration to inspect.');
  return {
    runId,
    async verify() {
      try {
        const result = await request({ action: 'inspection_status', illustration_id: illustrationId });
        return { ok: result?.ok === true && result.illustration_id === illustrationId
          && result.inspection?.required === true && result.inspection.complete === true
          && Boolean(result.revision) && result.inspection.revision === result.revision,
        error: result?.error || 'The latest illustration revision has not been inspected.' };
      } catch (error) { return { ok: false, error: error.message }; }
    },
    followUp: `Completion is blocked until the current illustration is inspected. Use plugin_canvas with plugin_id:${JSON.stringify(pluginId)} and illustration_id:${JSON.stringify(illustrationId)}. Read its current schema. Render BOTH canvases after the last edit, visually inspect the returned images, then submit action:"inspect" with expected_revision, inspection_id from the render and the required review observations. Check placement/clipping, label readability/overlap, text-free artwork, and scientific relationships. If you correct anything, render and inspect again. Preserve saved work; do not redraw the figure just to satisfy this step. Finish only after inspect succeeds.`
  };
}

module.exports = { beginPluginInspection };
