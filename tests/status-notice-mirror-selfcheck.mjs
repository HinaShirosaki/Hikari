// The protein builder paints its status line on every render pass, so setting a
// status and re-applying it are deliberately separate calls: only the set path
// may raise an app notice. Without that split a failed assembly would re-toast
// on every later render.
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

const statusEl = { textContent: '', hidden: true, style: {} };
const searchEl = { textContent: '', style: {} };
const ctx = createProteinBuilderContext({
  elements: {
    proteinBuilderStatus: statusEl,
    proteinBuilderFeatureSearchStatus: searchEl
  }
});

// A failure notifies once and stays on the inline line.
ctx.setBuilderStatus('Unable to assemble the plasmid.', true);
assert.equal(notices, 1, 'an error status raises one notice');
assert.equal(statusEl.textContent, 'Unable to assemble the plasmid.');

// The notice fades, then a render pass re-paints the same status.
toast.hidden = true;
ctx.applyBuilderStatus();
assert.equal(notices, 1, 're-applying a stored status must not re-notify');

ctx.setBuilderStatus('Opened construct review.');
assert.equal(notices, 1, 'a success status stays inline only');

ctx.setFeatureSearchStatus('Failed to search stored features.', true);
assert.equal(notices, 2, 'a feature-search failure raises a notice');

toast.hidden = true;
ctx.applyFeatureSearchStatus('Failed to search stored features.', true);
assert.equal(notices, 2, 'the render-time feature-search line must not notify');

console.log('status notice mirror selfcheck OK');
