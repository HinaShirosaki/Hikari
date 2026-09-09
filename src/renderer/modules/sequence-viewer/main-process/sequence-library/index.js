'use strict';

const {
  DB_FILE_NAME,
  LIBRARY_FOLDER_NAME,
  STATUS_SAVED,
  STATUS_TEMPORARY
} = require('./constants');
const { setCdsSequenceTableRebuilder } = require('./database');
const {
  deleteSequenceEntry,
  getSequenceEntry,
  listSequenceEntries
} = require('./entry-read');
const {
  promoteSequenceEntry,
  upsertSequenceEntry
} = require('./entry-upsert');
const {
  annotateSequenceRecord,
  searchSequenceFeatures
} = require('./annotation-service');
const {
  listRecognizedBackbones,
  upsertRecognizedBackbone
} = require('./recognized-service');
const { recognizeSequenceBackbone } = require('./backbone-service');
const { rebuildCdsSequenceTable } = require('./feature-store');
const { sanitizeFileName } = require('./utils');
const {
  deleteSequenceFolder,
  listSequenceFolders,
  moveSequenceEntryToFolder,
  upsertSequenceFolder
} = require('./folder-store');

setCdsSequenceTableRebuilder(rebuildCdsSequenceTable);

module.exports = {
  STATUS_SAVED,
  STATUS_TEMPORARY,
  LIBRARY_FOLDER_NAME,
  DB_FILE_NAME,
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  listSequenceFolders,
  upsertSequenceFolder,
  deleteSequenceFolder,
  moveSequenceEntryToFolder,
  annotateSequenceRecord,
  searchSequenceFeatures,
  listRecognizedBackbones,
  upsertRecognizedBackbone,
  recognizeSequenceBackbone,
  sanitizeFileName
};

const { withLibraryLock } = require('./operation-lock');
for (const [name, action] of Object.entries(module.exports)) {
  if (typeof action === 'function' && name !== 'sanitizeFileName') {
    module.exports[name] = (payload = {}) => withLibraryLock(payload.storagePath, () => action(payload));
  }
}
