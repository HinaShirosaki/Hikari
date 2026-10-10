'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration');
const { block, blocks } = require('../src/main/storage/record-markdown/document-fields');

const script = path.resolve(__dirname, '../scripts/maintenance/migrate-record-markdown.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=', 'base64');
const image = `data:image/png;base64,${png.toString('base64')}`;
const read = file => fs.readFile(file, 'utf8');
async function writeJson(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
}
function run(...args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);
  return result;
}
function report(...args) {
  const result = run(...args, '--json');
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function fixture(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-legacy-cli-'));
  try { await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function inventory(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const stat = await fs.stat(file);
      files.push([path.relative(root, file), stat.mtimeMs, entry.isFile() ? (await fs.readFile(file)).toString('base64') : null]);
      if (entry.isDirectory()) await walk(file);
    }
  }
  await walk(root);
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}
function legacy(root) {
  const protocol = { id: 'p', name: 'Old protocol', description: 'Legacy purpose', materials: ['PBS'], steps: ['Legacy string step'] };
  return { schema_version: '0.1', settings: { storagePath: root }, protocols: [protocol], notebookPages: [{
    id: 'n', projectId: 'proj', projectName: 'Old project', protocolId: 'p', protocolName: protocol.name,
    protocolSnapshot: protocol, result: 'Legacy observation αβγ', assayIds: ['a'], gelIds: ['g'], sampleLinks: [{ sampleId: 's' }],
    resultTable: { columns: [{ field: 'signal', title: 'Signal' }], rows: [{ signal: '=SUM(A1:A2)' }] },
    toolCalculations: [{ title: 'Buffer Preparer', inputs: { pH: 7.4 }, table: { headers: ['Chemical', 'Volume'], rows: [['NaCl', '3 mL']], footerRows: [['Water', '97 mL']] } }],
    resultFileRecords: [{ name: 'data.csv', relativePath: 'data.csv' }], image
  }], assays: [{ id: 'a', name: 'Old assay', wellLayout: [{ well: 'A1', sampleId: 'Sample A' }], resultValues: { A1: 12 }, latestAnalysis: { chartDataUrl: image } }],
    gelAnalyses: [{ id: 'g', name: 'Old gel', parameters: { background: 'rolling ball' }, previewImageDataUrl: image }],
    samples: [{ id: 's', name: 'Sample A', details: { lot: 'Lot 123' } }]
  };
}

test('migration CLI explains usage and rejects ambiguous arguments', () => {
  assert.equal(run('--help').status, 0);
  assert.match(run('--help').stdout, /workspace-directory\|legacy\.json/);
  for (const args of [[], ['--typo'], ['one', 'two']]) assert.equal(run(...args).status, 1);
});

test('JSON-file dry run validates complete legacy context without creating or modifying anything', async () => fixture(async root => {
  const file = path.join(root, 'old snapshot.json');
  await writeJson(file, legacy(root));
  await fs.writeFile(path.join(root, 'data.csv'), 'signal\n12\n');
  const before = await inventory(root);
  const planned = report(file, '--dry-run');
  assert.equal(planned.dryRun, true);
  assert.deepEqual([planned.protocols, planned.notebooks], [1, 1]);
  assert.ok(planned.markdownPaths.every(output => output.endsWith('.md')));
  assert.deepEqual(await inventory(root), before);
  assert.match(run(file, '--dry-run').stdout, /No files were written/);
}));

test('old JSON files produce current Markdown with tables, calculations, linked records, files and images', async () => fixture(async root => {
  const file = path.join(root, 'old.json');
  const source = legacy(root);
  await writeJson(file, source);
  await fs.writeFile(path.join(root, 'data.csv'), 'signal\n12\n');
  const before = await read(file);
  const migrated = report(file);
  assert.deepEqual([migrated.protocols, migrated.notebooks], [1, 1]);
  const protocol = await read(migrated.markdownPaths.find(output => output.endsWith('protocol.md')));
  assert.match(protocol, /Legacy purpose/);
  assert.match(protocol, /Legacy string step/);
  const page = await read(migrated.markdownPaths.find(output => output.endsWith('page.md')));
  for (const needle of ['Legacy observation αβγ', '=SUM(A1:A2)', 'Buffer Preparer', '7.4', 'NaCl', '3 mL', '97 mL', '### Old assay', '| A1 | Sample A |  | 12 |', '### Old gel', 'rolling ball', 'Lot 123', 'data.csv']) assert.ok(page.includes(needle), needle);
  assert.doesNotMatch(page, /Source JSON|```json|base64,/);
  assert.match(page, /!\[/);
  for (const match of page.matchAll(/\[[^\n]*?\]\(<([^>]+)>\)/g)) assert.ok((await fs.stat(path.resolve(path.dirname(migrated.markdownPaths.find(output => output.endsWith('page.md'))), decodeURIComponent(match[1])))).isFile());
  assert.equal(await read(file), before);
  const hydrated = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.equal(hydrated.notebookEntries[0].result, source.notebookPages[0].result);
  assert.deepEqual(hydrated.notebookEntries[0].toolCalculations, source.notebookPages[0].toolCalculations);
}));

test('directory migration supports legacy aggregate sidecars and wrapped standalone records', async () => fixture(async root => {
  await writeJson(path.join(root, 'old.protocols.json'), { protocols: [{ id: 'p', name: 'Sidecar protocol', steps: ['Mix.'] }] });
  await writeJson(path.join(root, 'old.notebook-pages.json'), { notebookPages: [{ id: 'n', projectName: 'Project', protocolId: 'p', result: 'Sidecar notes' }] });
  await writeJson(path.join(root, 'single-protocol.json'), { protocol: { id: 'p2', name: 'Wrapped protocol', steps: ['Add water.'] } });
  await writeJson(path.join(root, 'single-notebook.json'), { notebookEntry: { id: 'n2', projectName: 'Project', result: 'Wrapped notes' } });
  const migrated = report(root);
  assert.deepEqual([migrated.protocols, migrated.notebooks], [2, 2]);
  assert.match(run(root).stdout, /Migrated 2 protocol\(s\) and 2 notebook page\(s\)/);
}));

test('nested record inputs retain workspace-relative context, one-time backups and authored Markdown', async () => fixture(async root => {
  const file = path.join(root, 'Project', 'P', 'Notebook', 'N', 'page.json');
  const neighbor = path.join(root, 'Protocol', 'Other__p', 'protocol.json');
  await writeJson(file, { notebookEntry: { id: 'n', projectName: 'P', result: 'Original notes', resultFileRecords: [{ name: 'data.csv', relativePath: 'data.csv' }] } });
  await writeJson(neighbor, { protocol: { id: 'p', name: 'Other', steps: ['Mix.'] } });
  await fs.writeFile(path.join(root, 'data.csv'), 'signal\n12\n');
  const before = await read(file);
  const neighborBefore = await read(neighbor);
  assert.deepEqual([report(file, '--dry-run').protocols, report(file, '--dry-run').notebooks], [0, 1]);
  const migrated = report(file);
  assert.equal(migrated.storageRoot, await fs.realpath(root));
  assert.deepEqual(migrated.markdownPaths, [await fs.realpath(file.replace(/\.json$/, '.md'))]);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const backup = file.replace(/\.json$/, '.pre-markdown.json');
  assert.equal(await read(backup), before);
  const md = migrated.markdownPaths[0];
  const text = await read(md);
  assert.match(text, /\]\(<\.\.\/\.\.\/\.\.\/\.\.\/data\.csv>\)/);
  await fs.writeFile(md, text.replace(blocks(text).get('result').source, block('field', 'result', '## Notes and results\n\nAuthored Markdown notes.')) + '\n## Personal annotation\n\nKeep this.\n');
  report(file);
  assert.match(await read(md), /Authored Markdown notes/);
  assert.match(await read(md), /Keep this/);
  assert.equal(await read(backup), before);
  assert.equal(await read(neighbor), neighborBefore);
  await assert.rejects(fs.stat(neighbor.replace(/\.json$/, '.md')), { code: 'ENOENT' });
}));

test('malformed, unsupported and colliding inputs fail before writing outputs', async () => fixture(async root => {
  const file = path.join(root, 'old.json');
  for (const contents of ['{broken', JSON.stringify({ random: 'not a Hikari record' }), JSON.stringify({ protocols: [{ name: 'Missing ID' }] }),
    JSON.stringify({ protocols: [{ id: 'a/b', name: 'Same' }, { id: 'a_b', name: 'Same' }] }), JSON.stringify({ protocols: 'invalid collection' }),
    JSON.stringify({ notebookPages: [null] }), JSON.stringify({ protocols: [{ id: 'p', name: 'One' }, { id: 'p', name: 'Two' }] })]) {
    await fs.writeFile(file, contents);
    const before = await inventory(root);
    assert.equal(run(file).status, 1);
    assert.deepEqual(await inventory(root), before);
  }
}));

test('existing user-owned Markdown is preserved and aborts migration before legacy records change', async () => fixture(async root => {
  const file = path.join(root, 'Protocol', 'P__p', 'protocol.json');
  const md = file.replace(/\.json$/, '.md');
  await writeJson(file, { protocol: { id: 'p', name: 'P', steps: ['Mix.'] } });
  await fs.writeFile(md, 'A user-owned document.');
  const before = await inventory(root);
  assert.match(run(root).stderr, /user-owned Markdown/);
  assert.deepEqual(await inventory(root), before);
}));

test('workflow snapshot migration produces normally discoverable current pages', async () => fixture(async root => {
  const source = legacy(root);
  source.workflowTemplates = [{ id: 't', name: 'Old template' }];
  source.workflows = [{ id: 'w', name: 'Old workflow', templateId: 't', notebookEntryIds: ['n'] }];
  source.notebookPages[0].workflowContext = { workflowId: 'w', workflowEntryId: 'run' };
  const file = path.join(root, 'old.json');
  await writeJson(file, source);
  const before = await inventory(root);
  assert.ok(report(file, '--dry-run').markdownPaths.some(output => output.includes(`${path.sep}Workflow${path.sep}`)));
  assert.deepEqual(await inventory(root), before);
  report(file);
  const hydrated = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.equal(hydrated.workflows.length, 1);
  assert.equal(hydrated.notebookEntries[0].result, source.notebookPages[0].result);
}));

test('single notebook sidecars load sibling legacy context without migrating sibling records', async () => fixture(async root => {
  const protocolFile = path.join(root, 'old.protocols.json');
  const contextFile = path.join(root, 'hikari-data.json');
  const selectedFile = path.join(root, 'old.notebook-pages.json');
  await writeJson(protocolFile, { protocols: [{ id: 'p', name: 'Sibling protocol', purpose: 'Sibling scientific purpose', steps: ['Mix carefully.'] }] });
  await writeJson(contextFile, { settings: {}, assays: [{ id: 'a', name: 'Sibling assay', resultValues: { A1: 42 } }] });
  await writeJson(selectedFile, { notebookPages: [{ id: 'n', projectName: 'P', protocolId: 'p', result: 'Selected notes', assayIds: ['a'] }] });
  const original = await Promise.all([read(protocolFile), read(contextFile), read(selectedFile)]);
  const migrated = report(selectedFile);
  assert.deepEqual([migrated.protocols, migrated.notebooks], [0, 1]);
  const md = await read(migrated.markdownPaths[0]);
  assert.match(md, /Sibling scientific purpose/);
  assert.match(md, /Mix carefully/);
  assert.match(md, /Sibling assay/);
  assert.match(md, /\| A1 \|  \|  \| 42 \|/);
  assert.deepEqual(await Promise.all([read(protocolFile), read(contextFile), read(selectedFile)]), original);
  await assert.rejects(fs.stat(path.join(root, 'Protocol')), { code: 'ENOENT' });
}));
