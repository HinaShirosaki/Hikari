'use strict';

const { FEATURE_INDEX_VERSION } = require('./constants');
const {
  normalizeEntryRow,
  persistDatabase,
  readRows
} = require('./database');
const { replaceFeatureOccurrencesForEntry } = require('./feature-store');
const { readStoredRecord: loadStoredRecord } = require('./stored-record-read');

function listEntriesMissingFeatureIndex(db) {
  return readRows(
    db,
    `SELECT e.*
     FROM sequence_entries e
     WHERE e.feature_index_version < ?
     ORDER BY e.updated_at ASC, e.name COLLATE NOCASE ASC`,
    [FEATURE_INDEX_VERSION]
  );
}

async function readStoredRecord(paths, entry) {
  try {
    const result = await loadStoredRecord(paths, entry);
    return result.record;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function syncMissingFeatureOccurrences({ db, paths }) {
  const missingRows = listEntriesMissingFeatureIndex(db);
  let indexedEntries = 0;
  for (const row of missingRows) {
    const entry = normalizeEntryRow(row);
    const record = await readStoredRecord(paths, entry);
    if (!entry || !record?.sequence?.length) {
      continue;
    }
    replaceFeatureOccurrencesForEntry(db, entry, {
      sequence: record.sequence,
      features: Array.isArray(record.features) ? record.features : []
    });
    db.run(
      'UPDATE sequence_entries SET feature_index_version = ? WHERE id = ?',
      [FEATURE_INDEX_VERSION, entry.id]
    );
    indexedEntries += 1;
  }
  if (indexedEntries > 0) {
    await persistDatabase(paths.sqlitePath, db);
  }
  return indexedEntries;
}

module.exports = {
  syncMissingFeatureOccurrences
};
