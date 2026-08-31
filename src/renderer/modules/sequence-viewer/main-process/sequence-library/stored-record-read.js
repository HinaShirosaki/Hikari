'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { ensurePathWithinRoot } = require('./paths');

let sequenceViewerParserPromise = null;

async function loadSequenceViewerParser() {
  if (!sequenceViewerParserPromise) {
    const parserPath = path.resolve(__dirname, '../../parsing.js');
    sequenceViewerParserPromise = import(pathToFileURL(parserPath).href);
  }
  return sequenceViewerParserPromise;
}

async function parseStoredRecordText(gbkText) {
  const parser = await loadSequenceViewerParser();
  // Entry artifacts are contractually GenBank. Calling the generic input
  // detector here would reinterpret a malformed .gbk as a raw DNA sequence.
  const parsed = parser.parseGenBankRecords(String(gbkText || ''));
  return {
    parsed,
    record: Array.isArray(parsed?.records) ? parsed.records[0] || null : null
  };
}

async function readStoredRecord(paths, entry) {
  if (!entry?.gbkRelPath) {
    return { gbkText: '', parsed: null, record: null };
  }
  const gbkText = await fs.readFile(
    ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath),
    'utf8'
  );
  const parsedRecord = await parseStoredRecordText(gbkText);
  return { gbkText, ...parsedRecord };
}

module.exports = {
  parseStoredRecordText,
  readStoredRecord
};
