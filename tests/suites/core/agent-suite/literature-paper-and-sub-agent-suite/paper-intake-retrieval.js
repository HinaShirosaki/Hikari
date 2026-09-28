'use strict';

module.exports = function registerPaperIntakeRetrieval(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { createIntakeStore } = require(path.join(root, 'src/main/papers/store/intake/intake-store.js'));
  const { createDirectMcpToolRouter } = require(path.join(root, 'src/main/agent/mcp-contract/direct-tools/index.js'));
  const { scorePaper, tokenize } = require(path.join(root, 'src/main/papers/store/intake/intake-search.js'));
  const tools = require(path.join(root, 'tests/support/paper-intake-mcp-tools.js'));
  const records = [
    {
      paper_id: 'glue', doc_type: 'research_paper', title: 'Compact regulated degradation tags',
      doi: '10.1234/glue.2026', one_sentence_summary: 'Compact tags enable controlled protein degradation.',
      project_ids: ['atlas'], experiments: [{
        id: 'e1', title: 'Binding selection', technique: 'phage-assisted continuous evolution',
        variables: 'PT-179; CRBN; HEK-293 cells', outcome: 'Enrichment of SD40.', figure_ref: 'Fig. 2',
        evidence: 'Immunoblotting confirmed selective depletion of the reporter after 24 hours.'
      }, { id: 'e2', title: 'Independent control', technique: 'Flow cytometry', variables: 'A549', outcome: 'No response.' }]
    },
    {
      paper_id: 'catalysis', doc_type: 'research_paper', title: 'Programmable cleavage', doi: '10.1234/science.12345',
      project_ids: ['beta'], experiments: [{ id: 'e1', technique: 'cleavage assays', variables: 'D10A and H840A Cas9',
        outcome: 'Nuclease domains cleave opposite strands.', figure_ref: 'Fig. 3' }]
    },
    { paper_id: 'noise', doc_type: 'research_paper', title: 'Science and reporter assays',
      one_sentence_summary: 'Reporter assays in cells.', project_ids: ['atlas'],
      experiments: Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, technique: 'reporter assay', variables: 'HEK-293 cells' })) },
    { paper_id: 'review', doc_type: 'review', title: 'Signalling overview', project_ids: ['atlas'],
      structure_outline: [{ section: 'Wnt pathway', summary: 'β-catenin localization and regulation.' }],
      notable_claims: [{ section: 'Assays', claim: 'Quantitative polymerase chain reaction measures transcript abundance.' }] }
  ];

  async function withStore(run) {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-retrieval-'));
    try {
      const store = createIntakeStore({ workspacePath, fs,
        matchProjectName: (record, name) => record.project_ids.includes(name.toLowerCase()) });
      for (const record of records) {
        assert.equal((await store.writeIntake(record.paper_id, record)).ok, true);
      }
      const router = createDirectMcpToolRouter({ intakeStore: store });
      await run({ store, router, workspacePath });
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  }

  test('paper intake retrieval finds experiment-only identifiers, aliases, evidence, outlines and exact DOI through the MCP router', async () => {
    const exported = require(path.join(root, 'docs/agent/mcp-contract/mcp-contract.json'));
    for (const definition of [tools.SEARCH_SUMMARIES_DEFINITION, tools.SEARCH_EXPERIMENTS_DEFINITION]) {
      assert.deepEqual(exported.mcp.tools.find((tool) => tool.name === definition.name), definition);
    }
    await withStore(async ({ router }) => {
      const cases = [
        ['PT179', 'glue', 'experiments.variables'],
        ['H840A', 'catalysis', 'experiments.variables'],
        ['western blot', 'glue', 'experiments.evidence'],
        ['western blotting', 'glue', 'experiments.evidence'],
        ['find papers using phage assisted continuous evolution', 'glue', 'experiments.technique'],
        ['beta-catenin', 'review', 'structure_outline.summary'],
        ['qPCR', 'review', 'notable_claims.claim'],
        ['10.1234/science.12345', 'catalysis', 'doi']
      ];
      for (const [query, paperId, field] of cases) {
        const result = await router.callTool('paper_intake_search_summaries', { query, limit: 1 });
        assert.equal(result.ok, true);
        assert.equal(result.items[0]?.paper_id, paperId, query);
        assert.equal(result.items[0].match_coverage, 1, query);
        assert.equal(result.items[0].match_context[0].field, field, query);
        assert.ok(result.items[0].source_paths.paper_md);
      }
    });
  });

  test('paper intake retrieval preserves identifier boundaries and avoids DOI-prefix false positives', async () => {
    await withStore(async ({ router }) => {
      for (const query of ['PT17', 'H840', '10.1234/science.1234', 'xyzzyunrelated', 'the and for']) {
        const result = await router.callTool('paper_intake_search_summaries', { query });
        assert.equal(result.status, 'no_match', query);
        assert.deepEqual(result.items, [], query);
      }
      const result = await router.callTool('paper_intake_search_summaries', { query: 'https://doi.org/10.1234/science.12345' });
      assert.equal(result.items[0].paper_id, 'catalysis');
      assert.equal(result.items[0].match_coverage, 1);
    });
  });

  test('paper intake retrieval prioritizes specific multi-field matches over repeated generic experiments', async () => {
    await withStore(async ({ router }) => {
      const result = await router.callTool('paper_intake_search_summaries', { query: 'PT179 HEK293', limit: 1 });
      assert.equal(result.items[0].paper_id, 'glue');
      assert.equal(result.items[0].match_coverage, 1);
      assert.equal(result.total_matches, 2);
      assert.equal(result.truncated, true);
      assert.equal(result.items[0].match_context[0].experiment_id, 'e1');
      assert.equal(result.items[0].match_context[0].figure_ref, 'Fig. 2');
      const original = scorePaper(records[0], tokenize('PT179'), 'PT179');
      const repeated = scorePaper({ ...records[0], experiments: Array(100).fill(records[0].experiments[0]) }, tokenize('PT179'), 'PT179');
      assert.equal(original.score, repeated.score);
    });
  });

  test('paper intake retrieval marks partial matches and preserves individual experiment conditions', async () => {
    await withStore(async ({ router }) => {
      const result = await router.callTool('paper_intake_search_summaries', { query: 'PT179 nonexistent' });
      assert.equal(result.items[0].match_coverage, 0.5);
      assert.deepEqual(result.items[0].unmatched_terms, ['nonexistent']);
      const experiment = await router.callTool('paper_intake_search_experiments', { query: 'PT179 A549' });
      assert.ok(experiment.items.every((item) => item.match_coverage < 1));
    });
  });

  test('paper intake retrieval respects active and named projects and allows explicit library scope', async () => {
    await withStore(async ({ router }) => {
      const context = { project: { id: 'atlas', name: 'Atlas' } };
      for (const tool of ['paper_intake_search_summaries', 'paper_intake_search_experiments']) {
        assert.equal((await router.callTool(tool, { query: 'H840A' }, context)).status, 'no_match');
        const all = await router.callTool(tool, { query: 'H840A', scope: 'library' }, context);
        assert.equal(all.items[0].paper_id, 'catalysis');
        assert.equal(all.search_scope, 'library');
        const named = await router.callTool(tool, { query: 'H840A', project_name: 'Beta' }, context);
        assert.equal(named.items[0].paper_id, 'catalysis');
        assert.equal(named.project_id, undefined);
        const explicit = await router.callTool(tool, { query: 'H840A', scope: 'library', project_name: 'Atlas' }, context);
        assert.equal(explicit.status, 'no_match');
      }
    });
  });

  test('paper intake experiment search includes evidence and normalizes technique filters', async () => {
    await withStore(async ({ router }) => {
      const result = await router.callTool('paper_intake_search_experiments', {
        query: 'western blot PT179', technique: 'phage assisted continuous evolution'
      });
      assert.equal(result.items[0].paper_id, 'glue');
      assert.equal(result.items[0].match_coverage, 1);
      assert.match(result.items[0].experiment.evidence, /Immunoblotting/);
      assert.equal((await router.callTool('paper_intake_search_experiments', {
        query: 'PT179', technique: 'PCR'
      })).status, 'no_match');
    });
  });

  test('paper intake retrieval keeps document filters and metadata-only fallbacks', async () => {
    await withStore(async ({ router, workspacePath }) => {
      const dir = path.join(workspacePath, 'KnowledgeBase/papers.md/legacy');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'paper.md'), '# Legacy reagent reference\n');
      await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ title: 'Legacy reagent reference', doi: '10.9999/legacy' }));
      const legacy = await router.callTool('paper_intake_search_summaries', { query: '10.9999/legacy', doc_types: ['research_paper'] });
      assert.equal(legacy.items[0].intake_status, 'metadata_only');
      assert.equal((await router.callTool('paper_intake_search_summaries', {
        query: 'beta catenin', doc_types: ['research_paper']
      })).status, 'no_match');
    });
  });

  test('paper intake retrieval returns exact bounded excerpts near late evidence matches and reports corrupt records', async () => {
    await withStore(async ({ router, store, workspacePath }) => {
      const evidence = `${'A control measurement. '.repeat(50)}UniqueMarker42 is present in the final sample.`;
      await store.writeIntake('late', { doc_type: 'research_paper', experiments: [{ id: 'e1', evidence }] });
      const bad = path.join(workspacePath, 'KnowledgeBase/papers.md/corrupt');
      await fs.mkdir(bad, { recursive: true });
      await fs.writeFile(path.join(bad, 'intake.json'), '{');
      const result = await router.callTool('paper_intake_search_summaries', { query: 'UniqueMarker42' });
      const excerpt = result.items[0].match_context[0].excerpt;
      assert.match(excerpt, /UniqueMarker42/);
      assert.ok(evidence.includes(excerpt));
      assert.ok(excerpt.length <= 360);
      assert.equal(result.errors[0].status, 'corrupt');
    });
  });

  test('paper intake retrieval caches compiled records and invalidates them on store and external writes', async () => {
    const workspacePath = await fs.mkdtemp(path.join(root, 'tmp', 'paper-cache-'));
    try {
      // A private fs identity gives this store its own record cache, so the read
      // counter cannot be perturbed by whatever other suites already cached.
      let reads = 0;
      const countingFs = { ...fs, readFile: (...args) => { reads += 1; return fs.readFile(...args); } };
      const store = createIntakeStore({ workspacePath, fs: countingFs });
      const search = (query) => tools.callSearchSummaries({ query }, {}, { intakeStore: store });
      const intakeFile = path.join(workspacePath, 'KnowledgeBase/papers.md/cached/intake.json');
      assert.equal((await store.writeIntake('cached', { doc_type: 'research_paper', title: 'OriginalMarker' })).ok, true);

      assert.equal((await search('OriginalMarker')).items[0]?.paper_id, 'cached');
      const afterFirstSearch = reads;
      assert.ok(afterFirstSearch > 0, 'the first search must read intake.json');
      assert.equal((await search('OriginalMarker')).items[0]?.paper_id, 'cached');
      assert.equal(reads, afterFirstSearch, 'an unchanged record must be served from cache');

      // A write through the store must drop the entry, not serve the stale title.
      await store.writeIntake('cached', { doc_type: 'research_paper', title: 'RewrittenMarker' });
      assert.equal((await search('OriginalMarker')).status, 'no_match');
      assert.equal((await search('RewrittenMarker')).items[0]?.paper_id, 'cached');

      // Edited behind the store's back: only the file signature can catch this,
      // and the differing length keeps it independent of mtime resolution.
      await fs.writeFile(intakeFile, JSON.stringify({ paper_id: 'cached', doc_type: 'research_paper',
        title: 'ExternallyReplacedMarker', source_paths: { paper_md: 'cached.md' } }));
      assert.equal((await search('RewrittenMarker')).status, 'no_match');
      assert.equal((await search('ExternallyReplacedMarker')).items[0]?.paper_id, 'cached');

      // On a filesystem too coarse to distinguish a same-size rewrite the signature
      // cannot help, so dropping the entry on write is the only remaining defence.
      const frozenClockFs = { ...countingFs, stat: async () => ({ mtimeMs: 1, ctimeMs: 1, size: 1, ino: 1 }) };
      const coarse = createIntakeStore({ workspacePath, fs: frozenClockFs });
      const coarseSearch = (query) => tools.callSearchSummaries({ query }, {}, { intakeStore: coarse });
      await coarse.writeIntake('cached', { doc_type: 'research_paper', title: 'CoarseFirstMarker' });
      assert.equal((await coarseSearch('CoarseFirstMarker')).items[0]?.paper_id, 'cached');
      await coarse.writeIntake('cached', { doc_type: 'research_paper', title: 'CoarseSecondMarker' });
      assert.equal((await coarseSearch('CoarseFirstMarker')).status, 'no_match');
      assert.equal((await coarseSearch('CoarseSecondMarker')).items[0]?.paper_id, 'cached');
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('paper intake retrieval searches beyond the former 1000-paper enumeration cutoff', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `p${i}`);
    const store = createIntakeStore({ workspacePath: '/fixture', listKnownPaperIds: async () => ids,
      fs: { readdir: async () => [], readFile: async (file) => JSON.stringify({
        paper_id: path.basename(path.dirname(file)), doc_type: 'research_paper',
        title: file.includes('/p1000/') ? 'RareLastMarker' : 'Unrelated', source_paths: { paper_md: 'paper.md' }
      }) } });
    const result = await tools.callSearchSummaries({ query: 'RareLastMarker' }, {}, { intakeStore: store });
    assert.equal(result.items[0].paper_id, 'p1000');
    const directoryStore = createIntakeStore({ workspacePath: '/fixture', fs: {
      readFile: async () => '', readdir: async () => ids.map((name) => ({ name, isDirectory: () => true }))
    } });
    assert.equal((await directoryStore.listPaperIds()).length, 1001);
  });
};
