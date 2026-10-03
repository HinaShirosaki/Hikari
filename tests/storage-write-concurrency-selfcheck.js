'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createMainDataHelpers } = require('../src/main/data/data-helpers');
const { syncBundleFromSnapshot, syncSqliteBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { syncWorkflowRootFromSnapshot } = require('../src/main/storage/workflow-storage');
const { readSqliteBundleIndex } = require('../src/main/storage/storage-sql-read');
const { createStorageFileHelpers } = require('../src/main/ipc/register-data-ipc/storage-files');
const { createGenomeService } = require('../src/main/genome/create-genome-service');
const { createScheduledTaskService } = require('../src/main/scheduled-tasks/create-scheduled-task-service');

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(work) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hikari-write-regression-'));
  try { await work(root); }
  finally { await fsp.rm(root, { recursive: true, force: true }); }
}
const readJson = async file => JSON.parse(await fsp.readFile(file, 'utf8'));
function snapshot(root, marker) {
  return { marker, settings: { storagePath: root, dashboard: { quickLogDraft: marker } },
    protocols: [], assays: [], samples: [] };
}
function autosave(root, releaseSkills) {
  return createMainDataHelpers({ fs: fsp, path,
    getDefaultDataFilePath: () => path.join(root, 'hikari-data.json'),
    syncBundleFromSnapshot: input => syncBundleFromSnapshot({ ...input,
      releaseOfficialMcpSkillsForWorkspace: releaseSkills }) });
}

test('workspace saves retain newer records, freeze queued inputs, and allow another root to save', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const entered = deferred(), release = deferred();
    let newerEntered = false;
    const helpers = autosave(root, async (_root, { snapshot: current }) => {
      if (current.marker === 'old') { entered.resolve(); await release.promise; }
      else newerEntered = true;
    });
    const older = helpers.autoSaveDataFile({ data: snapshot(root, 'old'), filePath: '' });
    await entered.promise;
    const newerInput = snapshot(root, 'new');
    newerInput.protocols = [{ id: 'new-protocol', name: 'New protocol' }];
    newerInput.assays = [{ id: 'new-assay', name: 'New assay' }];
    newerInput.samples = [{ id: 'new-sample', name: 'New sample' }];
    const newer = helpers.autoSaveDataFile({ data: newerInput, filePath: '' });
    newerInput.settings.dashboard.quickLogDraft = 'mutated after submission';
    newerInput.protocols.length = 0;
    try {
      await turn();
      assert.equal(newerEntered, false, 'the newer root save must wait for the older save');
      const independentRoot = path.join(root, 'independent');
      const independent = await syncBundleFromSnapshot({ snapshot: snapshot(independentRoot, 'independent') });
      assert.equal((await readJson(independent.sidecarPaths.experimentLogPath)).draft, 'independent');
    } finally { release.resolve(); }
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    assert.equal(olderResult.ok, true);
    assert.equal(newerResult.ok, true);
    assert.equal((await readJson(newerResult.sidecarPaths.protocolFilePaths[0])).protocol.id, 'new-protocol');
    const plateFolders = await fsp.readdir(path.join(root, 'Plates'));
    assert.equal((await readJson(path.join(root, 'Plates', plateFolders[0], 'assay.json'))).assay.id, 'new-assay');
    assert.equal((await readJson(path.join(root, 'Samples', 'unplaced.json'))).samples[0].id, 'new-sample');
    assert.equal((await readJson(newerResult.sidecarPaths.experimentLogPath)).draft, 'new');
  });
});

test('direct chemical and workflow syncs share the full workspace queue', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const entered = deferred(), release = deferred();
    const helpers = autosave(root, async () => { entered.resolve(); await release.promise; });
    const full = helpers.autoSaveDataFile({ data: snapshot(root, 'full'), filePath: '' });
    await entered.promise;
    let chemicalDone = false, workflowDone = false;
    const sqlitePath = path.join(root, 'hikari-chemicals.index.sqlite');
    const chemical = syncSqliteBundleFromSnapshot({ sqlitePath,
      snapshot: { labInventory: { chemicals: [{ id: 'later-chemical', name: 'Later chemical' }] } } })
      .then(result => { chemicalDone = true; return result; });
    const workflow = syncWorkflowRootFromSnapshot({ storagePath: root,
      snapshot: { workflowTemplates: [{ id: 'later-template', name: 'Later template' }] } })
      .then(result => { workflowDone = true; return result; });
    try {
      await turn();
      assert.equal(chemicalDone, false);
      assert.equal(workflowDone, false);
    } finally { release.resolve(); }
    const [fullResult, , workflowResult] = await Promise.all([full, chemical, workflow]);
    assert.equal(fullResult.ok, true);
    assert.equal(workflowResult.summary.workflowTemplates, 1);
    assert.equal((await readSqliteBundleIndex(sqlitePath)).inventoryChemicals[0].id, 'later-chemical');
  });
});

test('a failed workspace save does not poison the next save', async () => {
  await fixture(async root => {
    const helpers = autosave(root, async (_root, { snapshot: current }) => {
      if (current.marker === 'failed') throw new Error('simulated save failure');
    });
    const [failed, saved] = await Promise.all([
      helpers.autoSaveDataFile({ data: snapshot(root, 'failed'), filePath: '' }),
      helpers.autoSaveDataFile({ data: snapshot(root, 'saved'), filePath: '' })
    ]);
    assert.equal(failed.ok, false);
    assert.equal(saved.ok, true);
    assert.equal((await readJson(saved.sidecarPaths.experimentLogPath)).draft, 'saved');
  });
});

test('load-time hydration waits for a workspace save and reads its committed bundle', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const entered = deferred(), release = deferred();
    const target = path.join(root, 'import.json');
    await fsp.writeFile(target, JSON.stringify(snapshot(root, 'import')));
    const helpers = autosave(root, async () => { entered.resolve(); await release.promise; });
    const saving = helpers.autoSaveDataFile({ data: snapshot(root, 'committed'), filePath: '' });
    await entered.promise;
    let hydrated = false;
    const readSnapshot = deferred();
    const loader = createMainDataHelpers({ fs: { ...fsp, async readFile(file, ...args) {
      const raw = await fsp.readFile(file, ...args);
      if (file === target) readSnapshot.resolve();
      return raw;
    } }, path,
      getDefaultDataFilePath: () => path.join(root, 'hikari-data.json'),
      hydrateSnapshotFromBundle: async ({ snapshot: parsed }) => {
        hydrated = true;
        const log = await readJson(path.join(root, 'Dashboard', 'experiment-log.json'));
        return { snapshot: { ...parsed, committedDraft: log.draft }, bundlePaths: {}, sidecarPaths: {} };
      } });
    const loading = loader.autoLoadDataFile(target);
    try {
      await readSnapshot.promise;
      await turn();
      assert.equal(hydrated, false, 'hydration must not inspect a partially saved bundle');
    } finally { release.resolve(); }
    assert.equal((await saving).ok, true);
    const loaded = await loading;
    assert.equal(loaded.ok, true);
    assert.equal(loaded.data.committedDraft, 'committed');
  });
});

test('interrupted artifact writes and failed renames preserve the committed JSON and clean their temp files', async () => {
  await fixture(async root => {
    const targetFolder = path.join(root, 'Plates', 'fixture');
    await fsp.mkdir(targetFolder, { recursive: true });
    const target = path.join(targetFolder, 'analysis-result.json');
    const original = '{"assayId":"fixture","resultValues":{"A1":42}}';
    await fsp.writeFile(target, original);
    let mode = 'partial';
    const io = { ...fsp,
      async writeFile(file, content, ...args) {
        if (mode === 'partial') {
          await fsp.writeFile(file, String(content).slice(0, 10));
          throw new Error('simulated partial write');
        }
        return fsp.writeFile(file, content, ...args);
      },
      async rename(...args) {
        if (mode === 'rename') throw new Error('simulated rename failure');
        return fsp.rename(...args);
      }
    };
    const files = createStorageFileHelpers({ fs: io, cleanText: value => String(value || '').trim(),
      getStorageRoot: () => root, getDefaultDataFilePath: () => '', getStorageRootPointerPath: () => '' });
    const save = () => files.writeJsonStorageFile({ storagePath: root, targetFolder,
      fileName: 'analysis-result.json', data: { assayId: 'fixture', resultValues: { A1: 84 } } });
    for (const failure of ['partial', 'rename']) {
      mode = failure;
      await assert.rejects(save(), /simulated/);
      assert.equal(await fsp.readFile(target, 'utf8'), original);
      assert.deepEqual(await fsp.readdir(targetFolder), ['analysis-result.json']);
    }
    mode = 'success';
    await save();
    assert.equal((await readJson(target)).resultValues.A1, 84);
  });
});

function genomeFixture(root, io = fs) {
  const target = path.join(root, 'genomes.json');
  const genomes = [{ id: 'genome-a', label: 'A', records: [], filePath: path.join(root, 'a.fa') },
    { id: 'genome-b', label: 'B', records: [], filePath: path.join(root, 'b.fa') }];
  return { target, genomes, service: createGenomeService({ fs: io, path, getGenomeLibraryPath: () => target }) };
}

test('concurrent genome removals both survive in memory and after restart', async () => {
  await fixture(async root => {
    const { target, genomes, service } = genomeFixture(root);
    await fsp.writeFile(target, JSON.stringify({ version: 1, genomes }));
    await service.listGenomes();
    const removed = await Promise.all(genomes.map(genome => service.removeGenome({ id: genome.id })));
    assert.ok(removed.every(result => result.removed));
    assert.equal((await service.listGenomes()).length, 0);
    assert.equal((await readJson(target)).genomes.length, 0);
    assert.equal((await genomeFixture(root).service.listGenomes()).length, 0);
  });
});

test('failed genome replacement preserves cache and disk, then permits a retry', async () => {
  await fixture(async root => {
    let fail = true;
    const io = { ...fs, promises: { ...fsp, async rename(...args) {
      if (fail) throw new Error('simulated genome replacement failure');
      return fsp.rename(...args);
    } } };
    const { target, genomes, service } = genomeFixture(root, io);
    const original = JSON.stringify({ version: 1, genomes });
    await fsp.writeFile(target, original);
    await service.listGenomes();
    await assert.rejects(service.removeGenome({ id: 'genome-a' }), /simulated/);
    assert.deepEqual((await service.listGenomes()).map(genome => genome.id), ['genome-a', 'genome-b']);
    assert.equal(await fsp.readFile(target, 'utf8'), original);
    assert.deepEqual(await fsp.readdir(root), ['genomes.json']);
    fail = false;
    assert.equal((await service.removeGenome({ id: 'genome-a' })).removed, true);
    assert.deepEqual((await readJson(target)).genomes.map(genome => genome.id), ['genome-b']);
  });
});

test('genome registration rechecks the library after slow indexing', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const slowPath = path.join(root, 'slow.fa');
    await fsp.writeFile(slowPath, '>chr1\nACGT\n');
    const entered = deferred(), stream = new PassThrough();
    const io = { ...fs, createReadStream(file, options) {
      if (file === slowPath) { entered.resolve(); return stream; }
      return fs.createReadStream(file, options);
    } };
    const { target, genomes, service } = genomeFixture(root, io);
    await fsp.writeFile(target, JSON.stringify({ version: 1, genomes: [genomes[0]] }));
    const adding = service.registerGenomePath({ filePath: slowPath });
    await entered.promise;
    try { assert.equal((await service.removeGenome({ id: 'genome-a' })).removed, true); }
    finally { stream.end('>chr1\nACGT\n'); }
    const added = await adding;
    assert.deepEqual((await service.listGenomes()).map(genome => genome.id), [added.id]);
    assert.deepEqual((await readJson(target)).genomes.map(genome => genome.id), [added.id]);
  });
});

test('genome indexing retains the originally selected destination during a root switch', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const source = path.join(root, 'source.fa');
    await fsp.writeFile(source, '>chr1\nACGT\n');
    const originalTarget = path.join(root, 'original.json'), nextTarget = path.join(root, 'next.json');
    let target = originalTarget;
    const entered = deferred(), stream = new PassThrough();
    const service = createGenomeService({ fs: { ...fs, createReadStream() { entered.resolve(); return stream; } },
      path, getGenomeLibraryPath: () => target });
    const adding = service.registerGenomePath({ filePath: source });
    await entered.promise;
    target = nextTarget;
    service.reload();
    stream.end('>chr1\nACGT\n');
    const added = await adding;
    assert.equal((await readJson(originalTarget)).genomes[0].id, added.id);
    assert.equal((await service.listGenomes()).length, 0);
    assert.equal(fs.existsSync(nextTarget), false);
  });
});

test('a rejected scheduled task creation cannot leak into the next committed snapshot', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const configPath = path.join(root, 'scheduled-tasks.json');
    const entered = deferred(), release = deferred();
    let writes = 0, id = 0;
    const io = { ...fsp, async writeFile(file, ...args) {
      if (++writes === 1) { entered.resolve(); await release.promise; throw new Error('simulated first task failure'); }
      return fsp.writeFile(file, ...args);
    } };
    const makeTasks = fs => createScheduledTaskService({ fs, path, getScheduledTasksPath: () => configPath,
      createId: () => `task-${++id}`, runCodexTask: async () => { throw new Error('Fixture must not execute.'); } });
    const tasks = makeTasks(io);
    const failed = tasks.createTask({ prompt: 'failed', enabled: false });
    const failure = assert.rejects(failed, /simulated first task failure/);
    await entered.promise;
    const later = tasks.createTask({ prompt: 'saved', enabled: false });
    await turn();
    release.resolve();
    await failure;
    const saved = await later;
    assert.deepEqual((await tasks.listTasks()).map(task => task.id), [saved.id]);
    assert.deepEqual((await readJson(configPath)).tasks.map(task => task.id), [saved.id]);
    assert.deepEqual((await makeTasks(fsp).listTasks()).map(task => task.id), [saved.id]);
    assert.deepEqual(await fsp.readdir(root), ['scheduled-tasks.json']);
  });
});

test('scheduler rollback cannot overwrite a later update and inference does not block CRUD', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const configPath = path.join(root, 'scheduled-tasks.json');
    const running = deferred(), finish = deferred();
    let fail = false;
    const tasks = createScheduledTaskService({ fs: { ...fsp, async rename(...args) {
      if (fail) { fail = false; throw new Error('simulated update failure'); }
      return fsp.rename(...args);
    } }, path, getScheduledTasksPath: () => configPath,
    runCodexTask: async () => { running.resolve(); await finish.promise; return { text: 'done' }; } });
    const created = await tasks.createTask({ prompt: 'run', title: 'original', enabled: false });
    fail = true;
    const failed = tasks.updateTask(created.id, { title: 'failed' });
    const failure = assert.rejects(failed, /simulated update failure/);
    const saved = tasks.updateTask(created.id, { title: 'saved' });
    await failure;
    assert.equal((await saved).title, 'saved');
    const execution = tasks.runTask(created.id);
    await running.promise;
    try {
      await assert.rejects(tasks.runTask(created.id), error => error.code === 'TASK_ALREADY_RUNNING');
      assert.equal((await tasks.getTask(created.id)).is_running, true);
      assert.equal((await tasks.updateTask(created.id, { title: 'edited during run' })).title, 'edited during run');
      const second = await tasks.createTask({ prompt: 'another', enabled: false });
      assert.ok(second.id);
    } finally { finish.resolve(); }
    const completed = await execution;
    assert.equal(completed.run.status, 'succeeded');
    assert.equal(completed.task.title, 'edited during run');
    assert.equal((await tasks.getTask(created.id)).last_run.status, 'succeeded');
    assert.equal((await readJson(configPath)).tasks.find(task => task.id === created.id).title, 'edited during run');
  });
});

test('queued scheduler mutations keep their submitted destination when the storage root changes', { timeout: 5000 }, async () => {
  await fixture(async root => {
    const firstPath = path.join(root, 'first', 'scheduled-tasks.json');
    const secondPath = path.join(root, 'second', 'scheduled-tasks.json');
    let configPath = firstPath;
    const entered = deferred(), release = deferred();
    const tasks = createScheduledTaskService({ fs: { ...fsp, async writeFile(file, ...args) {
      if (path.dirname(file) === path.dirname(firstPath)) { entered.resolve(); await release.promise; }
      return fsp.writeFile(file, ...args);
    } }, path, getScheduledTasksPath: () => configPath,
    runCodexTask: async () => { throw new Error('Fixture must not execute.'); } });
    const first = tasks.createTask({ prompt: 'first root', enabled: false });
    await entered.promise;
    configPath = secondPath;
    const submitted = { prompt: 'second root', title: 'captured', enabled: false };
    const second = tasks.createTask(submitted);
    submitted.title = 'mutated after submission';
    release.resolve();
    const [firstTask, secondTask] = await Promise.all([first, second]);
    assert.deepEqual((await readJson(firstPath)).tasks.map(task => task.id), [firstTask.id]);
    assert.deepEqual((await readJson(secondPath)).tasks.map(task => task.id), [secondTask.id]);
    assert.equal(secondTask.title, 'captured');
    assert.deepEqual((await tasks.listTasks()).map(task => task.id), [secondTask.id]);
  });
});
