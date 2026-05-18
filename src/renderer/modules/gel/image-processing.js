import {
  clamp,
  round
} from './shared.js';

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

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = clamp(x + offset, 0, width - 1);
        sum += data[rowOffset + sampleX] * kernel[offset + radius];
      }
      horizontal[rowOffset + x] = sum;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = clamp(y + offset, 0, height - 1);
        sum += horizontal[(sampleY * width) + x] * kernel[offset + radius];
      }
      output[(y * width) + x] = sum;
    }
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

export function preprocessWithJs(gray, width, height, settings = {}) {
  const enhancement = normalizeEnhancementSettings(settings);
  const denoiseFactor = enhancement.denoiseStrength / 100;
  const contrastFactor = enhancement.contrastBoost / 100;
  const denoiseSigma = denoiseFactor * 2.0;

  const denoised = denoiseSigma > 0.05
    ? gaussianBlur2d(gray, width, height, denoiseSigma)
    : gray;
  const background = gaussianBlur2d(denoised, width, height, BACKGROUND_SIGMA);

  let backgroundSum = 0;
  for (let index = 0; index < background.length; index += 1) {
    backgroundSum += background[index];
  }
  const backgroundMean = background.length ? (backgroundSum / background.length) : 0;

  const flatField = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    flatField[index] = clamp(denoised[index] - background[index] + backgroundMean, 0, 1);
  }

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
