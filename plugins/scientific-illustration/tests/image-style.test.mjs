import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, normalizeDocument, applyOperations } from '../model.mjs';
import { imageGenerationStyle, IMAGE_STYLE_PRESETS, imageStyleInstructions } from '../image-style.mjs';
import { agentInstructions } from '../agent/workflow.mjs';
import { CANVAS_TOOL_CONTRACT } from '../agent/canvas-contract.mjs';

test('existing figures acquire automatic style and independent defaults', () => {
  const first = createDocument(), second = createDocument();
  delete first.imageGenerationStyle; delete first.imageStyleLine;
  assert.deepEqual(normalizeDocument(first).imageGenerationStyle, { preset: 'automatic', prompt: '' });
  assert.equal(normalizeDocument(first).imageStyleLine, '');
  second.imageGenerationStyle.prompt = 'Blue';
  assert.equal(createDocument().imageGenerationStyle.prompt, '');
});

test('style changes preserve artwork, size, complexity and generation target', () => {
  const original = createDocument();
  original.imageGenerationPercent = 75;
  original.objects = [{ id: 'label', type: 'text', text: 'Keep me' }];
  const before = normalizeDocument(original);
  for (const preset of Object.keys(IMAGE_STYLE_PRESETS)) {
    const next = applyOperations(before, [{ op: 'image_generation_style', imageGenerationStyle: { preset, prompt: 'Teal and warm gold' } }]);
    assert.deepEqual(next.imageGenerationStyle, { preset, prompt: 'Teal and warm gold' });
    assert.equal(next.imageGenerationPercent, 75);
    assert.equal(next.complexity, before.complexity);
    assert.deepEqual(next.canvases, before.canvases);
    assert.deepEqual(next.objects, before.objects);
    assert.notEqual(next.revision, before.revision);
  }
  assert.deepEqual(before.imageGenerationStyle, { preset: 'automatic', prompt: '' });
});

test('invalid styles fail atomically and notes retain spaces while typing', () => {
  assert.deepEqual(imageGenerationStyle({ preset: 'flat' }), { preset: 'flat', prompt: '' });
  assert.equal(imageGenerationStyle({ preset: 'flat', prompt: 'soft blue ' }).prompt, 'soft blue ');
  for (const invalid of [null, [], 'flat', {}, { preset: 'unknown' }, { preset: 'flat', prompt: 3 }, { preset: 'flat', prompt: 'x'.repeat(1001) }, { preset: 'flat', extra: true }]) {
    const original = createDocument();
    assert.throws(() => imageGenerationStyle(invalid), /image style/);
    assert.throws(() => applyOperations(original, [{ op: 'title', title: 'Changed' }, { op: 'image_generation_style', imageGenerationStyle: invalid }]));
    assert.equal(original.title, 'Untitled figure');
  }
  assert.throws(() => applyOperations(createDocument(), [{ op: 'image_generation_style' }]), /requires imageGenerationStyle/);
});

test('all presets and custom art direction reach every complexity without enabling generation', () => {
  for (const [preset, profile] of Object.entries(IMAGE_STYLE_PRESETS)) {
    for (const complexity of ['simple', 'standard', 'detailed']) {
      const instructions = agentInstructions(complexity, 0, { preset, prompt: 'Muted teal; upper-left lighting' });
      assert.ok(instructions.includes(profile.guidance));
      assert.match(instructions, /Muted teal; upper-left lighting/);
      assert.match(instructions, /Before the first image_gen call, write one concrete style line/);
      assert.match(instructions, /paste it verbatim into every image_gen prompt/);
      assert.match(instructions, /Do not call image_gen/);
      assert.match(instructions, /do not restyle existing artwork unless the user asks/);
      assert.match(instructions, /Style sets the medium and finish, overriding the complexity level's shading limits/);
      assert.match(instructions, /refine or override the preset/);
      assert.match(instructions, /not itself a reason to call image_gen/);
      assert.match(instructions, /name any style mismatch with it in the inspect review/);
      assert.ok(instructions.includes('<style line>'));
    }
  }
  const automatic = imageStyleInstructions();
  assert.match(automatic, /^Image style for image_gen artwork: Automatic\. /);
  assert.match(automatic, /write one concrete style line/);
  assert.doesNotMatch(automatic, /Style sets the medium/);
  const operation = CANVAS_TOOL_CONTRACT.inputSchema.properties.operations.items.properties;
  assert.ok(operation.op.enum.includes('image_generation_style'));
  assert.deepEqual(operation.imageGenerationStyle.properties.preset.enum, Object.keys(IMAGE_STYLE_PRESETS));
  assert.equal(operation.imageGenerationStyle.properties.prompt.maxLength, 1000);
  assert.ok(operation.op.enum.includes('image_style_line'));
  assert.equal(operation.imageStyleLine.maxLength, 500);
});

test('the saved style line reaches the agent verbatim and a style change clears it', () => {
  const line = 'Watercolor washes, palette #2a6f97 #e9c46a, light from upper left, 2px dark outlines, soft shading, three-quarter view';
  const style = { preset: 'watercolor', prompt: 'Muted teal' };
  let document = applyOperations(createDocument(), [{ op: 'image_generation_style', imageGenerationStyle: style }, { op: 'image_style_line', imageStyleLine: ` ${line} ` }]);
  assert.equal(document.imageStyleLine, line);
  const instructions = agentInstructions('standard', 50, document.imageGenerationStyle, document.imageStyleLine);
  assert.ok(instructions.includes(`Style line for this figure: ${JSON.stringify(line)}. Paste it verbatim`));
  assert.doesNotMatch(instructions, /Before the first image_gen call/);
  // The UI resends the style with every preference save; an unchanged style or trailing space keeps the line.
  document = applyOperations(document, [{ op: 'image_generation_style', imageGenerationStyle: { ...style, prompt: 'Muted teal ' } }]);
  assert.equal(document.imageStyleLine, line);
  document = applyOperations(document, [{ op: 'image_generation_style', imageGenerationStyle: { preset: 'ink', prompt: 'Muted teal' } }]);
  assert.equal(document.imageStyleLine, '');
  for (const invalid of [undefined, 3, 'x'.repeat(501)]) {
    const original = createDocument();
    assert.throws(() => applyOperations(original, [{ op: 'title', title: 'Changed' }, { op: 'image_style_line', imageStyleLine: invalid }]), /Image style line/);
    assert.equal(original.title, 'Untitled figure');
  }
});
