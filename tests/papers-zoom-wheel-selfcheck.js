#!/usr/bin/env node
// Self-check for trackpad pinch / ctrl+wheel zoom in the papers PDF viewer.
// Run: node tests/papers-zoom-wheel-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');

const root = path.resolve(__dirname, '..');
const { installPdfViewerPdfNavigationController } = loadEsmStyleModule(
  path.join(root, 'src/renderer/modules/papers/pdf-viewer/pdf-viewer-pdf-navigation-controller.js')
);

// Minimal ctx: real adjustZoom mutates state.zoom; rAF is captured so we can flush frames by hand.
function makeCtx() {
  const rafQueue = [];
  const ctx = {
    state: { zoom: 1, fitWidth: true, pdfDocument: {}, zoomWheelFrame: 0, pendingZoomDelta: 0 },
    getWindowRef: () => ({ requestAnimationFrame: (cb) => rafQueue.push(cb) }),
    renderDocumentPages: async () => {}
  };
  installPdfViewerPdfNavigationController(ctx);
  return { ctx, flushRaf: () => rafQueue.splice(0).forEach((cb) => cb()) };
}

function wheel(overrides) {
  let prevented = false;
  return { event: { ctrlKey: true, deltaY: 0, preventDefault: () => { prevented = true; }, ...overrides }, get prevented() { return prevented; } };
}

// --- plain scroll (no ctrl) is ignored: no preventDefault, no zoom, scrolling still works ---
{
  const { ctx, flushRaf } = makeCtx();
  const w = wheel({ ctrlKey: false, deltaY: 100 });
  ctx.handleZoomWheel(w.event);
  flushRaf();
  assert.equal(w.prevented, false, 'non-ctrl wheel is not preventDefaulted');
  assert.equal(ctx.state.zoom, 1, 'non-ctrl wheel does not zoom');
}

// --- ctrl+wheel zooms, suppresses native zoom, and a coarse notch is capped to one step ---
{
  const { ctx, flushRaf } = makeCtx();
  const w = wheel({ deltaY: -1000 }); // huge negative delta = zoom in hard
  ctx.handleZoomWheel(w.event);
  assert.equal(w.prevented, true, 'ctrl+wheel preventDefaults native page zoom');
  flushRaf();
  assert.ok(Math.abs(ctx.state.zoom - 1.2) < 1e-9, 'per-frame delta clamped to one ZOOM_STEP (1 -> 1.2)');
  assert.equal(ctx.state.fitWidth, false, 'zooming exits fit-width mode');
}

// --- many pinch events within one frame coalesce into a single zoom ---
{
  const { ctx, flushRaf } = makeCtx();
  ctx.handleZoomWheel(wheel({ deltaY: -5 }).event);  // +0.05
  ctx.handleZoomWheel(wheel({ deltaY: -5 }).event);  // +0.05
  flushRaf();
  assert.ok(Math.abs(ctx.state.zoom - 1.1) < 1e-9, 'two pinch ticks coalesce to one 0.10 zoom');
}

// --- with no document open, zoom is a no-op (and does not block native scroll) ---
{
  const { ctx, flushRaf } = makeCtx();
  ctx.state.pdfDocument = null;
  const w = wheel({ deltaY: -100 });
  ctx.handleZoomWheel(w.event);
  flushRaf();
  assert.equal(w.prevented, false, 'no document: ctrl+wheel left alone');
  assert.equal(ctx.state.zoom, 1, 'no document: no zoom');
}

console.log('papers-zoom-wheel-selfcheck: all assertions passed');
