'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-image-qa-'));
    try {
      for (const phase of ['live', 'restart']) {
        const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp, phase], { encoding: 'utf8', timeout: 60000 });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        assert.equal(result.status, 0, String(result.error || `Electron ${phase} failed`));
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const [storagePath, phase] = process.argv.slice(2);
  app.setPath('userData', path.join(storagePath, 'profile'));
  await app.whenReady();
  const output = path.join(root, 'artifacts/image-output');
  fs.mkdirSync(output, { recursive: true });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const html = path.join(storagePath, 'qa.html');
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><style>body{display:block;margin:0;padding:1rem;background:var(--theme-surface)}#history{max-width:52rem;margin:auto}.agent-chat-row{width:100%}</style></head><body><main id="history"></main></body></html>`);
  const win = new BrowserWindow({ width: 1050, height: 830, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadFile(html);
  const exec = code => win.webContents.executeJavaScript(code);
  const chat = require('../src/main/agent/context/agent-chat-log').createAgentChatLogRuntime();
  let message;
  if (phase === 'live') {
    const dataUrl = await exec(`(()=>{const c=document.createElement('canvas');c.width=1000;c.height=600;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1000,600);x.fillStyle='#253c50';x.font='bold 30px sans-serif';x.fillText('Dose response · demonstration data',70,55);x.strokeStyle='#8b9ca7';x.lineWidth=2;x.beginPath();x.moveTo(100,100);x.lineTo(100,490);x.lineTo(940,490);x.stroke();x.font='20px sans-serif';x.fillText('Concentration (µM)',420,555);x.fillText('Response',15,92);for(let i=0;i<6;i++)x.fillText(String(i*2),95+i*164,522);x.strokeStyle='#527ee6';x.lineWidth=5;x.beginPath();for(let i=0;i<100;i++){const a=100+i*8.2,b=465-330/(1+Math.exp(-(i-36)/10));if(i===0)x.moveTo(a,b);else x.lineTo(a,b);}x.stroke();return c.toDataURL('image/png');})()`);
    fs.writeFileSync(path.join(storagePath, 'response.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    const result = await require('../src/main/agent/mcp-contract/gateway').createAgentMcpGateway({ storagePath }).callGatewayTool('image_output', {
      path: 'response.png', title: 'Dose response', alt: 'Demonstration curve rises and plateaus near 8 micromolar.', caption: 'Demonstration data for image display verification.'
    });
    assert.equal(result.ok, true);
    const session = await chat.createSession({ storagePath, title: 'Image output QA' });
    fs.writeFileSync(path.join(storagePath, 'session.json'), JSON.stringify(session.session));
    message = { id: 'image-result', role: 'assistant', text: 'The response rises with concentration and reaches a plateau.', createdAt: new Date().toISOString(), meta: { image_artifacts: [result.image_artifact] } };
    await chat.appendRows(storagePath, session.session.id, [{ type: 'assistant-message', session_id: session.session.id, message_id: message.id, timestamp: message.createdAt, text: message.text, meta: message.meta }]);
    fs.unlinkSync(path.join(storagePath, 'response.png'));
    message.meta.live_progress = { response_text: message.text, activity_rows: [] };
  } else {
    const session = JSON.parse(fs.readFileSync(path.join(storagePath, 'session.json')));
    const restored = await chat.getSession({ storagePath, sessionId: session.id });
    message = restored.messages[0];
    assert.equal(message.meta.image_artifacts.length, 1);
  }
  await exec(`(async()=>{const {renderHistory}=await import(${JSON.stringify(url('src/renderer/modules/agent-chat/rendering.js'))});renderHistory({historyNode:document.querySelector('#history'),messages:[${JSON.stringify(message)}],state:{},safeText:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});await Promise.all([...document.images].map(img=>img.decode()));})()`);
  for (const width of [1050, 390]) {
    win.setContentSize(width, 830);
    const metrics = await exec(`new Promise(resolve=>requestAnimationFrame(()=>{const img=document.querySelector('.agent-output-image img');const r=img.getBoundingClientRect();resolve({loaded:img.complete&&img.naturalWidth===1000,width:r.width,right:r.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth});}))`);
    assert.equal(metrics.loaded, true);
    assert.ok(metrics.width > 150);
    assert.ok(metrics.right <= metrics.viewport);
    assert.equal(metrics.overflow, false);
    fs.writeFileSync(path.join(output, `${phase}-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  console.log(`Image Electron ${phase}: decoded, fit desktop and narrow rail widths, source file absent.`);
  win.destroy();
  app.quit();
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
