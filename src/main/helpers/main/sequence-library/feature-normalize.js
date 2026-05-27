'use strict';

const crypto = require('crypto');
const {
  FEATURE_SOURCE_BACKBONE_RECOGNITION,
  FEATURE_SOURCE_SQL_ANNOTATION_DNA,
  FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN
} = require('./constants');
const {
  buildStableId,
  clamp,
  cleanText,
  normalizeName,
  normalizeSequenceText,
  normalizeStatus,
  reverseComplementIupac
} = require('./utils');
const { resolveFeatureProteinPayload } = require('./protein-utils');

function normalizeFeatureSegments(rawSegments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength) {
    return [];
  }
  return (Array.isArray(rawSegments) ? rawSegments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (left.start - right.start) || (left.end - right.end));
}

function normalizeFeaturePayload(feature, sequenceLength, index = 0) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const source = cleanText(feature?.source || feature?.mode || '', 120).toLowerCase();
  if (
    source === FEATURE_SOURCE_BACKBONE_RECOGNITION
    || source === FEATURE_SOURCE_SQL_ANNOTATION_DNA
    || source === FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN
  ) {
    return null;
  }

  const strand = Number(feature?.strand) === -1 ? -1 : 1;
  const segments = normalizeFeatureSegments(feature?.segments, sequenceLength);
  if (!segments.length) {
    return null;
  }
  return {
    name: normalizeName(feature?.name || feature?.label || `feature_${index + 1}`, `feature_${index + 1}`),
    type: cleanText(feature?.type || 'misc_feature', 120).toLowerCase() || 'misc_feature',
    translation: normalizeProteinSequenceForPayload(feature),
    strand,
    source,
    segments
  };
}

function normalizeProteinSequenceForPayload(feature) {
  return require('./protein-utils').normalizeProteinSequence(feature?.translation || feature?.proteinSequence || '');
}

function extractFeatureSequence(sequence, feature) {
  const text = normalizeSequenceText(sequence);
  if (!text.length || !feature) {
    return '';
  }

  const orderedSegments = normalizeFeatureSegments(feature.segments, text.length);
  if (!orderedSegments.length) {
    return '';
  }
  const raw = orderedSegments.map((segment) => text.slice(segment.start, segment.end)).join('');
  return feature.strand === -1 ? reverseComplementIupac(raw) : raw;
}

function buildFeatureDedupeKey(name, type, sequence) {
  return crypto
    .createHash('sha1')
    .update(`${String(name || '').toLowerCase()}\n${String(type || '').toLowerCase()}\n${String(sequence || '')}`)
    .digest('hex');
}

function extractFeatureBounds(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) {
    return { startPos: 1, endPos: 0 };
  }
  const minStart = list.reduce((min, segment) => Math.min(min, Number(segment?.start) || 0), Number.POSITIVE_INFINITY);
  const maxEnd = list.reduce((max, segment) => Math.max(max, Number(segment?.end) || 0), 0);
  return {
    startPos: Math.max(1, minStart + 1),
    endPos: Math.max(0, maxEnd)
  };
}

function normalizeFeatureOccurrenceRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    id: cleanText(row.id, 200),
    featureId: cleanText(row.feature_id, 200),
    hostVectorId: cleanText(row.host_vector_id, 200),
    hostVectorName: cleanText(row.host_vector_name, 140),
    hostVectorStatus: normalizeStatus(row.host_vector_status),
    topology: cleanText(row.host_topology, 40) || 'linear',
    sequenceLength: Math.max(0, Number(row.host_sequence_length) || 0),
    sourceFormat: cleanText(row.source_format, 80),
    annotationSource: cleanText(row.annotation_source, 120),
    strand: Number(row.strand) === -1 ? -1 : 1,
    startPos: Math.max(1, Number(row.start_pos) || 1),
    endPos: Math.max(0, Number(row.end_pos) || 0),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}

function buildFeatureOccurrenceIds(entryRow, feature, featureSequence) {
  const hostVectorId = cleanText(entryRow?.id, 200);
  const dedupeKey = buildFeatureDedupeKey(feature.name, feature.type, featureSequence);
  const featureId = buildStableId('feature', dedupeKey);
  const bounds = extractFeatureBounds(feature.segments);
  const occurrenceId = buildStableId(
    'feature_occurrence',
    [featureId, hostVectorId, bounds.startPos, bounds.endPos, feature.strand, feature.source].join('|')
  );
  return { bounds, dedupeKey, featureId, hostVectorId, occurrenceId };
}

function buildFeatureWritePayload(entryRow, feature, sequence) {
  const featureSequence = extractFeatureSequence(sequence, feature);
  if (!featureSequence) {
    return null;
  }
  return {
    ...buildFeatureOccurrenceIds(entryRow, feature, featureSequence),
    featureSequence,
    proteinPayload: resolveFeatureProteinPayload(feature, featureSequence)
  };
}

module.exports = {
  buildFeatureWritePayload,
  normalizeFeatureOccurrenceRow,
  normalizeFeaturePayload,
  normalizeFeatureSegments
};
