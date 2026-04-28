import { escapeHtml } from '../tool-box/common.js';
import { cleanProteinSequence, reverseComplementDna, reverseTranslateProteinSequence, translateDnaSequence } from '../tool-box/sequence.js';
import {
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_TAGS,
  sanitizeProteinAssemblySequence
} from '../tool-box/protein-assembly.js';
import { buildOrfFeatures } from './orf-analysis.js';
import { createProteinBuilderCloningNotebookPage } from './protein-builder-cloning-notebook.js';
import { parseInputRecords } from './parsing.js';
import { cleanText, clamp, normalizeSequenceText } from './shared.js';

const BLOCK_TYPE_LABELS = Object.freeze({
  tag: 'Tag',
  linker: 'Linker',
  cleavage: 'Cleavage Site',
  feature: 'Feature DB',
  custom: 'Custom',
  poi: 'POI'
});

const DNA_ALPHABET = /^[ACGTRYSWKMBDHVN*]+$/;
const DEFAULT_CHAIN = Object.freeze([
  { kind: 'library', type: 'tag', libraryId: 'his6' },
  { kind: 'library', type: 'cleavage', libraryId: 'tev' },
  { kind: 'poi', type: 'poi' }
]);

const COMMON_BLOCK_GROUPS = Object.freeze([
  {
    id: 'tag',
    label: 'Common peptide tags',
    items: PROTEIN_ASSEMBLY_TAGS
  },
  {
    id: 'linker',
    label: 'Linkers',
    items: PROTEIN_ASSEMBLY_LINKERS
  },
  {
    id: 'cleavage',
    label: 'Protease sites',
    items: PROTEIN_ASSEMBLY_CLEAVAGE_SITES
  }
]);

function buildLibraryLookup() {
  const lookup = new Map();
  COMMON_BLOCK_GROUPS.forEach((group) => {
    (group.items || []).forEach((item) => {
      lookup.set(`${group.id}:${item.id}`, {
        type: group.id,
        ...item
      });
    });
  });
  return lookup;
}

const LIBRARY_LOOKUP = buildLibraryLookup();

function getBlockTypeLabel(type) {
  return BLOCK_TYPE_LABELS[String(type || '').trim().toLowerCase()] || 'Custom';
}

function isLikelyDnaSequence(sequence) {
  const cleaned = String(sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  return Boolean(cleaned) && DNA_ALPHABET.test(cleaned);
}

function buildFeatureDerivedSequence(feature) {
  const rawSequence = String(feature?.sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  if (!rawSequence) {
    return {
      sequence: '',
      mode: 'empty',
      warnings: ['Stored feature has no sequence.'],
      sourceSequence: ''
    };
  }

  if (!isLikelyDnaSequence(rawSequence)) {
    return {
      sequence: cleanProteinSequence(rawSequence, true),
      mode: 'protein',
      warnings: [],
      sourceSequence: rawSequence
    };
  }

  const translation = translateDnaSequence(rawSequence, 1, 'star');
  const warnings = [];
  let protein = String(translation?.protein || '');
  if (protein.endsWith('*')) {
    protein = protein.slice(0, -1);
  }
  if (protein.includes('*')) {
    warnings.push('Translated feature contains an internal stop codon.');
  }
  if (translation?.remainderBases) {
    warnings.push(`${translation.remainderBases} trailing base(s) were ignored during translation.`);
  }
  if (!protein.length) {
    warnings.push('Stored feature did not yield an amino-acid block.');
  }
  return {
    sequence: sanitizeProteinAssemblySequence(protein, true),
    mode: 'translated',
    warnings,
    sourceSequence: rawSequence
  };
}

function normalizeProteinBuildSequence(sequence) {
  return sanitizeProteinAssemblySequence(sequence || '', true);
}

function stripTerminalStop(proteinSequence) {
  const cleaned = normalizeProteinBuildSequence(proteinSequence);
  return cleaned.endsWith('*') ? cleaned.slice(0, -1) : cleaned;
}

function proteinsEquivalent(left, right) {
  return stripTerminalStop(left) === stripTerminalStop(right);
}

function translateDnaToProtein(dnaSequence) {
  const cleaned = normalizeSequenceText(dnaSequence);
  if (!cleaned.length) {
    return '';
  }
  return normalizeProteinBuildSequence(translateDnaSequence(cleaned, 1, 'star')?.protein || '');
}

function normalizeRecordSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean);
}

function extractDnaFromRecordSegments(sequence, segments, strand = 1) {
  const cleanedSequence = normalizeSequenceText(sequence);
  const normalizedSegments = normalizeRecordSegments(segments, cleanedSequence.length);
  if (!cleanedSequence.length || !normalizedSegments.length) {
    return '';
  }

  const orderedSegments = strand === -1
    ? [...normalizedSegments].reverse()
    : normalizedSegments;
  const rawSequence = orderedSegments
    .map((segment) => cleanedSequence.slice(segment.start, segment.end))
    .join('');
  return strand === -1 ? reverseComplementDna(rawSequence) : rawSequence;
}

function mergeSegments(segments) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Math.max(0, Math.round(Number(segment?.start) || 0));
      const end = Math.max(start, Math.round(Number(segment?.end) || 0));
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });

  if (!normalized.length) {
    return [];
  }

  return normalized.reduce((merged, segment) => {
    const last = merged[merged.length - 1];
    if (!last || segment.start > last.end) {
      merged.push({ ...segment });
      return merged;
    }
    last.end = Math.max(last.end, segment.end);
    return merged;
  }, []);
}

function sumSegmentLength(segments) {
  return mergeSegments(segments)
    .reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
}

function buildSequenceFromSegments(sequence, segments) {
  const normalizedSequence = normalizeSequenceText(sequence);
  const normalizedSegments = normalizeRecordSegments(segments, normalizedSequence.length);
  if (!normalizedSequence.length || !normalizedSegments.length) {
    return '';
  }
  return normalizedSegments
    .map((segment) => normalizedSequence.slice(segment.start, segment.end))
    .join('');
}

function invertSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  const normalized = normalizeRecordSegments(segments, safeLength)
    .sort((left, right) => left.start - right.start);
  if (!safeLength) {
    return [];
  }
  if (!normalized.length) {
    return safeLength ? [{ start: 0, end: safeLength }] : [];
  }

  const inverted = [];
  let cursor = 0;
  normalized.forEach((segment) => {
    if (segment.start > cursor) {
      inverted.push({ start: cursor, end: segment.start });
    }
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < safeLength) {
    inverted.push({ start: cursor, end: safeLength });
  }
  return inverted;
}

function getFeatureSpanLength(feature, sequenceLength) {
  return sumSegmentLength(normalizeRecordSegments(feature?.segments, sequenceLength));
}

function getReusableBackboneFeaturePriority(feature, sequenceLength) {
  const source = cleanText(feature?.source, 120).toLowerCase();
  const type = cleanText(feature?.type, 120).toLowerCase();
  return [
    type === 'backbone' ? 0 : 1,
    source === 'backbone_recognition' ? 0 : (source === 'protein_builder' ? 1 : 2),
    -getFeatureSpanLength(feature, sequenceLength),
    cleanText(feature?.name, 160)
  ];
}

function getReusableInsertFeaturePriority(feature, sequenceLength) {
  const source = cleanText(feature?.source, 120).toLowerCase();
  const type = cleanText(feature?.type, 120).toLowerCase();
  return [
    type === 'insert' ? 0 : 1,
    source === 'backbone_recognition' ? 0 : (source === 'protein_builder' ? 1 : 2),
    -getFeatureSpanLength(feature, sequenceLength),
    cleanText(feature?.name, 160)
  ];
}

function comparePriorityTuple(left = [], right = []) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return String(leftValue || '').localeCompare(String(rightValue || ''));
    }
    return Number(leftValue || 0) - Number(rightValue || 0);
  }
  return 0;
}

function selectFeatureByType(features, type, sequenceLength) {
  return (Array.isArray(features) ? features : [])
    .filter((feature) => cleanText(feature?.type, 120).toLowerCase() === type)
    .sort((left, right) => {
      const leftPriority = type === 'backbone'
        ? getReusableBackboneFeaturePriority(left, sequenceLength)
        : getReusableInsertFeaturePriority(left, sequenceLength);
      const rightPriority = type === 'backbone'
        ? getReusableBackboneFeaturePriority(right, sequenceLength)
        : getReusableInsertFeaturePriority(right, sequenceLength);
      return comparePriorityTuple(leftPriority, rightPriority);
    })[0] || null;
}

function deriveInsertionOffsetFromBackboneSegments(backboneSegments, sequenceLength) {
  const orderedSegments = normalizeRecordSegments(backboneSegments, sequenceLength);
  if (!orderedSegments.length) {
    return null;
  }
  if (orderedSegments.length === 1) {
    const wrapGap = Math.max(0, sequenceLength - orderedSegments[0].end) + orderedSegments[0].start;
    return wrapGap > 0 ? orderedSegments[0].end - orderedSegments[0].start : null;
  }

  let cursor = 0;
  for (let index = 0; index < orderedSegments.length - 1; index += 1) {
    const current = orderedSegments[index];
    const next = orderedSegments[index + 1];
    cursor += current.end - current.start;
    const gapLength = next.start >= current.end
      ? next.start - current.end
      : Math.max(0, sequenceLength - current.end) + next.start;
    if (gapLength > 0) {
      return cursor;
    }
  }

  const last = orderedSegments[orderedSegments.length - 1];
  const first = orderedSegments[0];
  const wrapGap = Math.max(0, sequenceLength - last.end) + first.start;
  if (wrapGap > 0) {
    return sumSegmentLength(orderedSegments);
  }
  return null;
}

function resolvePromoterInsertionOffset(features, backboneLength) {
  const safeBackboneLength = Math.max(0, Number(backboneLength) || 0);
  const promoter = (Array.isArray(features) ? features : [])
    .filter((feature) => cleanText(feature?.type, 120).toLowerCase() === 'promoter')
    .map((feature) => ({
      feature,
      segments: mergeSegments(feature?.segments)
    }))
    .filter((entry) => entry.segments.length)
    .sort((left, right) => {
      if (left.segments[0].start !== right.segments[0].start) {
        return left.segments[0].start - right.segments[0].start;
      }
      return right.segments[right.segments.length - 1].end - left.segments[left.segments.length - 1].end;
    })[0];

  if (!promoter) {
    return safeBackboneLength;
  }
  return clamp(promoter.segments[promoter.segments.length - 1].end, 0, safeBackboneLength);
}

function projectSegmentsOntoBackbone(featureSegments, backboneSegments, sequenceLength) {
  const orderedBackboneSegments = normalizeRecordSegments(backboneSegments, sequenceLength);
  const normalizedFeatureSegments = normalizeRecordSegments(featureSegments, sequenceLength);
  if (!orderedBackboneSegments.length || !normalizedFeatureSegments.length) {
    return [];
  }

  const projectionMap = [];
  let projectedCursor = 0;
  orderedBackboneSegments.forEach((segment) => {
    const length = Math.max(0, segment.end - segment.start);
    if (!length) {
      return;
    }
    projectionMap.push({
      originalStart: segment.start,
      originalEnd: segment.end,
      projectedStart: projectedCursor
    });
    projectedCursor += length;
  });

  const projectedSegments = [];
  normalizedFeatureSegments.forEach((featureSegment) => {
    projectionMap.forEach((projection) => {
      const overlapStart = Math.max(featureSegment.start, projection.originalStart);
      const overlapEnd = Math.min(featureSegment.end, projection.originalEnd);
      if (overlapEnd <= overlapStart) {
        return;
      }
      projectedSegments.push({
        start: projection.projectedStart + (overlapStart - projection.originalStart),
        end: projection.projectedStart + (overlapEnd - projection.originalStart)
      });
    });
  });

  return mergeSegments(projectedSegments);
}

function projectFeatureOntoBackbone(feature, backboneSegments, sequenceLength, index = 0) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const featureType = cleanText(feature?.type, 120).toLowerCase();
  if (featureType === 'insert') {
    return null;
  }

  const projectedSegments = projectSegmentsOntoBackbone(feature?.segments, backboneSegments, sequenceLength);
  if (!projectedSegments.length) {
    return null;
  }

  return {
    id: cleanText(feature?.id, 200) || `stored_backbone_feature_${index + 1}`,
    name: cleanText(feature?.name, 160) || `Feature ${index + 1}`,
    type: featureType || 'misc_feature',
    strand: Number(feature?.strand) === -1 ? -1 : 1,
    source: cleanText(feature?.source, 120) || 'stored_backbone',
    description: cleanText(feature?.description, 2400),
    locationText: cleanText(feature?.locationText, 240),
    segments: projectedSegments
  };
}

function shiftSegmentsForInsertion(segments, insertionOffset, insertLength) {
  const safeOffset = Math.max(0, Math.round(Number(insertionOffset) || 0));
  const safeInsertLength = Math.max(0, Math.round(Number(insertLength) || 0));
  const shifted = [];

  mergeSegments(segments).forEach((segment) => {
    if (segment.end <= safeOffset) {
      shifted.push({ ...segment });
      return;
    }
    if (segment.start >= safeOffset) {
      shifted.push({
        start: segment.start + safeInsertLength,
        end: segment.end + safeInsertLength
      });
      return;
    }
    shifted.push({ start: segment.start, end: safeOffset });
    shifted.push({
      start: safeOffset + safeInsertLength,
      end: segment.end + safeInsertLength
    });
  });

  return mergeSegments(shifted);
}

function shiftFeatureForInsertion(feature, insertionOffset, insertLength) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }
  const shiftedSegments = shiftSegmentsForInsertion(feature?.segments, insertionOffset, insertLength);
  if (!shiftedSegments.length) {
    return null;
  }
  return {
    ...feature,
    segments: shiftedSegments
  };
}

function buildBackboneCoverageSegments(backboneLength, insertionOffset, insertLength) {
  const safeBackboneLength = Math.max(0, Math.round(Number(backboneLength) || 0));
  const safeOffset = clamp(Math.round(Number(insertionOffset) || 0), 0, safeBackboneLength);
  const safeInsertLength = Math.max(0, Math.round(Number(insertLength) || 0));
  const segments = [];

  if (safeOffset > 0) {
    segments.push({ start: 0, end: safeOffset });
  }
  if (safeBackboneLength > safeOffset) {
    segments.push({
      start: safeOffset + safeInsertLength,
      end: safeOffset + safeInsertLength + (safeBackboneLength - safeOffset)
    });
  }

  return mergeSegments(segments);
}

function deriveReusableBackboneFromRecord(record = {}, options = {}) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  const features = Array.isArray(record?.features) ? record.features : [];
  if (!sequence.length) {
    return null;
  }

  const explicitBackboneFeature = selectFeatureByType(features, 'backbone', sequence.length);
  const explicitInsertFeature = selectFeatureByType(features, 'insert', sequence.length);
  const explicitBackboneSegments = normalizeRecordSegments(explicitBackboneFeature?.segments, sequence.length);
  const explicitInsertSegments = normalizeRecordSegments(explicitInsertFeature?.segments, sequence.length);
  let reusableBackboneSegments = explicitBackboneSegments.length
    ? explicitBackboneSegments
    : (explicitInsertSegments.length ? invertSegments(explicitInsertSegments, sequence.length) : []);

  if (!reusableBackboneSegments.length) {
    reusableBackboneSegments = [{ start: 0, end: sequence.length }];
  }

  const backboneSequence = buildSequenceFromSegments(sequence, reusableBackboneSegments);
  const backboneLength = backboneSequence.length;
  const projectedFeatures = features
    .map((feature, index) => projectFeatureOntoBackbone(feature, reusableBackboneSegments, sequence.length, index))
    .filter(Boolean);
  const insertionOffset = clamp(
    deriveInsertionOffsetFromBackboneSegments(reusableBackboneSegments, sequence.length)
      ?? resolvePromoterInsertionOffset(projectedFeatures, backboneLength),
    0,
    backboneLength
  );

  return {
    topology: cleanText(record?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
    backboneSequence,
    backboneLength,
    backboneSegments: reusableBackboneSegments,
    insertSegments: explicitInsertSegments,
    insertionOffset,
    features: projectedFeatures,
    sourceRecordName: cleanText(options?.sourceRecordName, 160) || cleanText(record?.name, 160),
    hostVectorName: cleanText(options?.hostVectorName, 160) || cleanText(record?.name, 160),
    backboneName: cleanText(options?.backboneName, 160) || cleanText(record?.name, 160) || 'Stored backbone'
  };
}

function alignDnaToProteinSequence(dnaSequence, proteinSequence) {
  const cleanedDna = normalizeSequenceText(dnaSequence);
  const cleanedProtein = normalizeProteinBuildSequence(proteinSequence);
  if (!cleanedDna.length || !cleanedProtein.length) {
    return cleanedDna;
  }

  const translated = translateDnaToProtein(cleanedDna);
  if (translated === cleanedProtein) {
    return cleanedDna;
  }
  if (!cleanedProtein.endsWith('*') && translated === `${cleanedProtein}*` && cleanedDna.length >= 3) {
    return cleanedDna.slice(0, -3);
  }
  return cleanedDna;
}

function cloneLibraryRow(nextRowId, type, libraryId) {
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

function createPoiRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'poi',
    type: 'poi',
    label: 'Protein of Interest',
    sequence: '',
    note: 'Uses the POI fields in the left column.'
  };
}

function createCustomRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'custom',
    type: 'custom',
    label: 'Custom Block',
    sequence: '',
    note: 'Add a custom amino-acid block.'
  };
}

function createFeatureRow(nextRowId, feature) {
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

function formatCount(count, singular, plural = `${singular}s`) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
}

function previewSequence(sequence, maxLength = 36) {
  const cleaned = sanitizeProteinAssemblySequence(sequence, true);
  if (!cleaned.length) {
    return '-';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...`;
}

function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}

function buildConstruct(payload = {}) {
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

function buildFeatureResultMeta(feature) {
  const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
  const derived = buildFeatureDerivedSequence(feature);
  const aaLength = sanitizeProteinAssemblySequence(derived.sequence, true).length;
  const sourceLength = Math.max(0, Number(feature?.sequenceLength) || String(derived.sourceSequence || '').length);
  const lengthText = derived.mode === 'translated'
    ? `${sourceLength} nt -> ${aaLength} aa`
    : `${aaLength} aa`;
  return {
    ...derived,
    lengthText,
    hostText: formatCount(hostCount, 'vector')
  };
}

function buildRecordSequenceCandidate(record, feature, sourceKind = 'feature') {
  const featureType = cleanText(feature?.type, 120).toLowerCase();
  const hasExplicitProtein = Boolean(cleanText(feature?.translation || feature?.proteinSequence, 24000));
  const isLikelyCoding = hasExplicitProtein
    || featureType === 'cds'
    || featureType === 'insert'
    || featureType === 'open_reading_frame'
    || featureType === 'orf';
  if (!isLikelyCoding) {
    return null;
  }

  const dnaSequence = extractDnaFromRecordSegments(record?.sequence, feature?.segments, Number(feature?.strand) === -1 ? -1 : 1);
  if (!dnaSequence) {
    return null;
  }
  const proteinSequence = normalizeProteinBuildSequence(
    feature?.translation
      || feature?.proteinSequence
      || translateDnaToProtein(dnaSequence)
  );
  if (!proteinSequence.length) {
    return null;
  }

  return {
    sourceKind,
    type: featureType || 'feature',
    label: cleanText(feature?.name, 140) || 'feature',
    dnaSequence,
    proteinSequence,
    segments: normalizeRecordSegments(feature?.segments, String(record?.sequence || '').length),
    strand: Number(feature?.strand) === -1 ? -1 : 1
  };
}

function getPoiSourcePriority(candidate) {
  const sourceKind = cleanText(candidate?.sourceKind, 40).toLowerCase();
  const type = cleanText(candidate?.type, 120).toLowerCase();
  if (sourceKind === 'selected_feature') {
    return 0;
  }
  if (type === 'cds') {
    return 1;
  }
  if (type === 'insert') {
    return 2;
  }
  if (type === 'open_reading_frame' || type === 'orf') {
    return 3;
  }
  return 4;
}

function resolvePoiDnaFromRecord(proteinSequence, record, selectedFeature = null) {
  const targetProtein = normalizeProteinBuildSequence(proteinSequence);
  if (!targetProtein.length || !record?.sequence?.length) {
    return null;
  }

  const dedupe = new Set();
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidate?.dnaSequence || !candidate?.proteinSequence) {
      return;
    }
    if (!proteinsEquivalent(candidate.proteinSequence, targetProtein)) {
      return;
    }
    const key = [
      cleanText(candidate.sourceKind, 40),
      cleanText(candidate.type, 120),
      cleanText(candidate.label, 140),
      candidate.strand === -1 ? -1 : 1,
      candidate.segments.map((segment) => `${segment.start}-${segment.end}`).join(',')
    ].join('|');
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    candidates.push(candidate);
  };

  pushCandidate(buildRecordSequenceCandidate(record, selectedFeature, 'selected_feature'));
  (Array.isArray(record?.features) ? record.features : []).forEach((feature) => {
    pushCandidate(buildRecordSequenceCandidate(record, feature, 'record_feature'));
  });

  buildOrfFeatures(record.sequence, record.topology, {
    minAaLength: Math.max(1, stripTerminalStop(targetProtein).length)
  }).forEach((orfFeature) => {
    pushCandidate(buildRecordSequenceCandidate(record, orfFeature, 'record_orf'));
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftPriority = getPoiSourcePriority(left);
    const rightPriority = getPoiSourcePriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftLengthDelta = Math.abs(stripTerminalStop(left.proteinSequence).length - stripTerminalStop(targetProtein).length);
    const rightLengthDelta = Math.abs(stripTerminalStop(right.proteinSequence).length - stripTerminalStop(targetProtein).length);
    if (leftLengthDelta !== rightLengthDelta) {
      return leftLengthDelta - rightLengthDelta;
    }
    return cleanText(left.label, 140).localeCompare(cleanText(right.label, 140));
  });

  const best = candidates[0];
  const sourceLabel = cleanText(best?.label, 140) || 'current vector';
  const sourceType = cleanText(best?.type, 120).toLowerCase();
  const sourceDescription = sourceType === 'cds'
    ? `current vector CDS ${sourceLabel}`
    : (sourceType === 'open_reading_frame' || sourceType === 'orf'
      ? `current vector ORF ${sourceLabel}`
      : `current vector feature ${sourceLabel}`);

  return {
    dnaSequence: alignDnaToProteinSequence(best.dnaSequence, proteinSequence),
    note: `Reused POI DNA from ${sourceDescription}.`,
    sourceLabel
  };
}

function buildDnaPartFromProtein(part, options = {}) {
  const proteinSequence = normalizeProteinBuildSequence(part?.sequence || '');
  if (!proteinSequence.length) {
    return null;
  }

  if (cleanText(part?.kind, 40).toLowerCase() === 'poi') {
    const poiSource = resolvePoiDnaFromRecord(proteinSequence, options?.record, options?.selectedFeature);
    if (poiSource?.dnaSequence) {
      return {
        ok: true,
        label: cleanText(part?.label, 160) || 'POI',
        dnaSequence: poiSource.dnaSequence,
        templateSequence: poiSource.dnaSequence,
        reusedSource: poiSource.note
      };
    }
  }

  const sourceDnaSequence = normalizeSequenceText(part?.sourceDnaSequence || '');
  if (sourceDnaSequence.length) {
    return {
      ok: true,
      label: cleanText(part?.label, 160) || 'Block',
      dnaSequence: alignDnaToProteinSequence(sourceDnaSequence, proteinSequence),
      templateSequence: alignDnaToProteinSequence(sourceDnaSequence, proteinSequence),
      reusedSource: cleanText(part?.kind, 40).toLowerCase() === 'feature'
        ? `Reused stored DNA for ${cleanText(part?.label, 160) || 'feature block'}.`
        : ''
    };
  }

  const reverseTranslated = reverseTranslateProteinSequence(proteinSequence);
  if (!reverseTranslated?.ok || !reverseTranslated?.dna) {
    return {
      ok: false,
      label: cleanText(part?.label, 160) || 'Block',
      error: reverseTranslated?.message || `Unable to generate DNA for ${cleanText(part?.label, 160) || 'block'}.`
    };
  }

  return {
    ok: true,
    label: cleanText(part?.label, 160) || 'Block',
    dnaSequence: normalizeSequenceText(reverseTranslated.dna)
  };
}

function buildDnaConstruct(payload = {}, options = {}) {
  const proteinConstruct = buildConstruct(payload);
  if (!proteinConstruct.ok) {
    return {
      ok: false,
      length: 0,
      sequence: '',
      warnings: Array.isArray(proteinConstruct?.warnings) ? proteinConstruct.warnings : [],
      errors: Array.isArray(proteinConstruct?.errors) ? proteinConstruct.errors : ['Unable to build the protein construct first.'],
      parts: [],
      notes: []
    };
  }

  const parts = [];
  const warnings = Array.isArray(proteinConstruct?.warnings) ? [...proteinConstruct.warnings] : [];
  const errors = [];
  const notes = [];

  (Array.isArray(proteinConstruct?.parts) ? proteinConstruct.parts : []).forEach((part) => {
    const dnaPart = buildDnaPartFromProtein(part, options);
    if (!dnaPart?.ok || !dnaPart?.dnaSequence) {
      errors.push(dnaPart?.error || `Unable to generate DNA for ${cleanText(part?.label, 160) || 'block'}.`);
      return;
    }
    if (dnaPart.reusedSource) {
      notes.push(dnaPart.reusedSource);
    }
    parts.push({
      label: dnaPart.label,
      dnaSequence: dnaPart.dnaSequence,
      templateSequence: normalizeSequenceText(dnaPart.templateSequence || ''),
      length: dnaPart.dnaSequence.length
    });
  });

  const sequence = parts.map((part) => part.dnaSequence).join('');
  return {
    ok: Boolean(sequence.length) && errors.length === 0,
    length: sequence.length,
    sequence,
    warnings,
    errors,
    parts,
    notes
  };
}

function buildStoredBackboneDisplayName(backbone = {}) {
  return cleanText(backbone?.hostVectorName, 160)
    || cleanText(backbone?.backboneName, 160)
    || cleanText(backbone?.entryName, 160)
    || cleanText(backbone?.sourceRecordName, 160)
    || 'Stored backbone';
}

function formatStoredBackboneDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return String(value || '').slice(0, 10);
  }
}

function buildAssembledPlasmidPayload(backbone = {}, dnaConstruct = {}, options = {}) {
  const backboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
  const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  if (!backboneSequence.length || !insertSequence.length) {
    return null;
  }

  const constructName = cleanText(options?.constructName, 140) || 'Protein Builder Insert';
  const backboneName = buildStoredBackboneDisplayName(backbone);
  const assembledName = `${constructName} (${backboneName})`;
  const explicitInsertionOffset = Number(backbone?.insertionOffset);
  const insertionOffset = clamp(
    Number.isFinite(explicitInsertionOffset) ? Math.round(explicitInsertionOffset) : backboneSequence.length,
    0,
    backboneSequence.length
  );
  const shiftedBackboneFeatures = (Array.isArray(backbone?.features) ? backbone.features : [])
    .map((feature) => shiftFeatureForInsertion(feature, insertionOffset, insertSequence.length))
    .filter(Boolean);
  const hasBackboneFeature = shiftedBackboneFeatures
    .some((feature) => cleanText(feature?.type, 120).toLowerCase() === 'backbone');
  const features = [];

  if (!hasBackboneFeature) {
    features.push({
      id: 'protein_builder_backbone',
      name: `Backbone (${backboneName})`,
      type: 'backbone',
      strand: 1,
      source: 'protein_builder',
      description: `Stored backbone selected from ${cleanText(backbone?.sourceRecordName, 160) || backboneName}.`,
      segments: buildBackboneCoverageSegments(backboneSequence.length, insertionOffset, insertSequence.length)
    });
  }

  features.push(...shiftedBackboneFeatures);
  features.push({
    id: 'protein_builder_insert',
    name: constructName,
    type: 'insert',
    strand: 1,
    source: 'protein_builder',
    description: `Protein Builder insert assembled from ${Math.max(0, Number(dnaConstruct?.parts?.length) || 0)} DNA block(s).`,
    segments: [{ start: insertionOffset, end: insertionOffset + insertSequence.length }]
  });

  let cursor = insertionOffset;
  (Array.isArray(dnaConstruct?.parts) ? dnaConstruct.parts : []).forEach((part, index) => {
    const dnaSequence = normalizeSequenceText(part?.dnaSequence || '');
    if (!dnaSequence.length) {
      return;
    }
    features.push({
      id: `protein_builder_insert_part_${index + 1}`,
      name: cleanText(part?.label, 160) || `Block ${index + 1}`,
      type: 'misc_feature',
      strand: 1,
      source: 'protein_builder',
      description: `Protein Builder DNA block (${dnaSequence.length} bp).`,
      segments: [{ start: cursor, end: cursor + dnaSequence.length }]
    });
    cursor += dnaSequence.length;
  });

  return {
    name: assembledName,
    sequence: `${backboneSequence.slice(0, insertionOffset)}${insertSequence}${backboneSequence.slice(insertionOffset)}`,
    topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
    source: 'protein_builder',
    features
  };
}

function buildProteinBuilderConfirmationPayload({
  assembledRecord = {},
  constructName = '',
  backbone = {},
  dnaConstruct = {},
  notebookEntry = null
} = {}) {
  const design = notebookEntry?.proteinBuilderCloningDesign && typeof notebookEntry.proteinBuilderCloningDesign === 'object'
    ? notebookEntry.proteinBuilderCloningDesign
    : null;
  const notebookTitle = cleanText(notebookEntry?.experimentName, 220)
    || cleanText(notebookEntry?.protocolName, 220);
  return {
    recordName: cleanText(assembledRecord?.name, 160),
    constructName: cleanText(constructName, 160),
    backboneName: buildStoredBackboneDisplayName(backbone),
    sourceLabel: cleanText(backbone?.sourceRecordName, 160) || buildStoredBackboneDisplayName(backbone),
    plasmidLength: Math.max(0, Number(assembledRecord?.sequence?.length) || 0),
    insertLength: Math.max(0, Number(dnaConstruct?.length || dnaConstruct?.sequence?.length) || 0),
    notebookEntryId: cleanText(notebookEntry?.id, 160),
    notebookTitle,
    assemblyStrategy: cleanText(design?.recommendedAssemblyStrategy, 120),
    primerCount: Math.max(
      0,
      Number(design?.primerCount) || 0
    ),
    cloningDesignSource: {
      constructName: cleanText(constructName, 160),
      backbone: { ...backbone },
      dnaConstruct: {
        ...dnaConstruct,
        parts: Array.isArray(dnaConstruct?.parts)
          ? dnaConstruct.parts.map((part) => ({ ...part }))
          : []
      },
      assembledRecord: {
        ...assembledRecord,
        features: Array.isArray(assembledRecord?.features)
          ? assembledRecord.features.map((feature) => ({
              ...feature,
              segments: Array.isArray(feature?.segments)
                ? feature.segments.map((segment) => ({ ...segment }))
                : []
            }))
          : []
      }
    }
  };
}

export function createSequenceViewerProteinBuilderController(config = {}) {
  const elements = config?.elements || {};
  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getSelectedFeature = config?.getSelectedFeature || (() => null);
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const setStatus = config?.setStatus || (() => {});
  const onNavigateHome = typeof config?.onNavigateHome === 'function'
    ? config.onNavigateHome
    : (() => {});
  const onNavigateBuilder = typeof config?.onNavigateBuilder === 'function'
    ? config.onNavigateBuilder
    : (() => {});
  const loadExternalRecord = typeof config?.loadExternalRecord === 'function'
    ? config.loadExternalRecord
    : (() => {});
  const appState = config?.state && typeof config.state === 'object' ? config.state : null;
  const persist = typeof config?.persist === 'function' ? config.persist : null;
  const createId = typeof config?.createId === 'function' ? config.createId : null;
  const onNotebookEntriesChanged = typeof config?.onNotebookEntriesChanged === 'function'
    ? config.onNotebookEntriesChanged
    : null;

  const state = {
    nextRowId: 1,
    rows: [],
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    dnaConstruct: null,
    assemblyDialogOpen: false,
    isLoadingAssemblyBackbones: false,
    isPreparingAssembly: false,
    storedBackbones: [],
    selectedBackboneId: '',
    statusMessage: 'Linear chain: each block accepts one upstream and one downstream connection.',
    statusError: false
  };

  function setBuilderStatus(message, isError = false) {
    state.statusMessage = String(message || '');
    state.statusError = isError === true;
    if (!elements.proteinBuilderStatus) {
      return;
    }
    elements.proteinBuilderStatus.textContent = state.statusMessage;
    elements.proteinBuilderStatus.style.color = state.statusError ? 'var(--danger)' : '';
  }

  function setFeatureSearchStatus(message, isError = false) {
    if (!elements.proteinBuilderFeatureSearchStatus) {
      return;
    }
    elements.proteinBuilderFeatureSearchStatus.textContent = String(message || '');
    elements.proteinBuilderFeatureSearchStatus.style.color = isError ? 'var(--danger)' : '';
  }

  function syncFeatureSearchControls() {
    const disabled = !hasStoragePath() || Boolean(state.isSearchingFeatures);
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.disabled = disabled;
    }
    if (elements.proteinBuilderFeatureSearchBtn) {
      elements.proteinBuilderFeatureSearchBtn.disabled = disabled;
    }
    if (elements.proteinBuilderAssembleBtn) {
      elements.proteinBuilderAssembleBtn.disabled = Boolean(state.isLoadingAssemblyBackbones || state.isPreparingAssembly);
    }
  }

  function invalidateDnaConstruct() {
    state.dnaConstruct = null;
  }

  function appendRow(row, options = {}) {
    if (!row) {
      return;
    }
    const insertBeforePoi = options?.insertBeforePoi !== false;
    const poiIndex = state.rows.findIndex((item) => item.type === 'poi');
    if (insertBeforePoi && row.type !== 'poi' && poiIndex >= 0) {
      state.rows.splice(poiIndex, 0, row);
      return;
    }
    state.rows.push(row);
  }

  function resetRows() {
    state.rows = [];
    invalidateDnaConstruct();
    DEFAULT_CHAIN.forEach((entry) => {
      if (entry.kind === 'library') {
        appendRow(cloneLibraryRow(state.nextRowId++, entry.type, entry.libraryId), { insertBeforePoi: false });
      }
      if (entry.kind === 'poi') {
        appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
      }
    });
  }

  function currentRows() {
    return state.rows.map((row) => ({ ...row }));
  }

  function getDnaBuildContextKey() {
    const record = getSelectedRecord();
    const selectedFeature = getSelectedFeature();
    const recordKey = normalizeSequenceText(record?.sequence || '');
    const featureKey = selectedFeature
      ? [
          cleanText(selectedFeature?.name, 140),
          cleanText(selectedFeature?.type, 120),
          Number(selectedFeature?.strand) === -1 ? -1 : 1,
          (Array.isArray(selectedFeature?.segments) ? selectedFeature.segments : [])
            .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
            .join(',')
        ].join('|')
      : '';
    return `${recordKey}::${featureKey}`;
  }

  function renderDnaConstruct() {
    if (state.dnaConstruct?.contextKey && state.dnaConstruct.contextKey !== getDnaBuildContextKey()) {
      state.dnaConstruct = null;
    }
    if (elements.proteinBuilderDnaMeta) {
      elements.proteinBuilderDnaMeta.textContent = state.dnaConstruct?.sequence?.length
        ? `${state.dnaConstruct.length} nt | ${state.dnaConstruct.parts.length} block${state.dnaConstruct.parts.length === 1 ? '' : 's'}`
        : 'DNA build not run yet.';
    }
    if (!elements.proteinBuilderDnaSequence) {
      return;
    }

    if (!state.dnaConstruct) {
      elements.proteinBuilderDnaSequence.innerHTML = '<p class="small-note">Click Build DNA Sequence to generate a coding sequence for the current chain.</p>';
      return;
    }

    if (!state.dnaConstruct.ok || !state.dnaConstruct.sequence) {
      const messages = [
        ...(Array.isArray(state.dnaConstruct.errors) ? state.dnaConstruct.errors : []),
        ...(Array.isArray(state.dnaConstruct.warnings) ? state.dnaConstruct.warnings : [])
      ].filter(Boolean);
      elements.proteinBuilderDnaSequence.innerHTML = messages.length
        ? messages.map((message) => `<p class="small-note">${escapeHtml(message)}</p>`).join('')
        : '<p class="small-note">Unable to generate a DNA sequence.</p>';
      return;
    }

    const supplemental = [
      ...(Array.isArray(state.dnaConstruct.notes) ? state.dnaConstruct.notes : []),
      ...(Array.isArray(state.dnaConstruct.warnings) ? state.dnaConstruct.warnings : [])
    ].filter(Boolean);
    elements.proteinBuilderDnaSequence.innerHTML = `
      <span class="sequence-viewer-protein-builder-sequence-text">${escapeHtml(state.dnaConstruct.sequence)}</span>
      ${supplemental.length
        ? `<div class="sequence-viewer-protein-builder-dna-notes">${supplemental.map((message) => `<p class="small-note">${escapeHtml(message)}</p>`).join('')}</div>`
        : ''}
    `;
  }

  function getSelectedStoredBackbone() {
    return (Array.isArray(state.storedBackbones) ? state.storedBackbones : [])
      .find((item) => cleanText(item?.id, 400) === cleanText(state.selectedBackboneId, 400)) || null;
  }

  function closeAssemblyDialog() {
    state.assemblyDialogOpen = false;
    state.isLoadingAssemblyBackbones = false;
    state.isPreparingAssembly = false;
    renderAssemblyDialog();
  }

  function normalizeStoredBackboneCandidate(backbone = {}) {
    const backboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
    const insertLength = Math.max(0, Number(backbone?.insertLength) || 0);
    const backboneLength = Math.max(0, Number(backbone?.backboneLength) || backboneSequence.length);
    const originalSequenceLength = Math.max(backboneLength + insertLength, backboneSequence.length);
    const backboneSegments = normalizeRecordSegments(backbone?.backboneSegments, originalSequenceLength);
    const insertSegments = normalizeRecordSegments(backbone?.insertSegments, originalSequenceLength);
    const fallbackInsertionOffset = deriveInsertionOffsetFromBackboneSegments(backboneSegments, originalSequenceLength);
    const explicitInsertionOffset = Number(backbone?.insertionOffset);
    const insertionOffset = clamp(
      Number.isFinite(explicitInsertionOffset)
        ? Math.round(explicitInsertionOffset)
        : (Number.isFinite(fallbackInsertionOffset) ? fallbackInsertionOffset : backboneSequence.length),
      0,
      backboneSequence.length
    );

    return {
      ...backbone,
      sourceKind: cleanText(backbone?.sourceKind, 120) || 'recognized_backbone',
      topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
      variantMode: cleanText(backbone?.variantMode, 40).toLowerCase() === 'restriction' ? 'restriction' : 'gibson',
      backboneSequence,
      backboneLength,
      insertLength,
      backboneSegments,
      insertSegments,
      insertionOffset,
      features: Array.isArray(backbone?.features) ? backbone.features : []
    };
  }

  async function loadStoredBackboneCandidates() {
    const bridge = getBridge();
    const storagePath = getStoragePath();

    if (!bridge?.sequenceLibraryListBackbones) {
      return [];
    }

    const response = await bridge.sequenceLibraryListBackbones({
      storagePath,
      limit: 100
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load stored backbones.');
    }
    return (Array.isArray(response.results) ? response.results : [])
      .map((item) => normalizeStoredBackboneCandidate(item));
  }

  async function hydrateStoredBackbone(backbone = {}) {
    if (!backbone || typeof backbone !== 'object') {
      throw new Error('Missing stored backbone selection.');
    }
    if (backbone.hydratedBackbone && typeof backbone.hydratedBackbone === 'object') {
      return backbone.hydratedBackbone;
    }

    if (cleanText(backbone?.sourceKind, 120) !== 'library_entry') {
      const normalized = normalizeStoredBackboneCandidate(backbone);
      backbone.hydratedBackbone = normalized;
      return normalized;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      throw new Error('Stored sequence entry API unavailable.');
    }

    const response = await bridge.sequenceLibraryGet({
      storagePath: getStoragePath(),
      id: cleanText(backbone?.entryId, 200),
      includeGbk: true
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load the selected stored backbone.');
    }

    const gbkText = String(response?.gbkText || '');
    const parsed = parseInputRecords(gbkText, {
      fileName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.entryName, 160) || 'stored_backbone.gbk'
    });
    const record = Array.isArray(parsed?.records) ? parsed.records[0] : null;
    if (!record?.sequence) {
      throw new Error('Stored backbone entry did not contain a usable sequence.');
    }

    const derived = deriveReusableBackboneFromRecord(record, {
      sourceRecordName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.sourceRecordName, 160),
      hostVectorName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.hostVectorName, 160),
      backboneName: cleanText(backbone?.backboneName, 160) || cleanText(response?.entry?.name, 160)
    });
    if (!derived?.backboneSequence) {
      throw new Error('Unable to derive a reusable backbone from the selected sequence entry.');
    }

    const hydrated = {
      ...backbone,
      ...derived,
      entryName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.entryName, 160),
      entryStatus: cleanText(response?.entry?.status, 40) || cleanText(backbone?.entryStatus, 40),
      updatedAt: cleanText(response?.entry?.updatedAt, 120) || cleanText(backbone?.updatedAt, 120)
    };
    backbone.hydratedBackbone = hydrated;
    backbone.backboneLength = hydrated.backboneLength;
    backbone.insertionOffset = hydrated.insertionOffset;
    backbone.features = hydrated.features;
    backbone.topology = hydrated.topology;
    return hydrated;
  }

  function renderAssemblyDialog() {
    if (elements.proteinBuilderAssemblyOverlay) {
      elements.proteinBuilderAssemblyOverlay.hidden = !state.assemblyDialogOpen;
    }

    const selectedBackbone = getSelectedStoredBackbone();
    const canAdvanceToReview = Boolean(
      selectedBackbone
      && state.dnaConstruct?.ok
      && state.dnaConstruct?.sequence
    );
    const constructName = cleanText(elements.proteinBuilderNameInput?.value, 140) || 'Protein Builder Insert';
    if (elements.proteinBuilderAssemblySubtitle) {
      elements.proteinBuilderAssemblySubtitle.textContent = state.dnaConstruct?.ok && state.dnaConstruct?.sequence
        ? `Select a stored backbone to combine with the current ${state.dnaConstruct.length} nt DNA build.`
        : 'Select a stored backbone to combine with the current DNA build.';
    }

    if (elements.proteinBuilderAssemblyList) {
      if (state.isLoadingAssemblyBackbones) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">Loading stored backbones...</p>';
      } else if (!hasStoragePath()) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">Set Storage Folder Path in Settings to browse stored backbones.</p>';
      } else if (!state.storedBackbones.length) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">No stored backbones yet. Use Recognize Backbone/Insert on a vector to create one.</p>';
      } else {
        elements.proteinBuilderAssemblyList.innerHTML = state.storedBackbones.map((backbone) => {
          const isActive = cleanText(backbone?.id, 400) === cleanText(state.selectedBackboneId, 400);
          const variantLabel = backbone?.variantMode === 'restriction' ? 'Restriction' : 'Gibson / HR';
          const updatedLabel = formatStoredBackboneDate(backbone?.updatedAt);
          const metaParts = [
            `${Math.max(0, Number(backbone?.backboneLength) || 0).toLocaleString()} bp backbone`,
            Math.max(0, Number(backbone?.insertLength) || 0)
              ? `${Math.max(0, Number(backbone?.insertLength) || 0).toLocaleString()} bp prior insert`
              : '',
            cleanText(backbone?.sourceKind, 120) === 'library_entry'
              ? `${Math.max(0, Number(backbone?.featureCount) || 0).toLocaleString()} feature${Math.max(0, Number(backbone?.featureCount) || 0) === 1 ? '' : 's'}`
              : '',
            variantLabel,
            updatedLabel ? `Updated ${updatedLabel}` : ''
          ].filter(Boolean);
          const noteParts = [
            cleanText(backbone?.sourceKind, 120) === 'library_entry'
              ? 'Saved Sequence Library entry'
              : 'Recognized Protein Builder backbone',
            cleanText(backbone?.sourceRecordName, 160) ? `Source: ${cleanText(backbone?.sourceRecordName, 160)}` : '',
            cleanText(backbone?.promoterName, 160) ? `Promoter: ${cleanText(backbone?.promoterName, 160)}` : ''
          ].filter(Boolean);
          return `
            <button
              type="button"
              class="sequence-viewer-backbone-dialog-candidate${isActive ? ' sequence-viewer-backbone-dialog-candidate-active' : ''}"
              data-protein-builder-backbone-id="${escapeAttribute(backbone?.id || '')}"
            >
              <span class="sequence-viewer-backbone-dialog-candidate-name">${escapeHtml(buildStoredBackboneDisplayName(backbone))}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-meta">${escapeHtml(metaParts.join(' | '))}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-note">${escapeHtml(noteParts.join(' | ') || 'Stored Protein Builder backbone.')}</span>
            </button>
          `;
        }).join('');
      }
    }

    if (elements.proteinBuilderAssemblySummary) {
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        elements.proteinBuilderAssemblySummary.innerHTML = '<p class="small-note">Build the current DNA sequence before assembling a plasmid.</p>';
      } else if (!selectedBackbone) {
        elements.proteinBuilderAssemblySummary.innerHTML = '<p class="small-note">Choose a stored backbone to preview the assembled plasmid length.</p>';
      } else {
        const totalLength = Math.max(0, Number(selectedBackbone?.backboneLength) || 0) + Math.max(0, Number(state.dnaConstruct.length) || 0);
        const notes = Array.isArray(state.dnaConstruct?.notes) ? state.dnaConstruct.notes.filter(Boolean) : [];
        elements.proteinBuilderAssemblySummary.innerHTML = [
          `<p><strong>Construct:</strong> ${escapeHtml(constructName)}</p>`,
          `<p><strong>Stored Backbone:</strong> ${escapeHtml(buildStoredBackboneDisplayName(selectedBackbone))}</p>`,
          `<p><strong>Backbone DNA:</strong> ${Math.max(0, Number(selectedBackbone?.backboneLength) || 0).toLocaleString()} bp</p>`,
          `<p><strong>Current Insert DNA:</strong> ${Math.max(0, Number(state.dnaConstruct.length) || 0).toLocaleString()} bp</p>`,
          `<p><strong>Estimated Circular Plasmid:</strong> ${totalLength.toLocaleString()} bp</p>`,
          cleanText(selectedBackbone?.sourceRecordName, 160)
            ? `<p><strong>Stored From:</strong> ${escapeHtml(cleanText(selectedBackbone.sourceRecordName, 160))}</p>`
            : '',
          cleanText(selectedBackbone?.promoterName, 160)
            ? `<p><strong>Promoter:</strong> ${escapeHtml(cleanText(selectedBackbone.promoterName, 160))}</p>`
            : '',
          notes.length
            ? `<p><strong>DNA Build Notes:</strong> ${escapeHtml(notes.join(' | '))}</p>`
            : ''
        ].filter(Boolean).join('');
      }
    }

    if (elements.proteinBuilderAssemblyApplyBtn) {
      elements.proteinBuilderAssemblyApplyBtn.hidden = !canAdvanceToReview;
      elements.proteinBuilderAssemblyApplyBtn.disabled = state.isLoadingAssemblyBackbones
        || state.isPreparingAssembly
        || !canAdvanceToReview;
    }
  }

  async function openAssemblyDialog() {
    if (!hasStoragePath()) {
      setBuilderStatus('Set Storage Folder Path in Settings before assembling a plasmid.', true);
      return;
    }

    if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
      buildCurrentDnaSequence();
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        return;
      }
    }

    state.assemblyDialogOpen = true;
    state.isLoadingAssemblyBackbones = true;
    renderAssemblyDialog();

    try {
      state.storedBackbones = await loadStoredBackboneCandidates();
      state.selectedBackboneId = cleanText(state.storedBackbones[0]?.id, 400);
      renderAssemblyDialog();
      if (state.storedBackbones.length) {
        setBuilderStatus('Select a stored backbone to assemble the plasmid.');
      } else {
        setBuilderStatus('No stored backbones found. Use Recognize Backbone/Insert on a vector and Apply Selection first.');
      }
    } catch (error) {
      state.storedBackbones = [];
      state.selectedBackboneId = '';
      setBuilderStatus(error?.message || 'Failed to load stored backbones.', true);
    } finally {
      state.isLoadingAssemblyBackbones = false;
      renderAssemblyDialog();
      syncFeatureSearchControls();
    }
  }

  async function assembleWithStoredBackbone() {
    const selectedBackbone = getSelectedStoredBackbone();
    if (!selectedBackbone) {
      setBuilderStatus('Choose a stored backbone before assembling the plasmid.', true);
      return;
    }
    if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
      buildCurrentDnaSequence();
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        return;
      }
    }

    try {
      state.isPreparingAssembly = true;
      renderAssemblyDialog();
      syncFeatureSearchControls();
      setBuilderStatus(`Loading ${buildStoredBackboneDisplayName(selectedBackbone)}...`);
      const hydratedBackbone = await hydrateStoredBackbone(selectedBackbone);
      const constructName = cleanText(elements.proteinBuilderNameInput?.value, 140) || 'Protein Builder Insert';
      const payload = buildAssembledPlasmidPayload(hydratedBackbone, state.dnaConstruct, {
        constructName
      });
      if (!payload?.sequence) {
        setBuilderStatus('Unable to assemble the plasmid from the selected backbone.', true);
        return;
      }

      let cloningNotebookResult = null;
      let notebookWarning = '';
      try {
        cloningNotebookResult = createProteinBuilderCloningNotebookPage({
          state: appState,
          persist,
          createId,
          onNotebookEntriesChanged,
          constructName,
          backbone: hydratedBackbone,
          dnaConstruct: state.dnaConstruct,
          assembledRecord: payload
        });
      } catch (error) {
        notebookWarning = error?.message || 'Failed to create the cloning notebook page.';
      }

      const reviewConfirmation = buildProteinBuilderConfirmationPayload({
        assembledRecord: payload,
        constructName,
        backbone: hydratedBackbone,
        dnaConstruct: state.dnaConstruct,
        notebookEntry: cloningNotebookResult?.entry || null
      });
      const backboneDisplayName = buildStoredBackboneDisplayName(hydratedBackbone);
      closeAssemblyDialog();
      loadExternalRecord(payload, {
        proteinBuilderConfirmation: reviewConfirmation
      });
      if (cloningNotebookResult?.entry) {
        const primerCount = Math.max(
          0,
          Number(cloningNotebookResult?.entry?.proteinBuilderCloningDesign?.primerCount) || 0
        );
        const notebookTitle = cleanText(cloningNotebookResult.entry.experimentName, 220)
          || cloningNotebookResult.entry.protocolName;
        setBuilderStatus(`Created notebook page "${notebookTitle}" with PCR program and ${primerCount} primer${primerCount === 1 ? '' : 's'}.`);
        setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct. Notebook page "${notebookTitle}" has the PCR program and primer table.`);
        return;
      }
      if (notebookWarning) {
        setBuilderStatus(`Construct review opened, but notebook page was not saved: ${notebookWarning}`, true);
        setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct. Notebook page was not saved: ${notebookWarning}`, true);
        return;
      }
      setBuilderStatus(`Opened construct review for ${backboneDisplayName}.`);
      setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct.`);
    } catch (error) {
      setBuilderStatus(error?.message || 'Unable to assemble the plasmid from the selected backbone.', true);
      setStatus(error?.message || 'Unable to assemble the plasmid from the selected backbone.', true);
    } finally {
      state.isPreparingAssembly = false;
      renderAssemblyDialog();
      syncFeatureSearchControls();
    }
  }

  function renderCommonGroup(group) {
    const itemsMarkup = group.items.map((item) => `
      <button
        type="button"
        class="sequence-viewer-protein-builder-common-item"
        data-protein-builder-add-library-type="${escapeAttribute(group.id)}"
        data-protein-builder-add-library-id="${escapeAttribute(item.id)}"
      >
        <span class="sequence-viewer-protein-builder-common-item-name">${escapeHtml(item.label)}</span>
        <span class="sequence-viewer-protein-builder-common-item-meta">${escapeHtml(`${item.sequence.length} aa`)}</span>
      </button>
    `).join('');

    if (group.id === 'tag' || group.id === 'linker') {
      return `
        <details class="sequence-viewer-protein-builder-common-fold">
          <summary>
            <span>${escapeHtml(group.label)}</span>
            <span class="sequence-viewer-protein-builder-common-fold-meta">${escapeHtml(formatCount(group.items.length, 'block'))}</span>
          </summary>
          <div class="sequence-viewer-protein-builder-common-list">
            ${itemsMarkup}
          </div>
        </details>
      `;
    }

    return `
      <section class="sequence-viewer-protein-builder-common-group">
        <h5>${escapeHtml(group.label)}</h5>
        <div class="sequence-viewer-protein-builder-common-list">
          ${itemsMarkup}
        </div>
      </section>
    `;
  }

  function renderCommonBlocks() {
    if (!elements.proteinBuilderCommonBlocks) {
      return;
    }
    elements.proteinBuilderCommonBlocks.innerHTML = COMMON_BLOCK_GROUPS.map((group) => renderCommonGroup(group)).join('');
  }

  function renderFeatureSearchResults() {
    if (!elements.proteinBuilderFeatureSearchResults) {
      return;
    }

    const query = cleanText(state.featureSearchQuery, 600);
    const results = Array.isArray(state.featureSearchResults) ? state.featureSearchResults : [];
    if (!query) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = '<p class="small-note">Search by feature name or stored sequence.</p>';
      return;
    }
    if (!results.length) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(query)}".</p>`;
      return;
    }

    elements.proteinBuilderFeatureSearchResults.innerHTML = results.map((feature) => {
      const meta = buildFeatureResultMeta(feature);
      return `
        <article class="sequence-viewer-protein-builder-feature-item">
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(feature?.name || 'feature')}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${escapeHtml(meta.lengthText)} | ${escapeHtml(meta.hostText)}</p>
            </div>
            <button
              type="button"
              class="ghost-btn"
              data-protein-builder-feature-add-id="${escapeAttribute(feature?.id || '')}"
            >
              Add Block
            </button>
          </div>
          <p class="sequence-viewer-protein-builder-feature-sequence">${escapeHtml(previewSequence(meta.sequence || feature?.sequence || ''))}</p>
          ${meta.warnings.length
            ? `<p class="small-note">${escapeHtml(meta.warnings.join(' | '))}</p>`
            : ''}
        </article>
      `;
    }).join('');
  }

  function renderWorkflow() {
    if (!elements.proteinBuilderWorkflow) {
      return;
    }

    const poiName = cleanText(elements.proteinBuilderPoiNameInput?.value, 140) || 'Protein of Interest';
    const poiSequence = sanitizeProteinAssemblySequence(elements.proteinBuilderPoiSequenceInput?.value || '', true);

    if (!state.rows.length) {
      elements.proteinBuilderWorkflow.innerHTML = '<p class="small-note">Add a block to start the chain.</p>';
      return;
    }

    elements.proteinBuilderWorkflow.innerHTML = state.rows.map((row, index) => {
      const label = row.type === 'poi' ? poiName : row.label;
      const sequence = row.type === 'poi' ? poiSequence : sanitizeProteinAssemblySequence(row.sequence || '', true);
      const note = row.type === 'poi'
        ? `Uses the POI sequence from the left column. ${sequence.length ? `${sequence.length} aa.` : 'Sequence required.'}`
        : (row.note || 'No annotation.');
      const blockTitle = [
        getBlockTypeLabel(row.type),
        `${sequence.length} aa`,
        note
      ].filter(Boolean).join(' | ');

      const customFields = row.kind === 'custom'
        ? `
          <div class="sequence-viewer-protein-builder-custom-fields">
            <label>
              Label
              <input
                type="text"
                value="${escapeAttribute(row.label)}"
                data-protein-builder-custom-label="${escapeAttribute(row.id)}"
              />
            </label>
            <label>
              Sequence
              <input
                type="text"
                value="${escapeAttribute(row.sequence)}"
                data-protein-builder-custom-sequence="${escapeAttribute(row.id)}"
                placeholder="Amino-acid sequence"
              />
            </label>
          </div>
        `
        : '';

      const connector = index > 0
        ? '<div class="sequence-viewer-protein-builder-link" aria-hidden="true"><span></span></div>'
        : '';
      const canMoveLeft = index > 0;
      const canMoveRight = index < state.rows.length - 1;

      return `
        ${connector}
        <article class="sequence-viewer-protein-builder-block sequence-viewer-protein-builder-block-${escapeAttribute(row.type)}" data-protein-builder-row-id="${escapeAttribute(row.id)}">
          <div
            class="sequence-viewer-protein-builder-block-shape"
            title="${escapeAttribute(blockTitle)}"
          >
            <span class="sequence-viewer-protein-builder-block-label">${escapeHtml(label || `Block ${index + 1}`)}</span>
          </div>
          <div class="form-actions sequence-viewer-protein-builder-block-actions">
            ${canMoveLeft ? `
              <button
                type="button"
                class="ghost-btn sequence-viewer-protein-builder-icon-btn"
                data-protein-builder-row-up="${escapeAttribute(row.id)}"
                aria-label="Move block left"
                title="Move block left"
              >
                <span aria-hidden="true">&larr;</span>
                <span class="sr-only">Move block left</span>
              </button>
            ` : ''}
            ${canMoveRight ? `
              <button
                type="button"
                class="ghost-btn sequence-viewer-protein-builder-icon-btn"
                data-protein-builder-row-down="${escapeAttribute(row.id)}"
                aria-label="Move block right"
                title="Move block right"
              >
                <span aria-hidden="true">&rarr;</span>
                <span class="sr-only">Move block right</span>
              </button>
            ` : ''}
            <button
              type="button"
              class="ghost-btn sequence-viewer-protein-builder-icon-btn sequence-viewer-protein-builder-icon-btn-remove"
              data-protein-builder-row-remove="${escapeAttribute(row.id)}"
              aria-label="Remove block"
              title="Remove block"
            >
              <span aria-hidden="true">&times;</span>
              <span class="sr-only">Remove block</span>
            </button>
          </div>
          ${customFields}
        </article>
      `;
    }).join('');
  }

  function renderSummary() {
    const construct = buildConstruct({
      constructName: elements.proteinBuilderNameInput?.value,
      poiName: elements.proteinBuilderPoiNameInput?.value,
      poiSequence: elements.proteinBuilderPoiSequenceInput?.value,
      rows: currentRows()
    });

    if (elements.proteinBuilderMeta) {
      elements.proteinBuilderMeta.textContent = `${construct.length} aa | ${construct.parts.length} blocks`;
    }

    if (elements.proteinBuilderSequence) {
      elements.proteinBuilderSequence.innerHTML = construct.sequence
        ? `<span class="sequence-viewer-protein-builder-sequence-text">${escapeHtml(construct.sequence)}</span>`
        : '-';
    }
  }

  function buildCurrentDnaSequence() {
    const payload = {
      constructName: elements.proteinBuilderNameInput?.value,
      poiName: elements.proteinBuilderPoiNameInput?.value,
      poiSequence: elements.proteinBuilderPoiSequenceInput?.value,
      rows: currentRows()
    };
    const dnaConstruct = buildDnaConstruct(payload, {
      record: getSelectedRecord(),
      selectedFeature: getSelectedFeature()
    });
    state.dnaConstruct = {
      ...dnaConstruct,
      contextKey: getDnaBuildContextKey()
    };
    renderDnaConstruct();

    if (!state.dnaConstruct.ok) {
      const failure = state.dnaConstruct.errors[0]
        || state.dnaConstruct.warnings[0]
        || 'Unable to build a DNA sequence from the current chain.';
      setBuilderStatus(failure, true);
      return state.dnaConstruct;
    }

    const noteText = state.dnaConstruct.notes.length ? ` ${state.dnaConstruct.notes.join(' ')}` : '';
    setBuilderStatus(`Built ${state.dnaConstruct.length} nt DNA sequence from the current protein chain.${noteText}`);
    return state.dnaConstruct;
  }

  function moveRow(rowId, direction) {
    const index = state.rows.findIndex((row) => row.id === rowId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === 'up'
      ? index - 1
      : index + 1;
    if (targetIndex < 0 || targetIndex >= state.rows.length) {
      return;
    }
    const [row] = state.rows.splice(index, 1);
    state.rows.splice(targetIndex, 0, row);
    invalidateDnaConstruct();
  }

  function removeRow(rowId) {
    state.rows = state.rows.filter((row) => row.id !== rowId);
    invalidateDnaConstruct();
  }

  function addPoiRow() {
    if (state.rows.some((row) => row.type === 'poi')) {
      setBuilderStatus('POI block already exists in the chain.');
      return;
    }
    appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
    invalidateDnaConstruct();
    render();
  }

  function addCustomRow() {
    appendRow(createCustomRow(state.nextRowId++));
    invalidateDnaConstruct();
    render();
  }

  function addLibraryRow(type, libraryId) {
    const row = cloneLibraryRow(state.nextRowId++, type, libraryId);
    if (!row) {
      return;
    }
    appendRow(row);
    invalidateDnaConstruct();
    render();
  }

  function addFeatureRowById(featureId) {
    const feature = (state.featureSearchResults || []).find((item) => cleanText(item?.id, 200) === cleanText(featureId, 200));
    if (!feature) {
      return;
    }
    appendRow(createFeatureRow(state.nextRowId++, feature));
    invalidateDnaConstruct();
    render();
  }

  async function runFeatureSearch(options = {}) {
    const query = cleanText(options?.query ?? elements.proteinBuilderFeatureSearchInput?.value, 600);
    state.featureSearchQuery = query;
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.value = query;
    }

    const storagePath = getStoragePath();
    if (!storagePath) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }

    if (query.length < 2) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Enter at least 2 characters to search stored features.');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibrarySearchFeatures) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Feature search API unavailable.', true);
      return;
    }

    state.isSearchingFeatures = true;
    syncFeatureSearchControls();
    setFeatureSearchStatus(`Searching for "${query}"...`);

    try {
      const response = await bridge.sequenceLibrarySearchFeatures({
        storagePath,
        query,
        limit: 24
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to search stored features.');
      }

      state.featureSearchResults = Array.isArray(response.results) ? response.results : [];
      renderFeatureSearchResults();
      setFeatureSearchStatus(`Found ${state.featureSearchResults.length} matching feature${state.featureSearchResults.length === 1 ? '' : 's'}.`);
    } catch (error) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus(error?.message || 'Failed to search stored features.', true);
    } finally {
      state.isSearchingFeatures = false;
      syncFeatureSearchControls();
    }
  }

  function render() {
    renderCommonBlocks();
    renderFeatureSearchResults();
    renderWorkflow();
    renderSummary();
    renderDnaConstruct();
    renderAssemblyDialog();
    syncFeatureSearchControls();
    if (!state.featureSearchQuery) {
      setFeatureSearchStatus(
        hasStoragePath()
          ? 'Search stored features and convert them into protein blocks.'
          : 'Set Storage Folder Path in Settings to search stored features.',
        !hasStoragePath()
      );
    }
    setBuilderStatus(state.statusMessage, state.statusError);
  }

  function bindEvents() {
    elements.homeProteinBuilderBtn?.addEventListener('click', () => {
      onNavigateBuilder();
      setStatus('Opened Protein Builder.');
      setBuilderStatus('Protein Builder is ready.');
    });

    elements.detailProteinBuilderBtn?.addEventListener('click', () => {
      onNavigateBuilder();
      setStatus('Opened Protein Builder.');
      setBuilderStatus('Protein Builder is ready.');
    });

    elements.proteinBuilderBackBtn?.addEventListener('click', () => {
      onNavigateHome();
      setBuilderStatus('Returned to Sequence Library.');
    });

    elements.proteinBuilderResetBtn?.addEventListener('click', () => {
      resetRows();
      setBuilderStatus('Reset the chain to the default layout.');
      render();
    });

    elements.proteinBuilderAddCustomBtn?.addEventListener('click', () => {
      addCustomRow();
      setBuilderStatus('Added a custom block.');
    });

    elements.proteinBuilderAddPoiBtn?.addEventListener('click', () => {
      addPoiRow();
    });

    elements.proteinBuilderForm?.addEventListener('input', (event) => {
      const targetId = cleanText(event?.target?.id, 120);
      if (targetId === 'sequence-viewer-protein-builder-poi-sequence') {
        invalidateDnaConstruct();
      }
      render();
    });

    elements.proteinBuilderBuildDnaBtn?.addEventListener('click', () => {
      buildCurrentDnaSequence();
    });

    elements.proteinBuilderAssembleBtn?.addEventListener('click', () => {
      void openAssemblyDialog();
    });

    elements.proteinBuilderCommonBlocks?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-add-library-id]');
      const type = cleanText(trigger?.dataset?.proteinBuilderAddLibraryType, 40);
      const libraryId = cleanText(trigger?.dataset?.proteinBuilderAddLibraryId, 120);
      if (!type || !libraryId) {
        return;
      }
      addLibraryRow(type, libraryId);
      setBuilderStatus(`Added ${libraryId} to the chain.`);
    });

    elements.proteinBuilderFeatureSearchBtn?.addEventListener('click', () => {
      void runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchInput?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault?.();
      void runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchResults?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-add-id]');
      const featureId = cleanText(trigger?.dataset?.proteinBuilderFeatureAddId, 200);
      if (!featureId) {
        return;
      }
      addFeatureRowById(featureId);
      setBuilderStatus('Added feature-derived block to the chain.');
    });

    elements.proteinBuilderWorkflow?.addEventListener('click', (event) => {
      const removeTrigger = event?.target?.closest?.('[data-protein-builder-row-remove]');
      const upTrigger = event?.target?.closest?.('[data-protein-builder-row-up]');
      const downTrigger = event?.target?.closest?.('[data-protein-builder-row-down]');

      if (removeTrigger?.dataset?.proteinBuilderRowRemove) {
        removeRow(cleanText(removeTrigger.dataset.proteinBuilderRowRemove, 160));
        render();
        return;
      }
      if (upTrigger?.dataset?.proteinBuilderRowUp) {
        moveRow(cleanText(upTrigger.dataset.proteinBuilderRowUp, 160), 'up');
        render();
        return;
      }
      if (downTrigger?.dataset?.proteinBuilderRowDown) {
        moveRow(cleanText(downTrigger.dataset.proteinBuilderRowDown, 160), 'down');
        render();
      }
    });

    elements.proteinBuilderWorkflow?.addEventListener('input', (event) => {
      const customLabelTrigger = event?.target?.closest?.('[data-protein-builder-custom-label]');
      const customSequenceTrigger = event?.target?.closest?.('[data-protein-builder-custom-sequence]');

      if (customLabelTrigger?.dataset?.proteinBuilderCustomLabel) {
        const rowId = cleanText(customLabelTrigger.dataset.proteinBuilderCustomLabel, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.label = cleanText(customLabelTrigger.value, 160) || 'Custom Block';
        }
        render();
        return;
      }

      if (customSequenceTrigger?.dataset?.proteinBuilderCustomSequence) {
        const rowId = cleanText(customSequenceTrigger.dataset.proteinBuilderCustomSequence, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.sequence = sanitizeProteinAssemblySequence(customSequenceTrigger.value, true);
          invalidateDnaConstruct();
        }
        render();
      }
    });

    elements.proteinBuilderAssemblyList?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-backbone-id]');
      const backboneId = cleanText(trigger?.dataset?.proteinBuilderBackboneId, 400);
      if (!backboneId) {
        return;
      }
      state.selectedBackboneId = backboneId;
      renderAssemblyDialog();
    });

    elements.proteinBuilderAssemblyApplyBtn?.addEventListener('click', () => {
      void assembleWithStoredBackbone();
    });

    elements.proteinBuilderAssemblyCloseBtn?.addEventListener('click', () => {
      closeAssemblyDialog();
    });

    elements.proteinBuilderAssemblyCancelBtn?.addEventListener('click', () => {
      closeAssemblyDialog();
    });

    elements.proteinBuilderAssemblyOverlay?.addEventListener('click', (event) => {
      if (event?.target !== elements.proteinBuilderAssemblyOverlay) {
        return;
      }
      closeAssemblyDialog();
    });
  }

  resetRows();
  render();

  return {
    bindEvents,
    render
  };
}
