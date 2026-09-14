import assert from 'node:assert/strict';
import { cancelAllRenderTasks, clearPageRecordRender } from '../src/renderer/modules/papers/pdf-viewer/pdf-viewer-page-records.js';
import { renderPageRecord } from '../src/renderer/modules/papers/pdf-viewer/pdf-viewer-rendering.js';

// Scrolling and resizing both run renderDocumentPages, which cancels render
// tasks before re-rendering. Cancelling must not drop the text layer's
// selection binding: renderPageRecord treats a missing binding as "this layer
// needs building" and the rebuild wipes the spans a live selection sits in.
const SCALE = 1.5;

function makeRecord() {
  let cleanupCalls = 0;
  const textLayer = {
    childElementCount: 400,
    style: { width: '', height: '' },
    set innerHTML(value) {
      if (value === '') {
        this.childElementCount = 0;
      }
    },
    get innerHTML() {
      return '';
    }
  };
  return {
    record: {
      pageNumber: 1,
      element: { style: {} },
      canvas: { width: 900, height: 1200, style: {} },
      textLayer,
      linkLayer: { childElementCount: 3, innerHTML: '', style: {} },
      formLayer: { replaceChildren() {} },
      renderTask: null,
      textLayerBuilder: null,
      textSelectionCleanup: () => { cleanupCalls += 1; },
      renderedScale: SCALE,
      renderedTextScale: SCALE,
      renderedLinkScale: SCALE,
      renderedForms: true
    },
    getCleanupCalls: () => cleanupCalls
  };
}

// A re-render of an unchanged page must leave the spans — and the selection
// anchored in them — alone.
const live = makeRecord();
cancelAllRenderTasks([live.record]);
assert.equal(typeof live.record.textSelectionCleanup, 'function', 'cancelling a render must keep the selection binding');
assert.equal(live.getCleanupCalls(), 0, 'cancelling a render must not unbind text selection');

await renderPageRecord({
  pdfDocument: {
    getPage() {
      throw new Error('an unchanged page must not be re-fetched or re-rendered');
    }
  },
  record: live.record,
  scale: SCALE,
  skipIfRendered: true
});
assert.equal(live.record.textLayer.childElementCount, 400, 'the text layer must survive a no-op re-render');

// Wiping a page's text for real still has to release the binding.
const dropped = makeRecord();
clearPageRecordRender(dropped.record);
assert.equal(dropped.getCleanupCalls(), 1, 'clearing a page must unbind text selection');
assert.equal(dropped.record.textSelectionCleanup, null);
assert.equal(dropped.record.textLayer.childElementCount, 0);

console.log('pdf viewer text selection persistence selfcheck passed');
