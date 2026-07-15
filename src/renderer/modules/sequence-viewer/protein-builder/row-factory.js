import { escapeHtml } from '../../../lib/html.js';
import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { LIBRARY_LOOKUP } from './constants.js';
import { buildFeatureDerivedSequence } from './sequence-utils.js';

export function cloneLibraryRow(nextRowId, type, libraryId) {
  const preset = LIBRARY_LOOKUP.get(`${type}:${libraryId}`);
  if (!preset) {
    return null;
  }
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'library',
    type,
    libraryId,
    label: preset.label,
    sequence: preset.sequence,
    note: preset.note || ''
  };
}

export function createPoiRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'poi',
    type: 'poi',
    label: 'Current DNA',
    sequence: '',
    note: 'Uses the active Sequence Viewer DNA source.'
  };
}

export function createCustomRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'custom',
    type: 'custom',
    label: 'Custom Block',
    sequence: '',
    note: 'Add a custom amino-acid block.'
  };
}

export function createFeatureRow(nextRowId, feature) {
  const derived = buildFeatureDerivedSequence(feature);
  const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
  const noteParts = [
    feature?.type ? `Stored type: ${feature.type}` : '',
    derived.mode === 'translated'
      ? `Translated from ${Math.max(0, Number(feature?.sequenceLength) || String(derived.sourceSequence || '').length)} nt`
      : 'Stored as protein sequence',
    hostCount ? `${hostCount} host vector${hostCount === 1 ? '' : 's'}` : ''
  ].filter(Boolean);

  return {
    id: `builder_row_${nextRowId}`,
    kind: 'feature',
    type: 'feature',
    label: cleanText(feature?.name, 140) || 'Feature Block',
    sequence: derived.sequence,
    note: noteParts.join(' | '),
    sourceFeatureId: cleanText(feature?.id, 200),
    sourceFeatureType: cleanText(feature?.type, 120),
    sourceSequence: derived.sourceSequence,
    sourceDnaSequence: derived.mode === 'translated' ? derived.sourceSequence : '',
    warnings: derived.warnings
  };
}

export function formatCount(count, singular, plural = `${singular}s`) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
}

export function previewSequence(sequence, maxLength = 36) {
  const cleaned = sanitizeProteinAssemblySequence(sequence, true);
  if (!cleaned.length) {
    return '-';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...`;
}

export function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}
