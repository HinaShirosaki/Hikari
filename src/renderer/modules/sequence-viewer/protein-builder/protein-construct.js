import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { getBlockTypeLabel, SELF_CLEAVING_BLOCK_TYPE } from './constants.js';

export function buildConstruct(payload = {}) {
  const constructName = cleanText(payload?.constructName, 140) || 'Untitled construct';
  const activeDnaSource = payload?.activeDnaSource && typeof payload.activeDnaSource === 'object'
    ? payload.activeDnaSource
    : {};
  const sourceName = cleanText(activeDnaSource.label, 140)
    || cleanText(payload?.poiName, 140)
    || 'Current DNA';
  const sourceSequence = sanitizeProteinAssemblySequence(
    activeDnaSource.proteinSequence || payload?.poiSequence || '',
    true
  );
  const sourceDnaSequence = normalizeSequenceText(activeDnaSource.dnaSequence || '');
  const sourceNote = cleanText(activeDnaSource.note, 240)
    || (sourceSequence.length ? 'User-supplied protein sequence' : '');
  const sourceDnaNote = cleanText(activeDnaSource.reusedSource, 240);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  const errors = [];
  const warnings = [];
  const parts = [];
  let poiCount = 0;

  rows.forEach((row, index) => {
    const rowType = String(row?.type || '').trim().toLowerCase();
    if (rowType === 'poi') {
      poiCount += 1;
      if (!sourceSequence.length) {
        warnings.push('Current DNA block exists, but the active record has no usable coding sequence.');
        return;
      }
      parts.push({
        index: index + 1,
        type: 'poi',
        typeLabel: getBlockTypeLabel('poi'),
        kind: 'poi',
        label: sourceName,
        sequence: sourceSequence,
        note: sourceNote,
        sourceDnaSequence,
        sourceDnaNote
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
      sourceFeatureType: cleanText(row?.sourceFeatureType, 120),
      sourceVectorName: cleanText(row?.sourceVectorName, 160),
      sourceVectorSequence: normalizeSequenceText(row?.sourceVectorSequence || '')
    });

    (Array.isArray(row?.warnings) ? row.warnings : []).forEach((warning) => {
      warnings.push(`${rowLabel}: ${warning}`);
    });
  });

  if (!poiCount) {
    warnings.push('No Current DNA block is present in the chain.');
  }
  if (poiCount > 1) {
    warnings.push('Multiple Current DNA blocks are present. The active coding sequence will repeat in the chain.');
  }
  if (!poiCount && sourceSequence.length) {
    warnings.push('The active DNA coding sequence is not placed in the chain.');
  }

  // A 2A peptide is translated inline but splits the product, so every count and
  // mass derived from `sequence` describes the ORF, not what the cell ends up
  // with. Say so rather than quietly reporting one protein.
  const selfCleavingCount = parts.filter((part) => part.type === SELF_CLEAVING_BLOCK_TYPE).length;
  const productCount = selfCleavingCount + 1;
  if (selfCleavingCount) {
    warnings.push(`Contains ${selfCleavingCount} 2A peptide${selfCleavingCount === 1 ? '' : 's'}: this ORF is translated as one chain but separates into ${productCount} polypeptides. Reported length and mass cover the whole ORF.`);
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
    poiName: sourceName,
    sourceName,
    parts: mappedParts,
    sequence,
    length,
    selfCleavingCount,
    productCount,
    errors,
    warnings
  };
}
