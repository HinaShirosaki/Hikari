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
        encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL'
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
      window.gelPointer = (type,x,y) => {
        const c=rect('gel-canvas');document.getElementById('gel-canvas').dispatchEvent(new MouseEvent(type,
          {bubbles:true,clientX:c.x+c.width*x,clientY:c.y+c.height*y,button:0}));
      };
      window.dismissMw = () => document.getElementById('gel-ladder-band-mw').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      window.qaReady = true;
    </script></body></html>`);
  const win = new BrowserWindow({width:1400,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = async code => {
    let timer;
    try {
      return await Promise.race([
        win.webContents.executeJavaScript(code, true),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Renderer timed out: ${code}`)),5000);})
      ]);
    } finally { clearTimeout(timer); }
  };
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
    win.focus();
    await waitFor('Boolean(window.qaReady)');
    await exec('loadGel()');
    await waitFor("!document.getElementById('gel-open-profile-btn').disabled");
    await exec("document.getElementById('gel-expected-lane-count').value='6';click('gel-auto-detect-lanes-btn');click('gel-tool-dividers-btn');");
    await waitFor("!document.getElementById('gel-add-table-btn').disabled");
    await settle();
    // MW entry belongs to the clicked band, with a visible mode and keyboard input.
    await exec("click('gel-tool-ladder-lane-btn');gelPointer('click',.08,.13);document.querySelector('[data-gel-tool-group=analysis]').click();click('gel-tool-ladder-mw-btn');");
    assert.equal(await exec("getComputedStyle(document.getElementById('gel-canvas')).cursor"),'crosshair');
    assert.equal(await exec("document.getElementById('gel-tool-ladder-mw-btn').getAttribute('aria-pressed')"),'true');
    await exec("gelPointer('click',.28,.13)");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Other lanes do not accept MW labels');
    await exec("gelPointer('click',.08,.13)");
    assert.equal(await exec("document.activeElement.id"),'gel-ladder-band-mw');
    assert.equal(await exec("document.getElementById('gel-ladder-band-mw').value"),'');
    const mwBox=await exec("rect('gel-ladder-mw-editor')");
    assert.ok(mwBox.width<=100&&mwBox.height<=36,'MW entry is a single compact field');
    await exec("document.getElementById('gel-ladder-band-mw').value='75'");
    await new Promise(resolve=>setTimeout(resolve,180));
    fs.writeFileSync(path.join(output,'ladder-mw.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'ENTER'});
    win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'ENTER'});
    await settle();
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Enter submits MW');
    await exec("gelPointer('mousedown',.08,.13);gelPointer('mouseup',.08,.13);gelPointer('click',.08,.13)");
    assert.equal(await exec("document.getElementById('gel-ladder-band-mw').value"),'75','Clicking an existing band edits its MW');
    await exec("document.getElementById('gel-ladder-band-mw').value='0';document.getElementById('gel-ladder-mw-editor').requestSubmit()");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),false,'Nonpositive MW is rejected');
    await exec("document.getElementById('gel-ladder-band-mw').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Escape cancels entry');
    assert.equal(await exec("document.getElementById('gel-tools-window').hidden"),false,'Escape leaves Gel Tools open');
    await exec("gelPointer('click',.08,.13);document.getElementById('gel-ladder-band-mw').value='80.5';document.getElementById('gel-ladder-band-mw').dispatchEvent(new Event('input'));document.getElementById('gel-ladder-mw-editor').requestSubmit();gelPointer('click',.08,.13)");
    assert.equal(await exec("document.getElementById('gel-ladder-band-mw').value"),'80.5');
    await exec('controller.undo()');
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Undo dismisses stale entry');
    await exec("gelPointer('click',.08,.13)");
    assert.equal(await exec("document.getElementById('gel-ladder-band-mw').value"),'75','Undo restores MW');
    await exec("dismissMw();gelPointer('mousedown',.08,.13);gelPointer('mousemove',.08,.17);gelPointer('mouseup',.08,.17);gelPointer('click',.08,.17)");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Dragging a label does not open entry');
    await exec("gelPointer('click',.08,.17)");
    assert.equal(await exec("document.getElementById('gel-ladder-band-mw').value"),'75','Dragging preserves MW at the new row');
    await exec("click('gel-tool-ladder-mw-btn');gelPointer('click',.08,.17)");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Turning Set MW off disables entry');
    assert.notEqual(await exec("getComputedStyle(document.getElementById('gel-canvas')).cursor"),'crosshair');
    await exec("click('gel-tool-ladder-mw-btn');gelPointer('click',.08,.17);document.getElementById('gel-viewer-stage').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-ladder-mw-editor').hidden"),true,'Clicking outside cancels entry');
    await exec("gelPointer('click',.08,.98);document.body.classList.add('theme-night')");
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'ladder-mw-night.png'),(await win.webContents.capturePage()).toPNG());
    await exec("dismissMw();click('gel-tool-ladder-mw-btn');document.body.classList.remove('theme-night')");
    const baseline = await exec("rect('gel-canvas')");
    await exec("click('gel-open-profile-btn')");
    await settle();
    sameRect(baseline,await exec("rect('gel-canvas')"),'Opening Lane Intensity');
    await exec("click('gel-open-lane-table-btn');click('gel-add-table-btn')");
    await settle();
    async function checkDock() {
      const dock=await exec(`(()=>{const panel=document.getElementById('gel-lane-table-panel'),canvas=rect('gel-canvas'),grid=document.querySelector('.gel-lane-table-grid-shell').getBoundingClientRect(),layer=document.querySelector('.gel-floating-layer').getBoundingClientRect();return {panel:panel.getBoundingClientRect().toJSON(),canvas,grid:grid.toJSON(),layer:layer.toJSON(),floating:Boolean(panel.closest('[data-gel-window],.gel-floating-layer')),hidden:panel.hidden}})()`);
      assert.equal(dock.hidden,false,'The lane table dock is visible');
      assert.equal(dock.floating,false,'The lane table stays outside floating windows');
      assert.ok(dock.panel.top>=dock.canvas.bottom+8,'The lane table sits below the gel');
      assert.ok(Math.abs(dock.grid.left-dock.canvas.left)<2&&Math.abs(dock.grid.width-dock.canvas.width)<2,`Table columns share the image position and width: ${JSON.stringify(dock)}`);
      assert.ok(dock.layer.bottom<=dock.panel.top,'Floating windows stay above the table');
    }
    await checkDock();
    await exec("document.querySelector('[data-gel-table-add-row]').click();document.querySelector('[data-gel-table-role=label]').value='Label';document.querySelector('[data-gel-table-role=label]').dispatchEvent(new Event('input',{bubbles:true}));");
    await settle();
    await checkDock();
    const dockedBaseline=await exec("rect('gel-canvas')");
    await exec("document.querySelector('[data-gel-window-close=profile]').click();click('gel-process-image-btn');");
    assert.equal(await exec("document.getElementById('gel-lane-profile-panel').hidden"),true,'Rendering must not reopen a dismissed profile');
    await exec("click('gel-open-peak-editor-btn')");
    await settle();
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),false);
    assert.equal(await exec("document.querySelector('.gel-peak-editor-dialog').getAttribute('aria-modal')"),'false');
    sameRect(dockedBaseline,await exec("rect('gel-canvas')"),'Opening peak editor');
    await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),true);
    assert.equal(await exec("document.getElementById('gel-lane-table-panel').hidden"),false,'Escape leaves the docked table visible');
    await exec("click('gel-hide-windows-btn')");
    assert.equal(await exec("document.getElementById('gel-lane-table-panel').hidden"),false,'Hide windows leaves the docked table visible');
    await exec("click('gel-close-lane-table-btn')");
    await settle();
    assert.equal(await exec("document.getElementById('gel-lane-table-panel').hidden"),true);
    assert.ok((await exec("rect('gel-canvas')")).height>dockedBaseline.height,'Hiding the table returns its space to the image');
    await exec("click('gel-open-lane-table-btn')");
    await settle();
    await checkDock();
    assert.equal(await exec("document.querySelector('[data-gel-table-role=label]').value"),'Label','Hiding and reopening preserves table edits');
    fs.writeFileSync(path.join(output,'lane-table-docked.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.add('theme-night')");
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'lane-table-docked-night.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.remove('theme-night');for(let row=0;row<8;row++)document.querySelector('[data-gel-table-add-row]').click()");
    await settle();
    await checkDock();
    assert.ok(await exec("(()=>{const body=document.querySelector('.gel-lane-table-body');return body.scrollHeight>body.clientHeight})()"),'Long tables scroll inside the dock');
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
      await checkDock();
      sizes.windows.forEach(rect=>{assert.ok(rect.left>=sizes.layer.left-1&&rect.right<=sizes.layer.right+1,'Window fits width');assert.ok(rect.top>=sizes.layer.top-1&&rect.bottom<=sizes.layer.bottom+1,'Window fits height');});
      await exec("document.querySelector('[data-gel-tool-group=analysis]').click();click('gel-tool-ladder-mw-btn');gelPointer('click',.08,.98)");
      const entry=await exec("({box:rect('gel-ladder-mw-editor'),width:innerWidth,height:innerHeight,hidden:document.getElementById('gel-ladder-mw-editor').hidden})");
      assert.equal(entry.hidden,false,`MW box opens at ${width}×${height}`);
      assert.ok(entry.box.left>=8&&entry.box.right<=entry.width-7&&entry.box.top>=8&&entry.box.bottom<=entry.height-7,`MW box fits ${width}×${height}`);
      await exec("dismissMw();click('gel-tool-ladder-mw-btn')");
    }
    win.setSize(1400,900);await settle();
    const beforeCrop=await exec("rect('gel-canvas')");
    await exec("click('gel-hide-windows-btn');click('gel-crop-mode-btn')");
    await waitFor("Boolean(document.querySelector('.cropper-container'))");
    await waitFor("document.querySelector('.cropper-view-box')?.getBoundingClientRect().width > 100");
    await settle();
    fs.writeFileSync(path.join(output,'crop.png'),(await win.webContents.capturePage()).toPNG());
    const cropRect=()=>exec("document.querySelector('.cropper-crop-box').getBoundingClientRect().toJSON()");
    const fullCrop=await cropRect();
    async function dragCropTarget(selector,dx,dy) {
      const target=await exec(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
      const origin={x:Math.round(target.x+target.width/2),y:Math.round(target.y+target.height/2)};
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...origin});
      win.webContents.sendInputEvent({type:'mouseMove',x:origin.x+dx,y:origin.y+dy});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:origin.x+dx,y:origin.y+dy});
      await settle();
    }
    await dragCropTarget('.cropper-line.line-e',-70,0);
    const edgeCrop=await cropRect();
    assert.ok(edgeCrop.width<fullCrop.width-50,'The transparent edge target still resizes the crop');
    await dragCropTarget('.cropper-point.point-nw',35,35);
    const cornerCrop=await cropRect();
    assert.ok(cornerCrop.left>edgeCrop.left+20&&cornerCrop.top>edgeCrop.top+20,'The corner target still resizes both axes');
    fs.writeFileSync(path.join(output,'crop-selection.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.add('theme-night')");
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'crop-selection-night.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.remove('theme-night')");
    await exec("click('gel-crop-mode-btn')");
    await settle();
    sameRect(beforeCrop,await exec("rect('gel-canvas')"),'Cancelling crop');
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
    console.log('gel-floating-workspace-electron: passed (MW entry/edit/drag, cursor, Enter/Escape, validation, undo, popup bounds at 4 viewport sizes, light/dark, image import, table editing, windows, crop, disposal)');
  } finally { win.destroy();app.quit(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1);});
