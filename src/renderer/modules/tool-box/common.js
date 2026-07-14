import { escapeHtml } from '../../lib/html.js';
import { clampNumber } from '../../lib/numbers.js';

export { clampNumber, escapeHtml };

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
