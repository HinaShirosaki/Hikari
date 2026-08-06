'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { FEATURE_INDEX_VERSION } = require('./constants');
const {
  normalizeEntryRow,
  persistDatabase,
  readRows
} = require('./database');
const { replaceFeatureOccurrencesForEntry } = require('./feature-store');
const { ensurePathWithinRoot } = require('./paths');

let sequenceViewerParserPromise = null;

async function loadSequenceViewerParser() {
  if (!sequenceViewerParserPromise) {
    const parserPath = path.resolve(__dirname, '../../parsing.js');
    sequenceViewerParserPromise = import(pathToFileURL(parserPath).href);
  }
  return sequenceViewerParserPromise;
}

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
  if (!entry?.gbkRelPath) {
    return null;
  }
  let gbkText;
  try {
    gbkText = await fs.readFile(ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const parser = await loadSequenceViewerParser();
  const parsed = parser.parseInputRecords(String(gbkText || ''));
  return Array.isArray(parsed?.records) ? parsed.records[0] || null : null;
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
