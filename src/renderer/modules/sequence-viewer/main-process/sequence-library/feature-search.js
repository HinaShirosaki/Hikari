'use strict';

const { readRows } = require('./database');
const { normalizeFeatureOccurrenceRow } = require('./feature-normalize');
const {
  cleanText,
  normalizeSequenceText
} = require('./utils');

function buildFeatureSearchResult(db, row) {
  const featureId = cleanText(row?.id, 200);
  const occurrenceRows = readRows(
    db,
    `SELECT *
     FROM sequence_feature_occurrences
     WHERE feature_id = ?
     ORDER BY updated_at DESC, host_vector_name COLLATE NOCASE ASC, start_pos ASC`,
    [featureId]
  );

  const hostsById = new Map();
  occurrenceRows.forEach((occurrenceRow) => {
    const occurrence = normalizeFeatureOccurrenceRow(occurrenceRow);
    if (!occurrence) {
      return;
    }
    appendFeatureHost(hostsById, occurrence);
  });

  const hosts = [...hostsById.values()];
  return {
    id: featureId,
    name: cleanText(row?.name, 140),
    normalizedName: cleanText(row?.normalized_name, 200),
    type: cleanText(row?.feature_type, 120),
    sequence: normalizeSequenceText(row?.sequence),
    sequenceLength: Math.max(0, Number(row?.sequence_length) || 0),
    hostCount: hosts.length,
    updatedAt: cleanText(row?.updated_at, 60),
    hosts
  };
}

function appendFeatureHost(hostsById, occurrence) {
  const key = occurrence.hostVectorId;
  if (!hostsById.has(key)) {
    hostsById.set(key, {
      hostVectorId: occurrence.hostVectorId,
      hostVectorName: occurrence.hostVectorName,
      hostVectorStatus: occurrence.hostVectorStatus,
      topology: occurrence.topology,
      sequenceLength: occurrence.sequenceLength,
      sourceFormat: occurrence.sourceFormat,
      updatedAt: occurrence.updatedAt,
      locations: []
    });
  }

  hostsById.get(key).locations.push({
    startPos: occurrence.startPos,
    endPos: occurrence.endPos,
    strand: occurrence.strand,
    annotationSource: occurrence.annotationSource
  });
}

module.exports = { buildFeatureSearchResult };
