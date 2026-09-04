// Protein Builder feedback uses the app notice instead of adding persistent
// messages beneath the workspace title.
import assert from 'node:assert/strict';

let notices = 0;
const toast = {
  style: {},
  hidden: true,
  _text: '',
  get textContent() { return this._text; },
  set textContent(value) { this._text = value; notices += 1; },
  setAttribute() {}
};
let mounted = false;
globalThis.document = {
  createElement: () => toast,
  querySelector: () => (mounted ? toast : null),
  body: { appendChild() { mounted = true; } }
};
globalThis.window = { setTimeout: () => 0, clearTimeout: () => {} };

const { createProteinBuilderContext } = await import(
  '../src/renderer/modules/sequence-viewer/protein-builder/controller-context.js'
);

const mockClassList = () => {
  const tokens = new Set();
  return { toggle: (token, on) => (on ? tokens.add(token) : tokens.delete(token)), has: (token) => tokens.has(token) };
};
const searchEl = { textContent: '', style: {}, classList: mockClassList() };
const ctx = createProteinBuilderContext({
  elements: {
    proteinBuilderFeatureSearchStatus: searchEl
  }
});

// Both failures and confirmations notify without needing an inline status node.
ctx.setBuilderStatus('Unable to assemble the plasmid.', true);
assert.equal(notices, 1, 'an error status raises one notice');
ctx.setBuilderStatus('Opened construct review.');
assert.equal(notices, 2, 'a success status raises one notice');
ctx.setBuilderStatus('');
assert.equal(notices, 2, 'clearing status does not raise an empty notice');

ctx.setFeatureSearchStatus('Failed to search stored features.', true);
assert.equal(notices, 3, 'a feature-search failure raises a notice');

toast.hidden = true;
ctx.applyFeatureSearchStatus('Failed to search stored features.', true);
assert.equal(notices, 3, 'the render-time feature-search line must not notify');

// The alignment controller has the same split: render() re-asserts the stored
// status every pass, so painting it must never raise a notice.
const { createSequenceViewerAlignmentController } = await import(
  '../src/renderer/modules/sequence-viewer/alignment-controller.js'
);

const alignmentStatusEl = { textContent: '', style: {}, classList: mockClassList() };
const alignment = createSequenceViewerAlignmentController({
  elements: { alignmentStatus: alignmentStatusEl }
});

await alignment.runSequencingAlignment();
assert.equal(
  alignmentStatusEl.textContent,
  'Load both a reference and a query before running the alignment.'
);
assert.equal(alignmentStatusEl.classList.has('is-error'), true, 'a blocked run paints the line red');

// The notice fades, then render passes re-paint the same status.
const noticesBeforeRender = notices;
toast.hidden = true;
alignment.render();
alignment.render();
assert.equal(notices, noticesBeforeRender, 'rendering a stored alignment failure must not re-notify');
assert.equal(alignmentStatusEl.classList.has('is-error'), true, 'the error colour survives a render pass');

console.log('status notice mirror selfcheck OK');
