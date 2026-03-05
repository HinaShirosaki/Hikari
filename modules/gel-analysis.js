const MAX_IMAGE_DIMENSION = 1400;
const DEFAULT_LADDER_STANDARDS = [250, 150, 100, 75, 50, 37, 25, 20, 15, 10];
const LOCAL_UTIF_URL = './vendor/utif/UTIF.js';

let utifLoadPromise = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function confidenceLabel(score) {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.5) {
    return 'medium';
  }
  return 'low';
}

function createEmptyManualOverrides() {
  return {
    laneSegmentation: {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null
    },
    addedBands: [],
    ladderLane: null,
    ladderBands: [],
    ladderBandsDone: false
  };
}

function normalizeManualOverrides(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const normalized = createEmptyManualOverrides();

  const rawSegmentation = input.laneSegmentation && typeof input.laneSegmentation === 'object'
    ? input.laneSegmentation
    : {};
  const rawGelLeft = rawSegmentation.gelLeft;
  const rawGelRight = rawSegmentation.gelRight;
  const rawBandTop = rawSegmentation.bandTop;
  const rawBandBottom = rawSegmentation.bandBottom;
  const gelLeft = (rawGelLeft === null || rawGelLeft === undefined || rawGelLeft === '')
    ? NaN
    : Number(rawGelLeft);
  const gelRight = (rawGelRight === null || rawGelRight === undefined || rawGelRight === '')
    ? NaN
    : Number(rawGelRight);
  const bandTop = (rawBandTop === null || rawBandTop === undefined || rawBandTop === '')
    ? NaN
    : Number(rawBandTop);
  const bandBottom = (rawBandBottom === null || rawBandBottom === undefined || rawBandBottom === '')
    ? NaN
    : Number(rawBandBottom);
  normalized.laneSegmentation = {
    gelLeft: Number.isFinite(gelLeft) ? Math.max(0, Math.floor(gelLeft)) : null,
    gelRight: Number.isFinite(gelRight) ? Math.max(0, Math.floor(gelRight)) : null,
    dividers: (Array.isArray(rawSegmentation.dividers) ? rawSegmentation.dividers : [])
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]),
    dividerDone: Boolean(rawSegmentation.dividerDone),
    bandTop: Number.isFinite(bandTop) ? Math.max(0, Math.floor(bandTop)) : null,
    bandBottom: Number.isFinite(bandBottom) ? Math.max(0, Math.floor(bandBottom)) : null
  };

  normalized.addedBands = (Array.isArray(input.addedBands) ? input.addedBands : [])
    .map((item) => ({
      laneIndex: Math.max(1, Math.floor(Number(item?.laneIndex) || 0)),
      pixelY: Math.max(0, Math.floor(Number(item?.pixelY) || 0))
    }))
    .filter((item) => item.laneIndex > 0);

  const ladderLaneValue = Number(input.ladderLane);
  normalized.ladderLane = Number.isFinite(ladderLaneValue) && ladderLaneValue >= 1
    ? Math.floor(ladderLaneValue)
    : null;
  normalized.ladderBands = (Array.isArray(input.ladderBands) ? input.ladderBands : [])
    .map((item) => ({
      pixelY: Math.max(0, Math.floor(Number(item?.pixelY) || 0)),
      mw: Number(item?.mw)
    }))
    .filter((item) => Number.isFinite(item.mw) && item.mw > 0)
    .sort((a, b) => a.pixelY - b.pixelY);
  normalized.ladderBandsDone = Boolean(input.ladderBandsDone);

  return normalized;
}

function safeFilePart(raw, fallback) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function computeHistogramPercentiles(data, lowPercentile = 2, highPercentile = 98) {
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

function normalizeArrayRange(data) {
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

function buildGaussianKernel(sigma) {
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

function gaussianBlur2d(data, width, height, sigma) {
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

function preprocessWithJs(gray, width, height) {
  const clahe = applyClaheLike(gray, width, height, {
    tilesX: 8,
    tilesY: 8,
    clipFactor: 2.5
  });
  const smooth = gaussianBlur2d(clahe, width, height, 1.2);
  const background = gaussianBlur2d(smooth, width, height, 16);

  const cleaned = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    cleaned[index] = smooth[index] - background[index];
  }

  return {
    cleanNormalized: normalizeArrayRange(cleaned),
    preprocessing: {
      clahe: true,
      backend: 'js',
      gaussianSigma: 1.2,
      rollingBallApproxRadius: 50
    }
  };
}

function computeManualBand({
  signal,
  rawGray,
  width,
  height,
  lane,
  pixelY
}) {
  const yCenter = clamp(Math.round(pixelY), 0, height - 1);
  const bandTop = clamp(yCenter - 2, 0, height - 1);
  const bandBottom = clamp(yCenter + 2, 0, height - 1);
  const thickness = Math.max(1, bandBottom - bandTop + 1);
  const laneWidth = Math.max(1, lane.xEnd - lane.xStart + 1);
  const backgroundSpan = Math.max(2, Math.round(thickness * 1.5));

  let bandSum = 0;
  let bandPixelCount = 0;
  let bgSum = 0;
  let bgSumSquares = 0;
  let bgPixelCount = 0;
  let saturatedCount = 0;

  for (let y = bandTop; y <= bandBottom; y += 1) {
    const rowOffset = y * width;
    for (let x = lane.xStart; x <= lane.xEnd; x += 1) {
      const value = signal[rowOffset + x];
      const raw = rawGray[rowOffset + x];
      bandSum += value;
      bandPixelCount += 1;
      if (raw >= 0.99) {
        saturatedCount += 1;
      }
    }
  }

  const ranges = [
    { start: bandTop - backgroundSpan, end: bandTop - 1 },
    { start: bandBottom + 1, end: bandBottom + backgroundSpan }
  ];
  ranges.forEach((range) => {
    const start = clamp(range.start, 0, height - 1);
    const end = clamp(range.end, 0, height - 1);
    if (end < start) {
      return;
    }
    for (let y = start; y <= end; y += 1) {
      const rowOffset = y * width;
      for (let x = lane.xStart; x <= lane.xEnd; x += 1) {
        const value = signal[rowOffset + x];
        bgSum += value;
        bgSumSquares += value * value;
        bgPixelCount += 1;
      }
    }
  });

  const bgMean = bgPixelCount ? (bgSum / bgPixelCount) : 0;
  const bgVariance = bgPixelCount
    ? Math.max(0, (bgSumSquares / bgPixelCount) - (bgMean ** 2))
    : 0;
  const bgStd = Math.sqrt(bgVariance);
  const correctedIntensity = Math.max(0, bandSum - (bgMean * bandPixelCount));
  const bandMean = bandPixelCount ? (bandSum / bandPixelCount) : 0;
  const snr = bgStd > 1e-6 ? (bandMean - bgMean) / bgStd : (bandMean > bgMean ? 5 : 0);
  const sharpness = Math.max(0.01, Math.abs(bandMean - bgMean) / Math.max(1, thickness));

  return {
    bandIndex: 0,
    pixelY: yCenter,
    top: bandTop,
    bottom: bandBottom,
    thickness,
    rawIntensity: correctedIntensity,
    snr,
    sharpness,
    saturationFraction: bandPixelCount ? (saturatedCount / bandPixelCount) : 0,
    normalizedIntensity: null,
    estimatedMw: null,
    groupId: null,
    groupLabel: null,
    manual: true
  };
}

function buildLanesFromManualSegmentation(overrides, width) {
  const segmentation = overrides?.laneSegmentation || {};
  const gelLeft = Number.isFinite(segmentation.gelLeft) ? clamp(segmentation.gelLeft, 0, width - 1) : null;
  const gelRight = Number.isFinite(segmentation.gelRight) ? clamp(segmentation.gelRight, 0, width - 1) : null;
  if (!Number.isFinite(gelLeft) || !Number.isFinite(gelRight) || gelRight <= gelLeft + 2) {
    return null;
  }

  const boundaries = [gelLeft];
  (Array.isArray(segmentation.dividers) ? segmentation.dividers : [])
    .map((value) => clamp(Math.floor(value), 0, width - 1))
    .filter((value) => value > gelLeft + 1 && value < gelRight - 1)
    .sort((a, b) => a - b)
    .forEach((value) => {
      if (boundaries[boundaries.length - 1] !== value) {
        boundaries.push(value);
      }
    });
  boundaries.push(gelRight);

  const lanes = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const next = boundaries[index + 1];
    const xStart = clamp(start, 0, width - 1);
    const xEnd = clamp(Math.max(xStart + 1, next - 1), xStart + 1, width - 1);
    if (xEnd > xStart) {
      lanes.push({
        index,
        center: Math.round((xStart + xEnd) / 2),
        xStart,
        xEnd,
        profilePeak: 0
      });
    }
  }

  return lanes.length ? lanes : null;
}

function applyBandOverrides({
  lanes,
  overrides,
  signal,
  rawGray,
  width,
  height
}) {
  lanes.forEach((lane) => {
    const laneIndex = lane.index + 1;

    const added = overrides.addedBands.filter((item) => item.laneIndex === laneIndex);
    added.forEach((item) => {
      const exists = lane.bands.some((band) => Math.abs(band.pixelY - item.pixelY) <= 8);
      if (!exists) {
        const band = computeManualBand({
          signal,
          rawGray,
          width,
          height,
          lane,
          pixelY: item.pixelY
        });
        if (band.rawIntensity > 0) {
          lane.bands.push(band);
        }
      }
    });

    lane.bands.sort((a, b) => a.pixelY - b.pixelY);
    lane.bands.forEach((band, index) => {
      band.bandIndex = index;
    });
    lane.totalBandIntensity = lane.bands.reduce((sum, band) => sum + band.rawIntensity, 0);
  });
}

function linearRegression(xValues, yValues) {
  const count = Math.min(xValues.length, yValues.length);
  if (count < 2) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let index = 0; index < count; index += 1) {
    const x = xValues[index];
    const y = yValues[index];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = (count * sumXX) - (sumX * sumX);
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const slope = ((count * sumXY) - (sumX * sumY)) / denominator;
  const intercept = (sumY - (slope * sumX)) / count;

  const avgY = sumY / count;
  let ssRes = 0;
  let ssTot = 0;
  for (let index = 0; index < count; index += 1) {
    const predicted = (slope * xValues[index]) + intercept;
    ssRes += (yValues[index] - predicted) ** 2;
    ssTot += (yValues[index] - avgY) ** 2;
  }

  const r2 = ssTot > 0 ? (1 - (ssRes / ssTot)) : 1;

  return { slope, intercept, r2 };
}

function buildCalibration(lanes, ladderLaneIndex, ladderStandards, imageHeight, ladderBands = []) {
  const manualBands = (Array.isArray(ladderBands) ? ladderBands : [])
    .filter((item) => Number.isFinite(item?.pixelY) && Number.isFinite(item?.mw) && item.mw > 0);
  if (manualBands.length >= 2) {
    const matched = manualBands
      .slice()
      .sort((a, b) => a.pixelY - b.pixelY)
      .map((item) => ({
        bandY: clamp(Math.round(item.pixelY), 0, Math.max(0, imageHeight - 1)),
        mw: item.mw
      }));
    const xValues = matched.map((item) => item.bandY / Math.max(1, imageHeight));
    const yValues = matched.map((item) => Math.log10(item.mw));
    const fit = linearRegression(xValues, yValues);
    if (!fit) {
      return {
        ok: false,
        ladderLaneIndex,
        reason: 'Manual ladder MW calibration fit failed.'
      };
    }
    return {
      ok: true,
      ladderLaneIndex,
      slope: fit.slope,
      intercept: fit.intercept,
      r2: clamp(fit.r2, 0, 1),
      matchedPoints: matched,
      manual: true
    };
  }

  if (!lanes.length) {
    return {
      ok: false,
      ladderLaneIndex,
      reason: 'No lanes detected.'
    };
  }

  const laneIndexZeroBased = clamp((ladderLaneIndex || 1) - 1, 0, lanes.length - 1);
  const ladderLane = lanes[laneIndexZeroBased];
  const bands = (ladderLane?.bands || []).slice().sort((a, b) => a.pixelY - b.pixelY);
  const standards = ladderStandards.slice().sort((a, b) => b - a);
  const count = Math.min(bands.length, standards.length);

  if (count < 2) {
    return {
      ok: false,
      ladderLaneIndex: laneIndexZeroBased + 1,
      reason: 'Need at least two ladder bands and two standards for calibration.'
    };
  }

  const xValues = [];
  const yValues = [];
  const matched = [];

  for (let index = 0; index < count; index += 1) {
    const band = bands[index];
    const mw = standards[index];
    const distance = band.pixelY / Math.max(1, imageHeight);
    xValues.push(distance);
    yValues.push(Math.log10(mw));
    matched.push({
      bandY: band.pixelY,
      mw
    });
  }

  const fit = linearRegression(xValues, yValues);
  if (!fit) {
    return {
      ok: false,
      ladderLaneIndex: laneIndexZeroBased + 1,
      reason: 'Calibration fit failed.'
    };
  }

  return {
    ok: true,
    ladderLaneIndex: laneIndexZeroBased + 1,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: clamp(fit.r2, 0, 1),
    matchedPoints: matched,
    manual: false
  };
}

function applyCalibrationToBands(lanes, calibration, imageHeight) {
  lanes.forEach((lane) => {
    lane.bands.forEach((band) => {
      if (!calibration.ok) {
        band.estimatedMw = null;
        return;
      }
      const distance = band.pixelY / Math.max(1, imageHeight);
      const logMw = (calibration.slope * distance) + calibration.intercept;
      band.estimatedMw = 10 ** logMw;
    });
  });
}

function applyNormalization(lanes, normalizationMode) {
  lanes.forEach((lane) => {
    const total = lane.bands.reduce((sum, band) => sum + band.rawIntensity, 0);
    const maxIntensity = Math.max(0, ...lane.bands.map((band) => band.rawIntensity));

    lane.bands.forEach((band) => {
      if (normalizationMode === 'total-lane') {
        band.normalizedIntensity = total > 0 ? (band.rawIntensity / total) : null;
      } else {
        band.normalizedIntensity = maxIntensity > 0
          ? (band.rawIntensity / maxIntensity)
          : null;
      }
    });
  });
}

function clusterBandsAcrossLanes(lanes, hasMwCalibration) {
  const allBands = [];
  lanes.forEach((lane) => {
    lane.bands.forEach((band) => {
      allBands.push({
        laneIndex: lane.index,
        bandIndex: band.bandIndex,
        mw: band.estimatedMw,
        yNorm: lane.imageHeight ? (band.pixelY / lane.imageHeight) : 0,
        band
      });
    });
  });

  if (!allBands.length) {
    return [];
  }

  const clusters = [];

  if (hasMwCalibration) {
    allBands
      .filter((item) => Number.isFinite(item.mw) && item.mw > 0)
      .sort((a, b) => b.mw - a.mw)
      .forEach((item) => {
        let bestCluster = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        clusters.forEach((cluster) => {
          if (!Number.isFinite(cluster.centerMw) || cluster.centerMw <= 0) {
            return;
          }
          const relativeDistance = Math.abs(item.mw - cluster.centerMw) / cluster.centerMw;
          if (relativeDistance <= 0.05 && relativeDistance < bestDistance) {
            bestDistance = relativeDistance;
            bestCluster = cluster;
          }
        });

        if (!bestCluster) {
          bestCluster = {
            id: `group-${clusters.length + 1}`,
            centerMw: item.mw,
            centerYNorm: item.yNorm,
            members: []
          };
          clusters.push(bestCluster);
        }

        bestCluster.members.push(item);
        bestCluster.centerMw = mean(bestCluster.members.map((member) => member.mw));
      });
  } else {
    allBands
      .sort((a, b) => a.yNorm - b.yNorm)
      .forEach((item) => {
        let bestCluster = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        clusters.forEach((cluster) => {
          const distance = Math.abs(item.yNorm - cluster.centerYNorm);
          if (distance <= 0.03 && distance < bestDistance) {
            bestDistance = distance;
            bestCluster = cluster;
          }
        });

        if (!bestCluster) {
          bestCluster = {
            id: `group-${clusters.length + 1}`,
            centerMw: null,
            centerYNorm: item.yNorm,
            members: []
          };
          clusters.push(bestCluster);
        }

        bestCluster.members.push(item);
        bestCluster.centerYNorm = mean(bestCluster.members.map((member) => member.yNorm));
      });
  }

  clusters.forEach((cluster, clusterIndex) => {
    const label = hasMwCalibration && Number.isFinite(cluster.centerMw)
      ? `Band Group ${clusterIndex + 1} (~${round(cluster.centerMw, 1)} kDa)`
      : `Band Group ${clusterIndex + 1}`;

    cluster.label = label;

    cluster.members.forEach((member) => {
      member.band.groupId = cluster.id;
      member.band.groupLabel = label;
    });
  });

  return clusters.map((cluster) => ({
    id: cluster.id,
    label: cluster.label,
    approxMw: Number.isFinite(cluster.centerMw) ? round(cluster.centerMw, 2) : null,
    members: cluster.members.map((member) => ({
      laneIndex: member.laneIndex + 1,
      bandIndex: member.bandIndex + 1
    }))
  }));
}

function computeLaneConfidence(lane, calibrationR2) {
  if (!lane.bands.length) {
    const fallback = 0.25;
    return {
      score: fallback,
      label: confidenceLabel(fallback),
      factors: {
        sharpness: 0,
        snr: 0,
        ladderFit: calibrationR2,
        saturation: 0.3,
        bandCount: 0
      }
    };
  }

  const sharpnessValues = lane.bands.map((band) => Math.max(0, band.sharpness));
  const snrValues = lane.bands.map((band) => Math.max(0, band.snr));
  const saturationValues = lane.bands.map((band) => clamp(band.saturationFraction, 0, 1));

  const sharpnessScore = clamp(mean(sharpnessValues) / 0.12, 0, 1);
  const snrScore = clamp(mean(snrValues) / 6, 0, 1);
  const saturationScore = clamp(1 - (mean(saturationValues) * 2.5), 0, 1);
  const ladderFitScore = clamp(calibrationR2, 0, 1);
  const bandCountScore = clamp(lane.bands.length / 6, 0.3, 1);

  const score = (
    (0.25 * sharpnessScore) +
    (0.3 * snrScore) +
    (0.2 * ladderFitScore) +
    (0.15 * saturationScore) +
    (0.1 * bandCountScore)
  );

  return {
    score: clamp(score, 0, 1),
    label: confidenceLabel(score),
    factors: {
      sharpness: round(sharpnessScore, 4),
      snr: round(snrScore, 4),
      ladderFit: round(ladderFitScore, 4),
      saturation: round(saturationScore, 4),
      bandCount: round(bandCountScore, 4)
    }
  };
}

function interpretLane({
  lane,
  analysisType
}) {
  const notes = [];
  const warnings = [];

  const maxIntensity = Math.max(0, ...lane.bands.map((band) => band.rawIntensity));
  const strongBands = lane.bands.filter((band) => band.rawIntensity >= (maxIntensity * 0.45));
  const smearDetected = lane.rowActivityFraction >= 0.45;

  if (analysisType === 'sds-page') {
    if (strongBands.length === 1) {
      notes.push('Single dominant band detected.');
    }

    if (strongBands.length > 1) {
      warnings.push('Multiple strong bands detected: contamination or degradation likely.');
    }

    if (smearDetected) {
      warnings.push('Smear-like lane profile: possible degradation or overloading.');
    }

    if (!lane.bands.length) {
      warnings.push('No reliable bands detected in this lane.');
    }
  } else if (analysisType === 'western') {
    if (strongBands.length > 1) {
      warnings.push('Additional strong bands detected: possible nonspecific binding or isoforms.');
    }

    const strongestNormalized = Math.max(0, ...lane.bands.map((band) => band.normalizedIntensity || 0));
    if (strongestNormalized > 0 && strongestNormalized < 0.2) {
      warnings.push('Target band is faint: low expression or weak antibody signal possible.');
    }

    if (smearDetected) {
      warnings.push('Diffuse lane signal: transfer quality or loading may be suboptimal.');
    }
  } else {
    if (!lane.bands.length) {
      warnings.push('No clear nucleic acid bands detected.');
    } else if (strongBands.length === 1) {
      notes.push('Single dominant agarose band detected.');
    } else if (strongBands.length > 1) {
      notes.push('Multiple agarose bands detected.');
    }

    if (smearDetected) {
      warnings.push('Smear pattern detected: possible degradation or overloaded sample.');
    }
  }

  return {
    notes,
    warnings,
    strongBandCount: strongBands.length,
    smearDetected
  };
}

function buildReport({
  imageName,
  width,
  height,
  analysisType,
  params,
  preprocessing,
  laneDetection,
  lanes,
  calibration,
  bandGroups
}) {
  const laneReports = lanes.map((lane) => {
    const interpretation = interpretLane({
      lane,
      analysisType
    });

    const confidence = computeLaneConfidence(lane, calibration.ok ? calibration.r2 : 0.45);

    return {
      laneIndex: lane.index + 1,
      xStart: lane.xStart,
      xEnd: lane.xEnd,
      totalBandIntensity: round(lane.totalBandIntensity, 4),
      rowActivityFraction: round(lane.rowActivityFraction, 4),
      confidence: {
        score: round(confidence.score, 4),
        label: confidence.label,
        factors: confidence.factors
      },
      interpretation,
      bands: lane.bands.map((band) => ({
        bandIndex: band.bandIndex + 1,
        top: band.top,
        bottom: band.bottom,
        pixelY: band.pixelY,
        thickness: band.thickness,
        estimatedMw: Number.isFinite(band.estimatedMw) ? round(band.estimatedMw, 3) : null,
        rawIntensity: round(band.rawIntensity, 4),
        normalizedIntensity: Number.isFinite(band.normalizedIntensity) ? round(band.normalizedIntensity, 4) : null,
        snr: round(band.snr, 4),
        sharpness: round(band.sharpness, 4),
        saturationFraction: round(band.saturationFraction, 4),
        manual: Boolean(band.manual),
        manualMw: Boolean(band.manualMw),
        groupId: band.groupId,
        groupLabel: band.groupLabel
      }))
    };
  });

  const laneScores = laneReports.map((lane) => lane.confidence.score).filter((score) => Number.isFinite(score));
  const overallScore = laneScores.length ? mean(laneScores) : 0;
  const warnings = [];

  if (!calibration.ok) {
    warnings.push(`MW calibration unavailable: ${calibration.reason}`);
  } else if (calibration.r2 < 0.85) {
    warnings.push(`Ladder calibration fit is weak (R^2=${round(calibration.r2, 3)}). MW estimates may be unreliable.`);
  }

  const saturatedLanes = laneReports.filter((lane) =>
    lane.bands.some((band) => (band.saturationFraction || 0) >= 0.2)
  );
  if (saturatedLanes.length) {
    warnings.push(`Potential saturation detected in lane(s): ${saturatedLanes.map((lane) => lane.laneIndex).join(', ')}.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    image: {
      name: imageName,
      width,
      height,
      tiffPage: params.tiffPage,
      tiffPageCount: params.tiffPageCount
    },
    analysisType,
    preprocessing,
    parameters: {
      analysisMode: 'manual',
      cropApplied: Boolean(params.cropApplied),
      ladderStandards: params.ladderStandards,
      ladderLane: params.ladderLane,
      normalization: params.normalization,
      ladderBands: normalizeManualOverrides(params.manualOverrides).ladderBands,
      manualOverrides: normalizeManualOverrides(params.manualOverrides)
    },
    laneDetection: {
      laneCount: laneReports.length,
      profileThreshold: laneDetection.threshold
    },
    calibration: calibration.ok
      ? {
        ok: true,
        ladderLane: calibration.ladderLaneIndex,
        slope: round(calibration.slope, 6),
        intercept: round(calibration.intercept, 6),
        r2: round(calibration.r2, 6),
        manual: Boolean(calibration.manual),
        matchedPoints: calibration.matchedPoints.map((point) => ({
          bandY: point.bandY,
          mw: point.mw
        }))
      }
      : {
        ok: false,
        ladderLane: calibration.ladderLaneIndex,
        reason: calibration.reason
      },
    confidence: {
      score: round(overallScore, 4),
      label: confidenceLabel(overallScore)
    },
    bandGroups,
    lanes: laneReports,
    warnings
  };
}

function analyzeGelImage({
  gray,
  imageName,
  width,
  height,
  params
}) {
  const manualOverrides = normalizeManualOverrides(params.manualOverrides);
  const preprocessingResult = preprocessWithJs(gray, width, height);
  const signal = preprocessingResult.cleanNormalized;

  const segmentedLanes = buildLanesFromManualSegmentation(manualOverrides, width);
  const laneBlueprints = segmentedLanes || [];
  if (!laneBlueprints.length) {
    throw new Error('Manual analysis requires left/right borders and lane dividers first.');
  }

  const lanes = laneBlueprints.map((lane) => ({
    ...lane,
    laneWidth: lane.xEnd - lane.xStart + 1,
    threshold: 0,
    rowActivityFraction: 0,
    totalBandIntensity: 0,
    bands: []
  }));

  applyBandOverrides({
    lanes,
    overrides: manualOverrides,
    signal,
    rawGray: gray,
    width,
    height
  });

  lanes.forEach((lane) => {
    lane.imageHeight = height;
  });

  const calibration = buildCalibration(
    lanes,
    manualOverrides.ladderLane || params.ladderLane,
    params.ladderStandards,
    height,
    manualOverrides.ladderBands
  );

  applyCalibrationToBands(lanes, calibration, height);
  applyNormalization(lanes, params.normalization);

  const bandGroups = clusterBandsAcrossLanes(lanes, calibration.ok);

  const report = buildReport({
    imageName,
    width,
    height,
    analysisType: params.analysisType,
    params,
    preprocessing: {
      ...preprocessingResult.preprocessing,
      manualOverridesSummary: {
        laneSegmentationLeft: manualOverrides.laneSegmentation?.gelLeft ?? null,
        laneSegmentationRight: manualOverrides.laneSegmentation?.gelRight ?? null,
        laneSegmentationDividers: manualOverrides.laneSegmentation?.dividers?.length || 0,
        laneSegmentationBandTop: manualOverrides.laneSegmentation?.bandTop ?? null,
        laneSegmentationBandBottom: manualOverrides.laneSegmentation?.bandBottom ?? null,
        addedBands: manualOverrides.addedBands.length,
        ladderLaneOverride: manualOverrides.ladderLane || null,
        ladderBands: manualOverrides.ladderBands.length,
        ladderBandsDone: Boolean(manualOverrides.ladderBandsDone)
      }
    },
    laneDetection: {
      lanes: laneBlueprints,
      profile: [],
      threshold: null
    },
    lanes,
    calibration,
    bandGroups
  });

  return {
    report,
    overlay: {
      width,
      height,
      lanes: report.lanes
    }
  };
}

function convertRgbaToGray(imageData) {
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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read image file.'));
    };
    image.src = url;
  });
}

function isTiffFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return name.endsWith('.tif') || name.endsWith('.tiff') || type.includes('tiff');
}

function isUtifReady() {
  return Boolean(window.UTIF && typeof window.UTIF.decode === 'function');
}

function loadUtifScript() {
  if (isUtifReady()) {
    return Promise.resolve(true);
  }

  if (utifLoadPromise) {
    return utifLoadPromise;
  }

  utifLoadPromise = new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll('script[src]')]
      .find((script) => String(script.src || '').includes('UTIF.js'));

    if (existing) {
      if (isUtifReady()) {
        resolve(true);
      } else {
        setTimeout(() => {
          if (isUtifReady()) {
            resolve(true);
          } else {
            reject(new Error('UTIF.js failed to initialize.'));
          }
        }, 200);
      }
      return;
    }

    const script = document.createElement('script');
    script.src = LOCAL_UTIF_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (isUtifReady()) {
        resolve(true);
      } else {
        reject(new Error(`UTIF loaded from ${LOCAL_UTIF_URL} but failed to initialize.`));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load UTIF.js from ${LOCAL_UTIF_URL}.`));
    document.head.append(script);
  }).finally(() => {
    if (!isUtifReady()) {
      utifLoadPromise = null;
    }
  });

  return utifLoadPromise;
}

async function decodeTiffFile(file) {
  await loadUtifScript();
  const buffer = await file.arrayBuffer();
  const ifds = window.UTIF.decode(buffer);
  if (!ifds || !ifds.length) {
    throw new Error('No TIFF pages were found in this file.');
  }

  const page = ifds[0];
  window.UTIF.decodeImage(buffer, page);
  const width = Number(page.width || page.t256 || 0);
  const height = Number(page.height || page.t257 || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Could not decode TIFF dimensions.');
  }

  const rgba = window.UTIF.toRGBA8(page);
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);

  return {
    name: file.name,
    width,
    height,
    imageData,
    tiffPageIndex: 1,
    tiffPageCount: ifds.length
  };
}

function normalizeDecodedImage({ name, width, height, imageData, tiffPageIndex = null, tiffPageCount = null }) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(64, Math.round(width * scale));
  const targetHeight = Math.max(64, Math.round(height * scale));

  if (targetWidth === width && targetHeight === height) {
    return {
      name,
      width,
      height,
      imageData,
      gray: convertRgbaToGray(imageData),
      tiffPageIndex,
      tiffPageCount
    };
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.putImageData(imageData, 0, 0);

  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const targetContext = targetCanvas.getContext('2d', { willReadFrequently: true });
  targetContext.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  const resizedImageData = targetContext.getImageData(0, 0, targetWidth, targetHeight);

  return {
    name,
    width: targetWidth,
    height: targetHeight,
    imageData: resizedImageData,
    gray: convertRgbaToGray(resizedImageData),
    tiffPageIndex,
    tiffPageCount
  };
}

async function decodeImageFile(file) {
  if (isTiffFile(file)) {
    const decodedTiff = await decodeTiffFile(file);
    return normalizeDecodedImage(decodedTiff);
  }

  const image = await loadImageFromFile(file);
  const width = image.width;
  const height = image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  return normalizeDecodedImage({
    name: file.name,
    width,
    height,
    imageData
  });
}

function createBandsCsv(report) {
  const lines = [
    [
      'lane',
      'band',
      'top_px',
      'bottom_px',
      'estimated_mw_kda',
      'raw_intensity',
      'normalized_intensity',
      'snr',
      'sharpness',
      'saturation_fraction',
      'manual_band',
      'manual_mw',
      'band_group',
      'lane_confidence',
      'lane_confidence_label'
    ].join(',')
  ];

  (report.lanes || []).forEach((lane) => {
    if (!lane.bands?.length) {
      lines.push([
        lane.laneIndex,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        lane.confidence?.score ?? '',
        lane.confidence?.label ?? ''
      ].map(escapeCsv).join(','));
      return;
    }

    lane.bands.forEach((band) => {
      lines.push([
        lane.laneIndex,
        band.bandIndex,
        band.top,
        band.bottom,
        band.estimatedMw ?? '',
        band.rawIntensity ?? '',
        band.normalizedIntensity ?? '',
        band.snr ?? '',
        band.sharpness ?? '',
        band.saturationFraction ?? '',
        band.manual ? 'yes' : 'no',
        band.manualMw ? 'yes' : 'no',
        band.groupLabel || '',
        lane.confidence?.score ?? '',
        lane.confidence?.label ?? ''
      ].map(escapeCsv).join(','));
    });
  });

  return `${lines.join('\n')}\n`;
}

function downloadTextFile({ content, fileName, mimeType }) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function initGelAnalysis({ state, persist, createId, safeText, onGelAnalysesChanged }) {
  const gelForm = document.getElementById('gel-form');
  const gelIdInput = document.getElementById('gel-id');
  const gelNameInput = document.getElementById('gel-name');
  const gelProjectInput = document.getElementById('gel-project');
  const gelNotebookEntryInput = document.getElementById('gel-notebook-entry');
  const gelTypeInput = document.getElementById('gel-type');
  const gelImageFileInput = document.getElementById('gel-image-file');
  const gelLadderLaneInput = document.getElementById('gel-ladder-lane');
  const gelLadderBandMwInput = document.getElementById('gel-ladder-band-mw');
  const gelNormalizationInput = document.getElementById('gel-normalization');
  const gelResetOverridesBtn = document.getElementById('gel-reset-overrides-btn');
  const gelStartCropBtn = document.getElementById('gel-start-crop-btn');
  const gelApplyCropBtn = document.getElementById('gel-apply-crop-btn');
  const gelCancelCropBtn = document.getElementById('gel-cancel-crop-btn');
  const gelResetCropBtn = document.getElementById('gel-reset-crop-btn');
  const gelOverrideStatus = document.getElementById('gel-override-status');
  const gelStatus = document.getElementById('gel-status');
  const gelRunBtn = document.getElementById('gel-run-btn');
  const gelCancelBtn = document.getElementById('gel-cancel-btn');
  const gelExportJsonBtn = document.getElementById('gel-export-json-btn');
  const gelExportCsvBtn = document.getElementById('gel-export-csv-btn');
  const gelCanvas = document.getElementById('gel-canvas');
  const gelCropperImage = document.getElementById('gel-cropper-image');
  const gelReportSummary = document.getElementById('gel-report-summary');
  const gelReportJson = document.getElementById('gel-report-json');
  const gelSearchInput = document.getElementById('gel-search');
  const gelList = document.getElementById('gel-list');
  const gelManualProgress = document.getElementById('gel-manual-progress');
  const gelStepLeft = document.getElementById('gel-step-left');
  const gelStepRight = document.getElementById('gel-step-right');
  const gelStepDividers = document.getElementById('gel-step-dividers');
  const gelStepLadder = document.getElementById('gel-step-ladder');
  const gelStepLadderMw = document.getElementById('gel-step-ladder-mw');
  const gelStepBandTop = document.getElementById('gel-step-band-top');
  const gelStepBandBottom = document.getElementById('gel-step-band-bottom');
  const gelStepBands = document.getElementById('gel-step-bands');
  const gelManualPrevBtn = document.getElementById('gel-manual-prev-btn');
  const gelManualNextBtn = document.getElementById('gel-manual-next-btn');
  const gelManualResetBtn = document.getElementById('gel-manual-reset-btn');

  let currentImage = null;
  let originalImage = null;
  let currentReport = null;
  let manualOverrides = createEmptyManualOverrides();
  let cropApplied = false;
  let cropperInstance = null;
  let cropperActive = false;
  let cropDisplaySize = null;
  let manualDividerConfirmed = false;

  gelProjectInput?.addEventListener('change', renderNotebookOptions);
  gelImageFileInput?.addEventListener('change', onImageFileChange);
  gelRunBtn?.addEventListener('click', onRunAnalysis);
  gelResetOverridesBtn?.addEventListener('click', onResetManualOverrides);
  gelStartCropBtn?.addEventListener('click', onStartCrop);
  gelApplyCropBtn?.addEventListener('click', onApplyCrop);
  gelCancelCropBtn?.addEventListener('click', onCancelCrop);
  gelResetCropBtn?.addEventListener('click', onResetCrop);
  gelCanvas?.addEventListener('click', onCanvasClick);
  gelCancelBtn?.addEventListener('click', resetForm);
  gelExportJsonBtn?.addEventListener('click', onExportJson);
  gelExportCsvBtn?.addEventListener('click', onExportCsv);
  gelForm?.addEventListener('submit', onSaveAnalysis);
  gelSearchInput?.addEventListener('input', renderList);
  gelList?.addEventListener('click', onListClick);
  gelManualPrevBtn?.addEventListener('click', onManualPrevStep);
  gelManualNextBtn?.addEventListener('click', onManualNextStep);
  gelManualResetBtn?.addEventListener('click', onManualResetSteps);

  function ensureState() {
    if (!Array.isArray(state.gelAnalyses)) {
      state.gelAnalyses = [];
    }
  }

  function setStatus(message) {
    if (gelStatus) {
      gelStatus.textContent = message || '';
    }
  }

  function getManualStep(overrides = normalizeManualOverrides(manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
    const hasLeft = Number.isFinite(segmentation.gelLeft);
    const hasRight = Number.isFinite(segmentation.gelRight);
    const dividerDone = Boolean(segmentation.dividerDone) || manualDividerConfirmed;
    if (!hasLeft) {
      return 'left';
    }
    if (!hasRight) {
      return 'right';
    }
    if (!dividerDone) {
      return 'dividers';
    }
    if (!Number.isFinite(overrides.ladderLane) || overrides.ladderLane < 1) {
      return 'ladder';
    }
    if (!Boolean(overrides.ladderBandsDone)) {
      return 'ladder-mw';
    }
    if (!Number.isFinite(segmentation.bandTop)) {
      return 'band-top';
    }
    if (!Number.isFinite(segmentation.bandBottom)) {
      return 'band-bottom';
    }
    return 'bands';
  }

  function updateStepClass(element, state) {
    if (!element) {
      return;
    }
    element.classList.toggle('is-active', state === 'active');
    element.classList.toggle('is-done', state === 'done');
  }

  function renderManualProgress() {
    if (gelManualProgress) {
      gelManualProgress.hidden = false;
    }

    const overrides = normalizeManualOverrides(manualOverrides);
    const activeStep = getManualStep(overrides);
    const dividerDone = Boolean(overrides.laneSegmentation?.dividerDone) || manualDividerConfirmed;
    updateStepClass(gelStepLeft, activeStep === 'left' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelLeft) ? 'done' : 'todo'));
    updateStepClass(gelStepRight, activeStep === 'right' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelRight) ? 'done' : 'todo'));
    updateStepClass(gelStepDividers, activeStep === 'dividers' ? 'active' : (dividerDone ? 'done' : 'todo'));
    updateStepClass(gelStepLadder, activeStep === 'ladder' ? 'active' : (Number.isFinite(overrides.ladderLane) ? 'done' : 'todo'));
    updateStepClass(gelStepLadderMw, activeStep === 'ladder-mw' ? 'active' : (Boolean(overrides.ladderBandsDone) ? 'done' : 'todo'));
    updateStepClass(gelStepBandTop, activeStep === 'band-top' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandTop) ? 'done' : 'todo'));
    updateStepClass(gelStepBandBottom, activeStep === 'band-bottom' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandBottom) ? 'done' : 'todo'));
    updateStepClass(gelStepBands, activeStep === 'bands' ? 'active' : ((overrides.addedBands?.length || 0) > 0 ? 'done' : 'todo'));

    if (gelManualPrevBtn) {
      gelManualPrevBtn.disabled = activeStep === 'left';
    }
    if (gelManualNextBtn) {
      gelManualNextBtn.disabled = !(activeStep === 'dividers' || activeStep === 'ladder-mw');
      gelManualNextBtn.textContent = activeStep === 'ladder-mw' ? 'Done Ladder MW' : 'Done Dividers';
    }
  }

  function copyNormalizedImage(image) {
    if (!image) {
      return null;
    }
    return {
      ...image,
      imageData: new ImageData(new Uint8ClampedArray(image.imageData.data), image.width, image.height),
      gray: new Float32Array(image.gray)
    };
  }

  function imageDataToDataUrl(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function destroyCropper() {
    if (cropperInstance && typeof cropperInstance.destroy === 'function') {
      cropperInstance.destroy();
    }
    cropperInstance = null;
    cropperActive = false;
    if (gelCropperImage) {
      gelCropperImage.classList.remove('is-active');
      gelCropperImage.style.display = 'none';
      gelCropperImage.style.width = '';
      gelCropperImage.style.height = '';
      gelCropperImage.style.maxWidth = '';
      gelCropperImage.removeAttribute('src');
    }
    if (gelCanvas) {
      gelCanvas.hidden = false;
      gelCanvas.style.display = 'block';
    }
    cropDisplaySize = null;
  }

  function captureCurrentGelDisplaySize() {
    const canvasRect = gelCanvas?.getBoundingClientRect();
    if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
      return {
        width: Math.round(canvasRect.width),
        height: Math.round(canvasRect.height)
      };
    }
    const shell = gelCanvas?.closest('.gel-canvas-shell');
    const shellRect = shell?.getBoundingClientRect();
    if (shellRect && shellRect.width > 0) {
      return {
        width: Math.round(shellRect.width),
        height: Math.max(320, Math.round((shellRect.width * (currentImage?.height || 1)) / Math.max(1, currentImage?.width || 1)))
      };
    }
    return null;
  }

  function showCropperForCurrentImage() {
    if (!currentImage || !gelCropperImage || !window.Cropper) {
      return false;
    }
    destroyCropper();
    cropDisplaySize = captureCurrentGelDisplaySize();
    gelCropperImage.src = imageDataToDataUrl(currentImage.imageData);
    gelCropperImage.classList.add('is-active');
    if (cropDisplaySize) {
      gelCropperImage.style.width = `${cropDisplaySize.width}px`;
      gelCropperImage.style.height = `${cropDisplaySize.height}px`;
      gelCropperImage.style.maxWidth = 'none';
    } else {
      gelCropperImage.style.width = '100%';
      gelCropperImage.style.height = 'auto';
      gelCropperImage.style.maxWidth = '100%';
    }
    if (gelCanvas) {
      gelCanvas.hidden = true;
      gelCanvas.style.display = 'none';
    }
    cropperInstance = new window.Cropper(gelCropperImage, {
      viewMode: 1,
      autoCropArea: 1,
      responsive: true,
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      minContainerWidth: cropDisplaySize?.width || 200,
      minContainerHeight: cropDisplaySize?.height || 200
    });
    cropperActive = true;
    return true;
  }

  function setCropUiState() {
    if (gelApplyCropBtn) {
      gelApplyCropBtn.disabled = !cropperActive || !cropperInstance;
    }
    if (gelCancelCropBtn) {
      gelCancelCropBtn.disabled = !cropperActive;
    }
  }

  function leaveCropMode() {
    destroyCropper();
    setCropUiState();
  }

  function enterCropMode() {
    if (!window.Cropper) {
      setStatus('Cropper.js is not loaded.');
      return false;
    }
    const started = showCropperForCurrentImage();
    setCropUiState();
    return started;
  }

  function renderOverrideStatus() {
    if (!gelOverrideStatus) {
      return;
    }
    const summary = normalizeManualOverrides(manualOverrides);
    const parts = [
      `gel ${summary.laneSegmentation?.gelLeft ?? '-'}-${summary.laneSegmentation?.gelRight ?? '-'}`,
      `div ${summary.laneSegmentation?.dividers?.length || 0}`,
      `bandY ${summary.laneSegmentation?.bandTop ?? '-'}-${summary.laneSegmentation?.bandBottom ?? '-'}`,
      `add ${summary.addedBands.length}`,
      `ladderMW ${summary.ladderBands?.length || 0}`,
      `ladder ${summary.ladderLane || '-'}`
    ];
    gelOverrideStatus.textContent = `Manual overrides: ${parts.join(' | ')}`;
    renderManualProgress();
  }

  function readParams() {
    const rawType = gelTypeInput?.value;
    const analysisType = rawType === 'western' || rawType === 'agarose' ? rawType : 'sds-page';

    return {
      analysisType,
      analysisMode: 'manual',
      ladderStandards: DEFAULT_LADDER_STANDARDS.slice(),
      ladderLane: clamp(Math.floor(Number(gelLadderLaneInput?.value) || 1), 1, 999),
      normalization: gelNormalizationInput?.value === 'total-lane'
        ? gelNormalizationInput.value
        : 'none',
      cropApplied,
      tiffPage: Number.isFinite(currentImage?.tiffPageIndex) ? currentImage.tiffPageIndex : null,
      tiffPageCount: Number.isFinite(currentImage?.tiffPageCount) ? currentImage.tiffPageCount : null,
      manualOverrides: normalizeManualOverrides(manualOverrides)
    };
  }

  function renderProjectOptions() {
    if (!gelProjectInput) {
      return;
    }
    const selected = gelProjectInput.value;
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    gelProjectInput.innerHTML = options.join('');
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      gelProjectInput.value = selected;
    }
  }

  function notebookLabel(entry) {
    const typeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
    return `${typeLabel}: ${entry.protocolName || '-'} (${updated})`;
  }

  function formatAnalysisTypeLabel(type) {
    if (type === 'western') {
      return 'Western Blot';
    }
    if (type === 'agarose') {
      return 'DNA/RNA Agarose';
    }
    return 'SDS-PAGE';
  }

  function renderNotebookOptions() {
    if (!gelNotebookEntryInput) {
      return;
    }

    const selected = gelNotebookEntryInput.value;
    const projectId = gelProjectInput?.value || '';
    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

    const options = ['<option value="">Not linked</option>'];
    entries.forEach((entry) => {
      options.push(`<option value="${entry.id}">${safeText(notebookLabel(entry))}</option>`);
    });

    gelNotebookEntryInput.innerHTML = options.join('');

    if (selected && entries.some((entry) => entry.id === selected)) {
      gelNotebookEntryInput.value = selected;
    }
  }

  function onResetManualOverrides() {
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    currentReport = null;
    renderOverrideStatus();
    renderReport();
    setStatus('Manual overrides cleared.');
    if (currentImage) {
      onRunAnalysis();
    } else {
      renderCanvas();
    }
  }

  function onStartCrop() {
    if (!currentImage) {
      setStatus('Load a gel image before cropping.');
      return;
    }
    const started = enterCropMode();
    if (!started) {
      setStatus('Failed to start crop mode.');
      return;
    }
    setStatus('Crop mode: adjust selection with Cropper.js, then click Apply Crop.');
  }

  function onCancelCrop() {
    if (!cropperActive) {
      return;
    }
    leaveCropMode();
    renderCanvas();
    setStatus('Crop cancelled.');
  }

  function onApplyCrop() {
    if (!currentImage) {
      setStatus('Load a gel image before cropping.');
      return;
    }
    if (!cropperInstance) {
      setStatus('Start crop mode first.');
      return;
    }
    const croppedCanvas = cropperInstance.getCroppedCanvas({
      minWidth: 12,
      minHeight: 12,
      fillColor: '#000'
    });
    if (!croppedCanvas || croppedCanvas.width < 12 || croppedCanvas.height < 12) {
      setStatus('Select a larger crop area first.');
      return;
    }
    const context = croppedCanvas.getContext('2d', { willReadFrequently: true });
    const croppedData = context.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    currentImage = normalizeDecodedImage({
      name: currentImage.name,
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      imageData: croppedData,
      tiffPageIndex: currentImage.tiffPageIndex,
      tiffPageCount: currentImage.tiffPageCount
    });
    cropApplied = true;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    renderOverrideStatus();
    renderReport();
    leaveCropMode();
    renderCanvas();
    setStatus(`Crop applied: ${currentImage.width}x${currentImage.height}. Ready to analyze.`);
  }

  function onResetCrop() {
    if (!originalImage) {
      setStatus('No original image available to reset.');
      return;
    }
    currentImage = copyNormalizedImage(originalImage);
    cropApplied = false;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    renderOverrideStatus();
    renderReport();
    leaveCropMode();
    renderCanvas();
    setStatus('Restored full image. Crop the gel before analysis.');
  }

  function getCanvasPoint(event) {
    const rect = gelCanvas?.getBoundingClientRect();
    if (!rect || !currentImage) {
      return null;
    }
    const x = ((event.clientX - rect.left) / rect.width) * currentImage.width;
    const y = ((event.clientY - rect.top) / rect.height) * currentImage.height;
    return {
      x: clamp(Math.round(x), 0, currentImage.width - 1),
      y: clamp(Math.round(y), 0, currentImage.height - 1)
    };
  }

  function updateLaneSegmentation(patch) {
    const normalized = normalizeManualOverrides(manualOverrides);
    const current = normalized.laneSegmentation || {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null
    };
    const next = {
      gelLeft: current.gelLeft,
      gelRight: current.gelRight,
      dividers: Array.isArray(current.dividers) ? current.dividers.slice() : [],
      dividerDone: Boolean(current.dividerDone),
      bandTop: Number.isFinite(current.bandTop) ? current.bandTop : null,
      bandBottom: Number.isFinite(current.bandBottom) ? current.bandBottom : null,
      ...patch
    };
    next.dividers = next.dividers
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]);
    const rawBandTop = next.bandTop;
    const rawBandBottom = next.bandBottom;
    next.bandTop = (rawBandTop === null || rawBandTop === undefined || rawBandTop === '')
      ? null
      : (Number.isFinite(Number(rawBandTop)) ? Math.max(0, Math.floor(Number(rawBandTop))) : null);
    next.bandBottom = (rawBandBottom === null || rawBandBottom === undefined || rawBandBottom === '')
      ? null
      : (Number.isFinite(Number(rawBandBottom)) ? Math.max(0, Math.floor(Number(rawBandBottom))) : null);
    manualOverrides = {
      ...normalized,
      laneSegmentation: next
    };
  }

  function upsertLadderBandMw(pixelY, mw) {
    const normalized = normalizeManualOverrides(manualOverrides);
    const points = normalized.ladderBands
      .filter((item) => Math.abs(item.pixelY - pixelY) > 8);
    points.push({
      pixelY: clamp(Math.round(pixelY), 0, Math.max(0, currentImage.height - 1)),
      mw
    });
    points.sort((a, b) => a.pixelY - b.pixelY);
    manualOverrides = {
      ...normalized,
      ladderBands: points
    };
  }

  function syncAddedBandsFromBandWindow() {
    if (!currentImage) {
      return;
    }
    const normalized = normalizeManualOverrides(manualOverrides);
    const segmentation = normalized.laneSegmentation || {};
    if (!Number.isFinite(segmentation.bandTop) || !Number.isFinite(segmentation.bandBottom)) {
      return;
    }
    const top = segmentation.bandTop;
    const bottom = segmentation.bandBottom;
    if (bottom <= top + 1) {
      return;
    }
    const lanes = buildLanesFromManualSegmentation(normalized, currentImage.width);
    if (!lanes?.length) {
      return;
    }
    const centerY = clamp(Math.round((top + bottom) / 2), 0, currentImage.height - 1);
    manualOverrides = {
      ...normalized,
      addedBands: lanes.map((lane) => ({
        laneIndex: lane.index + 1,
        pixelY: centerY
      }))
    };
  }

  function inferLaneIndexFromSegmentationX(x) {
    if (!currentImage) {
      return null;
    }
    const lanes = buildLanesFromManualSegmentation(normalizeManualOverrides(manualOverrides), currentImage.width);
    if (!lanes?.length) {
      return null;
    }
    const match = lanes.find((lane) => x >= lane.xStart && x <= lane.xEnd);
    if (match) {
      return match.index + 1;
    }
    let bestLane = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    lanes.forEach((lane) => {
      const distance = Math.abs(((lane.xStart + lane.xEnd) / 2) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLane = lane;
      }
    });
    return bestLane ? bestLane.index + 1 : null;
  }

  function onManualNextStep() {
    const step = getManualStep();
    const segmentation = normalizeManualOverrides(manualOverrides).laneSegmentation || {};
    if (step === 'dividers') {
      if (!Number.isFinite(segmentation.gelLeft) || !Number.isFinite(segmentation.gelRight)) {
        setStatus('Set left and right borders before finishing dividers.');
        return;
      }
      manualDividerConfirmed = true;
      updateLaneSegmentation({ dividerDone: true });
      renderOverrideStatus();
      setStatus('Divider step completed. Click a lane to set ladder lane.');
      return;
    }

    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(manualOverrides);
      if ((normalized.ladderBands?.length || 0) < 2) {
        setStatus('Add at least 2 ladder MW points before continuing.');
        return;
      }
      manualOverrides = {
        ...normalized,
        ladderBandsDone: true
      };
      renderOverrideStatus();
      setStatus('Ladder MW step completed. Click the top line of target band.');
      onRunAnalysis();
    }
  }

  function onManualPrevStep() {
    const step = getManualStep();
    const normalized = normalizeManualOverrides(manualOverrides);
    if (step === 'left') {
      return;
    }
    if (step === 'right') {
      updateLaneSegmentation({ gelLeft: null });
      manualDividerConfirmed = false;
    } else if (step === 'dividers') {
      updateLaneSegmentation({ gelRight: null, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder') {
      updateLaneSegmentation({ dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder-mw') {
      manualOverrides = {
        ...normalized,
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'band-top') {
      manualOverrides = {
        ...normalized,
        ladderBandsDone: false
      };
    } else if (step === 'band-bottom') {
      updateLaneSegmentation({ bandTop: null, bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
    } else {
      updateLaneSegmentation({ bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
    }
    currentReport = null;
    renderOverrideStatus();
    renderCanvas();
    renderReport();
    setStatus('Moved back to previous step.');
  }

  function onManualResetSteps() {
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    currentReport = null;
    renderOverrideStatus();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('Manual workflow reset.');
  }

  function addLaneDivider(x) {
    const normalized = normalizeManualOverrides(manualOverrides);
    const segmentation = normalized.laneSegmentation || {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null
    };
    const divider = clamp(Math.floor(x), 0, Math.max(0, currentImage.width - 1));
    const gelLeft = Number.isFinite(segmentation.gelLeft) ? segmentation.gelLeft : null;
    const gelRight = Number.isFinite(segmentation.gelRight) ? segmentation.gelRight : null;
    if (Number.isFinite(gelLeft) && divider <= gelLeft + 1) {
      return false;
    }
    if (Number.isFinite(gelRight) && divider >= gelRight - 1) {
      return false;
    }
    updateLaneSegmentation({
      dividers: [...(segmentation.dividers || []), divider]
    });
    return true;
  }

  function appendBandOverride(laneIndex, pixelY) {
    const overrides = normalizeManualOverrides(manualOverrides);
    const current = overrides.addedBands
      .filter((item) => !(item.laneIndex === laneIndex && Math.abs(item.pixelY - pixelY) <= 8));
    current.push({ laneIndex, pixelY });
    manualOverrides = {
      ...overrides,
      addedBands: current
    };
  }

  function onCanvasClick(event) {
    if (!currentImage) {
      return;
    }
    if (cropperActive) {
      setStatus('Finish crop mode first: Apply Crop or Cancel Crop.');
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    const step = getManualStep();
    if (step === 'left') {
      updateLaneSegmentation({ gelLeft: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 1 complete: left border set at x=${point.x}.`);
      return;
    }
    if (step === 'right') {
      const left = normalizeManualOverrides(manualOverrides).laneSegmentation?.gelLeft;
      if (!Number.isFinite(left) || point.x <= left + 2) {
        setStatus('Right border must be to the right of left border.');
        return;
      }
      updateLaneSegmentation({ gelRight: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 2 complete: right border set at x=${point.x}.`);
      return;
    }
    if (step === 'dividers') {
      const added = addLaneDivider(point.x);
      renderOverrideStatus();
      renderCanvas();
      if (!added) {
        setStatus('Divider must be between left and right borders.');
        return;
      }
      setStatus(`Divider added at x=${point.x}. Add more, then click Done Dividers.`);
      return;
    }
    if (step === 'ladder') {
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex) {
        setStatus('No lane found at click position.');
        return;
      }
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: laneIndex,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 4 complete: ladder lane set to ${laneIndex}.`);
      onRunAnalysis();
      return;
    }
    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(manualOverrides);
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex || laneIndex !== normalized.ladderLane) {
        setStatus(`Click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
        return;
      }
      const mw = Number(gelLadderBandMwInput?.value);
      if (!Number.isFinite(mw) || mw <= 0) {
        setStatus('Enter Ladder Band MW (kDa) before clicking the band.');
        return;
      }
      upsertLadderBandMw(point.y, mw);
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Added ladder calibration point: y=${point.y}, MW=${mw} kDa.`);
      onRunAnalysis();
      return;
    }
    if (step === 'band-top') {
      updateLaneSegmentation({ bandTop: point.y, bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Band top line set at y=${point.y}.`);
      return;
    }
    if (step === 'band-bottom') {
      const top = normalizeManualOverrides(manualOverrides).laneSegmentation?.bandTop;
      if (!Number.isFinite(top) || point.y <= top + 1) {
        setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: point.y });
      syncAddedBandsFromBandWindow();
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Band bottom line set at y=${point.y}. Target band region applied to all lanes.`);
      onRunAnalysis();
      return;
    }
    if (step === 'bands') {
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex) {
        setStatus('No lane found at click position.');
        return;
      }
      appendBandOverride(laneIndex, point.y);
      renderOverrideStatus();
      setStatus(`Band added in lane ${laneIndex} near y=${point.y}.`);
      onRunAnalysis();
      return;
    }
  }

  async function onImageFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }

    setStatus('Loading gel image...');
    try {
      currentImage = await decodeImageFile(file);
      originalImage = copyNormalizedImage(currentImage);
      cropApplied = false;
      currentReport = null;
      manualOverrides = createEmptyManualOverrides();
      manualDividerConfirmed = false;
      leaveCropMode();
      renderOverrideStatus();
      renderCanvas();
      renderReport();
      if (isTiffFile(file)) {
        setStatus(
          `Loaded ${file.name} page ${currentImage.tiffPageIndex || 1}/${currentImage.tiffPageCount || 1} (${currentImage.width}x${currentImage.height}) via TIFF decoder.`
        );
      } else {
        setStatus(`Loaded ${file.name} (${currentImage.width}x${currentImage.height}).`);
      }
    } catch (error) {
      currentImage = null;
      originalImage = null;
      cropApplied = false;
      currentReport = null;
      manualOverrides = createEmptyManualOverrides();
      manualDividerConfirmed = false;
      leaveCropMode();
      renderOverrideStatus();
      renderCanvas();
      renderReport();
      setStatus(error instanceof Error ? error.message : 'Failed to load image.');
    }
  }

  function renderCanvas() {
    if (!gelCanvas) {
      return;
    }

    const context = gelCanvas.getContext('2d');
    if (!currentImage || !context) {
      gelCanvas.width = 1;
      gelCanvas.height = 1;
      context?.clearRect(0, 0, 1, 1);
      return;
    }

    gelCanvas.width = currentImage.width;
    gelCanvas.height = currentImage.height;
    context.putImageData(currentImage.imageData, 0, 0);

    const overrides = normalizeManualOverrides(manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const segmentationLanes = buildLanesFromManualSegmentation(overrides, currentImage.width) || [];
    if (
      Number.isFinite(segmentation.gelLeft) ||
      Number.isFinite(segmentation.gelRight) ||
      (Array.isArray(segmentation.dividers) && segmentation.dividers.length)
    ) {
      context.save();
      context.lineWidth = 1.4;
      if (Number.isFinite(segmentation.gelLeft)) {
        const x = clamp(segmentation.gelLeft, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      }
      if (Number.isFinite(segmentation.gelRight)) {
        const x = clamp(segmentation.gelRight, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      }
      (Array.isArray(segmentation.dividers) ? segmentation.dividers : []).forEach((divider) => {
        const x = clamp(divider, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      });

      if (Number.isFinite(segmentation.bandTop)) {
        const y = clamp(segmentation.bandTop, 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
      }
      if (Number.isFinite(segmentation.bandBottom)) {
        const y = clamp(segmentation.bandBottom, 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
      }

      if (Number.isFinite(segmentation.bandTop) && Number.isFinite(segmentation.bandBottom) && segmentationLanes.length) {
        const top = clamp(Math.min(segmentation.bandTop, segmentation.bandBottom), 0, currentImage.height - 1);
        const bottom = clamp(Math.max(segmentation.bandTop, segmentation.bandBottom), top + 1, currentImage.height - 1);
        segmentationLanes.forEach((lane) => {
          context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
          context.lineWidth = 1.2;
          context.strokeRect(
            lane.xStart + 0.5,
            top + 0.5,
            Math.max(1, lane.xEnd - lane.xStart),
            Math.max(1, bottom - top)
          );
        });
      }

      if (Number.isFinite(overrides.ladderLane) && segmentationLanes.length) {
        const ladder = segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane);
        if (ladder) {
          context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
          context.lineWidth = 2.2;
          context.strokeRect(
            ladder.xStart + 0.5,
            0.5,
            Math.max(1, ladder.xEnd - ladder.xStart),
            currentImage.height - 1
          );
        }
      }

      (Array.isArray(overrides.ladderBands) ? overrides.ladderBands : []).forEach((item) => {
        const y = clamp(Math.round(item.pixelY), 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
        context.fillStyle = 'rgba(255, 197, 61, 0.98)';
        context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(`${round(item.mw, 1)}kDa`, 4, Math.max(10, y - 3));
      });
      context.restore();
    }

    if (currentReport?.lanes?.length) {
      currentReport.lanes.forEach((lane) => {
        const isLadder = (overrides.ladderLane === lane.laneIndex)
          || (currentReport.calibration?.ladderLane === lane.laneIndex);
        context.strokeStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.9)';
        context.lineWidth = isLadder ? 2.2 : 1.6;
        context.strokeRect(
          lane.xStart + 0.5,
          0.5,
          Math.max(1, lane.xEnd - lane.xStart),
          currentImage.height - 1
        );

        context.fillStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.95)';
        context.font = '12px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(String(lane.laneIndex), lane.xStart + 2, 12);

        lane.bands.forEach((band) => {
          context.strokeStyle = band.manual ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 99, 132, 0.95)';
          context.lineWidth = 1.3;
          context.beginPath();
          context.moveTo(lane.xStart, band.pixelY + 0.5);
          context.lineTo(lane.xEnd, band.pixelY + 0.5);
          context.stroke();

          if (Number.isFinite(band.estimatedMw)) {
            context.fillStyle = band.manualMw ? 'rgba(34, 197, 94, 0.95)' : 'rgba(255, 99, 132, 0.92)';
            context.fillText(`${round(band.estimatedMw, 1)}kDa`, lane.xEnd + 3, band.pixelY - 1);
          }
        });
      });
    }

  }

  function renderReport() {
    if (!gelReportSummary || !gelReportJson) {
      return;
    }

    if (!currentReport) {
      gelReportSummary.innerHTML = '<p class="small-note">No analysis report yet.</p>';
      gelReportJson.textContent = '';
      return;
    }

    const totalBands = (currentReport.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
    const calibrationText = currentReport.calibration?.ok
      ? `R^2 ${currentReport.calibration.r2}`
      : 'Not calibrated';
    const tiffPageText = currentReport.image?.tiffPageCount
      ? `${currentReport.image.tiffPage}/${currentReport.image.tiffPageCount}`
      : '-';
    const manualSummary = currentReport.preprocessing?.manualOverridesSummary || {};
    const manualText = [
      `gelL:${manualSummary.laneSegmentationLeft ?? '-'}`,
      `gelR:${manualSummary.laneSegmentationRight ?? '-'}`,
      `div:${manualSummary.laneSegmentationDividers || 0}`,
      `top:${manualSummary.laneSegmentationBandTop ?? '-'}`,
      `bottom:${manualSummary.laneSegmentationBandBottom ?? '-'}`,
      `add:${manualSummary.addedBands || 0}`,
      `ladder:${manualSummary.ladderLaneOverride || '-'}`,
      `ladderMW:${manualSummary.ladderBands || 0}`
    ].join(' ');

    gelReportSummary.innerHTML = `
      <article class="card">
        <h3>${safeText(formatAnalysisTypeLabel(currentReport.analysisType))}</h3>
        <p><strong>Lanes:</strong> ${safeText(String(currentReport.lanes?.length || 0))}</p>
        <p><strong>Total Bands:</strong> ${safeText(String(totalBands))}</p>
        <p><strong>TIFF Page:</strong> ${safeText(String(tiffPageText))}</p>
        <p><strong>Calibration:</strong> ${safeText(calibrationText)}</p>
        <p><strong>Confidence:</strong> ${safeText(currentReport.confidence?.label || '-')} (${safeText(String(currentReport.confidence?.score ?? '-'))})</p>
      </article>
      <article class="card">
        <h3>Overrides</h3>
        <p>${safeText(manualText)}</p>
      </article>
      <article class="card">
        <h3>Warnings</h3>
        <p>${safeText((currentReport.warnings || []).join(' | ') || 'None')}</p>
      </article>
    `;

    gelReportJson.textContent = JSON.stringify(currentReport, null, 2);
  }

  async function onRunAnalysis() {
    if (!currentImage) {
      setStatus('Load a gel image before running analysis.');
      return;
    }

    try {
      const normalized = normalizeManualOverrides(manualOverrides);
      if (
        Number.isFinite(normalized.laneSegmentation?.bandTop)
        && Number.isFinite(normalized.laneSegmentation?.bandBottom)
        && !(normalized.addedBands?.length || 0)
      ) {
        syncAddedBandsFromBandWindow();
      }
      const params = readParams();
      setStatus('Running gel analysis pipeline...');
      const result = analyzeGelImage({
        gray: currentImage.gray,
        imageName: currentImage.name,
        width: currentImage.width,
        height: currentImage.height,
        params
      });
      currentReport = result.report;
      renderCanvas();
      renderReport();
      renderOverrideStatus();
      setStatus(`Analysis complete: ${currentReport.lanes.length} lane(s), ${currentReport.bandGroups.length} group(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }

  function buildRecordFromCurrentReport(existingId = '') {
    const project = (state.projects || []).find((item) => item.id === gelProjectInput?.value);
    const notebookEntry = (state.notebookEntries || []).find((entry) => entry.id === gelNotebookEntryInput?.value);

    return {
      id: existingId || createId(),
      name: gelNameInput?.value.trim() || `Gel-${Date.now()}`,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notebookEntryId: gelNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      imageName: currentReport?.image?.name || '',
      analysisType: currentReport?.analysisType || (gelTypeInput?.value || 'sds-page'),
      parameters: currentReport?.parameters || readParams(),
      manualOverrides: normalizeManualOverrides(manualOverrides),
      report: currentReport,
      updatedAt: new Date().toISOString()
    };
  }

  function onSaveAnalysis(event) {
    event.preventDefault();
    ensureState();

    if (!currentReport) {
      setStatus('Run analysis before saving.');
      return;
    }

    const name = gelNameInput?.value.trim() || '';
    if (!name) {
      setStatus('Analysis name is required.');
      return;
    }

    const editingId = gelIdInput?.value || '';
    const existing = state.gelAnalyses.find((item) => item.id === editingId);
    const record = buildRecordFromCurrentReport(existing?.id || '');
    record.name = name;

    const index = state.gelAnalyses.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.gelAnalyses[index] = record;
    } else {
      state.gelAnalyses.push(record);
    }

    persist();
    renderList();
    if (typeof onGelAnalysesChanged === 'function') {
      onGelAnalysesChanged();
    }
    setStatus(`Saved analysis: ${record.name}.`);
  }

  function onExportJson() {
    if (!currentReport) {
      setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(gelNameInput?.value, 'gel-analysis')}.json`;
    downloadTextFile({
      content: `${JSON.stringify(currentReport, null, 2)}\n`,
      fileName,
      mimeType: 'application/json;charset=utf-8;'
    });
    setStatus(`Exported ${fileName}.`);
  }

  function onExportCsv() {
    if (!currentReport) {
      setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(gelNameInput?.value, 'gel-analysis')}.csv`;
    downloadTextFile({
      content: createBandsCsv(currentReport),
      fileName,
      mimeType: 'text/csv;charset=utf-8;'
    });
    setStatus(`Exported ${fileName}.`);
  }

  function resetForm() {
    gelIdInput.value = '';
    gelForm.reset();
    gelTypeInput.value = 'sds-page';
    gelLadderLaneInput.value = '1';
    gelNormalizationInput.value = 'none';

    currentImage = null;
    originalImage = null;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    cropApplied = false;
    leaveCropMode();
    manualDividerConfirmed = false;

    renderProjectOptions();
    renderNotebookOptions();
    renderOverrideStatus();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('');
  }

  function fillFromRecord(record) {
    gelIdInput.value = record.id;
    gelNameInput.value = record.name || '';
    gelProjectInput.value = record.projectId || '';
    renderProjectOptions();
    gelProjectInput.value = record.projectId || '';
    renderNotebookOptions();
    gelNotebookEntryInput.value = record.notebookEntryId || '';

    const parameters = record.parameters || {};
    gelTypeInput.value = record.analysisType === 'western' || record.analysisType === 'agarose'
      ? record.analysisType
      : 'sds-page';
    gelLadderLaneInput.value = String(parameters.ladderLane || 1);
    gelNormalizationInput.value = parameters.normalization || 'none';
    manualOverrides = normalizeManualOverrides(record.manualOverrides || parameters.manualOverrides);
    manualDividerConfirmed = Boolean(manualOverrides.laneSegmentation?.dividerDone);
    renderOverrideStatus();

    currentReport = record.report || null;
    currentImage = null;
    originalImage = null;
    cropApplied = false;
    leaveCropMode();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('Loaded saved report. Upload original image to view overlay.');
  }

  function deleteRecord(recordId) {
    state.gelAnalyses = (state.gelAnalyses || []).filter((item) => item.id !== recordId);
    persist();
    renderList();
    if (typeof onGelAnalysesChanged === 'function') {
      onGelAnalysesChanged();
    }
    if (gelIdInput?.value === recordId) {
      resetForm();
    }
  }

  function onListClick(event) {
    const editBtn = event.target.closest('[data-gel-edit]');
    if (editBtn) {
      const record = (state.gelAnalyses || []).find((item) => item.id === editBtn.dataset.gelEdit);
      if (record) {
        fillFromRecord(record);
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-gel-delete]');
    if (deleteBtn) {
      deleteRecord(deleteBtn.dataset.gelDelete);
    }
  }

  function matchesSearch(record, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      record.name,
      record.projectName,
      record.notebookEntryProtocolName,
      record.analysisType,
      record.imageName,
      record.updatedAt
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(gelSearchInput?.value || '').trim().toLowerCase();
    const rows = (state.gelAnalyses || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
      .filter((record) => matchesSearch(record, term));

    if (!rows.length) {
      gelList.innerHTML = '<p class="small-note">No gel analyses saved.</p>';
      return;
    }

    gelList.innerHTML = rows.map((record) => {
      const confidence = record.report?.confidence || { label: '-', score: '-' };
      const laneCount = record.report?.lanes?.length || 0;
      const bandCount = (record.report?.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
      const overrideCount = (() => {
        const summary = record.report?.preprocessing?.manualOverridesSummary;
        if (summary) {
          return (summary.laneSegmentationDividers || 0)
            + (Number.isFinite(summary.laneSegmentationLeft) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationRight) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandTop) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandBottom) ? 1 : 0)
            + (summary.addedBands || 0)
            + (summary.ladderBands || 0)
            + (Number.isFinite(summary.ladderLaneOverride) ? 1 : 0);
        }
        const manual = normalizeManualOverrides(record.manualOverrides || {});
        const segmentationCount = (Number.isFinite(manual.laneSegmentation?.gelLeft) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.gelRight) ? 1 : 0)
          + (manual.laneSegmentation?.dividers?.length || 0)
          + (Number.isFinite(manual.laneSegmentation?.bandTop) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.bandBottom) ? 1 : 0)
          + (Number.isFinite(manual.ladderLane) ? 1 : 0);
        return manual.addedBands.length + (manual.ladderBands?.length || 0) + segmentationCount;
      })();
      return `
        <article class="card">
          <h3>${safeText(record.name || record.id)}</h3>
          <p><strong>Type:</strong> ${safeText(formatAnalysisTypeLabel(record.analysisType))}</p>
          <p><strong>Project:</strong> ${safeText(record.projectName || '-')}</p>
          <p><strong>Notebook:</strong> ${safeText(record.notebookEntryProtocolName || '-')}</p>
          <p><strong>Image:</strong> ${safeText(record.imageName || '-')}</p>
          <p><strong>Lanes/Bands:</strong> ${safeText(`${laneCount} / ${bandCount}`)}</p>
          <p><strong>Overrides:</strong> ${safeText(String(overrideCount))}</p>
          <p><strong>Confidence:</strong> ${safeText(String(confidence.label || '-'))} (${safeText(String(confidence.score ?? '-'))})</p>
          <p><strong>Updated:</strong> ${safeText(new Date(record.updatedAt || '').toLocaleString() || '-')}</p>
          <div class="card-actions">
            <button type="button" class="ghost-btn" data-gel-edit="${record.id}">Edit</button>
            <button type="button" class="danger-btn" data-gel-delete="${record.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function render() {
    ensureState();
    renderProjectOptions();
    renderNotebookOptions();
    setCropUiState();
    renderOverrideStatus();
    renderManualProgress();
    renderReport();
    renderList();
    if (!currentImage) {
      renderCanvas();
    }
  }

  return {
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList
  };
}
