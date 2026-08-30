import { cleanText } from '../shared.js';

function fallbackCreateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createStableId(createId, prefix = 'id') {
  const created = typeof createId === 'function' ? createId() : '';
  return cleanText(created, 120) || fallbackCreateId(prefix);
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return number.toFixed(digits);
}

function formatBp(length) {
  return `${Math.max(0, Number(length) || 0).toLocaleString()} bp`;
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function formatStrategyName(strategy) {
  const normalized = String(strategy || '').trim().toLowerCase();
  if (normalized === 'restriction-ligation') {
    return 'Restriction ligation';
  }
  if (normalized === 'gibson') {
    return 'Gibson assembly';
  }
  if (normalized === 'overlap-pcr') {
    return 'Overlap PCR';
  }
  if (normalized === 'site-directed-mutagenesis') {
    return 'Site-directed mutagenesis';
  }
  return normalized ? formatPrimerRole(normalized) : 'No feasible route';
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
}

function roundToFiveSeconds(seconds) {
  return Math.max(5, Math.ceil((Number(seconds) || 0) / 5) * 5);
}

function clampTemperature(value, min = 50, max = 72) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

export {
  clampTemperature,
  createStableId,
  formatBp,
  formatDuration,
  formatNumber,
  formatPrimerRole,
  formatStrategyName,
  roundToFiveSeconds
};
