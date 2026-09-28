import { clamp, getLaneRectifiedWidth, getLaneRowSegment, sampleArrayValue } from '../shared.js';

// Reading the intensity profile of one lane out of the quantification signal:
// row means, the rolling baseline under them, and a hand-drawn band's measurement.
function forEachRectifiedLaneSample({ lane, height, rowY }, callback) {
  const laneWidth = getLaneRectifiedWidth(lane);
  const segment = getLaneRowSegment(lane, rowY, height);
  for (let sampleIndex = 0; sampleIndex < laneWidth; sampleIndex += 1) {
    const fraction = laneWidth <= 1 ? 0.5 : sampleIndex / (laneWidth - 1);
    callback({
      x: segment.left.x + ((segment.right.x - segment.left.x) * fraction),
      y: segment.left.y + ((segment.right.y - segment.left.y) * fraction),
      sampleIndex,
      laneWidth
    });
  }
  return laneWidth;
}

function computeManualBand({
  signal,
  rawGray,
  width,
  height,
  lane,
  pixelY,
  bandTopOverride = null,
  bandBottomOverride = null,
  measurementMode = 'manual-point'
}) {
  const yCenter = clamp(Math.round(pixelY), 0, height - 1);
  const hasWindow = Number.isFinite(bandTopOverride) && Number.isFinite(bandBottomOverride);
  const requestedTop = hasWindow ? Math.floor(Math.min(bandTopOverride, bandBottomOverride)) : (yCenter - 2);
  const requestedBottom = hasWindow ? Math.floor(Math.max(bandTopOverride, bandBottomOverride)) : (yCenter + 2);
  const bandTop = clamp(requestedTop, 0, height - 1);
  const bandBottom = clamp(requestedBottom, bandTop, height - 1);
  const thickness = Math.max(1, bandBottom - bandTop + 1);
  const backgroundSpan = Math.max(2, Math.round(thickness * 1.5));

  let bandSum = 0;
  let bandPixelCount = 0;
  let bgSum = 0;
  let bgSumSquares = 0;
  let bgPixelCount = 0;
  let saturatedCount = 0;

  for (let y = bandTop; y <= bandBottom; y += 1) {
    forEachRectifiedLaneSample({ lane, width, height, rowY: y }, ({ x, y: sampleY }) => {
      const value = sampleArrayValue(signal, width, height, x, sampleY);
      const raw = sampleArrayValue(rawGray, width, height, x, sampleY);
      bandSum += value;
      bandPixelCount += 1;
      if (raw >= 0.99) {
        saturatedCount += 1;
      }
    });
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
      forEachRectifiedLaneSample({ lane, width, height, rowY: y }, ({ x, y: sampleY }) => {
        const value = sampleArrayValue(signal, width, height, x, sampleY);
        bgSum += value;
        bgSumSquares += value * value;
        bgPixelCount += 1;
      });
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
    correctedIntensity,
    bandSignalSum: bandSum,
    backgroundMean: bgMean,
    backgroundStd: bgStd,
    areaPx: bandPixelCount,
    measurementMode,
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

function smoothFloat32(values, radius) {
  const n = values.length;
  const safeRadius = Math.max(1, Math.floor(radius));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let weighted = 0;
    let weights = 0;
    for (let off = -safeRadius; off <= safeRadius; off += 1) {
      const idx = clamp(i + off, 0, n - 1);
      const w = (safeRadius + 1) - Math.abs(off);
      weighted += values[idx] * w;
      weights += w;
    }
    out[i] = weights ? (weighted / weights) : values[i];
  }
  return out;
}

function rollingMinimum(values, halfWindow) {
  const n = values.length;
  const out = new Float32Array(n);
  const w = Math.max(1, Math.floor(halfWindow));
  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - w);
    const end = Math.min(n - 1, i + w);
    let m = Number.POSITIVE_INFINITY;
    for (let j = start; j <= end; j += 1) {
      if (values[j] < m) {
        m = values[j];
      }
    }
    out[i] = Number.isFinite(m) ? m : values[i];
  }
  return out;
}

function computeLaneRowMeans({ signal, width, lane, height }) {
  const rowMeans = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const laneWidth = forEachRectifiedLaneSample({ lane, width, height, rowY: y }, ({ x, y: sampleY }) => {
      rowSum += sampleArrayValue(signal, width, height, x, sampleY);
    });
    rowMeans[y] = rowSum / Math.max(1, laneWidth);
  }
  return rowMeans;
}

function computeLaneBaseline({ signal, width, lane, height, bandThickness }) {
  const rowMeans = computeLaneRowMeans({ signal, width, lane, height });
  const smoothingRadius = clamp(Math.round(height / 90), 2, 10);
  const smoothed = smoothFloat32(rowMeans, smoothingRadius);
  const windowFromBand = bandThickness * 3;
  const clampedWindow = clamp(windowFromBand, 20, Math.max(20, Math.floor(height / 4)));
  const minimum = rollingMinimum(smoothed, Math.floor(clampedWindow / 2));
  const baseline = smoothFloat32(minimum, smoothingRadius);
  return { rowMeans, smoothed, baseline };
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function profileRange(profile, start, end) {
  if (!profile?.length || end < start) {
    return [];
  }
  const safeStart = clamp(Math.floor(start), 0, profile.length - 1);
  const safeEnd = clamp(Math.floor(end), safeStart, profile.length - 1);
  return Array.from(profile.slice(safeStart, safeEnd + 1));
}

// Estimate the background underneath a target band without allowing the band
// itself to lift that estimate. Robust medians come from flanking rows outside
// a guard margin; a straight line joins the two sides across the band.
function estimateBandBaselineFromFlanks({ rowMeans, top, bottom }) {
  const height = rowMeans?.length || 0;
  if (!height) {
    return {
      values: [],
      mean: 0,
      noiseStd: 0,
      upperMedian: null,
      lowerMedian: null,
      mode: 'flanking-median-unavailable'
    };
  }

  const safeTop = clamp(Math.floor(top), 0, height - 1);
  const safeBottom = clamp(Math.floor(bottom), safeTop, height - 1);
  const thickness = Math.max(1, safeBottom - safeTop + 1);
  const guardRows = Math.max(2, Math.ceil(thickness * 0.25));
  const flankRows = Math.min(
    Math.max(4, thickness),
    Math.max(4, Math.floor(height / 4))
  );
  const upperEnd = safeTop - guardRows - 1;
  const lowerStart = safeBottom + guardRows + 1;
  const upperValues = upperEnd >= 0
    ? profileRange(rowMeans, upperEnd - flankRows + 1, upperEnd)
    : [];
  const lowerValues = lowerStart < height
    ? profileRange(rowMeans, lowerStart, lowerStart + flankRows - 1)
    : [];
  const upperMedian = median(upperValues);
  const lowerMedian = median(lowerValues);
  const startBaseline = upperMedian ?? lowerMedian ?? 0;
  const endBaseline = lowerMedian ?? upperMedian ?? 0;
  const values = Array.from({ length: thickness }, (_unused, index) => {
    const fraction = thickness <= 1 ? 0.5 : index / (thickness - 1);
    return startBaseline + ((endBaseline - startBaseline) * fraction);
  });
  const mean = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const residuals = [
    ...upperValues.map((value) => value - (upperMedian ?? startBaseline)),
    ...lowerValues.map((value) => value - (lowerMedian ?? endBaseline))
  ];
  const noiseStd = residuals.length
    ? Math.sqrt(residuals.reduce((sum, value) => sum + (value ** 2), 0) / residuals.length)
    : 0;

  return {
    values,
    mean,
    noiseStd,
    upperMedian,
    lowerMedian,
    mode: upperValues.length || lowerValues.length
      ? 'flanking-median'
      : 'flanking-median-unavailable'
  };
}

function computeCellIntensity({
  signal,
  rawGray,
  width,
  height,
  lane,
  bandTop,
  bandBottom
}) {
  const top = clamp(Math.floor(Math.min(bandTop, bandBottom)), 0, height - 1);
  const bottom = clamp(Math.floor(Math.max(bandTop, bandBottom)), top, height - 1);
  const thickness = Math.max(1, bottom - top + 1);

  const rowMeans = computeLaneRowMeans({ signal, width, lane, height });
  const background = estimateBandBaselineFromFlanks({
    rowMeans,
    top,
    bottom
  });

  let bandSignalSum = 0;
  let bandPixelCount = 0;
  let saturatedCount = 0;
  for (let y = top; y <= bottom; y += 1) {
    forEachRectifiedLaneSample({ lane, width, height, rowY: y }, ({ x, y: sampleY }) => {
      bandSignalSum += sampleArrayValue(signal, width, height, x, sampleY);
      if (sampleArrayValue(rawGray, width, height, x, sampleY) >= 0.99) {
        saturatedCount += 1;
      }
      bandPixelCount += 1;
    });
  }

  let baselineSum = 0;
  const laneWidth = getLaneRectifiedWidth(lane);
  background.values.forEach((value) => {
    baselineSum += value * laneWidth;
  });
  const baselineMean = background.mean;
  const correctedIntensity = Math.max(0, bandSignalSum - baselineSum);

  const noiseStd = background.noiseStd;

  const bandMeanPerPixel = bandPixelCount ? (bandSignalSum / bandPixelCount) : 0;
  const noiseFloor = Math.max(noiseStd, 1e-6);
  const snr = (bandMeanPerPixel - baselineMean) / noiseFloor;
  const sharpness = Math.max(0.01, Math.abs(bandMeanPerPixel - baselineMean) / Math.max(1, thickness));

  return {
    bandIndex: 0,
    pixelY: clamp(Math.round((top + bottom) / 2), 0, height - 1),
    top,
    bottom,
    thickness,
    rawIntensity: correctedIntensity,
    correctedIntensity,
    bandSignalSum,
    baselineSum,
    backgroundMean: baselineMean,
    backgroundStd: noiseStd,
    areaPx: bandPixelCount,
    measurementMode: 'target-window',
    baselineMode: background.mode,
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

export {
  computeCellIntensity,
  forEachRectifiedLaneSample,
  computeManualBand,
  smoothFloat32,
  rollingMinimum,
  computeLaneRowMeans,
  computeLaneBaseline,
  estimateBandBaselineFromFlanks
};
