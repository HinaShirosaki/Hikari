import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { getBlockTypeLabel } from './constants.js';

export function buildConstruct(payload = {}) {
  const constructName = cleanText(payload?.constructName, 140) || 'Untitled construct';
  const poiName = cleanText(payload?.poiName, 140) || 'Protein of Interest';
  const poiSequence = sanitizeProteinAssemblySequence(payload?.poiSequence || '', true);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  const errors = [];
  const warnings = [];
  const parts = [];
  let poiCount = 0;

  rows.forEach((row, index) => {
    const rowType = String(row?.type || '').trim().toLowerCase();
    if (rowType === 'poi') {
      poiCount += 1;
      if (!poiSequence.length) {
        warnings.push('POI block exists, but POI sequence is empty.');
        return;
      }
      parts.push({
        index: index + 1,
        type: 'poi',
        typeLabel: getBlockTypeLabel('poi'),
        kind: 'poi',
        label: poiName,
        sequence: poiSequence,
        note: 'User-supplied POI sequence'
      });
      return;
    }

    const rowSequence = sanitizeProteinAssemblySequence(row?.sequence || '', true);
    const rowLabel = cleanText(row?.label, 160) || `Block ${index + 1}`;
    if (!rowSequence.length) {
      errors.push(`Block ${index + 1} (${rowLabel}) has no amino-acid sequence.`);
      return;
    }

    parts.push({
      index: index + 1,
      type: rowType || 'custom',
      typeLabel: getBlockTypeLabel(rowType || 'custom'),
      kind: cleanText(row?.kind, 40) || 'custom',
      label: rowLabel,
      sequence: rowSequence,
      note: cleanText(row?.note, 240),
      sourceSequence: cleanText(row?.sourceSequence, 24000),
      sourceDnaSequence: normalizeSequenceText(row?.sourceDnaSequence || ''),
      sourceFeatureId: cleanText(row?.sourceFeatureId, 200),
      sourceFeatureType: cleanText(row?.sourceFeatureType, 120)
    });

    (Array.isArray(row?.warnings) ? row.warnings : []).forEach((warning) => {
      warnings.push(`${rowLabel}: ${warning}`);
    });
  });

  if (!poiCount) {
    warnings.push('No POI block is present in the chain.');
  }
  if (poiCount > 1) {
    warnings.push('Multiple POI blocks are present. The same POI sequence will repeat in the chain.');
  }
  if (!poiCount && poiSequence.length) {
    warnings.push('POI sequence is provided but not placed in the chain.');
  }

  let cursor = 1;
  const mappedParts = parts.map((part) => {
    const start = cursor;
    const end = cursor + part.sequence.length - 1;
    cursor = end + 1;
    return {
      ...part,
      length: part.sequence.length,
      start,
      end
    };
  });

  const sequence = mappedParts.map((part) => part.sequence).join('');
  const length = sequence.length;

  if (sequence.includes('*')) {
    if (sequence.endsWith('*') && sequence.indexOf('*') === sequence.length - 1) {
      warnings.push('Construct ends with a stop symbol (*).');
    } else {
      warnings.push('Construct contains an internal stop symbol (*).');
    }
  }
  if (length > 0 && sequence[0] !== 'M') {
    warnings.push('Construct does not start with M. Confirm the N-terminus before expression.');
  }
  if (length > 2500) {
    warnings.push('Construct is very long (>2500 aa). Verify cloning and expression feasibility.');
  }

  return {
    ok: length > 0 && errors.length === 0,
    constructName,
    poiName,
    parts: mappedParts,
    sequence,
    length,
    errors,
    warnings
  };
}
