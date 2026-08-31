import { buildLanesFromManualSegmentation, detectLadderBandRows } from '../analysis/analysis-core.js';
import { buildQuantificationSignal } from '../analysis/image-processing.js';
import { getLadderPresetBands } from '../constants.js';
import { clamp, normalizeManualOverrides } from '../shared.js';
import { LADDER_BAND_GRAB_PX } from './lane-constants.js';

// The ladder lane's bands: detecting them from the signal, and grabbing or moving
// one that is already marked.

function createManualLadderBands({
  runtime,
  elements,
  deps,
  getRectifiedLaneRowFromPoint,
  inferLaneIndexFromSegmentationPoint,
  renderOverrideStatus
} = {}) {
  function upsertLadderBandMw(pixelY, mw) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const points = normalized.ladderBands
      .filter((item) => Math.abs(item.pixelY - pixelY) > 8);
    points.push({
      pixelY: clamp(Math.round(pixelY), 0, Math.max(0, runtime.currentImage.height - 1)),
      mw
    });
    points.sort((a, b) => a.pixelY - b.pixelY);
    runtime.manualOverrides = {
      ...normalized,
      ladderBands: points
    };
  }

  function getLadderLaneShape(overrides) {
    if (!runtime.currentImage || !Number.isFinite(overrides.ladderLane)) {
      return null;
    }
    const lanes = buildLanesFromManualSegmentation(
      overrides,
      runtime.currentImage.width,
      runtime.currentImage.height
    ) || [];
    return lanes.find((lane) => lane.index + 1 === overrides.ladderLane) || null;
  }

  function onDetectLadderBands() {
    if (!runtime.currentImage) {
      deps.setStatus('Load a gel image before detecting ladder bands.');
      return;
    }
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const lane = getLadderLaneShape(overrides);
    if (!lane) {
      deps.setStatus('Set the ladder lane before detecting its bands.');
      return;
    }
    const standards = getLadderPresetBands(elements.gelLadderPresetSelect?.value)
      .filter((mw) => Number.isFinite(mw) && mw > 0)
      .sort((a, b) => b - a);
    if (!standards.length) {
      deps.setStatus('Choose a ladder preset before detecting its bands.');
      return;
    }
    const { signal } = buildQuantificationSignal(runtime.currentImage.gray);
    const rows = detectLadderBandRows({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane,
      count: standards.length
    });
    if (!rows.length) {
      deps.setStatus('No ladder bands detected. Set them by hand with Set MW.');
      return;
    }
    // ponytail: highest MW migrates least, so rows top-to-bottom pair with the preset
    // descending. A missed band shifts every label below it, which is what dragging and
    // Set MW are for; detecting per-band MW from spacing would need a real fit.
    runtime.manualOverrides = {
      ...overrides,
      ladderBands: rows.map((row, index) => ({ pixelY: row, mw: standards[index] })),
      ladderBandsDone: true
    };
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(rows.length === standards.length
      ? `Annotated ${rows.length} ladder bands from the preset. Drag a band to adjust it.`
      : `Only ${rows.length} of ${standards.length} preset bands were detected. Check the labels and drag to adjust.`);
    deps.onRunAnalysis();
  }

  function findLadderBandNearPoint(point, overrides) {
    if (!Number.isFinite(overrides.ladderLane)) {
      return null;
    }
    if (inferLaneIndexFromSegmentationPoint(point) !== overrides.ladderLane) {
      return null;
    }
    const rowY = getRectifiedLaneRowFromPoint(point, overrides.ladderLane);
    return overrides.ladderBands.reduce((best, band) => {
      const distance = Math.abs(band.pixelY - rowY);
      if (distance > LADDER_BAND_GRAB_PX || (best && best.distance <= distance)) {
        return best;
      }
      return { mw: band.mw, distance };
    }, null);
  }

  function moveLadderBand(mw, point) {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const rowY = getRectifiedLaneRowFromPoint(point, overrides.ladderLane);
    runtime.manualOverrides = {
      ...overrides,
      ladderBands: overrides.ladderBands
        .map((band) => (band.mw === mw ? { ...band, pixelY: rowY } : band))
        .sort((a, b) => a.pixelY - b.pixelY)
    };
    return rowY;
  }

  return {
    findLadderBandNearPoint,
    moveLadderBand,
    onDetectLadderBands,
    upsertLadderBandMw
  };
}

export { createManualLadderBands };
