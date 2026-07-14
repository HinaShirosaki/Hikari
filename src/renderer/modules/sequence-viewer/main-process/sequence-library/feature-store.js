'use strict';

const {
  cleanText,
  normalizeSequenceText,
  normalizeStatus
} = require('./utils');
const {
  buildFeatureWritePayload,
  normalizeFeaturePayload
} = require('./feature-normalize');
const { readRows } = require('./database');
const { translateFeatureSequenceToProtein } = require('./protein-utils');

function rebuildCdsSequenceTable(db) {
  if (!db || typeof db.run !== 'function') {
    return 0;
  }

  let rowsChanged = 0;
  db.run(`
    DELETE FROM sequence_feature_cds_sequences
    WHERE feature_id NOT IN (
      SELECT id FROM sequence_features WHERE lower(feature_type) = 'cds'
    )
  `);
  rowsChanged += Math.max(0, Number(db.getRowsModified?.() || 0));

  readRows(
    db,
    `SELECT id, sequence, created_at, updated_at
     FROM sequence_features
     WHERE lower(feature_type) = 'cds'
     ORDER BY updated_at DESC, name COLLATE NOCASE ASC`
  ).forEach((row) => {
    rowsChanged += upsertCdsSequenceRow(db, row);
  });
  return rowsChanged;
}

function upsertCdsSequenceRow(db, row) {
  const featureId = cleanText(row?.id, 200);
  const dnaSequence = normalizeSequenceText(row?.sequence);
  if (!featureId || !dnaSequence) {
    return 0;
  }

  const createdAt = cleanText(row?.created_at, 60) || new Date().toISOString();
  const updatedAt = cleanText(row?.updated_at, 60) || createdAt;
  const aminoAcidSequence = translateFeatureSequenceToProtein(dnaSequence);
  db.run(
    `INSERT INTO sequence_feature_cds_sequences (
       feature_id, dna_sequence, dna_length, amino_acid_sequence, amino_acid_length, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature_id) DO UPDATE SET
       dna_sequence = excluded.dna_sequence,
       dna_length = excluded.dna_length,
       amino_acid_sequence = excluded.amino_acid_sequence,
       amino_acid_length = excluded.amino_acid_length,
       updated_at = excluded.updated_at`,
    [featureId, dnaSequence, dnaSequence.length, aminoAcidSequence, aminoAcidSequence.length, createdAt, updatedAt]
  );
  return Math.max(0, Number(db.getRowsModified?.() || 0));
}

function deleteOrphanFeatures(db) {
  db.run(`
    DELETE FROM sequence_features
    WHERE id NOT IN (
      SELECT DISTINCT feature_id FROM sequence_feature_occurrences
    )
  `);
}

function replaceFeatureOccurrencesForEntry(db, entryRow, payload = {}) {
  const hostVectorId = cleanText(entryRow?.id, 200);
  if (!hostVectorId) {
    return;
  }

  db.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [hostVectorId]);
  const sequence = normalizeSequenceText(payload.sequence);
  const normalizedFeatures = (Array.isArray(payload.features) ? payload.features : [])
    .map((feature, index) => normalizeFeaturePayload(feature, sequence.length, index))
    .filter(Boolean);

  if (!sequence.length || !normalizedFeatures.length) {
    deleteOrphanFeatures(db);
    rebuildCdsSequenceTable(db);
    return;
  }

  const now = new Date().toISOString();
  normalizedFeatures.forEach((feature) => {
    const writePayload = buildFeatureWritePayload(entryRow, feature, sequence);
    if (writePayload) {
      writeFeatureRows(db, entryRow, feature, writePayload, now);
    }
  });
  deleteOrphanFeatures(db);
  rebuildCdsSequenceTable(db);
}

function writeFeatureRows(db, entryRow, feature, payload, now) {
  db.run(
    `INSERT INTO sequence_features (
       id, name, normalized_name, feature_type, sequence, sequence_length, dedupe_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       feature_type = excluded.feature_type,
       sequence = excluded.sequence,
       sequence_length = excluded.sequence_length,
       updated_at = excluded.updated_at`,
    [payload.featureId, feature.name, feature.name.toLowerCase(), feature.type, payload.featureSequence, payload.featureSequence.length, payload.dedupeKey, now, now]
  );
  writeProteinRow(db, payload, now);
  writeOccurrenceRow(db, entryRow, feature, payload, now);
}

function writeProteinRow(db, payload, now) {
  if (payload.proteinPayload.proteinSequence) {
    db.run(
      `INSERT INTO sequence_feature_proteins (
         feature_id, protein_sequence, protein_length, translation_source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_id) DO UPDATE SET
         protein_sequence = excluded.protein_sequence,
         protein_length = excluded.protein_length,
         translation_source = excluded.translation_source,
         updated_at = excluded.updated_at`,
      [payload.featureId, payload.proteinPayload.proteinSequence, payload.proteinPayload.proteinSequence.length, payload.proteinPayload.translationSource, now, now]
    );
  } else {
    db.run('DELETE FROM sequence_feature_proteins WHERE feature_id = ?', [payload.featureId]);
  }
}

function writeOccurrenceRow(db, entryRow, feature, payload, now) {
  db.run(
    `INSERT INTO sequence_feature_occurrences (
       id, feature_id, host_vector_id, host_vector_name, host_vector_status, host_topology,
       host_sequence_length, source_format, annotation_source, strand, start_pos, end_pos,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       feature_id = excluded.feature_id,
       host_vector_name = excluded.host_vector_name,
       host_vector_status = excluded.host_vector_status,
       host_topology = excluded.host_topology,
       host_sequence_length = excluded.host_sequence_length,
       source_format = excluded.source_format,
       annotation_source = excluded.annotation_source,
       strand = excluded.strand,
       start_pos = excluded.start_pos,
       end_pos = excluded.end_pos,
       updated_at = excluded.updated_at`,
    [
      payload.occurrenceId, payload.featureId, payload.hostVectorId, cleanText(entryRow?.name, 140),
      normalizeStatus(entryRow?.status), cleanText(entryRow?.topology, 40) || 'linear',
      Math.max(0, Number(entryRow?.sequenceLength) || 0), cleanText(entryRow?.sourceFormat, 80),
      feature.source, feature.strand, payload.bounds.startPos, payload.bounds.endPos, now, now
    ]
  );
}

module.exports = {
  deleteOrphanFeatures,
  rebuildCdsSequenceTable,
  replaceFeatureOccurrencesForEntry
};
