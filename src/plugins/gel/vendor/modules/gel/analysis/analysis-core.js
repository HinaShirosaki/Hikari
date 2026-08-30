import {
  confidenceLabel,
  clamp,
  countCompleteLaneBandWindows,
  isPerLaneBandMode,
  mean,
  normalizeManualOverrides,
  round
} from '../shared.js';
import {
  buildQuantificationSignal,
  normalizeEnhancementSettings,
  preprocessWithJs
} from './image-processing.js';
import { computeProminence, findLocalMaxima } from './auto-lanes.js';
import { computeLaneBaseline } from './lane-signal.js';
import { applyBandOverrides, buildLanesFromManualSegmentation } from './manual-lanes.js';
import {
  applyCalibrationToBands,
  applyNormalization,
  buildCalibration,
  clusterBandsAcrossLanes,
  computeLaneConfidence,
  interpretLane
} from './calibration.js';

export {
  linearRegression,
  buildCalibration,
  applyCalibrationToBands,
  applyNormalization,
  clusterBandsAcrossLanes,
  computeLaneConfidence,
  interpretLane
} from './calibration.js';


// Rows of the strongest baseline-corrected peaks in one lane, returned in top-to-bottom
// order. Used to seed ladder MW annotations from a preset.
export function detectLadderBandRows({ signal, width, height, lane, count }) {
  if (!signal?.length || !lane || !(count > 0) || height < 3) {
    return [];
  }
  const bandThickness = clamp(Math.round(height / 40), 4, 40);
  const { smoothed, baseline } = computeLaneBaseline({ signal, width, lane, height, bandThickness });
  const corrected = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    corrected[y] = smoothed[y] - baseline[y];
  }
  // Two maxima closer than one band thickness are the same band (a plateau top or a
  // shoulder), so take them strongest-first and drop the ones that crowd a kept peak.
  const kept = [];
  findLocalMaxima(corrected, 0, height - 1)
    .map((row) => ({ row, prominence: computeProminence(corrected, row, 0, height - 1) }))
    .filter((peak) => peak.prominence > 0)
    .sort((a, b) => b.prominence - a.prominence)
    .forEach((peak) => {
      if (kept.length >= count) {
        return;
      }
      if (kept.every((row) => Math.abs(row - peak.row) >= bandThickness)) {
        kept.push(peak.row);
      }
    });
  return kept.sort((a, b) => a - b);
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
    throw new Error('Manual analysis requires at least two lane dividers first.');
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
        ladderBandsDone: Boolean(manualOverrides.ladderBandsDone),
        peakIntegrations: manualOverrides.peakIntegrations.length
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

export { buildLanesFromManualSegmentation } from './manual-lanes.js';
export { computeManualBand } from './lane-signal.js';
