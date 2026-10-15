import { clamp } from '../shared.js';

function gaussianBlur1d(values, sigma) {
  if (!(sigma > 0)) {
    return values.slice();
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array((radius * 2) + 1);
  let kSum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const k = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = k;
    kSum += k;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= kSum;
  }
  const out = new Float32Array(values.length);
  const last = values.length - 1;
  for (let i = 0; i < values.length; i += 1) {
    let acc = 0;
    for (let j = -radius; j <= radius; j += 1) {
      acc += values[clamp(i + j, 0, last)] * kernel[j + radius];
    }
    out[i] = acc;
  }
  return out;
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianAbsoluteDeviation(values, med) {
  if (!values.length) {
    return 0;
  }
  return median(Array.from(values, (v) => Math.abs(v - med)));
}

// Noise floor estimated from the lower half of the distribution — i.e. the
// gutter values — so dense lane clusters don't inflate the threshold.
function gutterNoise(values) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const lower = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.5)));
  const med = median(lower);
  return {
    deviation: medianAbsoluteDeviation(lower, med) || 1e-6,
    floor: sorted[Math.floor(sorted.length * 0.1)] || 0
  };
}

// Per-column mean absolute deviation from the column mean over the chosen Y
// range. Polarity-agnostic: works for dark-on-light (Coomassie) and
// light-on-dark (fluorescence) gels alike.
function columnAbsDevProfile(gray, width, height, yStart, yEnd) {
  const profile = new Float32Array(width);
  const top = clamp(Math.floor(yStart), 0, height - 1);
  const bottom = clamp(Math.floor(yEnd), top, height - 1);
  const rows = bottom - top + 1;
  if (rows <= 0) {
    return profile;
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = top; y <= bottom; y += 1) {
      sum += gray[(y * width) + x];
    }
    const mean = sum / rows;
    let dev = 0;
    for (let y = top; y <= bottom; y += 1) {
      dev += Math.abs(gray[(y * width) + x] - mean);
    }
    profile[x] = dev / rows;
  }
  return profile;
}

// Combine overlapping windows without rejecting rows relative to the strongest
// band. Compare window means with a robust full-column background as well: vertical
// variation alone vanishes when a selected window lies inside a flat band.
function buildDetectionProfile(gray, width, height, yStart, yEnd) {
  const background = new Float32Array(width);
  const sampleStride = Math.max(1, Math.ceil(height / 64));
  for (let x = 0; x < width; x += 1) {
    const samples = [];
    for (let y = 0; y < height; y += sampleStride) samples.push(gray[y * width + x]);
    // A mean would turn bands outside a selected empty window into negative
    // contrast inside it, falsely detecting lanes that have no selected signal.
    background[x] = median(samples);
  }
  const profile = new Float32Array(width);
  const selected = Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd > yStart + 1;
  const top = selected ? clamp(Math.floor(yStart), 0, height - 2) : 0;
  const bottom = selected ? clamp(Math.floor(yEnd), top + 1, height - 1) : height - 1;
  const windowSize = Math.min(bottom - top + 1, Math.max(8, Math.ceil(height / 4)));
  const stride = Math.max(1, Math.floor(windowSize / 2));
  for (let start = top; ; start += stride) {
    const end = Math.min(bottom, start + windowSize - 1);
    const values = columnAbsDevProfile(gray, width, height, start, end);
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = start; y <= end; y += 1) sum += gray[y * width + x];
      const contrast = Math.abs(sum / (end - start + 1) - background[x]);
      profile[x] = Math.max(profile[x], values[x], contrast);
    }
    if (end === bottom) break;
  }
  return profile;
}

// Auto-detect the band-rich Y window: collapse each row to a horizontal
// abs-dev value within the gel X range, then keep the contiguous Y range where
// the smoothed row-signal exceeds a fraction of its max. Empty rows of gel and
// the gap above the wells naturally fall away.
function autoBandYWindow(gray, width, height, edges, fraction = 0.02) {
  const xL = edges.left;
  const xR = edges.right;
  const cols = xR - xL + 1;
  if (cols < 4) {
    return { yStart: 0, yEnd: height - 1 };
  }
  const rowSignal = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = xL; x <= xR; x += 1) {
      sum += gray[(y * width) + x];
    }
    const m = sum / cols;
    let dev = 0;
    for (let x = xL; x <= xR; x += 1) {
      dev += Math.abs(gray[(y * width) + x] - m);
    }
    rowSignal[y] = dev / cols;
  }
  const smoothed = gaussianBlur1d(rowSignal, Math.max(2, height * 0.01));
  let mx = 0;
  for (let y = 0; y < height; y += 1) {
    if (smoothed[y] > mx) {
      mx = smoothed[y];
    }
  }
  if (mx <= 0) {
    return { yStart: 0, yEnd: height - 1 };
  }
  const thr = mx * fraction;
  let yStart = 0;
  while (yStart < height && smoothed[yStart] < thr) {
    yStart += 1;
  }
  let yEnd = height - 1;
  while (yEnd > yStart && smoothed[yEnd] < thr) {
    yEnd -= 1;
  }
  return { yStart, yEnd };
}

export function findLocalMaxima(values, fromX, toX) {
  const peaks = [];
  for (let x = fromX + 1; x < toX; x += 1) {
    if (values[x] <= values[x - 1]) continue;
    const start = x;
    while (x < toX && values[x + 1] === values[start]) x += 1;
    if (x < toX && values[x] > values[x + 1]) peaks.push(Math.round((start + x) / 2));
  }
  return peaks;
}

// Prominence = peak height minus the highest of the lowest valleys on either
// side, walking outward until we hit a strictly higher point or the edge.
export function computeProminence(values, peakX, fromX, toX) {
  const v = values[peakX];
  let leftMin = v;
  for (let x = peakX - 1; x >= fromX; x -= 1) {
    if (values[x] > v) {
      break;
    }
    if (values[x] < leftMin) {
      leftMin = values[x];
    }
  }
  let rightMin = v;
  for (let x = peakX + 1; x <= toX; x += 1) {
    if (values[x] > v) {
      break;
    }
    if (values[x] < rightMin) {
      rightMin = values[x];
    }
  }
  return v - Math.max(leftMin, rightMin);
}

function peakGaps(peaks) {
  const gaps = [];
  for (let i = 1; i < peaks.length; i += 1) {
    gaps.push(peaks[i] - peaks[i - 1]);
  }
  return gaps;
}

// The argmin of a flat gutter is wherever the noise happened to dip, which moved
// dividers by ~12% of the lane pitch. Take everything within 10% of the interval
// floor and pick the candidate nearest the midpoint.
function findValley(smoothed, fromX, toX) {
  const mid = Math.round((fromX + toX) / 2);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let x = fromX; x <= toX; x += 1) {
    if (smoothed[x] < lo) {
      lo = smoothed[x];
    }
    if (smoothed[x] > hi) {
      hi = smoothed[x];
    }
  }
  if (!Number.isFinite(lo)) {
    return mid;
  }
  const floorBand = lo + (0.1 * (hi - lo));
  let bestX = mid;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let x = fromX; x <= toX; x += 1) {
    const distance = Math.abs(x - mid);
    if (smoothed[x] <= floorBand && distance < bestDistance) {
      bestDistance = distance;
      bestX = x;
    }
  }
  return bestX;
}

// Weighted interval selection considers the whole set, rather than allowing one
// strong peak to greedily exclude two plausible neighboring lanes.
function selectPeaks(scored, minSpacing, count, prominenceFloor) {
  const limit = Math.min(count || scored.length, scored.length);
  const previous = scored.map((peak, i) => {
    let j = i - 1;
    while (j >= 0 && peak.x - scored[j].x < minSpacing) j -= 1;
    return j + 1;
  });
  const scores = Array.from({ length: scored.length + 1 }, () => {
    const row = new Float64Array(limit + 1).fill(Number.NEGATIVE_INFINITY);
    row[0] = 0;
    return row;
  });
  const take = Array.from({ length: scored.length + 1 }, () => new Uint8Array(limit + 1));
  for (let i = 1; i <= scored.length; i += 1) {
    for (let k = 1; k <= limit; k += 1) {
      const withPeak = scores[previous[i - 1]][k - 1]
        + Math.log1p(scored[i - 1].prominence / prominenceFloor);
      const withoutPeak = scores[i - 1][k];
      take[i][k] = Number(withPeak > withoutPeak);
      scores[i][k] = Math.max(withPeak, withoutPeak);
    }
  }
  const kept = [];
  let selectedCount = 0;
  for (let k = 1; k <= limit; k += 1) {
    if (Number.isFinite(scores[scored.length][k])
      && (count || scores[scored.length][k] > scores[scored.length][selectedCount])) selectedCount = k;
  }
  for (let i = scored.length, k = selectedCount; i > 0 && k > 0;) {
    if (take[i][k]) {
      kept.push(scored[i - 1]);
      i = previous[i - 1];
      k -= 1;
    } else i -= 1;
  }
  return kept.reverse();
}

function inferBlankPeaks(peaks, count, edges, hasManualEdges) {
  if (!count || peaks.length < 3 || peaks.length >= count) return [];
  // Explicit outer boundaries resolve the otherwise ambiguous position of an
  // empty first/last lane. Require observed centers to agree with this grid.
  if (hasManualEdges) {
    const pitch = (edges.right - edges.left) / count;
    const occupied = new Set();
    const fits = peaks.every((x) => {
      const slot = Math.round((x - edges.left) / pitch - 0.5);
      if (slot < 0 || slot >= count || occupied.has(slot)
        || Math.abs(x - (edges.left + (slot + 0.5) * pitch)) > pitch * 0.18) return false;
      occupied.add(slot);
      return true;
    });
    if (fits && peaks.length >= count / 2) {
      return Array.from({ length: count }, (_, i) => i)
        .filter((i) => !occupied.has(i))
        .map((i) => Math.round(edges.left + (i + 0.5) * pitch));
    }
  }
  const gaps = peakGaps(peaks);
  const pitch = median(gaps.slice().sort((a, b) => a - b).slice(0, Math.ceil(gaps.length / 2)));
  // Do not invent a pitch from a single short gap (e.g. a narrow ladder).
  if (gaps.filter((gap) => Math.abs(gap - pitch) <= pitch * 0.15).length < 2) return [];
  const inferred = [];
  for (let i = 1; i < peaks.length; i += 1) {
    const gap = peaks[i] - peaks[i - 1];
    const steps = Math.round(gap / pitch);
    if (steps < 1 || Math.abs(gap / steps - pitch) > pitch * 0.15) return [];
    for (let k = 1; k < steps; k += 1) inferred.push(Math.round(peaks[i - 1] + gap * k / steps));
  }
  return peaks.length + inferred.length <= count ? inferred : [];
}

function detectWithProfile({
  gray, width, height, yStart = null, yEnd = null,
  gelLeft = null, gelRight = null, expectedLaneCount = null
}, profile) {
  const wantCount = Number.isFinite(expectedLaneCount) && expectedLaneCount >= 2
    ? Math.min(40, Math.floor(expectedLaneCount)) : null;
  const hasManualEdges = Number.isFinite(gelLeft) && Number.isFinite(gelRight) && gelRight > gelLeft + 2;
  const edges = hasManualEdges
    ? { left: clamp(Math.floor(gelLeft), 0, width - 1), right: clamp(Math.floor(gelRight), 0, width - 1) }
    : { left: 0, right: width - 1 };
  if (edges.right <= edges.left + 2) return null;
  let bandTop;
  let bandBottom;
  if (Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd > yStart + 1) {
    bandTop = clamp(Math.floor(yStart), 0, height - 2);
    bandBottom = clamp(Math.floor(yEnd), bandTop + 1, height - 1);
  } else {
    const auto = autoBandYWindow(gray, width, height, edges);
    bandTop = auto.yStart;
    bandBottom = auto.yEnd;
  }
  // Empty image margins must not set the spacing/smoothing scale. Estimate
  // the occupied span, while keeping the actual search range and user edges.
  const profileWindow = profile.slice(edges.left, edges.right + 1);
  const activityFloor = Math.max(...profileWindow) * 0.02;
  let activeLeft = edges.left;
  let activeRight = edges.right;
  while (activeLeft < activeRight && profile[activeLeft] < activityFloor) activeLeft += 1;
  while (activeRight > activeLeft && profile[activeRight] < activityFloor) activeRight -= 1;
  const gelWidth = hasManualEdges ? edges.right - edges.left : Math.max(4, activeRight - activeLeft);
  const minLaneWidth = wantCount
    ? Math.max(6, Math.round(gelWidth / (wantCount * 2)))
    : Math.max(8, Math.round(gelWidth * 0.022));
  const smoothed = gaussianBlur1d(profile, clamp(gelWidth * 0.005, 1.5, 6));
  const windowValues = smoothed.slice(edges.left, edges.right + 1);
  const noise = gutterNoise(windowValues);
  const windowMax = Math.max(...windowValues);
  // A noise-only image still has local maxima. Require contrast above the
  // measured background level as well as its spread; otherwise texture alone
  // generates an apparently valid lane layout at every noise amplitude.
  const minProminence = Math.max(3 * noise.deviation, 0.25 * noise.floor, 0.02 * windowMax, 1e-6);
  const scored = findLocalMaxima(smoothed, edges.left, edges.right)
    .map((x) => ({ x, prominence: computeProminence(smoothed, x, edges.left, edges.right) }))
    .filter((peak) => peak.prominence >= minProminence);
  // A shallow ripple across one broad band is not another lane. Demand a
  // valley at least 20% below the weaker peak before retaining both centers.
  const distinct = [];
  for (const peak of scored) {
    let keep = true;
    while (distinct.length) {
      const prior = distinct[distinct.length - 1];
      const valley = findValley(smoothed, prior.x, peak.x);
      if (Math.min(smoothed[prior.x], smoothed[peak.x]) - smoothed[valley]
        >= 0.2 * Math.min(prior.prominence, peak.prominence)) break;
      if (prior.prominence >= peak.prominence) { keep = false; break; }
      distinct.pop();
    }
    if (keep) distinct.push(peak);
  }
  const observed = selectPeaks(distinct, minLaneWidth, wantCount, minProminence);
  const observedPeaks = observed.map((peak) => peak.x);
  const inferredPeaks = inferBlankPeaks(observedPeaks, wantCount, edges, hasManualEdges);
  const peaks = [...observedPeaks, ...inferredPeaks].sort((a, b) => a - b);
  const dividers = [];
  for (let i = 1; i < peaks.length; i += 1) {
    const valley = findValley(smoothed, peaks[i - 1] + 1, peaks[i] - 1);
    if (valley > edges.left + 1 && valley < edges.right - 1) dividers.push(valley);
  }
  let outerLeft = edges.left;
  let outerRight = edges.right;
  if (!hasManualEdges && observed.length >= 2) {
    const support = observed.map((peak) => {
      const floor = smoothed[peak.x] - peak.prominence * 0.9;
      let left = peak.x;
      let right = peak.x;
      while (left > edges.left && smoothed[left - 1] > floor) left -= 1;
      while (right < edges.right && smoothed[right + 1] > floor) right += 1;
      return { left, right };
    });
    const first = support[0];
    const last = support[support.length - 1];
    // Extrapolate only the nearest gutter; a distant wide/blank lane must not
    // determine how much of the outermost band is included.
    const nextHalfWidth = peaks[1] === observedPeaks[1]
      ? observedPeaks[1] - support[1].left : observedPeaks[0] - first.left;
    const priorHalfWidth = peaks.at(-2) === observedPeaks.at(-2)
      ? support.at(-2).right - observedPeaks.at(-2) : last.right - observedPeaks.at(-1);
    const firstGap = Math.max(0, peaks[1] - first.right - nextHalfWidth);
    const lastGap = Math.max(0, last.left - peaks.at(-2) - priorHalfWidth);
    outerLeft = clamp(Math.round(first.left - firstGap / 2), 0, width - 1);
    outerRight = clamp(Math.round(last.right + lastGap / 2), 0, width - 1);
  }
  return {
    gelLeft: outerLeft, gelRight: outerRight, bandTop, bandBottom, dividers, peaks,
    observedPeaks, inferredPeaks, expectedLaneCount: wantCount,
    countMismatch: Boolean(wantCount && peaks.length !== wantCount)
  };
}

function validImage({ gray, width, height } = {}) {
  return gray && Number.isInteger(width) && width >= 4 && Number.isInteger(height)
    && height >= 4 && gray.length === width * height;
}

export function detectLanes(options = {}) {
  if (!validImage(options)) return null;
  return detectWithProfile(options, buildDetectionProfile(options.gray, options.width,
    options.height, options.yStart, options.yEnd));
}

// The controller owns a one-image cache. Count/boundary edits reuse pixel work;
// a load, crop, rotation, or height-window edit invalidates it. No global image
// retention, and callers using the pure detectLanes API never receive stale data.
export function createLaneDetector() {
  let cached = null;
  return (options = {}) => {
    if (!validImage(options)) return null;
    if (!Number.isFinite(options.imageRevision)) return detectLanes(options);
    const keys = ['gray', 'width', 'height', 'imageRevision', 'yStart', 'yEnd'];
    if (!cached || keys.some((key) => cached.options[key] !== options[key])) {
      cached = { options: { ...options }, profile: buildDetectionProfile(options.gray,
        options.width, options.height, options.yStart, options.yEnd) };
    }
    return detectWithProfile(options, cached.profile);
  };
}
