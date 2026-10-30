// A public-protocol fixture: it deliberately imports no Hikari implementation.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const pluginRoot = path.resolve(__dirname, '..');
const permissions = ['storage', 'notebook:read', 'notebook:write', 'downloads'];
let win, toolServer, hostServer, temporary;
let checks = 0;

function hostFixture(config) {
  const frame = document.getElementById('tool');
  const state = window.fixture = {
    permissions: config.permissions, saved: null, unsaved: false, calls: [], failures: {}, hold: {}, release: {},
    appended: [], downloads: [], cancelDownload: false, appearance: { mode: 'day', fontSize: 16 }
  };
  const gates = { 'storage.get': 'storage', 'storage.set': 'storage', 'notebook.list': 'notebook:read', 'notebook.appendResult': 'notebook:write', 'downloads.save': 'downloads' };
  state.emit = (event, payload) => frame.contentWindow.postMessage({ hikari: 1, event, payload }, config.toolOrigin);
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow || event.origin !== config.toolOrigin || event.data?.hikari !== 1 || !event.data.verb) return;
    const { id, verb, params } = event.data;
    state.calls.push({ verb, params });
    try {
      if (state.hold[verb]) await new Promise(resolve => { state.release[verb] = resolve; });
      if (state.failures[verb]) { state.failures[verb] -= 1; throw new Error('Fixture failure'); }
      if (gates[verb] && !state.permissions.includes(gates[verb])) throw new Error(`Missing permission: ${gates[verb]}`);
      let result;
      if (verb === 'app.info') result = { host: 'hikari', pluginId: 'qpcr-analysis', permissions: state.permissions, appearance: state.appearance, storage: { configured: false }, layout: {} };
      else if (verb === 'storage.get') result = { value: state.saved, limit: 1000000 };
      else if (verb === 'storage.set') { state.saved = params.value; result = { bytes: JSON.stringify(params.value).length, limit: 1000000 }; }
      else if (verb === 'notebook.list') result = [{ id: 'n1', experimentName: '<img src=x onerror=alert(1)> Experiment' }];
      else if (verb === 'notebook.appendResult') { state.appended.push(params); result = { id: params.entryId, appendedText: true, appendedTable: true }; }
      else if (verb === 'downloads.save') { state.downloads.push(params); result = state.cancelDownload ? { saved: false, canceled: true } : { saved: true, fileName: params.fileName }; }
      else if (verb === 'app.setUnsaved') { state.unsaved = params.unsaved; result = { unsaved: state.unsaved }; }
      else throw new Error(`Unknown verb: ${verb}`);
      frame.contentWindow.postMessage({ hikari: 1, id, ok: true, result }, config.toolOrigin);
    } catch (error) { frame.contentWindow.postMessage({ hikari: 1, id, ok: false, error: error.message }, config.toolOrigin); }
  });
  frame.src = `${config.toolOrigin}/index.html`;
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}

function bounded(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Renderer evaluation timed out')), 4000); })]).finally(() => clearTimeout(timer));
}
const host = code => bounded(win.webContents.executeJavaScript(code));
const frame = () => win.webContents.mainFrame.frames.find(child => child.url.startsWith(toolOrigin));
let toolOrigin;
const ui = code => bounded(frame().executeJavaScript(code));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch { /* frame may be navigating */ }
    await pause(30);
  }
  throw new Error(`Timed out: ${description}`);
}
const text = id => ui(`document.getElementById(${JSON.stringify(id)}).textContent`);
const click = id => ui(`document.getElementById(${JSON.stringify(id)}).click()`);
const input = (id, value) => ui(`(() => { const field = document.getElementById(${JSON.stringify(id)}); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const analyze = () => ui("document.getElementById('analysis-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))");
const calls = verb => host(`fixture.calls.filter(call => call.verb === ${JSON.stringify(verb)}).length`);
async function ready() { await until(async () => frame() && (await text('host-status')).includes('Connected'), 'host connection'); await until(() => ui("!document.getElementById('refresh-notebooks').disabled"), 'notebook loading'); }
async function reload() {
  const marker = `reload=${Date.now()}`;
  const loaded = new Promise(resolve => win.webContents.once('did-frame-finish-load', resolve));
  await host(`document.getElementById('tool').src = ${JSON.stringify(`${toolOrigin}/index.html?${marker}`)}`);
  await bounded(loaded);
  await until(() => frame()?.url.includes(marker), 'new iframe navigation');
  await ready();
}
function pass(message) { checks += 1; console.log(`PASS ${message}`); }

async function run() {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-qpcr-ui-'));
  app.setPath('userData', path.join(temporary, 'profile'));
  await app.whenReady();
  toolServer = await listen(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const files = new Set(['index.html', 'style.css', 'analysis.js', 'hikari.js', 'main.js', 'icon.svg', 'i18n.js', 'locales/en.js', 'locales/es.js']);
    const name = pathname.slice(1);
    if (!files.has(name)) { response.writeHead(404); response.end(); return; }
    try {
      const content = await fs.readFile(path.join(pluginRoot, name));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': types[path.extname(name)] }); response.end(content);
    } catch { response.writeHead(500); response.end(); }
  });
  toolOrigin = `http://127.0.0.1:${toolServer.address().port}`;
  hostServer = await listen((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(`(${hostFixture.toString()})(${JSON.stringify({ permissions, toolOrigin })});`);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0;display:block}</style></head><body><iframe id="tool" title="qPCR Analysis" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"></iframe><script src="/fixture.js"></script></body></html>');
    }
  });
  win = new BrowserWindow({ width: 1150, height: 950, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await win.loadURL(`http://127.0.0.1:${hostServer.address().port}`);
  await ready();
  assert.equal(await ui('typeof window.require'), 'undefined');
  assert.equal(await ui('document.querySelectorAll("img").length'), 0);
  assert.ok((await ui('document.getElementById("notebook-entry").options[1].textContent')).includes('<img'));
  pass('separate-origin sandbox and safe host text');

  await click('load-example');
  assert.equal(await ui('document.getElementById("result-table").tBodies[0].rows.length'), 4);
  assert.equal(await ui('document.getElementById("group-table").tBodies[0].rows[0].cells[1].textContent'), '2');
  pass('relative expression example and biological group summary');

  await input('expression-data', 'c\tControl\tUndetermined\t20');
  assert.equal(await ui('document.getElementById("results").hidden'), true);
  assert.equal(await ui('document.getElementById("export-results").disabled'), true);
  await analyze(); assert.match(await text('analysis-status'), /undetermined/);
  await input('expression-data', '<img src=x>\tControl\t25\t20\nt\tTreated\t23\t20'); await analyze();
  assert.equal(await ui('document.querySelectorAll("img").length'), 0);
  assert.equal(await ui('document.getElementById("result-table").tBodies[0].rows[1].lastElementChild.textContent'), '4');
  pass('invalid Ct review, stale result invalidation and safe user text');

  await host("fixture.failures['storage.set'] = 1");
  const beforeSave = await calls('storage.set');
  await ui('document.getElementById("save-inputs").click(); document.getElementById("save-inputs").click()');
  await until(async () => (await text('save-status')).includes('Save failed'), 'save failure');
  assert.equal(await calls('storage.set'), beforeSave + 1);
  assert.equal(await host('fixture.saved'), null);
  assert.equal(await host('fixture.unsaved'), true);
  await click('save-inputs');
  await until(async () => (await text('save-status')).includes('Inputs saved'), 'save retry');
  await until(() => host('fixture.unsaved === false'), 'saved flag');
  pass('exclusive save failure/retry without false success');

  await host("fixture.hold['storage.set'] = true");
  await input('target-name', 'IL6'); await click('save-inputs');
  await until(() => host("!!fixture.release['storage.set']"), 'held save');
  await input('target-name', 'TNF');
  await host("fixture.hold['storage.set'] = false; fixture.release['storage.set']()");
  await until(async () => (await text('save-status')).includes('current edits'), 'concurrent edit status');
  assert.equal(await host('fixture.saved.targetName'), 'IL6');
  assert.equal(await host('fixture.unsaved'), true);
  await click('save-inputs'); await until(() => host("fixture.saved.targetName === 'TNF' && !fixture.unsaved"), 'newest input saved');
  await reload();
  assert.equal(await ui('document.getElementById("target-name").value'), 'TNF');
  assert.ok((await ui('document.getElementById("expression-data").value')).startsWith('<img'));
  pass('concurrent edits stay unsaved and saved draft rehydrates');

  await analyze();
  await ui('document.getElementById("notebook-entry").value = "n1"; document.getElementById("notebook-entry").dispatchEvent(new Event("change"))');
  await host("fixture.hold['notebook.appendResult'] = true; fixture.failures['notebook.appendResult'] = 1");
  const beforeAppend = await calls('notebook.appendResult');
  await ui('document.getElementById("append-results").click(); document.getElementById("append-results").click()');
  await until(() => host("!!fixture.release['notebook.appendResult']"), 'held append');
  assert.equal(await calls('notebook.appendResult'), beforeAppend + 1);
  await host("fixture.hold['notebook.appendResult'] = false; fixture.release['notebook.appendResult']()");
  await until(async () => (await text('notebook-status')).includes('Append failed'), 'append failure');
  await click('append-results'); await until(() => host('fixture.appended.length === 1'), 'append retry');
  const appended = await host('fixture.appended[0]');
  assert.equal(appended.entryId, 'n1'); assert.match(appended.text, /Calibrator group: Control/);
  assert.equal(appended.table.rows[1].fold, '4');
  assert.ok(appended.table.rows.every(row => row.id && typeof row.delta_ct === 'string'));
  pass('notebook append is exclusive, retryable and uses the documented table shape');

  await host('fixture.cancelDownload = true'); await click('export-results');
  await until(async () => (await text('export-status')).includes('canceled'), 'download cancel');
  await host("fixture.cancelDownload = false; fixture.failures['downloads.save'] = 1");
  await click('export-results'); await until(async () => (await text('export-status')).includes('Export failed'), 'download failure');
  await click('export-results'); await until(async () => (await text('export-status')).includes('TSV exported'), 'download retry');
  const exported = await host('fixture.downloads[fixture.downloads.length - 1]');
  const decoded = Buffer.from(exported.dataBase64, 'base64').toString('utf8');
  assert.match(decoded, /ΔΔCt/); assert.match(decoded, /Target Ct values/); assert.match(decoded, /TNF/);
  pass('UTF-8 export, cancellation and retry');

  await click('curve-mode'); await click('load-example');
  assert.equal(await ui('document.querySelectorAll("#curve-plot svg circle").length'), 5);
  assert.match(await text('metrics'), /99\.99/);
  assert.equal(await ui('document.getElementById("result-table").tBodies[0].rows.length'), 5);
  await input('curve-data', '1\t20\n10\t21\n100\t22'); await analyze();
  assert.match(await text('analysis-status'), /negative/);
  await input('curve-data', '1\t30\n10\t26\n100\t23'); await analyze();
  pass('standard curve plot, efficiency and invalid slope handling');

  await input('reference-name', 'GAPDH');
  await host("fixture.emit('app.save', { pluginId: 'qpcr-analysis' })");
  await until(() => host("fixture.saved.referenceName === 'GAPDH' && !fixture.unsaved"), 'host save');
  pass('host Save persists the current draft');
  await analyze();

  await host("fixture.appearance = { mode: 'night', fontSize: 24 }; fixture.emit('app.context', { appearance: fixture.appearance, storage: { configured: false }, layout: {}, changed: 'appearance' })");
  await until(() => ui("document.documentElement.dataset.mode === 'night'"), 'appearance event');
  win.setSize(380, 900); await pause(100);
  assert.equal(await ui('document.body.style.fontSize'), '24px');
  assert.ok(await ui('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'));
  await ui('document.getElementById("curve-mode").focus()');
  assert.equal(await ui('document.activeElement.id'), 'curve-mode');
  await fs.writeFile(path.join(temporary, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1150, 950); await pause(100);
  await fs.writeFile(path.join(temporary, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
  pass('night mode, host font size, keyboard focus and narrow layout');

  await host("fixture.permissions = fixture.permissions.filter(permission => permission !== 'notebook:write')");
  await reload(); await analyze();
  await ui('document.getElementById("notebook-entry").value = "n1"; document.getElementById("notebook-entry").dispatchEvent(new Event("change"))');
  assert.equal(await ui('document.getElementById("append-results").disabled'), true);
  assert.match(await text('notebook-status'), /permission/);
  pass('missing notebook write permission leaves local analysis usable');

  await host("fixture.permissions = ['notebook:read']; fixture.failures['notebook.list'] = 1");
  await reload();
  assert.equal(await ui('document.getElementById("save-inputs").disabled'), true);
  assert.match(await text('notebook-status'), /Could not load|permission/);
  await click('load-example');
  assert.equal(await ui('document.getElementById("export-results").disabled'), true);
  await click('refresh-notebooks'); await until(async () => (await text('notebook-status')).includes('Choose a page'), 'notebook read retry');
  pass('missing storage/download permissions and notebook read retry');

  await host(`fixture.permissions = ${JSON.stringify(permissions)}; fixture.failures['storage.get'] = 1`);
  await reload(); assert.equal(await ui('document.getElementById("save-inputs").disabled'), true);
  await input('target-name', 'KEEP THIS EDIT');
  await click('connect');
  await until(() => ui('!document.getElementById("save-inputs").disabled'), 'storage read retry');
  assert.equal(await ui('document.getElementById("target-name").value'), 'KEEP THIS EDIT');
  assert.equal(await host('fixture.unsaved'), true);
  pass('startup read failure/retry preserves edits and does not overwrite saved state');

  console.log(`${checks}/${checks} UI checks passed. Screenshots: ${temporary}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  win?.destroy();
  await Promise.all([toolServer, hostServer].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  app.exit(process.exitCode || 0);
});
