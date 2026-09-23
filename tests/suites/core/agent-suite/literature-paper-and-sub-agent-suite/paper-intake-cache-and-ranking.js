'use strict';

module.exports = function registerPaperIntakeCacheAndRanking(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { createIntakeStore } = require(path.join(root, 'src/main/papers/store/intake/intake-store.js'));
  const { tokenize, scorePaper, rankAndTrim, scoreTextAgainstTokens } = require(path.join(root, 'src/main/papers/store/intake/intake-search.js'));
  const { preparePaper } = require(path.join(root, 'src/main/papers/store/intake/search/compiled.js'));
  const { createAgentMcpGateway } = require(path.join(root, 'src/main/agent/mcp-contract/gateway.js'));

  test('paper intake ranking tolerates null and malformed candidates before computing IDF', () => {
    const valid = { record: { paper_id: 'a' }, score: 2, matched: ['antibody'] };
    const items = rankAndTrim([null, undefined, {}, { score: NaN }, { score: 0 }, { score: 1 }, valid], 3, ['antibody']);
    assert.equal(items[0].record.paper_id, 'a');
    assert.equal(items[0].coverage, 1);
    assert.deepEqual(rankAndTrim([null, {}], 3, ['antibody']), []);
  });

  test('paper intake scoring and coverage count each folded concept once', () => {
    assert.deepEqual(tokenize('antibody antibodies antibody'), ['antibody']);
    assert.deepEqual(tokenize('antibodies antibody'), ['antibodies']);
    assert.equal(scoreTextAgainstTokens('antibody', ['antibody', 'antibodies']).score, 1);
    const result = rankAndTrim([{ score: 1, matched: ['antibodies', 'antibody'] }], 3, ['antibody', 'antibodies', 'serum']);
    assert.equal(result[0].coverage, 0.5);
    assert.deepEqual(result[0].matched, ['antibody']);
    assert.deepEqual(result[0].unmatched, ['serum']);
    assert.deepEqual(tokenize('PT179 PT17'), ['pt179', 'pt17']);
  });

  test('paper intake ranking prefers title evidence at equal coverage while retaining more complete experiment hits', () => {
    const query = 'nanobody serum stability';
    const tokens = tokenize(query);
    const title = { paper_id: 'title', title: 'Stability of single domain antibodies in serum' };
    const details = [1, 2].map((id) => ({ paper_id: `details${id}`, title: 'Peptide engineering',
      one_sentence_summary: 'Serum stability was measured.',
      experiments: [{ title: 'Serum stability', technique: 'Serum stability assay',
        variables: 'Serum stability', outcome: 'Serum stability improved.', evidence: 'Serum stability improved.' }] }));
    const rank = (records) => rankAndTrim(records.map((record) => ({ record, ...scorePaper(record, tokens, query) })), 4, tokens);
    assert.equal(rank([...details, title])[0].record.paper_id, 'title');
    const complete = { paper_id: 'complete', title: 'Targeted study',
      experiments: [{ variables: 'nanobody serum stability', technique: 'nanobody serum stability assay' }] };
    assert.equal(rank([...details, title, complete])[0].record.paper_id, 'complete');
    const mutable = { title: 'antibody' };
    assert.ok(scorePaper(mutable, ['antibody']).score > 0);
    mutable.title = 'serum';
    assert.equal(scorePaper(mutable, ['antibody']).score, 0);
  });

  test('paper intake cache survives MCP store recreation and invalidates writes, additions, corruption, and deletion', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-intake-cache-'));
    let reads = 0;
    const countedFs = { ...fs, readFile: async (...args) => {
      if (String(args[0]).endsWith('intake.json')) reads += 1;
      return fs.readFile(...args);
    } };
    const store = createIntakeStore({ workspacePath, fs: countedFs });
    const gateway = createAgentMcpGateway({ workspacePath, fs: countedFs, env: {} });
    const search = (query) => gateway.callGatewayTool('paper_intake_search_summaries', { query });
    const file = path.join(workspacePath, 'KnowledgeBase/papers.md/a/intake.json');
    try {
      await store.writeIntake('a', { title: 'MarkerAlpha', doc_type: 'research_paper',
        experiments: [{ id: 'e1', variables: 'PT179' }] });
      assert.equal((await search('MarkerAlpha')).items[0].paper_id, 'a');
      reads = 0;
      const first = (await store.loadAll()).records[0];
      assert.equal((await search('PT179')).items[0].paper_id, 'a');
      const second = (await createIntakeStore({ workspacePath, fs: countedFs }).loadAll()).records[0];
      assert.equal(reads, 0, 'warm calls must not reread JSON');
      assert.equal(first, second);
      assert.equal(preparePaper(first), preparePaper(second));
      assert.ok(Object.isFrozen(first.experiments[0]));

      // Editing an existing file does not change its parent directory mtime.
      const parentBefore = await fs.stat(path.dirname(file));
      const before = await fs.stat(file);
      const raw = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, raw.replace('MarkerAlpha', 'MarkerBravo'));
      await fs.utimes(file, before.atime, before.mtime);
      const parentAfter = await fs.stat(path.dirname(file));
      assert.equal(parentAfter.mtimeMs, parentBefore.mtimeMs);
      assert.equal((await search('MarkerBravo')).items[0].paper_id, 'a');
      assert.equal((await search('MarkerAlpha')).status, 'no_match');
      assert.equal(reads, 1);

      await store.writeIntake('a', { title: 'MarkerCharlie' });
      assert.equal((await search('MarkerCharlie')).items[0].paper_id, 'a');
      await store.writeIntake('b', { title: 'MarkerDelta' });
      assert.equal((await search('MarkerDelta')).items[0].paper_id, 'b');
      await fs.writeFile(file, '{');
      const corrupt = await search('MarkerCharlie');
      assert.equal(corrupt.status, 'no_match');
      assert.equal(corrupt.errors[0].status, 'corrupt');
      await fs.writeFile(file, raw);
      assert.equal((await search('MarkerAlpha')).items[0].paper_id, 'a');
      await fs.rm(path.dirname(file), { recursive: true, force: true });
      assert.equal((await search('MarkerAlpha')).status, 'no_match');
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('paper intake cache keeps workspace isolation and refreshes legacy source paths', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-intake-cache-path-'));
    try {
      const folder = path.join(workspacePath, 'KnowledgeBase/papers.md/a');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'intake.json'), JSON.stringify({ paper_id: 'a', title: 'Legacy' }));
      await fs.writeFile(path.join(folder, 'old.md'), '# Old');
      const store = createIntakeStore({ workspacePath, fs });
      assert.match((await store.loadAll()).records[0].source_paths.paper_md, /old.md$/);
      await fs.rename(path.join(folder, 'old.md'), path.join(folder, 'new.md'));
      assert.match((await store.loadAll()).records[0].source_paths.paper_md, /new.md$/);
      const other = createIntakeStore({ workspacePath: path.join(workspacePath, 'other'), fs });
      await other.writeIntake('a', { title: 'Different workspace' });
      assert.equal((await other.loadAll()).records[0].title, 'Different workspace');
      assert.equal((await store.loadAll()).records[0].title, 'Legacy');
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });
};
