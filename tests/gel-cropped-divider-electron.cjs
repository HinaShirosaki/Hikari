'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-gel-crop-divider-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL'
      });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || result.stderr || result.signal));
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2]; app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const plugin = process.env.HIKARI_GEL_TEST_PLUGIN || path.join(root, 'src/plugins/gel');
  const url = file => pathToFileURL(path.join(plugin, file)).href;
  const styles = ['vendor/cropperjs/cropper.min.css', 'vendor/css/base/palette.css', 'vendor/css/base/core.css',
    'vendor/css/themes/modes.css', 'vendor/css/views/gel-palette.css', 'vendor/css/views/gel-view.css',
    'vendor/css/overrides/left-rail-template.css', 'vendor/css/overrides/folder-tree-template.css',
    'vendor/css/overrides/universal-left-rail-lists.css', 'vendor/css/overrides/universal-dialogs.css', 'style.css', 'floating-workspace.css'];
  const markup = fs.readFileSync(path.join(plugin, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    ${styles.map(file=>`<link rel="stylesheet" href="${url(file)}">`).join('\n')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script></head>
    <body class="plugin-gel"><div>${markup}</div><script type="module">
    import {initGelAnalysis} from '${url('workspace/index.js')}';
    window.hikariApi={storeImportedFile:async data=>({ok:true,filePath:data.targetFolder+'/'+data.fileName}),writeJsonFile:async data=>({ok:true,filePath:data.targetFolder+'/'+data.fileName})};
    window.gelState={gelAnalyses:[],settings:{storagePath:'.'}};
    window.controller=initGelAnalysis({state:gelState,persist:async()=>{},createId:()=>crypto.randomUUID(),safeText:v=>String(v??''),document});controller.render();
    window.el=id=>document.getElementById(id);window.click=id=>el(id).click();
    window.loadGel=async()=>{const c=document.createElement('canvas');c.width=900;c.height=610;const ctx=c.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#555';for(let lane=0;lane<6;lane++)for(const y of [70,300])ctx.fillRect(lane*150+40,y,60,7);const blob=await new Promise(r=>c.toBlob(r));const transfer=new DataTransfer();transfer.items.add(new File([blob],'crop-divider.png',{type:'image/png'}));el('gel-image-file').files=transfer.files;el('gel-image-file').dispatchEvent(new Event('change'));};
    window.placeDividers=()=>{click('gel-tool-dividers-btn');const c=el('gel-canvas'),b=c.getBoundingClientRect();for(const fraction of [.1,.5,.9])c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.left+b.width*fraction,clientY:b.top+b.height*.25}));};
    window.strokeMeasurement=()=>{const source=el('gel-canvas'),canvas=document.querySelector('.gel-canvas-display'),b=canvas.getBoundingClientRect(),scale=canvas.width/b.width,x=(Math.round(source.width*.5)+.5)/source.width*canvas.width,y=Math.floor(canvas.height*.25),start=Math.floor(x-8*scale),size=Math.ceil(16*scale),pixels=canvas.getContext('2d').getImageData(start,y,size,1).data;let ink=0;for(let i=0;i<pixels.length;i+=4)ink+=Math.max(0,(pixels[i]-221)/34);return {source:[source.width,source.height],screen:b.toJSON(),base:source.getBoundingClientRect().toJSON(),backing:[canvas.width,canvas.height],dpr:devicePixelRatio,ink:ink/scale};};
    window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1400, height: 900, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event=>{if(event.level>=3)errors.push(event.message);});
  const exec = code=>win.webContents.executeJavaScript(code, true);
  const settle = ()=>exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function waitFor(code) {
    for(let i=0;i<150;i++){if(await exec(code))return;await new Promise(r=>setTimeout(r,25));}
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  }
  async function segmentation() {
    await exec("el('gel-form').requestSubmit()");
    await waitFor("el('gel-form').getAttribute('aria-busy')==='false'");
    return exec("gelState.gelAnalyses.find(row=>row.id===el('gel-id').value).manualOverrides.laneSegmentation");
  }
  const output = path.join(root, 'artifacts/gel-cropped-divider'); fs.mkdirSync(output, { recursive: true });
  try {
    await win.loadFile(fixture); win.focus(); await waitFor('Boolean(window.ready)');
    await exec('loadGel()'); await waitFor("!el('gel-crop-mode-btn').disabled");
    await exec("click('gel-tool-lanes-btn');placeDividers()"); await settle();
    await waitFor("Boolean(document.querySelector('.gel-canvas-display')?.checkVisibility())");
    const before = await exec('strokeMeasurement()');
    assert.deepEqual(before.source,[900,610]);
    fs.writeFileSync(path.join(output,'before.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-crop-mode-btn')");
    await waitFor("el('gel-cropper-image').cropper?.ready");
    assert.equal(await exec("document.querySelector('.gel-canvas-display').checkVisibility()"),false,'The display layer stays out of crop mode');
    await exec("el('gel-cropper-image').cropper.setData({x:0,y:0,width:180,height:122,rotate:0});click('gel-apply-crop-btn')");
    await waitFor("el('gel-canvas').width===180 && !el('gel-cropper-image').classList.contains('is-active')");
    await exec('placeDividers()'); await settle();
    const after = await exec('strokeMeasurement()');
    assert.deepEqual(after.source,[180,122],'Cropping keeps native source dimensions');
    for(const item of [before,after]){
      assert.ok(item.ink>1 && item.ink<1.5,`The divider keeps a thin screen stroke: ${item.ink}`);
      assert.ok(item.backing[0]>=item.screen.width*Math.min(4,item.dpr)-1,'Editing marks use display resolution');
      for(const key of ['left','top','width','height'])assert.ok(Math.abs(item.screen[key]-item.base[key])<.1,`Display and pointer canvas share ${key}`);
    }
    assert.ok(Math.abs(before.ink-after.ink)<.12,'A fivefold smaller crop does not enlarge the divider');
    fs.writeFileSync(path.join(output,'cropped.png'),(await win.webContents.capturePage()).toPNG());
    const original = await segmentation(); const x = original.dividers[0];
    const bounds = after.base, point={x:Math.round(bounds.left+(x+.5)/180*bounds.width+10),y:Math.round(bounds.top+bounds.height*.25)};
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseMove',x:point.x+18,y:point.y});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x+18,y:point.y});await settle();
    const moved = await segmentation();
    assert.equal(moved.dividers.length,1,'A near miss on a cropped gel still grabs the divider');
    assert.ok(Math.abs(moved.dividers[0]-(x+18/bounds.width*180))<=1,'Dragging follows source coordinates after cropping');
    await exec("el('gel-tool-dividers-btn').focus();controller.undo()");assert.deepEqual(await segmentation(),original,'Undo restores the cropped divider');
    win.setSize(900,700);await settle();
    await waitFor("(()=>{const c=el('gel-canvas'),d=document.querySelector('.gel-canvas-display');return Math.abs(c.getBoundingClientRect().width-d.getBoundingClientRect().width)<.1})()");
    const resized = await exec('strokeMeasurement()');
    assert.ok(Math.abs(resized.ink-before.ink)<.12,'Resizing keeps the divider thickness');
    fs.writeFileSync(path.join(output,'cropped-resized.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-crop-mode-btn')");await waitFor("el('gel-cropper-image').cropper?.ready");
    assert.equal(await exec("document.querySelector('.gel-canvas-display').checkVisibility()"),false);
    await exec("click('gel-cancel-crop-btn')");await settle();
    assert.equal(await exec("document.querySelector('.gel-canvas-display').checkVisibility()"),true,'Cancelling crop restores the display layer');
    await exec('controller.destroy()');assert.equal(await exec("document.querySelector('.gel-canvas-display')"),null,'Disposal removes the display layer');
    assert.equal(await exec("el('gel-canvas').style.opacity"),'','Disposal restores the source canvas');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'geometry.json'),JSON.stringify({before,after,resized},null,2));
    console.log('gel-cropped-divider-electron: passed (real crop, stable screen stroke, high-DPI alignment, source precision, drag/undo, resizing, crop mode, disposal)');
  } finally { win.destroy();app.quit(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1);});
