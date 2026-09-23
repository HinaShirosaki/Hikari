'use strict';

module.exports = function registerPaperFulltextSearch(context = {}) {
  const { assert, test, fsPromises: fs, path } = context.scope;
  const root = context.__dirname || process.cwd();
  const { openKnowledgeDatabase, runStatement } = require(path.join(root, 'src/main/papers/store/paper-knowledge-store.js'));
  const { applyWikiChunkSchema } = require(path.join(root, 'src/main/papers/retrieve/agent-paper-wiki-chunker.js'));
  const { createPaperWikiSearchRuntime } = require(path.join(root, 'src/main/papers/retrieve/agent-paper-wiki-search.js'));

  test('full-text search scans complete Markdown without rebuilding and preserves scope and indexed fallback', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'tmp', 'fulltext-search-'));
    try {
      const dir = path.join(workspace, 'KnowledgeBase');
      await fs.mkdir(dir);
      const file = path.join(dir, 'knowledge.index.sqlite');
      const db = await openKnowledgeDatabase(file);
      applyWikiChunkSchema(db);
      for (const id of ['indexed', 'unindexed', 'missing', 'other']) {
        runStatement(db, 'INSERT INTO papers (id,title,wiki_path) VALUES (?,?,?)', [id, id, `${id}.md`]);
        runStatement(db, 'INSERT INTO paper_locations (id,paper_id,scope,container) VALUES (?,?,?,?)', [id, id, 'project', id === 'other' ? 'B' : 'A']);
      }
      // More than the former 400-candidate cap; the strongest hit is last.
      for (let i = 0; i < 405; i += 1) {
        runStatement(db, `INSERT INTO paper_chunks
          (id,paper_id,section_index,section_heading,body,body_lower,char_length)
          VALUES (?,?,?,?,?,?,?)`, [String(i), 'missing', i, 'Cached', i === 404 ? 'needle needle needle' : 'needle filler', i === 404 ? 'needle needle needle' : 'needle filler', 20]);
      }
      runStatement(db, `INSERT INTO paper_chunks
        (id,paper_id,section_index,section_heading,body,body_lower,char_length)
        VALUES ('old','indexed',0,'Old','obsolete','obsolete',8)`);
      await fs.writeFile(file, Buffer.from(db.export()));
      db.close();
      await fs.writeFile(path.join(workspace, 'indexed.md'), `## Results\n${'x'.repeat(14000)} lateMarker\n### Validation (p. 8)\nPT179`);
      await fs.writeFile(path.join(workspace, 'unindexed.md'), '## Results (pp. 2-3)\nMG-PACE PT-179');
      await fs.writeFile(path.join(workspace, 'other.md'), '## Results\nprivateMarker');
      const before = await fs.readFile(file);
      const search = (query, args = {}) => createPaperWikiSearchRuntime().searchWikiSections({ storage_path: workspace, query, ...args });
      assert.equal((await search('lateMarker')).matches[0].paper_id, 'indexed');
      const fresh = await search('MG-PACE');
      assert.equal(fresh.matches[0].paper_id, 'unindexed');
      assert.equal((await search('PT179', { paper_id: 'unindexed' })).match_count, 1);
      assert.equal((await search('PT17', { paper_id: 'unindexed' })).match_count, 0);
      assert.equal(fresh.matches[0].page_citation, 'pp. 2-3');
      assert.equal((await search('PT179', { paper_id: 'indexed' })).matches[0].page_citation, 'p. 8');
      assert.equal((await search('obsolete')).match_count, 0);
      assert.equal((await search('privateMarker', { scope: 'project', container: 'A' })).match_count, 0);
      assert.equal((await search('privateMarker', { scope: 'project', container: 'B' })).match_count, 1);
      const cached = await search('needle', { limit: 1 });
      assert.equal(cached.matches[0].chunk_id, '404');
      assert.equal(cached.partial, true);
      assert.equal(cached.source_errors[0].paper_id, 'missing');
      await fs.writeFile(path.join(workspace, 'unindexed.md'), '## Results\nchangedMarker');
      assert.equal((await search('changedMarker')).match_count, 1);
      assert.equal((await search('MG-PACE')).match_count, 0);
      assert.deepEqual(await fs.readFile(file), before);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
};
