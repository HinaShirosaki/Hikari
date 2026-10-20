import { buildLanesFromManualSegmentation, detectLadderBandRows } from '../analysis/analysis-core.js';
import { buildQuantificationSignal } from '../analysis/image-processing.js';
import { getLadderPresetBands } from '../constants.js';
import { clamp, laneContainsPoint, normalizeManualOverrides } from '../shared.js';
import { LADDER_BAND_GRAB_PX } from './lane-constants.js';

// The ladder lane's bands: detecting them from the signal, and grabbing or moving
// one that is already marked.

function createManualLadderBands({
  runtime,
  elements,
  deps,
  getRectifiedLaneRowFromPoint,
  renderOverrideStatus
} = {}) {
  function upsertLadderBandMw(pixelY, mw) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const points = normalized.ladderBands
      // A molecular weight identifies one ladder band. Re-clicking with the
      // same MW moves that calibration point instead of creating a duplicate.
      .filter((item) => item.mw !== mw && Math.abs(item.pixelY - pixelY) > 8);
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
      ? 'Click the top edge of the target band.'
      : `Only ${rows.length} of ${standards.length} preset bands were detected. Check the labels and drag to adjust.`);
    deps.onRunAnalysis();
  }

  function isPointInLadderLane(point, overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const lane = getLadderLaneShape(overrides);
    return Boolean(lane && laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width));
  }

  function findLadderBandNearPoint(point, overrides) {
    if (!isPointInLadderLane(point, overrides)) {
      return null;
    }
    const rowY = getRectifiedLaneRowFromPoint(point, overrides.ladderLane);
    return overrides.ladderBands.reduce((best, band) => {
      const distance = Math.abs(band.pixelY - rowY);
      if (distance > LADDER_BAND_GRAB_PX || (best && best.distance <= distance)) {
        return best;
      }
      return { mw: band.mw, pixelY: band.pixelY, distance };
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
    isPointInLadderLane,
    moveLadderBand,
    onDetectLadderBands,
    upsertLadderBandMw
  };
}

export { createManualLadderBands };
