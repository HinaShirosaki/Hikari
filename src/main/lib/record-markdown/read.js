'use strict';

const fs = require('node:fs/promises');
const { createMarkdownRevision, documentMarker, fieldsForRecord, readDocumentRecord, validateDocument } = require('./fields');
const { readRecordCheckpoint } = require('./checkpoint');

async function readRecordDocument(filePath, kind) {
  const { source, ...checkpoint } = await readRecordCheckpoint(filePath);
  const result = { ...checkpoint, warnings: [], markdownLoaded: false };
  if (!checkpoint.ok) return result;
  if (checkpoint.checkpointError) {
    result.warnings.push(checkpoint.checkpointError);
    return result;
  }
  if (checkpoint.recovered) result.warnings.push(`Recovered an interrupted record save at ${filePath}.`);
  const markdownPath = filePath.replace(/\.json$/, '.md');
  try {
    if (source === null) throw Object.assign(new Error(`Missing ${markdownPath}`), { code: 'ENOENT' });
    if (source.includes(documentMarker(kind))) {
      const key = kind === 'protocol' ? 'protocol' : 'notebookEntry';
      validateDocument(source, result.data[key], kind);
      const before = fieldsForRecord(result.data[key], kind);
      const record = readDocumentRecord(source, result.data[key], kind);
      if (JSON.stringify(before) !== JSON.stringify(fieldsForRecord(record, kind))) {
        const modifiedAt = (await fs.stat(markdownPath)).mtimeMs;
        if (modifiedAt > (Date.parse(record.updatedAt) || 0)) record.updatedAt = new Date(modifiedAt).toISOString();
      }
      record.markdownRevision = await createMarkdownRevision(record, kind);
      // A reload starts a new client lineage even when the text matches an
      // older version seen by the renderer's save queue.
      record.markdownRevision.origin = globalThis.crypto.randomUUID();
      result.data[key] = record;
      result.markdownLoaded = true;
    } else if (result.data.document) {
      throw new Error('Missing document marker');
    }
  } catch (error) {
    result.markdownError = { code: error.code || '', message: error.message };
    if (error.code !== 'ENOENT' || result.data.document) {
      result.warnings.push(`Could not load ${markdownPath}; recovered the last saved JSON record: ${error.message}`);
    }
  }
  return result;
}

module.exports = { readRecordDocument };
