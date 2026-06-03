import {
  confidenceLabel,
  clamp,
  countCompleteLaneBandWindows,
  getLaneRectifiedWidth,
  getLaneRowSegment,
  getLaneVertexBounds,
  getLaneVerticesForLane,
  getTargetBandWindowForLane,
  isPerLaneBandMode,
  mean,
  normalizeManualOverrides,
  round
} from './shared.js';
import {
  buildQuantificationSignal,
  normalizeEnhancementSettings,
  preprocessWithJs
} from './image-processing.js';

function sampleArrayValue(data, width, height, x, y) {
  const safeX = clamp(Number(x) || 0, 0, width - 1);
  const safeY = clamp(Number(y) || 0, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = (data[(y0 * width) + x0] * (1 - tx)) + (data[(y0 * width) + x1] * tx);
  const bottom = (data[(y1 * width) + x0] * (1 - tx)) + (data[(y1 * width) + x1] * tx);
  return (top * (1 - ty)) + (bottom * ty);
}

function forEachRectifiedLaneSample({ lane, width, height, rowY }, callback) {
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

  const { rowMeans, smoothed, baseline } = computeLaneBaseline({
    signal,
    width,
    lane,
    height,
    bandThickness: thickness
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
  let baselineInWindowSum = 0;
  let baselineRowCount = 0;
  const laneWidth = getLaneRectifiedWidth(lane);
  for (let y = top; y <= bottom; y += 1) {
    baselineSum += baseline[y] * laneWidth;
    baselineInWindowSum += baseline[y];
    baselineRowCount += 1;
  }
  const baselineMean = baselineRowCount ? (baselineInWindowSum / baselineRowCount) : 0;
  const correctedIntensity = Math.max(0, bandSignalSum - baselineSum);

  let residualSquares = 0;
  let residualCount = 0;
  const noisePad = 4;
  for (let y = 0; y < height; y += 1) {
    if (y >= top - noisePad && y <= bottom + noisePad) {
      continue;
    }
    const residual = smoothed[y] - baseline[y];
    residualSquares += residual * residual;
    residualCount += 1;
  }
  const noiseStd = residualCount > 0
    ? Math.sqrt(residualSquares / residualCount)
    : 0;

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
    baselineMode: 'lane-profile',
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

function buildLanesFromManualSegmentation(overrides, width, height = null) {
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
      const baseLane = {
        index,
        center: Math.round((xStart + xEnd) / 2),
        xStart,
        xEnd,
        profilePeak: 0
      };
      const vertices = getLaneVerticesForLane(segmentation, index + 1, baseLane, width, height);
      const bounds = getLaneVertexBounds(vertices, width) || { xStart, xEnd };
      lanes.push({
        ...baseLane,
        center: Math.round((bounds.xStart + bounds.xEnd) / 2),
        xStart: bounds.xStart,
        xEnd: bounds.xEnd,
        vertices,
        index,
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
  const segmentation = overrides?.laneSegmentation || {};

  lanes.forEach((lane) => {
    const laneIndex = lane.index + 1;
    const targetWindow = getTargetBandWindowForLane(segmentation, laneIndex);

    if (targetWindow) {
      const targetTop = clamp(Math.floor(Math.min(targetWindow.bandTop, targetWindow.bandBottom)), 0, height - 1);
      const targetBottom = clamp(Math.floor(Math.max(targetWindow.bandTop, targetWindow.bandBottom)), targetTop, height - 1);
      const targetBand = computeCellIntensity({
        signal,
        rawGray,
        width,
        height,
        lane,
        bandTop: targetTop,
        bandBottom: targetBottom
      });
      targetBand.perLaneWindow = Boolean(targetWindow.perLane);
      lane.bands.push(targetBand);
    }

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
          pixelY: item.pixelY,
          measurementMode: 'manual-point'
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

export function linearRegression(xValues, yValues) {
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

export function buildCalibration(lanes, ladderLaneIndex, ladderStandards, imageHeight, ladderBands = []) {
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

export function applyCalibrationToBands(lanes, calibration, imageHeight) {
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

export function applyNormalization(lanes, normalizationMode) {
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

export function clusterBandsAcrossLanes(lanes, hasMwCalibration) {
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

export function computeLaneConfidence(lane, calibrationR2) {
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

export function interpretLane({
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
    const targetBand = lane.bands.find((band) => band.measurementMode === 'target-window') || null;

    return {
      laneIndex: lane.index + 1,
      xStart: lane.xStart,
      xEnd: lane.xEnd,
      vertices: lane.vertices || null,
      totalBandIntensity: round(lane.totalBandIntensity, 4),
      targetBandIntensity: targetBand ? round(targetBand.rawIntensity, 4) : null,
      rowActivityFraction: round(lane.rowActivityFraction, 4),
      confidence: {
        score: round(confidence.score, 4),
        label: confidence.label,
        factors: confidence.factors
      },
      interpretation,
      targetBand: targetBand
        ? {
          top: targetBand.top,
          bottom: targetBand.bottom,
          thickness: targetBand.thickness,
          areaPx: targetBand.areaPx,
          rawIntensity: round(targetBand.rawIntensity, 4),
          correctedIntensity: round(targetBand.correctedIntensity, 4),
          bandSignalSum: round(targetBand.bandSignalSum, 4),
          baselineSum: round(targetBand.baselineSum, 4),
          backgroundMean: round(targetBand.backgroundMean, 6),
          backgroundStd: round(targetBand.backgroundStd, 6),
          snr: round(targetBand.snr, 4),
          saturationFraction: round(targetBand.saturationFraction, 4),
          baselineMode: targetBand.baselineMode || 'lane-profile'
        }
        : null,
      bands: lane.bands.map((band) => ({
        bandIndex: band.bandIndex + 1,
        top: band.top,
        bottom: band.bottom,
        pixelY: band.pixelY,
        thickness: band.thickness,
        estimatedMw: Number.isFinite(band.estimatedMw) ? round(band.estimatedMw, 3) : null,
        rawIntensity: round(band.rawIntensity, 4),
        correctedIntensity: round(band.correctedIntensity, 4),
        bandSignalSum: round(band.bandSignalSum, 4),
        backgroundMean: round(band.backgroundMean, 6),
        backgroundStd: round(band.backgroundStd, 6),
        areaPx: band.areaPx,
        measurementMode: band.measurementMode || 'manual-point',
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
      enhancement: normalizeEnhancementSettings(params.enhancement),
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

export function analyzeGelImage({
  gray,
  imageName,
  width,
  height,
  params,
  preprocessed = null
}) {
  const manualOverrides = normalizeManualOverrides(params.manualOverrides);
  const preprocessingResult = preprocessed || preprocessWithJs(
    gray,
    width,
    height,
    params.enhancement
  );
  const { signal: quantSignal, polarity: gelPolarity } = buildQuantificationSignal(gray);
  const signal = quantSignal || preprocessingResult.cleanNormalized;

  const segmentedLanes = buildLanesFromManualSegmentation(manualOverrides, width, height);
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
    rawGray: signal,
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
      quantificationSignal: 'raw-gray',
      gelPolarity,
      manualOverridesSummary: {
        laneSegmentationLeft: manualOverrides.laneSegmentation?.gelLeft ?? null,
        laneSegmentationRight: manualOverrides.laneSegmentation?.gelRight ?? null,
        laneSegmentationDividers: manualOverrides.laneSegmentation?.dividers?.length || 0,
        laneSegmentationBandTop: manualOverrides.laneSegmentation?.bandTop ?? null,
        laneSegmentationBandBottom: manualOverrides.laneSegmentation?.bandBottom ?? null,
        laneSegmentationBandMode: isPerLaneBandMode(manualOverrides.laneSegmentation) ? 'per-lane' : 'global',
        laneSegmentationLaneBandWindows: countCompleteLaneBandWindows(manualOverrides.laneSegmentation),
        laneSegmentationLaneVertices: manualOverrides.laneSegmentation?.laneVertices?.length || 0,
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

export {
  buildLanesFromManualSegmentation,
  computeManualBand
};
