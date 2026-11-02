import test from 'node:test';
import assert from 'node:assert/strict';
import { recolorVector, vectorColors } from '../vector-colors.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#ABC"/></linearGradient></defs>'
  + '<rect fill="#AABBCC" stroke="#123456" width="4" height="4"/><circle fill="url(#g)" stroke="none" r="2"/><path d="M0 0" fill="white"/></svg>';

test('swatches list each explicit hex paint once and recolor every use of it', () => {
  const object = { svg };
  assert.deepEqual(vectorColors(object), ['#aabbcc', '#123456']);
  const patch = recolorVector(object, '#aabbcc', '#ff0000');
  assert.deepEqual(Object.keys(patch), ['svg']);
  assert.match(patch.svg, /stop-color="#ff0000".*fill="#ff0000" stroke="#123456"/);
  assert.match(patch.svg, /fill="url\(#g\)".*fill="white"/);
  assert.deepEqual(recolorVector(object, '#000000', '#ff0000'), {});
});

test('a layer-wide override replaces its channel of the SVG', () => {
  const object = { svg, fill: '#00FF00', stroke: 'none' };
  assert.deepEqual(vectorColors(object), ['#00ff00', '#aabbcc']);
  assert.deepEqual(recolorVector(object, '#00ff00', '#0000ff'), { fill: '#0000ff' });
  // Only the gradient stop still shows #aabbcc; overridden fills stay untouched.
  const patch = recolorVector(object, '#aabbcc', '#ff0000');
  assert.match(patch.svg, /stop-color="#ff0000".*fill="#AABBCC"/);
});
