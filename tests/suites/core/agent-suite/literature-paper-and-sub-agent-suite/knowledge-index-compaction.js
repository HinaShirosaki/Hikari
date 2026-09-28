'use strict';

module.exports = function registerKnowledgeIndexCompaction(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { openKnowledgeDatabase, persistKnowledgeDatabase, withKnowledgeDatabaseWrite, queryRows, findExistingPaperRow }
    = require(path.join(root, 'src/main/papers/store/paper-knowledge-store.js'));
  const { createPaperWikiSearchRuntime } = require(path.join(root, 'src/main/papers/retrieve/agent-paper-wiki-search.js'));
  const { createPaperKnowledgeDatabaseRuntime } = require(path.join(root, 'src/main/papers/store/agent-paper-knowledge-database.js'));

  async function fixture(workspace) {
    const folder = path.join(workspace, 'KnowledgeBase', 'papers.md', 'example');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(workspace, 'KnowledgeBase', 'knowledge.index.sqlite');
    const db = await openKnowledgeDatabase(file);
    db.run(`ALTER TABLE papers ADD COLUMN abstract TEXT;
      ALTER TABLE papers ADD COLUMN authors_json TEXT;
      ALTER TABLE papers ADD COLUMN journal TEXT;
      ALTER TABLE papers ADD COLUMN year TEXT;
      ALTER TABLE papers ADD COLUMN wiki_status TEXT;
      ALTER TABLE papers ADD COLUMN notes TEXT;
      ALTER TABLE paper_locations ADD COLUMN discovered_at TEXT;
      CREATE TABLE paper_chunks (id TEXT PRIMARY KEY, paper_id TEXT, body TEXT);
      INSERT INTO papers (id, doi, pmid, pmcid, title, pdf_sha256, wiki_path, abstract, authors_json, journal, year, wiki_status, notes)
        VALUES ('p1', '10.1/example', '1234', 'PMC1234', 'Example', 'sha1',
          'KnowledgeBase/papers.md/example/paper.md', 'An important abstract', '["Author A"]', 'Old Journal', '2025', 'ready', 'Keep these notes');
      INSERT INTO paper_locations (id, paper_id, scope, container, pdf_path, discovered_at)
        VALUES ('loc1', 'p1', 'project', 'A', 'Papers/example.pdf', '2025-01-01');`);
    db.run('INSERT INTO paper_chunks VALUES (?, ?, ?)', ['old', 'p1', 'obsolete '.repeat(20000)]);
    await fs.writeFile(file, Buffer.from(db.export()));
    db.close();
    const meta = path.join(folder, 'meta.json');
    await fs.writeFile(meta, JSON.stringify({ journal: 'Corrected Journal', authors: [], figures: [{ file_name: 'keep.png' }] }));
    await fs.writeFile(path.join(folder, 'paper.md'), '## Methods (p. 4)\nCurrent evidence marker');
    return { file, meta, folder };
  }

  test('knowledge index compacts legacy text and metadata with recoverable backup and stable lookup', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'tmp', 'knowledge-compact-'));
    try {
      const { file, meta } = await fixture(workspace);
      const original = await fs.readFile(file);
      const originalMeta = await fs.readFile(meta);
      const search = () => createPaperWikiSearchRuntime().searchWikiSections({ storage_path: workspace, query: 'evidence', scope: 'project', container: 'A' });
      assert.equal((await search()).matches[0].journal, 'Corrected Journal');
      assert.deepEqual(await fs.readFile(file), original, 'legacy reads leave the index untouched');
      assert.deepEqual(await fs.readFile(meta), originalMeta, 'legacy reads leave metadata untouched');
      const compact = () => withKnowledgeDatabaseWrite(file, (db) => persistKnowledgeDatabase(file, db));
      await compact();
      assert.ok((await fs.stat(file)).size < original.length / 2, 'VACUUM reclaims discarded text pages');
      assert.deepEqual(await fs.readFile(`${file}.pre-compact.bak`), original);
      const metadata = JSON.parse(await fs.readFile(meta, 'utf8'));
      assert.equal(metadata.abstract, 'An important abstract');
      assert.equal(metadata.notes, 'Keep these notes');
      assert.equal(metadata.journal, 'Corrected Journal', 'existing JSON takes precedence');
      assert.deepEqual(metadata.authors, ['Author A']);
      assert.deepEqual(metadata.figures, [{ file_name: 'keep.png' }]);
      assert.equal(metadata.locations[0].discovered_at, '2025-01-01');
      const db = await openKnowledgeDatabase(file);
      try {
        assert.equal(queryRows(db, 'PRAGMA table_info(papers)').length, 7);
        assert.equal(queryRows(db, 'PRAGMA table_info(paper_locations)').length, 5);
        assert.deepEqual(queryRows(db, "SELECT name FROM sqlite_master WHERE name = 'paper_chunks'"), []);
        for (const identity of [{ doi: '10.1/EXAMPLE' }, { pmid: '1234' }, { pmcid: 'PMC1234' }, { pdfSha256: 'sha1' }, { title: 'Example' }]) {
          assert.equal(findExistingPaperRow(db, identity).id, 'p1');
        }
        assert.equal(queryRows(db, 'PRAGMA integrity_check')[0].integrity_check, 'ok');
      } finally { db.close(); }
      const result = await search();
      assert.equal(result.matches[0].year, '2025');
      assert.equal(result.matches[0].page_citation, 'p. 4');
      const lookup = await createPaperKnowledgeDatabaseRuntime({}).lookupPaper({ storage_path: workspace, pmid: '1234' });
      assert.equal(lookup.paper.wiki_status, 'ready');
      assert.equal(lookup.paper.location.pdf_filename, 'example.pdf');
      assert.equal(lookup.paper.location.discovered_at, '2025-01-01');
      const { createPaperAnalysisRuntime } = require(path.join(root, 'src/main/papers/analysis/agent-paper-analysis.js'));
      let delegated;
      const analysis = createPaperAnalysisRuntime({
        subAgentRuntime: { createSubAgent: async () => { throw new Error('Unexpected real delegation'); } },
        runCodexPaperContextSubAgent: async (input) => { delegated = input; return { ok: true }; }
      });
      assert.equal((await analysis.analyzePaper({ storage_path: workspace, paper_id: 'p1' })).ok, true);
      assert.equal(delegated.selectedPapers[0].summary, 'An important abstract');
      assert.equal(delegated.downloadedPapers[0].knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/example/paper.md');
      const compactedMeta = await fs.readFile(meta);
      await compact();
      assert.deepEqual(await fs.readFile(meta), compactedMeta, 'second migration is a no-op');
      assert.deepEqual(await fs.readFile(`${file}.pre-compact.bak`), original, 'never replace the original backup');
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  });

  test('paper re-ingestion keeps JSON metadata and identity while updating compact location links', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'tmp', 'knowledge-reingest-'));
    try {
      const { file } = await fixture(workspace);
      const pdf = path.join(workspace, 'Papers', 'example.pdf');
      await fs.mkdir(path.dirname(pdf), { recursive: true });
      await fs.writeFile(pdf, '%PDF-1.7\nfixture');
      const runtime = createPaperKnowledgeDatabaseRuntime({
        pdfTextExtractionRuntime: {
          extractText: async () => ({ ok: true, text: 'Updated evidence', pages: [{ page_number: 1, text: 'Updated evidence' }] })
        },
        paperIntakePipeline: { runIntakeForPaper: async () => ({ status: 'ready' }) }
      });
      const result = await runtime.ingestPaperPdf({ storage_path: workspace, file_path: pdf,
        doi: '10.1/example', title: 'Example', linked_type: 'project', linked_name: 'B', use_llm_rewrite: false });
      assert.equal(result.ok, true);
      assert.equal(result.paper_id, 'p1');
      const metadata = JSON.parse(await fs.readFile(result.meta_path, 'utf8'));
      assert.equal(metadata.abstract, 'An important abstract');
      assert.equal(metadata.notes, 'Keep these notes');
      assert.equal(metadata.pmid, '1234');
      assert.equal(metadata.journal, 'Corrected Journal');
      assert.deepEqual(metadata.authors, ['Author A']);
      const db = await openKnowledgeDatabase(file);
      try {
        assert.equal(queryRows(db, 'SELECT count(*) AS n FROM papers')[0].n, 1);
        assert.equal(queryRows(db, 'PRAGMA table_info(papers)').length, 7);
        assert.equal(queryRows(db, "SELECT count(*) AS n FROM sqlite_master WHERE name='paper_chunks'")[0].n, 0);
      } finally { db.close(); }
      const lookup = await runtime.lookupPaper({ storage_path: workspace, pmcid: 'PMC1234', linked_type: 'project', linked_name: 'B' });
      assert.equal(lookup.paper.pdf_exists, true);
      assert.equal(lookup.paper.wiki_status, 'ready');
      assert.equal(lookup.paper.location.container, 'B');
      await assert.rejects(fs.access(path.join(workspace, 'KnowledgeBase', 'index.json')));
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  });

  test('knowledge index refuses malformed metadata without altering either source', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'tmp', 'knowledge-compact-invalid-'));
    try {
      const { file, meta } = await fixture(workspace);
      await fs.writeFile(meta, '{broken');
      const original = await fs.readFile(file);
      await assert.rejects(withKnowledgeDatabaseWrite(file, (db) => persistKnowledgeDatabase(file, db)), SyntaxError);
      assert.deepEqual(await fs.readFile(file), original);
      assert.equal(await fs.readFile(meta, 'utf8'), '{broken');
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  });
};
