'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  FEATURE_INDEX_VERSION,
  STATUS_SAVED
} = require('./constants');
const { readRows } = require('./database');
const { findNextSavedName, upsertEntryRow } = require('./entry-row-store');
const { replaceFeatureOccurrencesForEntry } = require('./feature-store');
const { toPosixRelative } = require('./paths');
const { parseStoredRecordText } = require('./stored-record-read');
const {
  cleanText,
  normalizeName,
  sanitizeFileName,
  stripExtension
} = require('./utils');

function resolveRecoveredName(filePath, gbkText, record) {
  const fileStem = normalizeName(stripExtension(path.basename(filePath)), 'sequence');
  const definition = normalizeName(/^DEFINITION\s+(.+)$/im.exec(String(gbkText || ''))?.[1], '');
  const recordName = normalizeName(record?.name, '');
  return [definition, recordName]
    .find((name) => name && sanitizeFileName(name, 'sequence') === fileStem)
    || fileStem;
}

async function recoverMissingSequenceEntries({ db, paths }) {
  const existingIds = new Set(
    readRows(db, 'SELECT id FROM sequence_entries')
      .map((row) => cleanText(row?.id, 200))
      .filter(Boolean)
  );
  const entryDirectories = (await fs.readdir(paths.entriesRoot, { withFileTypes: true }))
    .filter((item) => item.isDirectory() && !item.name.startsWith('.') && !existingIds.has(item.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  let recoveredEntryCount = 0;

  for (const directory of entryDirectories) {
    const entryId = cleanText(directory.name, 200);
    const entryDir = path.join(paths.entriesRoot, directory.name);
    try {
      const gbkFile = (await fs.readdir(entryDir, { withFileTypes: true }))
        .filter((item) => item.isFile() && /\.gbk$/i.test(item.name))
        .sort((left, right) => left.name.localeCompare(right.name))[0];
      if (!gbkFile) {
        continue;
      }
      const gbkPath = path.join(entryDir, gbkFile.name);
      const [gbkText, fileStat] = await Promise.all([
        fs.readFile(gbkPath, 'utf8'),
        fs.stat(gbkPath)
      ]);
      const { record } = await parseStoredRecordText(gbkText);
      if (!record?.sequence?.length) {
        continue;
      }
      const name = findNextSavedName(db, resolveRecoveredName(gbkPath, gbkText, record), entryId);
      const createdAt = new Date(fileStat.birthtimeMs > 0 ? fileStat.birthtime : fileStat.mtime).toISOString();
      const row = {
        id: entryId,
        name,
        normalizedName: name.toLowerCase(),
        status: STATUS_SAVED,
        sourceFormat: cleanText(record.sourceFormat || 'genbank', 80),
        topology: cleanText(record.topology, 40) || 'linear',
        sequenceLength: record.sequence.length,
        featureCount: Array.isArray(record.features) ? record.features.length : 0,
        featureIndexVersion: FEATURE_INDEX_VERSION,
        gbkRelPath: toPosixRelative(paths.libraryRoot, gbkPath),
        htmlRelPath: '',
        folderId: '',
        createdAt,
        updatedAt: new Date(fileStat.mtime).toISOString()
      };
      upsertEntryRow(db, row);
      replaceFeatureOccurrencesForEntry(db, row, {
        sequence: record.sequence,
        features: Array.isArray(record.features) ? record.features : []
      });
      recoveredEntryCount += 1;
    } catch (error) {
      console.warn(`Skipped sequence recovery for ${entryId}:`, error);
    }
  }

  return recoveredEntryCount;
}

module.exports = {
  recoverMissingSequenceEntries
};
