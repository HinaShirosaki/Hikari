import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { describeNotebookMarkdownChanges: diff } = require('../src/main/storage/record-markdown/notebook-log');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { syncWorkflowRootFromSnapshot } = require('../src/main/storage/workflow-storage');
const { commitRecordMarkdown } = require('../src/main/storage/record-markdown');
const { readRecordDocument } = require('../src/main/storage/record-markdown/document-storage');

const read = file => fs.readFile(file, 'utf8');
const readLog = async file => (await read(file)).trimEnd().split('\n').map(line => JSON.parse(line));
const splitLines = source => source.match(/[^\n]*\n|[^\n]+$/g) || [];
async function fixture(work) {
  const root = await fs.mkdtemp('/private/tmp/hikari-notebook-log-');
  try { await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
function snapshot(root) {
  const protocol = { id: 'p', name: 'Protein', steps: [{ text: 'Mix.', placeholders: [] }] };
  return { settings: { storagePath: root }, protocols: [protocol], notebookEntries: [{
    id: 'n', projectName: 'Project', protocolName: 'Protein', protocolId: 'p', protocolSnapshot: structuredClone(protocol),
    experimentName: 'Experiment', result: 'Original notes', values: {},
    resultTables: [{ columns: [{ field: 'signal', title: 'Signal' }], rows: [{ signal: '12' }] }],
    toolCalculations: [{ id: 'c', title: 'Dilution', result: '12 µL', inputs: { volume: 12 } }]
  }] };
}

// Apply the logged edits independently to verify exact file contents.
function replay(previous, changes) {
  const before = splitLines(previous);
  const removals = new Set();
  const additions = new Map();
  for (const change of changes) {
    if (change.beforeLine !== null) {
      assert.equal(change.before, before[change.beforeLine - 1]);
      assert.equal(removals.has(change.beforeLine), false, 'old coordinate is unique');
      removals.add(change.beforeLine);
    } else assert.equal(change.before, null);
    if (change.afterLine !== null) {
      assert.equal(additions.has(change.afterLine), false, 'new coordinate is unique');
      additions.set(change.afterLine, change.after);
    } else assert.equal(change.after, null);
  }
  const unchanged = before.filter((_, index) => !removals.has(index + 1));
  let index = 0;
  return Array.from({ length: unchanged.length + additions.size }, (_, position) =>
    additions.has(position + 1) ? additions.get(position + 1) : unchanged[index++]).join('');
}

test('line changes contain exact old/new coordinates and untruncated text', () => {
  const long = `α ${'long note '.repeat(100)}`;
  assert.deepEqual(diff('first\nold\nkeep\nlast\n', `first\n${long}\nkeep\nend\n`), [
    { beforeLine: 2, afterLine: 2, before: 'old\n', after: `${long}\n` },
    { beforeLine: 4, afterLine: 4, before: 'last\n', after: 'end\n' }
  ]);
});

test('insertions and deletions omit unchanged shifted lines', () => {
  assert.deepEqual(diff('a\nb\nc\n', 'a\ninserted\nb\nc\n'), [
    { beforeLine: null, afterLine: 2, before: null, after: 'inserted\n' }
  ]);
  assert.deepEqual(diff('a\nremoved\nb\nc\n', 'a\nb\nc\n'), [
    { beforeLine: 2, afterLine: null, before: 'removed\n', after: null }
  ]);
  assert.deepEqual(diff('a\nb\nc\nd\ne\n', 'new\na\nb\nc\nchanged\ne\n'), [
    { beforeLine: null, afterLine: 1, before: null, after: 'new\n' },
    { beforeLine: 4, afterLine: 5, before: 'd\n', after: 'changed\n' }
  ]);
});

test('empty files, blank lines, CRLF and final newlines remain distinguishable', () => {
  assert.deepEqual(diff('', '\n'), [{ beforeLine: null, afterLine: 1, before: null, after: '\n' }]);
  assert.deepEqual(diff('x\n', ''), [{ beforeLine: 1, afterLine: null, before: 'x\n', after: null }]);
  assert.deepEqual(diff('x', 'x\n'), [{ beforeLine: 1, afterLine: 1, before: 'x', after: 'x\n' }]);
  assert.deepEqual(diff('x\r\n', 'x\n'), [{ beforeLine: 1, afterLine: 1, before: 'x\r\n', after: 'x\n' }]);
  assert.deepEqual(diff('same\n', 'same\n'), []);
});

test('repeated lines and randomized edits replay losslessly with a minimal diff', () => {
  let seed = 42;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 500; trial++) {
    const before = Array.from({ length: random(20) }, () => `${random(5)}\n`);
    const after = Array.from({ length: random(20) }, () => `${random(5)}\n`);
    const changes = diff(before.join(''), after.join(''));
    assert.equal(replay(before.join(''), changes), after.join(''));
    const lcs = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
    for (let i = before.length - 1; i >= 0; i--) {
      for (let j = after.length - 1; j >= 0; j--) {
        lcs[i][j] = before[i] === after[j] ? 1 + lcs[i + 1][j + 1] : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    assert.equal(before.length - changes.filter(change => change.beforeLine !== null).length, lcs[0][0]);
  }
  const large = Array.from({ length: 20000 }, (_, i) => `| ${i} | value |\n`);
  const changed = [...large]; changed[10000] = '| 10000 | measured |\n';
  assert.deepEqual(diff(large.join(''), changed.join('')), [
    { beforeLine: 10001, afterLine: 10001, before: large[10000], after: changed[10000] }
  ]);
  // Past the search cap the range is logged as a whole replacement, still lossless.
  const halfEdited = large.map((line, i) => i % 2 ? line : `| ${i} | edited |\n`).join('');
  assert.equal(replay(large.join(''), diff(large.join(''), halfEdited)), halfEdited);
});

test('saved Markdown, table values and calculation changes produce replayable line logs', async () => fixture(async root => {
  const state = snapshot(root);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  const file = saved.sidecarPaths.notebookPageFolderPaths[0];
  const log = path.join(path.dirname(file), 'page.log');
  const initial = await read(file);
  const [created] = await readLog(log);
  assert.deepEqual(Object.keys(created), ['ts', 'file', 'changes']);
  assert.ok(!Number.isNaN(Date.parse(created.ts)));
  assert.equal(created.file, 'page.md');
  assert.equal(replay('', created.changes), initial);
  await assert.rejects(fs.stat(path.join(path.dirname(saved.sidecarPaths.protocolFilePaths[0]), 'page.log')), { code: 'ENOENT' });
  const originalLog = await read(log);
  await syncBundleFromSnapshot({ snapshot: state });
  assert.equal(await read(log), originalLog, 'unchanged save creates no log record');
  state.notebookEntries[0].result = 'Revised notes\nAdditional observation';
  state.notebookEntries[0].resultTables[0].rows[0].signal = '99';
  state.notebookEntries[0].toolCalculations[0].inputs.volume = 99;
  state.notebookEntries[0].toolCalculations[0].result = '99 µL';
  await syncBundleFromSnapshot({ snapshot: state });
  const records = await readLog(log);
  assert.equal(records.length, 2, 'one diff per actual file commit');
  assert.equal(replay(initial, records[1].changes), await read(file));
  assert.ok(records[1].changes.some(change => change.before?.includes('| 12 |') && change.after?.includes('| 99 |')));
  assert.ok(records[1].changes.some(change => change.before === '12 µL\n' && change.after === '99 µL\n'));
}));

test('refreshing linked sample context records changes even when the notebook record is unchanged', async () => fixture(async root => {
  const state = snapshot(root);
  state.samples = [{ id: 's', name: 'Sample', details: { lot: 'Original lot' } }];
  state.notebookEntries[0].sampleLinks = [{ sampleId: 's', sampleName: 'Sample' }];
  const file = (await syncBundleFromSnapshot({ snapshot: state })).sidecarPaths.notebookPageFolderPaths[0];
  const previous = await read(file);
  state.samples[0].details.lot = 'Corrected lot';
  await syncBundleFromSnapshot({ snapshot: state });
  const records = await readLog(path.join(path.dirname(file), 'page.log'));
  assert.equal(records.length, 2);
  assert.equal(replay(previous, records[1].changes), await read(file));
  assert.ok(records[1].changes.some(change => change.before?.includes('Original lot') && change.after?.includes('Corrected lot')));
}));

test('workflow pages use the same Markdown log during queued saves', async () => fixture(async root => {
  const state = snapshot(root);
  state.workflowTemplates = [{ id: 't', name: 'Template' }];
  state.workflows = [{ id: 'w', name: 'Workflow', templateId: 't', notebookEntryIds: ['n'] }];
  state.notebookEntries[0].workflowContext = { workflowId: 'w', workflowEntryId: 'run', workflowBlockId: 'block' };
  await syncWorkflowRootFromSnapshot({ snapshot: state });
  const oldState = structuredClone(state);
  const newState = structuredClone(state);
  oldState.notebookEntries[0].result = 'First queued change';
  newState.notebookEntries[0].result = 'Second queued change';
  await Promise.all([syncWorkflowRootFromSnapshot({ snapshot: oldState }), syncWorkflowRootFromSnapshot({ snapshot: newState })]);
  async function findPage(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const target = path.join(folder, item.name);
      if (item.name === 'page.md') return target;
      if (item.isDirectory()) { const found = await findPage(target); if (found) return found; }
    }
  }
  const file = await findPage(path.join(root, 'Workflow'));
  const records = await readLog(path.join(path.dirname(file), 'page.log'));
  assert.equal(records.length, 3);
  assert.equal(records.reduce((source, record) => replay(source, record.changes), ''), await read(file));
  assert.equal((await readRecordDocument(file, 'notebook')).data.notebookEntry.result, 'Second queued change');
}));

test('old history is preserved; stale or failed Markdown commits append nothing', async () => fixture(async root => {
  const state = snapshot(root);
  const file = (await syncBundleFromSnapshot({ snapshot: state })).sidecarPaths.notebookPageFolderPaths[0];
  const log = path.join(path.dirname(file), 'page.log');
  const old = '{"ts":"2026-01-01T00:00:00.000Z","action":"create","details":{}}\n';
  await fs.writeFile(log, old);
  state.notebookEntries[0].result = 'Changed';
  await syncBundleFromSnapshot({ snapshot: state });
  assert.ok((await read(log)).startsWith(old));
  assert.equal((await readLog(log)).length, 2);
  const source = await read(file);
  const beforeLog = await read(log);
  await fs.appendFile(file, '\nExternal annotation.\n');
  const rendered = previous => ({ folderPath: path.dirname(file), markdownPath: file,
    previous, markdown: `${previous}\nStale save.\n`, assets: new Map(), manifest: {} });
  await assert.rejects(commitRecordMarkdown(rendered(source), { kind: 'notebook', canonical: true }), /Markdown changed while saving/);
  assert.equal(await read(log), beforeLog);
  const current = await read(file);
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (to === file) throw new Error('Injected Markdown commit failure'); return rename(from, to); };
  try {
    await assert.rejects(commitRecordMarkdown(rendered(current), { kind: 'notebook', canonical: true }), /Injected Markdown commit failure/);
  } finally { fs.rename = rename; }
  assert.equal(await read(log), beforeLog);
  assert.equal(await read(file), current);
}));

test('logging errors surface as warnings while the saved page remains successful', async () => fixture(async root => {
  const state = snapshot(root);
  const file = (await syncBundleFromSnapshot({ snapshot: state })).sidecarPaths.notebookPageFolderPaths[0];
  const log = path.join(path.dirname(file), 'page.log');
  await fs.rm(log);
  await fs.mkdir(log);
  state.notebookEntries[0].result = 'Durably saved despite the blocked log';
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  assert.deepEqual(saved.sidecarPaths.skippedRecords, []);
  assert.ok(saved.sidecarPaths.markdownWarnings.some(warning => /page.log could not be written/.test(warning)));
  assert.equal((await readRecordDocument(file, 'notebook')).data.notebookEntry.result, state.notebookEntries[0].result);
}));
