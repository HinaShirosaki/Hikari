// Self-check for the sequence host re-flow observer in detail-events.js:
// one re-flow per frame, never at width 0, and no duplicate window listener.
import assert from 'node:assert/strict';
import { bindSequenceViewerDetailEvents } from '../src/renderer/modules/sequence-viewer/detail-events.js';

let frames = [];
let windowListeners = [];
let notifyObserver = () => {};

const previousGlobals = {
  ResizeObserver: globalThis.ResizeObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  addEventListener: globalThis.addEventListener
};
globalThis.ResizeObserver = class {
  constructor(callback) {
    notifyObserver = callback;
  }

  observe() {}
};
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.addEventListener = (type) => windowListeners.push(type);

function harness({ width = 900 } = {}) {
  frames = [];
  windowListeners = [];
  const renders = [];
  const sequenceHost = { clientWidth: width, addEventListener() {} };

  bindSequenceViewerDetailEvents({
    elements: { sequenceHost },
    getSelectedRecord: () => ({ id: 'record-1' }),
    renderSequence: (record, options) => renders.push({ record, options })
  });

  return {
    renders,
    windowListeners,
    resize: (nextWidth) => {
      sequenceHost.clientWidth = nextWidth;
      notifyObserver();
    },
    runFrame: () => {
      frames.splice(0, frames.length).forEach((callback) => callback());
    },
    pendingFrames: () => frames.length
  };
}

try {
  // A drag fires the observer every frame; only one re-flow may be scheduled.
  const drag = harness();
  drag.resize(880);
  drag.resize(860);
  drag.resize(840);
  assert.equal(drag.pendingFrames(), 1, 'observer bursts must coalesce into one frame');
  assert.equal(drag.renders.length, 0, 'no render may run inside the observer callback');
  drag.runFrame();
  assert.equal(drag.renders.length, 1, 'the coalesced frame re-flows once');
  assert.equal(drag.renders[0].options.preserveScroll, true);

  // The next burst schedules a fresh frame rather than being swallowed.
  drag.resize(820);
  drag.runFrame();
  assert.equal(drag.renders.length, 2, 'a later resize must schedule another re-flow');

  // An unchanged width is not worth a re-flow.
  drag.resize(820);
  drag.runFrame();
  assert.equal(drag.renders.length, 2, 'an unchanged width must not re-flow');

  // Hiding the view collapses the host to 0; re-flowing there would lay the
  // sequence out at the fallback line length and lose the preserved scroll.
  const hidden = harness();
  hidden.resize(0);
  hidden.runFrame();
  assert.equal(hidden.renders.length, 0, 'a zero-width host must not re-flow');
  hidden.resize(1100);
  hidden.runFrame();
  assert.equal(hidden.renders.length, 1, 'a width change while hidden re-flows on show');

  // The host observer already covers window resizes.
  assert.equal(
    harness().windowListeners.includes('resize'),
    false,
    'a window resize listener would double every re-flow'
  );
} finally {
  Object.assign(globalThis, previousGlobals);
}

console.log('Sequence host reflow self-check passed.');
