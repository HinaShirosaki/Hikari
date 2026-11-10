'use strict';

// Opt-in live smoke test. Downloads public articles into QA storage, without
// model calls, sign-in automation, or the user's Hikari browser profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createPaperDownloadRuntime } = require('../src/main/papers/download/agent-paper-download.js');
const { buildPaperAutoDownloadScript } = require('../src/main/papers/download/paper-download/browser-auto-download-page.js');

if (!process.argv.includes('--live')) { console.log('Use --live to download public publisher articles.'); app.exit(0); }
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-publisher-browser-'));
const subscriptionSuite = process.argv.includes('--suite=subscription');
const output = path.resolve(process.env.HIKARI_PAPER_LIVE_OUTPUT || path.join(__dirname, `../artifacts/paper-browser-publishers-live${subscriptionSuite ? '-subscription' : ''}`));
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
app.on('window-all-closed', () => {});
const filter = process.argv.find((arg) => arg.startsWith('--publisher='))?.slice('--publisher='.length);
const selectedCases = process.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length).split(',');
const timeoutMs = Math.max(5000, Math.min(180000, Number(process.argv.find((arg) => arg.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || 45000));
const openCases = [
  { id: 'acs-catalysts', publisher: 'ACS', doi: '10.1021/acsomega.4c00119', url: 'https://pubs.acs.org/doi/10.1021/acsomega.4c00119', title: 'High-Throughput Screening of Sulfur-Resistant Catalysts' },
  { id: 'springer-mastl', publisher: 'Springer', doi: '10.1186/s12964-024-01783-8', url: 'https://link.springer.com/article/10.1186/s12964-024-01783-8', title: 'Activity-based protein profiling and global proteome analysis reveal MASTL' },
  { id: 'elsevier-striatin', publisher: 'Elsevier', doi: '10.1016/j.heliyon.2024.e38386', url: 'https://www.sciencedirect.com/science/article/pii/S2405844024144179', title: 'Unraveling modulation effects on albumin synthesis and inflammation by Striatin' },
  { id: 'wiley-ul82', publisher: 'Wiley', doi: '10.1002/pro.4915', url: 'https://onlinelibrary.wiley.com/doi/10.1002/pro.4915', title: 'Crystal structure of the tegument protein UL82' },
  { id: 'acs-phosphorylation', publisher: 'ACS', doi: '10.1021/acsomega.4c00523', url: 'https://pubs.acs.org/doi/10.1021/acsomega.4c00523', title: 'Normal Mode Analysis Elicits Conformational Shifts in Proteins' },
  { id: 'springer-eprint', publisher: 'Springer', doi: '10.1186/s13059-024-03271-1', url: 'https://link.springer.com/article/10.1186/s13059-024-03271-1', title: 'ePRINT: exonuclease assisted mapping of protein-RNA interactions' },
  { id: 'elsevier-evolution', publisher: 'Elsevier', url: 'https://www.sciencedirect.com/science/article/pii/S2589597422000648', title: 'High-throughput directed evolution: a golden era for protein science' },
  { id: 'wiley-rtel1', publisher: 'Wiley', doi: '10.1002/pro.5093', url: 'https://onlinelibrary.wiley.com/doi/10.1002/pro.5093', title: 'Structural and biochemical characterization of the C-terminal region of the human RTEL1 helicase' }
];
const subscriptionCases = [
  { id: 'acs-azoles', publisher: 'ACS', doi: '10.1021/ja0471525', url: 'https://pubs.acs.org/doi/10.1021/ja0471525', title: 'Copper(I)-Catalyzed Synthesis of Azoles. DFT Study Predicts Unprecedented Reactivity and Intermediates' },
  { id: 'springer-alloys', publisher: 'Springer', doi: '10.1007/s10853-024-09552-1', url: 'https://link.springer.com/article/10.1007/s10853-024-09552-1', title: 'Laser additive manufacturing of Cu–Cr–Nb alloys by using elemental powder' },
  { id: 'acs-cascade', publisher: 'ACS', doi: '10.1021/jacs.4c11482', url: 'https://pubs.acs.org/doi/10.1021/jacs.4c11482', title: 'Supramolecular Catalyzed Cascade Reduction of Azaarenes Interrogated via Data Science' },
  { id: 'springer-uranium', publisher: 'Springer', doi: '10.1007/s11356-020-09563-w', url: 'https://link.springer.com/article/10.1007/s11356-020-09563-w', title: 'Uranium and neptunium retention mechanisms in Gallionella ferruginea/ferrihydrite systems for remediation purposes' },
  { id: 'elsevier-photocyclization', publisher: 'Elsevier', doi: '10.1016/j.tetlet.2024.155161', url: 'https://www.sciencedirect.com/science/article/pii/S0040403924002569', title: 'Synthesis of Poly-substituted 2-Hydroxycyclobutanones via Norrish–Yang Photocyclization/1,2-Methyl Migration' },
  { id: 'wiley-palladium', publisher: 'Wiley', doi: '10.1002/anie.202400509', url: 'https://onlinelibrary.wiley.com/doi/10.1002/anie.202400509', title: 'Palladium (II)-Catalyzed C–H Activation with Bifunctional Ligands: From Curiosity to Industrialization' }
];
const cases = (subscriptionSuite ? subscriptionCases : openCases).filter((item) => (!filter || item.publisher.toLowerCase() === filter.toLowerCase()) && (!selectedCases || selectedCases.includes(item.id)));
const report = { started_at: new Date().toISOString(), electron: process.versions.electron,
  profile: 'disposable; no existing publisher cookies; current network connection', suite: subscriptionSuite ? 'subscription candidates' : 'open access', mode: 'article page to saved PDF; no supplied PDF URL', cases: [] };
const allWindows = new Set();
const cleanUrl = (raw) => { try { const value = new URL(raw); value.search = ''; value.hash = ''; return value.href; } catch { return ''; } };

async function runCase(item) {
  const evidence = { ...item, started_at: new Date().toISOString(), progress: [], pages: [], responses: [], downloads: [], snapshots: [] };
  const windows = new Set();
  const captures = [];
  let finished = false;
  async function snapshot(win, stage) {
    if (finished || win.isDestroyed()) return;
    try {
      const state = await win.webContents.executeJavaScript(`(() => ({
        title: document.title, url: location.href.split('?')[0], heading: document.querySelector('h1')?.innerText || '',
        challenge: /verify you are human|checking your browser|just a moment|access denied|unusual traffic|enable javascript|robot|captcha/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 1500)),
        metadata: Array.from(document.querySelectorAll('meta[name="citation_pdf_url"],meta[name="citation_doi"]')).map(m => ({name:m.name, content:m.content})),
        licenses: Array.from(document.querySelectorAll('a[href*="creativecommons.org"],link[rel="license"]')).slice(0,4).map(e => e.href),
        access: Array.from(document.querySelectorAll('[class*="access"],[class*="institution"],[id*="access"]')).map(e => (e.innerText || '').split(String.fromCharCode(10)).join(' ').trim()).filter(t => t && t.length < 300).slice(0,12),
        controls: Array.from(document.querySelectorAll('a,button,[role="button"]')).filter(e => /pdf|download/i.test(e.getAttribute('aria-label') || e.innerText || '')).slice(0,12).map(e => ({tag:e.tagName,label:(e.getAttribute('aria-label') || e.innerText || '').slice(0,120),url:(e.getAttribute('href') || '').split('?')[0]}))
      }))()`);
      const next = await win.webContents.executeJavaScript(buildPaperAutoDownloadScript());
      evidence.snapshots.push({ stage, ...state, candidate: next });
      const file = `${item.id}-${evidence.snapshots.length}.png`;
      await fs.writeFile(path.join(output, file), (await win.webContents.capturePage()).toPNG());
      evidence.snapshots.at(-1).screenshot = file;
    } catch { /* A successful PDF navigation may destroy this document. */ }
  }
  function observe(win) {
    allWindows.add(win); windows.add(win);
    const contents = win.webContents;
    contents.on('did-create-window', observe);
    contents.on('did-finish-load', () => {
      evidence.pages.push({ url: cleanUrl(contents.getURL()), title: contents.getTitle() });
      captures.push(snapshot(win, 'loaded'));
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) evidence.pages.push({ url: cleanUrl(url), error: `${code}: ${description}` });
    });
    contents.on('did-frame-navigate', (_event, url, statusCode, _statusText, isMainFrame) => {
      if (isMainFrame) evidence.responses.push({ url: cleanUrl(url), status: statusCode });
    });
    for (const delay of [7000, 24000, 38000]) {
      const timer = setTimeout(() => { captures.push(snapshot(win, `${delay / 1000}s`)); }, delay);
      timer.unref();
      win.once('closed', () => clearTimeout(timer));
    }
  }
  class LiveBrowserWindow {
    constructor(options) { const win = new BrowserWindow({ ...options, show: process.argv.includes('--show') }); observe(win); return win; }
  }
  const runtime = createPaperDownloadRuntime({ enableDefaultBrowserSession: true, BrowserWindow: LiveBrowserWindow,
    onJobUpdate(job) {
      if (evidence.progress.at(-1)?.status !== job.status) {
        evidence.progress.push({ status: job.status, at: new Date().toISOString() });
        console.log(`${item.id}: ${job.status}`);
      }
    } });
  const result = await runtime.downloadPaper({ page_url: item.url, doi: item.doi,
    paper_title: item.id, storage_path: path.join(output, 'storage'), linked_name: 'Publisher download live QA',
    knowledge_database: false, timeout_ms: timeoutMs, wait_timeout_ms: timeoutMs + 15000 });
  finished = true;
  // Closing a window during a challenge can leave Chromium's screenshot/JS
  // promise unresolved. Diagnostics must never stall the next live test.
  await Promise.race([Promise.allSettled(captures), new Promise((resolve) => setTimeout(resolve, 2000))]);
  evidence.result = { ok: result.ok, status: result.status, method: result.method, error: result.error,
    file_path: result.file_path, bytes: result.received_bytes };
  if (result.ok) {
    const data = await fs.readFile(result.file_path);
    evidence.result.valid_pdf_header = data.subarray(0, 5).toString() === '%PDF-';
    evidence.result.actual_bytes = data.length;
    evidence.result.sha256 = createHash('sha256').update(data).digest('hex');
  }
  evidence.finished_at = new Date().toISOString();
  report.cases.push(evidence);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`${item.id}: ${result.ok ? 'SAVED PDF' : result.error}`);
}

async function run() {
  await app.whenReady();
  await fs.mkdir(output, { recursive: true });
  for (let i = 0; i < cases.length; i += 2) await Promise.all(cases.slice(i, i + 2).map(runCase));
  report.finished_at = new Date().toISOString();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`Live publisher test finished: ${report.cases.filter(c => c.result.ok).length}/${report.cases.length} PDFs saved. Evidence: ${output}`);
}
const watchdog = setTimeout(() => { console.error('Live publisher test exceeded 5 minutes'); app.exit(1); }, 300000);
run().then(() => 0, (error) => { console.error(error.stack || error); return 1; }).then(async (code) => {
  clearTimeout(watchdog);
  for (const win of allWindows) if (!win.isDestroyed()) win.destroy();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
});
