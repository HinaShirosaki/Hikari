'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { attachPaperAutoDownload } = require('../src/main/papers/download/paper-download/browser-auto-download.js');
const { createPaperDownloadRuntime } = require('../src/main/papers/download/agent-paper-download.js');
const { createBrowserDownloadSession } = require('../src/main/papers/download/paper-download/browser-session.js');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('automation reserves an action before a navigation rejects and disposes its listeners', async () => {
  const contents = new EventEmitter();
  const actions = [];
  const scripts = [];
  contents.executeJavaScript = async (script) => {
    scripts.push(script);
    if (script.includes('"activateKey"')) {
      assert.equal(actions.length, 1);
      throw new Error('Document navigated');
    }
    return { key: 'url:https://example.org/article.pdf', action: 'navigate' };
  };
  const stop = attachPaperAutoDownload(contents, { intervalMs: 5, onAction: (action) => actions.push(action) });
  await pause(25);
  contents.emit('did-finish-load');
  assert.equal(actions.length, 1);
  assert.match(scripts[1], /"activateKey":"url:https:\/\/example.org\/article.pdf"/);
  stop();
  const count = scripts.length;
  await pause(20);
  contents.emit('dom-ready');
  assert.equal(scripts.length, count);
  assert.equal(contents.eventNames().length, 0);
});

test('destroying a browser during inspection prevents a late automatic click', async () => {
  const contents = new EventEmitter();
  let finish;
  let calls = 0;
  contents.executeJavaScript = () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); };
  attachPaperAutoDownload(contents, { intervalMs: 5 });
  contents.emit('destroyed');
  finish({ key: 'url:https://example.org/paper.pdf', action: 'click' });
  await pause(15);
  assert.equal(calls, 1);
  assert.equal(contents.eventNames().length, 0);
});

test('closing or rejecting a browser fallback does not reopen a second session', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-auto-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const runtime = createPaperDownloadRuntime({ startBrowserDownloadSession: async () => {
    calls += 1;
    return { ok: false, error: 'Browser session closed before download completed.' };
  } });
  const result = await runtime.downloadPaper({ page_url: 'https://example.org/article',
    storage_path: root, linked_name: 'Test', paper_title: 'Canceled paper' });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.match(result.error, /Browser session closed/);
});

test('closing an active browser cancels its transfer and ignores late progress', async () => {
  let win;
  const progress = [];
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      win = this;
      this.webContents = new EventEmitter();
      this.webContents.session = new EventEmitter();
      this.webContents.executeJavaScript = async () => false;
    }
    async loadURL() {}
    isDestroyed() { return this.destroyed === true; }
    close() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const { startDefaultBrowserDownloadSession } = createBrowserDownloadSession({
    BrowserWindow: FakeWindow, cleanText: (value) => String(value || '')
  });
  const pending = startDefaultBrowserDownloadSession({ downloadId: 'cancel-active',
    browserEntryUrl: 'https://example.org/article', targetFilePath: '/tmp/unused-paper.pdf',
    simulateOneClick: false, updateProgress: (patch) => progress.push(patch) });
  await pause(0);
  const item = new EventEmitter();
  let canceled = false;
  item.setSavePath = () => {};
  item.cancel = () => { canceled = true; item.emit('done', null, 'cancelled'); };
  win.webContents.session.emit('will-download', {}, item, win.webContents);
  win.close();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(canceled, true);
  const count = progress.length;
  item.emit('updated');
  assert.equal(progress.length, count);
  assert.equal(win.webContents.session.listenerCount('will-download'), 0);
});

test('an HTML response saved by the browser is rejected and removed before indexing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-auto-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let indexed = false;
  let saved;
  const runtime = createPaperDownloadRuntime({ startBrowserDownloadSession: async ({ targetFilePath }) => {
    saved = targetFilePath;
    await fs.writeFile(saved, '<html>Sign in to access this paper</html>');
    return { ok: true, file_path: saved };
  }, paperKnowledgeDatabaseRuntime: { ingestPaperPdf: async () => { indexed = true; } } });
  const result = await runtime.downloadPaper({ page_url: 'https://example.org/article',
    storage_path: root, linked_name: 'Test', paper_title: 'Invalid paper' });
  assert.equal(result.ok, false);
  assert.match(result.error, /did not contain a PDF/);
  assert.equal(indexed, false);
  await assert.rejects(fs.stat(saved), { code: 'ENOENT' });
});

class FakeContents extends EventEmitter {
  constructor() {
    super();
    this.session = new EventEmitter();
    this.executeJavaScript = async () => false;
  }
  setWindowOpenHandler() {}
}

class FakeBrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.loaded = [];
    this.contents = new FakeContents();
    FakeBrowserWindow.last = this;
  }
  // Electron throws here once the window is destroyed.
  get webContents() {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    return this.contents;
  }
  async loadURL(url) { this.loaded.push(url); }
  isDestroyed() { return this.destroyed === true; }
  close() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
}

function startFakeSession(options = {}) {
  const { startDefaultBrowserDownloadSession } = createBrowserDownloadSession({
    BrowserWindow: FakeBrowserWindow, cleanText: (value) => String(value || '')
  });
  const pending = startDefaultBrowserDownloadSession({ downloadId: 'fake', browserEntryUrl: 'https://example.org/article',
    targetFilePath: '/tmp/unused-paper.pdf', storagePath: '/tmp', simulateOneClick: false, updateProgress: () => {}, ...options });
  return { pending, win: FakeBrowserWindow.last };
}

function fakeDownload(mime) {
  const item = new EventEmitter();
  item.saved = false;
  item.received = 0;
  item.setSavePath = () => { item.saved = true; };
  item.getMimeType = () => mime;
  item.getReceivedBytes = () => item.received;
  item.getTotalBytes = () => 100;
  item.cancel = () => {};
  return item;
}

test('closing the last popup ends the session at once without touching the destroyed window', async () => {
  const { pending, win } = startFakeSession();
  await pause(0);
  const child = new FakeBrowserWindow();
  win.contents.emit('did-create-window', child);
  win.close();
  child.close();
  const result = await pending;
  assert.match(result.error, /closed before download completed/);
});

test('an explicit browser entry page is opened instead of the selected PDF', async () => {
  const { pending, win } = startFakeSession({ selectedPdfUrl: 'https://example.org/blocked.pdf' });
  await pause(0);
  assert.deepEqual(win.loaded, ['https://example.org/article']);
  win.close();
  await pending;
});

test('generic download types reach the PDF check while other files are refused', async () => {
  for (const [mime, accepted] of [['application/force-download', true], ['application/x-download', true],
    ['application/octet-stream', true], ['binary/octet-stream', true], ['application/pdf', true], ['', true],
    ['text/html', false], ['application/zip', false]]) {
    const { pending, win } = startFakeSession();
    await pause(0);
    const item = fakeDownload(mime);
    let prevented = false;
    win.contents.session.emit('will-download', { preventDefault: () => { prevented = true; } }, item, win.contents);
    assert.equal(item.saved, accepted, mime);
    assert.equal(prevented, !accepted, mime);
    win.close();
    await pending;
  }
});

test('an embedded viewer download uses its owning browser save path', async () => {
  const { pending, win } = startFakeSession();
  await pause(0);
  const item = fakeDownload('application/pdf');
  const guest = { hostWebContents: { hostWebContents: win.contents } };
  win.contents.session.emit('will-download', {}, item, guest);
  win.close();
  await pending;
  assert.equal(item.saved, true, 'A viewer owned by this paper browser must not fall through to a system Save As panel');
});

test('foreign and cyclic embedded viewers do not claim another browser download', async () => {
  const { pending, win } = startFakeSession();
  await pause(0);
  const other = { hostWebContents: new FakeContents() };
  const cycle = {};
  cycle.hostWebContents = cycle;
  for (const guest of [other, cycle]) {
    const item = fakeDownload('application/pdf');
    win.contents.session.emit('will-download', {}, item, guest);
    assert.equal(item.saved, false);
  }
  win.close();
  await pending;
});

test('the session deadline moves with transfer progress and still catches a stall', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pending, win } = startFakeSession({ timeoutMs: 6000 });
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(5000);
  const item = fakeDownload('application/pdf');
  win.contents.session.emit('will-download', {}, item, win.contents);
  for (let index = 1; index <= 4; index += 1) {
    t.mock.timers.tick(5000);
    item.received = index * 10;
    item.emit('updated');
  }
  assert.equal(win.isDestroyed(), false, 'twenty-five seconds of progress is not a timeout');
  item.emit('updated');
  t.mock.timers.tick(6000);
  const result = await pending;
  assert.match(result.error, /timed out/);
});

function textPdf(lines) {
  const content = `BT /F1 10 Tf 40 760 Td 14 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const paperPage = (title, doi = '') => textPdf([title, ...(doi ? [`https://doi.org/${doi}`] : []),
  ...Array.from({ length: 12 }, (_, index) => `Body line ${index} describes the methods and measurements used in this work.`)]);

test('automatic browser PDFs must name the requested paper when their text is readable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-auto-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requested = 'Thermostable VHH binders for CD19 CAR T cells';
  const cases = [
    { label: 'another paper', pdf: paperPage('Kinase inhibitors in lung cancer cohorts'), input: { paper_title: requested }, ok: false },
    { label: 'another paper, requested DOI', pdf: paperPage('Kinase inhibitors in lung cancer cohorts', '10.1000/other'), input: { doi: '10.1000/wanted', paper_title: requested }, ok: false },
    { label: 'matching title', pdf: paperPage(requested), input: { paper_title: requested }, ok: true },
    { label: 'title differing by a word', pdf: paperPage('Thermostable VHH binders for human CD19 CAR T cells'), input: { paper_title: requested }, ok: true },
    { label: 'matching DOI', pdf: paperPage('Published under another title', '10.1000/Wanted'), input: { doi: '10.1000/wanted', paper_title: 'Short name' }, ok: true },
    { label: 'manual choice', pdf: paperPage('Kinase inhibitors in lung cancer cohorts'), input: { paper_title: requested, simulate_one_click: false }, ok: true },
    { label: 'scan with no text', pdf: textPdf(['']), input: { paper_title: requested }, ok: true },
    { label: 'no identity to compare', pdf: paperPage('Anything at all'), input: {}, ok: true }
  ];
  for (const [index, entry] of cases.entries()) {
    let saved;
    let indexed = false;
    const runtime = createPaperDownloadRuntime({ startBrowserDownloadSession: async ({ targetFilePath }) => {
      saved = targetFilePath;
      await fs.writeFile(saved, entry.pdf);
      return { ok: true, file_path: saved };
    }, paperKnowledgeDatabaseRuntime: { ingestPaperPdf: async () => { indexed = true; return { ok: true }; } } });
    const result = await runtime.downloadPaper({ page_url: 'https://example.org/article', storage_path: root,
      linked_name: `Case ${index}`, ...entry.input });
    assert.equal(result.ok, entry.ok, `${entry.label}: ${result.error}`);
    assert.equal(indexed, entry.ok, entry.label);
    if (entry.ok) continue;
    assert.match(result.error, /did not match the requested paper/);
    await assert.rejects(fs.stat(saved), { code: 'ENOENT' });
  }
});
