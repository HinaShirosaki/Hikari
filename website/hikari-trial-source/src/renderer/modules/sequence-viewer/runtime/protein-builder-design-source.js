import {
  cleanText,
  clamp,
  normalizeSequenceText
} from '../shared.js';

export function normalizeProteinBuilderCloningDesignSource(source) {
  const safeSource = source && typeof source === 'object' ? source : null;
  if (!safeSource) {
    return null;
  }

  const backbone = safeSource.backbone && typeof safeSource.backbone === 'object'
    ? { ...safeSource.backbone }
    : {};
  const dnaConstruct = safeSource.dnaConstruct && typeof safeSource.dnaConstruct === 'object'
    ? { ...safeSource.dnaConstruct }
    : {};
  const assembledRecord = safeSource.assembledRecord && typeof safeSource.assembledRecord === 'object'
    ? { ...safeSource.assembledRecord }
    : {};
  const backboneSequence = normalizeSequenceText(backbone.backboneSequence || '');
  const insertSequence = normalizeSequenceText(dnaConstruct.sequence || '');
  const assembledSequence = normalizeSequenceText(assembledRecord.sequence || '');
  if (!backboneSequence && !insertSequence && !assembledSequence) {
    return null;
  }

  return {
    constructName: cleanText(safeSource.constructName, 160),
    backbone: { ...backbone, backboneSequence },
    dnaConstruct: {
      ...dnaConstruct,
      sequence: insertSequence,
      length: Math.max(0, Number(dnaConstruct.length || insertSequence.length) || 0),
      parts: Array.isArray(dnaConstruct.parts) ? dnaConstruct.parts.map((part) => ({ ...part })) : []
    },
    assembledRecord: {
      ...assembledRecord,
      sequence: assembledSequence,
      features: cloneFeatureList(assembledRecord.features)
    }
  };
}

export function buildCurrentProteinBuilderDesignSource(designSource = {}, assembledRecord = {}) {
  const sourceBackbone = designSource.backbone || {};
  const sourceConstruct = designSource.dnaConstruct || {};
  const insertFeature = findProteinBuilderFeature(assembledRecord, 'insert');
  const backboneFeature = findProteinBuilderFeature(assembledRecord, 'backbone');
  const insertSequence = extractFeatureSequence(assembledRecord, insertFeature);
  const backboneSequence = extractFeatureSequence(assembledRecord, backboneFeature);
  const nextConstruct = insertSequence
    ? {
        ...sourceConstruct,
        sequence: insertSequence,
        length: insertSequence.length,
        parts: Array.isArray(sourceConstruct?.parts)
          ? sourceConstruct.parts.map((part) => ({ ...part }))
          : []
      }
    : sourceConstruct;
  const nextBackbone = backboneSequence
    ? {
        ...sourceBackbone,
        backboneSequence,
        backboneLength: backboneSequence.length,
        insertionOffset: deriveInsertionOffsetFromBackboneFeature(
          backboneFeature,
          normalizeSequenceText(assembledRecord?.sequence || '').length,
          sourceBackbone?.insertionOffset
        )
      }
    : sourceBackbone;
  return {
    backbone: nextBackbone,
    dnaConstruct: nextConstruct
  };
}

function cloneFeatureList(features) {
  return Array.isArray(features)
    ? features.map((feature) => ({
        ...feature,
        segments: Array.isArray(feature?.segments)
          ? feature.segments.map((segment) => ({ ...segment }))
          : []
      }))
    : [];
}

function normalizeFeatureSegmentsForExtraction(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || start), start, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function reverseComplementSequence(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return normalizeSequenceText(sequence || '')
    .split('')
    .reverse()
    .map((base) => complement[base] || '')
    .join('');
}

function extractFeatureSequence(record = {}, feature = {}) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  if (!sequence.length || !feature) {
    return '';
  }
  const segments = normalizeFeatureSegmentsForExtraction(feature?.segments, sequence.length);
  if (!segments.length) {
    return '';
  }
  const extracted = segments.map((segment) => sequence.slice(segment.start, segment.end)).join('');
  return Number(feature?.strand) === -1 ? reverseComplementSequence(extracted) : extracted;
}

function getProteinBuilderFeatureRank(feature = {}, role = '') {
  const normalizedRole = cleanText(role, 80).toLowerCase();
  const id = cleanText(feature?.id, 200).toLowerCase();
  const type = cleanText(feature?.type, 120).toLowerCase();
  const source = cleanText(feature?.source, 120).toLowerCase();
  const name = cleanText(feature?.name, 160).toLowerCase();
  if (id === `protein_builder_${normalizedRole}`) {
    return 0;
  }
  if (source === 'protein_builder' && type === normalizedRole) {
    return 1;
  }
  if (type === normalizedRole && name.includes(`protein builder ${normalizedRole}`)) {
    return 2;
  }
  return type === normalizedRole ? 3 : Number.POSITIVE_INFINITY;
}

function findProteinBuilderFeature(record = {}, role = '') {
  return (Array.isArray(record?.features) ? record.features : [])
    .map((feature) => ({ feature, rank: getProteinBuilderFeatureRank(feature, role) }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      return cleanText(left.feature?.name, 160).localeCompare(cleanText(right.feature?.name, 160));
    })[0]?.feature || null;
}

function deriveInsertionOffsetFromBackboneFeature(feature = {}, sequenceLength = 0, fallbackOffset = 0) {
  const segments = normalizeFeatureSegmentsForExtraction(feature?.segments, sequenceLength);
  if (segments.length > 1) {
    return segments[0].end - segments[0].start;
  }
  return Math.max(0, Math.round(Number(fallbackOffset) || 0));
}
