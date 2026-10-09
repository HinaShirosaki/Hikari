'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createMarkdownRevision, documentMarker, mergeDocumentRecord, validateDocument } = require('./document-fields');
const { readRecordDocument } = require('../../lib/record-markdown/read');
const { pendingPathFor, readRecordCheckpoint } = require('../../lib/record-markdown/checkpoint');
const { legacyPathFor, markdownPathFor } = require('../../lib/record-markdown/metadata');
const { commitRecordMarkdown, existingMarkdown, renderRecordMarkdown } = require('./index');

const recordKey = kind => kind === 'protocol' ? 'protocol' : 'notebookEntry';

async function prepareRecordDocument(input) {
  const payload = structuredClone(input.payload);
  const source = await existingMarkdown(markdownPathFor(input.filePath));
  const prior = await readRecordCheckpoint(input.filePath, source, input.payload);
  if (prior.metadataError) throw new Error(`Cannot load Markdown record: ${prior.error}`);
  if (prior.checkpointError) throw new Error(prior.checkpointError);
  const key = recordKey(input.kind);
  if (prior.ok && prior.data[key]?.id !== payload[key]?.id) throw new Error(`Record identity changed at ${input.filePath}`);
  // A deleted document is rewritten from this record. Legacy documents without
  // a readable companion retain their authored prose during the upgrade.
  if (source.includes(documentMarker(input.kind))) {
    const baseline = prior.ok ? prior.data[key] : payload[key];
    validateDocument(source, baseline, input.kind);
    const incoming = { ...payload[key], markdownRevision: payload[key].markdownRevision || prior.data?.document?.legacyRevision };
    payload[key] = await mergeDocumentRecord(source, baseline, incoming, input.kind);
  }
  return { payload, prior, source };
}

// The caller owns the storage-root queue. One atomic Markdown replacement
// commits both the readable text and its complete typed scientific state.
async function writeRecordDocument(input) {
  const { payload, prior, source } = await prepareRecordDocument(input);
  const legacyPath = legacyPathFor(markdownPathFor(input.filePath));
  const readOptional = file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const recordIn = raw => {
    try { const { markdownRevision, storageFolder, storageDocumentFile, ...record } = JSON.parse(raw)[recordKey(input.kind)]; return record; }
    catch { return raw; }
  };
  const legacy = await readOptional(legacyPath);
  // A first-migration backup holds the original JSON. A companion saved since
  // then can hold newer data, so it gets its own copy; without one it is kept.
  let backedUp = false;
  for (const suffix of legacy ? ['.pre-markdown.json', '.pre-v2.json'] : []) {
    const backup = legacyPath.replace(/\.json$/, suffix);
    const existing = await readOptional(backup);
    if (!existing) await fs.copyFile(legacyPath, backup, fs.constants.COPYFILE_EXCL);
    if (!existing || isDeepStrictEqual(recordIn(existing), recordIn(legacy))) { backedUp = true; break; }
  }
  const markdownPath = markdownPathFor(input.filePath);
  payload.document = { format: documentMarker(input.kind), file: path.basename(markdownPath) };
  const checkpoint = structuredClone(payload);
  const key = recordKey(input.kind);
  // Older script callers have no revision. Remember their baseline hashes,
  // while embedded metadata holds the matching, fully merged record.
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
  const stable = data => JSON.stringify({ ...data, updated_at: undefined, exportedAt: undefined });
  if (prior.ok && stable(prior.data) === stable(checkpoint)) {
    checkpoint.updated_at = prior.data.updated_at;
    checkpoint.exportedAt = prior.data.exportedAt;
  }
  const rendered = await renderRecordMarkdown({ ...input, payload, checkpoint, canonical: true, expectedSource: source });
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  try {
    await commitRecordMarkdown(rendered, { kind: input.kind, canonical: true });
  } catch (error) {
    // Image-manifest cleanup can fail after the document already committed.
    // That is a saved record, not an unsaved edit with an obsolete baseline.
    if (await fs.readFile(markdownPath, 'utf8').catch(() => '') !== rendered.markdown) throw error;
    console.warn(`Saved ${markdownPath}, but generated image cleanup failed: ${error.message}`);
  }
  // Legacy files cease being active storage only after the complete document
  // is durable; an interrupted cleanup is safe to retry and Markdown wins.
  if (backedUp) await fs.rm(legacyPath, { force: true }).catch(error => console.warn(`Legacy record cleanup failed: ${error.message}`));
  else if (legacy) console.warn(`Kept ${legacyPath}: its backups hold different content.`);
  await fs.rm(pendingPathFor(legacyPath), { force: true }).catch(() => {});
  payload[key].markdownRevision = await createMarkdownRevision(payload[key], input.kind);
  payload[key].markdownRevision.origin = globalThis.crypto.randomUUID();
  return { markdownPath, record: payload[recordKey(input.kind)] };
}

async function writeRecordDocumentSafely(input, warnings, skipped) {
  try { return await writeRecordDocument(input); }
  catch (error) {
    const record = input.payload[recordKey(input.kind)];
    // A failed record retains its input for retry, so
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
