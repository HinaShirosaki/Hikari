// --- Student's t p-values -------------------------------------------------------
// A p-value needs the regularized incomplete beta function, which the platform does
// not have. Lanczos log-gamma + the Lentz continued fraction (Numerical Recipes
// betai) is the whole of it; a stats dependency for one function is not worth it.

const LANCZOS_G = Object.freeze([
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]);

function logGamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = LANCZOS_G[0];
  for (let index = 1; index < LANCZOS_G.length; index += 1) {
    sum += LANCZOS_G[index] / (z + index);
  }
  const t = z + 7.5;
  return (0.5 * Math.log(2 * Math.PI)) + ((z + 0.5) * Math.log(t)) - t + Math.log(sum);
}

function betaContinuedFraction(a, b, x) {
  const TINY = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - ((qab * x) / qap);
  if (Math.abs(d) < TINY) {
    d = TINY;
  }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + (numerator * d);
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + (numerator / c);
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    h *= d * c;
    numerator = -(((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2)));
    d = 1 + (numerator * d);
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + (numerator / c);
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-11) {
      break;
    }
  }
  return h;
}

function incompleteBeta(a, b, x) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) {
    return NaN;
  }
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const logFront = logGamma(a + b) - logGamma(a) - logGamma(b)
    + (a * Math.log(x)) + (b * Math.log(1 - x));
  const front = Math.exp(logFront);
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - ((front * betaContinuedFraction(b, a, 1 - x)) / b);
}

// Welch's unequal-variance t-test. Replicate counts differ between plate groups far
// more often than their variances match, so Welch is the default rather than Student.
export function welchTTest(a, b) {
  if (!a || !b || a.n < 2 || b.n < 2) {
    return null;
  }
  const varA = (a.sd ** 2) / a.n;
  const varB = (b.sd ** 2) / b.n;
  const se = Math.sqrt(varA + varB);
  if (!Number.isFinite(se) || se <= 0) {
    return null;
  }
  const t = (a.mean - b.mean) / se;
  const df = ((varA + varB) ** 2)
    / (((varA ** 2) / (a.n - 1)) + ((varB ** 2) / (b.n - 1)));
  if (!Number.isFinite(df) || df <= 0) {
    return null;
  }
  const p = incompleteBeta(df / 2, 0.5, df / (df + (t * t)));
  return {
    t,
    df,
    se,
    difference: a.mean - b.mean,
    p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null
  };
}

// Benjamini-Hochberg. Every group on a plate is compared against the same control, so
// the raw p-values are a family; reporting them unadjusted overstates every hit.
export function adjustFdr(pValues) {
  const indexed = pValues
    .map((p, index) => ({ p, index }))
    .filter((item) => Number.isFinite(item.p))
    .sort((a, b) => a.p - b.p);
  const adjusted = pValues.map(() => null);
  let previous = 1;
  for (let rank = indexed.length - 1; rank >= 0; rank -= 1) {
    const { p, index } = indexed[rank];
    previous = Math.min(previous, (p * indexed.length) / (rank + 1));
    adjusted[index] = Math.min(1, previous);
  }
  return adjusted;
}

export function significanceStars(p) {
  if (!Number.isFinite(p)) {
    return '-';
  }
  if (p < 0.001) {
    return '***';
  }
  if (p < 0.01) {
    return '**';
  }
  if (p < 0.05) {
    return '*';
  }
  return 'ns';
}

export function summarizeRobust(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const median = (list) => {
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  };
  const center = median(sorted);
  const deviations = sorted.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
  // 1.4826 rescales the MAD to a normal-consistent SD, which is what makes a robust
  // Z-score comparable to the ordinary one.
  return { median: center, mad: median(deviations) * 1.4826 };
}
