#!/usr/bin/env node
// Self-check for paper identity normalization + knowledge-database dedup by
// DOI / PMID / PMCID, including the ALTER TABLE migration that adds the pmid /
// pmcid columns to a pre-existing schema.
// Run: node tests/paper-dedup-identity-selfcheck.js
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  buildPaperIdentity,
  identitiesMatch
} = require(path.join(root, 'src/main/papers/identity/paper-identity.js'));
const {
  openKnowledgeDatabase,
  migratePaperColumns,
  findExistingPaperRow,
  queryRows,
  runStatement
} = require(path.join(root, 'src/main/papers/store/agent-paper-knowledge-database.js'));
const {
  createLiteratureSearchRuntime
} = require(path.join(root, 'src/main/papers/search/agent-literature-search.js'));
const {
  normalizeToolArgumentsPayload
} = require(path.join(root, 'src/main/helpers/agent/tools/agent-tool-loading.js'));
const {
  createAgentRuntimeSupport
} = require(path.join(root, 'src/main/helpers/agent/runtime/agent-runtime-support.js'));
const {
  splitMarkdownIntoSections,
  createPaperContextLoaderRuntime
} = require(path.join(root, 'src/main/papers/retrieve/agent-paper-context-loader.js'));
const {
  createPaperContextSelection
} = require(path.join(root, 'src/main/papers/retrieve/paper-context-selection.js'));
const {
  normalizePreferredJournal,
  normalizePreferredJournals,
  normalizePaperDoi,
  buildCandidateKey,
  scorePaperCandidate,
  selectPaperCandidates
} = require(path.join(root, 'src/main/papers/search/literature-candidates.js'));
const {
  normalizeLineRanges,
  readLineRangesFromText,
  inferMarkdownSectionLabel
} = require(path.join(root, 'src/main/papers/workflow/paper-line-ranges.js'));
const {
  parseJsonObjectFromText,
  normalizeSelectedPaper,
  normalizeCodexPaperLinePayload
} = require(path.join(root, 'src/main/papers/workflow/codex-payload.js'));
const {
  runCodexPaperContextSubAgent
} = require(path.join(root, 'src/main/papers/workflow/codex-paper-context-workflow.js'));
const {
  createPaperContextText
} = require(path.join(root, 'src/main/papers/retrieve/paper-context-text.js'));
const {
  buildMcpToolResponseContent
} = require(path.join(root, 'src/main/helpers/agent/mcp-contract/stdio-server.js'));
const {
  tokenize: wikiTokenize,
  scoreRow: wikiScoreRow,
  buildSnippet: wikiBuildSnippet,
  buildPageCitation: wikiBuildPageCitation
} = require(path.join(root, 'src/main/papers/retrieve/wiki-search-scoring.js'));

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

  // --- loadPaperContexts orchestration parity (guards the LLM-orchestration
  //     extraction: same inputs must yield the same emitted context blocks) ---
  const pickFirstBlockLlm = async ({ userPrompt }) => {
    const m = String(userPrompt).match(/Block ID: (\S+)/);
    return { ok: true, payload: { selected_blocks: m ? [{ block_id: m[1], relevance_reason: 'fake reason' }] : [], figure_review_requests: [] } };
  };
  const orchRt = createPaperContextLoaderRuntime({ cleanText, asArray, uniqueStrings, requestStructuredJsonPayload: pickFirstBlockLlm });
  const orch = await orchRt.loadPaperContexts({
    query: 'kinase inhibitor resistance',
    items: [
      { paper_id: 'p1', title: 'Paper One', summary: 'A study of kinase inhibitor resistance mechanisms in tumor cells.' },
      { paper_id: 'p2', title: 'Paper Two', summary: 'Unrelated work on plant photosynthesis pathways.' }
    ]
  });
  assert.equal(orch.papers_read_count, 2, 'both papers read');
  assert.equal(orch.loaded_context_blocks.length, 1, 'one block selected (non-PDF path)');
  assert.equal(orch.loaded_context_blocks[0].paper_id, 'p1');
  assert.equal(orch.loaded_context_blocks[0].source, 'search_result_summary');
  assert.equal(orch.loaded_context_blocks[0].relevance_reason, 'fake reason');

  // PDF-text selection path
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-parity-'));
  const pdfPath = path.join(pdfDir, 'p1.pdf');
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4 fake', 'utf8'));
  const pdfTextExtractionRuntime = {
    async extractText() {
      return { ok: true, text: 'Results: the drug worked.', sections: [{ label: 'Results', normalized_label: 'results', text: 'The drug worked in 9/10 mice.' }], page_count: 3 };
    }
  };
  const pdfTextLlm = async ({ stage }) => (stage === 'paper_context_selection_pdf_text'
    ? { ok: true, payload: { excerpts: [{ section_label: 'Results', excerpt: 'The drug worked in 9/10 mice.', relevance_reason: 'direct result' }], request_pdf_review: false, pdf_review_reason: '' } }
    : { ok: true, payload: { selected_blocks: [], figure_review_requests: [] } });
  const pdfRt = createPaperContextLoaderRuntime({ cleanText, asArray, uniqueStrings, requestStructuredJsonPayload: pdfTextLlm, pdfTextExtractionRuntime });
  const pdfOut = await pdfRt.loadPaperContexts({
    query: 'did the drug work',
    items: [{ paper_id: 'p1', title: 'Paper One', summary: 'A drug study.' }],
    downloaded_papers: [{ ok: true, paper_id: 'p1', file_path: pdfPath }]
  });
  fs.rmSync(pdfDir, { recursive: true, force: true });
  assert.equal(pdfOut.loaded_context_blocks.length, 1, 'one PDF-text block');
  assert.equal(pdfOut.loaded_context_blocks[0].source, 'llm_pdf_text_read', 'PDF-text selection path exercised');
  assert.equal(pdfOut.loaded_context_blocks[0].section_label, 'Results');

  // PDF-binary excerpt path + figure-review path (no pdfTextExtractionRuntime,
  // so the attached-PDF branch runs; a figure-oriented query triggers review)
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-parity-bin-'));
  const binPdf = path.join(binDir, 'p1.pdf');
  fs.writeFileSync(binPdf, Buffer.from('%PDF-1.4 fake', 'utf8'));
  const binFigLlm = async ({ stage }) => {
    if (stage === 'paper_context_selection_pdf') {
      return { ok: true, payload: { excerpts: [{ section_label: 'Figure 2', excerpt: 'The blot shows a clear band.', relevance_reason: 'binary pdf' }] } };
    }
    if (stage === 'paper_figure_review') {
      return { ok: true, payload: { useful: true, figure_summary: 'Figure 2 shows a strong band at 55 kDa.', relevance_reason: 'figure evidence' } };
    }
    return { ok: true, payload: { selected_blocks: [], figure_review_requests: [] } };
  };
  const binRt = createPaperContextLoaderRuntime({ cleanText, asArray, uniqueStrings, requestStructuredJsonPayload: binFigLlm });
  const binOut = await binRt.loadPaperContexts({
    query: 'what does the western blot figure show',
    items: [{ paper_id: 'p1', title: 'Paper One', summary: 'A blot study.', pdf_urls: ['https://example.org/p1.pdf'] }],
    downloaded_papers: [{ ok: true, paper_id: 'p1', file_path: binPdf }]
  });
  fs.rmSync(binDir, { recursive: true, force: true });
  const binSources = binOut.loaded_context_blocks.map((b) => b.source);
  assert.ok(binSources.includes('llm_pdf_read'), 'PDF-binary excerpt path exercised');
  assert.ok(binSources.includes('figure_review'), 'figure-review path exercised');
  const figBlock = binOut.loaded_context_blocks.find((b) => b.source === 'figure_review');
  assert.equal(figBlock.evidence_kind, 'figure_review');
  assert.equal(figBlock.section_label, 'Figures');

  // --- literature candidate ranking/dedup (extracted module) -----------------
  assert.deepEqual(normalizePreferredJournal('Nature'), { url: '', name: 'nature' }, 'plain name -> soft name');
  assert.ok(normalizePreferredJournal('https://www.nature.com').url, 'URL preference -> url');
  assert.deepEqual(
    normalizePreferredJournals(['Nature; Cell', 'Nature']).map((item) => item.name || item.url),
    ['nature', 'cell'],
    'preferred journal list splits and dedupes values'
  );

  const relevant = scorePaperCandidate({ title: 'kinase inhibitor resistance', source: 'pubmed' }, 'kinase inhibitor resistance');
  const irrelevant = scorePaperCandidate({ title: 'plant photosynthesis', source: 'web' }, 'kinase inhibitor resistance');
  assert.ok(relevant > irrelevant, 'query-matching pubmed candidate outranks unrelated web one');
  const withJournal = scorePaperCandidate({ title: 'kinase study', journal: 'Nature' }, 'kinase', normalizePreferredJournal('Nature'));
  const noJournal = scorePaperCandidate({ title: 'kinase study', journal: 'Other J' }, 'kinase', normalizePreferredJournal('Nature'));
  assert.ok(withJournal > noJournal, 'preferred-journal bonus applied');
  const withSecondJournal = scorePaperCandidate(
    { title: 'kinase study', journal: 'Cell' },
    'kinase',
    normalizePreferredJournals(['Nature', 'Cell'])
  );
  assert.ok(withSecondJournal > noJournal, 'preferred-journal list bonus applied');
  const withSecondJournalFromLegacy = scorePaperCandidate(
    { title: 'kinase study', journal: 'Cell' },
    'kinase',
    'Nature; Cell'
  );
  assert.ok(withSecondJournalFromLegacy > noJournal, 'legacy preferred-journal string can match any listed journal');

  const picked = selectPaperCandidates([
    { title: 'kinase A', doi: '10.1/a', source: 'pubmed' },
    { title: 'kinase A dup', doi: '10.1/a', source: 'crossref' },
    { title: 'unrelated', doi: '10.1/b', source: 'web' }
  ], 'kinase', 5);
  assert.equal(picked.length, 2, 'deduped by DOI (2 distinct)');
  assert.equal(picked[0].doi, '10.1/a', 'top-ranked is the kinase match');
  assert.ok(!('__score' in picked[0]), 'internal scoring fields stripped');
  assert.equal(
    normalizePaperDoi('https://doi.org/10.1021/acs.jmedchem.5c01681.s001'),
    '10.1021/acs.jmedchem.5c01681',
    'supporting-information DOI resolves to the parent article DOI'
  );
  assert.equal(
    buildCandidateKey({ doi: '10.1021/acs.jmedchem.5c01681.s001' }),
    buildCandidateKey({ doi: '10.1021/acs.jmedchem.5c01681.s002' }),
    'supporting-information DOI variants share one search candidate key'
  );
  const supplementaryDeduped = selectPaperCandidates([
    { title: 'Molecular glue degrader article', doi: '10.1021/acs.jmedchem.5c01681.s001', source: 'crossref' },
    { title: 'Molecular glue degrader article supplemental file', doi: '10.1021/acs.jmedchem.5c01681.s002', source: 'crossref' },
    { title: 'A separate molecular glue degrader article', doi: '10.1021/jacs.5c09857', source: 'crossref' }
  ], 'molecular glue degrader', 0);
  assert.equal(supplementaryDeduped.length, 2, 'supporting-information results dedupe to one parent article');
  assert.equal(supplementaryDeduped[0].doi, '10.1021/acs.jmedchem.5c01681', 'selected paper exposes the parent DOI');

  const runtimeSupport = createAgentRuntimeSupport({});
  const normalizedSnapshot = runtimeSupport.normalizeAgentSnapshot({
    settings: {
      preferredJournals: ['Science; Cell'],
      preferredJournal: 'Nature Biotechnology\ncell'
    }
  });
  assert.deepEqual(
    normalizedSnapshot.settings.preferredJournals,
    ['Science', 'Cell', 'Nature Biotechnology'],
    'agent runtime snapshot normalizes preferred journal lists'
  );
  assert.equal(
    normalizedSnapshot.settings.preferredJournal,
    'Science; Cell; Nature Biotechnology',
    'agent runtime keeps legacy preferredJournal compatibility string'
  );

  // --- codex line-range hydration (extracted module) -------------------------
  // adjacent/overlapping ranges merge; string "3-4, 6" parses; source lines stay exact
  assert.deepEqual(
    normalizeLineRanges([{ start_line: 3, end_line: 4 }, { start_line: 5, end_line: 5 }]),
    [{ start_line: 3, end_line: 5 }],
    'adjacent ranges merge'
  );
  assert.deepEqual(normalizeLineRanges('3-4, 6'), [{ start_line: 3, end_line: 4 }, { start_line: 6, end_line: 6 }], 'string ranges parse');

  const codexMd = '# Title\nintro line\n## Methods\nwe ran a blot\nand a gel\n## Results\nit worked';
  const hydrated = readLineRangesFromText(codexMd, [{ start_line: 4, end_line: 5 }]);
  assert.equal(hydrated.parts.length, 1);
  assert.equal(hydrated.parts[0].text, 'we ran a blot\nand a gel', 'verbatim lines pulled by 1-based range');
  assert.deepEqual(hydrated.source_lines, [
    { line_number: 4, content: 'we ran a blot' },
    { line_number: 5, content: 'and a gel' }
  ], 'application maps selected line numbers to exact Markdown content');
  assert.equal(
    inferMarkdownSectionLabel(codexMd.split('\n'), 4, 'fallback'),
    'Methods',
    'section label inferred from nearest heading above'
  );
  const rejected = readLineRangesFromText('only one line', [{ start_line: 5, end_line: 9 }]);
  assert.deepEqual(rejected.parts, [], 'a sub-agent range starting beyond EOF is not remapped to another line');
  assert.equal(rejected.rejected_ranges[0].reason, 'start_line_out_of_range');
  const shortened = readLineRangesFromText('first\nsecond', [{ start_line: 2, end_line: 9 }]);
  assert.deepEqual(shortened.source_lines, [{ line_number: 2, content: 'second' }], 'a valid range end is shortened at EOF');

  const modelPaperPayload = JSON.parse(buildMcpToolResponseContent('literature_search', {
    ok: true,
    output: {
      status: 'completed',
      loaded_context_blocks: [{
        paper_id: 'paper-1',
        paper_title: 'A paper',
        excerpt: 'we ran a blot\nand a gel',
        line_ranges: [{ start_line: 4, end_line: 5 }],
        source_lines: hydrated.source_lines,
        source_line_count: 7,
        source_path: 'KnowledgeBase/papers.md/paper-1/paper.md',
        related_comments: [{
          id: 'comment-1',
          text: 'Check this result.',
          author: 'Local user',
          highlight_text: 'and a gel',
          relation: 'highlight_overlap'
        }]
      }]
    }
  }));
  assert.deepEqual(modelPaperPayload.loaded_context_blocks[0].source_lines, hydrated.source_lines, 'MCP model payload preserves exact numbered source lines');
  assert.equal(modelPaperPayload.loaded_context_blocks[0].line_ranges[0].start_line, 4, 'MCP model payload preserves selected ranges');
  assert.equal(modelPaperPayload.loaded_context_blocks[0].related_comments[0].text, 'Check this result.', 'MCP model payload preserves local comments');

  const lineWorkflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-paper-lines-'));
  try {
    const markdownPath = path.join(lineWorkflowRoot, 'paper.md');
    fs.writeFileSync(markdownPath, codexMd, 'utf8');
    let delegatedMessage = '';
    const assistantMessage = JSON.stringify({
      ok: true,
      status: 'completed',
      selected_line_ranges: [{
        line_ranges: [{ start_line: 4, end_line: 5 }],
        relevance_reason: 'Relevant method.',
        excerpt: 'FABRICATED SUB-AGENT TEXT'
      }],
      notes: [],
      summary: 'Selected one range.'
    });
    const agent = {
      id: 'paper-line-test-agent',
      name: 'paper-reader',
      status: 'active',
      messages: [],
      last_response: { assistant_message: assistantMessage },
      metadata: {}
    };
    const workflowResult = await runCodexPaperContextSubAgent({
      query: 'blot method',
      message: 'Find the experimental method.',
      selectedPapers: [{ paper_id: 'paper-1', paper_title: 'A paper', doi: '10.1/test' }],
      downloadedPapers: [{
        paper_id: 'paper-1',
        ok: true,
        status: 'reused',
        knowledge_markdown_path: markdownPath,
        knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/paper-1/paper.md'
      }],
      snapshot: {
        papers: [{
          id: 'paper-1',
          title: 'A paper',
          doi: '10.1/test',
          highlights: [{ id: 'highlight-1', pageNumber: 1, text: 'we ran a blot' }],
          comments: [{
            id: 'comment-1',
            text: 'Verify the blot conditions.',
            author: 'Local user',
            highlightId: 'highlight-1'
          }]
        }]
      },
      subAgentRuntime: {
        createSubAgent: async (input = {}) => {
          delegatedMessage = input.message;
          return { ok: true, status: 'created', agent };
        },
        getSubAgent: () => ({ ok: true, agent }),
        completeSubAgentTask: () => ({ ok: true })
      }
    });
    const workflowBlock = workflowResult.loaded_context_blocks[0];
    assert.equal(delegatedMessage.includes('nl -ba'), true, 'sub-agent is told to use physical line numbers');
    assert.deepEqual(workflowBlock.source_lines, hydrated.source_lines, 'workflow hydrates only application-read Markdown lines');
    assert.equal(JSON.stringify(workflowBlock).includes('FABRICATED SUB-AGENT TEXT'), false, 'sub-agent-authored excerpt text is ignored');
    assert.equal(workflowBlock.related_comments[0].relation, 'highlight_overlap', 'matching local comment is attached to extracted lines');
  } finally {
    fs.rmSync(lineWorkflowRoot, { recursive: true, force: true });
  }

  // --- wiki-search scoring (extracted module) --------------------------------
  assert.deepEqual(wikiTokenize('The KINASE inhibitor'), ['kinase', 'inhibitor'], 'tokenize lowercases + drops stopwords');
  const hitRow = { body_lower: 'a kinase inhibitor study of kinase', section_heading: 'Results', char_length: 40 };
  const missRow = { body_lower: 'plant photosynthesis', section_heading: 'Intro', char_length: 40 };
  const terms = wikiTokenize('kinase inhibitor');
  assert.ok(wikiScoreRow(hitRow, terms, 'kinase inhibitor') > wikiScoreRow(missRow, terms, 'kinase inhibitor'), 'matching row outscores non-matching');
  assert.equal(wikiScoreRow(missRow, terms, 'kinase inhibitor'), 0, 'no term hit -> zero score');
  // heading hit is boosted vs a plain body hit of equal raw count
  const headingRow = { body_lower: 'x', section_heading: 'kinase', char_length: 10 };
  const bodyRow = { body_lower: 'kinase', section_heading: 'x', char_length: 10 };
  assert.ok(wikiScoreRow(headingRow, ['kinase'], '') > wikiScoreRow(bodyRow, ['kinase'], ''), 'heading match boosted');

  const snippet = wikiBuildSnippet('lorem ipsum kinase inhibitor dolor sit amet', ['kinase'], '');
  assert.ok(snippet.includes('kinase'), 'snippet centers on the matched term');
  assert.equal(wikiBuildPageCitation({ page_start: 4, page_end: 5 }), 'pp. 4-5');
  assert.equal(wikiBuildPageCitation({ page_start: 7, page_end: 7 }), 'p. 7');
  assert.equal(wikiBuildPageCitation({}), '', 'no pages -> empty citation');

  // --- codex payload parsing/normalization (extracted module) ----------------
  assert.deepEqual(parseJsonObjectFromText('```json\n{"a":1}\n```'), { a: 1 }, 'JSON extracted from a code fence');
  assert.deepEqual(parseJsonObjectFromText('prose before {"b":2} prose after'), { b: 2 }, 'JSON extracted from surrounding prose');
  assert.equal(parseJsonObjectFromText('no json here'), null, 'no JSON -> null');
  assert.equal(parseJsonObjectFromText('[1,2,3]'), null, 'top-level array -> null (object expected)');

  const linePayload = normalizeCodexPaperLinePayload({
    selected_line_ranges: [{ line_ranges: '4-5', section_label: 'Methods', reason: 'r' }],
    notes: ['ok']
  }, {});
  assert.equal(linePayload.ok, true);
  assert.equal(linePayload.selected_line_ranges.length, 1);
  assert.deepEqual(linePayload.selected_line_ranges[0].line_ranges, [{ start_line: 4, end_line: 5 }], 'line ranges normalized');
  assert.equal(normalizeCodexPaperLinePayload({ ok: false, error: 'boom' }, {}).ok, false, 'ok:false honored');

  const paper = normalizeSelectedPaper({ paperId: 'p1', title: 'T', score: '3' }, { doi: '10.1/x' });
  assert.equal(paper.paper_id, 'p1');
  assert.equal(paper.doi, '10.1/x', 'fallback fields merged');
  assert.equal(paper.score, 3, 'numeric score coerced');

  console.log('PASS paper-dedup-identity-selfcheck');
}

main().catch((error) => {
  console.error('FAIL paper-dedup-identity-selfcheck');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
