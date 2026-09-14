'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const previewService = require('../src/main/agent/html-output/preview-service');
async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-html-qa-'));
    try {
      for (const phase of ['live', 'restart']) {
        const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp, phase], { encoding: 'utf8', timeout: 60000 });
        process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
        assert.equal(result.status, 0, String(result.error || `Electron ${phase} failed (${result.signal})`));
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow, protocol, ipcMain, session } = require('electron');
  previewService.registerHtmlPreviewScheme(protocol);
  const [storagePath, phase] = process.argv.slice(2);
  app.setPath('userData', path.join(storagePath, 'profile'));
  await app.whenReady();
  const output = path.join(root, 'artifacts/html-output'); fs.mkdirSync(output, { recursive: true });
  let win;
  previewService.installHtmlPreviewService({ protocol, ipcMain, getMainWindow: () => win });
  const requests = [];
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { requests.push(details.url); callback({ cancel: true }); });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const htmlPath = path.join(storagePath, 'qa.html');
  const appHead = fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8');
  const csp = appHead.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)[0];
  fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">${csp}<link rel="stylesheet" href="${url('styles.css')}"><style>body{display:block;margin:0;padding:1rem;background:var(--theme-surface)}#history{max-width:54rem;margin:auto}.agent-chat-row{width:100%}</style></head><body><main id="history"></main></body></html>`);
  win = new BrowserWindow({ width: 1050, height: 900, show: false, webPreferences: { preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  previewService.guardHtmlPreviewNavigation(win.webContents);
  let popupCount = 0; win.webContents.setWindowOpenHandler(() => { popupCount++; return { action: 'deny' }; });
  await win.loadFile(htmlPath);
  const exec = code => win.webContents.executeJavaScript(code);
  const chat = require('../src/main/agent/context/agent-chat-log').createAgentChatLogRuntime();
  let message;
  if (phase === 'live') {
    const html = fs.readFileSync(path.join(root, 'src/main/agent/codex-agent/official-skills/hikari-html-output/assets/threshold-explorer.html'), 'utf8');
    const result = await require('../src/main/agent/mcp-contract/gateway').createAgentMcpGateway().callGatewayTool('html_output', { title: 'Threshold explorer', html, caption: 'Move the threshold to filter illustrative measurements.', height: 30 });
    assert.equal(result.ok, true);
    const created = await chat.createSession({ storagePath, title: 'HTML output QA' });
    fs.writeFileSync(path.join(storagePath, 'session.json'), JSON.stringify(created.session));
    message = { id: 'live-html', role: 'assistant', text: 'Explore which samples meet your chosen threshold.', createdAt: new Date().toISOString(), meta: { html_artifacts: [result.html_artifact] } };
    await chat.appendRows(storagePath, created.session.id, [{ type: 'assistant-message', session_id: created.session.id, message_id: message.id, timestamp: message.createdAt, text: message.text, meta: message.meta }]);
    message.meta.live_progress = { response_text: message.text, activity_rows: [] };
  } else {
    const stored = JSON.parse(fs.readFileSync(path.join(storagePath, 'session.json')));
    message = (await chat.getSession({ storagePath, sessionId: stored.id })).messages[0];
  }
  await exec(`(async()=>{window.render= (await import(${JSON.stringify(url('src/renderer/modules/agent-chat/rendering.js'))})).renderHistory;window.messages=[${JSON.stringify(message)}];window.redraw=()=>window.render({historyNode:document.querySelector('#history'),messages:window.messages,state:{agentChat:{currentSessionId:'qa'}},safeText:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});window.redraw();})()`);
  let frame;
  for (let i = 0; i < 100; i++) {
    frame = win.webContents.mainFrame.frames.find(f => f.url.startsWith('hikari-html:'));
    if (frame && await frame.executeJavaScript("Boolean(document.querySelector('#summary')?.textContent)").catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(frame, 'preview loaded through restricted custom protocol');
  assert.equal(await frame.executeJavaScript("document.querySelector('#summary').textContent"), '3 of 4 samples meet the threshold.');
  await frame.executeJavaScript("document.querySelector('#threshold').value='0.8';document.querySelector('#threshold').dispatchEvent(new Event('input',{bubbles:true}));");
  assert.equal(await frame.executeJavaScript("document.querySelector('#summary').textContent"), '1 of 4 samples meet the threshold.');
  const routingId = frame.routingId;
  await exec("window.messages[0].id='final-html';delete window.messages[0].meta.live_progress;window.messages[0].text='Adjust the slider to inspect the samples.';window.redraw();");
  assert.equal(frame.routingId, routingId);
  assert.equal(await frame.executeJavaScript("document.querySelector('#threshold').value"), '0.8', 'progress/final rerender preserves controls');
  await exec("window.messages.push({id:'followup',role:'user',text:'Thanks'});window.redraw();");
  assert.equal(await frame.executeJavaScript("document.querySelector('#threshold').value"), '0.8', 'new message does not reset output');
  await exec("window.messages.pop();window.redraw();");
  // Appending another HTML artifact must preserve the existing browsing context.
  const extra = await require('../src/main/agent/mcp-contract/gateway').createAgentMcpGateway().callGatewayTool('html_output', { title: 'Second output', html: '<!doctype html><p>Additional result</p>' });
  await exec(`window.messages[0].meta.html_artifacts.push(${JSON.stringify(extra.html_artifact)});window.redraw();`);
  assert.equal(await frame.executeJavaScript("document.querySelector('#threshold').value"), '0.8');
  await exec("window.messages[0].meta.html_artifacts.pop();window.redraw();");
  for (const width of [1050, 390]) {
    win.setContentSize(width, 900);
    const metrics = await exec("new Promise(resolve=>requestAnimationFrame(()=>{const f=document.querySelector('.agent-output-html-frame iframe');const r=f.getBoundingClientRect();resolve({width:r.width,right:r.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,title:f.title,sandbox:f.getAttribute('sandbox')});}))");
    assert.ok(metrics.width > 150); assert.ok(metrics.right <= metrics.viewport); assert.equal(metrics.overflow, false); assert.equal(metrics.sandbox, 'allow-scripts'); assert.equal(metrics.title, 'Threshold explorer');
    assert.equal(await frame.executeJavaScript('document.documentElement.scrollWidth>innerWidth'), false);
    fs.writeFileSync(path.join(output, `${phase}-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  const isolation = await frame.executeJavaScript(`(async()=>{const out={bridge:typeof window.hikariApi,node:typeof require};try{parent.document.body;out.parent=true}catch{out.parent=false}try{localStorage.setItem('test','x');out.storage=true}catch{out.storage=false}try{await fetch('https://hikari-preview-test.invalid/data');out.network=true}catch{out.network=false}try{await fetch('file:///etc/hosts');out.file=true}catch{out.file=false}out.popup=window.open('https://hikari-preview-test.invalid/popup')!==null;return out;})()`);
  assert.deepEqual(isolation, { bridge: 'undefined', node: 'undefined', parent: false, storage: false, network: false, file: false, popup: false });
  assert.equal(popupCount, 0); assert.equal(requests.length, 0);
  let blocked = false;
  win.webContents.on('will-frame-navigate', event => { if (event.url.includes('/escape')) blocked = event.defaultPrevented; });
  const originalUrl = frame.url;
  await frame.executeJavaScript("location.href='http://127.0.0.1:9/escape';");
  for (let i = 0; i < 20 && !blocked; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(blocked, true, 'self navigation prevented'); assert.equal(frame.url, originalUrl); assert.equal(requests.length, 0);
  await frame.executeJavaScript("document.querySelector('#reset').click()");
  assert.equal(await frame.executeJavaScript("document.querySelector('#summary').textContent"), '3 of 4 samples meet the threshold.');
  console.log(`HTML Electron ${phase}: interaction, stable controls, desktop/narrow layout, reload, and sandbox/navigation isolation passed.`);
  win.destroy(); app.quit();
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
