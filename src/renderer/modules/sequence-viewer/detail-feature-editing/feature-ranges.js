import { normalizeFeatureType } from '../feature-types.js';
import { clamp } from '../shared.js';
import { isOrfFeature } from '../orf-analysis.js';

function sanitizeFeatureType(type) {
  return normalizeFeatureType(type, 'misc_feature');
}

function buildManualFeatureId(type) {
  const prefix = sanitizeFeatureType(type).slice(0, 24) || 'feature';
  const stamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8) || 'feature';
  return `manual_${prefix}_${stamp}_${randomPart}`;
}

function formatBaseRangeLabel(range) {
  const start = Math.max(0, Number(range?.start) || 0);
  const end = Math.max(start, Number(range?.end) || start);
  const length = Math.max(0, end - start);
  if (!length) {
    return '-';
  }
  return `${(start + 1).toLocaleString()}..${end.toLocaleString()} (${length.toLocaleString()} bp)`;
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }
  return number.toFixed(digits);
}

function formatPrimerRole(role) {
  return String(role || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase()) || 'Primer';
}

function getFeatureOverallRange(feature, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  const segments = (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, safeLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, safeLength)
    }))
    .filter((segment) => segment.end > segment.start);
  if (!segments.length) {
    return null;
  }
  return {
    start: Math.min(...segments.map((segment) => segment.start)),
    end: Math.max(...segments.map((segment) => segment.end))
  };
}

function doesFeatureOverlapRange(feature, range) {
  if (!feature || !range) {
    return false;
  }
  return (Array.isArray(feature?.segments) ? feature.segments : []).some((segment) => (
    (Number(segment?.start) || 0) < range.end
    && range.start < (Number(segment?.end) || 0)
  ));
}

function isFeatureEditable(feature) {
  if (!feature || typeof feature !== 'object') {
    return false;
  }
  if (String(feature?.type || '').toLowerCase() === 'restriction_site') {
    return false;
  }
  return !isOrfFeature(feature);
}

function positionFloatingUi(element, clientX, clientY) {
  if (!element?.style) {
    return;
  }

  const rawX = Number(clientX);
  const rawY = Number(clientY);
  const fallbackX = Number.isFinite(rawX) ? rawX : 16;
  const fallbackY = Number.isFinite(rawY) ? rawY : 16;
  element.style.left = `${Math.max(8, fallbackX)}px`;
  element.style.top = `${Math.max(8, fallbackY)}px`;

  if (typeof element.getBoundingClientRect !== 'function') {
    return;
  }

  const rect = element.getBoundingClientRect();
  const viewportWidth = Number(globalThis?.innerWidth) || 0;
  const viewportHeight = Number(globalThis?.innerHeight) || 0;
  if (!viewportWidth && !viewportHeight) {
    return;
  }

  const left = viewportWidth > 0
    ? Math.max(8, Math.min(fallbackX, viewportWidth - rect.width - 8))
    : Math.max(8, fallbackX);
  const top = viewportHeight > 0
    ? Math.max(8, Math.min(fallbackY, viewportHeight - rect.height - 8))
    : Math.max(8, fallbackY);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

export {
  buildManualFeatureId,
  doesFeatureOverlapRange,
  formatBaseRangeLabel,
  formatNumber,
  formatPrimerRole,
  getFeatureOverallRange,
  isFeatureEditable,
  positionFloatingUi,
  sanitizeFeatureType
};
