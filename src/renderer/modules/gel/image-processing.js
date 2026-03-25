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
  for (let y = 0; y < height; y += 1) {
    const tileY = Math.min(tilesY - 1, Math.floor(y / tileHeight));
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.min(tilesX - 1, Math.floor(x / tileWidth));
      const map = maps[(tileY * tilesX) + tileX];
      const bucket = clamp(Math.round(data[rowOffset + x] * 255), 0, 255);
      output[rowOffset + x] = map[bucket];
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

function applyPreviewContrast(data, contrastBoost) {
  const contrastFactor = clamp((Number(contrastBoost) || 100) / 100, 0, 2.2);
  const gain = 0.95 + (contrastFactor * 0.95);
  const gamma = clamp(1.2 - (contrastFactor * 0.42), 0.45, 1.4);
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const centered = ((data[index] - 0.5) * gain) + 0.5;
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

export function preprocessWithJs(gray, width, height, settings = {}) {
  const enhancement = normalizeEnhancementSettings(settings);
  const denoiseFactor = enhancement.denoiseStrength / 100;
  const contrastFactor = enhancement.contrastBoost / 100;
  const claheClipFactor = 1 + (contrastFactor * 1.5);
  const denoiseSigma = 0.6 + (denoiseFactor * 1.8);
  const backgroundSigma = 10 + (denoiseFactor * 18);

  const clahe = applyClaheLike(gray, width, height, {
    tilesX: 8,
    tilesY: 8,
    clipFactor: claheClipFactor
  });
  const smooth = gaussianBlur2d(clahe, width, height, denoiseSigma);
  const background = gaussianBlur2d(smooth, width, height, backgroundSigma);

  const cleaned = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    cleaned[index] = smooth[index] - background[index];
  }

  const cleanNormalized = normalizeArrayRange(cleaned);
  const previewGray = applyPreviewContrast(cleanNormalized, enhancement.contrastBoost);

  return {
    cleanNormalized,
    previewGray,
    previewImageData: grayArrayToImageData(previewGray, width, height),
    preprocessing: {
      grayscale: true,
      clahe: true,
      backend: 'js',
      denoiseStrength: enhancement.denoiseStrength,
      contrastBoost: enhancement.contrastBoost,
      claheClipFactor: round(claheClipFactor, 4),
      gaussianSigma: round(denoiseSigma, 4),
      rollingBallApproxRadius: round(backgroundSigma * 3, 2)
    }
  };
}

export function convertRgbaToGray(imageData) {
  const { data } = imageData;
  const gray = new Float32Array(imageData.width * imageData.height);
  for (let index = 0, grayIndex = 0; index < data.length; index += 4, grayIndex += 1) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    gray[grayIndex] = clamp((0.299 * r) + (0.587 * g) + (0.114 * b), 0, 1);
  }
  return gray;
}
