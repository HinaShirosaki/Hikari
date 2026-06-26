'use strict';

const fs = require('fs/promises');
const {
  recognizeSequenceBackboneInLibrary
} = require('../../../../renderer/modules/sequence-viewer/algorithms/sequence-backbone-recognition');
const {
  normalizeEntryRow,
  openDatabase,
  readRows
} = require('./database');
const {
  ensureLibraryDirectories,
  ensurePathWithinRoot,
  resolveLibraryPaths
} = require('./paths');
const {
  clamp,
  cleanText,
  normalizeSequenceText,
  normalizeStatus,
  reverseComplementIupac
} = require('./utils');
const {
  STATUS_SAVED,
  STATUS_TEMPORARY
} = require('./constants');

async function recognizeSequenceBackbone({ storagePath, sequence = '', excludeEntryId = '' }) {
  return recognizeSequenceBackboneInLibrary({
    fs,
    cleanText,
    normalizeSequenceText,
    normalizeStatus,
    clamp,
    reverseComplementIupac,
    resolveLibraryPaths,
    ensureLibraryDirectories,
    openDatabase,
    readRows,
    normalizeEntryRow,
    ensurePathWithinRoot,
    STATUS_SAVED,
    STATUS_TEMPORARY
  }, {
    storagePath,
    sequence,
    excludeEntryId
  });
}

module.exports = { recognizeSequenceBackbone };
