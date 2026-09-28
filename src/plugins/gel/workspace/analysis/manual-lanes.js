import { clamp, getLaneVertexBounds, getLaneVerticesForLane, getTargetBandWindowForLane } from '../shared.js';
import { computeCellIntensity, computeManualBand } from './lane-signal.js';

// Lanes the user drew by hand, and the bands they added or moved on top of what
// the automatic pass found.
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

export { buildLanesFromManualSegmentation, applyBandOverrides };
