'use strict';

const {
  MIN_DNA_ANNOTATION_FEATURE_LENGTH,
  MIN_PROTEIN_ANNOTATION_AA_LENGTH
} = require('./constants');
const { readRows } = require('./database');
const {
  cleanText,
  normalizeName,
  normalizeSequenceText,
  normalizeStatus
} = require('./utils');
const { normalizeProteinSequence } = require('./protein-utils');

function appendHostToMap(hostMap, row) {
  if (!hostMap || !(hostMap instanceof Map)) {
    return;
  }

  const hostVectorId = cleanText(row?.host_vector_id, 200);
  if (!hostVectorId) {
    return;
  }
  if (!hostMap.has(hostVectorId)) {
    hostMap.set(hostVectorId, {
      hostVectorId,
      hostVectorName: cleanText(row?.host_vector_name, 140),
      hostVectorStatus: normalizeStatus(row?.host_vector_status)
    });
  }
}

function shouldSkipAnnotationFeatureName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
  return normalized === 'misc_feature' || normalized.startsWith('misc_feature_');
}

function buildDnaAnnotationCandidates(db, queryLength, excludeEntryId = '') {
  const rows = readRows(
    db,
    `SELECT f.id, f.name, f.feature_type, f.sequence, f.sequence_length, f.updated_at,
            o.host_vector_id, o.host_vector_name, o.host_vector_status
     FROM sequence_features f
     JOIN sequence_feature_occurrences o ON o.feature_id = f.id
     WHERE lower(f.feature_type) <> 'cds'
       AND f.sequence_length >= ?
       AND f.sequence_length <= ?
       AND lower(COALESCE(o.annotation_source, '')) NOT LIKE 'sql_annotation_%'
       AND (? = '' OR o.host_vector_id <> ?)
     ORDER BY f.sequence_length DESC, f.updated_at DESC, f.name COLLATE NOCASE ASC`,
    [MIN_DNA_ANNOTATION_FEATURE_LENGTH, Math.max(0, Number(queryLength) || 0), cleanText(excludeEntryId, 200), cleanText(excludeEntryId, 200)]
  );

  const byFeatureId = new Map();
  rows.forEach((row) => appendDnaCandidate(byFeatureId, row));
  return [...byFeatureId.values()]
    .map((candidate) => ({ ...candidate, hosts: [...candidate.hosts.values()] }))
    .sort((left, right) => (right.sequenceLength - left.sequenceLength) || String(left.name || '').localeCompare(String(right.name || '')));
}

function appendDnaCandidate(byFeatureId, row) {
  const featureId = cleanText(row?.id, 200);
  const sequence = normalizeSequenceText(row?.sequence);
  if (!featureId || !sequence || shouldSkipAnnotationFeatureName(row?.name)) {
    return;
  }

  let candidate = byFeatureId.get(featureId);
  if (!candidate) {
    candidate = {
      featureId,
      name: normalizeName(row?.name || 'feature', 'feature'),
      type: cleanText(row?.feature_type, 120).toLowerCase() || 'misc_feature',
      matchedSequence: sequence,
      sequenceLength: Math.max(0, Number(row?.sequence_length) || sequence.length),
      hosts: new Map()
    };
    byFeatureId.set(featureId, candidate);
  }
  appendHostToMap(candidate.hosts, row);
}

function buildProteinAnnotationGroups(db, querySequence, excludeEntryId = '') {
  const rows = readRows(
    db,
    `SELECT f.id, f.name, f.feature_type,
            cds.dna_sequence, cds.dna_length, cds.amino_acid_sequence, cds.amino_acid_length,
            o.host_vector_id, o.host_vector_name, o.host_vector_status
     FROM sequence_feature_cds_sequences cds
     JOIN sequence_features f ON f.id = cds.feature_id
     JOIN sequence_feature_occurrences o ON o.feature_id = f.id
     WHERE cds.amino_acid_length >= ?
       AND cds.amino_acid_length <= ?
       AND lower(COALESCE(o.annotation_source, '')) NOT LIKE 'sql_annotation_%'
       AND (? = '' OR o.host_vector_id <> ?)
     ORDER BY cds.amino_acid_length DESC, f.updated_at DESC, f.name COLLATE NOCASE ASC`,
    [
      MIN_PROTEIN_ANNOTATION_AA_LENGTH,
      Math.max(0, Math.floor((normalizeSequenceText(querySequence).length || 0) / 3)),
      cleanText(excludeEntryId, 200),
      cleanText(excludeEntryId, 200)
    ]
  );

  const groupsByProtein = new Map();
  rows.forEach((row) => appendProteinGroup(groupsByProtein, row));
  return groupsByProtein;
}

function appendProteinGroup(groupsByProtein, row) {
  const proteinSequence = normalizeProteinSequence(row?.amino_acid_sequence);
  if (!proteinSequence || shouldSkipAnnotationFeatureName(row?.name)) {
    return;
  }

  const groupKey = `${normalizeName(row?.name || 'cds', 'cds')}\n${cleanText(row?.feature_type, 120).toLowerCase() || 'cds'}`;
  let grouped = groupsByProtein.get(proteinSequence);
  if (!grouped) {
    grouped = new Map();
    groupsByProtein.set(proteinSequence, grouped);
  }

  if (!grouped.has(groupKey)) {
    grouped.set(groupKey, {
      name: normalizeName(row?.name || 'cds', 'cds'),
      type: cleanText(row?.feature_type, 120).toLowerCase() || 'cds',
      proteinSequence,
      dnaSequence: normalizeSequenceText(row?.dna_sequence),
      hosts: new Map()
    });
  }
  appendHostToMap(grouped.get(groupKey).hosts, row);
}

module.exports = {
  buildDnaAnnotationCandidates,
  buildProteinAnnotationGroups
};
