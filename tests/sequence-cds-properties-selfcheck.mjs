import assert from 'node:assert/strict';
import { getCdsProteinProperties } from '../src/renderer/modules/sequence-viewer/protein-properties.js';
import { formatProteinPropertySummary } from '../src/renderer/modules/sequence-viewer/rendering/protein-summary.js';
import { createSequenceHoverTooltipController } from '../src/renderer/modules/sequence-viewer/detail-hover.js';
import { bindSequenceHostEvents } from '../src/renderer/modules/sequence-viewer/detail-events/sequence-host-bindings.js';
import { attachMapHoverLabel } from '../src/renderer/modules/sequence-viewer/vector-builder/map-hover.js';
import runtime from './support/runtime.js';

const { createMockDocument, trigger } = runtime;
const cds = { name: 'CDS readout', type: 'cds', strand: 1, segments: [{ start: 0, end: 9 }] };
const expected = getCdsProteinProperties(cds, 'ATGAAATAA');
assert.equal(expected.sequence, 'MK');
assert.ok(Math.abs(expected.monoisotopicMass - 277.146013) < 0.000001);
assert.ok(Number.isFinite(expected.pI));

// The same protein is read from a reverse strand, joined exons, or across the origin.
for (const [feature, sequence] of [
  [{ ...cds, strand: -1 }, 'TTATTTCAT'],
  [{ ...cds, segments: [{ start: 0, end: 3 }, { start: 6, end: 12 }] }, 'ATGCCCAAATAA'],
  [{ ...cds, segments: [{ start: 6, end: 9 }, { start: 0, end: 6 }] }, 'AAATAAATG']
]) {
  const properties = getCdsProteinProperties(feature, sequence);
  assert.equal(properties.sequence, expected.sequence);
  assert.equal(properties.monoisotopicMass, expected.monoisotopicMass);
  assert.equal(properties.pI, expected.pI);
}

const unknown = formatProteinPropertySummary(getCdsProteinProperties(cds, 'ATGNNNTAA'));
assert.match(unknown, /Monoisotopic MW n\/a/);
assert.match(unknown, /pI n\/a/);
assert.match(unknown, /unknown residue\(s\) X/);
assert.doesNotMatch(unknown, /0\.00 Da|pI 0\.00/);

function makeDocument() {
  const document = createMockDocument();
  const createElement = document.createElement;
  document.createElement = (tag) => {
    const node = createElement(tag);
    node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 250, height: 100 });
    return node;
  };
  return document;
}

function makeTrigger() {
  return {
    dataset: { featureIndex: '0' },
    closest: () => makeTrigger(),
    getAttribute: () => 'CDS readout (1..9)',
    getBoundingClientRect: () => ({ left: 50, bottom: 120 })
  };
}

// Exercise the visible readout through the real sequence and map event handlers.
for (const surface of ['sequence', 'map']) {
  const document = makeDocument();
  const host = document.getElementById('host');
  let record = { sequence: 'ATGAAATAA', features: [cds] };
  let hide;
  if (surface === 'sequence') {
    const hover = createSequenceHoverTooltipController(document);
    hide = hover.hideNow;
    bindSequenceHostEvents({
      elements: { sequenceHost: host },
      state: {},
      getSelectedRecord: () => record,
      getVisibleFeaturesForRecord: () => record.features,
      hideSequenceHoverTooltip: hover.hide,
      showSequenceHoverTooltip: (event, feature, length) => hover.show(event, feature, length, record.sequence)
    });
  } else {
    const hover = attachMapHoverLabel({
      host, rootDocument: document,
      getFeature: (index) => record.features[index],
      getSequence: () => record.sequence
    });
    hover.bind();
    hide = hover.hide;
  }
  const hoverEvent = surface === 'sequence' ? 'mouseover' : 'mousemove';
  const show = (type = hoverEvent) => trigger(host, type, { type, target: makeTrigger(), clientX: 80, clientY: 90 });
  show();
  const tooltip = document.querySelector('[data-sequence-hover-tooltip]');
  assert.equal(tooltip.hidden, false, surface);
  assert.match(tooltip.innerHTML, /2 aa/);
  assert.match(tooltip.innerHTML, /Monoisotopic MW 277\.15 Da/);
  assert.match(tooltip.innerHTML, /derived from CDS DNA/);
  assert.doesNotMatch(tooltip.innerHTML, /<details|<pre/);
  assert.equal(tooltip.classList.contains('is-interactive'), false);

  trigger(host, 'mouseleave');
  assert.equal(tooltip.hidden, true);
  show('focusin');
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.style.top, /^13\dpx$/, 'keyboard readout is anchored below the focused feature');
  trigger(host, 'focusout');
  assert.equal(tooltip.hidden, true);

  record = { ...record, sequence: 'ATGTAATAA' };
  show();
  assert.match(tooltip.innerHTML, /1 aa/);
  assert.match(tooltip.innerHTML, /149\.05 Da/);

  record.features = [{ ...cds, translation: 'MK*' }];
  show();
  assert.match(tooltip.innerHTML, /2 aa/);
  assert.match(tooltip.innerHTML, /from translation/);

  record.features = [{ ...cds, translation: 'MX*' }];
  show();
  assert.match(tooltip.innerHTML, /Monoisotopic MW n\/a/);
  assert.match(tooltip.innerHTML, /pI n\/a/);

  record.features = [{ ...cds, type: 'primer_bind', primerSequence: 'ATGAAATAA' }];
  show();
  assert.doesNotMatch(tooltip.innerHTML, /Monoisotopic MW|<strong>Protein/);
  assert.match(tooltip.innerHTML, /sequence-viewer-primer-copy-btn/);
  assert.equal(tooltip.classList.contains('is-interactive'), true);
  assert.equal(tooltip.classList.contains('has-protein-properties'), false);
  hide();
}

console.log('sequence-cds-properties-selfcheck: ok');
