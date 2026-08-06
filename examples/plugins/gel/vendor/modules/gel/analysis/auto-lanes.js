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
  return medianAbsoluteDeviation(lower, med) || 1e-6;
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

function detectGelEdges(smoothed, threshold) {
  const length = smoothed.length;
  if (length < 4) {
    return { left: 0, right: length - 1 };
  }
  let maxValue = 0;
  for (let i = 0; i < length; i += 1) {
    if (smoothed[i] > maxValue) {
      maxValue = smoothed[i];
    }
  }
  if (maxValue <= 0) {
    return { left: 0, right: length - 1 };
  }
  const thr = threshold ?? maxValue * 0.15;
  let left = 0;
  while (left < length && smoothed[left] < thr) {
    left += 1;
  }
  let right = length - 1;
  while (right > left && smoothed[right] < thr) {
    right -= 1;
  }
  return { left, right };
}

// Auto-detect the band-rich Y window: collapse each row to a horizontal
// abs-dev value within the gel X range, then keep the contiguous Y range where
// the smoothed row-signal exceeds a fraction of its max. Empty rows of gel and
// the gap above the wells naturally fall away.
function autoBandYWindow(gray, width, height, edges, fraction = 0.30) {
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

function findLocalMaxima(values, fromX, toX) {
  const peaks = [];
  for (let x = fromX + 1; x < toX; x += 1) {
    const v = values[x];
    if ((v > values[x - 1] && v >= values[x + 1])
      || (v >= values[x - 1] && v > values[x + 1])) {
      peaks.push(x);
    }
  }
  return peaks;
}

// Prominence = peak height minus the highest of the lowest valleys on either
// side, walking outward until we hit a strictly higher point or the edge.
function computeProminence(values, peakX, fromX, toX) {
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

function findValley(smoothed, fromX, toX) {
  let bestX = Math.round((fromX + toX) / 2);
  let bestValue = Number.POSITIVE_INFINITY;
  for (let x = fromX; x <= toX; x += 1) {
    if (smoothed[x] < bestValue) {
      bestValue = smoothed[x];
      bestX = x;
    }
  }
  return bestX;
}

export function detectLanes({
  gray,
  width,
  height,
  yStart = null,
  yEnd = null,
  gelLeft = null,
  gelRight = null,
  expectedLaneCount = null
} = {}) {
  if (!gray || !(width >= 4) || !(height >= 4)) {
    return null;
  }
  const wantCount = Number.isFinite(expectedLaneCount) && expectedLaneCount >= 2
    ? Math.floor(expectedLaneCount)
    : null;

  // Rough edges from a coarse pass over the lower 3/4 of the image — this skips
  // wells at the top, which can have high abs-dev that distorts edge detection.
  const roughTop = Math.floor(height * 0.25);
  const roughBot = Math.floor(height * 0.98);
  const roughProfile = columnAbsDevProfile(gray, width, height, roughTop, roughBot);
  const hasManualEdges = Number.isFinite(gelLeft)
    && Number.isFinite(gelRight)
    && gelRight > gelLeft + 2;
  const edges = hasManualEdges
    ? {
      left: clamp(Math.floor(gelLeft), 0, width - 1),
      right: clamp(Math.floor(gelRight), 0, width - 1)
    }
    : detectGelEdges(gaussianBlur1d(roughProfile, Math.max(3, width * 0.01)));
  if (edges.right <= edges.left + 2) {
    return null;
  }

  // Band Y window: respect the user's choice, otherwise auto-detect.
  let bandTop;
  let bandBottom;
  if (Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd > yStart + 1) {
    bandTop = clamp(Math.floor(yStart), 0, height - 1);
    bandBottom = clamp(Math.floor(yEnd), bandTop + 1, height - 1);
  } else {
    const auto = autoBandYWindow(gray, width, height, edges);
    bandTop = auto.yStart;
    bandBottom = auto.yEnd;
  }

  const profile = columnAbsDevProfile(gray, width, height, bandTop, bandBottom);
  const gelWidth = edges.right - edges.left;
  // When the caller knows the lane count, set min spacing to about half the
  // expected pitch (gelWidth / count). Factor 2.0 = exactly half-pitch, which
  // accommodates gels where some lanes are narrower than typical (e.g. a thin
  // ladder lane next to a sample lane) while still rejecting double-detection
  // of bands within a single lane.
  const minLaneWidth = wantCount
    ? Math.max(6, Math.round(gelWidth / (wantCount * 2.0)))
    : Math.max(8, Math.round(gelWidth * 0.022));
  // Sigma is tied to band width, not min spacing — otherwise raising the
  // expected count would over-smooth and wipe out adjacent peaks.
  const sigma = clamp(gelWidth * 0.005, 1.5, 6);
  const smoothed = gaussianBlur1d(profile, sigma);

  const windowValues = smoothed.slice(edges.left, edges.right + 1);
  const noise = gutterNoise(windowValues);
  // Prominence floor: stricter without a count (avoid junk peaks), looser with
  // a count (the top-N selection already rejects junk).
  const minProminence = wantCount ? 0.8 * noise : 3.0 * noise;

  const candidates = findLocalMaxima(smoothed, edges.left, edges.right);
  const scored = candidates
    .map((x) => ({
      x,
      prominence: computeProminence(smoothed, x, edges.left, edges.right)
    }))
    .filter((c) => c.prominence >= minProminence);

  let kept;
  if (wantCount) {
    // Greedy: take the most prominent peak that respects min spacing against
    // already-kept peaks. Stops at wantCount or when no more candidates fit.
    const byProminence = scored.slice().sort((a, b) => b.prominence - a.prominence);
    kept = [];
    for (const c of byProminence) {
      if (kept.length >= wantCount) break;
      const tooClose = kept.some((k) => Math.abs(k.x - c.x) < minLaneWidth);
      if (!tooClose) kept.push(c);
    }
    kept.sort((a, b) => a.x - b.x);
  } else {
    scored.sort((a, b) => a.x - b.x);
    kept = [];
    for (const c of scored) {
      if (kept.length && c.x - kept[kept.length - 1].x < minLaneWidth) {
        if (c.prominence > kept[kept.length - 1].prominence) {
          kept[kept.length - 1] = c;
        }
      } else {
        kept.push(c);
      }
    }
  }
  const peaks = kept.map((c) => c.x);

  const dividers = [];
  for (let i = 1; i < peaks.length; i += 1) {
    const valley = findValley(smoothed, peaks[i - 1] + 1, peaks[i] - 1);
    if (valley > edges.left + 1 && valley < edges.right - 1) {
      dividers.push(valley);
    }
  }

  return {
    gelLeft: edges.left,
    gelRight: edges.right,
    bandTop,
    bandBottom,
    dividers,
    peaks
  };
}
