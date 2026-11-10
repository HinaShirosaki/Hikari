'use strict';

// Real publisher-like pages and downloads, using disposable cookies/storage.
// No external publisher, user profile, credentials, or model calls are used.
const { app, BrowserWindow, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createPaperDownloadRuntime } = require('../src/main/papers/download/agent-paper-download.js');

const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-paper-auto-browser-'));
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'session'));
app.on('window-all-closed', () => {});
// Without a listener Electron opens a blocking error dialog instead.
const uncaught = [];
process.on('uncaughtException', (error) => uncaught.push(error.message));
const windows = [];
const servers = [];
const requests = [];
const progress = [];
const unclaimedDownloads = [];
const suppressUnclaimedDialog = (event, item, contents) => {
  if (!item.getSavePath()) {
    unclaimedDownloads.push({ url: item.getURL(), contents: contents?.id });
    event.preventDefault();
  }
};
let origin;
let frameOrigin;
let checks = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const pdf = (name) => `%PDF-1.7\nAutomatic download fixture: ${name}\n%%EOF\n`;
const page = (body) => `<!doctype html><html><head><title>Publisher fixture</title></head><body>${body}</body></html>`;

function handler(req, res) {
  requests.push({ url: req.url, cookie: req.headers.cookie, referer: req.headers.referer });
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/file/')) {
    const name = path.basename(url.pathname, '.pdf');
    res.setHeader('Content-Type', name === 'archive' ? 'application/zip'
      : (name === 'forced' ? 'application/force-download' : 'application/pdf'));
    res.setHeader('Content-Disposition', name === 'forced' ? 'attachment; filename="paper.pdf"' : 'inline');
    const finish = () => res.end(name === 'archive' ? 'Not a paper' : pdf(name));
    if (name === 'slow') {
      // Keeps sending past the session timeout: progress must keep it alive.
      res.write('%PDF-1.7\nAutomatic download fixture: slow\n');
      let remaining = 6;
      const drip = setInterval(() => {
        res.write(`${'%'.repeat(64 * 1024)}\n`);
        remaining -= 1;
        if (remaining) return;
        clearInterval(drip);
        res.end('%%EOF\n');
      }, 1000);
      return;
    }
    if (name.startsWith('parallel') || name === 'late') setTimeout(finish, 250);
    else finish();
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  switch (url.pathname) {
    case '/article/meta':
      res.end(page('<meta name="citation_pdf_url" content="/file/meta.pdf"><h1>Paper metadata</h1><a href="/file/supplement.pdf">Supplementary PDF</a>'));
      break;
    case '/article/cookie':
      res.setHeader('Set-Cookie', 'paper_access=allowed; Path=/; SameSite=Lax');
      res.end(page('<a href="/file/cookie.pdf">Download PDF</a>'));
      break;
    case '/article/delayed':
      res.end(page(`<script>setTimeout(() => {
        const button = document.createElement('button'); button.textContent = 'Download PDF';
        button.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([${JSON.stringify(pdf('blob'))}], {type:'application/pdf'})); a.download = 'paper.pdf'; a.click(); };
        document.body.append(button);
      }, 180);</script>`));
      break;
    case '/article/popup':
      res.end(page('<button onclick="window.open(\'/viewer/first\'); window.close()">Download PDF</button>'));
      break;
    case '/article/direct-popup':
      res.end(page('<button onclick="window.open(\'/file/direct-popup.pdf\'); window.close()">Download PDF</button>'));
      break;
    case '/article/blank-pdf':
      res.end(page('<a target="_blank" rel="noopener noreferrer" href="/file/blank-pdf.pdf">Download PDF</a>'));
      break;
    case '/article/download-pdf':
      res.end(page('<a target="_blank" download="paper.pdf" href="/file/download-pdf.pdf">Download PDF</a>'));
      break;
    case '/article/duplicate':
      res.end(page('<button onclick="window.open(\'/file/duplicate.pdf\'); window.open(\'/file/late.pdf\')">Download PDF</button>'));
      break;
    case '/article/guest':
      res.end(page('<webview partition="persist:paper-browser" src="/viewer/guest" style="width:600px;height:400px"></webview>'));
      break;
    case '/viewer/guest':
      res.end(page('<a href="/file/guest.pdf">Download PDF</a>'));
      break;
    case '/viewer/first':
      res.end(page('<button onclick="window.open(\'/viewer/second\'); window.close()">Download PDF</button>'));
      break;
    case '/viewer/second':
      res.end(page('<a href="/file/popup.pdf">Download</a>'));
      break;
    case '/article/framed':
      res.end(page(`<iframe style="width:600px;height:400px" src="${frameOrigin}/viewer/framed"></iframe>`));
      break;
    case '/viewer/framed':
      res.end(page('<button aria-label="Download" onclick="location.href=\'/file/framed.pdf\'">Download</button>'));
      break;
    case '/article/shadow':
      res.end(page('<div id="toolbar"></div><script>document.querySelector("#toolbar").attachShadow({mode:"open"}).innerHTML=\'<a href="/file/shadow.pdf">PDF</a>\';</script>'));
      break;
    case '/article/challenge':
      res.end(page(`<script>window.unwantedClicks=0</script>
        <button onclick="unwantedClicks++">Sign in for PDF</button>
        <button onclick="unwantedClicks++">Purchase PDF</button>
        <button onclick="unwantedClicks++">Accept cookies</button>
        <button onclick="unwantedClicks++" disabled>Download PDF</button>
        <button onclick="unwantedClicks++" style="display:none">Download PDF</button>
        <button onclick="unwantedClicks++">Download</button>
        <a href="/file/supplement.pdf">Supporting information PDF</a>
        <div id="references"><a href="/file/reference.pdf">PDF</a></div>`));
      break;
    case '/article/paywalled':
      res.end(page('<h1>Paywalled</h1><section id="citing-articles" class="citing-literature"><a href="/file/other-paper.pdf">PDF</a></section><div class="most-read"><a href="/file/other-paper.pdf">Download PDF</a></div>'));
      break;
    case '/article/titled':
      res.end(page('<a aria-label="Download PDF: Designing dietary supplementation after photo-excitation" href="/article-pdf/supplementation-study.pdf"><span>PDF</span></a>'));
      break;
    case '/article-pdf/supplementation-study.pdf':
      res.setHeader('Content-Type', 'application/pdf');
      res.end(pdf('titled'));
      break;
    case '/article/selfclose':
      res.end(page('<button onclick="window.open(\'/viewer/closing\'); window.close()">Download PDF</button>'));
      break;
    case '/viewer/closing':
      res.end(page('<script>setTimeout(() => window.close(), 250)</script>'));
      break;
    case '/article/archive':
      res.end(page('<a href="/file/archive.pdf">Download PDF</a><a href="/file/recovered.pdf">Full text PDF</a>'));
      break;
    default: {
      const name = url.pathname.split('/').pop();
      res.end(page(`<a href="/file/${name}.pdf">Download PDF</a>`));
    }
  }
}

async function serve() {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

class FixtureBrowserWindow {
  constructor(options) {
    const win = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, webviewTag: true } });
    windows.push(win);
    win.webContents.on('did-create-window', (child) => windows.push(child));
    // A missed handler must fail the fixture, never open a system Save As panel.
    setImmediate(() => {
      const session = win.webContents.session;
      session.removeListener('will-download', suppressUnclaimedDialog);
      session.on('will-download', suppressUnclaimedDialog);
    });
    return win;
  }
}

async function run() {
  await app.whenReady();
  origin = await serve();
  frameOrigin = await serve();
  const runtime = createPaperDownloadRuntime({ BrowserWindow: FixtureBrowserWindow,
    enableDefaultBrowserSession: true, onJobUpdate: (job) => progress.push({ id: job.download_id, status: job.status }) });
  let serial = 0;
  const input = (name, extra = {}) => ({ page_url: `${origin}/article/${name}`, storage_path: root,
    linked_name: 'Auto-download QA', paper_title: `${name}-${++serial}`, timeout_ms: 12000,
    knowledge_database: false, ...extra });
  async function download(name, expected = name, extra = {}) {
    const result = await runtime.downloadPaper(input(name, extra));
    assert.equal(result.ok, true, `${name}: ${result.error || result.summary}`);
    assert.equal(await fs.readFile(result.file_path, 'utf8'), pdf(expected), `${name}: correct saved PDF`);
    check(result.method === 'browser', `${name}: completed through the browser`);
    check(!result.browser_session_active, `${name}: session cleaned up`);
    console.log(`PASS ${name}`);
    return result;
  }

  await download('meta');
  check(!requests.some((r) => /supplement/.test(r.url)), 'supplement is not selected ahead of article metadata');
  await download('cookie');
  const authenticated = requests.find((r) => r.url === '/file/cookie.pdf');
  check(authenticated.cookie.includes('paper_access=allowed'), 'publisher cookies accompany the PDF request');
  check(authenticated.referer === `${origin}/article/cookie`, 'click preserves publisher referrer');
  await download('delayed', 'blob');
  await download('direct-popup');
  await download('blank-pdf');
  await download('download-pdf');
  await download('duplicate');
  await pause(500);
  check(unclaimedDownloads.length === 0, 'a direct PDF popup has a save destination before download starts');
  const guestDownload = runtime.downloadPaper(input('guest'));
  await pause(1000);
  const guestWindow = windows.find(win => !win.isDestroyed() && win.webContents.getURL().endsWith('/article/guest'));
  const guest = webContents.getAllWebContents().find(contents => contents.hostWebContents === guestWindow.webContents);
  check(Boolean(guest), 'embedded viewer has the expected owning paper browser');
  await guest.executeJavaScript("document.querySelector('a').click()", true);
  const guestResult = await guestDownload;
  check(guestResult.ok && await fs.readFile(guestResult.file_path, 'utf8') === pdf('guest'), 'embedded viewer PDF is saved directly to the paper target');
  check(unclaimedDownloads.length === 0, 'embedded viewer never falls through to a system Save As panel');
  await download('popup');
  await download('framed');
  await download('shadow');
  await download('archive', 'recovered');
  await download('forced');
  await download('titled');
  check(uncaught.length === 0, `popup cleanup raised no main-process errors: ${uncaught.join('; ')}`);

  const closingAt = Date.now();
  const closed = await runtime.downloadPaper(input('selfclose'));
  check(!closed.ok && /closed before download completed/.test(closed.error), 'closing every window ends the job');
  check(Date.now() - closingAt < 8000, 'the job ends when the last popup closes, not at the timeout');

  const paywalled = await runtime.downloadPaper(input('paywalled', { timeout_ms: 5000 }));
  check(!paywalled.ok && !requests.some((r) => r.url === '/file/other-paper.pdf'), 'PDF links in citing and most-read lists are ignored');

  const slow = await runtime.downloadPaper(input('slow', { timeout_ms: 5000 }));
  check(slow.ok, `a transfer that keeps progressing outlives the session timeout: ${slow.error || ''}`);

  const pending = runtime.downloadPaper(input('challenge'));
  await pause(1400);
  const challenge = windows.find((win) => !win.isDestroyed() && win.webContents.getURL().endsWith('/article/challenge'));
  check(Boolean(challenge), 'verification page stays open');
  check(await challenge.webContents.executeJavaScript('unwantedClicks === 0'), 'sign-in, purchase, cookies, hidden and disabled controls are not clicked');
  check(!requests.some((r) => /\/file\/(?:reference|supplement)\.pdf/.test(r.url)), 'reference and supplemental PDFs are ignored');
  await challenge.webContents.executeJavaScript("document.body.insertAdjacentHTML('beforeend', '<a href=\"/file/authorized.pdf\">Download PDF</a>')");
  const authorized = await pending;
  check(authorized.ok && await fs.readFile(authorized.file_path, 'utf8') === pdf('authorized'), 'automation resumes when access exposes the PDF');

  const manual = runtime.downloadPaper(input('manual', { simulate_one_click: false }));
  await pause(1200);
  check(!requests.some((r) => r.url === '/file/manual.pdf'), 'explicit manual mode disables automatic clicking');
  const manualWindow = windows.find((win) => !win.isDestroyed() && win.webContents.getURL().endsWith('/article/manual'));
  await manualWindow.webContents.executeJavaScript("document.querySelector('a').click()", true);
  check((await manual).ok, 'manual download still works');

  const [first, second] = await Promise.all([download('parallel-one'), download('parallel-two')]);
  check(first.file_path !== second.file_path, 'parallel sessions keep their own target files');
  for (const result of [first, second]) {
    const states = progress.filter((event) => event.id === result.download_id).map((event) => event.status);
    check(states.includes('resolving_browser_pdf') && states.includes('browser_downloading') && states.at(-1) === 'completed', 'progress reaches completed without reverting after download starts');
  }
  check(windows.every((win) => win.isDestroyed()), 'successful jobs close their browser windows');
  check(uncaught.length === 0, `no main-process errors: ${uncaught.join('; ')}`);
  console.log(`Paper browser automatic download: ${checks} checks passed.`);
}

const timeout = setTimeout(() => { console.error('Paper browser automatic download fixture timed out'); app.exit(1); }, 90000);
run().then(() => 0, (error) => {
  console.error(error.stack || error);
  console.error(JSON.stringify({ requests, progress: progress.slice(-15), windows: windows.map((win) => win.isDestroyed() ? 'closed' : win.webContents.getURL()) }));
  return 1;
}).then(async (code) => {
  clearTimeout(timeout);
  windows.forEach((win) => { if (!win.isDestroyed()) win.destroy(); });
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await fs.rm(root, { recursive: true, force: true });
  app.exit(code);
});
