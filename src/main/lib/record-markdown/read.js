'use strict';

const fs = require('node:fs/promises');
const { createMarkdownRevision, documentMarker, fieldsForRecord, readDocumentRecord, validateDocument } = require('./fields');
const { readRecordCheckpoint } = require('./checkpoint');
const { markdownPathFor } = require('./metadata');

async function loadRecordDocument(filePath, kind) {
  const { source, ...checkpoint } = await readRecordCheckpoint(filePath);
  const result = { ...checkpoint, warnings: [...(checkpoint.warnings || [])], markdownLoaded: false };
  if (!checkpoint.ok) return result;
  const key = kind === 'protocol' ? 'protocol' : 'notebookEntry';
  if (!checkpoint.data?.[key]?.id) return { ...result, ok: false, error: `Invalid ${kind} record identity` };
  if (checkpoint.checkpointError) {
    result.warnings.push(checkpoint.checkpointError);
    return result;
  }
  if (checkpoint.recovered) result.warnings.push(`Recovered an interrupted record save at ${filePath}.`);
  const markdownPath = markdownPathFor(filePath);
  try {
    if (source === null) throw Object.assign(new Error(`Missing ${markdownPath}`), { code: 'ENOENT' });
    if (source.includes(documentMarker(kind))) {
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
      result.warnings.push(`Could not load ${markdownPath}; recovered the last saved ${checkpoint.standalone ? 'embedded' : 'JSON'} record: ${error.message}`);
    }
  }
  return result;
}

// Alerts are the problems a person must see when the workspace opens: a
// record that did not load, or loaded without part of its document.
async function readRecordDocument(filePath, kind) {
  const result = await loadRecordDocument(filePath, kind);
  const failed = !result.ok && result.exists
    ? [`Could not load ${markdownPathFor(filePath)}: ${String(result.error).split('\n')[0].replace(/\.$/, '')}. The file was left unchanged.`] : [];
  return { ...result, alerts: [...failed, ...result.warnings.map(warning => warning.split('\n')[0])] };
}

module.exports = { readRecordDocument };
