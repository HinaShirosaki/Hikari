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
  splitMarkdownIntoSections
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-paper-context-loader.js'));

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

  console.log('PASS paper-dedup-identity-selfcheck');
}

main().catch((error) => {
  console.error('FAIL paper-dedup-identity-selfcheck');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
