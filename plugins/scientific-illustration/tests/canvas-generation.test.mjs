import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasGenerationPoint, canvasGenerationMessage } from '../canvas-generation.mjs';
import { agentInstructions } from '../agent/workflow.mjs';

const canvas = { width: 1200, height: 800 };
test('canvas insertion coordinates account for zoom, pan, and affine screen transforms', () => {
  const point = { x: 432.15, y: 285.63 };
  for (const matrix of [
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    { a: .5, b: 0, c: 0, d: .5, e: 300, f: 80 },
    { a: 3, b: 0, c: 0, d: 3, e: -400, f: -200 },
    { a: .8, b: .6, c: -.6, d: .8, e: 70, f: -20 }
  ]) {
    const clientX = matrix.a * point.x + matrix.c * point.y + matrix.e;
    const clientY = matrix.b * point.x + matrix.d * point.y + matrix.f;
    assert.deepEqual(canvasGenerationPoint(matrix, clientX, clientY, canvas), point);
  }
});
test('only points inside the actual canvas are valid insertion targets', () => {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (const [x, y] of [[-1, 40], [40, -1], [1201, 40], [40, 801], [NaN, 0]]) assert.equal(canvasGenerationPoint(matrix, x, y, canvas), null);
  assert.equal(canvasGenerationPoint({ ...matrix, a: 0 }, 20, 20, canvas), null);
  assert.equal(canvasGenerationPoint(null, 20, 20, canvas), null);
  assert.deepEqual(canvasGenerationPoint(matrix, 1200, 800, canvas), { x: 1200, y: 800 });
});
test('generation briefs retain the requested point and renderer without changing figure preferences', () => {
  const target = { x: 432.15, y: 285.63, ...canvas };
  for (const renderer of ['auto', 'svg', 'image']) {
    const message = canvasGenerationMessage('A cutaway mitochondrion', target, renderer);
    assert.match(message, /\(432\.15, 285\.63\)/);
    assert.match(message, /1200 × 800/);
    assert.match(message, /Keep existing layers/);
    assert.match(message, /do not recenter or rearrange/);
    assert.match(message, /Inspect the placement/);
    assert.ok(canvasGenerationMessage('x'.repeat(2000), target, renderer).length <= 3000, 'The complete prompt fits the host limit');
  }
  assert.match(canvasGenerationMessage('Mitochondrion', target, 'svg'), /do not use image generation/);
  assert.match(canvasGenerationMessage('Mitochondrion', target, 'image'), /Use Codex image_gen/);
  assert.match(canvasGenerationMessage('Mitochondrion', target, 'image'), /do not change the saved renderer preference/);
  for (const description of ['', 'x'.repeat(2001)]) assert.throws(() => canvasGenerationMessage(description, target, 'auto'));
  assert.throws(() => canvasGenerationMessage('Cell', target, 'unsupported'));
  assert.throws(() => canvasGenerationMessage('Cell', { ...target, x: Infinity }, 'auto'));
});
test('the canvas contract preserves a targeted addition instead of recomposing the whole figure', () => {
  const instructions = agentInstructions('standard');
  assert.match(instructions, /center only that new component there/);
  assert.match(instructions, /Verify its final center after transparent image borders have been trimmed/);
  assert.match(instructions, /overrides the saved renderer mix for that addition only/);
});
