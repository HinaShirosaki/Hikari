import {
  clamp,
  round
} from '../shared.js';

export function computeHistogramPercentiles(data, lowPercentile = 2, highPercentile = 98) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 1) {
    const bucket = clamp(Math.round(data[index] * 255), 0, 255);
    histogram[bucket] += 1;
  }

  const total = data.length;
  const lowTarget = (lowPercentile / 100) * total;
  const highTarget = (highPercentile / 100) * total;

  let cumulative = 0;
  let lowValue = 0;
  let highValue = 255;

  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= lowTarget) {
      lowValue = index;
      break;
    }
  }

  cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= highTarget) {
      highValue = index;
      break;
    }
  }

  return {
    low: lowValue / 255,
    high: highValue / 255
  };
}

export function normalizeArrayRange(data) {
  const { low, high } = computeHistogramPercentiles(data, 2, 98);
  const span = Math.max(1e-6, high - low);
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    output[index] = clamp((data[index] - low) / span, 0, 1);
  }
  return output;
}

function applyClaheLike(data, width, height, {
  tilesX = 8,
  tilesY = 8,
  clipFactor = 2.5
} = {}) {
  const tileWidth = Math.ceil(width / tilesX);
  const tileHeight = Math.ceil(height / tilesY);
  const maps = new Array(tilesX * tilesY);

  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const xStart = tileX * tileWidth;
      const yStart = tileY * tileHeight;
      const xEnd = Math.min(width, xStart + tileWidth);
      const yEnd = Math.min(height, yStart + tileHeight);

      const histogram = new Uint32Array(256);
      let pixelCount = 0;
      for (let y = yStart; y < yEnd; y += 1) {
        const rowOffset = y * width;
        for (let x = xStart; x < xEnd; x += 1) {
          const bucket = clamp(Math.round(data[rowOffset + x] * 255), 0, 255);
          histogram[bucket] += 1;
          pixelCount += 1;
        }
      }

      const averageBin = pixelCount / 256;
      const clipLimit = Math.max(1, Math.floor(averageBin * clipFactor));
      let excess = 0;
      for (let bucket = 0; bucket < histogram.length; bucket += 1) {
        if (histogram[bucket] > clipLimit) {
          excess += histogram[bucket] - clipLimit;
          histogram[bucket] = clipLimit;
        }
      }

      const redistributeBase = Math.floor(excess / 256);
      let redistributeRemainder = excess % 256;
      for (let bucket = 0; bucket < histogram.length; bucket += 1) {
        histogram[bucket] += redistributeBase;
        if (redistributeRemainder > 0) {
          histogram[bucket] += 1;
          redistributeRemainder -= 1;
        }
      }

      const map = new Float32Array(256);
      let cumulative = 0;
      for (let bucket = 0; bucket < histogram.length; bucket += 1) {
        cumulative += histogram[bucket];
        map[bucket] = cumulative / Math.max(1, pixelCount);
      }

      maps[(tileY * tilesX) + tileX] = map;
    }
  }

  const output = new Float32Array(data.length);
  const halfTileWidth = tileWidth / 2;
  const halfTileHeight = tileHeight / 2;
  for (let y = 0; y < height; y += 1) {
    const ty = (y + 0.5 - halfTileHeight) / tileHeight;
    const ty0Raw = Math.floor(ty);
    const fy = ty - ty0Raw;
    const ty0 = clamp(ty0Raw, 0, tilesY - 1);
    const ty1 = clamp(ty0Raw + 1, 0, tilesY - 1);
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const tx = (x + 0.5 - halfTileWidth) / tileWidth;
      const tx0Raw = Math.floor(tx);
      const fx = tx - tx0Raw;
      const tx0 = clamp(tx0Raw, 0, tilesX - 1);
      const tx1 = clamp(tx0Raw + 1, 0, tilesX - 1);
      const bucket = clamp(Math.round(data[rowOffset + x] * 255), 0, 255);
      const v00 = maps[(ty0 * tilesX) + tx0][bucket];
      const v10 = maps[(ty0 * tilesX) + tx1][bucket];
      const v01 = maps[(ty1 * tilesX) + tx0][bucket];
      const v11 = maps[(ty1 * tilesX) + tx1][bucket];
      const top = (v00 * (1 - fx)) + (v10 * fx);
      const bottom = (v01 * (1 - fx)) + (v11 * fx);
      output[rowOffset + x] = (top * (1 - fy)) + (bottom * fy);
    }
  }

  return output;
}

export function buildGaussianKernel(sigma) {
  const safeSigma = Math.max(0.01, sigma);
  const radius = Math.max(1, Math.ceil(safeSigma * 3));
  const kernel = new Float32Array((radius * 2) + 1);
  const sigmaSquared = safeSigma * safeSigma;

  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigmaSquared));
    kernel[offset + radius] = value;
    sum += value;
  }

  for (let index = 0; index < kernel.length; index += 1) {
    kernel[index] /= sum;
  }

  return { kernel, radius };
}

export function gaussianBlur2d(data, width, height, sigma) {
  const { kernel, radius } = buildGaussianKernel(sigma);
  const horizontal = new Float32Array(data.length);
  const output = new Float32Array(data.length);

  // Accumulate in the original kernel order with double precision, but walk
  // contiguous rows. Clamp only the edges, not every kernel sample of every
  // pixel. This is the same Gaussian, including its replicated-edge boundary.
  const sums = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    sums.fill(0);
    for (let offset = -radius; offset <= radius; offset += 1) {
      const weight = kernel[offset + radius];
      const leftEnd = Math.min(width, Math.max(0, -offset));
      const rightStart = Math.min(width, Math.max(0, width - offset));
      for (let x = 0; x < leftEnd; x += 1) sums[x] += data[rowOffset] * weight;
      for (let x = leftEnd; x < rightStart; x += 1) sums[x] += data[rowOffset + x + offset] * weight;
      for (let x = rightStart; x < width; x += 1) sums[x] += data[rowOffset + width - 1] * weight;
    }
    for (let x = 0; x < width; x += 1) horizontal[rowOffset + x] = sums[x];
  }

  for (let y = 0; y < height; y += 1) {
    sums.fill(0);
    for (let offset = -radius; offset <= radius; offset += 1) {
      const rowOffset = clamp(y + offset, 0, height - 1) * width;
      const weight = kernel[offset + radius];
      for (let x = 0; x < width; x += 1) sums[x] += horizontal[rowOffset + x] * weight;
    }
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) output[rowOffset + x] = sums[x];
  }

  return output;
}

export function normalizeEnhancementSettings(raw = {}) {
  const denoiseValue = Number(raw?.denoiseStrength);
  const contrastValue = Number(raw?.contrastBoost);
  return {
    denoiseStrength: Number.isFinite(denoiseValue) ? clamp(denoiseValue, 0, 100) : 35,
    contrastBoost: Number.isFinite(contrastValue) ? clamp(contrastValue, 0, 220) : 100
  };
}

function approximateMedian(data) {
  if (!data.length) {
    return 0.5;
  }
  const stride = Math.max(1, Math.floor(data.length / 10000));
  const samples = [];
  for (let i = 0; i < data.length; i += stride) {
    samples.push(data[i]);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] || 0.5;
}

function applyPreviewContrast(data, contrastBoost) {
  const contrastFactor = clamp((Number(contrastBoost) || 0) / 100, 0, 2.2);
  if (contrastFactor === 0) {
    return data;
  }
  const gain = 1 + (contrastFactor * 0.4);
  const gamma = clamp(1 - (contrastFactor * 0.12), 0.55, 1);
  const pivot = approximateMedian(data);
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const centered = ((data[index] - pivot) * gain) + pivot;
    output[index] = Math.pow(clamp(centered, 0, 1), gamma);
  }
  return output;
}

export function grayArrayToImageData(gray, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0, rgbaIndex = 0; index < gray.length; index += 1, rgbaIndex += 4) {
    const value = clamp(Math.round(gray[index] * 255), 0, 255);
    rgba[rgbaIndex] = value;
    rgba[rgbaIndex + 1] = value;
    rgba[rgbaIndex + 2] = value;
    rgba[rgbaIndex + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

const BACKGROUND_SIGMA = 24;
const CLAHE_ACTIVATION_THRESHOLD = 0.5;

function prepareFlatField(gray, width, height, denoiseSigma, blur = gaussianBlur2d) {
  const denoised = denoiseSigma > 0.05
    ? blur(gray, width, height, denoiseSigma)
    : gray;
  const background = blur(denoised, width, height, BACKGROUND_SIGMA);

  let backgroundSum = 0;
  for (let index = 0; index < background.length; index += 1) {
    backgroundSum += background[index];
  }
  const backgroundMean = background.length ? (backgroundSum / background.length) : 0;

  const flatField = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    flatField[index] = clamp(denoised[index] - background[index] + backgroundMean, 0, 1);
  }

  return flatField;
}

function finishPreprocessing(flatField, width, height, enhancement) {
  const denoiseSigma = enhancement.denoiseStrength / 100 * 2.0;
  const contrastFactor = enhancement.contrastBoost / 100;
  const claheEnabled = contrastFactor > CLAHE_ACTIVATION_THRESHOLD;
  const claheClipFactor = claheEnabled
    ? (2.0 + ((contrastFactor - CLAHE_ACTIVATION_THRESHOLD) * 2.0))
    : null;
  const claheStage = claheEnabled
    ? applyClaheLike(flatField, width, height, {
      tilesX: 8,
      tilesY: 8,
      clipFactor: claheClipFactor
    })
    : flatField;

  const previewGray = applyPreviewContrast(claheStage, enhancement.contrastBoost);

  return {
    cleanNormalized: flatField,
    previewGray,
    previewImageData: grayArrayToImageData(previewGray, width, height),
    preprocessing: {
      grayscale: true,
      clahe: claheEnabled,
      backend: 'js',
      denoiseStrength: enhancement.denoiseStrength,
      contrastBoost: enhancement.contrastBoost,
      claheClipFactor: claheEnabled ? round(claheClipFactor, 4) : null,
      denoiseSigma: round(denoiseSigma, 4),
      backgroundSigma: BACKGROUND_SIGMA,
      pipeline: 'denoise -> flat-field -> contrast'
    }
  };
}

export function preprocessWithJs(gray, width, height, settings = {}) {
  const enhancement = normalizeEnhancementSettings(settings);
  return finishPreprocessing(prepareFlatField(gray, width, height, enhancement.denoiseStrength / 100 * 2.0), width, height, enhancement);
}

// Normalized gel pixels are immutable; crop/rotate creates a new gray array.
// Keep at most two images so comparing gels reuses work without retaining the
// complete library's full-size float images. Contrast does not affect flat-field
// correction or quantification, so it only reruns the preview stages.
export function createPreprocessingCache({ blur = gaussianBlur2d } = {}) {
  const entries = [];
  function preprocess(gray, width, height, settings = {}) {
    const enhancement = normalizeEnhancementSettings(settings);
    const index = entries.findIndex(entry => entry.gray === gray && entry.width === width && entry.height === height);
    const entry = index < 0 ? { gray, width, height } : entries.splice(index, 1)[0];
    if (!entry.flatField || entry.denoiseStrength !== enhancement.denoiseStrength) {
      entry.flatField = prepareFlatField(gray, width, height, enhancement.denoiseStrength / 100 * 2.0, blur);
      entry.denoiseStrength = enhancement.denoiseStrength;
      entry.result = null;
    }
    if (!entry.result || entry.contrastBoost !== enhancement.contrastBoost) {
      entry.result = finishPreprocessing(entry.flatField, width, height, enhancement);
      entry.contrastBoost = enhancement.contrastBoost;
    }
    entries.unshift(entry); entries.length = Math.min(entries.length, 2);
    return entry.result;
  }
  preprocess.clear = () => { entries.length = 0; };
  return preprocess;
}

export function detectGelPolarity(gray) {
  if (!gray?.length) {
    return 'bright-on-dark';
  }
  const sampleStride = Math.max(1, Math.floor(gray.length / 20000));
  const samples = [];
  for (let i = 0; i < gray.length; i += sampleStride) {
    samples.push(gray[i]);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] || 0;
  return median > 0.5 ? 'dark-on-light' : 'bright-on-dark';
}

export function buildQuantificationSignal(gray) {
  if (!gray?.length) {
    return { signal: null, polarity: 'bright-on-dark' };
  }
  const polarity = detectGelPolarity(gray);
  const out = new Float32Array(gray.length);
  if (polarity === 'dark-on-light') {
    for (let i = 0; i < gray.length; i += 1) {
      out[i] = 1 - gray[i];
    }
  } else {
    out.set(gray);
  }
  return { signal: out, polarity };
}

const LIVE_CHANNEL_THRESHOLD = 8;
const MONOCHROME_RGB_FRACTION = 0.98;

export function convertRgbaToGray(imageData) {
  const { data } = imageData;
  const pixelCount = (imageData.width * imageData.height) || (data.length / 4);
  const gray = new Float32Array(pixelCount);

  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let rgbEqualCount = 0;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (r > maxR) maxR = r;
    if (g > maxG) maxG = g;
    if (b > maxB) maxB = b;
    if (r === g && g === b) rgbEqualCount += 1;
  }

  const isMonochromeRgb = pixelCount > 0
    && (rgbEqualCount / pixelCount) >= MONOCHROME_RGB_FRACTION;
  const liveR = maxR > LIVE_CHANNEL_THRESHOLD;
  const liveG = maxG > LIVE_CHANNEL_THRESHOLD;
  const liveB = maxB > LIVE_CHANNEL_THRESHOLD;
  const liveCount = Number(liveR) + Number(liveG) + Number(liveB);

  let pickChannel = null;
  if (isMonochromeRgb) {
    pickChannel = 0;
  } else if (liveCount === 1) {
    pickChannel = liveR ? 0 : (liveG ? 1 : 2);
  }

  if (pickChannel !== null) {
    for (let index = pickChannel, grayIndex = 0; grayIndex < pixelCount; index += 4, grayIndex += 1) {
      gray[grayIndex] = clamp(data[index] / 255, 0, 1);
    }
    return gray;
  }

  for (let index = 0, grayIndex = 0; grayIndex < pixelCount; index += 4, grayIndex += 1) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    gray[grayIndex] = clamp((0.2126 * r) + (0.7152 * g) + (0.0722 * b), 0, 1);
  }
  return gray;
}
