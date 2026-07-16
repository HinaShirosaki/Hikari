'use strict';

const { openDatabase, readRows } = require('./database');
const { ensureLibraryDirectories, resolveLibraryPaths } = require('./paths');
const { buildFeatureSearchResult } = require('./feature-search');
const {
  buildDnaAnnotationMatches,
  buildProteinAnnotationMatches
} = require('./annotation-matches');
const {
  clamp,
  cleanText,
  normalizeSequenceText,
  normalizeTopologyValue
} = require('./utils');

async function annotateSequenceRecord({ storagePath, sequence = '', topology = 'linear', excludeEntryId = '' }) {
  const normalizedQuery = normalizeSequenceText(sequence);
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    if (!normalizedQuery.length) {
      return {
        queryLength: 0,
        topology: normalizeTopologyValue(topology),
        dnaMatches: [],
        proteinMatches: [],
        totalMatches: 0
      };
    }

    const normalizedTopology = normalizeTopologyValue(topology);
    const dnaMatches = buildDnaAnnotationMatches(db, normalizedQuery, normalizedTopology, excludeEntryId);
    const proteinMatches = buildProteinAnnotationMatches(db, normalizedQuery, normalizedTopology, excludeEntryId);
    return {
      queryLength: normalizedQuery.length,
      topology: normalizedTopology,
      dnaMatches,
      proteinMatches,
      totalMatches: dnaMatches.length + proteinMatches.length
    };
  } finally {
    db.close();
  }
}

async function searchSequenceFeatures({ storagePath, query = '', limit = 30 }) {
  const safeQuery = cleanText(query, 600);
  const normalizedNameQuery = safeQuery.toLowerCase();
  const normalizedSequenceQuery = normalizeSequenceText(safeQuery);
  if (normalizedNameQuery.length < 2 && normalizedSequenceQuery.length < 3) {
    return { query: safeQuery, results: [] };
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const safeLimit = clamp(Math.round(Number(limit) || 30), 1, 100);
    const namePattern = normalizedNameQuery ? `%${normalizedNameQuery}%` : '';
    const sequencePattern = normalizedSequenceQuery ? `%${normalizedSequenceQuery}%` : '';
    const rows = readRows(
      db,
      `SELECT DISTINCT f.*
       FROM sequence_features f
       WHERE (? <> '' AND f.normalized_name LIKE ?)
          OR (? <> '' AND f.sequence LIKE ?)
       ORDER BY
         CASE WHEN ? <> '' AND f.normalized_name = ? THEN 0 ELSE 1 END,
         CASE WHEN ? <> '' AND f.sequence = ? THEN 0 ELSE 1 END,
         f.updated_at DESC,
         f.name COLLATE NOCASE ASC
       LIMIT ?`,
      [
        normalizedNameQuery, namePattern, normalizedSequenceQuery, sequencePattern,
        normalizedNameQuery, normalizedNameQuery, normalizedSequenceQuery, normalizedSequenceQuery, safeLimit
      ]
    );
    return {
      query: safeQuery,
      results: rows.map((row) => buildFeatureSearchResult(db, row)).filter(Boolean)
    };
  } finally {
    db.close();
  }
}

module.exports = {
  annotateSequenceRecord,
  searchSequenceFeatures
};
