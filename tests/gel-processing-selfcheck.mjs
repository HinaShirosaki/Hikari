import assert from 'node:assert/strict';
import { buildGaussianKernel, gaussianBlur2d, preprocessWithJs, createPreprocessingCache } from '../src/plugins/gel/workspace/analysis/image-processing.js';
import { createImageController } from '../src/plugins/gel/workspace/images/image-controller.js';

globalThis.ImageData ??= class {
  constructor(data, width, height) { Object.assign(this, { data, width, height }); }
};

// The reference uses the direct separable Gaussian definition. Matching every
// float protects band quantification and 16-bit input precision, including edges.
function referenceBlur(data, width, height, sigma) {
  const { kernel, radius } = buildGaussianKernel(sigma);
  const horizontal = new Float32Array(data.length), output = new Float32Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) sum += data[y * width + Math.max(0, Math.min(width - 1, x + offset))] * kernel[offset + radius];
    horizontal[y * width + x] = sum;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) sum += horizontal[Math.max(0, Math.min(height - 1, y + offset)) * width + x] * kernel[offset + radius];
    output[y * width + x] = sum;
  }
  return output;
}
for (const [width, height] of [[1, 1], [1, 97], [97, 1], [5, 3], [151, 83]]) {
  const gray = Float32Array.from({ length: width * height }, (_, i) => ((i * 8191 + 131) % 65536) / 65535);
  for (const sigma of [.01, .7, 2, 24]) assert.deepEqual(gaussianBlur2d(gray, width, height, sigma), referenceBlur(gray, width, height, sigma));
}
const width = 64, height = 47;
const gray = Float32Array.from({ length: width * height }, (_, i) => (i * 17 % 65536) / 65535);
const settings = { denoiseStrength: 35, contrastBoost: 100 };
const process = createPreprocessingCache();
const first = process(gray, width, height, settings);
assert.deepEqual(first, preprocessWithJs(gray, width, height, settings));
assert.equal(process(gray, width, height, settings), first, 'Unchanged preview reuses the complete result');
const contrast = process(gray, width, height, { ...settings, contrastBoost: 160 });
assert.equal(contrast.cleanNormalized, first.cleanNormalized, 'Contrast reuses the expensive background correction');
assert.deepEqual(contrast, preprocessWithJs(gray, width, height, { ...settings, contrastBoost: 160 }));
const denoise = process(gray, width, height, { ...settings, denoiseStrength: 70 });
assert.notEqual(denoise.cleanNormalized, first.cleanNormalized, 'Denoise invalidates background correction');
assert.deepEqual(denoise, preprocessWithJs(gray, width, height, { ...settings, denoiseStrength: 70 }));
const other = new Float32Array(gray), third = new Float32Array(gray);
const otherResult = process(other, width, height, settings);
assert.equal(process(gray, width, height, { ...settings, denoiseStrength: 70 }), denoise, 'Switching between two gels reuses prior work');
process(third, width, height, settings);
assert.notEqual(process(other, width, height, settings), otherResult, 'Cache holds at most two image buffers');
process.clear();
assert.notEqual(process(gray, width, height, settings), first, 'Disposal releases cached results');

const frames = new Map(); let sequence = 0, renders = 0;
globalThis.window = { requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); }, clearTimeout };
const runtime = { currentImage: { gray, width, height }, imageRevision: 1, currentReport: null };
const elements = { gelDenoiseStrengthInput: { value: '35' }, gelContrastStrengthInput: { value: '100' }, gelContrastStrengthValue: {} };
const controller = createImageController({ runtime, elements, deps: { renderCanvas() { renders++; } } });
controller.onEnhancementChanged(); elements.gelContrastStrengthInput.value = '160'; controller.onEnhancementChanged();
assert.equal(elements.gelContrastStrengthValue.textContent, '160%', 'Slider value updates immediately');
assert.equal(frames.size, 1, 'Rapid slider inputs request a single preview frame');
const callback = [...frames.values()][0]; frames.clear(); callback(); assert.equal(renders, 1);
controller.onEnhancementChanged(); controller.setCurrentImage(null); assert.equal(frames.size, 0, 'Image switches cancel stale preview frames');
controller.setCurrentImage({ gray, width, height }); controller.onEnhancementChanged(); controller.destroy();
assert.equal(frames.size, 0, 'Disposal cancels pending previews');
delete globalThis.window;
console.log('gel-processing-selfcheck: passed (bit-identical Gaussian, 16-bit samples, edges, staged cache, invalidation, bounded memory, slider coalescing, disposal)');
