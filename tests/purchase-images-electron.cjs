'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-purchase-images-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 60000
      });
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Purchase image QA failed (${result.signal || result.status})`));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return;
  }

  const { app, BrowserWindow, session } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = source.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)[0];
  const fixture = path.join(temp, 'chat.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">${csp}
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0;padding:16px}#history{max-width:700px;margin:auto}</style>
    </head><body><main id="history"></main></body></html>`);

  const requests = [];
  const productImage = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><rect width="360" height="360" fill="white"/><rect x="144" y="48" width="72" height="35" rx="3" fill="#677484"/><rect x="125" y="83" width="110" height="228" rx="12" fill="#dce8ef" stroke="#677484" stroke-width="3"/><rect x="131" y="154" width="98" height="93" fill="#167d8d"/><text x="180" y="191" font-size="16" text-anchor="middle" fill="white">LAB</text><text x="180" y="219" font-size="16" text-anchor="middle" fill="white">REAGENT</text></svg>';
  const handle = request => {
    requests.push({ url: request.url, referrer: request.headers.get('referer') });
    assert.ok(['vendor-product.test', 'cdn.vendor-product.test'].includes(new URL(request.url).hostname));
    return new Response(productImage, { headers: { 'content-type': 'image/svg+xml' } });
  };
  session.defaultSession.protocol.handle('http', handle);
  session.defaultSession.protocol.handle('https', handle);
  const win = new BrowserWindow({ width: 1050, height: 900, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true
  } });
  const exec = code => win.webContents.executeJavaScript(code);
  const message = {
    id: 'purchase', role: 'assistant',
    text: 'Vendor product images:\n\n![Lab reagent](https://cdn.vendor-product.test/reagent.svg?size=360&view=front)\n\n![HTTP vendor image](http://vendor-product.test/reagent.svg)\n\n[Vendor product page](https://vendor-product.test/reagent)',
    meta: { purchase_recommendation: { items: [{
      title: 'Lab reagent', vendor: 'Lab vendor', price_text: '$25',
      image_url: 'https://cdn.vendor-product.test/card.svg',
      product_url: 'https://vendor-product.test/reagent'
    }] } }
  };
  async function render(live = false) {
    const payload = JSON.parse(JSON.stringify(message));
    if (live) payload.meta.live_progress = { response_text: payload.text, activity_rows: [] };
    await exec(`(async()=>{
      const {renderHistory}=await import(${JSON.stringify(url('src/renderer/modules/agent-chat/rendering.js'))});
      renderHistory({historyNode:document.querySelector('#history'),messages:[${JSON.stringify(payload)}],state:{},
        safeText:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
    })()`);
    const loaded = await exec(`Promise.all([...document.querySelectorAll('#history img')].map(img=>
      img.decode().then(()=>({width:img.naturalWidth,height:img.naturalHeight,src:img.currentSrc}))))`);
    assert.equal(loaded.length, live ? 2 : 3);
    assert.ok(loaded.every(image => image.width === 360 && image.height === 360));
  }
  try {
    await win.loadFile(fixture);
    await render(true);
    await render();
    assert.equal(await exec("document.querySelector('.agent-purchase-item').dataset.agentOpenExternalUrl"), message.meta.purchase_recommendation.items[0].product_url);
    await new Promise(resolve => {
      win.webContents.once('did-finish-load', resolve);
      win.reload();
    });
    await render();
    for (const width of [1050, 390]) {
      win.setContentSize(width, 900);
      const metrics = await exec(`new Promise(resolve=>requestAnimationFrame(()=>{
        const images=[...document.querySelectorAll('#history img')];
        resolve({overflow:document.documentElement.scrollWidth>innerWidth,
          visible:images.every(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.right<=innerWidth;})});
      }))`);
      assert.equal(metrics.visible, true, 'product images fit the chat at desktop and narrow widths');
      assert.equal(metrics.overflow, false);
      const output = path.join(root, 'artifacts/purchase-images');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, `${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.ok(requests.some(request => request.url.startsWith('http:')));
    assert.ok(requests.some(request => request.url.startsWith('https:')));
    assert.ok(requests.every(request => !request.referrer));
    const requestCount = requests.length;
    const violations = await exec(`(async()=>{
      const blocked=[];document.addEventListener('securitypolicyviolation',e=>blocked.push(e.effectiveDirective));
      const script=document.createElement('script');script.src='https://vendor-product.test/script.js';document.body.append(script);
      await fetch('https://vendor-product.test/data').catch(()=>{});
      await new Promise(r=>setTimeout(r,50));return blocked;
    })()`);
    assert.ok(violations.includes('script-src-elem'));
    assert.ok(violations.includes('connect-src'));
    assert.equal(requests.length, requestCount);
    console.log('Purchase images Electron: HTTP(S) vendor/CDN images decoded in cards, live/final Codex Markdown, and reloaded history; desktop/narrow layout and script/fetch restrictions passed.');
  } finally {
    win.destroy();
    app.quit();
  }
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
