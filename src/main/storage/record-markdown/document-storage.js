'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('../../lib/shared-json-file');
const { readJsonFile } = require('../storage-utils');
const { createMarkdownRevision, documentMarker, mergeDocumentRecord, validateDocument } = require('./document-fields');
const { readRecordDocument } = require('../../lib/record-markdown/read');
const { pendingPathFor, readRecordCheckpoint } = require('../../lib/record-markdown/checkpoint');
const { existingMarkdown, writeRecordMarkdown } = require('./index');

const recordKey = kind => kind === 'protocol' ? 'protocol' : 'notebookEntry';
const markdownPathFor = filePath => filePath.replace(/\.json$/, '.md');

async function prepareRecordDocument(input) {
  const payload = structuredClone(input.payload);
  const source = await existingMarkdown(markdownPathFor(input.filePath));
  const prior = await readRecordCheckpoint(input.filePath, source);
  if (prior.checkpointError) throw new Error(prior.checkpointError);
  if (prior.exists && !prior.ok) throw new Error(`Cannot replace unreadable record ${input.filePath}: ${prior.error}`);
  const key = recordKey(input.kind);
  if (prior.ok && prior.data[key]?.id !== payload[key]?.id) throw new Error(`Record identity changed at ${input.filePath}`);
  if (prior.data?.document && !source.includes(documentMarker(input.kind))) {
    throw new Error(`Missing migrated Markdown at ${markdownPathFor(input.filePath)}. Restore it before saving.`);
  }
  if (source.includes(documentMarker(input.kind))) {
    if (!prior.ok) throw new Error(`Missing companion record for ${markdownPathFor(input.filePath)}`);
    validateDocument(source, prior.data[key], input.kind);
    const incoming = { ...payload[key], markdownRevision: payload[key].markdownRevision || prior.data.document?.legacyRevision };
    payload[key] = await mergeDocumentRecord(source, prior.data[key], incoming, input.kind);
  }
  return { payload, prior, source };
}

// The caller owns the storage-root queue. Markdown is durable before its
// companion JSON advances, so an interrupted save still has recoverable text.
async function writeRecordDocument(input) {
  const { payload, prior, source } = await prepareRecordDocument(input);
  await fs.mkdir(path.dirname(input.filePath), { recursive: true });
  if (prior.ok && !prior.data.document) {
    const backup = input.filePath.replace(/\.json$/, '.pre-markdown.json');
    await fs.copyFile(input.filePath, backup, fs.constants.COPYFILE_EXCL).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const markdownPath = markdownPathFor(input.filePath);
  payload.document = { format: documentMarker(input.kind), file: path.basename(markdownPath) };
  const checkpoint = structuredClone(payload);
  const key = recordKey(input.kind);
  // Older script callers have no revision. Remember their baseline hashes,
  // while the JSON checkpoint always holds the matching, fully merged record.
  if (prior.ok && !input.payload[key].markdownRevision) {
    const baseline = prior.data.document?.legacyRevision || await createMarkdownRevision(prior.data[key], input.kind);
    const incoming = await createMarkdownRevision(input.payload[key], input.kind);
    const merged = await createMarkdownRevision(payload[key], input.kind);
    let kept = false;
    for (const field of Object.keys(merged.fields)) {
      if (incoming.fields[field] !== merged.fields[field]) { merged.fields[field] = baseline.fields[field]; kept = true; }
    }
    if (kept || prior.data.document?.legacyRevision) checkpoint.document.legacyRevision = merged;
  }
  delete checkpoint[key].markdownRevision;
  const transaction = globalThis.crypto.randomUUID();
  const pendingPath = pendingPathFor(input.filePath);
  await writeFileAtomic(fs, pendingPath, JSON.stringify({ version: 1, transaction, checkpoint }, null, 2));
  await writeRecordMarkdown({ ...input, payload, canonical: true, expectedSource: source, transaction });
  await writeFileAtomic(fs, input.filePath, JSON.stringify(checkpoint, null, 2));
  await fs.rm(pendingPath, { force: true });
  payload[key].markdownRevision = await createMarkdownRevision(payload[key], input.kind);
  payload[key].markdownRevision.origin = globalThis.crypto.randomUUID();
  return { markdownPath, record: payload[recordKey(input.kind)] };
}

async function writeRecordDocumentSafely(input, warnings) {
  try { return await writeRecordDocument(input); }
  catch (error) {
    // A colliding user document must not block older JSON-only workspaces.
    // Migrated documents and conflicts fail the save and remain untouched.
    const prior = await readJsonFile(input.filePath);
    if (!prior.data?.document && /user-owned Markdown/.test(error.message)) {
      const warning = `Markdown migration skipped for ${input.filePath}: ${error.message}`;
      warnings.push(warning);
      console.warn(warning);
      await writeFileAtomic(fs, input.filePath, JSON.stringify(input.payload, null, 2));
      return { markdownPath: '', record: input.payload[recordKey(input.kind)] };
    }
    throw error;
  }
}

module.exports = { prepareRecordDocument, readRecordDocument, writeRecordDocument, writeRecordDocumentSafely };
