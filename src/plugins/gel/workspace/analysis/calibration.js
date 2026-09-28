import { clamp, confidenceLabel, mean, round } from '../shared.js';

// Turning measured band rows into molecular weights: the ladder regression, the
// calibration it yields, normalization, and how one lane is finally read.
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
      } else if (normalizationMode === 'max') {
        band.normalizedIntensity = maxIntensity > 0
          ? (band.rawIntensity / maxIntensity)
          : null;
      } else {
        band.normalizedIntensity = null;
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
