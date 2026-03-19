export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatSequenceLines(sequence, lineLength = 60) {
  const lines = [];
  for (let i = 0; i < sequence.length; i += lineLength) {
    lines.push(sequence.slice(i, i + lineLength));
  }
  return lines.join('<br />');
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatSigFig(value, sigFigs = 4) {
  if (!Number.isFinite(value) || value === 0) {
    return '0';
  }
  const abs = Math.abs(value);
  if (abs >= 1e4 || abs < 1e-3) {
    return value.toExponential(Math.max(sigFigs - 1, 0));
  }
  return Number(value.toPrecision(sigFigs)).toString();
}

export function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
