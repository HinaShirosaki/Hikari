// AB1 chromatogram post-processing.
//
// Raw .ab1 channel data straight off the capillary sequencer contains
// (1) a per-dye DC offset and slow baseline drift, (2) spectral cross-talk
// between dye channels, (3) per-dye intensity differences, and (4) shot-noise
// jitter on top of the analytic peaks. PLOC2 base positions are also nominal:
// they are accurate to a few samples but rarely sit exactly on the true peak
// maximum after the upstream corrections shift the trace. Standard ABI
// (KB Basecaller) / Phred / TraceTuner pipelines clean the raw data with a
// fixed sequence of operations before display or re-basecalling. This module
// reproduces a close-to-textbook version of that pipeline so that the cleaned
// trace can be rendered without further heuristics in the SVG layer.
//
// Pipeline (applied per channel unless noted):
//   1. Rolling-minimum baseline subtraction.       removes DC offset + drift
//   2. Cross-talk dampening across the 4 dyes.      proxy for the 4x4 dye matrix
//   3. Per-channel robust normalization.            equalize 95th-percentile peaks
//   4. Savitzky-Golay quadratic smoothing (w=7).    denoise without flattening peaks
//   5. Peak position refinement around PLOC2.       snap base calls onto true maxima
//   6. Mott's modified quality trimming.            Phred-standard end trim
//
// Public surface is intentionally small: postProcessAb1Trace(trace, quality)
// returns the cleaned trace alongside diagnostics so callers can decide whether
// to render the raw or processed values.

const CANONICAL_BASES = ['A', 'C', 'G', 'T'];

const DEFAULT_OPTIONS = Object.freeze({
  baselineWindow: 201,        // samples; ~> 2 base spacings, robust to peak width
  crossTalkLeakFraction: 0.05, // 5% leak proxy for the absent ABI dye matrix
  normalizationPercentile: 0.95,
  normalizationTarget: 1000,  // post-norm target for the robust peak height
  savitzkyGolayWindow: 7,     // must be odd; w=7 quadratic = [-2,3,6,7,6,3,-2]/21
  peakRefinementRadius: 4,    // samples either side of PLOC2 to search
  qualityTrimQualityThreshold: 20, // Phred Q ≥ 20 (p ≤ 0.01) counts as "good"
  qualityTrimMinLength: 20    // refuse to return a window shorter than this
});

// ---------------------------------------------------------------------------
// Numeric utilities

function toFloatArray(values) {
  if (values instanceof Float64Array) {
    return values;
  }
  if (Array.isArray(values) || ArrayBuffer.isView(values)) {
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i += 1) {
      const v = Number(values[i]);
      out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
  }
  return new Float64Array(0);
}

function cloneFloat(values) {
  const out = new Float64Array(values.length);
  out.set(values);
  return out;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function percentile(values, fraction) {
  const len = values.length;
  if (!len) {
    return 0;
  }
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = clamp(Math.floor(clamp(fraction, 0, 1) * (len - 1)), 0, len - 1);
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Step 1: rolling-minimum baseline subtraction.
//
// True signal sits above a slowly varying floor (instrument bias + lamp drift +
// dye background). A windowed minimum over a window MUCH wider than a peak
// captures that floor without being pulled up by peaks. We then smooth the
// floor estimate before subtraction so it does not introduce its own steps.

function rollingMinimum(values, windowSize) {
  const n = values.length;
  const w = Math.max(1, Math.floor(windowSize) | 1); // odd
  const half = (w - 1) >> 1;
  const out = new Float64Array(n);
  // Monotonic deque keeps indices of candidate minima; amortized O(n).
  const dq = [];
  for (let i = 0; i < n + half; i += 1) {
    const inIdx = i;
    if (inIdx < n) {
      while (dq.length && values[dq[dq.length - 1]] >= values[inIdx]) {
        dq.pop();
      }
      dq.push(inIdx);
    }
    const windowStart = i - w + 1;
    while (dq.length && dq[0] < windowStart) {
      dq.shift();
    }
    const writeIdx = i - half;
    if (writeIdx >= 0 && writeIdx < n) {
      out[writeIdx] = dq.length ? values[dq[0]] : values[writeIdx];
    }
  }
  return out;
}

function movingAverage(values, windowSize) {
  const n = values.length;
  const w = Math.max(1, Math.floor(windowSize) | 1);
  const half = (w - 1) >> 1;
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < Math.min(w, n); i += 1) {
    sum += values[i];
  }
  for (let i = 0; i < n; i += 1) {
    const left = i - half - 1;
    const right = i + half;
    if (left >= 0) {
      sum -= values[left];
    }
    if (right < n) {
      sum += values[right];
    }
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    out[i] = sum / Math.max(1, hi - lo + 1);
  }
  return out;
}

function subtractBaseline(values, windowSize) {
  if (!values.length) {
    return values;
  }
  const floor = movingAverage(rollingMinimum(values, windowSize), Math.max(15, Math.floor(windowSize / 5) | 1));
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.max(0, values[i] - floor[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 2: cross-talk dampening.
//
// Each dye fluoresces broadly enough to leak into the other three detection
// channels. ABI stores the per-instrument 4x4 dye matrix in the ABIF file
// (tags MTRX/Matr, OvrV, etc.), but it is not consistently present and not
// every basecaller exposes it. As a robust proxy we subtract a small fraction
// of each sample's overall channel sum from every channel — this preserves the
// dominant peak (which still towers above its own contribution) while pulling
// down the smaller co-located bleed-through on the other channels.

function reduceCrossTalk(channelsByBase, leakFraction) {
  const bases = Array.from(channelsByBase.keys());
  if (!bases.length || leakFraction <= 0) {
    return channelsByBase;
  }
  const length = channelsByBase.get(bases[0]).length;
  const out = new Map();
  bases.forEach((base) => {
    out.set(base, new Float64Array(length));
  });
  for (let i = 0; i < length; i += 1) {
    let total = 0;
    for (const base of bases) {
      total += channelsByBase.get(base)[i];
    }
    const leak = leakFraction * total;
    for (const base of bases) {
      const value = channelsByBase.get(base)[i] - leak + leakFraction * channelsByBase.get(base)[i];
      // The (1 - leak)*self + leak_from_others form. We keep ourselves whole and
      // subtract the residual leak the other dyes contributed at this sample.
      out.get(base)[i] = Math.max(0, value);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: per-channel robust normalization.
//
// The four dyes do not emit at equal intensity; without normalization the
// brightest channel dominates the rendered chromatogram. Scaling each channel
// by its 95th percentile (rather than its max — which is dominated by single-
// sample noise spikes) brings them onto a common visual scale while preserving
// relative peak heights within a channel.

function normalizeChannel(values, fraction, target) {
  if (!values.length) {
    return values;
  }
  const scale = percentile(values, fraction);
  if (!(scale > 0)) {
    return cloneFloat(values);
  }
  const factor = target / scale;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] * factor;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 4: Savitzky-Golay smoothing.
//
// A 7-point quadratic Savitzky-Golay filter has the closed-form coefficients
// [-2, 3, 6, 7, 6, 3, -2] / 21. Unlike a moving average it fits a local
// polynomial, so it denoises without rounding off peak tips or widening peaks.
// Boundary samples are handled by mirroring (reflect padding), which preserves
// the leading/trailing peaks better than zero-padding.

const SG_COEFFS_BY_WINDOW = {
  5:  { factor: 35,  coeffs: [-3, 12, 17, 12, -3] },
  7:  { factor: 21,  coeffs: [-2, 3, 6, 7, 6, 3, -2] },
  9:  { factor: 231, coeffs: [-21, 14, 39, 54, 59, 54, 39, 14, -21] },
  11: { factor: 429, coeffs: [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36] }
};

function savitzkyGolaySmooth(values, windowSize) {
  const config = SG_COEFFS_BY_WINDOW[windowSize] || SG_COEFFS_BY_WINDOW[7];
  const { coeffs, factor } = config;
  const half = (coeffs.length - 1) >> 1;
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let acc = 0;
    for (let k = -half; k <= half; k += 1) {
      let idx = i + k;
      if (idx < 0) {
        idx = -idx;
      } else if (idx >= n) {
        idx = (2 * (n - 1)) - idx;
      }
      acc += coeffs[k + half] * values[idx];
    }
    out[i] = Math.max(0, acc / factor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: peak position refinement.
//
// PLOC2 positions are emitted by the basecaller before the baseline + cross-
// talk corrections we just applied; the true sample maximum can drift a few
// samples either side. For each base, search a small window around its PLOC2
// position and snap to the local maximum of the channel that matches the
// called base. Fall back to the original position if that base has no signal.

function refinePositions(positions, channelsByBase, sequence, radius) {
  const n = positions.length;
  const refined = new Int32Array(n);
  const totalSamples = channelsByBase.get(CANONICAL_BASES[0])?.length || 0;
  if (!totalSamples) {
    for (let i = 0; i < n; i += 1) {
      refined[i] = positions[i];
    }
    return refined;
  }
  for (let i = 0; i < n; i += 1) {
    const base = sequence[i] || '';
    const channel = channelsByBase.get(base);
    const origin = clamp(positions[i] | 0, 0, totalSamples - 1);
    if (!channel) {
      refined[i] = origin;
      continue;
    }
    const lo = Math.max(0, origin - radius);
    const hi = Math.min(totalSamples - 1, origin + radius);
    let bestIdx = origin;
    let bestVal = channel[origin];
    for (let j = lo; j <= hi; j += 1) {
      if (channel[j] > bestVal) {
        bestVal = channel[j];
        bestIdx = j;
      }
    }
    refined[i] = bestIdx;
  }
  return refined;
}

// ---------------------------------------------------------------------------
// Step 6: Mott's modified quality trimming algorithm.
//
// Phred's standard end-trim. Convert Phred quality Q to error probability
// p = 10^(-Q/10). With threshold q_t (default Q20 → p_t = 0.01), score each
// base s_i = p_t - p_i. Find the contiguous subsequence whose cumulative score
// sum is maximal — this is exactly Kadane's algorithm. The result is the
// longest reliable window of the read; trimmed regions are typically the high-
// error ends near the primer and the run-out.
//
// Quality input is the Phred+33 ASCII string the parser already produces.

export function trimByMottAlgorithm(qualityString, options = {}) {
  const q = String(qualityString || '');
  const threshold = Math.max(0, Number(options.qualityThreshold ?? DEFAULT_OPTIONS.qualityTrimQualityThreshold));
  const minLength = Math.max(1, Number(options.minLength ?? DEFAULT_OPTIONS.qualityTrimMinLength));
  if (!q.length) {
    return { start: 0, end: 0, length: 0, applied: false };
  }

  const pt = Math.pow(10, -threshold / 10);
  let bestStart = 0;
  let bestEnd = 0;
  let bestSum = -Infinity;
  let curStart = 0;
  let curSum = 0;
  for (let i = 0; i < q.length; i += 1) {
    const qi = q.charCodeAt(i) - 33;
    const pi = Math.pow(10, -Math.max(0, qi) / 10);
    const score = pt - pi;
    if (curSum <= 0) {
      curStart = i;
      curSum = score;
    } else {
      curSum += score;
    }
    if (curSum > bestSum) {
      bestSum = curSum;
      bestStart = curStart;
      bestEnd = i + 1;
    }
  }

  const length = bestEnd - bestStart;
  if (length < minLength) {
    return { start: 0, end: q.length, length: q.length, applied: false };
  }
  return { start: bestStart, end: bestEnd, length, applied: true };
}

// ---------------------------------------------------------------------------
// Pipeline driver.

function buildChannelMap(channels) {
  const map = new Map();
  const list = Array.isArray(channels) ? channels : [];
  list.forEach((channel) => {
    const base = String(channel?.base || '').toUpperCase();
    if (!CANONICAL_BASES.includes(base)) {
      return;
    }
    map.set(base, toFloatArray(channel.values));
  });
  return map;
}

function equalizeChannelLengths(channelsByBase) {
  let maxLength = 0;
  for (const values of channelsByBase.values()) {
    if (values.length > maxLength) {
      maxLength = values.length;
    }
  }
  for (const [base, values] of channelsByBase) {
    if (values.length === maxLength) {
      continue;
    }
    const padded = new Float64Array(maxLength);
    padded.set(values);
    channelsByBase.set(base, padded);
  }
  return maxLength;
}

function toRoundedArray(values) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.max(0, Math.round(values[i]));
  }
  return out;
}

export function postProcessAb1Trace(trace, quality = '', options = {}) {
  const safeTrace = trace && typeof trace === 'object' ? trace : null;
  if (!safeTrace) {
    return null;
  }
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const channelsByBase = buildChannelMap(safeTrace.channels);
  if (!channelsByBase.size) {
    return null;
  }

  const sampleCount = equalizeChannelLengths(channelsByBase);
  if (!sampleCount) {
    return null;
  }

  // 1. baseline
  for (const [base, values] of channelsByBase) {
    channelsByBase.set(base, subtractBaseline(values, opts.baselineWindow));
  }

  // 2. cross-talk
  const dampened = reduceCrossTalk(channelsByBase, opts.crossTalkLeakFraction);

  // 3. normalize per channel
  const normalized = new Map();
  for (const [base, values] of dampened) {
    normalized.set(base, normalizeChannel(values, opts.normalizationPercentile, opts.normalizationTarget));
  }

  // 4. smooth
  const smoothed = new Map();
  for (const [base, values] of normalized) {
    smoothed.set(base, savitzkyGolaySmooth(values, opts.savitzkyGolayWindow));
  }

  // 5. refine peak positions against the smoothed signal
  const sequence = String(safeTrace.sequence || '');
  const rawPositions = Array.isArray(safeTrace.positions)
    ? safeTrace.positions.map((value) => Math.max(0, Math.floor(Number(value) || 0)))
    : [];
  const refinedPositions = refinePositions(rawPositions, smoothed, sequence, opts.peakRefinementRadius);

  // 6. quality trim
  const trim = trimByMottAlgorithm(quality, {
    qualityThreshold: opts.qualityTrimQualityThreshold,
    minLength: opts.qualityTrimMinLength
  });

  return {
    sampleCount,
    channels: CANONICAL_BASES
      .filter((base) => smoothed.has(base))
      .map((base) => ({ base, values: toRoundedArray(smoothed.get(base)) })),
    positions: Array.from(refinedPositions),
    trim,
    pipeline: {
      baselineWindow: opts.baselineWindow,
      crossTalkLeakFraction: opts.crossTalkLeakFraction,
      normalizationPercentile: opts.normalizationPercentile,
      normalizationTarget: opts.normalizationTarget,
      savitzkyGolayWindow: opts.savitzkyGolayWindow,
      peakRefinementRadius: opts.peakRefinementRadius,
      qualityTrimQualityThreshold: opts.qualityTrimQualityThreshold
    }
  };
}

export const __internal__ = {
  rollingMinimum,
  movingAverage,
  subtractBaseline,
  reduceCrossTalk,
  normalizeChannel,
  savitzkyGolaySmooth,
  refinePositions,
  trimByMottAlgorithm,
  percentile
};
