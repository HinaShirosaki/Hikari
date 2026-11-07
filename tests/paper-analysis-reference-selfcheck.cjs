'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
if (process.env.HIKARI_ANALYSIS_PACKAGE && !process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, String(result.error || result.signal));
  process.exit(0);
}
const runtimeRoot = process.env.HIKARI_ANALYSIS_PACKAGE
  ? path.resolve(process.env.HIKARI_ANALYSIS_PACKAGE, 'Contents/Resources/app.asar') : path.resolve(__dirname, '..');
const { loadSqlJs } = require(path.join(runtimeRoot, 'src/main/storage/storage-utils.js'));
const { SCHEMA } = require(path.join(runtimeRoot, 'src/main/papers/store/knowledge-index-schema.js'));
const { loadLocalPaperReference } = require(path.join(runtimeRoot, 'src/main/papers/analysis/local-paper-reference.js'));
const { createPaperAnalysisRuntime } = require(path.join(runtimeRoot, 'src/main/papers/analysis/agent-paper-analysis.js'));

function checkStrictSchema(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, 'Every nested object must reject undeclared fields');
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), 'Every declared property must be required');
  }
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) value.forEach(checkStrictSchema);
    else if (value && typeof value === 'object') checkStrictSchema(value);
  }
}

async function main() {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-analysis-reference-'));
  try {
    const SQL = await loadSqlJs();
    const db = new SQL.Database(); db.run(SCHEMA);
    const specs = [
      { slug: '10.1126_science.1225829', title: 'A Programmable Dual-RNA–Guided DNA Endonuclease', doi: '10.1126/science.1225829' },
      { slug: 'PAM_structure', title: 'Structural basis of PAM-dependent target recognition', doi: '10.1038/nature13579' },
      { slug: 'FACT_turnover', title: 'FACT induces Cas9 multi-turnover behavior', doi: '10.1016/j.molcel.2020.06.014' },
      { slug: 'unicode', title: '实验方法', doi: '' },
      { slug: 'collision-a', title: 'Same title', doi: '10.1000/a' },
      { slug: 'collision-b', title: 'Same title', doi: '10.1000/b' }
    ];
    for (const [index, spec] of specs.entries()) {
      spec.id = `paper-canonical-${index}`;
      const folder = path.join('KnowledgeBase/papers.md', spec.slug);
      spec.relative = `${folder}/Title_${index}.md`;
      spec.content = `# ${spec.title}\n\nPhysical evidence for paper ${index}.\n`;
      await fs.mkdir(path.join(storage, folder), { recursive: true });
      await fs.writeFile(path.join(storage, spec.relative), spec.content);
      await fs.writeFile(path.join(storage, folder, 'meta.json'), JSON.stringify({
        title: spec.title, paper_id: spec.id, doi: spec.doi, markdown_path: spec.relative
      }));
      // A renamed Markdown file must be resolved through the shared locator.
      db.run('INSERT INTO papers(id,title,doi,wiki_path) VALUES(?,?,?,?)',
        [spec.id, spec.title, spec.doi || null, `${folder}/paper.md`]);
    }
    await fs.writeFile(path.join(storage, 'KnowledgeBase/knowledge.index.sqlite'), db.export());db.close();
    for (const spec of specs.slice(0, 4)) {
      for (const reference of [{ paperId: spec.slug }, { paperId: spec.id }, { title: spec.title },
        ...(spec.doi ? [{ doi: `https://doi.org/${spec.doi.toUpperCase()}` }] : [])]) {
        const result = await loadLocalPaperReference({ storagePath: storage, ...reference });
        assert.equal(result?.id, spec.id, JSON.stringify(reference));
        assert.equal(result.content, spec.content);
        assert.equal(result.markdown_relative_path, spec.relative);
      }
    }
    const punctuation = await loadLocalPaperReference({ storagePath: storage,
      title: specs[0].title.replace('–', '-') });
    assert.equal(punctuation?.id, specs[0].id, 'Punctuation variants reuse the saved identity');
    assert.equal(await loadLocalPaperReference({ storagePath: storage, title: 'Same title' }), null, 'Ambiguous titles cannot choose a paper');
    assert.equal(await loadLocalPaperReference({ storagePath: storage, paperId: '../outside' }), null);
    assert.equal(await loadLocalPaperReference({ storagePath: storage, paperId: 'unknown' }), null);

    const unindexed = path.join(storage, 'KnowledgeBase/papers.md/not-yet-indexed');
    await fs.mkdir(unindexed, { recursive: true });
    await fs.writeFile(path.join(unindexed, 'paper.md'), '# Explicit saved source');
    await fs.writeFile(path.join(unindexed, 'meta.json'), JSON.stringify({ paper_id: 'explicit-source', title: 'Explicit saved source' }));
    assert.equal((await loadLocalPaperReference({ storagePath: storage, paperId: 'not-yet-indexed', title: specs[0].title }))?.id,
      'explicit-source', 'The explicit folder reference wins over a conflicting title');

    // A paper returned by intake search remains readable without a SQLite row.
    const intakeRoot = path.join(storage, 'intake-only');
    const intakeFolder = path.join(intakeRoot, 'KnowledgeBase/papers.md/intake-id');
    await fs.mkdir(intakeFolder, { recursive: true });
    await fs.writeFile(path.join(intakeFolder, 'Legacy title.md'), '# Saved\n\nExact text.');
    await fs.writeFile(path.join(intakeFolder, 'meta.json'), JSON.stringify({ paper_id: 'canonical-intake', title: 'Saved' }));
    assert.equal((await loadLocalPaperReference({ storagePath: intakeRoot, paperId: 'intake-id' }))?.id, 'canonical-intake');

    const legacyRoot = path.join(storage, 'legacy');
    const legacyRelative = 'KnowledgeDatabase/PaperKnowledge/old-paper/paper.md';
    await fs.mkdir(path.dirname(path.join(legacyRoot, legacyRelative)), { recursive: true });
    await fs.writeFile(path.join(legacyRoot, legacyRelative), '# Legacy paper\n\nOriginal evidence.');
    const legacyDb = new SQL.Database();legacyDb.run(SCHEMA);
    legacyDb.run('INSERT INTO papers(id,title,wiki_path) VALUES(?,?,?)', ['old-paper', 'Legacy paper', legacyRelative]);
    await fs.writeFile(path.join(legacyRoot, 'KnowledgeDatabase/knowledge.index.sqlite'), legacyDb.export());legacyDb.close();
    assert.equal((await loadLocalPaperReference({ storagePath: legacyRoot, paperId: 'old-paper' }))?.markdown_relative_path,
      legacyRelative, 'Legacy knowledge storage remains readable');

    const delegated = [];
    const runtime = createPaperAnalysisRuntime({
      requestStructuredJsonPayload: async () => { throw Error('Saved references must use the evidence reader'); },
      subAgentRuntime: { createSubAgent: () => {} },
      runCodexPaperContextSubAgent: async input => {
        delegated.push(input);
        const target = input.downloadedPapers[0];
        const lines = (await fs.readFile(target.knowledge_markdown_path, 'utf8')).split('\n');
        return { ok: true, selected_papers: input.selectedPapers, papers_read_count: 1, loaded_context_blocks: [{
          paper_id: target.paper_id, source_path: target.knowledge_markdown_relative_path,
          source_lines: [{ line_number: 3, content: lines[2] }], relevance_reason: 'Addresses the comparison.'
        }] };
      }
    });
    for (const [index, spec] of specs.slice(0, 3).entries()) {
      const result = await runtime.analyzePaper({ storage_path: storage,
        paper: index === 1 ? { paper_id: spec.slug } : { id: spec.slug, title: spec.title.replace('–', '-') },
        query: 'Compare recognition, cutting and release.' });
      assert.equal(result.ok, true);
      assert.equal(result.loaded_context_blocks[0].paper_id, spec.id);
      assert.equal(result.loaded_context_blocks[0].source_lines[0].content, `Physical evidence for paper ${index}.`);
    }
    assert.equal(delegated.length, 3);
    assert.ok(delegated.every(input => input.query === 'Compare recognition, cutting and release.'));

    let schemaChecked = false;
    const generic = createPaperAnalysisRuntime({ requestStructuredJsonPayload: async input => {
      checkStrictSchema(input.schema); schemaChecked = true;
      assert.match(input.userPrompt, /Compare the supplied text/);
      return { ok: true, payload: { brief_summary: 'A supported finding.', key_findings: [], method_overview: null,
        protocol_candidate: { title: 'Procedure', purpose: '', method_text: '', materials: [],
          steps: [{ id: null, text: 'Measure the signal.' }], notes: null }, result_summary: 'Complete.' } };
    } });
    const genericResult = await generic.analyzePaper({ paper_text: 'Supplied paper methods.', query: 'Compare the supplied text.', extract_protocol: true });
    assert.equal(schemaChecked, true);
    assert.equal(genericResult.ok, true);
    assert.equal(genericResult.protocol_extraction.steps[0].text, 'Measure the signal.');
    console.log('Paper analysis references passed: search IDs, canonical IDs, DOI, title punctuation, Unicode, renamed Markdown, ambiguous/missing refs, intake-only lookup, three-paper delegation and strict fallback schema.');
  } finally {
    await fs.rm(storage, { recursive: true, force: true });
  }
}

main().then(() => {
  if (process.versions.electron) require('electron').app.exit(0);
}).catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
