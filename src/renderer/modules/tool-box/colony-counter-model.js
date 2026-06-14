const ORT_RUNTIME_URL = '../../../../vendor/onnxruntime/ort.wasm.min.mjs';
const ORT_WASM_URL = '../../../../vendor/onnxruntime/ort-wasm-simd-threaded.wasm';
const MODEL_URL = '../../../../vendor/colony-counter/colony_heatmap_unet.onnx';
const METADATA_URL = '../../../../vendor/colony-counter/colony_heatmap_unet.json';

const FALLBACK_METADATA = {
  img_size: 1024,
  default_threshold: 0.5,
  default_min_distance: 3
};

let modelRuntimePromise = null;

function assetUrl(relativePath) {
  return new URL(relativePath, import.meta.url).href;
}

function assetPath(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  if (url.protocol !== 'file:') {
    return '';
  }
  return decodeURIComponent(url.pathname);
}

async function readAssetBytes(relativePath) {
  const readFileBytes = window.hikariApi?.readFileBytes;
  const path = assetPath(relativePath);
  if (!path || typeof readFileBytes !== 'function') {
    throw new Error(`No file reader available for ${relativePath}`);
  }

  const result = await readFileBytes(path);
  if (!result?.ok || !result.bytes) {
    throw new Error(result?.error || `Failed to read ${relativePath}`);
  }
  return result.bytes;
}

async function fetchLocalArrayBuffer(relativePath) {
  try {
    const response = await fetch(assetUrl(relativePath));
    if (!response.ok && response.status !== 0) {
      throw new Error(`Failed to load ${relativePath}`);
    }
    return response.arrayBuffer();
  } catch (error) {
    return readAssetBytes(relativePath);
  }
}

async function fetchModelMetadata() {
  try {
    const response = await fetch(assetUrl(METADATA_URL));
    if (!response.ok && response.status !== 0) {
      return FALLBACK_METADATA;
    }
    return {
      ...FALLBACK_METADATA,
      ...(await response.json())
    };
  } catch (error) {
    try {
      const bytes = await readAssetBytes(METADATA_URL);
      const text = new TextDecoder('utf-8').decode(bytes);
      return {
        ...FALLBACK_METADATA,
        ...JSON.parse(text)
      };
    } catch {
      return FALLBACK_METADATA;
    }
  }
}

async function loadModelRuntime() {
  if (!modelRuntimePromise) {
    modelRuntimePromise = (async () => {
      const [ort, metadata, wasmBuffer, modelBuffer] = await Promise.all([
        import(assetUrl(ORT_RUNTIME_URL)),
        fetchModelMetadata(),
        fetchLocalArrayBuffer(ORT_WASM_URL),
        fetchLocalArrayBuffer(MODEL_URL)
      ]);

      // Keep this single-threaded so it works from a file:// Electron renderer
      // without requiring cross-origin isolation headers for WebAssembly workers.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = new Uint8Array(wasmBuffer);

      const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });

      return { ort, session, metadata };
    })();
  }
  return modelRuntimePromise;
}

function buildInputTensor(ort, sourceCanvas, imgSize) {
  const inputCanvas = document.createElement('canvas');
  inputCanvas.width = imgSize;
  inputCanvas.height = imgSize;

  const ctx = inputCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not prepare the image for model inference.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, imgSize, imgSize);
  ctx.drawImage(sourceCanvas, 0, 0, imgSize, imgSize);

  const rgba = ctx.getImageData(0, 0, imgSize, imgSize).data;
  const pixelCount = imgSize * imgSize;
  const input = new Float32Array(pixelCount * 3);

  for (let pixel = 0, rgbaIndex = 0; pixel < pixelCount; pixel += 1, rgbaIndex += 4) {
    input[pixel] = rgba[rgbaIndex] / 255;
    input[pixelCount + pixel] = rgba[rgbaIndex + 1] / 255;
    input[(pixelCount * 2) + pixel] = rgba[rgbaIndex + 2] / 255;
  }

  return new ort.Tensor('float32', input, [1, 3, imgSize, imgSize]);
}

function isPointInsideMask(point, mask) {
  if (!mask || mask.kind === 'none') {
    return true;
  }

  const x0 = Math.min(mask.x, mask.x + mask.width);
  const y0 = Math.min(mask.y, mask.y + mask.height);
  const x1 = Math.max(mask.x, mask.x + mask.width);
  const y1 = Math.max(mask.y, mask.y + mask.height);

  if (mask.kind === 'rectangle') {
    return point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1;
  }

  if (mask.kind === 'circle') {
    const rx = Math.abs(mask.width) / 2;
    const ry = Math.abs(mask.height) / 2;
    if (rx <= 0 || ry <= 0) {
      return false;
    }
    const cx = x0 + rx;
    const cy = y0 + ry;
    const dx = (point.x - cx) / rx;
    const dy = (point.y - cy) / ry;
    return ((dx * dx) + (dy * dy)) <= 1;
  }

  return true;
}

function normalizeThreshold(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(0.99, Math.max(0.01, number));
}

function normalizeMinDistance(value, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(50, Math.max(1, number));
}

function findHeatmapPeaks(heatmap, width, height, threshold, minDistance) {
  const total = width * height;
  const peakMask = new Uint8Array(total);
  const radius = Math.max(1, Math.round(minDistance));

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + x;
      const value = heatmap[offset];
      if (!Number.isFinite(value) || value < threshold) {
        continue;
      }

      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let isLocalMaximum = true;

      for (let yy = y0; yy <= y1 && isLocalMaximum; yy += 1) {
        const neighborRowOffset = yy * width;
        for (let xx = x0; xx <= x1; xx += 1) {
          if (heatmap[neighborRowOffset + xx] > value) {
            isLocalMaximum = false;
            break;
          }
        }
      }

      if (isLocalMaximum) {
        peakMask[offset] = 1;
      }
    }
  }

  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const peaks = [];

  for (let offset = 0; offset < total; offset += 1) {
    if (!peakMask[offset] || visited[offset]) {
      continue;
    }

    let stackSize = 0;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let score = 0;

    stack[stackSize] = offset;
    stackSize += 1;
    visited[offset] = 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const current = stack[stackSize];
      const y = Math.floor(current / width);
      const x = current - (y * width);
      const value = heatmap[current];

      count += 1;
      sumX += x;
      sumY += y;
      if (value > score) {
        score = value;
      }

      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        const neighborRowOffset = yy * width;
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          const neighborOffset = neighborRowOffset + xx;
          if (!peakMask[neighborOffset] || visited[neighborOffset]) {
            continue;
          }
          visited[neighborOffset] = 1;
          stack[stackSize] = neighborOffset;
          stackSize += 1;
        }
      }
    }

    if (count > 0) {
      peaks.push({
        x: sumX / count,
        y: sumY / count,
        score
      });
    }
  }

  return peaks;
}

function getOutputTensor(result, outputNames) {
  const outputName = outputNames?.[0] || 'heatmap';
  const output = result[outputName] || result.heatmap || Object.values(result)[0];
  if (!output) {
    throw new Error('The colony model did not return a heatmap output.');
  }
  return output;
}

export async function countColoniesWithModel(sourceCanvas, options = {}) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) {
    throw new Error('Load a plate image before running the colony model.');
  }

  const startedAt = performance.now();
  const { ort, session, metadata } = await loadModelRuntime();
  const imgSize = Math.max(1, Math.round(Number(metadata.img_size) || FALLBACK_METADATA.img_size));
  const threshold = normalizeThreshold(options.threshold, Number(metadata.default_threshold) || 0.5);
  const minDistance = normalizeMinDistance(options.minDistance, Number(metadata.default_min_distance) || 3);

  const input = buildInputTensor(ort, sourceCanvas, imgSize);
  const result = await session.run({ image: input });
  const output = getOutputTensor(result, session.outputNames);
  const data = output.data || await output.getData();
  const dims = Array.isArray(output.dims) ? output.dims : [];
  const heatmapWidth = Math.max(1, Math.round(dims[dims.length - 1] || imgSize));
  const heatmapHeight = Math.max(1, Math.round(dims[dims.length - 2] || imgSize));
  const peaks = findHeatmapPeaks(data, heatmapWidth, heatmapHeight, threshold, minDistance);

  const scaleX = sourceCanvas.width / heatmapWidth;
  const scaleY = sourceCanvas.height / heatmapHeight;
  const colonies = peaks
    .map((peak) => ({
      x: peak.x * scaleX,
      y: peak.y * scaleY,
      score: peak.score
    }))
    .filter((point) => isPointInsideMask(point, options.mask));

  return {
    colonies,
    elapsedMs: performance.now() - startedAt,
    imgSize,
    threshold,
    minDistance,
    totalPeaks: peaks.length
  };
}
