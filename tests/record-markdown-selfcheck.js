'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { syncWorkflowRootFromSnapshot } = require('../src/main/storage/workflow-storage');
const { GENERATED_MARKER, writeRecordMarkdown } = require('../src/main/storage/record-markdown');
const { rebuildRecordMarkdown } = require('../src/main/storage/record-markdown/rebuild');
const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration');
const { importStorageRoot } = require('../src/main/storage/storage-import');
const { readRecordDocument } = require('../src/main/storage/record-markdown/document-storage');
const { block, blocks, documentMarker } = require('../src/main/storage/record-markdown/document-fields');
const { buildNotebookMemorySource } = require('../src/main/project-memory/notebook-sources');
const { createAgentNotebookLookupRuntime } = require('../src/main/agent/tools/agent-notebook-lookup');
const { createMainDataHelpers } = require('../src/main/data/data-helpers');
const { writeRecordDocument } = require('../src/main/storage/record-markdown/document-storage');
const { createProtocolSaveRuntime } = require('../src/main/agent/tools/agent-protocol-save');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const read = file => fs.readFile(file, 'utf8');
const readJson = async file => JSON.parse(await read(file));
async function writeJson(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
}
async function fixture(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-record-markdown-'));
  try { await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

function richSnapshot(root) {
  const protocol = {
    id: 'p1', name: 'Protein assay', purpose: 'Compare signal', materials: ['PBS', 'Sample'],
    steps: [{ text: 'Add {{ph:amount}} to {{ph:sample}}.', placeholders: [{ id: 'amount', name: 'Volume' }, { id: 'sample', name: 'Protein' }] }],
    troubleshooting: 'Avoid bubbles', aliases: ['Fluorescence'], customField: { provenance: 'paper DOI 10/example' }
  };
  return {
    settings: { storagePath: root, pluginStorage: { gel: { gelAnalyses: [{
      id: 'g1', name: 'Linked gel', notebookEntryId: 'n1', analysisType: 'sds-page',
      recordJsonPath: 'g1/gel-record.json', analysisResultPath: 'g1/analysis-result.json',
      previewImagePath: 'g1/preview.png'
    }] } } },
    projects: [{ id: 'proj', name: 'Protein project' }], protocols: [protocol],
    notebookEntries: [{
      id: 'n1', experimentName: 'Experiment A', projectId: 'proj', projectName: 'Protein project',
      protocolId: 'p1', protocolName: 'Protein assay', protocolSnapshot: { ...protocol, purpose: 'Saved historical purpose' },
      values: { amount: '10 µL', sample: 'PT-179', unused: 0 }, notebookState: 'executed', executedAt: '2026-10-03T15:00:00Z',
      result: 'Results\nSecond line with **emphasis** and `code`.',
      resultTables: [
        { title: 'Signal', columns: [{ field: 'name', title: 'Sample | ID' }, { field: 'v', title: 'Reading' }], rows: [{ id: 'r1', name: 'PT|179\nreplicate', v: '0' }, { id: 'r2', name: 'Total', v: '=SUM(B1:B1)' }] },
        { columns: [{ field: 'x', title: 'Second table' }], rows: [{ id: 'r1', x: '=Table1:B2' }] }
      ],
      toolCalculations: [{
        id: 'buf1', type: 'buffer', mode: 'recipe', title: 'Buffer Preparer',
        inputs: { volumeValue: '100', volumeUnit: 'mL', pH: '7.4', rows: [{ name: 'NaCl', molecularWeight: '58.44', stockConcentration: '5 M', finalConcentration: '150 mM', note: 'Lot 123' }] },
        table: { caption: 'Buffer Preparer', headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume', 'Note'],
          metaRows: [['Volume', '100 mL', 'pH', '7.4', '', '']], rows: [['NaCl', '58.44', '5 M', '150 mM', '3 mL', 'Lot 123']], footerRows: [['Solvent to add 97 mL', '', '', '', '', '']] },
        result: 'Prepare 100 mL', formula: 'C1 V1 = C2 V2', status: 'ok'
      }, {
        id: 'rxn1', type: 'fixed-reaction', title: 'Fixed Volume Reaction', inputs: { totalVolume: '50 µL' },
        table: { headers: ['Reagent', 'Volume'], rows: [['DNA', '2 µL']], footerRows: [['Water', '48 µL']] }
      }],
      sampleLinks: [{ sampleId: 's1', sampleName: 'PT-179', placeholderId: 'sample' }],
      assayIds: ['a1'], gelIds: ['g1'], resultFiles: ['image [1].png', 'raw.csv', 'legacy.txt'],
      resultFileRecords: [{ name: 'image [1].png', relativePath: 'artifacts/image [1].png', mimeType: 'image/png', size: png.length }, { name: 'raw.csv', relativePath: 'artifacts/raw.csv', size: 21 }],
      selectionInsights: { source: 'Important scientific provenance' }, futureField: { untouched: 'all additional metadata' }
    }],
    samples: [{ id: 's1', name: 'PT-179', details: { lot: 'ABC', concentration: '1 mg/mL' } }],
    assays: [{ id: 'a1', name: 'Plate experiment', notebookEntryId: 'n1', plateLabel: '96 well plate', concentrationUnit: 'µM',
      wellLayout: [{ well: 'A1', sampleId: 'PT-179', concentration: '2.5' }], resultValues: { A1: 0, A2: '0.15' },
      latestAnalysis: { method: 'linear', summary: 'Slope 1.2', chartDataUrl: dataUrl, coefficients: { slope: 1.2 } },
      serialDilutionSummary: { volumePerWellUl: 100, initialDilutionRows: [{ sample: 'PT-179', stockVolume: '10 µL', bufferVolume: '90 µL' }], followingDilutionRows: [{ step: 'A2', targetConcentration: '1.25 µM', finalVolume: '100 µL' }] },
      resultAttachments: [{ name: 'raw.csv', relativePath: 'artifacts/raw.csv' }]
    }],
    gelAnalyses: [{ id: 'g1', name: 'Stale legacy gel' }]
  };
}

async function prepare(root) {
  const snapshot = richSnapshot(root);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts', 'image [1].png'), png);
  await fs.writeFile(path.join(root, 'artifacts', 'raw.csv'), 'well,value\nA1,0\n');
  const gelFolder = path.join(root, 'Plugins', 'gel', 'g1');
  await writeJson(path.join(gelFolder, 'gel-record.json'), { id: 'g1', parameters: { background: 'rolling ball' }, manualOverrides: { lane: 2 } });
  await writeJson(path.join(gelFolder, 'analysis-result.json'), { lanes: [{ lane: 1, sample: 'PT-179', bands: [{ massKDa: 42, intensity: 987 }] }] });
  await fs.writeFile(path.join(gelFolder, 'preview.png'), png);
  return snapshot;
}

function assertReadableMarkdown(markdown) {
  assert.doesNotMatch(markdown, /Source JSON context|Complete assay data|Complete gel data|^`{3,}json\b/m);
  assert.doesNotMatch(markdown, /"(?:notebookEntry|protocolSnapshot|chartDataUrl)"\s*:/);
  assert.doesNotMatch(markdown, /Placeholder ID|\| Project ID \||\| Protocol ID \||\| Schema version \|/);
}

async function editField(filePath, field, content) {
  const source = await read(filePath);
  const old = blocks(source).get(field);
  assert.ok(old, `missing ${field}`);
  await fs.writeFile(filePath, source.replace(old.source, block('field', field, content)));
}

test('CRLF documents remain editable and saveable after an external editor rewrites line endings', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  for (const file of [saved.sidecarPaths.protocolFilePaths[0], saved.sidecarPaths.notebookPageFolderPaths[0]]) {
    const md = file.replace(/\.json$/, '.md');
    await fs.writeFile(md, (await read(md)).replace(/\n/g, '\r\n'));
  }
  await syncBundleFromSnapshot({ snapshot });
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.notebookEntries[0].result, snapshot.notebookEntries[0].result);
  assert.equal(loaded.snapshot.protocols[0].steps[0].text, snapshot.protocols[0].steps[0].text);
}));

test('a burst of 100 captured renderer edits reaches disk in order', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const state = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'Burst', purpose: '0', steps: [] }], notebookEntries: [] };
  const api = { autoSaveDataFile: async snapshot => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot }) }) };
  await syncMarkdownRecordState(api, state);
  const pending = [];
  for (let i = 1; i <= 100; i++) {
    state.protocols[0].purpose = String(i);
    pending.push(syncMarkdownRecordState(api, state));
  }
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter(result => result.status === 'rejected').length, 0);
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.protocols[0].purpose, '100');
}));

test('externally edited steps retain every repeated placeholder binding', async () => fixture(async root => {
  const payload = { protocol: { id: 'p', name: 'Repeat', steps: [{ id: 'step', text: 'Mix {{ph:v}}, then add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume' }] }] } };
  const filePath = path.join(root, 'protocol.json');
  await writeRecordDocument({ filePath, payload, kind: 'protocol', storageRoot: root });
  await editField(filePath.replace(/\.json$/, '.md'), 'steps', '## Steps\n\n<!-- hikari-step:0 -->\n1. Slowly mix [Volume], then add [Volume].');
  const loaded = await readRecordDocument(filePath, 'protocol');
  assert.equal(loaded.data.protocol.steps[0].text, 'Slowly mix {{ph:v}}, then add {{ph:v}}.');
  assert.deepEqual(loaded.data.protocol.steps[0].placeholders, payload.protocol.steps[0].placeholders);
}));

test('an interrupted JSON checkpoint cannot bind new step positions to the old step metadata', async () => fixture(async root => {
  const filePath = path.join(root, 'protocol.json');
  const payload = { protocol: { id: 'p', name: 'Interrupted', steps: [{ id: 'old', text: 'Add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume' }] }] } };
  await writeRecordDocument({ filePath, payload, kind: 'protocol', storageRoot: root });
  const changed = { protocol: { ...(await readRecordDocument(filePath, 'protocol')).data.protocol } };
  changed.protocol.steps.unshift({ id: 'new', text: 'Prepare tubes.', placeholders: [] });
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === filePath) throw Object.assign(new Error('Injected checkpoint failure'), { code: 'EIO' });
    return rename(from, to);
  };
  try { await assert.rejects(writeRecordDocument({ filePath, payload: changed, kind: 'protocol', storageRoot: root }), /Injected checkpoint failure/); }
  finally { fs.rename = rename; }
  const loaded = await readRecordDocument(filePath, 'protocol');
  assert.deepEqual(loaded.data.protocol.steps, changed.protocol.steps);
  await writeRecordDocument({ filePath, payload: loaded.data, kind: 'protocol', storageRoot: root });
  assert.deepEqual((await readRecordDocument(filePath, 'protocol')).data.protocol.steps, changed.protocol.steps);
}));

test('a notebook conflict skips only that page while the protocol and export still save', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const target = path.join(root, 'export.json');
  const helpers = createMainDataHelpers({ fs, path, hasSupportedDataExtension: () => true, syncBundleFromSnapshot });
  const saved = await helpers.saveSelectedDataFile({ data: snapshot, filePath: target });
  assert.equal(saved.ok, true);
  const protocolFile = saved.sidecarPaths.protocolFilePaths[0];
  const notebookFile = saved.sidecarPaths.notebookPageFolderPaths[0];
  await editField(notebookFile.replace(/\.json$/, '.md'), 'result', '## Notes and results\n\nExternal competing result.');
  const notebookBefore = await Promise.all([read(notebookFile), read(notebookFile.replace(/\.json$/, '.md'))]);
  snapshot.protocols[0].purpose = 'New purpose saved despite the notebook conflict.';
  snapshot.notebookEntries[0].result = 'Competing app result.';
  const result = await helpers.saveSelectedDataFile({ data: snapshot, filePath: target });
  assert.equal(result.ok, true);
  assert.deepEqual(result.sidecarPaths.skippedRecords.map(record => [record.kind, record.id]), [['notebook', 'n1']]);
  assert.match(result.sidecarPaths.skippedRecords[0].message, /changed in Hikari and in .*page\.md/);
  assert.deepEqual(await Promise.all([read(notebookFile), read(notebookFile.replace(/\.json$/, '.md'))]), notebookBefore);
  assert.equal((await readRecordDocument(protocolFile, 'protocol')).data.protocol.purpose, snapshot.protocols[0].purpose);
  assert.match(await read(target), /New purpose saved despite the notebook conflict/);
}));

test('damaged derived section markers are reported during consumption', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  const md = filePath.replace(/\.json$/, '.md');
  await fs.writeFile(md, (await read(md)).replace('<!-- /hikari-derived:context -->', '<!-- broken -->'));
  const loaded = await readRecordDocument(filePath, 'notebook');
  assert.equal(loaded.markdownLoaded, false);
  assert.match(loaded.warnings.join('\n'), /Incomplete Markdown derived section/);
}));

test('every interrupted record write returns a coherent old or new pair and supports retry', async () => fixture(async root => {
  const phases = ['protocol.json.pending', 'protocol.md', 'manifest.json', 'protocol.json'];
  for (const existing of [false, true]) {
    for (const phase of phases) {
      const folder = path.join(root, `${existing}-${phase}`);
      const filePath = path.join(folder, 'protocol.json');
      const old = { id: 'p', name: 'Fault test', purpose: 'Old', steps: [{ id: 's1', text: 'Add {{ph:x}}.', placeholders: [{ id: 'x', name: 'Amount' }] }], image: dataUrl };
      if (existing) await writeRecordDocument({ filePath, payload: { protocol: old }, kind: 'protocol', storageRoot: root });
      // A new image makes the manifest change too, so every write phase runs.
      const next = { ...old, purpose: 'New', image: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
        steps: [{ id: 's0', text: 'Prepare.', placeholders: [] }, ...old.steps] };
      const rename = fs.rename;
      fs.rename = async (from, to) => {
        if (to.endsWith(`/${phase}`)) throw Object.assign(new Error(`Injected ${phase}`), { code: 'EIO' });
        return rename(from, to);
      };
      try { await assert.rejects(writeRecordDocument({ filePath, payload: { protocol: next }, kind: 'protocol', storageRoot: root }), /Injected/); }
      finally { fs.rename = rename; }
      const loaded = await readRecordDocument(filePath, 'protocol');
      const advanced = phase === 'manifest.json' || phase === 'protocol.json';
      assert.equal(loaded.ok, existing || advanced);
      if (loaded.ok) {
        assert.deepEqual(loaded.data.protocol.steps, advanced ? next.steps : old.steps);
        assert.equal(loaded.data.protocol.purpose, advanced ? next.purpose : old.purpose);
      }
      await writeRecordDocument({ filePath, payload: { protocol: next }, kind: 'protocol', storageRoot: root });
      assert.deepEqual((await readRecordDocument(filePath, 'protocol')).data.protocol.steps, next.steps);
      await assert.rejects(fs.stat(`${filePath}.pending`), { code: 'ENOENT' });
      const files = await fs.readdir(folder);
      assert.ok(!files.some(file => file.endsWith('.tmp')));
    }
  }
}));

test('legacy callers cannot misbind externally inserted steps on subsequent saves', async () => fixture(async root => {
  const state = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'Legacy', steps: [{ id: 's', text: 'Add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume' }] }] }] };
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  const file = saved.sidecarPaths.protocolFilePaths[0];
  await editField(file.replace(/\.json$/, '.md'), 'steps', '## Steps\n\n1. Prepare tubes.\n\n<!-- hikari-step:0 -->\n2. Add [Volume].');
  for (let i = 0; i < 3; i++) await syncBundleFromSnapshot({ snapshot: state });
  const steps = (await readRecordDocument(file, 'protocol')).data.protocol.steps;
  assert.equal(steps[0].text, 'Prepare tubes.');
  assert.deepEqual(steps[0].placeholders, []);
  assert.equal(steps[1].id, 's');
  assert.equal(steps[1].text, 'Add {{ph:v}}.');
}));

test('snapshot-only workflow migration produces pages discoverable by normal import and hydration', async () => fixture(async root => {
  const state = richSnapshot(root);
  state.workflowTemplates = [{ id: 't', name: 'Legacy template' }];
  state.workflows = [{ id: 'w', name: 'Legacy run', templateId: 't', notebookEntryIds: ['n1'] }];
  state.notebookEntries[0].workflowContext = { workflowId: 'w', workflowEntryId: 'run' };
  await writeJson(path.join(root, 'legacy.json'), state);
  await rebuildRecordMarkdown(root, { migrate: true });
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.notebookEntries.length, 1);
  assert.equal(loaded.snapshot.workflows.length, 1);
  const imported = await importStorageRoot({ storagePath: root });
  assert.equal(imported.statePatch.notebookEntries[0].result, state.notebookEntries[0].result);
}));

test('first workflow-page checkpoint failure is recoverable through normal folder hydration', async () => fixture(async root => {
  const state = richSnapshot(root);
  state.workflowTemplates = [{ id: 't', name: 'Template' }];
  state.workflows = [{ id: 'w', name: 'Run', templateId: 't', notebookEntryIds: ['n1'] }];
  state.notebookEntries[0].workflowContext = { workflowId: 'w', workflowEntryId: 'run' };
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to.endsWith('/page.json')) throw new Error('Injected first workflow checkpoint failure');
    return rename(from, to);
  };
  try {
    const result = await syncWorkflowRootFromSnapshot({ snapshot: state, storagePath: root });
    assert.match(result.skippedRecords[0].message, /Injected first workflow/);
  } finally { fs.rename = rename; }
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.notebookEntries.length, 1);
  assert.equal(loaded.snapshot.notebookEntries[0].result, state.notebookEntries[0].result);
}));

test('disjoint client edits merge and exported JSON contains the effective Markdown prose', async () => fixture(async root => {
  const state = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  const first = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  const second = structuredClone(first);
  first.protocols[0].purpose = 'First client purpose';
  second.protocols[0].troubleshooting = 'Second client troubleshooting';
  await syncBundleFromSnapshot({ snapshot: first });
  const target = path.join(root, 'portable.json');
  const helpers = createMainDataHelpers({ fs, path, hasSupportedDataExtension: () => true, syncBundleFromSnapshot });
  assert.equal((await helpers.saveSelectedDataFile({ data: second, filePath: target })).ok, true);
  const exported = await readJson(target);
  assert.equal(exported.protocols[0].purpose, 'First client purpose');
  assert.equal(exported.protocols[0].troubleshooting, 'Second client troubleshooting');
  assert.equal((await readRecordDocument(saved.sidecarPaths.protocolFilePaths[0], 'protocol')).data.protocol.purpose, 'First client purpose');
}));

test('colliding normalized destination names are rejected before either record is written', async () => fixture(async root => {
  const state = { settings: { storagePath: root }, protocols: [{ id: 'a/b', name: 'Same', steps: [] }, { id: 'a_b', name: 'Same', steps: [] }] };
  await assert.rejects(syncBundleFromSnapshot({ snapshot: state }), /Conflicting records/);
  await assert.rejects(fs.stat(path.join(root, 'Protocol', 'Same__a_b', 'protocol.json')), { code: 'ENOENT' });
}));

test('a consumer overlapping a completed save never pairs old JSON with new Markdown', async () => fixture(async root => {
  const filePath = path.join(root, 'protocol.json');
  const old = { id: 'p', name: 'Overlap', steps: [{ id: 's1', text: 'Add {{ph:x}}.', placeholders: [{ id: 'x', name: 'Amount' }] }] };
  await writeRecordDocument({ filePath, payload: { protocol: old }, kind: 'protocol', storageRoot: root });
  const next = { ...old, steps: [{ id: 's0', text: 'Prepare.', placeholders: [] }, ...old.steps] };
  const readFile = fs.readFile;
  let injected = false;
  fs.readFile = async (...args) => {
    const bytes = await readFile(...args);
    if (args[0] === filePath && !injected) {
      injected = true;
      await writeRecordDocument({ filePath, payload: { protocol: next }, kind: 'protocol', storageRoot: root });
    }
    return bytes;
  };
  let loaded;
  try { loaded = await readRecordDocument(filePath, 'protocol'); }
  finally { fs.readFile = readFile; }
  assert.deepEqual(loaded.data.protocol.steps, next.steps);
}));

test('agent protocol save returns and emits the merged record that consumers will read', async () => fixture(async root => {
  const state = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  const file = saved.sidecarPaths.protocolFilePaths[0];
  let emitted;
  const runtime = createProtocolSaveRuntime({ hydrateSnapshotFromBundle, emitProtocolSaved: payload => { emitted = payload; },
    syncBundleFromSnapshot: async input => {
      await editField(file.replace(/\.json$/, '.md'), 'purpose', '## Purpose\n\nExternal edit while the agent prepares its update.');
      return syncBundleFromSnapshot(input);
    } });
  const result = await runtime.saveProtocol({ protocol: { id: 'p1', name: 'Protein assay', steps: state.protocols[0].steps, troubleshooting: 'Agent troubleshooting update.' }, upsert: true }, { snapshot: state });
  assert.equal(result.ok, true);
  const disk = (await readRecordDocument(file, 'protocol')).data.protocol;
  assert.equal(disk.troubleshooting, 'Agent troubleshooting update.');
  assert.equal(result.protocol.purpose, disk.purpose);
  assert.equal(emitted.protocol.purpose, disk.purpose);
  assert.deepEqual(result.protocol.markdownRevision.fields, disk.markdownRevision.fields);
}));

test('an agent protocol save that is skipped reports failure instead of success', async () => fixture(async root => {
  const state = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  const file = saved.sidecarPaths.protocolFilePaths[0];
  let emitted = null;
  const runtime = createProtocolSaveRuntime({ hydrateSnapshotFromBundle, emitProtocolSaved: payload => { emitted = payload; },
    syncBundleFromSnapshot: async input => {
      await editField(file.replace(/\.json$/, '.md'), 'purpose', '## Purpose\n\nExternal purpose while the agent saves.');
      return syncBundleFromSnapshot(input);
    } });
  const result = await runtime.saveProtocol({ protocol: { id: 'p1', name: 'Protein assay', purpose: 'Agent purpose.', steps: state.protocols[0].steps }, upsert: true }, { snapshot: state });
  assert.equal(result.ok, false);
  assert.match(result.error, /changed in Hikari and in/);
  assert.equal(emitted, null);
  assert.equal((await readRecordDocument(file, 'protocol')).data.protocol.purpose, 'External purpose while the agent saves.');
}));

test('unknown step anchors recover the checkpoint rather than dropping parameter identities', async () => fixture(async root => {
  const filePath = path.join(root, 'protocol.json');
  const protocol = { id: 'p', name: 'Anchors', steps: [{ id: 's', text: 'Add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume' }] }] };
  await writeRecordDocument({ filePath, payload: { protocol }, kind: 'protocol', storageRoot: root });
  await editField(filePath.replace(/\.json$/, '.md'), 'steps', '## Steps\n\n<!-- hikari-step:99 -->\n1. Slowly add [Volume].');
  const loaded = await readRecordDocument(filePath, 'protocol');
  assert.equal(loaded.markdownLoaded, false);
  assert.deepEqual(loaded.data.protocol.steps, protocol.steps);
  assert.match(loaded.warnings.join('\n'), /Unknown protocol step marker/);
}));

test('duplicate record IDs cannot create ambiguous Markdown documents', async () => fixture(async root => {
  const snapshot = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'First', steps: [] }, { id: 'p', name: 'Second', steps: [] }] };
  await assert.rejects(syncBundleFromSnapshot({ snapshot }), /Duplicate protocol ID/);
  await assert.rejects(fs.stat(path.join(root, 'Protocol')), { code: 'ENOENT' });
}));

test('renderer retries survive failed acknowledgments and thrown IPC failures', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const state = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'Retry', purpose: 'First', steps: [] }] };
  let call = 0;
  const api = { autoSaveDataFile: async snapshot => {
    call++;
    if (call === 1) return { ok: false, error: 'Injected failed acknowledgment' };
    if (call === 2) throw new Error('Injected IPC failure');
    return { ok: true, ...await syncBundleFromSnapshot({ snapshot }) };
  } };
  assert.equal((await syncMarkdownRecordState(api, state)).ok, false);
  assert.equal(state.protocols[0].markdownRevision, undefined);
  await assert.rejects(syncMarkdownRecordState(api, state), /Injected IPC failure/);
  state.protocols[0].purpose = 'Retry succeeded';
  assert.equal((await syncMarkdownRecordState(api, state)).ok, true);
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.protocols[0].purpose, 'Retry succeeded');
}));

test('protocol editor saves retain scientific provenance and other fields owned by producers', async () => fixture(async root => {
  const { createProtocolEditorActions } = await import('../src/renderer/modules/protocol/editor-actions.js');
  const state = await prepare(root);
  const prior = structuredClone(state.protocols[0]);
  const noop = () => {};
  const editor = createProtocolEditorActions({ state, ui: {}, persist: noop, createId: () => 'new',
    localState: { currentProtocolDraft: prior }, draftHelpers: { normalizeIsoTimestamp: (_value, fallback) => fallback },
    editorHelpers: { buildDraftFromEditorInputs: () => ({ name: prior.name, purpose: 'Updated editor purpose', materials: prior.materials, steps: prior.steps, troubleshooting: prior.troubleshooting }) },
    markDraftSaved: noop, setSelectedProtocol: noop, cloneSelectionInsights: value => value, renderProtocolView: noop,
    resetEditorDraft: noop, showViewPanel: noop, getListController: () => ({ renderList: noop }) });
  editor.onProtocolSubmit({ preventDefault: noop });
  assert.deepEqual(state.protocols[0].customField, prior.customField);
  assert.deepEqual(state.protocols[0].aliases, prior.aliases);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  assert.match(await read(saved.sidecarPaths.protocolFilePaths[0].replace(/\.json$/, '.md')), /paper DOI 10\/example/);
}));

test('full saves generate readable protocols and complete rich notebook context', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const original = structuredClone(snapshot);
  const result = await syncBundleFromSnapshot({ snapshot });
  assert.deepEqual(result.sidecarPaths.markdownWarnings, []);
  assert.deepEqual(snapshot, original, 'export must not alter the source snapshot');
  const protocolJson = result.sidecarPaths.protocolFilePaths[0];
  const protocolMd = protocolJson.replace(/\.json$/, '.md');
  const protocolText = await read(protocolMd);
  assert.match(protocolText, /Add \[Volume\] to \[Protein\]/);
  assert.match(protocolText, /Avoid bubbles/);
  assertReadableMarkdown(protocolText);
  assert.match(protocolText, /paper DOI 10\/example/);
  const notebookJson = result.sidecarPaths.notebookPageFolderPaths[0];
  const markdown = await read(notebookJson.replace(/\.json$/, '.md'));
  for (const needle of ['Saved historical purpose', 'Add 10 µL to PT-179.', 'Sample &#124; ID', 'PT&#124;179<br>replicate', '=SUM(B1:B1)', '=Table1:B2',
    'Buffer Preparer', '100 mL', '7.4', 'NaCl', '150 mM', '3 mL', 'Lot 123', 'Solvent to add 97 mL', 'C1 V1 = C2 V2',
    'Fixed Volume Reaction', '48 µL', '1 mg/mL', 'Plate experiment', '| A1 | PT-179 | 2.5 | 0 |', '| A2 |  |  | 0.15 |',
    '90 µL', '1.25 µM', 'Slope 1.2', 'rolling ball', '987', '42', 'all additional metadata', 'Important scientific provenance']) {
    assert.ok(markdown.includes(needle), `missing notebook content: ${needle}`);
  }
  assert.ok(!markdown.includes('Stale legacy gel'));
  assert.ok(!markdown.includes('base64,'), 'embedded images must be usable files rather than giant Markdown data URLs');
  assert.match(markdown, /image%20%5B1%5D\.png/);
  assert.match(markdown, /legacy\.txt.*saved file location unavailable/);
  for (const match of markdown.matchAll(/!\[[^\n]*?\]\(<([^>]+)>\)/g)) {
    const file = path.resolve(path.dirname(notebookJson), decodeURIComponent(match[1]));
    assert.deepEqual(await fs.readFile(file), png, `image must resolve: ${match[1]}`);
  }
  assertReadableMarkdown(markdown);
  assert.equal((await readJson(notebookJson)).notebookEntry.values.unused, 0);
  const hydrated = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(hydrated.snapshot.notebookEntries[0].futureField.untouched, 'all additional metadata');
}));

test('workflow notebooks generate Markdown beside the exact portable JSON record', async () => fixture(async root => {
  const snapshot = await prepare(root);
  snapshot.notebookEntries[0].workflowContext = { workflowId: 'w1', workflowEntryId: 'run1', workflowBlockId: 'block1', workflowEntryName: 'Run A' };
  snapshot.workflowTemplates = [{ id: 't1', name: 'Template' }];
  snapshot.workflows = [{ id: 'w1', name: 'Workflow', templateId: 't1', notebookEntryIds: ['n1'] }];
  const result = await syncBundleFromSnapshot({ snapshot });
  assert.equal(result.sidecarPaths.notebookPageFolderPaths.length, 0);
  assert.deepEqual(result.sidecarPaths.markdownWarnings, []);
  const rebuilt = await rebuildRecordMarkdown(root);
  assert.equal(rebuilt.notebooks, 1);
  const markdownPath = rebuilt.markdownPaths.find(file => file.endsWith('page.md'));
  assert.ok(markdownPath.includes(`${path.sep}Workflow${path.sep}`));
  const markdown = await read(markdownPath);
  assert.match(markdown, /Buffer Preparer/);
  assertReadableMarkdown(markdown);
  assert.equal((await readJson(markdownPath.replace(/\.md$/, '.json'))).workflowId, 'w1');
  snapshot.notebookEntries[0].result = 'Updated workflow result';
  await syncWorkflowRootFromSnapshot({ storagePath: root, snapshot });
  assert.match(await read(markdownPath), /Updated workflow result/);
}));

test('regeneration reads existing JSON without rewriting JSON or unrelated indexes', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  await writeJson(path.join(root, 'hikari-data.json'), { settings: snapshot.settings, assays: snapshot.assays });
  const files = [...saved.sidecarPaths.protocolFilePaths, ...saved.sidecarPaths.notebookPageFolderPaths, path.join(root, 'hikari-data.json'), path.join(root, 'Plugins/gel/g1/analysis-result.json')];
  const before = await Promise.all(files.map(file => fs.readFile(file)));
  for (const file of [...saved.sidecarPaths.protocolFilePaths, ...saved.sidecarPaths.notebookPageFolderPaths]) await fs.rm(file.replace(/\.json$/, '.md'));
  const sentinel = path.join(root, 'hikari-chemicals.index.sqlite');
  await fs.writeFile(sentinel, 'deliberately unreadable index');
  const rebuilt = await rebuildRecordMarkdown(root);
  assert.deepEqual([rebuilt.protocols, rebuilt.notebooks], [1, 1]);
  const markdown = await read(rebuilt.markdownPaths.find(file => file.endsWith('page.md')));
  assert.match(markdown, /987/);
  assert.match(markdown, /Slope 1.2/);
  for (const [index, file] of files.entries()) assert.deepEqual(await fs.readFile(file), before[index], `JSON changed: ${file}`);
  assert.equal(await read(sentinel), 'deliberately unreadable index');
  const regenerated = await rebuildRecordMarkdown(root);
  assert.deepEqual(regenerated, rebuilt);
}));

test('malformed source records stop backfill before replacing existing Markdown', async () => fixture(async root => {
  const good = path.join(root, 'Protocol/P__p/protocol.json');
  await writeJson(good, { protocol: { id: 'p', name: 'Good' } });
  const markdownPath = await writeRecordMarkdown({ filePath: good, payload: await readJson(good), kind: 'protocol', storageRoot: root });
  const before = await read(markdownPath);
  const broken = path.join(root, 'Project/P/Notebook/N/page.json');
  await fs.mkdir(path.dirname(broken), { recursive: true });
  await fs.writeFile(broken, '{broken');
  await assert.rejects(rebuildRecordMarkdown(root), /Cannot regenerate Markdown/);
  assert.equal(await read(markdownPath), before);
}));

test('missing links and snapshots are explicit while extra details stay readable', async () => fixture(async root => {
  const filePath = path.join(root, 'page.json');
  const payload = { notebookEntry: { id: 'n', assayIds: ['missing-assay'], gelIds: ['missing-gel'], values: { zero: 0 }, extra: '```\nlong scientific context\n```' } };
  await writeJson(filePath, payload);
  const markdown = await read(await writeRecordMarkdown({ filePath, payload, kind: 'notebook', storageRoot: root }));
  assert.match(markdown, /Linked assay missing-assay is unavailable/);
  assert.match(markdown, /Linked gel missing-gel is unavailable/);
  assert.match(markdown, /No saved protocol snapshot/);
  assert.match(markdown, /long scientific context/);
  assertReadableMarkdown(markdown);
  assert.deepEqual(await readJson(filePath), payload);
}));

test('renaming preserves document folders and deletion preserves user files', async () => fixture(async root => {
  const snapshot = { settings: { storagePath: root }, protocols: [{ id: 'p', name: 'Old', illustration: dataUrl }] };
  let result = await syncBundleFromSnapshot({ snapshot });
  const oldFolder = path.dirname(result.sidecarPaths.protocolFilePaths[0]);
  await fs.writeFile(path.join(oldFolder, 'notes.md'), 'User notes');
  snapshot.protocols[0].name = 'New';
  result = await syncBundleFromSnapshot({ snapshot });
  assert.equal(await read(path.join(oldFolder, 'notes.md')), 'User notes');
  const newFolder = path.dirname(result.sidecarPaths.protocolFilePaths[0]);
  assert.equal(newFolder, oldFolder);
  assert.match(await read(path.join(oldFolder, 'protocol.md')), /^# New$/m);
  snapshot.protocols = [];
  await syncBundleFromSnapshot({ snapshot });
  await assert.rejects(fs.stat(path.join(newFolder, 'protocol.md')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(newFolder, '.hikari-markdown')), { code: 'ENOENT' });
  assert.equal(await read(path.join(oldFolder, 'notes.md')), 'User notes');
}));

test('user-owned Markdown and export failures do not interrupt authoritative JSON saving', async () => fixture(async root => {
  const folder = path.join(root, 'Protocol/Protein_assay__p1');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'protocol.md'), 'Existing user document');
  const snapshot = { settings: { storagePath: root }, protocols: [{ id: 'p1', name: 'Protein assay' }], assays: [{ id: 'a', name: 'Still saved' }] };
  const result = await syncBundleFromSnapshot({ snapshot });
  assert.equal(result.sidecarPaths.markdownWarnings.length, 1);
  assert.match(result.sidecarPaths.markdownWarnings[0], /user-owned Markdown/);
  assert.equal(await read(path.join(folder, 'protocol.md')), 'Existing user document');
  assert.equal((await readJson(path.join(folder, 'protocol.json'))).protocol.id, 'p1');
  assert.equal((await readJson(path.join(root, 'Plates/Still_saved__a/assay.json'))).assay.id, 'a');
}));

test('long content, invalid inline images, legacy tables and CRLF retain their context', async () => fixture(async root => {
  const payload = { notebookEntry: { id: 'n', result: 'Long result ' + 'αβγ'.repeat(12000),
    resultTable: { columns: [{ field: 'a', title: 'Legacy' }], rows: [{ a: 'first\r\nsecond' }] },
    unknownImage: 'data:image/svg+xml,%broken', protocolSnapshot: { steps: ['Legacy string step'] }
  } };
  const filePath = path.join(root, 'page.json');
  await writeJson(filePath, payload);
  const markdown = await read(await writeRecordMarkdown({ filePath, payload, kind: 'notebook', storageRoot: root }));
  assert.ok(markdown.includes(payload.notebookEntry.result));
  assert.ok(markdown.includes('first<br>second'));
  assert.match(markdown, /Legacy string step/);
  assertReadableMarkdown(markdown);
  assert.deepEqual(await readJson(filePath), payload);
  assert.ok(markdown.startsWith(GENERATED_MARKER));
}));

test('all generated file and image links survive moving the storage root', async () => fixture(async root => {
  const storage = path.join(root, 'workspace');
  const snapshot = await prepare(storage);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const relative = path.relative(storage, saved.sidecarPaths.notebookPageFolderPaths[0].replace(/\.json$/, '.md'));
  const moved = path.join(root, 'moved workspace');
  await fs.rename(storage, moved);
  const markdownPath = path.join(moved, relative);
  const markdown = await read(markdownPath);
  const links = Array.from(markdown.matchAll(/\]\(<([^>]+)>\)/g));
  assert.ok(links.length >= 8, 'attachments, chart and gel artifacts must have links');
  for (const match of links) await fs.stat(path.resolve(path.dirname(markdownPath), decodeURIComponent(match[1])));
}));

test('image refresh prunes only previously generated assets and retains original JSON blobs', async () => fixture(async root => {
  const filePath = path.join(root, 'protocol.json');
  let payload = { protocol: { id: 'p', name: 'Illustrated', image: dataUrl } };
  await writeJson(filePath, payload);
  const markdownPath = await writeRecordMarkdown({ filePath, payload, kind: 'protocol', storageRoot: root });
  const assetFolder = path.join(root, '.hikari-markdown');
  const before = await readJson(path.join(assetFolder, 'manifest.json'));
  const asset = before.files[0];
  assert.deepEqual(await fs.readFile(path.join(assetFolder, asset)), png);
  assert.equal((await readJson(filePath)).protocol.image, dataUrl);
  const markdown = await read(markdownPath);
  assert.ok(markdown.includes(`![Image](<.hikari-markdown/${asset}>)`));
  assertReadableMarkdown(markdown);
  await fs.writeFile(path.join(assetFolder, 'user-notes.txt'), 'Preserve me');
  payload = { protocol: { id: 'p', name: 'Illustrated', image: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E' } };
  await writeJson(filePath, payload);
  await writeRecordMarkdown({ filePath, payload, kind: 'protocol', storageRoot: root });
  await assert.rejects(fs.stat(path.join(assetFolder, asset)), { code: 'ENOENT' });
  assert.equal(await read(path.join(assetFolder, 'user-notes.txt')), 'Preserve me');
  const after = await readJson(path.join(assetFolder, 'manifest.json'));
  assert.equal(await read(path.join(assetFolder, after.files[0])), '<svg xmlns="http://www.w3.org/2000/svg"/>');
}));

test('linked JSON outside the root is reported instead of incorporated', async () => fixture(async root => {
  const storage = path.join(root, 'workspace');
  await fs.mkdir(storage);
  const outside = path.join(root, 'private-report.json');
  await writeJson(outside, { secret: 'must not be incorporated' });
  const filePath = path.join(storage, 'page.json');
  const payload = { notebookEntry: { id: 'n', gelIds: ['g'] } };
  await writeJson(filePath, payload);
  const snapshot = { gelAnalyses: [{ id: 'g', notebookEntryId: 'n', analysisResultPath: outside }] };
  const markdown = await read(await writeRecordMarkdown({ filePath, payload, kind: 'notebook', snapshot, storageRoot: storage }));
  assert.ok(!markdown.includes('must not be incorporated'));
  assert.match(markdown, /outside the storage root/);
}));

test('assay artifact JSON and chart files supplement compact linked records', async () => fixture(async root => {
  const folder = path.join(root, 'Plates', 'plate');
  await writeJson(path.join(folder, 'assay-definition.json'), { id: 'a', name: 'Artifact assay', concentrationUnit: 'mM', wellLayout: [{ well: 'B1', sampleId: 'S2', concentration: '3' }] });
  await writeJson(path.join(folder, 'analysis-result.json'), { assayId: 'a', resultValues: { B1: 123 }, latestAnalysis: { summary: 'Saved artifact analysis', chartRelativePath: 'Plates/plate/chart.png' }, additionalAnalysis: { evidence: 'Artifact-only provenance' } });
  await fs.writeFile(path.join(folder, 'chart.png'), png);
  const payload = { notebookEntry: { id: 'n', assayIds: ['a'] } };
  const filePath = path.join(root, 'page.json');
  await writeJson(filePath, payload);
  const snapshot = { assays: [{ id: 'a', definitionJsonRelativePath: 'Plates/plate/assay-definition.json', analysisResultRelativePath: 'Plates/plate/analysis-result.json' }] };
  const markdown = await read(await writeRecordMarkdown({ filePath, payload, kind: 'notebook', snapshot, storageRoot: root }));
  assert.match(markdown, /\| B1 \| S2 \| 3 \| 123 \|/);
  assert.match(markdown, /Saved artifact analysis/);
  assert.match(markdown, /Artifact-only provenance/);
  assert.match(markdown, /!\[Artifact assay analysis plot\]\(<Plates\/plate\/chart.png>\)/);
  assert.match(markdown, /Plate setup/);
  assert.match(markdown, /Analysis results/);
  assertReadableMarkdown(markdown);
}));

test('Markdown edits reach app hydration, storage import, agent lookup and memory citations', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const protocolFile = saved.sidecarPaths.protocolFilePaths[0];
  const notebookFile = saved.sidecarPaths.notebookPageFolderPaths[0];
  const protocolMd = protocolFile.replace(/\.json$/, '.md');
  const pageMd = notebookFile.replace(/\.json$/, '.md');
  await editField(protocolMd, 'purpose', '## Purpose\n\nPurpose edited in Markdown with <details> & **emphasis**.');
  await editField(protocolMd, 'materials', '## Materials\n\n- New buffer\n- Sample');
  await editField(protocolMd, 'steps', '## Steps\n\n1. Cool the tubes.\n\n<!-- hikari-step:0 -->\n2. Mix [Volume] with [Protein].');
  await editField(pageMd, 'result', '## Notes and results\n\nExternal unique result αβγ\n\n### Observation\n\nSignal increased.');
  const hydrated = await hydrateSnapshotFromBundle({ snapshot });
  const protocol = hydrated.snapshot.protocols[0];
  const notebook = hydrated.snapshot.notebookEntries[0];
  assert.match(protocol.purpose, /edited in Markdown/);
  assert.deepEqual(protocol.materials, ['New buffer', 'Sample']);
  assert.equal(protocol.steps[0].text, 'Cool the tubes.');
  assert.equal(protocol.steps[1].text, 'Mix {{ph:amount}} with {{ph:sample}}.');
  assert.deepEqual(protocol.steps[1].placeholders, snapshot.protocols[0].steps[0].placeholders);
  assert.equal(notebook.result, 'External unique result αβγ\n\n### Observation\n\nSignal increased.');
  assert.deepEqual(notebook.resultTables, snapshot.notebookEntries[0].resultTables);
  assert.deepEqual(notebook.toolCalculations, snapshot.notebookEntries[0].toolCalculations);
  assert.equal(notebook.protocolSnapshot.purpose, 'Saved historical purpose');
  const imported = await importStorageRoot({ storagePath: root });
  assert.equal(imported.statePatch.notebookEntries[0].result, notebook.result);
  assert.equal(imported.statePatch.protocols[0].purpose, protocol.purpose);
  const lookup = createAgentNotebookLookupRuntime({ buildLookupContext: async () => ({ hydratedSnapshot: hydrated.snapshot, migration: hydrated.migration, warnings: [] }) });
  const found = await lookup.searchNotebookEntries({ query: 'External unique result', detail: 'full' });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].content.result, notebook.result);
  assert.equal(found.source, 'markdown');
  const memory = buildNotebookMemorySource(root, { projectId: 'proj', displayName: 'Protein project' }, notebook);
  assert.equal(memory.pageFilePath, pageMd);
  assert.ok(memory.sourceRelativePath.endsWith('/page.md'));
  assert.match(memory.corpus, /External unique result/);
}));

test('stale autosaves merge external prose, retain annotations and refresh scientific tables', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const notebookFile = saved.sidecarPaths.notebookPageFolderPaths[0];
  const pageMd = notebookFile.replace(/\.json$/, '.md');
  await editField(pageMd, 'result', '## Notes and results\n\nEdited outside the app.');
  await fs.appendFile(pageMd, '\n## Personal annotation\n\nKeep this custom section.\n');
  snapshot.notebookEntries[0].resultTables[0].rows[0].v = '99';
  await syncBundleFromSnapshot({ snapshot });
  await syncBundleFromSnapshot({ snapshot });
  const loaded = await readRecordDocument(notebookFile, 'notebook');
  assert.equal(loaded.data.notebookEntry.result, 'Edited outside the app.');
  assert.equal(loaded.data.notebookEntry.resultTables[0].rows[0].v, '99');
  assert.match(await read(pageMd), /Keep this custom section/);
  assert.match(await read(pageMd), /\| 99 \|/);
  assert.equal(snapshot.notebookEntries[0].result, 'Results\nSecond line with **emphasis** and `code`.');
  assertReadableMarkdown(await read(pageMd));
}));

test('concurrent prose edits skip the record without overwriting either document', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  const markdownPath = filePath.replace(/\.json$/, '.md');
  await editField(markdownPath, 'result', '## Notes and results\n\nExternal edit.');
  const jsonBefore = await read(filePath);
  const markdownBefore = await read(markdownPath);
  snapshot.notebookEntries[0].result = 'Competing app edit.';
  const result = await syncBundleFromSnapshot({ snapshot });
  assert.match(result.sidecarPaths.skippedRecords[0].message, /changed in Hikari and in/);
  assert.equal(await read(filePath), jsonBefore);
  assert.equal(await read(markdownPath), markdownBefore);
}));

test('migration backs up legacy records once and is safe to repeat', async () => fixture(async root => {
  const filePath = path.join(root, 'Protocol', 'Legacy__p', 'protocol.json');
  const payload = { protocol: { id: 'p', name: 'Legacy', purpose: 'Legacy prose', materials: ['Water'], steps: [{ text: 'Add water.', placeholders: [] }] } };
  await writeJson(filePath, payload);
  const original = await read(filePath);
  const result = await rebuildRecordMarkdown(root, { migrate: true });
  assert.equal(result.protocols, 1);
  const backup = filePath.replace(/\.json$/, '.pre-markdown.json');
  assert.equal(await read(backup), original);
  assert.equal((await readJson(filePath)).document.file, 'protocol.md');
  assert.match(await read(result.markdownPaths[0]), /hikari-document:protocol:v1/);
  await editField(result.markdownPaths[0], 'purpose', '## Purpose\n\nEdited legacy purpose.');
  await rebuildRecordMarkdown(root, { migrate: true });
  assert.equal(await read(backup), original);
  assert.equal((await readRecordDocument(filePath, 'protocol')).data.protocol.purpose, 'Edited legacy purpose.');
}));

test('migration materializes documents from snapshot-only legacy roots without changing the snapshot', async () => fixture(async root => {
  const snapshot = richSnapshot(root);
  const filePath = path.join(root, 'hikari-data.json');
  await writeJson(filePath, snapshot);
  const original = await read(filePath);
  const result = await rebuildRecordMarkdown(root, { migrate: true });
  assert.deepEqual([result.protocols, result.notebooks], [1, 1]);
  assert.equal(await read(filePath), original);
  const hydrated = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(hydrated.snapshot.protocols[0].purpose, snapshot.protocols[0].purpose);
  assert.equal(hydrated.snapshot.notebookEntries[0].result, snapshot.notebookEntries[0].result);
}));

test('damaged Markdown is kept and reported, and deleting it lets Hikari rewrite it', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  const markdownPath = filePath.replace(/\.json$/, '.md');
  const damaged = (await read(markdownPath)).replace('<!-- /hikari-field:result -->', '<!-- damaged marker -->');
  await fs.writeFile(markdownPath, damaged);
  let loaded = await readRecordDocument(filePath, 'notebook');
  assert.equal(loaded.data.notebookEntry.result, snapshot.notebookEntries[0].result);
  assert.match(loaded.warnings[0], /Incomplete Markdown field section/);
  const result = await syncBundleFromSnapshot({ snapshot });
  assert.match(result.sidecarPaths.skippedRecords[0].message, /Incomplete Markdown field section markers\. Fix .*page\.md, or delete it/);
  assert.equal(await read(markdownPath), damaged);
  await fs.rm(markdownPath);
  loaded = await readRecordDocument(filePath, 'notebook');
  assert.equal(loaded.warnings.length, 1);
  snapshot.notebookEntries[0].result = 'Saved after the damaged file was deleted.';
  assert.deepEqual((await syncBundleFromSnapshot({ snapshot })).sidecarPaths.skippedRecords, []);
  assert.ok((await read(markdownPath)).includes(documentMarker('notebook')));
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, snapshot.notebookEntries[0].result);
}));

test('an unreadable companion is rebuilt from Hikari\'s copy and kept aside', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  await editField(filePath.replace(/\.json$/, '.md'), 'result', '## Notes and results\n\nEdited before the companion was damaged.');
  await fs.writeFile(filePath, '{"notebookEntry": {"id": "n1", "res');
  assert.deepEqual((await syncBundleFromSnapshot({ snapshot })).sidecarPaths.skippedRecords, []);
  assert.equal(await read(filePath.replace(/\.json$/, '.unreadable.json')), '{"notebookEntry": {"id": "n1", "res');
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, 'Edited before the companion was damaged.');
}));

test('workflow page prose also loads from Markdown and survives stale workflow saves', async () => fixture(async root => {
  const snapshot = await prepare(root);
  snapshot.notebookEntries[0].workflowContext = { workflowId: 'w', workflowEntryId: 'run', workflowBlockId: 'block' };
  snapshot.workflowTemplates = [{ id: 't', name: 'Template' }];
  snapshot.workflows = [{ id: 'w', name: 'Workflow', templateId: 't', notebookEntryIds: ['n1'] }];
  await syncBundleFromSnapshot({ snapshot });
  const rebuilt = await rebuildRecordMarkdown(root);
  const markdownPath = rebuilt.markdownPaths.find(file => file.endsWith('/page.md'));
  await editField(markdownPath, 'result', '## Notes and results\n\nWorkflow Markdown result.');
  let loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.notebookEntries[0].result, 'Workflow Markdown result.');
  await syncWorkflowRootFromSnapshot({ snapshot, storagePath: root });
  loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.equal(loaded.snapshot.notebookEntries[0].result, 'Workflow Markdown result.');
}));

test('renderer save revisions protect stale state after another client checkpoints Markdown edits', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const snapshot = await prepare(root);
  const api = { autoSaveDataFile: async data => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot: data }) }) };
  const saved = await syncMarkdownRecordState(api, snapshot);
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  const markdownPath = filePath.replace(/\.json$/, '.md');
  assert.ok(snapshot.notebookEntries[0].markdownRevision);
  await editField(markdownPath, 'result', '## Notes and results\n\nExternal edit checkpointed by another client.');
  const otherClient = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  await syncBundleFromSnapshot({ snapshot: otherClient });
  assert.equal((await readJson(filePath)).notebookEntry.result, 'External edit checkpointed by another client.');
  await syncMarkdownRecordState(api, snapshot);
  await syncMarkdownRecordState(api, snapshot);
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, 'External edit checkpointed by another client.');
  snapshot.notebookEntries[0].result = 'Competing editor change.';
  const baseline = snapshot.notebookEntries[0].markdownRevision;
  const result = await syncMarkdownRecordState(api, snapshot);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sidecarPaths.skippedRecords.map(record => record.id), ['n1']);
  assert.deepEqual(snapshot.notebookEntries[0].markdownRevision, baseline);
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, 'External edit checkpointed by another client.');
  // Deleting the conflicting file keeps the editor's version.
  await fs.rm(markdownPath);
  await syncMarkdownRecordState(api, snapshot);
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, 'Competing editor change.');
}));

test('queued renderer saves keep their order and acknowledge only the current state', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const snapshot = await prepare(root);
  const api = { autoSaveDataFile: async data => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot: data }) }) };
  await syncMarkdownRecordState(api, snapshot);
  snapshot.notebookEntries[0].result = 'First edit.';
  const first = syncMarkdownRecordState(api, snapshot);
  snapshot.notebookEntries[0].result = 'Second edit.';
  const second = syncMarkdownRecordState(api, snapshot);
  snapshot.notebookEntries[0].result = 'Third edit.';
  const third = syncMarkdownRecordState(api, snapshot);
  await Promise.all([first, second, third]);
  const hydrated = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.equal(hydrated.notebookEntries[0].result, 'Third edit.');
  assert.deepEqual(snapshot.notebookEntries[0].markdownRevision.fields, hydrated.notebookEntries[0].markdownRevision.fields);
}));

test('missing attachments retain their names without generating broken image previews', async () => fixture(async root => {
  const filePath = path.join(root, 'page.json');
  const payload = { notebookEntry: { id: 'n', resultFileRecords: [{ name: 'missing.png', relativePath: 'attachments/missing.png', mimeType: 'image/png' }] } };
  const markdownPath = await writeRecordMarkdown({ filePath, payload, kind: 'notebook', storageRoot: root });
  const markdown = await read(markdownPath);
  assert.match(markdown, /missing\.png.*saved file location unavailable/);
  assert.doesNotMatch(markdown, /!\[missing\.png\]/);
  assert.doesNotMatch(markdown, /\]\(<attachments\/missing\.png>\)/);
}));

test('a fresh reload permits editing an externally restored historical version', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const snapshot = await prepare(root);
  const api = { autoSaveDataFile: async data => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot: data }) }) };
  const saved = await syncMarkdownRecordState(api, snapshot);
  const filePath = saved.sidecarPaths.notebookPageFolderPaths[0];
  const original = snapshot.notebookEntries[0].result;
  snapshot.notebookEntries[0].result = 'Later app version.';
  await syncMarkdownRecordState(api, snapshot);
  await editField(filePath.replace(/\.json$/, '.md'), 'result', '## Notes and results\n\n' + original);
  const loaded = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  snapshot.notebookEntries = loaded.notebookEntries;
  snapshot.notebookEntries[0].result = 'Edit after reloading the restored version.';
  await syncMarkdownRecordState(api, snapshot);
  assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, snapshot.notebookEntries[0].result);
}));

test('an existing record without client metadata can still accept its first editor change', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const snapshot = await prepare(root);
  await syncBundleFromSnapshot({ snapshot });
  snapshot.protocols[0].purpose = 'First change from a legacy client.';
  snapshot.notebookEntries[0].result = 'First note change from a legacy client.';
  const api = { autoSaveDataFile: async data => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot: data }) }) };
  await syncMarkdownRecordState(api, snapshot);
  const loaded = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.equal(loaded.protocols[0].purpose, snapshot.protocols[0].purpose);
  assert.equal(loaded.notebookEntries[0].result, snapshot.notebookEntries[0].result);
}));

test('dollar replacement patterns in edited prose stay literal', async () => fixture(async root => {
  const snapshot = await prepare(root);
  await syncBundleFromSnapshot({ snapshot });
  snapshot.notebookEntries[0].result = "Display $$E = mc^2$$; split with cut -d $'\\t'; R: df$`col` and $&.";
  snapshot.protocols[0].purpose = "Costs $$5 per $' well";
  await syncBundleFromSnapshot({ snapshot });
  await syncBundleFromSnapshot({ snapshot });
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.doesNotMatch(loaded.migration.warnings.join('\n'), /Could not load/);
  assert.equal(loaded.snapshot.notebookEntries[0].result, snapshot.notebookEntries[0].result);
  assert.equal(loaded.snapshot.protocols[0].purpose, snapshot.protocols[0].purpose);
}));

test('a BOM or front matter added by an editor keeps the document saveable', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const pageMd = saved.sidecarPaths.notebookPageFolderPaths[0].replace(/\.json$/, '.md');
  const protocolMd = saved.sidecarPaths.protocolFilePaths[0].replace(/\.json$/, '.md');
  await fs.writeFile(pageMd, `---\ntags: [western]\n---\n${await read(pageMd)}`);
  await fs.writeFile(protocolMd, `﻿${await read(protocolMd)}`);
  await editField(pageMd, 'result', '## Notes and results\n\nEdited below front matter.');
  snapshot.protocols[0].troubleshooting = 'Edited in Hikari.';
  await syncBundleFromSnapshot({ snapshot });
  const loaded = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.equal(loaded.notebookEntries[0].result, 'Edited below front matter.');
  assert.equal(loaded.protocols[0].troubleshooting, 'Edited in Hikari.');
  assert.match(await read(pageMd), /^---\ntags: \[western\]\n---\n/);
  assert.ok((await read(protocolMd)).startsWith('﻿'));
}));

test('step markers left behind by editors attach to their item or delete the step', async () => fixture(async root => {
  const filePath = path.join(root, 'protocol.json');
  const steps = [{ id: 'a', text: 'Mix.', placeholders: [] }, { id: 'b', text: 'Spin.', placeholders: [] },
    { id: 'c', text: 'Add {{ph:v}}.', placeholders: [{ id: 'v', name: 'Volume' }] }, { id: 'd', text: 'Read.', placeholders: [] }];
  await writeRecordDocument({ filePath, payload: { protocol: { id: 'p', name: 'Markers', steps } }, kind: 'protocol', storageRoot: root });
  // Steps 2 and 4 were deleted around hidden markers; step 3's marker gained a blank line.
  await editField(filePath.replace(/\.json$/, '.md'), 'steps', '## Steps\n\n<!-- hikari-step:0 -->\n1. Mix.\n\n<!-- hikari-step:1 -->\n\n<!-- hikari-step:2 -->\n\n2. Add [Volume] slowly.\n\n<!-- hikari-step:3 -->');
  const loaded = await readRecordDocument(filePath, 'protocol');
  assert.deepEqual(loaded.warnings, []);
  assert.deepEqual(loaded.data.protocol.steps.map(step => [step.id, step.text]), [['a', 'Mix.'], ['c', 'Add {{ph:v}} slowly.']]);
}));

test('documents reformatted by Prettier keep their fields and step identities', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  // Prettier puts a blank line after every comment line, including field and step markers.
  for (const file of [saved.sidecarPaths.protocolFilePaths[0], saved.sidecarPaths.notebookPageFolderPaths[0]]) {
    const md = file.replace(/\.json$/, '.md');
    await fs.writeFile(md, (await read(md)).replace(/^(<!-- hikari-[^\n]* -->)\n(?!\n)/gm, '$1\n\n'));
  }
  await syncBundleFromSnapshot({ snapshot: (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot });
  const loaded = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } });
  assert.doesNotMatch(loaded.migration.warnings.join('\n'), /Could not load/);
  assert.equal(loaded.snapshot.protocols[0].name, snapshot.protocols[0].name);
  assert.deepEqual(loaded.snapshot.protocols[0].steps, snapshot.protocols[0].steps);
  assert.equal(loaded.snapshot.notebookEntries[0].result, snapshot.notebookEntries[0].result);
}));

test('skipped records are announced when the problem or the unsaved record changes', async () => fixture(async root => {
  const { syncMarkdownRecordState } = await import('../src/renderer/services/markdown-record-storage.js');
  const shown = [];
  globalThis.document = { querySelector: () => null, body: { appendChild() {} },
    createElement: () => ({ style: {}, hidden: true, setAttribute() {}, set textContent(text) { shown.push(text); } }) };
  try {
    const snapshot = await prepare(root);
    snapshot.notebookEntries.push({ id: 'n2', projectName: 'Protein project', protocolName: 'Second', result: 'Second page.' });
    const api = { autoSaveDataFile: async data => ({ ok: true, ...await syncBundleFromSnapshot({ snapshot: data }) }) };
    const filePath = (await syncMarkdownRecordState(api, snapshot)).sidecarPaths.notebookPageFolderPaths[0];
    const markdownPath = filePath.replace(/\.json$/, '.md');
    await fs.writeFile(markdownPath, (await read(markdownPath)).replace('<!-- /hikari-field:result -->', ''));
    await syncMarkdownRecordState(api, snapshot);
    await syncMarkdownRecordState(api, snapshot);
    snapshot.notebookEntries[1].result = 'Edit to another page.';
    await syncMarkdownRecordState(api, snapshot);
    assert.equal(shown.length, 1);
    snapshot.notebookEntries[0].result = 'More notes that are not saved yet.';
    await syncMarkdownRecordState(api, snapshot);
    assert.equal(shown.length, 2);
    assert.match(shown[1], /"Experiment A" was not saved/);
    await fs.rm(markdownPath);
    await syncMarkdownRecordState(api, snapshot);
    assert.equal(shown.length, 2);
    assert.equal((await readRecordDocument(filePath, 'notebook')).data.notebookEntry.result, 'More notes that are not saved yet.');
  } finally { delete globalThis.document; }
}));

test('a copied protocol folder is reported and kept while the original keeps loading', async () => fixture(async root => {
  const snapshot = { settings: { storagePath: root }, protocols: [{ id: 'p1', name: 'Miniprep', purpose: 'Original purpose', steps: [{ text: 'Lyse.', placeholders: [] }] }] };
  const original = path.dirname((await syncBundleFromSnapshot({ snapshot })).sidecarPaths.protocolFilePaths[0]);
  const copies = [`${original} copy`, path.join(root, 'Protocol', 'Miniprep_v2__p1')];
  for (const copy of copies) {
    await fs.cp(original, copy, { recursive: true });
    await editField(path.join(copy, 'protocol.md'), 'purpose', '## Purpose\n\nVariant purpose.');
  }
  const imported = await importStorageRoot({ storagePath: root });
  assert.deepEqual(imported.statePatch.protocols.map(protocol => protocol.purpose), ['Original purpose']);
  assert.equal(imported.alerts.length, 2);
  assert.ok(imported.alerts.every(alert => /has the same ID as "Miniprep__p1"/.test(alert)));
  const hydrated = (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;
  assert.deepEqual(hydrated.protocols.map(protocol => protocol.purpose), ['Original purpose']);
  await syncBundleFromSnapshot({ snapshot: { ...imported.statePatch, settings: { storagePath: root } } });
  await syncBundleFromSnapshot({ snapshot: hydrated });
  assert.match(await read(path.join(original, 'protocol.md')), /Original purpose/);
  for (const copy of copies) {
    assert.match(await read(path.join(copy, 'protocol.md')), /Variant purpose/);
    assert.equal((await readJson(path.join(copy, 'protocol.json'))).protocol.id, 'p1');
  }
}));

test('an unchanged record keeps its files while changed context still rewrites them', async () => fixture(async root => {
  const snapshot = await prepare(root);
  const saved = await syncBundleFromSnapshot({ snapshot });
  const [protocolJson, pageJson] = [saved.sidecarPaths.protocolFilePaths[0], saved.sidecarPaths.notebookPageFolderPaths[0]];
  const files = [protocolJson, protocolJson.replace(/\.json$/, '.md'), pageJson, pageJson.replace(/\.json$/, '.md')];
  const stamps = () => Promise.all(files.map(async file => (await fs.stat(file)).mtimeMs));
  const before = await stamps();
  await new Promise(resolve => setTimeout(resolve, 20));
  await syncBundleFromSnapshot({ snapshot });
  assert.deepEqual(await stamps(), before);
  snapshot.samples[0].details.lot = 'Lot changed';
  await syncBundleFromSnapshot({ snapshot });
  assert.match(await read(files[3]), /Lot changed/);
  // Images of an unchanged record are still restored.
  const assetFolder = path.join(path.dirname(pageJson), '.hikari-markdown');
  const asset = (await fs.readdir(assetFolder)).find(name => name.endsWith('.png'));
  await fs.rm(path.join(assetFolder, asset));
  await syncBundleFromSnapshot({ snapshot });
  assert.ok((await fs.stat(path.join(assetFolder, asset))).isFile());
}));
