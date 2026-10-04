'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('../../lib/shared-json-file');
const { readJsonFile } = require('../storage-utils');
const { createMarkdownRevision, documentMarker, mergeDocumentRecord, validateDocument } = require('./document-fields');
const { readRecordDocument } = require('../../lib/record-markdown/read');
const { pendingPathFor, readRecordCheckpoint } = require('../../lib/record-markdown/checkpoint');
const { commitRecordMarkdown, existingMarkdown, renderRecordMarkdown } = require('./index');

const recordKey = kind => kind === 'protocol' ? 'protocol' : 'notebookEntry';
const markdownPathFor = filePath => filePath.replace(/\.json$/, '.md');

async function prepareRecordDocument(input) {
  const payload = structuredClone(input.payload);
  const source = await existingMarkdown(markdownPathFor(input.filePath));
  const prior = await readRecordCheckpoint(input.filePath, source);
  if (prior.checkpointError) throw new Error(prior.checkpointError);
  const key = recordKey(input.kind);
  if (prior.ok && prior.data[key]?.id !== payload[key]?.id) throw new Error(`Record identity changed at ${input.filePath}`);
  // A deleted document is rewritten from this record. A missing or unreadable
  // companion is rebuilt from it as well, while the document's prose still wins.
  if (source.includes(documentMarker(input.kind))) {
    const baseline = prior.ok ? prior.data[key] : payload[key];
    validateDocument(source, baseline, input.kind);
    const incoming = { ...payload[key], markdownRevision: payload[key].markdownRevision || prior.data?.document?.legacyRevision };
    payload[key] = await mergeDocumentRecord(source, baseline, incoming, input.kind);
  }
  return { payload, prior, source };
}

// The caller owns the storage-root queue. Markdown is durable before its
// companion JSON advances, so an interrupted save still has recoverable text.
async function writeRecordDocument(input) {
  const { payload, prior, source } = await prepareRecordDocument(input);
  if (prior.ok && !prior.data.document) {
    const backup = input.filePath.replace(/\.json$/, '.pre-markdown.json');
    await fs.copyFile(input.filePath, backup, fs.constants.COPYFILE_EXCL).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  if (prior.exists && !prior.ok) await fs.copyFile(input.filePath, input.filePath.replace(/\.json$/, '.unreadable.json'));
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
  const rendered = await renderRecordMarkdown({ ...input, payload, canonical: true, expectedSource: source });
  // An unchanged record keeps its files, so a save does not rewrite every
  // document or make open editors report a change. Images are still checked.
  const stable = data => JSON.stringify({ ...data, updated_at: undefined, exportedAt: undefined });
  if (prior.ok && !prior.recovered && rendered.markdown === rendered.previous && stable(prior.data) === stable(checkpoint)) {
    await commitRecordMarkdown(rendered, { kind: input.kind, canonical: true });
  } else {
    const transaction = globalThis.crypto.randomUUID();
    const pendingPath = pendingPathFor(input.filePath);
    await fs.mkdir(path.dirname(input.filePath), { recursive: true });
    await writeFileAtomic(fs, pendingPath, JSON.stringify({ version: 1, transaction, checkpoint }, null, 2));
    await commitRecordMarkdown(rendered, { kind: input.kind, canonical: true, transaction });
    await writeFileAtomic(fs, input.filePath, JSON.stringify(checkpoint, null, 2));
    await fs.rm(pendingPath, { force: true });
  }
  payload[key].markdownRevision = await createMarkdownRevision(payload[key], input.kind);
  payload[key].markdownRevision.origin = globalThis.crypto.randomUUID();
  return { markdownPath, record: payload[recordKey(input.kind)] };
}

async function writeRecordDocumentSafely(input, warnings, skipped) {
  try { return await writeRecordDocument(input); }
  catch (error) {
    // A colliding user document must not block older JSON-only workspaces.
    const prior = await readJsonFile(input.filePath);
    const record = input.payload[recordKey(input.kind)];
    if (!prior.data?.document && /user-owned Markdown/.test(error.message)) {
      const warning = `Markdown migration skipped for ${input.filePath}: ${error.message}`;
      warnings.push(warning);
      console.warn(warning);
      await writeFileAtomic(fs, input.filePath, JSON.stringify(input.payload, null, 2));
      return { markdownPath: '', record };
    }
    // Anything else skips only this record and leaves its files untouched, so
    // one damaged or conflicting document cannot stop the rest of the save.
    const name = record.name || record.experimentName || record.protocolName || record.id;
    const file = input.storageRoot ? path.relative(input.storageRoot, markdownPathFor(input.filePath)) : markdownPathFor(input.filePath);
    const message = error.code === 'MARKDOWN_CONFLICT'
      ? `"${name}" was changed in Hikari and in ${file}, so it was not saved. Delete the file to keep Hikari's version, or restart Hikari to load the file's version.`
      : `"${name}" was not saved: ${error.message.replace(/\.$/, '')}. Fix ${file}, or delete it so Hikari rewrites it.`;
    skipped.push({ kind: input.kind, id: record.id, message });
    console.warn(message);
    return { markdownPath: '', record, skipped: true };
  }
}

module.exports = { prepareRecordDocument, readRecordDocument, writeRecordDocument, writeRecordDocumentSafely };
