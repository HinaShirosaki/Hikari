'use strict';

const path = require('path');
const { readSqlRows } = require('./storage-sql-read');
const { cleanText, loadSqlJs } = require('./storage-utils');

async function summarizeSequenceLibrary(storagePath) {
  const sequenceDbPath = path.join(storagePath, 'SequenceViewer', 'sequence-library.sqlite');
  const summary = {
    exists: false,
    path: sequenceDbPath,
    entryCount: 0,
    statusCounts: {
      saved: 0,
      temporary: 0
    }
  };
  try {
    const fs = require('fs/promises');
    const bytes = await fs.readFile(sequenceDbPath);
    if (!bytes.length) {
      return summary;
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      summary.exists = true;
      const countRows = readSqlRows(db, 'SELECT COUNT(*) AS count FROM sequence_entries', []);
      summary.entryCount = Math.max(0, Number(countRows[0]?.count) || 0);
      const statusRows = readSqlRows(
        db,
        'SELECT status, COUNT(*) AS count FROM sequence_entries GROUP BY status',
        []
      );
      statusRows.forEach((row) => {
        const status = cleanText(row.status, 80).toLowerCase();
        if (status === 'saved' || status === 'temporary') {
          summary.statusCounts[status] = Math.max(0, Number(row.count) || 0);
        }
      });
      return summary;
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return summary;
    }
    throw error;
  }
}

module.exports = {
  summarizeSequenceLibrary
};
