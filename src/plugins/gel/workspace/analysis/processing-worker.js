import { createPreprocessingCache } from './image-processing.js';
import { loadSimdGaussian } from './simd-convolution.js';

const ready = loadSimdGaussian().then(core => ({ ...core, process: createPreprocessingCache({ blur: core.blur }) }));
const images = new Map();
self.onmessage = async ({ data }) => {
  const { id, imageId, width, height, settings, gray } = data;
  try {
    const core = await ready;
    if (gray) images.set(imageId, gray);
    const pixels = images.get(imageId);
    if (!pixels || pixels.length !== width * height) throw new Error('The gel image is unavailable.');
    images.delete(imageId); images.set(imageId, pixels);
    if (images.size > 2) images.delete(images.keys().next().value);
    const start = performance.now();
    const result = core.process(pixels, width, height, settings);
    // Retain the worker's cached correction; transfer independent output buffers
    // so neither its cache nor the editor's original 16-bit pixels are detached.
    const cleanNormalized = new Float32Array(result.cleanNormalized);
    const previewGray = new Float32Array(result.previewGray);
    const previewRgba = new Uint8ClampedArray(result.previewImageData.data);
    self.postMessage({ id, result: { cleanNormalized, previewGray, previewRgba, width, height,
      preprocessing: { ...result.preprocessing, backend: core.backend } },
      stats: { backend: core.backend, computeMs: performance.now() - start } },
    [cleanNormalized.buffer, previewGray.buffer, previewRgba.buffer]);
  } catch (error) { self.postMessage({ id, error: error?.message || 'Image processing failed.' }); }
};
