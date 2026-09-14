'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const packageRoot = path.join(root, 'out/Hikari-darwin-arm64/Hikari.app/Contents/Resources/app.asar');

async function main() {
  const { app, BrowserWindow, protocol, ipcMain } = require('electron');
  const previews = require(path.join(packageRoot, 'src/main/agent/html-output/preview-service.js'));
  previews.registerHtmlPreviewScheme(protocol);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-rendering-demos-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  let win;
  previews.installHtmlPreviewService({ protocol, ipcMain, getMainWindow: () => win });
  const url = file => pathToFileURL(path.join(packageRoot, file)).href;
  const sourceView = fs.readFileSync(path.join(root, 'ui/html/views/agent-view.html'), 'utf8').trim();
  assert.ok(fs.readFileSync(path.join(packageRoot, 'index.html'), 'utf8').includes(sourceView), 'Packaged view is current.');
  for (const file of ['styles.css', 'src/renderer/modules/agent-chat/rendering.js', 'src/renderer/modules/agent-chat/shell-controller.js', 'src/renderer/modules/agent-chat/rendering-drafts.js']) {
    assert.equal(fs.readFileSync(path.join(packageRoot, file), 'utf8'), fs.readFileSync(path.join(root, file), 'utf8'), 'Package parity: ' + file);
  }
  const fixture = path.join(scratch, 'demo.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><style>
    body{display:block;margin:0;height:100vh;padding:0;overflow:hidden;background:var(--theme-surface)}
    #agent-view{height:100vh}.agent-review-overlay[hidden]{display:none!important}
  </style></head><body class="ui-neutral-compact theme-day">${sourceView.replace('class="view"', 'class="view is-active"')}</body></html>`);
  win = new BrowserWindow({ width: 1280, height: 1000, show: false, webPreferences: { preload: path.join(packageRoot, 'src/main/preload.js'), contextIsolation: true, sandbox: false } });
  previews.guardHtmlPreviewNavigation(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadFile(fixture);
  const run = code => win.webContents.executeJavaScript(code);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'demos.json')));
  const chat = require(path.join(packageRoot, 'src/main/agent/context/agent-chat-log.js')).createAgentChatLogRuntime();
  const sessions = [];
  for (const demo of manifest.demos) sessions.push(await chat.getSession({ storagePath: manifest.storagePath, sessionId: demo.id }));
  await run(`(async()=>{
    const base=${JSON.stringify(url('src/renderer/modules/'))};
    const {createAgentChatShellController}=await import(base+'agent-chat/shell-controller.js');
    const {createAgentChatSessionManager}=await import(base+'agent-chat/session-manager.js');
    const {collectAgentChatDom}=await import(base+'agent-chat/dom-bindings.js');
    const {createNotebookDraftAgentAdapter}=await import(base+'biology-notebook/agent/notebook-drafts.js');
    const {createProtocolAgentAdapter}=await import(base+'protocol/agent/generated-protocols.js');
    window.saved=${JSON.stringify(sessions)};
    window.state={settings:{storagePath:${JSON.stringify(manifest.storagePath)},agent:{}},projects:[],protocols:[],notebookEntries:[],agentChat:{sessions:saved.map(s=>s.session),messages:[],currentSessionId:''}};
    const safeText=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    window.dom=collectAgentChatDom(document);
    window.shell=createAgentChatShellController({dom,state,runtime:{inFlight:false},safeText,persist:()=>{},notebookDraftAdapter:createNotebookDraftAgentAdapter({state}),protocolReviewAdapter:createProtocolAgentAdapter({state})});
    const manager=createAgentChatSessionManager({api:{},state,persist:()=>{},safeText,...dom,ensureAgentState:shell.ensureAgentState,getStoragePath:()=>state.settings.storagePath,renderProjectOptions:shell.renderProjectOptions,renderContextSummary:()=>{},renderHistory:shell.renderHistoryView,setStatus:()=>{},setSessionStatus:()=>{}});
    dom.sessionStatus.textContent='';
    dom.historyNode.addEventListener('scroll',shell.updateScrollToBottomButton);
    window.showDemo=index=>{state.agentChat.currentSessionId=saved[index].session.id;state.agentChat.messages=saved[index].messages;shell.renderProjectOptions();shell.renderScopedComposer();manager.renderSessionList();shell.renderHistoryView();shell.syncComposerHeight();dom.historyNode.scrollTop=0;shell.updateScrollToBottomButton();};
  })()`);
  const checks = [];
  for (let index = 0; index < sessions.length; index++) {
    await run(`showDemo(${index});`);
    if ([1, 2].includes(index)) await run("document.querySelector('.agent-draft-card').open=true;");
    if (index === 0) await run("document.querySelector('.agent-thinking-trace').open=true;");
    if (index === 3) {
      let frame;
      for (let attempt = 0; attempt < 100; attempt++) {
        frame = win.webContents.mainFrame.frames.find(f => f.url.startsWith('hikari-html:'));
        if (frame && await frame.executeJavaScript("Boolean(document.querySelector('#summary'))").catch(() => false)) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.ok(frame);
      await frame.executeJavaScript("document.querySelector('#threshold').value='0.8';document.querySelector('#threshold').dispatchEvent(new Event('input'));");
      await run("document.querySelector('.agent-output-html').open=false;shell.renderHistoryView();document.querySelector('.agent-output-html').open=true;");
      assert.equal(await frame.executeJavaScript("document.querySelector('#summary').textContent"), '1 of 4 samples meet the threshold.');
      await frame.executeJavaScript("document.querySelector('#reset').click()");
    }
    const metrics = await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const h=dom.historyNode.getBoundingClientRect(), c=document.querySelector('.agent-composer-card').getBoundingClientRect();
      resolve({rows:document.querySelectorAll('.agent-chat-row').length,cards:document.querySelectorAll('.agent-draft-card').length,question:!dom.questionDock.hidden,error:!!document.querySelector('.agent-chat-item.is-error'),overflow:document.documentElement.scrollWidth>innerWidth,composerOverlap:h.bottom>c.top+1,sidebar:document.querySelectorAll('[data-session-id]').length});
    })))`);
    assert.equal(metrics.rows, 2);
    assert.equal(metrics.sidebar, 6);
    assert.equal(metrics.overflow, false);
    assert.equal(metrics.composerOverlap, false);
    if ([1, 2].includes(index)) assert.equal(metrics.cards, 1);
    if (index === 4) assert.equal(metrics.question, true);
    if (index === 5) assert.equal(metrics.error, true);
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(__dirname, 'demo-' + (index + 1) + '.png'), (await win.webContents.capturePage()).toPNG());
    if ([1, 2].includes(index)) {
      await run('dom.historyNode.scrollTop=dom.historyNode.scrollHeight;shell.updateScrollToBottomButton();');
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.writeFileSync(path.join(__dirname, 'demo-' + (index + 1) + '-actions.png'), (await win.webContents.capturePage()).toPNG());
    }
    checks.push({ title: manifest.demos[index].title, ...metrics });
    console.log('Packaged demo verified: ' + manifest.demos[index].title);
  }
  fs.writeFileSync(path.join(__dirname, 'packaged-demo-verification.json'), JSON.stringify({ packageRoot, checks, approvalsPerformed: 0, providerCalls: 0 }, null, 2) + '\n');
  win.destroy();
  fs.rmSync(scratch, { recursive: true, force: true });
  app.quit();
}
main().catch(error => { console.error(error); require('electron').app.exit(1); });
