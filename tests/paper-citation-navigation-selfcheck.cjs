'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');
const base = path.resolve(__dirname, '../src/renderer/modules/papers');
const { createPaperCitationNavigator } = loadEsmStyleModule(path.join(base, 'citation-navigation.js'), { TextDecoder });
const { citationNeedles, findCitationText } = loadEsmStyleModule(path.join(base, 'pdf-viewer/pdf-viewer-citation-match.js'));
const { prepareAndSwapPageRecords } = loadEsmStyleModule(path.join(base, 'pdf-viewer/pdf-viewer-open-render-swap.js'));

async function checkSupersededRender() {
  const renderCompletions = [];
  const state = { loadToken: 1, openLoadToken: 0, pageRecords: [], pageMetrics: [], pageNumber: 1 };
  const ctx = { state, elements: {}, getDocumentScale: () => 1, getWindowRef: () => null,
    setStageScrollTop() {}, renderDocumentPages: () => new Promise(resolve => renderCompletions.push(resolve)) };
  const older = prepareAndSwapPageRecords(ctx, { pdfDocument: {}, activeLoadToken: 1 });
  state.loadToken = 2;
  const newer = prepareAndSwapPageRecords(ctx, { pdfDocument: {}, activeLoadToken: 2 });
  renderCompletions[1]();
  assert.equal(await newer, true, 'The latest document finishes opening');
  assert.equal(state.openLoadToken, 2);
  renderCompletions[0]();
  assert.equal(await older, false, 'An older render settling late cannot report a successful open');
  assert.equal(state.openLoadToken, 2, 'The latest document remains recognized as open for citation reuse');

  state.loadToken = 3;
  const closing = prepareAndSwapPageRecords(ctx, { pdfDocument: {}, activeLoadToken: 3 });
  state.loadToken = 4; // Closing the viewer invalidates an in-flight open too.
  renderCompletions[2]();
  assert.equal(await closing, false);
  assert.equal(state.openLoadToken, 2, 'A closed viewer cannot be marked open by a late render');
}

async function main() {
  const excerpt = 'A fluorescence assay measured residence times across independent replicates in mammalian cells.';
  const needles = citationNeedles(excerpt);
  assert.ok(findCitationText('A ﬂuorescence assay measured resi-\ndence times across independent replicates in mammalian cells.', needles));
  assert.equal(findCitationText('A fluorescence assay was used in mammalian cells.', needles), null, 'Shared keywords alone do not identify a passage');
  assert.deepEqual(Array.from(citationNeedles('the assay')), [], 'A generic two-word fragment cannot choose a page');
  const long = excerpt + ' The control population had no Cas9 expression and therefore served as the negative baseline.';
  assert.ok(findCitationText(excerpt + ' [different PDF column order]', citationNeedles(long)), 'Long paragraphs can match a substantial consecutive phrase');

  const root = '/work/Lab papers';
  const source = { path: `${root}/KnowledgeBase/papers.md/cas9/paper.md`, excerpt };
  let metadata = { source_pdf_path: 'Papers/Cell assays/cas9.pdf' };
  const reads = [], opens = [], revealed = [];
  let opened = true;
  const navigator = createPaperCitationNavigator({ state: { settings: { storagePath: root } },
    api: { readFileBytes: async file => { reads.push(file); return { ok: true, bytes: new Uint8Array(Buffer.from(JSON.stringify(metadata))) }; } },
    openStoredPaper: async file => { opens.push(file); return opened; },
    paperViewer: { revealCitation: async value => { revealed.push(value); return true; } } });
  assert.deepEqual(JSON.parse(JSON.stringify(await navigator(source))), { ok: true, located: true });
  assert.equal(reads[0], `${root}/KnowledgeBase/papers.md/cas9/meta.json`);
  assert.equal(opens[0].relativePath, 'Papers/Cell assays/cas9.pdf');
  assert.equal(revealed[0], excerpt);
  metadata = { source_pdf_path: `${root}/Projects/Project A/Papers/cas9.pdf` };
  assert.equal((await navigator(source)).ok, true, 'Absolute source metadata inside the current workspace works');
  for (const pdf of ['../../private.pdf', '/other/paper.pdf', 'file:///other/paper.pdf', 'Papers/../other.pdf', 'Papers/not-a-pdf.md']) {
    metadata = { source_pdf_path: pdf };
    assert.equal((await navigator(source)).ok, false, pdf);
  }
  const before = reads.length;
  for (const file of ['/outside/KnowledgeBase/papers.md/cas9/paper.md', `${root}/KnowledgeBase/papers.md/../cas9/paper.md`, `${root}/Notebook/page.md`]) {
    assert.equal((await navigator({ ...source, path: file })).ok, false);
  }
  assert.equal(reads.length, before, 'Invalid sources never trigger a file read');
  metadata = { source_pdf_path: 'Papers/deleted.pdf' }; opened = false;
  assert.equal((await navigator(source)).ok, false);
  assert.equal(revealed.length, 2, 'Missing/failed PDFs never search a previously open document');

  // A library move leaves meta.json at the ingest path; the linked record wins.
  const movedReads = [], movedOpens = [];
  const moved = createPaperCitationNavigator({
    state: { settings: { storagePath: root }, papers: [
      { knowledgeMetaRelativePath: 'KnowledgeBase/papers.md/other/meta.json', storedRelativePath: 'Papers/other.pdf' },
      { knowledgeMetaRelativePath: 'KnowledgeBase\\papers.md\\cas9\\meta.json', storedRelativePath: 'Project/B/Papers/cas9.pdf' }] },
    api: { readFileBytes: async file => { movedReads.push(file); return { ok: false }; } },
    openStoredPaper: async file => { movedOpens.push(file); return true; },
    paperViewer: { revealCitation: async () => true } });
  assert.equal((await moved(source)).located, true);
  assert.equal(movedOpens[0].relativePath, 'Project/B/Papers/cas9.pdf');
  assert.equal(movedReads.length, 0, 'A linked paper does not depend on meta.json');

  // A newer click replacing an older one, at either await, is not a failure.
  const pendingOpens = [], racingRevealed = [];
  const racing = createPaperCitationNavigator({ state: { settings: { storagePath: root } },
    api: { readFileBytes: async () => ({ ok: true, bytes: new Uint8Array(Buffer.from('{"source_pdf_path":"Papers/cas9.pdf"}')) }) },
    openStoredPaper: () => new Promise(resolve => pendingOpens.push(resolve)),
    paperViewer: { revealCitation: async value => { racingRevealed.push(value); return true; } } });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const duringRead = racing(source);
  const duringOpen = racing({ ...source, excerpt: 'older' });
  assert.equal((await duringRead).superseded, true);
  await settle();
  const newest = racing({ ...source, excerpt: 'newest' });
  await settle();
  pendingOpens[0](false); pendingOpens[1](true);
  assert.equal((await duringOpen).superseded, true);
  assert.equal((await newest).located, true);
  assert.equal(racingRevealed.join(), 'newest', 'Only the latest click searches the viewer');
  await checkSupersededRender();
  console.log('Paper citation navigation passed: passage matching, metadata identity, moved papers, replaced clicks, late renders, workspace paths and missing PDFs.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
