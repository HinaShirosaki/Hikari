import { clamp, getLaneRectifiedWidth, getLaneRowSegment, sampleArrayValue } from '../shared.js';
import { buildGaussianKernel } from './image-processing.js';

// Reading the intensity profile of one lane out of the quantification signal:
// row means, the rolling baseline under them, and a band window's measurement.
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

// Band edges by convolution: a derivative-of-Gaussian kernel turns the row
// profile into its slope, and a window edge that still sits on the band's
// rising (top) or falling (bottom) flank moves out until that slope fades into
// the lane's slope noise, or a neighbor's opposite flank. Edges only move out,
// at most one window thickness: a window wider than its band keeps its rows.
function profileSlope(values, sigma) {
  const { kernel, radius } = buildGaussianKernel(sigma);
  let norm = 0;
  for (let offset = -radius; offset <= radius; offset++) norm += offset * offset * kernel[offset + radius];
  // Normalized so a ramp of 1 per sample reads as slope 1.
  const slope = Array.from(values, (_, i) => {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      sum += offset * kernel[offset + radius] * values[clamp(i + offset, 0, values.length - 1)];
    }
    return sum / norm;
  });
  const center = median(slope) ?? 0;
  const threshold = Math.max(1e-7, 3 * 1.4826 * (median(slope.map(value => Math.abs(value - center))) ?? 0));
  return { slope, center, threshold };
}

// The band's own edges: the steepest rise before its peak and the steepest fall
// after it. A side with no flank above the slope noise keeps the range end. A
// 1-px kernel: a wider one moves the steepest points out by about its own width.
function steepestEdges(values, from, to) {
  const { slope, center, threshold } = profileSlope(values, 1);
  let peak = from;
  for (let i = from; i <= to; i++) if (values[i] > values[peak]) peak = i;
  let start = from, end = to;
  for (let i = from; i <= peak; i++) if (slope[i] >= slope[start]) start = i;
  for (let i = peak; i <= to; i++) if (slope[i] < slope[end]) end = i;
  return {
    start: slope[start] - center > threshold ? start : from,
    end: center - slope[end] > threshold ? end : to
  };
}

function findBandEdges(rowMeans, top, bottom) {
  const height = rowMeans.length;
  const thickness = bottom - top + 1;
  const { slope, center, threshold } = profileSlope(rowMeans, Math.max(1, thickness / 6));
  const onFlank = (y, sign) => sign * (slope[y] - center) > threshold;
  let edgeTop = top, edgeBottom = bottom;
  while (edgeTop > 0 && top - edgeTop < thickness && onFlank(edgeTop, 1)) edgeTop--;
  while (edgeBottom < height - 1 && edgeBottom - bottom < thickness && onFlank(edgeBottom, -1)) edgeBottom++;
  const band = steepestEdges(rowMeans, edgeTop, edgeBottom);
  return { top: edgeTop, bottom: edgeBottom, bandTop: band.start, bandBottom: band.end };
}

// Short strips immediately outside the selection avoid measuring a neighboring
// dense band or its distant smear as background. Anchor the line at the strips'
// actual row centers, rather than moving those measurements onto the band edges.
export const BAND_MEASUREMENT_VERSION = 4;

function estimateBandBaselineFromFlanks({ rowMeans, top, bottom, baselines = [] }) {
  const height = rowMeans?.length || 0;
  if (!height) return { values: [], mean: 0, noiseStd: 0, anchors: [], mode: 'local-edge', status: 'unavailable' };
  const safeTop = clamp(Math.floor(top), 0, height - 1);
  const safeBottom = clamp(Math.floor(bottom), safeTop, height - 1);
  const thickness = safeBottom - safeTop + 1;
  const manual = baselines.flatMap(integration => {
    if (!Number.isFinite(integration?.left?.row) || !Number.isFinite(integration?.right?.row)) return [];
    const start = Math.min(integration.left.row, integration.right.row);
    const end = Math.max(integration.left.row, integration.right.row);
    return start >= 0 && end < height && start <= safeTop && end >= safeBottom && end > start
      ? [{ start, end }] : [];
  }).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  const stripRows = clamp(Math.ceil(thickness * 0.15), 1, 3);
  const differences = Array.from(rowMeans.slice(1), (value, index) => value - rowMeans[index]);
  const centerDifference = median(differences) ?? 0;
  const noiseTolerance = Math.max(1e-7, 3 * 1.4826 / Math.SQRT2
    * (median(differences.map(value => Math.abs(value - centerDifference))) ?? 0));
  function localStrip(direction) {
    const start = direction < 0 ? safeTop - 1 : safeBottom + 1;
    if (start < 0 || start >= height) return null;
    const strip = position => {
      const first = direction < 0 ? Math.max(0, position - stripRows + 1) : position;
      const last = direction < 0 ? position : Math.min(height - 1, position + stripRows - 1);
      return { row: (first + last) / 2, value: median(profileRange(rowMeans, first, last)) };
    };
    let anchor = strip(start);
    // Follow a clearly descending band tail to the first stable valley. Do not
    // search for the lowest pixel: doing that would bias blank noisy ROIs up.
    for (let distance = 1; distance <= thickness; distance++) {
      const position = start + direction * distance;
      if (position < 0 || position >= height) break;
      const next = strip(position);
      if (next.value >= anchor.value - noiseTolerance) break;
      anchor = next;
    }
    return anchor;
  }
  const upper = localStrip(-1), lower = localStrip(1);
  const anchors = manual
    ? [{ row: manual.start, value: rowMeans[manual.start] }, { row: manual.end, value: rowMeans[manual.end] }]
    : [
      ...(upper ? [{ row: upper.row, value: upper.value }] : []),
      ...(lower ? [{ row: lower.row, value: lower.value }] : [])
    ];
  const valueAt = row => {
    if (!anchors.length) return 0;
    if (anchors.length === 1) return anchors[0].value;
    const [a, b] = anchors;
    return a.value + (b.value - a.value) * (row - a.row) / (b.row - a.row);
  };
  const values = Array.from({ length: thickness }, (_, index) => valueAt(safeTop + index));
  return {
    values, anchors,
    mean: values.reduce((sum, value) => sum + value, 0) / thickness,
    // Lane-wide row noise: the 1-3 strip rows beside the band are too few to
    // estimate it (a 1-row strip always gave 0, so blank windows read as bands).
    noiseStd: noiseTolerance / 3,
    mode: manual ? 'manual-peak' : 'local-edge',
    status: anchors.length === 2 ? 'ok' : anchors.length ? 'one-sided' : 'unavailable'
  };
}

function computeCellIntensity({
  signal,
  rawGray,
  width,
  height,
  lane,
  bandTop,
  bandBottom,
  baselines = []
}) {
  let top = clamp(Math.floor(Math.min(bandTop, bandBottom)), 0, height - 1);
  let bottom = clamp(Math.floor(Math.max(bandTop, bandBottom)), top, height - 1);

  const rowMeans = computeLaneRowMeans({ signal, width, lane, height });
  let background = estimateBandBaselineFromFlanks({ rowMeans, top, bottom, baselines });
  const found = findBandEdges(rowMeans, top, bottom);
  // A peak-editor baseline holds the user's own edges; otherwise the window
  // grows to the band edges the slope kernel finds.
  if (background.mode !== 'manual-peak') {
    ({ top, bottom } = found);
    background = estimateBandBaselineFromFlanks({ rowMeans, top, bottom, baselines });
  }
  const thickness = Math.max(1, bottom - top + 1);
  const laneWidth = getLaneRectifiedWidth(lane);

  // The same edge search across the lane, over the band's rows, finds its sides.
  // Left and right are fractions of the lane row, for drawing on tilted lanes.
  const columns = new Float32Array(laneWidth);
  for (let y = found.bandTop; y <= found.bandBottom; y += 1) {
    forEachRectifiedLaneSample({ lane, width, height, rowY: y }, ({ x, y: sampleY, sampleIndex }) => {
      columns[sampleIndex] += sampleArrayValue(signal, width, height, x, sampleY);
    });
  }
  const across = steepestEdges(columns, 0, laneWidth - 1);
  const edges = {
    top: found.bandTop,
    bottom: found.bandBottom,
    left: across.start / Math.max(1, laneWidth - 1),
    right: across.end / Math.max(1, laneWidth - 1)
  };

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
  background.values.forEach((value) => {
    baselineSum += value * laneWidth;
  });
  const baselineMean = background.mean;
  const netIntensity = bandSignalSum - baselineSum;
  const tolerance = 1e-7 * Math.max(1, Math.abs(bandSignalSum), Math.abs(baselineSum));
  const correctedIntensity = Math.abs(netIntensity) <= tolerance ? 0 : netIntensity;
  const intensityStatus = background.status === 'unavailable' ? 'unavailable'
    : correctedIntensity < 0 ? 'negative-net' : background.status;

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
    edges,
    rawIntensity: intensityStatus === 'unavailable' ? null : correctedIntensity,
    correctedIntensity: intensityStatus === 'unavailable' ? null : correctedIntensity,
    bandSignalSum,
    baselineSum,
    backgroundMean: baselineMean,
    backgroundStd: noiseStd,
    areaPx: bandPixelCount,
    measurementMode: 'target-window',
    baselineMode: background.mode,
    baselineAnchors: background.anchors,
    intensityStatus,
    netIntensity,
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
  smoothFloat32,
  rollingMinimum,
  computeLaneRowMeans,
  computeLaneBaseline,
  estimateBandBaselineFromFlanks
};
