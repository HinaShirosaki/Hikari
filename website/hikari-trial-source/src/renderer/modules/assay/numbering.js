import {
  ASSAY_NUMBER_PADDING,
  ASSAY_NUMBER_PREFIX
} from './constants.js';

export function parseAssayNumberValue(value) {
  const match = String(value || '').trim().match(/(\d+)$/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAssayNumber(sequence) {
  return `${ASSAY_NUMBER_PREFIX}-${String(sequence).padStart(ASSAY_NUMBER_PADDING, '0')}`;
}

export function ensureAssaySequence(state) {
  const maxAssigned = (state.assays || []).reduce((max, assay) => {
    return Math.max(max, parseAssayNumberValue(assay.assayNumber));
  }, 0);
  const current = Number(state.assaySequence);
  if (!Number.isFinite(current) || current <= maxAssigned) {
    state.assaySequence = maxAssigned + 1;
  }
}

export function nextAssayNumber(state) {
  ensureAssaySequence(state);
  const value = formatAssayNumber(state.assaySequence);
  state.assaySequence += 1;
  return value;
}

export function previewNextAssayNumber(state) {
  ensureAssaySequence(state);
  return formatAssayNumber(state.assaySequence);
}

export function ensureAssayNumbers(state) {
  if (!Array.isArray(state.assays)) {
    state.assays = [];
  }
  ensureAssaySequence(state);
  let changed = false;
  (state.assays || []).forEach((assay) => {
    if (String(assay.assayNumber || '').trim()) {
      return;
    }
    assay.assayNumber = nextAssayNumber(state);
    changed = true;
  });
  return changed;
}
