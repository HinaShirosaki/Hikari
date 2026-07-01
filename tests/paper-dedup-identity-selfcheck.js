#!/usr/bin/env node
// Self-check for paper identity normalization + knowledge-database dedup by
// DOI / PMID / PMCID, including the ALTER TABLE migration that adds the pmid /
// pmcid columns to a pre-existing schema.
// Run: node tests/paper-dedup-identity-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  buildPaperIdentity,
  identitiesMatch
} = require(path.join(root, 'src/main/helpers/agent/shared/paper-identity.js'));
const {
  openKnowledgeDatabase,
  migratePaperColumns,
  findExistingPaperRow,
  queryRows,
  runStatement
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-paper-knowledge-database.js'));
const {
  createLiteratureSearchRuntime
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-literature-search.js'));
const {
  normalizeToolArgumentsPayload
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-tool-loading.js'));
const {
  splitMarkdownIntoSections
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-paper-context-loader.js'));
const {
  createPaperContextSelection
} = require(path.join(root, 'src/main/helpers/agent/tools/paper-context-selection.js'));
const {
  createPaperContextText
} = require(path.join(root, 'src/main/helpers/agent/tools/paper-context-text.js'));

// Mock fetch that records requested URLs and returns one Europe PMC record,
// optionally empty when the URL carries a given journal clause (to exercise the
// unfiltered fallback).
function makeEuropePmcFetch({ emptyWhenIncludes = null } = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    const decoded = decodeURIComponent(String(url));
    const empty = emptyWhenIncludes && decoded.includes(emptyWhenIncludes);
    const result = empty
      ? []
      : [{ id: '1', title: 'A kinase paper', journalTitle: 'Nature', pubYear: '2020', doi: '10.1/x' }];
    return { ok: true, status: 200, json: async () => ({ resultList: { result } }) };
  };
  return { fetch, urls };
}

async function main() {
  // --- identity normalization ------------------------------------------------
  assert.equal(normalizeDoi('https://doi.org/10.1/AbC'), '10.1/abc');
  assert.equal(normalizeDoi('doi: 10.1/x'), '10.1/x');
  assert.equal(normalizePmid('PMID: 12345678'), '12345678');
  assert.equal(normalizePmid('pmid31000000'), '31000000');
  assert.equal(normalizePmid('not a pmid'), '');
  assert.equal(normalizePmcid('PMC0001234'), 'PMC1234');
  assert.equal(normalizePmcid('1234567'), 'PMC1234567');

  // strong ids win; mismatched DOIs are never merged even with equal titles
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'A' }), buildPaperIdentity({ doi: '10.1/x', title: 'B' })),
    true
  );
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'Same' }), buildPaperIdentity({ doi: '10.1/y', title: 'Same' })),
    false
  );
  // pmid match
  assert.equal(
    identitiesMatch(buildPaperIdentity({ pmid: '999' }), buildPaperIdentity({ pmid: 'PMID: 999' })),
    true
  );
  // title only used when neither side has a strong id
  assert.equal(
    identitiesMatch(buildPaperIdentity({ title: 'Hello World!' }), buildPaperIdentity({ title: 'hello   world' })),
    true
  );
  assert.equal(
    identitiesMatch(buildPaperIdentity({ doi: '10.1/x', title: 'T' }), buildPaperIdentity({ title: 'T' })),
    false
  );

  // --- fresh DB has the new columns and dedups by pmid / pmcid ----------------
  const db = await openKnowledgeDatabase('/nonexistent/knowledge.index.sqlite');
  const cols = new Set(queryRows(db, 'PRAGMA table_info(papers)').map((row) => String(row.name)));
  assert.ok(cols.has('pmid') && cols.has('pmcid'), 'fresh schema must include pmid/pmcid');

  runStatement(db, "INSERT INTO papers (id, doi, pmid, pmcid, title) VALUES ('p1', '10.1/a', '12345678', 'PMC1234', 'Paper One')");

  assert.equal(findExistingPaperRow(db, { pmid: 'PMID: 12345678' })?.id, 'p1', 'dedup by pmid');
  assert.equal(findExistingPaperRow(db, { pmcid: 'PMC0001234' })?.id, 'p1', 'dedup by pmcid');
  assert.equal(findExistingPaperRow(db, { doi: '10.1/A' })?.id, 'p1', 'dedup by doi (case-insensitive)');
  assert.equal(findExistingPaperRow(db, { pmid: '0000' }), null, 'no false match');
  db.close();

  // --- migration adds columns to a legacy (pre-pmid) table --------------------
  const legacy = await openKnowledgeDatabase('/nonexistent/legacy.index.sqlite');
  legacy.run('DROP TABLE papers');
  legacy.run('CREATE TABLE papers (id TEXT PRIMARY KEY, doi TEXT, title TEXT)');
  legacy.run("INSERT INTO papers (id, doi, title) VALUES ('old1', '10.9/z', 'Legacy')");
  migratePaperColumns(legacy);
  migratePaperColumns(legacy); // idempotent: second run must not throw
  const legacyCols = new Set(queryRows(legacy, 'PRAGMA table_info(papers)').map((row) => String(row.name)));
  assert.ok(legacyCols.has('pmid') && legacyCols.has('pmcid'), 'migration adds pmid/pmcid');
  runStatement(legacy, "UPDATE papers SET pmid = '555' WHERE id = 'old1'");
  assert.equal(findExistingPaperRow(legacy, { pmid: '555' })?.id, 'old1', 'lookup works after migration');
  legacy.close();

  // --- journal filter is pushed into the provider query ----------------------
  const scoped = makeEuropePmcFetch();
  const runtimeA = createLiteratureSearchRuntime({ fetch: scoped.fetch });
  const resA = await runtimeA.searchLiteratureCandidates({
    query: 'kinase',
    source: 'europe_pmc',
    journals: ['Nature'],
    allow_web_fallback: false
  });
  assert.ok(resA.ok && resA.items.length > 0, 'scoped search returns results');
  assert.deepEqual(resA.journal_filter, ['Nature']);
  assert.equal(resA.journal_filter_relaxed, false);
  assert.ok(
    scoped.urls.some((url) => decodeURIComponent(url).includes('JOURNAL:"Nature"')),
    'Europe PMC query must carry the JOURNAL clause'
  );

  // --- empty filtered result relaxes to an unfiltered search -----------------
  const relaxed = makeEuropePmcFetch({ emptyWhenIncludes: 'JOURNAL:"Obscure Journal"' });
  const runtimeB = createLiteratureSearchRuntime({ fetch: relaxed.fetch });
  const resB = await runtimeB.searchLiteratureCandidates({
    query: 'kinase',
    source: 'europe_pmc',
    journals: ['Obscure Journal'],
    allow_web_fallback: false
  });
  assert.equal(resB.journal_filter_relaxed, true, 'must relax when filter matches nothing');
  assert.ok(resB.items.length > 0, 'unfiltered fallback returns results');
  assert.equal(relaxed.urls.length, 2, 'one filtered call, then one unfiltered retry');

  // --- opt out of relaxation -------------------------------------------------
  const strict = makeEuropePmcFetch({ emptyWhenIncludes: 'JOURNAL:"Obscure Journal"' });
  const runtimeC = createLiteratureSearchRuntime({ fetch: strict.fetch });
  const resC = await runtimeC.searchLiteratureCandidates({
    query: 'kinase',
    source: 'europe_pmc',
    journals: ['Obscure Journal'],
    allow_web_fallback: false,
    allow_unfiltered_fallback: false
  });
  assert.equal(resC.items.length, 0, 'no fallback when opted out');
  assert.equal(resC.journal_filter_relaxed, false);

  // --- reused papers load saved markdown, not abstracts ----------------------
  // splitMarkdownIntoSections is what turns a reused paper.md back into readable
  // sections; figure links must survive so the agent can still find figures.
  const md = [
    '# A Title',
    '**Authors:** X   **Year:** 2020',
    '',
    '## Methods',
    'We did a western blot.',
    '![Figure on page 2](figures/page-2-img-1.png)',
    '',
    '## Key results',
    'It worked.'
  ].join('\n');
  const mdSections = splitMarkdownIntoSections(md);
  const labels = mdSections.map((s) => s.label);
  assert.ok(labels.includes('Methods') && labels.includes('Key results'), 'sections split by heading');
  const methods = mdSections.find((s) => s.label === 'Methods');
  assert.ok(methods.text.includes('figures/page-2-img-1.png'), 'figure links preserved in section text');
  // content under the title heading is retained (authors/year line)
  assert.ok(mdSections.some((s) => s.text.includes('Authors')), 'pre-Methods content retained');
  assert.deepEqual(splitMarkdownIntoSections(''), [], 'empty markdown yields no sections');

  // --- extracted context-text factory still parses correctly -----------------
  const cleanText = (value, max = 4000) => {
    const text = String(value == null ? '' : value).trim();
    return max > 0 ? text.slice(0, max) : text;
  };
  const asArray = (v) => (Array.isArray(v) ? v : []);
  const uniqueStrings = (vals, max = 50) => [...new Set(asArray(vals).filter(Boolean))].slice(0, max);
  const ctx = createPaperContextText({ cleanText, asArray, uniqueStrings });

  const pm = ctx.parsePubMedAbstractSections(
    '<Abstract><AbstractText Label="RESULTS">We saw an effect.</AbstractText></Abstract>'
  );
  assert.equal(pm[0].label, 'RESULTS');
  assert.ok(pm[0].text.includes('effect'), 'PubMed abstract text parsed');

  const meta = ctx.parseEuropePmcMetadata({ pmcid: 'PMC123', abstract: '<p>Hello</p>' });
  assert.equal(meta.pmcid, 'PMC123');
  assert.ok(meta.abstract_sections[0].text.includes('Hello'), 'EPMC abstract stripped of HTML');
  assert.ok(meta.pdf_urls.some((u) => u.includes('PMC123')), 'EPMC pdf url derived from pmcid');

  const chunks = ctx.chunkSectionText('word '.repeat(800), 1500, 200);
  assert.ok(chunks.length > 1, 'long text chunked');
  assert.ok(ctx.scoreTextAgainstQuery('kinase', 'a kinase study', 'Results') > 0, 'scoring matches query token');

  // --- journals survives the tool contract (not stripped by normalization) ---
  const norm = normalizeToolArgumentsPayload(
    { tool_calls: [{ tool_name: 'literature-search', arguments: { query: 'k', journals: ['Nature'], allow_unfiltered_fallback: false } }] },
    { selectedToolNames: ['literature-search'] }
  );
  assert.ok(norm.ok, 'literature-search args normalize');
  assert.deepEqual(norm.payload.tool_calls[0].arguments.journals, ['Nature'], 'journals reaches the runtime');

  // --- journal filter never runs UniProt (no leak, no suppressed retry) ------
  let uniprotCalls = 0;
  const leakRt = createLiteratureSearchRuntime({
    searchUniProtRecords: async () => { uniprotCalls += 1; return [{ title: 'A protein', accession: 'P1' }]; },
    searchEuropePmcRecords: async () => [{ title: 'Journal paper', doi: '10.1/x', journal: 'Nature' }],
    searchPubMedRecords: async () => [],
    searchCrossrefRecords: async () => []
  });
  const leak = await leakRt.searchLiteratureCandidates({
    query: 'kinase protein receptor',
    sources: ['uniprot', 'europe_pmc'],
    journals: ['Nature'],
    allow_web_fallback: false
  });
  assert.equal(leak.journal_filter_relaxed, false, 'journal-capable results present -> no relax');
  assert.equal(uniprotCalls, 0, 'UniProt is not queried under a journal filter (no leak)');
  assert.ok(!leak.sources.includes('uniprot'), 'UniProt excluded from the filtered pass');
  assert.ok(leak.items.length > 0 && leak.items.every((it) => it.source !== 'uniprot'), 'no UniProt items leak through');

  // when journal-capable sources return nothing, the retry runs (incl. UniProt)
  const relaxRt = createLiteratureSearchRuntime({
    searchUniProtRecords: async () => [{ title: 'A protein', accession: 'P1' }],
    searchEuropePmcRecords: async () => [],
    searchPubMedRecords: async () => [],
    searchCrossrefRecords: async () => []
  });
  const relaxed2 = await relaxRt.searchLiteratureCandidates({
    query: 'kinase protein receptor',
    sources: ['uniprot', 'europe_pmc'],
    journals: ['Nature'],
    allow_web_fallback: false
  });
  assert.equal(relaxed2.journal_filter_relaxed, true, 'empty filtered result relaxes');
  assert.ok(relaxed2.sources.includes('uniprot'), 'UniProt runs in the relaxed (unfiltered) pass');

  // --- deterministic selection algebra (extracted factory) -------------------
  const sel = createPaperContextSelection({
    cleanText,
    asArray,
    ensureObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    normalizeRelatedComments: () => [],
    maxBlocks: 3,
    maxBlocksPerPaper: 2,
    maxBlocksPerPaperWithPdf: 4,
    maxFigureReviews: 2
  });
  assert.equal(sel.messageLikelyNeedsFigureReview('see the western blot'), true);
  assert.equal(sel.messageLikelyNeedsFigureReview('summarize the abstract'), false);

  const candidates = [
    { block_id: 'a1', paper_id: 'p1', rank_score: 5, excerpt: 'x' },
    { block_id: 'a2', paper_id: 'p1', rank_score: 4, excerpt: 'x' },
    { block_id: 'a3', paper_id: 'p1', rank_score: 3, excerpt: 'x' }
  ];
  const fb = sel.buildFallbackSelection(candidates, 'topic');
  assert.equal(fb.selected_blocks.length, 2, 'per-paper cap (2) enforced in fallback');
  assert.deepEqual(fb.selected_blocks.map((b) => b.block_id), ['a1', 'a2'], 'sorted by rank_score');

  const normSel = sel.normalizeSelectionResult(
    { selected_blocks: [{ block_id: 'a1', relevance_reason: 'why' }], figure_review_requests: [{ paper_id: 'p1', reason: 'r' }] },
    candidates,
    'topic'
  );
  assert.equal(normSel.selected_blocks[0].excerpt, 'x', 'normalized block hydrated from candidate');
  assert.equal(normSel.figure_review_requests.length, 1, 'figure request kept (paper is in selection)');

  // maxBlocks cap honored across merge
  const merged = sel.mergeSelectedBlocksWithPdf(
    [{ block_id: 'n1', paper_id: 'p2' }, { block_id: 'n2', paper_id: 'p3' }],
    [{ block_id: 'pdf1', paper_id: 'p1' }],
    new Set(['p1'])
  );
  assert.ok(merged.length <= 3, 'merge honors maxBlocks');
  assert.equal(merged[0].block_id, 'pdf1', 'pdf blocks take precedence');

  console.log('PASS paper-dedup-identity-selfcheck');
}

main().catch((error) => {
  console.error('FAIL paper-dedup-identity-selfcheck');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
