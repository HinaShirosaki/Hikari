// Small numeric helpers the gel workspace shares: clamping, rounding, sampling a
// pixel out of a flat array, and turning a score into a confidence label.
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sampleArrayValue(data, width, height, x, y) {
  const safeX = clamp(Number(x) || 0, 0, width - 1);
  const safeY = clamp(Number(y) || 0, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = (data[(y0 * width) + x0] * (1 - tx)) + (data[(y0 * width) + x1] * tx);
  const bottom = (data[(y1 * width) + x0] * (1 - tx)) + (data[(y1 * width) + x1] * tx);
  return (top * (1 - ty)) + (bottom * ty);
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function confidenceLabel(score) {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.5) {
    return 'medium';
  }
  return 'low';
}
