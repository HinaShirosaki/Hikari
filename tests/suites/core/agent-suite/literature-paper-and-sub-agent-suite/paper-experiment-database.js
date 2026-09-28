'use strict';

module.exports = function registerPaperExperimentDatabase(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { createIntakeStore } = require(path.join(root, 'src/main/papers/store/intake/intake-store.js'));
  const { createIntakePipeline } = require(path.join(root, 'src/main/papers/store/intake/intake-pipeline.js'));
  const { loadSqlJs, querySqlRows: rows } = require(path.join(root, 'src/main/lib/sqlite.js'));
  const databasePath = (workspace) => path.join(workspace, 'KnowledgeBase', 'experiments.sqlite');
  const intakePath = (workspace, id) => path.join(workspace, 'KnowledgeBase', 'papers.md', id, 'intake.json');
  const experiment = { id: 'e1', title: 'Binding assay', technique: 'SPR', variables: 'Antibody concentration',
    figure_ref: 'Fig. 2A', outcome: 'Binding increased.', evidence: 'Binding increased with antibody concentration.' };
  const record = { doc_type: 'research_paper', title: 'Antibody binding', doi: '10.1234/binding',
    experiments: [experiment], project_ids: ['project-1'], one_sentence_summary: 'Antibodies bind the target.' };

  async function inspect(workspace, action) {
    const SQL = await loadSqlJs();
    const db = new SQL.Database(await fs.readFile(databasePath(workspace)));
    try {
      assert.equal(rows(db, 'PRAGMA integrity_check')[0].integrity_check, 'ok');
      assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), []);
      return action(db);
    } finally { db.close(); }
  }

  test('paper experiment SQLite persists evidence from the full intake pipeline and excludes unsaved extraction', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiments-pipeline-'));
    try {
      const pipeline = createIntakePipeline({ workspacePath, fs,
        requestStructuredJsonPayload: async ({ stage }) => {
          if (stage === 'paper_intake_classification') return { ok: true, payload: { doc_type: 'research_paper', confidence: 1 } };
          if (stage === 'paper_intake_research_page') return { ok: true, payload: { experiments: [experiment], request_next_page: false } };
          return { ok: true, payload: { one_sentence_summary: record.one_sentence_summary } };
        }
      });
      const input = { paperId: 'paper-a', title: record.title, doi: record.doi, projectIds: record.project_ids,
        markdown: experiment.evidence, paperMarkdownRelativePath: 'KnowledgeBase/papers.md/paper-a/Original.md' };
      assert.equal((await pipeline.runIntakeForPaper({ ...input, save: false })).ok, true);
      await assert.rejects(fs.stat(databasePath(workspacePath)), { code: 'ENOENT' });
      const result = await pipeline.runIntakeForPaper(input);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.experiment_count, 1);
      await inspect(workspacePath, (db) => {
        assert.equal(rows(db, 'PRAGMA user_version')[0].user_version, 1);
        assert.deepEqual(rows(db, 'SELECT * FROM experiments'), [{ paper_id: 'paper-a', ordinal: 1, ...experiment }]);
        const paper = rows(db, 'SELECT * FROM papers')[0];
        assert.equal(paper.title, record.title);
        assert.equal(paper.doi, record.doi);
        assert.deepEqual(JSON.parse(paper.project_ids_json), record.project_ids);
        assert.equal(paper.intake_path, 'KnowledgeBase/papers.md/paper-a/intake.json');
        assert.equal(paper.paper_md, input.paperMarkdownRelativePath);
        assert.equal(paper.updated_at, result.record.updated_at);
      });
      const bytes = await fs.readFile(databasePath(workspacePath));
      await pipeline.store.loadAll();
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), bytes, 'search reads do not write SQLite');
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  });

  test('paper experiment SQLite replaces one paper without duplicates and clears removed or nonresearch experiments', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiments-replace-'));
    try {
      const store = createIntakeStore({ workspacePath, fs });
      assert.equal((await store.writeIntake('a', { ...record, experiments: [experiment, { ...experiment, title: 'Another experiment with the same legacy id' }] })).ok, true);
      assert.equal((await store.writeIntake('b', record)).ok, true);
      await inspect(workspacePath, (db) => assert.equal(rows(db, 'SELECT * FROM experiments').length, 3));
      assert.equal((await store.writeIntake('a', { experiments: [{ ...experiment, outcome: 'Updated result' }] })).ok, true);
      await inspect(workspacePath, (db) => {
        const experiments = rows(db, 'SELECT * FROM experiments ORDER BY paper_id');
        assert.equal(experiments.length, 2);
        assert.equal(experiments[0].outcome, 'Updated result');
        assert.equal(experiments[1].outcome, experiment.outcome);
      });
      assert.equal((await store.writeIntake('a', { experiments: [] })).ok, true);
      assert.equal((await store.writeIntake('b', { doc_type: 'book' })).ok, true);
      await inspect(workspacePath, (db) => assert.deepEqual(rows(db, 'SELECT * FROM experiments'), []));
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  });

  test('paper experiment SQLite backfills existing intakes across project filters and rebuilds without modifying sources', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiments-backfill-'));
    try {
      const old = intakePath(workspacePath, 'old');
      await fs.mkdir(path.dirname(old), { recursive: true });
      const original = JSON.stringify({ ...record, paper_id: 'old', source_paths: { paper_md: 'KnowledgeBase/papers.md/old/paper.md' } });
      await fs.writeFile(old, original);
      const store = createIntakeStore({ workspacePath, fs, listKnownPaperIds: async () => ['new'] });
      assert.equal((await store.writeIntake('new', record)).ok, true);
      await inspect(workspacePath, (db) => assert.deepEqual(rows(db, 'SELECT paper_id FROM papers ORDER BY paper_id'), [{ paper_id: 'new' }, { paper_id: 'old' }]));
      assert.equal(await fs.readFile(old, 'utf8'), original);
      await fs.writeFile(old, JSON.stringify({ ...record, experiments: [{ ...experiment, technique: 'ELISA' }] }));
      await fs.rm(path.dirname(intakePath(workspacePath, 'new')), { recursive: true });
      const updated = await fs.readFile(old);
      const rebuilt = await store.rebuildExperimentDatabase();
      assert.equal(rebuilt.ok, true, rebuilt.error);
      assert.equal(rebuilt.paper_count, 1);
      assert.equal(rebuilt.experiment_count, 1);
      assert.deepEqual(await fs.readFile(old), updated);
      await inspect(workspacePath, (db) => assert.equal(rows(db, 'SELECT technique FROM experiments')[0].technique, 'ELISA'));
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  });

  test('paper experiment SQLite serializes concurrent stores, partial updates, and rebuilds', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiments-concurrent-'));
    try {
      const stores = Array.from({ length: 12 }, () => createIntakeStore({ workspacePath, fs }));
      const results = await Promise.all(stores.map((store, index) => store.writeIntake(`p${index}`, record)));
      results.forEach((result) => assert.equal(result.ok, true, result.error));
      const updates = await Promise.all([
        stores[0].writeIntake('p0', { title: 'Changed title' }),
        stores[1].rebuildExperimentDatabase(),
        stores[2].writeIntake('p0', { doi: '10.1234/changed' })
      ]);
      updates.forEach((result) => assert.equal(result.ok, true, result.error));
      await inspect(workspacePath, (db) => {
        assert.equal(rows(db, 'SELECT * FROM experiments').length, 12);
        const paper = rows(db, 'SELECT * FROM papers WHERE paper_id = ?', ['p0'])[0];
        assert.equal(paper.title, 'Changed title');
        assert.equal(paper.doi, '10.1234/changed');
      });
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  });

  test('paper experiment SQLite preserves the database on failed saves or incomplete rebuilds and recovers from intake JSON', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-experiments-recovery-'));
    try {
      const store = createIntakeStore({ workspacePath, fs });
      assert.equal((await store.writeIntake('a', record)).ok, true);
      const original = await fs.readFile(databasePath(workspacePath));
      const originalIntake = await fs.readFile(intakePath(workspacePath, 'a'));
      const failingJson = createIntakeStore({ workspacePath, fs: { ...fs,
        rename: async (from, to) => {
          if (to.endsWith('intake.json')) throw new Error('Simulated intake rename failure');
          return fs.rename(from, to);
        }
      } });
      assert.equal((await failingJson.writeIntake('a', { experiments: [] })).status, 'write_failed');
      assert.deepEqual(await fs.readFile(intakePath(workspacePath, 'a')), originalIntake);
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), original);
      const failing = createIntakeStore({ workspacePath, fs: { ...fs,
        rename: async (from, to) => {
          if (to === databasePath(workspacePath)) throw new Error('Simulated database rename failure');
          return fs.rename(from, to);
        }
      } });
      const failed = await failing.writeIntake('a', { experiments: [{ ...experiment, outcome: 'Recover this result' }] });
      assert.equal(failed.ok, false);
      assert.equal(failed.intake_saved, true);
      assert.equal(failed.status, 'experiment_index_failed');
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), original);
      assert.equal((await fs.readdir(path.dirname(databasePath(workspacePath)))).some((name) => name.endsWith('.tmp')), false);
      const source = await fs.readFile(intakePath(workspacePath, 'a'));
      await fs.writeFile(intakePath(workspacePath, 'a'), '{');
      assert.equal((await store.rebuildExperimentDatabase()).ok, false);
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), original);
      await fs.writeFile(intakePath(workspacePath, 'a'), 'null');
      assert.equal((await store.rebuildExperimentDatabase()).ok, false);
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), original);
      await fs.writeFile(intakePath(workspacePath, 'a'), source);
      const unreadable = createIntakeStore({ workspacePath, fs: { ...fs, readdir: async () => { throw new Error('Unreadable library'); } } });
      assert.equal((await unreadable.rebuildExperimentDatabase()).ok, false);
      assert.deepEqual(await fs.readFile(databasePath(workspacePath)), original);
      assert.equal((await store.rebuildExperimentDatabase()).ok, true);
      await inspect(workspacePath, (db) => assert.equal(rows(db, 'SELECT outcome FROM experiments')[0].outcome, 'Recover this result'));
      await fs.writeFile(databasePath(workspacePath), 'corrupt SQLite');
      assert.equal((await store.writeIntake('b', record)).ok, false, 'ordinary saves must not silently discard a corrupt database');
      assert.equal(await fs.readFile(databasePath(workspacePath), 'utf8'), 'corrupt SQLite');
      assert.equal((await store.rebuildExperimentDatabase()).experiment_count, 2);
      await inspect(workspacePath, (db) => assert.equal(rows(db, 'SELECT * FROM experiments').length, 2));
    } finally { await fs.rm(workspacePath, { recursive: true, force: true }); }
  });
};
