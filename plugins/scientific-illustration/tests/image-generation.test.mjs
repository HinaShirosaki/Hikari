import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, normalizeDocument, applyOperations } from '../model.mjs';
import { imageGenerationPercent, imageGenerationInstructions, imageGenerationSummary, IMAGE_GENERATION_PRESETS } from '../image-generation.mjs';
import { agentInstructions } from '../agent/workflow.mjs';
import { CANVAS_TOOL_CONTRACT } from '../agent/canvas-contract.mjs';

test('old and new figures preserve Automatic SVG-first rendering', () => {
  const document = createDocument();
  assert.equal(document.imageGenerationPercent, null);
  delete document.imageGenerationPercent;
  assert.equal(normalizeDocument(document).imageGenerationPercent, null);
  assert.match(imageGenerationInstructions(), /Automatic.*SVG-first/);
});

test('percentage accepts endpoints and rejects malformed values atomically', () => {
  for (const value of [null, 0, 1, 50, 99, 100]) {
    const document = createDocument();
    const next = applyOperations(document, [{ op: 'image_generation', imageGenerationPercent: value }]);
    assert.equal(next.imageGenerationPercent, value);
    assert.notEqual(next.revision, document.revision);
    assert.equal(document.imageGenerationPercent, null);
  }
  for (const value of [-1, 101, 0.5, '50', true, NaN, {}, []]) {
    assert.throws(() => imageGenerationPercent(value), /whole number/);
    const document = createDocument();
    assert.throws(() => applyOperations(document, [{ op: 'title', title: 'Changed' }, { op: 'image_generation', imageGenerationPercent: value }]));
    assert.equal(document.title, 'Untitled figure');
    assert.equal(document.imageGenerationPercent, null);
  }
  assert.throws(() => applyOperations(createDocument(), [{ op: 'image_generation' }]), /requires imageGenerationPercent/);
});

test('every level and percentage keeps schematic geometry SVG and labels separate', () => {
  for (const level of ['simple', 'standard', 'detailed']) {
    for (const percent of [null, 0, 25, 50, 75, 100]) {
      const instructions = agentInstructions(level, percent);
      assert.match(instructions, /boxes, arrows, connectors, panel frames, charts, scale bars and exact scientific geometry/);
      assert.match(instructions, /always remain separate SVG or text objects, even at 100%/);
      assert.match(instructions, /not a quota of assets or tool calls/);
      assert.match(instructions, /Never rasterize schematic symbols/);
      assert.match(instructions, /preserve existing artwork/);
      assert.match(instructions, /Keep the current canvas dimensions, complexity and image-generation target unless the user asks to change them/);
      assert.match(instructions, /render BOTH canvases/);
      if (percent === 0) assert.match(instructions, /Do not call image_gen/);
      else if (percent !== null) assert.ok(instructions.includes(`target: ${percent}%`));
    }
  }
  const operations = CANVAS_TOOL_CONTRACT.inputSchema.properties.operations.items.properties;
  assert.ok(operations.op.enum.includes('image_generation'));
  assert.deepEqual(operations.imageGenerationPercent.type, ['integer', 'null']);
});

test('quarter-step presets supply explicit renderer guidance to the agent', () => {
  assert.deepEqual(Object.keys(IMAGE_GENERATION_PRESETS).map(Number), [0, 25, 50, 75, 100]);
  for (const [value, profile] of Object.entries(IMAGE_GENERATION_PRESETS)) {
    const instructions = imageGenerationInstructions(Number(value));
    assert.ok(instructions.includes(profile.guidance));
    assert.equal(imageGenerationSummary(Number(value)), profile.label);
    assert.ok(instructions.includes(`target: ${value}%`));
  }
  assert.match(imageGenerationSummary(null), /Automatic/);
  assert.match(imageGenerationInstructions(77), /target: 77%/);
  assert.match(imageGenerationSummary(77), /Custom target/);
});
