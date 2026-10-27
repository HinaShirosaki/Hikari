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
  const pluginRoot = process.env.HIKARI_GEL_TEST_PLUGIN || path.join(root, 'src/plugins/gel');
  const url = file => pathToFileURL(path.join(pluginRoot, file)).href;
  const output = path.join(root, 'artifacts/gel-floating-workspace');
  fs.mkdirSync(output, { recursive: true });
  const fixture = path.join(temp, 'index.html');
  const styles = ['vendor/cropperjs/cropper.min.css', 'vendor/tabulator/tabulator.min.css',
    'vendor/css/base/palette.css', 'vendor/css/base/core.css', 'vendor/css/themes/modes.css',
    'vendor/css/views/gel-palette.css', 'vendor/css/views/gel-view.css',
    'vendor/css/overrides/cross-view-fixes.css', 'vendor/css/overrides/left-rail-template.css',
    'vendor/css/overrides/folder-tree-template.css', 'vendor/css/overrides/universal-left-rail-lists.css',
    'vendor/css/overrides/universal-dialogs.css', 'style.css', 'floating-workspace.css'];
  const markup = fs.readFileSync(path.join(pluginRoot, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    ${styles.map(file => `<link rel="stylesheet" href="${url(file)}">`).join('\n')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    </head><body class="plugin-gel"><div id="gel-host">${markup}</div>
    <script type="module">
      import { initGelAnalysis } from '${url('workspace/index.js')}';
      window.hikariApi={
        storeImportedFile:async data=>({ok:true,filePath:data.targetFolder+'/'+data.fileName,relativePath:data.targetFolder+'/'+data.fileName}),
        writeJsonFile:async data=>({ok:true,filePath:data.targetFolder+'/'+data.fileName,relativePath:data.targetFolder+'/'+data.fileName})
      };
      window.gelState = {gelAnalyses:[],settings:{storagePath:'.'}};
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.qaCopiedText=text}}});
      window.controller = initGelAnalysis({state:gelState,persist:async()=>{},createId:()=>crypto.randomUUID(),
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
      window.dividerContext = (x,y=.5,offset=0) => {
        const c=rect('gel-canvas');const event=new MouseEvent('contextmenu',{
          bubbles:true,cancelable:true,button:2,clientX:c.left+(x+.5)/900*c.width+offset,clientY:c.top+c.height*y
        });document.getElementById('gel-canvas').dispatchEvent(event);return event.defaultPrevented;
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
    } catch (error) { throw new Error(`${error.message}\nRenderer script: ${code}\n${errors.join('\n')}`, { cause: error }); }
    finally { clearTimeout(timer); }
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
    await waitFor("!document.getElementById('gel-crop-mode-btn').disabled");
    await exec("click('gel-tool-results-btn')");
    await settle();
    const emptyResults=await exec("({chart:document.getElementById('gel-lane-profile-chart').checkVisibility(),hint:document.getElementById('gel-lane-profile-empty').checkVisibility(),height:rect('gel-tools-panel').height})");
    assert.equal(emptyResults.chart,false,'An unmeasured lane profile does not show a large empty chart');
    assert.equal(emptyResults.hint,true,'Results shows a compact next-step prompt');
    assert.ok(emptyResults.height<300,'The empty Results card stays compact');
    fs.writeFileSync(path.join(output,'results-empty.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-open-band-intensity-btn')");
    assert.equal(await exec("document.getElementById('gel-band-intensity-empty').checkVisibility()"),true,'An unmeasured gel explains how to get intensities');
    assert.equal(await exec("document.getElementById('gel-cell-table-copy-btn').disabled"),true,'Empty results cannot overwrite the clipboard');
    await exec("document.querySelector('#gel-cell-table-panel [data-gel-window-close]').click();click('gel-tool-image-btn')");
    // Navigation stays left; category icons sit to the right of their inspector.
    const layout=await exec(`(()=>{const rail=document.querySelector('.gel-setup-panel'),status=document.getElementById('gel-status');return {toolbars:document.querySelectorAll('.gel-viewer-panel [role=toolbar]').length,navigationTools:rail.querySelectorAll('.gel-tool-group').length,sections:[...document.querySelectorAll('[data-gel-tool-category]')].map(s=>s.getAttribute('aria-label')),hint:status.textContent.trim(),hintOnScreen:status.getBoundingClientRect().width>1,card:document.querySelector('.gel-viewer-card').getBoundingClientRect().toJSON(),panel:rect('gel-tools-panel'),stage:rect('gel-viewer-stage')}})()`);
    assert.equal(layout.toolbars,1,'The viewer keeps a single toolbar');
    assert.equal(layout.navigationTools,0,'The left rail contains navigation only');
    assert.deepEqual(layout.sections,['Image','Lanes','Ladder','Bands','Results','Processed'],'Right-side tools are grouped by function');
    assert.equal(layout.hintOnScreen,false,'Status text is for screen readers only; no message row over the gel');
    assert.ok(layout.card.left>=layout.panel.right&&layout.panel.left>=layout.stage.right&&layout.card.width<=66,'A narrow icon toolbar sits to the right of the active tool panel');
    assert.deepEqual(await exec("[...document.querySelectorAll('.gel-viewer-toolbar button')].filter(b=>b.checkVisibility()).map(b=>{const c=b.querySelector('.gel-card-label,[data-gel-action-label]');return c&&c.checkVisibility()&&c.scrollWidth<=c.clientWidth?'':b.id}).filter(Boolean)"),[],'Every toolbar icon shows its caption unclipped');
    assert.deepEqual(await exec("[...document.querySelectorAll('[data-gel-tool-panel]')].filter(p=>p.checkVisibility()).map(p=>p.dataset.gelToolPanel)"),['image'],'Only Image tools show initially');
    assert.equal(await exec("document.getElementById('gel-denoise-strength').checkVisibility() || document.getElementById('gel-contrast-strength').checkVisibility()"),false,'Image tools no longer show enhancement sliders');
    await exec("window.originalPreview=document.getElementById('gel-canvas').toDataURL();click('gel-process-image-btn')");
    assert.equal(await exec("document.getElementById('gel-tool-panel-title').textContent"),'Processed');
    assert.equal(await exec("document.getElementById('gel-processed-preview').checked"),true,'Opening Processed previews the enhancement settings');
    assert.equal(await exec("document.getElementById('gel-denoise-strength').checkVisibility() && document.getElementById('gel-contrast-strength').checkVisibility()"),true,'Both enhancement sliders belong to the Processed panel');
    await exec("window.enhancedPreview=document.getElementById('gel-canvas').toDataURL();{const c=document.getElementById('gel-contrast-strength');c.value='60';c.dispatchEvent(new Event('input',{bubbles:true}))}");
    await waitFor("document.getElementById('gel-canvas').toDataURL()!==enhancedPreview");
    assert.equal(await exec("document.getElementById('gel-canvas').toDataURL()!==enhancedPreview"),true,'Changing contrast updates the processed preview');
    await exec("click('gel-processed-preview')");
    assert.equal(await exec("document.getElementById('gel-canvas').toDataURL()===originalPreview"),true,'Turning processed preview off shows the original image');
    assert.equal(await exec("document.getElementById('gel-contrast-strength').value"),'60','Comparing the original retains enhancement settings');
    await exec("click('gel-processed-preview');click('gel-process-image-btn')");
    assert.equal(await exec("document.getElementById('gel-tools-panel').hidden"),true,'The Processed icon collapses its panel');
    assert.equal(await exec("document.getElementById('gel-processed-preview').checked"),true,'Collapsing tools preserves the processed preview');
    await exec("click('gel-process-image-btn');{const c=document.getElementById('gel-contrast-strength');c.value='100';c.dispatchEvent(new Event('input',{bubbles:true}))}click('gel-processed-preview');click('gel-tool-image-btn')");
    const stageWithTools=await exec("rect('gel-viewer-stage')");
    const gelWithTools=await exec("rect('gel-canvas')");
    fs.writeFileSync(path.join(output,'tools-open.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-tool-image-btn')"); await settle();
    assert.equal(await exec("document.getElementById('gel-tools-panel').hidden"),true,'Clicking the selected category collapses its panel');
    for (const [id, before] of [['gel-viewer-stage',stageWithTools],['gel-canvas',gelWithTools]]) {
      const after=await exec(`rect('${id}')`);
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(after[key]-before[key])<1,`Collapsing tools preserves ${id} ${key}`);
    }
    fs.writeFileSync(path.join(output,'tools-closed.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-tool-lanes-btn')"); await settle();
    assert.deepEqual(await exec("[...document.querySelectorAll('[data-gel-tool-panel]')].filter(p=>p.checkVisibility()).map(p=>p.dataset.gelToolPanel)"),['lanes'],'Category selection shows just its tools');
    assert.equal(await exec("document.getElementById('gel-tool-lanes-btn').getAttribute('aria-pressed')"),'true');
    await exec("const b=document.getElementById('gel-tool-lanes-btn');b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.activeElement.id"),'gel-tool-ladder-btn','Arrow keys move through the icon toolbar');
    assert.equal(layout.hint,'','Loading an image needs no message');
    await exec("document.getElementById('gel-expected-lane-count').value='6';click('gel-auto-detect-lanes-btn')");
    assert.equal(await exec("getComputedStyle(document.getElementById('gel-canvas')).cursor"),'col-resize','Placing dividers shows a divider cursor');
    assert.match(await exec("document.getElementById('gel-status').textContent"),/Finish dividers/,'A pending step says what to do next');
    // Right-click removes the targeted divider, including either outer edge, as one undoable edit.
    async function manualOverrides() {
      await exec("document.getElementById('gel-form').requestSubmit()");
      await waitFor("document.getElementById('gel-form').getAttribute('aria-busy')==='false'");
      return exec("gelState.gelAnalyses.find(r=>r.id===document.getElementById('gel-id').value).manualOverrides");
    }
    const initialDividers=(await manualOverrides()).laneSegmentation;
    assert.equal(await exec("document.getElementById('gel-reset-overrides-btn').closest('.gel-viewer-toolbar')!==null"),true,'Reset is a direct toolbar tool');
    assert.equal(await exec("document.getElementById('gel-cancel-btn')"),null,'New gel is removed');
    await exec("click('gel-reset-overrides-btn')");
    assert.equal((await manualOverrides()).laneSegmentation.gelLeft,null,'The toolbar reset clears lane dividers');
    assert.equal(await exec("document.getElementById('gel-canvas').width"),900,'Reset retains the imported gel image');
    await exec('controller.undo()');
    assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'Undo restores the reset lane geometry');
    const middle=initialDividers.dividers[2];
    async function dragDivider(x,{offset=10,delta=18,y=.5}={}) {
      const canvas=await exec("rect('gel-canvas')");
      const point={x:Math.round(canvas.left+(x+.5)/900*canvas.width+offset),y:Math.round(canvas.top+canvas.height*y)};
      win.webContents.sendInputEvent({type:'mouseMove',...point});
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      for (const fraction of [.3,.6,1]) { win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x+delta*fraction),y:point.y}); await settle(); }
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(point.x+delta),y:point.y});
      await settle();
      return Math.round(x+delta/canvas.width*900);
    }
    for (const [width,height,y] of [[1400,900,.1],[900,700,.5],[600,800,.9]]) {
      win.setSize(width,height); await settle();
      const expected=await dragDivider(middle,{y});
      const moved=(await manualOverrides()).laneSegmentation;
      assert.equal(moved.dividers.length,initialDividers.dividers.length,'Dragging near a divider never adds an extra boundary');
      assert.ok(moved.dividers[2]>middle,`A 10-pixel near miss grabs the divider at ${width}×${height}`);
      assert.ok(Math.abs(moved.dividers[2]-expected)<=1,'Grabbing beside the line preserves its pointer offset without jumping');
      assert.deepEqual({...moved,dividers:initialDividers.dividers},initialDividers,'Only the grabbed divider changes');
      await exec('controller.undo()');
      assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'One undo restores the entire divider drag');
      await exec('controller.redo()');
      assert.deepEqual((await manualOverrides()).laneSegmentation,moved,'Redo restores the moved divider');
      await exec('controller.undo()');
    }
    win.setSize(1400,900); await settle();
    await dragDivider(middle,{delta:0});
    assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'Clicking the wider grab zone leaves the divider in place');
    await dragDivider(middle,{delta:1000});
    const clamped=(await manualOverrides()).laneSegmentation;
    assert.equal(clamped.dividers[2],initialDividers.dividers[3]-1,'A divider stops before its neighbor instead of crossing it');
    await exec('controller.undo()');
    for (const [x,offset,delta,key] of [[initialDividers.gelLeft,8,18,'gelLeft'],[initialDividers.gelRight,-8,-18,'gelRight']]) {
      await dragDivider(x,{offset,delta});
      const moved=(await manualOverrides()).laneSegmentation;
      assert.notEqual(moved[key],initialDividers[key],`The wider grab zone also moves ${key}`);
      assert.deepEqual({...moved,[key]:initialDividers[key]},initialDividers,'Moving an outer edge leaves all other boundaries unchanged');
      await exec('controller.undo()');
    }
    const menuOpen="document.querySelector('.gel-divider-menu').matches(':popover-open')";
    const removeDivider="document.querySelector('.gel-divider-menu button').click()";
    await exec(`dividerContext(${middle},.99,10)`);
    assert.equal(await exec(menuOpen),true,'Right-clicking a divider opens its context menu');
    assert.equal(await exec("document.activeElement.textContent.trim()"),'Remove divider','The remove action receives keyboard focus');
    const menuBounds=await exec("({box:document.querySelector('.gel-divider-menu').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight})");
    assert.ok(menuBounds.box.left>=8&&menuBounds.box.right<=menuBounds.width-7&&menuBounds.box.top>=8&&menuBounds.box.bottom<=menuBounds.height-7,'Divider menu stays inside the viewport');
    fs.writeFileSync(path.join(output,'divider-menu.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(await exec(menuOpen),false,'Escape dismisses the divider menu');
    assert.equal(await exec('document.activeElement.id'),'gel-tool-dividers-btn','Escape restores focus to the divider tool');
    assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'Opening or cancelling the menu does not add a divider');
    await exec(`dividerContext(${middle});${removeDivider}`);
    const removed=(await manualOverrides()).laneSegmentation;
    assert.deepEqual(removed,{...initialDividers,dividers:initialDividers.dividers.filter(x=>x!==middle)},'Remove affects only the selected internal divider');
    await exec('controller.undo()');
    assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'Undo restores the divider');
    await exec(`dividerContext(${middle});controller.redo()`);
    assert.equal(await exec(menuOpen),false,'Changing history closes a menu targeting stale geometry');
    assert.deepEqual((await manualOverrides()).laneSegmentation,removed,'Redo removes the same divider');
    await exec('controller.undo()');
    await exec(`dividerContext(${initialDividers.gelLeft});${removeDivider}`);
    const withoutLeft=(await manualOverrides()).laneSegmentation;
    assert.equal(withoutLeft.gelLeft,initialDividers.dividers[0],'Removing the left edge promotes the first remaining boundary');
    assert.equal(withoutLeft.gelRight,initialDividers.gelRight);
    await exec('controller.undo()');
    await exec(`dividerContext(${initialDividers.gelRight});${removeDivider}`);
    assert.equal((await manualOverrides()).laneSegmentation.gelRight,initialDividers.dividers.at(-1),'Removing the right edge promotes the last remaining boundary');
    await exec('controller.undo()');
    await exec(`dividerContext(${middle},.5,20)`);
    assert.equal(await exec(menuOpen),false,'Right-clicking away from a divider does not offer removal');
    await exec("const c=rect('gel-canvas');for(const options of [{button:2},{button:0,ctrlKey:true}])document.getElementById('gel-canvas').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:c.x+c.width*.4,clientY:c.y+c.height*.5,...options}))");
    assert.deepEqual((await manualOverrides()).laneSegmentation,initialDividers,'Right-click and Control-click never place an extra divider');
    for (const x of [initialDividers.gelLeft,...initialDividers.dividers,initialDividers.gelRight]) await exec(`dividerContext(${x});${removeDivider}`);
    const emptyDividers=(await manualOverrides()).laneSegmentation;
    assert.equal(emptyDividers.gelLeft,null);assert.equal(emptyDividers.gelRight,null);assert.deepEqual(emptyDividers.dividers,[]);
    await exec("click('gel-tool-dividers-btn')");
    assert.match(await exec("document.getElementById('gel-status').textContent"),/two|2|boundar|edge/i,'Finishing without two edges is rejected');
    // Saving inspection snapshots changes record state; restart the fixture for the remaining workflow checks.
    await win.loadFile(fixture);
    await waitFor('Boolean(window.qaReady)');
    await exec('loadGel()');
    await waitFor("!document.getElementById('gel-crop-mode-btn').disabled");
    await exec("document.getElementById('gel-expected-lane-count').value='6';click('gel-tool-lanes-btn')");
    await exec("click('gel-auto-detect-lanes-btn')");
    await exec("click('gel-tool-dividers-btn')");
    assert.notEqual(await exec("getComputedStyle(document.getElementById('gel-canvas')).cursor"),'col-resize','Finishing dividers restores the cursor');
    await waitFor("!document.getElementById('gel-add-table-btn').disabled");
    await settle();
    // MW entry belongs to the clicked band, with a visible mode and keyboard input.
    await exec("click('gel-tool-ladder-lane-btn');gelPointer('click',.08,.13);click('gel-tool-ladder-mw-btn');");
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
    assert.equal(await exec("document.getElementById('gel-tool-ladder-mw-btn').getAttribute('aria-pressed')"),'true','Escape cancels the entry but leaves Set MW on');
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
    assert.ok(await exec("document.getElementById('gel-lane-profile-select').options.length")>1,'The lane profile renders inline in Results');
    await exec("click('gel-tool-results-btn');document.getElementById('gel-lane-profile-select').focus()");
    assert.equal(await exec("document.getElementById('gel-lane-profile-chart').checkVisibility()"),true,'Available lane data reveals the profile');
    assert.equal(await exec("document.getElementById('gel-lane-profile-empty').hidden"),true);
    await settle();
    fs.writeFileSync(path.join(output,'results-profile.png'),(await win.webContents.capturePage()).toPNG());
    assert.ok(await exec("(()=>{const tools=document.querySelector('.gel-tools-panel');return tools.scrollTop===0&&tools.scrollHeight<=tools.clientHeight+1})()"),'Only the tool fields scroll; Save stays pinned');
    await exec("click('gel-open-lane-table-btn');click('gel-add-table-btn')");
    await settle();
    async function checkDock() {
      const dock=await exec(`(()=>{const panel=document.getElementById('gel-lane-table-panel'),canvas=rect('gel-canvas'),grid=document.querySelector('.gel-lane-table-grid-shell').getBoundingClientRect(),layer=document.querySelector('.gel-floating-layer').getBoundingClientRect();return {panel:panel.getBoundingClientRect().toJSON(),canvas,grid:grid.toJSON(),layer:layer.toJSON(),floating:Boolean(panel.closest('[data-gel-window],.gel-floating-layer')),hidden:panel.hidden}})()`);
      assert.equal(dock.hidden,false,'The lane table dock is visible');
      assert.equal(dock.floating,false,'The lane table stays outside floating windows');
      assert.ok(dock.panel.bottom<=dock.canvas.top-8,'The lane table sits above the gel');
      assert.ok(Math.abs(dock.grid.left-dock.canvas.left)<2&&Math.abs(dock.grid.width-dock.canvas.width)<2,`Table columns share the image position and width: ${JSON.stringify(dock)}`);
      assert.ok(dock.layer.top>=dock.panel.bottom,`Floating windows stay below the table: ${JSON.stringify({layer:dock.layer,panel:dock.panel})}`);
    }
    await checkDock();
    await exec("document.querySelector('[data-gel-table-add-row]').click();document.querySelector('[data-gel-table-role=label]').value='Label';document.querySelector('[data-gel-table-role=label]').dispatchEvent(new Event('input',{bubbles:true}));");
    await settle();
    await checkDock();
    const dockedBaseline=await exec("rect('gel-canvas')");
    await exec("click('gel-process-image-btn')");
    assert.equal(await exec("document.getElementById('gel-processed-preview').checked"),true,'The Processed preview turns on');
    await exec("click('gel-tool-results-btn')");
    await exec("click('gel-open-peak-editor-btn')");
    await settle();
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),false);
    assert.equal(await exec("document.querySelector('.gel-peak-editor-dialog').getAttribute('aria-modal')"),'false');
    sameRect(dockedBaseline,await exec("rect('gel-canvas')"),'Opening peak editor');
    await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),true);
    assert.equal(await exec("document.getElementById('gel-lane-table-panel').hidden"),false,'Escape leaves the docked table visible');
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
    await exec("{click('gel-tool-band-top-btn');const c=rect('gel-canvas');document.getElementById('gel-canvas').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:c.x+c.width*.4,clientY:c.y+c.height*.55}));if(document.getElementById('gel-tool-band-bottom-btn').getAttribute('aria-pressed')!=='true')throw new Error('Top did not hand off to Bottom');document.getElementById('gel-canvas').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:c.x+c.width*.4,clientY:c.y+c.height*.66}));}");
    await waitFor("document.querySelectorAll('#gel-cell-table-host tbody tr').length > 0");
    assert.equal(await exec("document.getElementById('gel-cell-table-copy-btn').disabled"),false,'Band intensities enable table copying');
    assert.equal(await exec("document.getElementById('gel-cell-table-panel').hidden"),true,'Measurements do not open a window automatically');
    assert.equal(await exec("document.querySelectorAll('[data-gel-window]').length"),2,'Band intensity and Peak editor are floating windows');
    assert.equal(await exec("document.getElementById('gel-tool-page-results').contains(document.getElementById('gel-cell-table-host'))"),false,'The table is no longer squeezed into Results');
    const intensityCanvasBefore=await exec("rect('gel-canvas')");
    await exec("click('gel-open-band-intensity-btn')");
    await settle();
    sameRect(intensityCanvasBefore,await exec("rect('gel-canvas')"),'Opening Band intensity');
    const intensity=await exec(`(()=>{const panel=document.getElementById('gel-cell-table-panel'),chart=document.getElementById('gel-band-intensity-chart'),table=document.getElementById('gel-cell-table-host');return {hidden:panel.hidden,modal:panel.getAttribute('aria-modal'),chartVisible:chart.checkVisibility(),chart:chart.getBoundingClientRect().toJSON(),table:table.getBoundingClientRect().toJSON(),rows:table.querySelectorAll('tbody tr').length,series:chart.querySelectorAll('.gel-intensity-series').length}})()`);
    assert.equal(intensity.hidden,false);
    assert.equal(intensity.modal,'false');
    assert.equal(intensity.chartVisible,true,'The SVG chart is visibly rendered');
    assert.ok(intensity.chart.height>=200,'The graph has room for values and lane labels');
    assert.ok(intensity.chart.bottom<intensity.table.top,'The bar graph comes before the table');
    assert.equal(intensity.series,intensity.rows,'The graph and table cover the same lanes');
    await exec("click('gel-cell-table-copy-btn')");
    await waitFor("document.getElementById('gel-cell-table-copy-status').textContent==='Table copied.'");
    assert.equal(await exec('qaCopiedText'),await exec("[...document.querySelectorAll('#gel-cell-table-host tr')].map(row=>[...row.cells].map(cell=>cell.textContent.trim()).join('\\t')).join('\\n')"),'Copy includes every header and row');
    await exec("{const input=document.querySelector('[data-gel-table-role=value]');input.value='Control <A>';input.dispatchEvent(new Event('input',{bubbles:true}))}");
    assert.match(await exec("document.querySelector('#gel-band-intensity-chart .gel-intensity-series title').textContent"),/Control <A>/,'An open graph reflects updated lane labels');
    const intensityBefore=await exec("rect('gel-cell-table-panel')");
    await exec("{const h=document.querySelector('#gel-cell-table-panel [data-gel-window-handle]');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))}");
    assert.ok((await exec("rect('gel-cell-table-panel')")).x>intensityBefore.x,'Band intensity can be moved without changing the gel');
    await exec("document.querySelector('#gel-cell-table-panel [data-gel-window-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-cell-table-panel').hidden"),true);
    assert.equal(await exec("document.activeElement.id"),'gel-open-band-intensity-btn','Closing restores focus to Band intensity');
    await exec("click('gel-open-band-intensity-btn')");
    await exec("click('gel-open-peak-editor-btn')");
    await settle();
    await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-peak-editor-overlay').hidden"),true,'Escape closes the front window');
    assert.equal(await exec("document.getElementById('gel-cell-table-panel').hidden"),false,'Escape preserves the window underneath');
    await exec("click('gel-open-peak-editor-btn')");
    await settle();
    const peakBefore = await exec("rect('gel-peak-editor-overlay')");
    await exec("const h=document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));");
    assert.ok((await exec("rect('gel-peak-editor-overlay')")).x > peakBefore.x,'Keyboard moves the floating window');
    const handle = await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').getBoundingClientRect().toJSON()");
    const start = { x:Math.round(handle.x+45), y:Math.round(handle.y+18) };
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});
    win.webContents.sendInputEvent({type:'mouseMove',x:start.x+65,y:start.y});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:start.x+65,y:start.y});
    await settle();
    const dragged = await exec("rect('gel-peak-editor-overlay')");
    assert.ok(dragged.x>handle.x,'Pointer dragging moves the window within the available canvas bounds');
    await exec("click('gel-peak-editor-close-btn')");
    await exec("document.querySelector('.gel-band-intensity-body').scrollTop=0");
    // Rail buttons scrolled into view finish their theme transition late; capture the settled look.
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'workspace.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.add('theme-night')");
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'band-intensity-night.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.body.classList.remove('theme-night')");
    await exec("click('gel-close-lane-table-btn');document.querySelector('.gel-band-intensity-body').scrollTop=0");
    await settle();
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'band-intensity.png'),(await win.webContents.capturePage()).toPNG());
    await exec("click('gel-open-lane-table-btn')");
    // Keep a window open through the resize checks so its bounds are covered.
    await exec("click('gel-open-peak-editor-btn')");
    for (const [width,height] of [[1400,900],[1024,768],[800,700],[600,800]]) {
      win.setSize(width,height);
      await settle();
      const sizes=await exec(`(()=>{const main=document.querySelector('.gel-main'),canvas=rect('gel-canvas'),stage=rect('gel-viewer-stage'),layer=document.querySelector('.gel-floating-layer').getBoundingClientRect();return {client:main.clientHeight,scroll:main.scrollHeight,canvas,stage,layer:layer.toJSON(),windows:[...document.querySelectorAll('[data-gel-window]')].filter(e=>!e.hidden).map(e=>({rect:e.getBoundingClientRect().toJSON(),layer:e.parentElement.getBoundingClientRect().toJSON()}))}})()`);
      if (width > 760) assert.ok(sizes.scroll<=sizes.client+1,`No main scrolling at ${width}×${height}`);
      assert.ok(await exec("(()=>{const main=document.querySelector('.gel-main');return main.scrollWidth<=main.clientWidth+1})()"),`No horizontal overflow at ${width}×${height}`);
      const tools = await exec("({rail:document.querySelector('.gel-viewer-card').getBoundingClientRect().toJSON(),panel:rect('gel-tools-panel'),width:innerWidth,height:innerHeight})");
      assert.ok(tools.panel.left>=0&&tools.panel.right<=tools.rail.left&&tools.panel.bottom<=tools.height+1&&tools.rail.right<=tools.width,`Tool panel stays beside the icon rail at ${width}×${height}: ${JSON.stringify(tools)}`);
      const resultsLayout=await exec("({band:rect('gel-open-band-intensity-btn'),peak:rect('gel-open-peak-editor-btn'),profile:rect('gel-lane-profile-panel'),picker:rect('gel-lane-profile-select')})");
      assert.ok(resultsLayout.band.bottom<=resultsLayout.peak.top&&resultsLayout.peak.bottom<resultsLayout.profile.top,`Result windows are grouped above the profile at ${width}×${height}`);
      assert.ok(Math.abs(resultsLayout.picker.width-resultsLayout.profile.width)<2,`Lane selector uses the card width at ${width}×${height}`);
      await exec("document.querySelector('.gel-tool-panel-close').click()"); await settle();
      assert.equal(await exec("document.getElementById('gel-tools-panel').hidden"),true,'The close button hides the tool panel');
      const closed=await exec("rect('gel-canvas')");
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(closed[key]-sizes.canvas[key])<1,`Closing tools preserves gel ${key} at ${width}×${height}`);
      for (const id of ['gel-tool-image-btn','gel-tool-lanes-btn','gel-tool-ladder-btn','gel-tool-bands-btn','gel-tool-results-btn']) {
        await exec(`click('${id}')`); await settle();
        const after=await exec("rect('gel-canvas')");
        for (const key of ['left','top','width','height']) assert.ok(Math.abs(after[key]-sizes.canvas[key])<1,`Opening ${id} preserves gel ${key} at ${width}×${height}`);
      }
      assert.ok(sizes.canvas.bottom<=sizes.stage.bottom+1,'Gel fits stage height');
      await checkDock();
      sizes.windows.forEach(({rect,layer})=>{assert.ok(rect.left>=layer.left-1&&rect.right<=layer.right+1,'Window fits width');assert.ok(rect.top>=layer.top-1&&rect.bottom<=layer.bottom+1,'Window fits height');});
      await exec("document.getElementById('gel-cell-table-copy-btn').scrollIntoView({block:'nearest'})");
      await settle();
      const copyBounds=await exec("({button:rect('gel-cell-table-copy-btn'),panel:rect('gel-cell-table-panel')})");
      assert.ok(copyBounds.button.top>=copyBounds.panel.top&&copyBounds.button.bottom<=copyBounds.panel.bottom,`Copy remains reachable at ${width}×${height}: ${JSON.stringify(copyBounds)}`);
      await exec("click('gel-tool-ladder-mw-btn');gelPointer('click',.08,.98)");
      const entry=await exec("({box:rect('gel-ladder-mw-editor'),width:innerWidth,height:innerHeight,hidden:document.getElementById('gel-ladder-mw-editor').hidden})");
      assert.equal(entry.hidden,false,`MW box opens at ${width}×${height}`);
      assert.ok(entry.box.left>=8&&entry.box.right<=entry.width-7&&entry.box.top>=8&&entry.box.bottom<=entry.height-7,`MW box fits ${width}×${height}`);
      await exec("dismissMw();click('gel-tool-ladder-mw-btn')");
    }
    win.setSize(1400,900);await settle();
    await exec("document.querySelector('#gel-cell-table-panel [data-gel-window-close]').click()");
    const beforeCrop=await exec("rect('gel-canvas')");
    await exec("click('gel-peak-editor-close-btn');click('gel-crop-mode-btn')");
    await waitFor("Boolean(document.querySelector('.cropper-container'))");
    await waitFor("document.querySelector('.cropper-view-box')?.getBoundingClientRect().width > 100");
    await settle();
    fs.writeFileSync(path.join(output,'crop.png'),(await win.webContents.capturePage()).toPNG());
    // The crop bar takes over the toolbar row; the slider straightens the image.
    assert.equal(await exec("document.getElementById('gel-crop-bar').checkVisibility()"),true,'Crop controls show in their own panel');
    assert.equal(await exec("document.getElementById('gel-reset-overrides-btn').disabled"),true,'Reset waits until the active crop is finished');
    assert.equal(await exec("document.getElementById('gel-tool-panel-title').textContent"),'Crop');
    assert.deepEqual(await exec("[...document.querySelectorAll('[data-gel-tool-panel]')].filter(p=>p.checkVisibility()).map(p=>p.dataset.gelToolPanel)"),[],'Crop hides the category pages');
    assert.equal(await exec("document.getElementById('gel-crop-mode-btn').getAttribute('aria-pressed')"),'true','The Crop icon shows its mode');
    assert.equal(await exec("document.getElementById('gel-open-figure-btn').inert"),true,'Layout is unavailable until the active crop is finished');
    const cropGeometry=()=>exec(`(()=>{const cropper=document.getElementById('gel-cropper-image').cropper;const image=cropper.getImageData();return {scale:image.width/image.naturalWidth,crop:cropper.getData(),box:cropper.getCropBoxData()}})()`);
    const initialRotationGeometry=await cropGeometry();
    async function assertRotationScale(label) {
      const geometry=await cropGeometry();
      assert.ok(Math.abs(geometry.scale-initialRotationGeometry.scale)<1e-9,`${label} preserves the gel's pixel scale: ${initialRotationGeometry.scale} → ${geometry.scale}`);
      for(const key of ['width','height']) assert.ok(Math.abs(geometry.crop[key]-initialRotationGeometry.crop[key])<1e-6,`${label} preserves crop ${key}`);
      return geometry;
    }
    await exec("const a=document.getElementById('gel-crop-angle');a.value='5';a.dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await exec("document.getElementById('gel-cropper-image').cropper.getData().rotate"),5,'The straighten slider rotates the crop');
    assert.equal(await exec("document.getElementById('gel-crop-angle-value').textContent"),'5°');
    await assertRotationScale('Straightening');
    await exec("click('gel-crop-rotate-btn')");
    const quarterRotationGeometry=await assertRotationScale('Quarter turn');
    assert.equal(quarterRotationGeometry.crop.rotate,-85);
    await settle();
    fs.writeFileSync(path.join(output,'crop-rotation.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.getElementById('gel-crop-angle').value='-5';document.getElementById('gel-crop-angle').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal((await assertRotationScale('Straightening after a quarter turn')).crop.rotate,-95);
    for(let i=0;i<3;i++) {
      await exec("click('gel-crop-rotate-btn')");
      await assertRotationScale('Repeated quarter turns');
    }
    await exec("click('gel-reset-crop-btn')");
    assert.equal(await exec("document.getElementById('gel-cropper-image').cropper.getData().rotate"),0,'Reset clears the rotation');
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
    await dragCropTarget('.cropper-face',320,0);
    const draggedRotationGeometry=await assertRotationScale('Free rotation drag');
    assert.equal(draggedRotationGeometry.crop.rotate,80,'Dragging the gel rotates it without zooming');
    const rotatedOutput=await exec(`(()=>{const canvas=document.getElementById('gel-cropper-image').cropper.getCroppedCanvas();return {width:canvas.width,height:canvas.height}})()`);
    assert.equal(rotatedOutput.width,Math.round(initialRotationGeometry.crop.width),'Rotation preserves the selected output width');
    assert.equal(rotatedOutput.height,Math.round(initialRotationGeometry.crop.height),'Rotation preserves the selected output height');
    fs.writeFileSync(path.join(output,'rotation-scale.json'),JSON.stringify({initial:initialRotationGeometry,quarterTurn:quarterRotationGeometry,dragged:draggedRotationGeometry,output:rotatedOutput},null,2));
    await exec("click('gel-reset-crop-btn')");
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
    await exec("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await settle();
    assert.equal(await exec("document.getElementById('gel-crop-bar').hidden"),true,'Escape cancels crop mode');
    sameRect(beforeCrop,await exec("rect('gel-canvas')"),'Cancelling crop');
    await exec("document.body.classList.add('theme-night');click('gel-open-peak-editor-btn')");
    await settle();
    await exec("const chart=document.getElementById('gel-peak-editor-chart');const bounds=chart.getBoundingClientRect();for(const row of [282,465])chart.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.x+16+row/609*(bounds.width-32),clientY:bounds.y+bounds.height*.8}));");
    await settle();
    assert.ok(await exec("document.querySelectorAll('#gel-peak-editor-table .tabulator-row').length")>0,'Peak editing produces integration rows in the floating window');
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=manual]'))");
    assert.equal(await exec("document.getElementById('gel-peak-editor-summary').checkVisibility()"),false,'Band integration omits the baseline instruction');
    assert.ok(await exec("Boolean(document.querySelector('#gel-cell-table-host td[title=\"Manual baseline\"]'))"),'Band intensity updates from the Peak editor');
    const manualValue=await exec("document.querySelector('#gel-cell-table-host td[title=\"Manual baseline\"]').textContent");
    await exec("click('gel-peak-editor-clear-lane-btn')");
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=auto]'))");
    assert.equal(await exec("Boolean(document.querySelector('#gel-cell-table-host td[title=\"Manual baseline\"]'))"),false,'Clearing restores automatic background');
    await exec("document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').focus();controller.undo()");
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=manual]'))");
    assert.equal(await exec("document.querySelector('#gel-cell-table-host td[title=\"Manual baseline\"]').textContent"),manualValue,'Undo restores the manual measurement');
    await exec('controller.redo()');
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=auto]'))");
    await exec('controller.undo()');
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=manual]'))");
    await exec("click('gel-peak-editor-clear-lane-btn')");
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=auto]'))");
    await exec("{const chart=document.getElementById('gel-peak-editor-chart'),b=chart.getBoundingClientRect();for(const row of [319,421])chart.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.x+16+row/609*(b.width-32),clientY:b.y+b.height*.8}))}");
    await waitFor("Boolean(document.querySelector('#gel-cell-table-host .gel-intensity-review'))");
    assert.match(await exec("document.querySelector('#gel-cell-table-host td[title=\"Manual baseline\"]').textContent"),/^-/,'A negative net value remains visible beside the review message');
    await exec("click('gel-open-band-intensity-btn');click('gel-cell-table-copy-btn')");
    await waitFor("document.getElementById('gel-cell-table-copy-status').textContent==='Table copied.'");
    assert.doesNotMatch(await exec('qaCopiedText'),/Review background/,'The copyable intensity column remains numeric');
    assert.ok(await exec("Boolean(document.querySelector('#gel-band-intensity-chart rect[data-review=true][data-value]'))"),'The graph marks review measurements');
    fs.writeFileSync(path.join(output,'band-background-review.png'),(await win.webContents.capturePage()).toPNG());
    await exec("document.querySelector('#gel-cell-table-panel [data-gel-window-close]').click();document.querySelector('#gel-peak-editor-overlay [data-gel-window-handle]').focus();controller.undo();controller.undo();controller.undo()");
    await waitFor("Boolean(document.querySelector('#gel-peak-editor-chart [data-band-baseline=manual]'))");
    // Theme colors animate in the shared styles; inspect the settled appearance.
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'peak-editor-night.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(await exec("document.getElementById('gel-open-peak-editor-btn').textContent.trim()"),'Band integration');
    assert.equal(await exec("document.getElementById('gel-peak-editor-title').textContent"),'Band integration');
    for (const [width,height] of [[1400,900],[1024,768],[800,700],[600,800]]) {
      win.setSize(width,height);await settle();
      await waitFor("(()=>{const svg=document.getElementById('gel-peak-editor-chart'),b=svg.getBoundingClientRect();return Math.abs(svg.viewBox.baseVal.width-b.width)<1&&Math.abs(svg.viewBox.baseVal.height-b.height)<1})()");
      const plotGeometry=await exec(`(()=>{const svg=document.getElementById('gel-peak-editor-chart'),b=svg.getBoundingClientRect(),path=svg.querySelector('.peak-editor-path').getBBox();return {width:b.width,height:b.height,frame:svg.querySelectorAll('.peak-editor-frame,.peak-editor-path-shadow').length,path:{x:path.x,width:path.width},labels:[...svg.querySelectorAll('.peak-editor-axis-label')].map(e=>({x:Number(e.getAttribute('x')),text:e.textContent})),grid:[...svg.querySelectorAll('.peak-editor-grid')].map(e=>({left:Number(e.getAttribute('x1')),right:Number(e.getAttribute('x2'))}))}})()`);
      assert.equal(plotGeometry.frame,0,'The integration graph has no outer box or glow');
      assert.ok(Math.abs(plotGeometry.path.x-16)<.1&&Math.abs(plotGeometry.path.x+plotGeometry.path.width-(plotGeometry.width-16))<.1,'The curve has equal side margins');
      assert.deepEqual(plotGeometry.labels.map(label=>label.text),['Top','Bottom']);
      assert.ok(Math.abs(plotGeometry.labels[0].x-plotGeometry.path.x)<.1&&Math.abs(plotGeometry.labels[1].x-(plotGeometry.path.x+plotGeometry.path.width))<.1,'Endpoint labels align with the curve');
      for(const grid of plotGeometry.grid)assert.ok(Math.abs(grid.left-16)<.1&&Math.abs(grid.right-(plotGeometry.width-16))<.1,'Grid lines share the curve bounds');
      for(const row of [0,100,609]){
        const pointer=await exec(`(()=>{const svg=document.getElementById('gel-peak-editor-chart'),b=svg.getBoundingClientRect(),event=new MouseEvent('mousemove',{bubbles:true,clientX:b.left+16+${row}/609*(b.width-32),clientY:b.top+b.height/2});svg.dispatchEvent(event);return {clientX:event.clientX,left:b.left,width:b.width}})()`);
        const sampledRow=Number(await exec("document.querySelector('#gel-peak-editor-chart .peak-editor-hover-label').textContent"));
        // MouseEvent stores integer screen coordinates; narrow plots can have
        // several image rows per screen pixel. Check the actual pointer position.
        assert.ok(Math.abs(sampledRow-row)<=Math.ceil(609/(pointer.width-32)),`Pointer stays within one screen pixel of row ${row} after resize to ${width}`);
        const hover=await exec("(()=>{const svg=document.getElementById('gel-peak-editor-chart'),circle=svg.querySelector('.peak-editor-hover-dot'),label=svg.querySelector('.peak-editor-hover-label');const box=label.getBBox();return {x:Number(circle.getAttribute('cx')),label:{x:box.x,y:box.y,width:box.width,height:box.height},width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height}})()");
        assert.ok(Math.abs(hover.x-(16+sampledRow/609*(hover.width-32)))<.1,'Hover point aligns with the curve row');
        assert.ok(Math.abs(pointer.left+hover.x-pointer.clientX)<=Math.max(1,(pointer.width-32)/609/2)+.1,'Hover marker follows the screen pointer');
        assert.ok(hover.label.x>=0&&hover.label.x+hover.label.width<=hover.width&&hover.label.y>=0&&hover.label.y+hover.label.height<=hover.height,'Edge labels fit inside the graph');
      }
      await exec("document.getElementById('gel-peak-editor-chart').dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}))");
      const integrationTable=await exec(`(()=>{const host=document.getElementById('gel-peak-editor-table'),holder=host.querySelector('.tabulator-tableholder');return {
        headers:[...host.querySelectorAll('.tabulator-col-title')].map(e=>({title:e.textContent,width:e.clientWidth,content:e.scrollWidth,height:e.clientHeight,contentHeight:e.scrollHeight})),
        cells:[...host.querySelectorAll('.tabulator-row .tabulator-cell')].map(e=>({text:e.textContent,width:e.clientWidth,content:e.scrollWidth})),
        holder:{width:holder.clientWidth,scroll:holder.scrollWidth,height:holder.clientHeight},host:host.getBoundingClientRect().toJSON(),window:rect('gel-peak-editor-overlay'),mainScroll:document.querySelector('.gel-main').scrollWidth,mainWidth:document.querySelector('.gel-main').clientWidth
      }})()`);
      assert.deepEqual(integrationTable.headers.map(header=>header.title),['Lane','Baseline','Band','Band area','Peak signal','Raw area','Baseline area']);
      for(const header of integrationTable.headers)assert.ok(header.width+1>=header.content&&header.height+1>=header.contentHeight,`Full integration header at ${width}: ${JSON.stringify(header)}`);
      for(const cell of integrationTable.cells)assert.ok(cell.width+1>=cell.content,`Full integration value at ${width}: ${JSON.stringify(cell)}`);
      assert.ok(integrationTable.holder.scroll>integrationTable.holder.width,'The table scrolls instead of shrinking columns');
      assert.ok(integrationTable.holder.height>=28,'At least one data row fits below the wrapped headers');
      assert.ok(integrationTable.mainScroll<=integrationTable.mainWidth+1,'Horizontal scrolling stays inside the table');
      await exec("document.querySelector('#gel-peak-editor-table .tabulator-tableholder').scrollLeft=10000");await settle();
      const end=await exec("(()=>{const holder=document.querySelector('#gel-peak-editor-table .tabulator-tableholder'),last=document.querySelector('#gel-peak-editor-table .tabulator-row .tabulator-cell[tabulator-field=baselineArea]');return {scroll:holder.scrollLeft,last:last.getBoundingClientRect().toJSON(),holder:holder.getBoundingClientRect().toJSON()}})()");
      assert.ok(end.scroll>0&&end.last.right<=end.holder.right+1&&end.last.left>=end.holder.left-1,'The last measurement is reachable by scrolling');
      await exec("document.querySelector('#gel-peak-editor-table .tabulator-tableholder').scrollLeft=0");
      fs.writeFileSync(path.join(output,`band-integration-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
    win.setSize(1400,900);await settle();await exec("document.body.classList.remove('theme-night')");
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(output,'band-integration-light.png'),(await win.webContents.capturePage()).toPNG());
    await exec('controller.destroy()');
    assert.equal(await exec("document.querySelector('.gel-floating-layer')"),null);
    assert.equal(await exec("document.querySelector('.gel-divider-menu')"),null,'Destroy removes the divider menu');
    assert.deepEqual(errors,[]);
    console.log('gel-floating-workspace-electron: passed (Band intensity graph/table/copy/live labels/empty state, stacked windows and bounds at 4 sizes, divider tolerance, MW editing, light/dark, table dock, crop rotation, disposal)');
  } finally { win.destroy();app.quit(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1);});
