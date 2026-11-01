import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDocument, normalizeDocument } from '../model.mjs';
import { agentInstructions } from '../agent/workflow.mjs';

test('the figure palette is saved, validated and steers Codex', () => {
  const legacy = createDocument(); delete legacy.palette;
  assert.deepEqual(normalizeDocument(legacy).palette, []);
  let document = applyOperations(createDocument(), [{ op: 'image_style_line', imageStyleLine: 'Flat, palette #111111' }]);
  document = applyOperations(document, [{ op: 'palette', palette: ['#4169D8', '#e07a3f'] }]);
  assert.deepEqual(document.palette, ['#4169d8', '#e07a3f']);
  assert.equal(document.imageStyleLine, '', 'a new palette makes the saved style line stale');
  document = applyOperations(document, [{ op: 'image_style_line', imageStyleLine: 'Flat' }, { op: 'palette', palette: ['#4169d8', '#e07a3f'] }]);
  assert.equal(document.imageStyleLine, 'Flat', 'an unchanged palette keeps it');
  for (const invalid of [['#abc'], ['red'], Array(9).fill('#000000'), '#000000']) {
    assert.throws(() => applyOperations(document, [{ op: 'palette', palette: invalid }]), /palette/);
  }
  assert.match(agentInstructions('standard', null, undefined, '', document.palette), /chosen by the user: #4169d8, #e07a3f\./);
  assert.match(agentInstructions('standard'), /Figure palette: none saved/);
});
