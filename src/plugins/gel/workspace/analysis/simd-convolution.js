import { buildGaussianKernel, gaussianBlur2d } from './image-processing.js';

export function createSimdGaussian(instance) {
  const { memory, pass } = instance.exports;
  return function gaussian(data, width, height, sigma) {
    const { kernel, radius } = buildGaussianKernel(sigma);
    const pitch = width + 2 * radius, rows = height + 2 * radius;
    const temp = pitch * rows, output = temp + width * rows, weights = output + width * height;
    const bytes = (weights + kernel.length) * 4;
    if (bytes > 64 * 1024 * 1024 || width < 1 || height < 1) return gaussianBlur2d(data, width, height, sigma);
    if (memory.buffer.byteLength < bytes) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536));
    const buffer = new Float32Array(memory.buffer);
    for (let y = 0; y < rows; y++) {
      const source = Math.max(0, Math.min(height - 1, y - radius)) * width;
      const target = y * pitch;
      buffer.fill(data[source], target, target + radius);
      buffer.set(data.subarray(source, source + width), target + radius);
      buffer.fill(data[source + width - 1], target + radius + width, target + pitch);
    }
    buffer.set(kernel, weights);
    pass(0, temp * 4, weights * 4, width, rows, pitch, 1, kernel.length);
    pass(temp * 4, output * 4, weights * 4, width, height, width, width, kernel.length);
    return buffer.slice(output, output + width * height);
  };
}

export async function loadSimdGaussian() {
  try {
    const response = await fetch(new URL('./convolution.wasm', import.meta.url));
    if (!response.ok) throw new Error('Convolution core unavailable.');
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
    return { blur: createSimdGaussian(instance), backend: 'wasm-simd' };
  } catch {
    // Unsupported SIMD or a missing binary keeps the complete pipeline in the
    // worker, with the same numerical reference implementation.
    return { blur: gaussianBlur2d, backend: 'js-worker' };
  }
}
