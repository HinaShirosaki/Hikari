'use strict';

const { STATUS_SAVED } = require('./constants');
const { readSingleRow } = require('./database');
const { cleanText, normalizeName } = require('./utils');

function findNextSavedName(db, requestedName, selfId = '') {
  const base = normalizeName(requestedName, 'sequence');
  for (let attempt = 1; attempt < 5000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}_${attempt}`;
    const row = readSingleRow(
      db,
      'SELECT id FROM sequence_entries WHERE status = ? AND normalized_name = ? LIMIT 1',
      [STATUS_SAVED, candidate.toLowerCase()]
    );
    if (!row || cleanText(row.id, 200) === cleanText(selfId, 200)) {
      return candidate;
    }
  }
  throw new Error('Failed to resolve a unique saved sequence name.');
}

function upsertEntryRow(db, row) {
  db.run(
    `INSERT INTO sequence_entries (
       id, name, normalized_name, status, source_format, topology, sequence_length, feature_count,
       feature_index_version, gbk_rel_path, html_rel_path, folder_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       status = excluded.status,
       source_format = excluded.source_format,
       topology = excluded.topology,
       sequence_length = excluded.sequence_length,
       feature_count = excluded.feature_count,
       feature_index_version = excluded.feature_index_version,
       gbk_rel_path = excluded.gbk_rel_path,
       html_rel_path = excluded.html_rel_path,
       folder_id = excluded.folder_id,
       updated_at = excluded.updated_at`,
    [
      row.id, row.name, row.normalizedName, row.status, row.sourceFormat, row.topology,
      row.sequenceLength, row.featureCount, row.featureIndexVersion, row.gbkRelPath, row.htmlRelPath, row.folderId,
      row.createdAt, row.updatedAt
    ]
  );
}

module.exports = {
  findNextSavedName,
  upsertEntryRow
};
