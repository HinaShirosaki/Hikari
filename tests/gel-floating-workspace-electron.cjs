'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-gel-windows-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 90000
      });
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Gel window QA failed (${result.signal || result.status})`));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const dir = 'src/plugins/gel/';
  const url = file => pathToFileURL(path.join(root, dir, file)).href;
  const output = path.join(root, 'artifacts/gel-floating-workspace');
  fs.mkdirSync(output, { recursive: true });
  const fixture = path.join(temp, 'index.html');
  const styles = ['vendor/cropperjs/cropper.min.css', 'vendor/tabulator/tabulator.min.css',
    'vendor/css/base/palette.css', 'vendor/css/base/core.css', 'vendor/css/themes/modes.css',
    'vendor/css/views/gel-palette.css', 'vendor/css/views/gel-view.css',
    'vendor/css/overrides/cross-view-fixes.css', 'vendor/css/overrides/left-rail-template.css',
    'vendor/css/overrides/universal-dialogs.css', 'style.css', 'floating-workspace.css'];
  const markup = fs.readFileSync(path.join(root, dir, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    ${styles.map(file => `<link rel="stylesheet" href="${url(file)}">`).join('\n')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    </head><body class="plugin-gel"><div id="gel-host">${markup}</div>
    <script type="module">
      import { initGelAnalysis } from '${url('workspace/index.js')}';
      window.controller = initGelAnalysis({state:{gelAnalyses:[]},persist:async()=>{},createId:()=>crypto.randomUUID(),
        safeText:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),document});
      controller.render();
      window.loadGel = async () => {
        const canvas=document.createElement('canvas');canvas.width=900;canvas.height=610;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,900,610);
        for(let lane=0;lane<6;lane++)for(const y of (lane===0?[80,135,190,240,310,365,420,480,545]:[195,365])){
          ctx.fillStyle=lane===0||y===365?'#222':'#aaa';ctx.fillRect(lane*150+35,y,80,14);
        }
        const blob=await new Promise(resolve=>canvas.toBlob(resolve));const transfer=new DataTransfer();
        transfer.items.add(new File([blob],'gel-window-test.png',{type:'image/png'}));
        const input=document.getElementById('gel-image-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));
      };
      window.click = id=>document.getElementById(id).click();
      window.rect = id=>document.getElementById(id).getBoundingClientRect().toJSON();
      window.qaReady = true;
    </script></body></html>`);
  const win = new BrowserWindow({width:1400,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  const settle = () => exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function waitFor(code) {
    for (let i=0;i<100;i++) {
      if(await exec(code)) return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  }
  function sameRect(a,b,label) {
    for(const key of ['x','y','width','height']) assert.ok(Math.abs(a[key]-b[key])<1, `${label}: ${key}: ${a[key]} → ${b[key]}`);
  }
  try {
    await win.loadFile(fixture);
    await waitFor('Boolean(window.qaReady)');
    await exec('loadGel()');
    await waitFor("!document.getElementById('gel-open-profile-btn').disabled");
    await exec("document.getElementById('gel-expected-lane-count').value='6';click('gel-auto-detect-lanes-btn');click('gel-tool-dividers-btn');");
    await waitFor("!document.getElementById('gel-add-table-btn').disabled");
    await settle();
    const baseline = await exec("rect('gel-canvas')");
    await exec("click('gel-open-profile-btn');click('gel-open-lane-table-btn');click('gel-add-table-btn');");
    await settle();
    sameRect(baseline,await exec("rect('gel-canvas')"),'Opening windows and adding a table');
    assert.equal(await exec("document.getElementById('gel-lane-table-shell').closest('[data-gel-window]').dataset.gelWindow"),'table');
    await exec("document.querySelector('[data-gel-table-add-row]').click();document.querySelector('[data-gel-table-role=label]').value='Label';document.querySelector('[data-gel-table-role=label]').dispatchEvent(new Event('input',{bubbles:true}));");
    await settle();
    sameRect(baseline,await exec("rect('gel-canvas')"),'Adding another table row');
    await exec("document.querySelector('[data-gel-window-close=profile]').click();click('gel-process-image-btn');");
    assert.equal(await exec("document.getElementById('gel-lane-profile-panel').hidden"),true,'Rendering must not reopen a dismissed profile');
    await exec("click('gel-open-peak-editor-btn')");
    await settle();
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),false);
    assert.equal(await exec("document.querySelector('.gel-peak-editor-dialog').getAttribute('aria-modal')"),'false');
    sameRect(baseline,await exec("rect('gel-canvas')"),'Opening peak editor');
    await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),true);
    assert.equal(await exec("document.getElementById('gel-lane-table-window').hidden"),false,'Escape closes only the top window');
    await exec("click('gel-hide-windows-btn')");
    await exec("click('gel-open-tools-btn');document.querySelector('[data-gel-tool-group=band]').click();click('gel-tool-band-top-btn');const c=rect('gel-canvas');document.getElementById('gel-canvas').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:c.x+c.width*.4,clientY:c.y+c.height*.55}));click('gel-tool-band-bottom-btn');document.getElementById('gel-canvas').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:c.x+c.width*.4,clientY:c.y+c.height*.66}));");
    await waitFor("!document.getElementById('gel-open-cell-table-btn').disabled");
    await exec("click('gel-open-cell-table-btn')");
    assert.ok(await exec("document.querySelectorAll('#gel-cell-table-host tbody tr').length") > 0);
    await exec("click('gel-hide-windows-btn')");
    assert.equal(await exec("[...document.querySelectorAll('[data-gel-window]')].every(e=>e.hidden)"),true);
    await exec("click('gel-open-tools-btn')");
    const toolBefore = await exec("rect('gel-tools-window')");
    await exec("const h=document.querySelector('#gel-tools-window [data-gel-window-handle]');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));");
    assert.ok((await exec("rect('gel-tools-window')")).x < toolBefore.x,'Keyboard moves the floating window');
    const handle = await exec("document.querySelector('#gel-tools-window [data-gel-window-handle]').getBoundingClientRect().toJSON()");
    const start = { x:Math.round(handle.x+45), y:Math.round(handle.y+18) };
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});
    win.webContents.sendInputEvent({type:'mouseMove',x:start.x-65,y:start.y+40});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:start.x-65,y:start.y+40});
    await settle();
    const dragged = await exec("rect('gel-tools-window')");
    assert.ok(dragged.x<handle.x-50&&dragged.y>handle.y+30,'Pointer dragging moves the window without editing the gel');
    await exec("click('gel-open-profile-btn')");
    await settle();
    fs.writeFileSync(path.join(output,'workspace.png'),(await win.webContents.capturePage()).toPNG());
    for (const [width,height] of [[1400,900],[1024,768],[800,700],[600,800]]) {
      win.setSize(width,height);
      await settle();
      const sizes=await exec(`(()=>{const main=document.querySelector('.gel-main'),canvas=rect('gel-canvas'),stage=rect('gel-viewer-stage'),layer=document.querySelector('.gel-floating-layer').getBoundingClientRect();return {client:main.clientHeight,scroll:main.scrollHeight,canvas,stage,layer:layer.toJSON(),windows:[...document.querySelectorAll('[data-gel-window]')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect().toJSON())}})()`);
      assert.ok(sizes.scroll<=sizes.client+1,`No main scrolling at ${width}×${height}`);
      assert.ok(sizes.canvas.bottom<=sizes.stage.bottom+1,'Gel fits stage height');
      sizes.windows.forEach(rect=>{assert.ok(rect.left>=sizes.layer.left-1&&rect.right<=sizes.layer.right+1,'Window fits width');assert.ok(rect.top>=sizes.layer.top-1&&rect.bottom<=sizes.layer.bottom+1,'Window fits height');});
    }
    win.setSize(1400,900);await settle();
    await exec("click('gel-hide-windows-btn');click('gel-crop-mode-btn')");
    await waitFor("Boolean(document.querySelector('.cropper-container'))");
    await exec("click('gel-crop-mode-btn')");
    await exec("document.body.classList.add('theme-night');click('gel-open-peak-editor-btn')");
    await settle();
    await exec("const chart=document.getElementById('gel-peak-editor-chart');const bounds=chart.getBoundingClientRect();for(const fraction of [.48,.75])chart.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.x+bounds.width*fraction,clientY:bounds.y+bounds.height*.8}));");
    await settle();
    assert.ok(await exec("document.querySelectorAll('#gel-peak-editor-table .tabulator-row').length")>0,'Peak editing produces integration rows in the floating window');
    // Theme colors animate in the shared styles; inspect the settled appearance.
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'peak-editor-night.png'),(await win.webContents.capturePage()).toPNG());
    await exec('controller.destroy()');
    assert.equal(await exec("document.querySelector('.gel-floating-layer')"),null);
    assert.deepEqual(errors,[]);
    console.log('gel-floating-workspace-electron: passed (image import, lanes/bands, table editing, windows, keyboard, crop, 4 viewport sizes, light/dark, disposal)');
  } finally { win.destroy();app.quit(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1);});
