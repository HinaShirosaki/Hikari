'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration');
const { importStorageRoot } = require('../src/main/storage/storage-import');
const { readRecordDocument } = require('../src/main/storage/record-markdown/document-storage');
const { writeRecordMarkdown } = require('../src/main/storage/record-markdown');
const { rebuildRecordMarkdown } = require('../src/main/storage/record-markdown/rebuild');
const { block, blocks, documentMarker } = require('../src/main/storage/record-markdown/document-fields');
const { checkpointMarker } = require('../src/main/lib/record-markdown/checkpoint');
const { createMainDataHelpers } = require('../src/main/data/data-helpers');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=';
const read = file => fs.readFile(file, 'utf8');
async function fixture(work) {
  const root = await fs.mkdtemp('/private/tmp/hikari-standalone-');
  try { await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function edit(file, field, body) {
  const source = await read(file);
  await fs.writeFile(file, source.replace(blocks(source).get(field).source, () => block('field', field, body)));
}
function snapshot(root) {
  const protocol = { id: 'p', name: 'Protein', purpose: 'Purpose', materials: ['PBS'], steps: [{ id: 's', text: 'Add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume', type: 'volume' }] }], illustration: png };
  return { settings: { storagePath: root }, protocols: [protocol], notebookEntries: [{ id: 'n', projectName: 'P', protocolName: 'Protein', protocolId: 'p', protocolSnapshot: structuredClone(protocol),
    result: 'Original notes', values: { v: '10 µL', zero: 0, missing: null },
    resultTables: [{ columns: [{ field: 'signal', title: 'Signal' }], rows: [{ signal: '=SUM(A1:A2)', measured: 0 }] }],
    toolCalculations: [{ type: 'buffer', title: 'Buffer Preparer', inputs: { pH: 7.4, enabled: true }, table: { headers: ['Volume'], rows: [['3 mL']], footerRows: [['97 mL']] } }],
    provenance: { text: 'Unicode α, $$, -->, <script>, &amp;', nested: [{ empty: '', flag: false }] }, resultFileRecords: [{ name: 'raw.csv', relativePath: 'raw.csv', size: 12 }], assayIds: ['a'], gelIds: ['g'] }],
    assays: [{ id: 'a', name: 'Assay', resultValues: { A1: 12 } }], gelAnalyses: [{ id: 'g', name: 'Gel', parameters: { background: 'rolling' } }] };
}
function helpers() {
  return createMainDataHelpers({ fs, path, syncBundleFromSnapshot, hasSupportedDataExtension: () => true, getDefaultDataFilePath: () => 'hikari-data.json' });
}

test('fresh-process consumption restores all typed notebook data from Markdown alone', async () => fixture(async root => {
  const source = snapshot(root);
  await fs.writeFile(path.join(root, 'raw.csv'), 'signal\n12\n');
  const saved = await syncBundleFromSnapshot({ snapshot: source });
  const protocolMd = saved.sidecarPaths.protocolFilePaths[0];
  const pageMd = saved.sidecarPaths.notebookPageFolderPaths[0];
  for (const md of [protocolMd, pageMd]) {
    assert.ok(md.endsWith('.md'));
    await assert.rejects(fs.stat(md.replace(/\.md$/, '.json')), { code: 'ENOENT' });
    const text = await read(md);
    assert.match(text, /hikari-record:v2/);
    assert.doesNotMatch(text, /```json|base64,/);
  }
  await fs.access(path.join(root, 'Plates', 'Assay__a', 'assay.json'));
  await fs.access(path.join(root, 'Gels', 'Gel__g', 'gel.json'));
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../src/main/storage/storage-hydration'))}).hydrateSnapshotFromBundle({snapshot:{settings:{storagePath:${JSON.stringify(root)}}}}).then(value=>process.stdout.write(JSON.stringify(value.snapshot)))`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const loaded = JSON.parse(child.stdout);
  for (const field of ['protocolSnapshot', 'values', 'resultTables', 'toolCalculations', 'provenance', 'resultFileRecords', 'assayIds', 'gelIds']) assert.deepEqual(loaded.notebookEntries[0][field], source.notebookEntries[0][field]);
  assert.deepEqual(loaded.protocols[0].steps, source.protocols[0].steps);
  assert.equal(loaded.protocols[0].illustration, png);
  assert.equal(loaded.notebookEntries[0].result, 'Original notes');
}));

test('upgrade of old paired Markdown and JSON is lossless, backs up once and retires JSON', async () => fixture(async root => {
  const source = snapshot(root);
  const file = path.join(root, 'Protocol', 'Protein__p', 'protocol.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = { protocol: source.protocols[0] };
  const original = JSON.stringify(payload);
  await fs.writeFile(file, original);
  await writeRecordMarkdown({ filePath: file, payload, kind: 'protocol', canonical: true, storageRoot: root });
  await edit(file.replace(/\.json$/, '.md'), 'purpose', '## Purpose\n\nExternally authored purpose.');
  await rebuildRecordMarkdown(root, { migrate: true });
  assert.equal((await readRecordDocument(file, 'protocol')).data.protocol.purpose, 'Externally authored purpose.');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const backup = file.replace(/\.json$/, '.pre-markdown.json');
  assert.equal(await read(backup), original);
  await rebuildRecordMarkdown(root, { migrate: true });
  assert.equal(await read(backup), original);
}));

test('upgrade finds a renamed legacy protocol whose JSON companion was lost', async () => fixture(async root => {
  const source = snapshot(root);
  const folder = path.join(root, 'Protocol', 'Protein__p');
  const md = path.join(folder, 'protocol.md');
  await fs.mkdir(folder, { recursive: true });
  await writeRecordMarkdown({ filePath: md, payload: { protocol: source.protocols[0] }, kind: 'protocol', canonical: true, storageRoot: root });
  source.protocols[0].name = 'Renamed';
  await edit(md, 'purpose', '## Purpose\n\nKeep external scientific notes.');
  const saved = await syncBundleFromSnapshot({ snapshot: source });
  assert.deepEqual(saved.sidecarPaths.skippedRecords, []);
  assert.equal(saved.sidecarPaths.protocolFilePaths[0], md);
  assert.equal((await readRecordDocument(md, 'protocol')).data.protocol.purpose, 'Keep external scientific notes.');
  await assert.rejects(fs.stat(path.join(root, 'Protocol', 'Renamed__p')), { code: 'ENOENT' });
}));

test('legacy interrupted checkpoints migrate with the matching step bindings', async () => fixture(async root => {
  const file = path.join(root, 'Protocol', 'P__p', 'protocol.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const old = { protocol: { id: 'p', name: 'P', steps: [{ id: 'old', text: 'Mix.' }] } };
  const next = { protocol: { ...old.protocol, steps: [{ id: 'new', text: 'Prepare.' }, ...old.protocol.steps] }, document: { file: 'protocol.md' } };
  await fs.writeFile(file, JSON.stringify(old));
  await writeRecordMarkdown({ filePath: file, payload: next, kind: 'protocol', canonical: true, storageRoot: root });
  const transaction = globalThis.crypto.randomUUID();
  const md = file.replace(/\.json$/, '.md');
  await fs.writeFile(md, (await read(md)).replace(documentMarker('protocol'), `${documentMarker('protocol')}\n${checkpointMarker(transaction)}`));
  await fs.writeFile(`${file}.pending`, JSON.stringify({ version: 1, transaction, checkpoint: next }));
  await rebuildRecordMarkdown(root, { migrate: true });
  assert.deepEqual((await readRecordDocument(md, 'protocol')).data.protocol.steps, next.protocol.steps);
  for (const obsolete of [file, `${file}.pending`]) await assert.rejects(fs.stat(obsolete), { code: 'ENOENT' });
}));

test('a failed Markdown rename leaves the previous state and accepts the next editor change', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const source = snapshot(root);
  const api = { autoSaveDataFile: data => helpers().autoSaveDataFile({ data }) };
  const file = (await syncMarkdownRecordState(api, source)).sidecarPaths.protocolFilePaths[0];
  const before = await read(file);
  source.protocols[0].purpose = 'First edit';
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (to === file) throw Object.assign(new Error('Transient EIO'), { code: 'EIO' }); return rename(from, to); };
  try { assert.equal((await syncMarkdownRecordState(api, source)).sidecarPaths.skippedRecords[0].id, 'p'); }
  finally { fs.rename = rename; }
  assert.equal(await read(file), before);
  source.protocols[0].purpose = 'Second edit';
  assert.deepEqual((await syncMarkdownRecordState(api, source)).sidecarPaths.skippedRecords, []);
  assert.equal((await readRecordDocument(file, 'protocol')).data.protocol.purpose, 'Second edit');
}));

test('external notes merged during save reach the live app and accept its next edit', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const source = snapshot(root);
  const api = { autoSaveDataFile: data => helpers().autoSaveDataFile({ data }) };
  const file = (await syncMarkdownRecordState(api, source)).sidecarPaths.notebookPageFolderPaths[0];
  await fs.appendFile(file, '\nExternal notes appended at EOF.\n');
  await syncMarkdownRecordState(api, source);
  assert.equal(source.notebookEntries[0].result, 'Original notes\n\nExternal notes appended at EOF.');
  source.notebookEntries[0].result += '\nAn app edit.';
  assert.deepEqual((await syncMarkdownRecordState(api, source)).sidecarPaths.skippedRecords, []);
  assert.equal((await readRecordDocument(file, 'notebook')).data.notebookEntry.result, source.notebookEntries[0].result);
}));

test('invalid or aliased embedded state is reported and preserved while other records save', async () => fixture(async root => {
  const source = snapshot(root);
  const file = (await syncBundleFromSnapshot({ snapshot: source })).sidecarPaths.protocolFilePaths[0];
  const current = await read(file);
  for (const metadata of ['version: 999\n', 'version: 2\nkind: protocol\npayload:\n  protocol: &record\n    id: p\n    cycle: *record\n']) {
    const damaged = current.replace(/^<!-- hikari-record:v2\n[\s\S]*?^-->/m, () => `<!-- hikari-record:v2\n${metadata}-->`);
    await fs.writeFile(file, damaged);
    assert.equal((await readRecordDocument(file, 'protocol')).ok, false);
    source.assays[0].resultValues.A1 = 99;
    const saved = await syncBundleFromSnapshot({ snapshot: source });
    assert.equal(saved.sidecarPaths.skippedRecords[0].id, 'p');
    assert.equal(await read(file), damaged);
    assert.equal(JSON.parse(await read(path.join(root, 'Plates', 'Assay__a', 'assay.json'))).assay.resultValues.A1, 99);
  }
}));

test('retired root snapshots are backed up and never resurrect deleted protocols', async () => fixture(async root => {
  const source = snapshot(root);
  const legacy = path.join(root, 'hikari-data.json');
  const text = JSON.stringify(source);
  await fs.writeFile(legacy, text);
  assert.equal((await helpers().autoSaveDataFile({ data: source })).ok, true);
  await assert.rejects(fs.stat(legacy), { code: 'ENOENT' });
  assert.equal(await read(legacy.replace(/\.json$/, '.pre-markdown.json')), text);
  source.protocols = [];
  await syncBundleFromSnapshot({ snapshot: source });
  assert.deepEqual((await importStorageRoot({ storagePath: root })).statePatch.protocols, []);
}));

test('moving a Markdown-only workspace keeps image refs, files and scientific state readable', async () => fixture(async root => {
  const original = path.join(root, 'original');
  const relocated = path.join(root, 'relocated');
  await fs.mkdir(original);
  const source = snapshot(original);
  await fs.writeFile(path.join(original, 'raw.csv'), 'signal\n12\n');
  await syncBundleFromSnapshot({ snapshot: source });
  await fs.rename(original, relocated);
  const loaded = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: relocated } } })).snapshot;
  assert.equal(loaded.protocols[0].illustration, png);
  assert.deepEqual(loaded.notebookEntries[0].toolCalculations, source.notebookEntries[0].toolCalculations);
  assert.deepEqual((await syncBundleFromSnapshot({ snapshot: loaded })).sidecarPaths.skippedRecords, []);
}));

test('legacy workflow links route a page to one writer and unchanged reloads retain its modification time', async () => fixture(async root => {
  const source = snapshot(root);
  source.workflowTemplates = [{ id: 't', name: 'Template' }];
  source.workflows = [{ id: 'w', name: 'Run', templateId: 't', notebookEntryIds: ['n'] }];
  assert.equal(source.notebookEntries[0].workflowContext, undefined);
  const saved = await syncBundleFromSnapshot({ snapshot: source });
  assert.deepEqual(saved.sidecarPaths.notebookPageFolderPaths, []);
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  const file = path.join(loaded.snapshot.notebookEntries[0].storageFolder, 'page.md');
  const before = await read(file);
  const modifiedAt = (await fs.stat(file)).mtimeMs;
  let writes = 0;
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (to === file) writes++; return rename(from, to); };
  try {
    const repeated = await syncBundleFromSnapshot({ snapshot: loaded.snapshot });
    assert.deepEqual(repeated.sidecarPaths.skippedRecords, []);
    assert.deepEqual(repeated.sidecarPaths.notebookPageFolderPaths, []);
  } finally { fs.rename = rename; }
  assert.equal(writes, 0);
  assert.equal(await read(file), before);
  assert.equal((await fs.stat(file)).mtimeMs, modifiedAt);
}));
