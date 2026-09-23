'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createPaperDownloadRuntime } = require('../src/main/papers/download/agent-paper-download.js');
const { createLiteratureResearchSession, closeLiteratureResearchSession, recordLiteratureResearchDownload } = require('../src/main/papers/workflow/literature-research-session.js');

function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-download-reconcile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = { storage_path: root, linked_name: 'Test project', linked_type: 'project',
    paper_title: 'Shared paper title', doi: '10.1000/test', candidate_urls: ['https://example.org/paper.pdf'] };
  let fetchCount = 0;
  const fetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200, headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => Buffer.from('%PDF-1.7\nSaved test paper\n%%EOF') };
  };
  return { root, input, fetch, count: () => fetchCount };
}

test('a short wait returns ready Markdown while intake continues; retries join the same job', async (t) => {
  const f = await fixture(t);
  const entered = gate();
  const intake = gate();
  let indexedPaper;
  let ingestCount = 0;
  const runtime = createPaperDownloadRuntime({ fetch: f.fetch, paperKnowledgeDatabaseRuntime: {
    lookupPaper: async () => ({ ok: Boolean(indexedPaper), paper: indexedPaper }),
    ingestPaperPdf: async (input) => {
      ingestCount += 1;
      const markdown = path.join(f.root, 'paper.md');
      await fs.writeFile(markdown, '# Methods\nVerified evidence\n');
      indexedPaper = { id: 'paper-one', doi: f.input.doi, pdf_file_path: input.file_path,
        wiki_status: 'ready', wiki_exists: true, wiki_file_path: markdown, wiki_path: 'paper.md' };
      entered.resolve();
      await intake.promise;
      return { ok: true, markdown_path: markdown, markdown_relative_path: 'paper.md' };
    }
  } });
  const started = await runtime.startDownload(f.input);
  try {
    await entered.promise;
    const pending = await runtime.waitForDownload({ download_id: started.download_id, wait_timeout_ms: 1 });
    assert.equal(pending.ok, true);
    assert.equal(pending.status, 'running');
    assert.equal(pending.download_status, 'completed');
    assert.equal(pending.in_progress, true);
    assert.equal(pending.knowledge_status, 'ready');
    assert.equal(pending.knowledge_markdown_path, indexedPaper.wiki_file_path);
    const retry = await runtime.downloadPaper({ ...f.input, doi: 'https://doi.org/10.1000/TEST',
      candidate_urls: ['https://mirror.example.org/copy.pdf'], wait_timeout_ms: 1 });
    assert.equal(retry.download_id, started.download_id);
    assert.equal(retry.reused, true);
    assert.equal(f.count(), 1);
    assert.equal(ingestCount, 1);
    const session = createLiteratureResearchSession({});
    try {
      const snapshot = { literature_research: { id: session.id } };
      recordLiteratureResearchDownload(snapshot, f.input, { ...pending, knowledge_markdown_path: '' });
      recordLiteratureResearchDownload(snapshot, f.input, pending);
      assert.equal(session.downloads.length, 1);
      assert.equal(session.downloads[0].knowledge_markdown_path, indexedPaper.wiki_file_path);
    } finally { closeLiteratureResearchSession(session); }
  } finally {
    intake.resolve();
    const completed = await runtime.waitForDownload({ download_id: started.download_id });
    assert.equal(completed.in_progress, false);
    assert.equal(completed.status, 'completed');
  }
});

test('concurrent mirror requests share a transfer, including before the PDF exists', async (t) => {
  const f = await fixture(t);
  const transfer = gate();
  const entered = gate();
  const runtime = createPaperDownloadRuntime({ fetch: async () => {
    entered.resolve();
    await transfer.promise;
    return f.fetch();
  } });
  const [first, second] = await Promise.all([runtime.startDownload(f.input),
    runtime.startDownload({ ...f.input, candidate_urls: ['https://mirror.example.org/other.pdf'] })]);
  try {
    assert.equal(first.download_id, second.download_id);
    await entered.promise;
    const pending = await runtime.downloadPaper({ ...f.input, wait_timeout_ms: 0 });
    assert.equal(pending.status, 'running');
    assert.equal(pending.knowledge_markdown_path, undefined);
  } finally {
    transfer.resolve();
    await runtime.waitForDownload(first);
  }
  assert.equal(f.count(), 1);
});

test('a new runtime reuses a durable saved-PDF receipt and can finish missing knowledge', async (t) => {
  const f = await fixture(t);
  const first = await createPaperDownloadRuntime({ fetch: f.fetch }).downloadPaper(f.input);
  let ingested;
  const second = await createPaperDownloadRuntime({ fetch: f.fetch, paperKnowledgeDatabaseRuntime: {
    ingestPaperPdf: async (input) => { ingested = input.file_path; return { ok: true }; }
  } }).downloadPaper({ ...f.input, paper_title: 'A new filename', candidate_urls: [] });
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.file_path, first.file_path);
  assert.equal(ingested, first.file_path);
  assert.equal(f.count(), 1);
});

test('indexed PDFs saved before receipts existed are reused without another intake', async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, 'Project', 'Test_project', 'Papers');
  await fs.mkdir(folder, { recursive: true });
  const pdf = path.join(folder, 'older.pdf');
  const markdown = path.join(f.root, 'older.md');
  await fs.writeFile(pdf, '%PDF-1.7\nOlder paper');
  await fs.writeFile(markdown, '# Earlier extraction');
  const result = await createPaperDownloadRuntime({ fetch: f.fetch, paperKnowledgeDatabaseRuntime: {
    lookupPaper: async () => ({ ok: true, paper: { id: 'old', doi: f.input.doi, pdf_file_path: pdf,
      wiki_status: 'ready', wiki_exists: true, wiki_file_path: markdown, wiki_path: 'older.md' } }),
    ingestPaperPdf: async () => assert.fail('Existing Markdown does not need intake again')
  } }).downloadPaper(f.input);
  assert.equal(result.reused, true);
  assert.equal(result.knowledge_markdown_path, markdown);
  assert.equal(f.count(), 0);
});

for (const changed of ['deleted', 'not a PDF']) {
  test(`a ${changed} saved file does not suppress a needed download`, async (t) => {
    const f = await fixture(t);
    const first = await createPaperDownloadRuntime({ fetch: f.fetch }).downloadPaper(f.input);
    if (changed === 'deleted') await fs.unlink(first.file_path);
    else await fs.writeFile(first.file_path, '<html>blocked</html>');
    const second = await createPaperDownloadRuntime({ fetch: f.fetch }).downloadPaper(f.input);
    assert.equal(second.ok, true);
    assert.equal(second.reused, undefined);
    assert.equal(f.count(), 2);
    assert.match(await fs.readFile(second.file_path, 'utf8'), /^%PDF-/);
  });
}

test('different DOIs with the same title remain separate and never overwrite each other', async (t) => {
  const f = await fixture(t);
  const runtime = createPaperDownloadRuntime({ fetch: f.fetch });
  const [first, second] = await Promise.all([runtime.downloadPaper(f.input),
    runtime.downloadPaper({ ...f.input, doi: '10.1000/different' })]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.file_path, second.file_path);
  assert.equal(f.count(), 2);
  const third = await createPaperDownloadRuntime({ fetch: f.fetch, paperKnowledgeDatabaseRuntime: {
    lookupPaper: async () => ({ ok: true, paper: { doi: f.input.doi, pdf_file_path: first.file_path } })
  } }).downloadPaper({ ...f.input, doi: '10.1000/third' });
  assert.equal(third.reused, undefined);
  assert.equal(f.count(), 3);
});

test('another project does not reuse a PDF from the wrong folder', async (t) => {
  const f = await fixture(t);
  const first = await createPaperDownloadRuntime({ fetch: f.fetch }).downloadPaper(f.input);
  const second = await createPaperDownloadRuntime({ fetch: f.fetch, paperKnowledgeDatabaseRuntime: {
    lookupPaper: async () => ({ ok: true, paper: { doi: f.input.doi, pdf_file_path: first.file_path } })
  } }).downloadPaper({ ...f.input, linked_name: 'Other project' });
  assert.equal(second.ok, true);
  assert.notEqual(first.file_path, second.file_path);
  assert.match(second.file_path, /Other_project/);
  assert.equal(f.count(), 2);
});

test('failed jobs release their identity so a later request can retry', async (t) => {
  const f = await fixture(t);
  let fail = true;
  const runtime = createPaperDownloadRuntime({ fetch: async () => {
    if (fail) throw new Error('Network unavailable');
    return f.fetch();
  } });
  const first = await runtime.downloadPaper(f.input);
  assert.equal(first.status, 'failed');
  assert.equal(first.in_progress, false);
  fail = false;
  const second = await runtime.downloadPaper(f.input);
  assert.equal(second.ok, true);
  assert.notEqual(first.download_id, second.download_id);
  assert.equal(f.count(), 1);
});

test('target-folder errors settle the job instead of leaving an active download', async (t) => {
  const f = await fixture(t);
  const runtime = createPaperDownloadRuntime({ fetch: f.fetch });
  await fs.writeFile(path.join(f.root, 'Project'), 'not a directory');
  const result = await runtime.downloadPaper(f.input);
  assert.equal(result.status, 'failed');
  assert.equal(result.in_progress, false);
  assert.equal(f.count(), 0);
});
