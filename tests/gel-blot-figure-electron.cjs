'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-blot-figure-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
        encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL'
      });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Blot figure QA failed (${result.signal || result.status})`));
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2]; app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const dir = path.join(root, 'src/plugins/gel');
  const url = file => pathToFileURL(path.join(dir, file)).href;
  const output = path.join(root, 'artifacts/gel-blot-figure'); fs.mkdirSync(output, { recursive: true });
  const styles = ['vendor/cropperjs/cropper.min.css', 'vendor/tabulator/tabulator.min.css',
    'vendor/css/base/palette.css', 'vendor/css/base/core.css', 'vendor/css/themes/modes.css',
    'vendor/css/views/gel-palette.css', 'vendor/css/views/gel-view.css',
    'vendor/css/overrides/cross-view-fixes.css', 'vendor/css/overrides/left-rail-template.css',
    'vendor/css/overrides/universal-dialogs.css', 'style.css', 'floating-workspace.css'];
  const markup = fs.readFileSync(path.join(dir, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    ${styles.map(file => `<link rel="stylesheet" href="${url(file)}">`).join('\n')}
    <script src="${url('vendor/cropperjs/cropper.min.js')}"></script>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <script src="${url('vendor/pptxgenjs/pptxgen.bundle.js')}"></script>
    </head><body class="plugin-gel"><div id="gel-host">${markup}</div>
    <script type="module">
      import { initGelAnalysis } from '${url('workspace/index.js')}';
      import { parseBlotProject, serializeBlotProject } from '${url('workspace/figure/project.js')}';
      import { buildBlotFigurePlan, validatePlacement } from '${url('workspace/figure/model.js')}';
      import { createBlotFigureCanvas } from '${url('workspace/figure/render.js')}';
      import { normalizeStackTrim } from '${url('workspace/figure/trim.js')}';
      import { decodeImageFile } from '${url('workspace/images/image-io.js')}';
      window.exports=[]; window.cancelExport=false;
      window.hikariApi={
        exportBinaryFile:async data=>{exports.push(data);return {saved:!cancelExport}},
        exportTextFile:async data=>{exports.push(data);return {saved:!cancelExport}}
      };
      window.controller=initGelAnalysis({state:{gelAnalyses:[]},persist:async()=>{},createId:()=>crypto.randomUUID(),
        safeText:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),document});
      controller.render();
      window.el=id=>document.getElementById(id);
      window.click=id=>el(id).click();
      window.action=name=>document.querySelector('[data-figure-action="'+name+'"]').click();
      window.set=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new Event('input',{bubbles:true}));el(id).dispatchEvent(new Event('change',{bubbles:true}))};
      window.field=(name,value)=>{const input=document.querySelector('[data-figure-field="'+name+'"]');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))};
      window.select=index=>document.querySelectorAll('[data-figure-row]')[index].click();
      window.check=(index,value)=>{const input=document.querySelectorAll('[data-figure-include]')[index];if(input.checked!==value)input.click()};
      window.stackView=()=>document.querySelector('[data-figure-stack-view]').click();
      window.count=()=>document.querySelectorAll('[data-figure-row]').length;
      window.file=async(name,width,height,first,last)=>{
        const c=document.createElement('canvas');c.width=width;c.height=height;
        const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,width,height);
        ctx.fillStyle='#222';for(let i=0;i<6;i++)ctx.fillRect(width*(first+(last-first)*i/5)-8,height*.45,16,12);
        return new File([await new Promise(r=>c.toBlob(r))],name,{type:'image/png'});
      };
      window.load=async(id,files)=>{const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));el(id).files=transfer.files;el(id).dispatchEvent(new Event('change'))};
      window.pngInfo=async()=>{
        const data=exports.findLast(item=>item.fileName.endsWith('.png'));const image=new Image();
        image.src='data:image/png;base64,'+data.dataBase64;await image.decode();
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,c.width,c.height).data;let cyan=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i]<50&&pixels[i+1]>100&&pixels[i+2]>100)cyan++;
        const bandRows=[];let lastBandY=-2;
        for(let y=300;y<c.height;y++){
          const centers=[];let start=-1;
          for(let x=642;x<=c.width;x++){
            const i=(y*c.width+x)*4;const dark=x<c.width&&pixels[i]<60&&pixels[i+1]<60&&pixels[i+2]<60;
            if(dark&&start<0)start=x;
            if(!dark&&start>=0){if(x-start>3)centers.push((start+x)/2);start=-1}
          }
          if(centers.length===6){if(y>lastBandY+1)bandRows.push(centers);lastBandY=y}
        }
        return {width:c.width,height:c.height,cyan,bandRows};
      };
      window.pptxInfo=async()=>{
        const data=exports.findLast(item=>item.fileName.endsWith('.pptx'));
        const zip=await JSZip.loadAsync(data.dataBase64,{base64:true});const xml=await zip.file('ppt/slides/slide1.xml').async('string');
        return {xml,images:Object.keys(zip.files).filter(p=>/^ppt\\/media\\/.+\\.png$/.test(p)).length};
      };
      window.precisionCheck=async()=>{
        const image=await decodeImageFile(await file('16-bit.png',80,40,.1,.9));image.grayBitDepth=16;image.gray[12]=0.12345678;
        const row={id:'a',label:'<β-actin & ERK>',placement:{first:10,last:90,top:0,bottom:100},draft:{
          currentImage:image,originalImage:image,cropApplied:false,controls:{'gel-id':'saved-record-id'},manualOverrides:{},viewerMode:'original'}};
        const toUrl=data=>{const c=document.createElement('canvas');c.width=data.width;c.height=data.height;c.getContext('2d').putImageData(data,0,0);return c.toDataURL()};
        const parsed=await parseBlotProject(serializeBlotProject([row],'test',toUrl),()=>crypto.randomUUID());
        const manual=await parseBlotProject(serializeBlotProject([row],'trimmed',toUrl,{stackTrim:{mode:'manual',left:12,right:87}}),()=>crypto.randomUUID());
        const legacy=JSON.parse(serializeBlotProject([row],'legacy',toUrl));legacy.version=1;delete legacy.stack;delete legacy.checked;delete legacy.view;delete legacy.stackTrim;
        const migrated=await parseBlotProject(JSON.stringify(legacy),()=>crypto.randomUUID());
        let rejected=0;for(const value of [{first:30,last:20,top:0,bottom:100},{first:0,last:1,top:0,bottom:100},{first:10,last:90,top:100,bottom:50}]){try{validatePlacement(value)}catch{rejected++}}
        const geometry=buildBlotFigurePlan([row,{...row,id:'b',draft:{...row.draft,currentImage:{...image,width:100}},placement:{first:20,last:80,top:20,bottom:80}}]);
        const auto=buildBlotFigurePlan([row,{...row,id:'b',draft:{...row.draft,currentImage:{...image,width:100}},placement:{first:20,last:80,top:20,bottom:80}}],{trim:{mode:'auto'}});
        let badTrim=0;for(const value of [{mode:'manual',left:70,right:40},{mode:'manual',left:-1,right:100},{mode:'manual',left:0,right:NaN}]){try{normalizeStackTrim(value)}catch{badTrim++}}
        return {grayEqual:image.gray[12]===parsed.rows[0].draft.currentImage.gray[12],label:parsed.rows[0].label,
          recordId:parsed.rows[0].draft.controls['gel-id'],rejected,legacyStack:migrated.stackIds.length===1&&migrated.selectedId==='stack'&&migrated.stackTrim.mode==='none',
          manualTrim:manual.stackTrim,badTrim,autoNarrower:auto.imageWidth<geometry.imageWidth,
          fullCoverage:auto.rows.every(part=>part.imageX<=.001&&part.imageX+part.imageWidth>=auto.imageWidth-.001),
          guides:[geometry.guideLeft,geometry.guideRight],
          noClipping:geometry.rows.every(part=>part.imageX>=0&&part.imageX+part.imageWidth<=geometry.imageWidth+.001),
          positions:geometry.rows.map((part,i)=>[part.imageX+[8,20][i]*part.imageWidth/[80,100][i],part.imageX+[72,80][i]*part.imageWidth/[80,100][i]])};
      };
      window.headerCheck=async()=>{
        const project=JSON.parse(exports.findLast(item=>item.content).content);
        const parsed=await parseBlotProject(JSON.stringify(project),()=>crypto.randomUUID());
        const members=parsed.rows.filter(row=>parsed.stackIds.includes(row.id));
        const plan=buildBlotFigurePlan(members,{tableSource:parsed.tableSource,trim:parsed.stackTrim});
        const referenceIndex=members.findIndex(row=>row.id===plan.table.sourceId);
        const part=plan.rows[referenceIndex],reference=members[referenceIndex];
        const source=reference.draft.manualOverrides.laneSegmentation;
        const boundaries=[source.gelLeft,...source.dividers,source.gelRight];
        return {tableTop:plan.table.y,tableBottom:plan.table.y+plan.table.height,blotTop:plan.blotTop,
          values:plan.table.rows[0].values,
          centers:plan.table.columns.map(column=>column.center),
          expected:boundaries.slice(0,-1).map((left,i)=>part.imageX+Math.round((left+boundaries[i+1]-1)/2)/reference.draft.currentImage.width*part.imageWidth)};
      };
      window.trimCheck=async()=>{
        const parsed=await parseBlotProject(exports.findLast(item=>item.content).content,()=>crypto.randomUUID());
        const members=parsed.rows.filter(row=>parsed.stackIds.includes(row.id));
        const output=createBlotFigureCanvas(members,document,{tableSource:parsed.tableSource,trim:parsed.stackTrim});
        return {mode:parsed.stackTrim.mode,imageWidth:output.plan.imageWidth,fullImageWidth:output.plan.fullImageWidth,
          coverage:output.plan.rows.every(part=>part.imageX<=.001&&part.imageX+part.imageWidth>=output.plan.imageWidth-.001),
          edges:output.blotCanvases.map(canvas=>{const ctx=canvas.getContext('2d'),y=Math.floor(canvas.height*.15);return [ctx.getImageData(3,y,1,1).data[0],ctx.getImageData(canvas.width-4,y,1,1).data[0]]}),
          crop:output.plan.crop};
      };
      window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1440, height: 950, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = async code => {
    try { return await win.webContents.executeJavaScript(/\bawait\b/.test(code) ? `(async()=>{${code}})()` : code, true); }
    catch (error) { throw new Error(`${code}\n${errors.join('\n')}\n${error.message}`); }
  };
  async function waitFor(code) {
    for (let i = 0; i < 150; i++) { if (await exec(code)) return; await new Promise(r => setTimeout(r, 30)); }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  }
  const settle = () => exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  try {
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    const precision = await exec('precisionCheck()');
    assert.equal(precision.grayEqual, true); assert.equal(precision.label, '<β-actin & ERK>');
    assert.equal(precision.recordId, ''); assert.equal(precision.rejected, 3);
    assert.equal(precision.legacyStack, true, 'Earlier figure projects open as a Stack');
    assert.deepEqual(precision.manualTrim, { mode: 'manual', left: 12, right: 87 });
    assert.equal(precision.badTrim, 3); assert.equal(precision.autoNarrower, true); assert.equal(precision.fullCoverage, true);
    precision.positions.forEach(([first, last]) => { assert.ok(Math.abs(first - precision.guides[0]) < 0.001); assert.ok(Math.abs(last - precision.guides[1]) < 0.001); });
    assert.equal(precision.noClipping, true);
    await exec("load('gel-image-file',[await file('ERK.png',900,220,.1,.9)])");
    await waitFor("!el('gel-crop-mode-btn').disabled");
    await exec("set('gel-name','ERK gel');set('gel-contrast-strength','70');click('gel-process-image-btn');set('gel-expected-lane-count','6');click('gel-auto-detect-lanes-btn');click('gel-tool-dividers-btn');click('gel-open-lane-table-btn');click('gel-add-table-btn');const label=document.querySelector('[data-gel-table-role=label]');label.value='Condition';label.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('[data-gel-table-role=value]').forEach((input,i)=>{input.value='S'+(i+1);input.dispatchEvent(new Event('input',{bubbles:true}))});click('gel-open-figure-btn');action('add')");
    assert.equal(await exec('count()'), 1);
    assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /^Gel 1/);
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Gel 1');
    assert.equal(await exec("document.querySelector('[data-figure-action=stack]').disabled"), true);
    assert.equal(await exec("el('gel-blot-figure').hidden"), false);
    assert.deepEqual(await exec("[...document.querySelectorAll('.gel-figure-header > button')].map(button=>button.textContent)"), ['Add', 'Save project', 'Done']);
    const addMenu = await exec("(()=>{const picked=[],ids=['gel-figure-files','gel-figure-project-file'];ids.forEach(id=>{el(id).click=()=>picked.push(id)});const shown=[];for(const name of ['import','open']){click('gel-figure-add-btn');shown.push(el('gel-figure-add-menu').matches(':popover-open'));action(name)}ids.forEach(id=>delete el(id).click);return {picked,shown,open:el('gel-figure-add-menu').matches(':popover-open')}})()");
    assert.deepEqual(addMenu, { picked: ['gel-figure-files', 'gel-figure-project-file'], shown: [true, true], open: false }, 'The Add menu picks image files and projects, then closes');
    await exec("set('gel-figure-antibody','p-ERK1/2');load('gel-figure-files',[await file('Actin.png',720,200,.2,.8),new File(['bad'],'bad.png',{type:'image/png'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 2, 'A bad file does not discard the good imports');
    assert.match(await exec("document.querySelectorAll('[data-figure-row]')[1].textContent"), /^Gel 2/);
    assert.match(await exec("el('gel-figure-status').textContent"), /bad.png/);
    await exec("check(0,false);document.querySelectorAll('[data-figure-include]')[0].dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert.equal(await exec("document.querySelectorAll('[data-figure-include]:checked').length"), 2, 'Keyboard undo works while a selection checkbox is focused');
    await exec("set('gel-figure-antibody','β-actin');field('first',20);field('last',80);field('top',25);field('bottom',75)");
    assert.equal(await exec("document.querySelector('[data-figure-field=first]').value"), '20');
    await exec("field('first',99)");
    assert.equal(await exec("document.querySelector('[data-figure-field=first]').value"), '20', 'Invalid coordinates are rejected');
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const single = await exec('pptxInfo()');
    assert.equal(single.images, 1); assert.match(single.xml, /β-actin/); assert.doesNotMatch(single.xml, /p-ERK1\/2/);
    await exec("action('edit')");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true);
    assert.equal(await exec("el('gel-name').value"), 'β-actin', 'Processing uses the renamed layer name');
    await exec("set('gel-contrast-strength','30');click('gel-process-image-btn');click('gel-open-figure-btn');select(0);action('edit')");
    assert.equal(await exec("el('gel-contrast-strength').value"), '70', 'Each blot retains its enhancement settings');
    assert.equal(await exec("document.querySelector('[data-gel-table-role=label]').value"), 'Condition', 'Lane table edits remain with their blot');
    assert.equal(await exec("el('gel-process-image-btn').getAttribute('aria-pressed')"), 'true');
    await exec("click('gel-open-figure-btn');select(1);action('edit')");
    assert.equal(await exec("el('gel-contrast-strength').value"), '30');
    await exec("click('gel-open-figure-btn');select(1);action('up')");
    assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /β-actin/);
    await exec('controller.undo()'); assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /p-ERK/);
    await exec('controller.redo()'); assert.match(await exec("document.querySelector('[data-figure-row]').textContent"), /β-actin/);
    await exec("action('remove')"); assert.equal(await exec('count()'), 1);
    await exec('controller.undo()'); assert.equal(await exec('count()'), 2);
    // Direct manipulation in the preview: hovering outlines the blot, dragging it slides
    // it (anchors shift together), and dragging its top edge crops it.
    await exec("select(0)"); await settle();
    const fieldValue = name => exec(`Number(document.querySelector('[data-figure-field=${name}]').value)`);
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const canvasBox = await exec("document.querySelector('#gel-figure-preview canvas').getBoundingClientRect().toJSON()");
    const middle = { x: canvasBox.x + canvasBox.width * 0.6, y: canvasBox.y + canvasBox.height / 2 };
    mouse('mouseMove', middle.x, middle.y); await settle();
    const hover = await exec("(()=>{const box=document.querySelector('.gel-figure-hover-box');return {hidden:box.hidden,rect:box.getBoundingClientRect().toJSON(),cursor:el('gel-figure-preview').style.cursor}})()");
    assert.equal(hover.hidden, false, 'Hovering a blot outlines it');
    assert.equal(hover.cursor, 'grab');
    const before = { first: await fieldValue('first'), last: await fieldValue('last'), top: await fieldValue('top') };
    mouse('mouseDown', middle.x, middle.y); mouse('mouseMove', middle.x + 40, middle.y); await settle();
    mouse('mouseUp', middle.x + 40, middle.y); await settle();
    const moved = { first: await fieldValue('first'), last: await fieldValue('last') };
    assert.ok(moved.first < before.first - 1, `Dragging right slides the blot: ${JSON.stringify({ before, moved })}`);
    assert.ok(Math.abs((moved.last - moved.first) - (before.last - before.first)) < 0.2, 'A move keeps the lane spacing');
    const edge = { x: middle.x, y: hover.rect.y + 2 };
    mouse('mouseMove', edge.x, edge.y); await settle();
    assert.equal(await exec("el('gel-figure-preview').style.cursor"), 'ns-resize', 'The top edge offers a crop');
    mouse('mouseDown', edge.x, edge.y); mouse('mouseMove', edge.x, edge.y + 15); await settle();
    mouse('mouseUp', edge.x, edge.y + 15); await settle();
    assert.ok(await fieldValue('top') > before.top + 1, 'Dragging the top edge down crops the blot');
    await exec('controller.undo()');
    assert.ok(Math.abs(await fieldValue('top') - before.top) < 0.05, 'Undo restores the crop');
    await exec('controller.undo()');
    assert.ok(Math.abs(await fieldValue('first') - before.first) < 0.05, 'Undo restores the position');
    // Place the first anchor at 20% again for the checks below.
    await exec("field('first',20);field('last',80)");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'β-actin', 'Focusing a gel previews that layer independently');
    const layerBounds = await exec("document.querySelector('[data-figure-row]').getBoundingClientRect().toJSON()");
    const point = { x: Math.round(layerBounds.x + layerBounds.width / 2), y: Math.round(layerBounds.y + layerBounds.height / 2) };
    for (const clickCount of [1, 2]) {
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount, ...point });
    }
    await settle();
    assert.equal(await exec('document.activeElement.id'), 'gel-figure-antibody', 'Double-clicking a layer focuses its rename field');
    fs.writeFileSync(path.join(output, 'layer.png'), (await win.webContents.capturePage()).toPNG());
    await exec("action('stack')");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Stack');
    assert.equal(await exec("el('gel-figure-preview-detail').textContent"), '2 gels');
    assert.equal(await exec("el('gel-figure-placement').hidden"), true, 'Stack has its own view');
    assert.equal(await exec("el('gel-figure-stack-trim').hidden"), false);
    const integrated = await exec("(()=>{const panel=el('gel-blot-figure'),stage=el('gel-viewer-stage'),rail=document.querySelector('.gel-setup-panel');return {inStage:panel.parentElement===stage,editorVisible:!document.querySelector('.gel-main-stack').hidden,railVisible:rail.checkVisibility(),railInteractive:!rail.inert,toolbarVisible:document.querySelector('.gel-viewer-toolbar').checkVisibility(),originalVisible:el('gel-image-row').checkVisibility()}})()");
    assert.deepEqual(integrated, { inStage: true, editorVisible: true, railVisible: true, railInteractive: true, toolbarVisible: true, originalVisible: false }, 'Stack stays inside the existing viewer with its sidebar and toolbars');
    await exec("click('gel-export-image-btn')"); await waitFor("el('gel-figure-status').textContent==='PNG exported.'");
    const untrimmedPng = await exec('pngInfo()');
    await exec("action('trim')");
    const autoLeft = Number(await exec("el('gel-figure-trim-left').value"));
    const autoRight = Number(await exec("el('gel-figure-trim-right').value"));
    assert.ok(autoLeft > 0 && autoRight < 100, 'Trim excess removes unequal outer margins');
    await exec('controller.undo()');
    assert.equal(await exec("el('gel-figure-trim-left').value"), '0');
    assert.equal(await exec("el('gel-figure-trim-right').value"), '100');
    await exec('controller.redo()');
    assert.equal(await exec("document.querySelector('[data-figure-action=trim]').getAttribute('aria-pressed')"), 'true');
    await exec("set('gel-figure-trim-left',100)");
    assert.equal(Number(await exec("el('gel-figure-trim-left').value")), autoLeft, 'Invalid trim does not change the crop');
    await exec(`set('gel-figure-trim-left',${autoLeft + 1});set('gel-figure-trim-right',${autoRight - 1})`);
    assert.equal(await exec("document.querySelector('[data-figure-action=trim]').getAttribute('aria-pressed')"), 'false', 'Manual trim can refine both edges');
    await exec("action('reset-trim')");
    assert.equal(await exec("el('gel-figure-trim-left').value"), '0');
    assert.equal(await exec("el('gel-figure-trim-right').value"), '100');
    await exec("action('trim');action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const trimmed = await exec('trimCheck()');
    assert.equal(trimmed.mode, 'auto'); assert.equal(trimmed.coverage, true);
    assert.ok(trimmed.imageWidth < trimmed.fullImageWidth);
    trimmed.edges.forEach(([left, right]) => assert.ok(left < 253 && right < 253, `Both blot edges contain image pixels (${left}, ${right})`));
    for (const [width, height] of [[1440, 950], [1024, 768], [800, 700], [600, 800]]) {
      win.setSize(width, height); await settle();
      const bounds = await exec("(()=>{const p=el('gel-blot-figure').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,bottom:p.bottom,width:innerWidth,height:innerHeight,client:el('gel-blot-figure').clientWidth,scroll:el('gel-blot-figure').scrollWidth}})()");
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1, `Board fits ${width}×${height}`);
      assert.ok(bounds.scroll <= bounds.client + 1, `No horizontal overflow at ${width}×${height}`);
      const geometry = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel').getBoundingClientRect(),toolbar=document.querySelector('.gel-viewer-toolbar').getBoundingClientRect(),stage=el('gel-viewer-stage').getBoundingClientRect(),panel=el('gel-blot-figure').getBoundingClientRect();return {railRight:rail.right,stageLeft:stage.left,toolbarBottom:toolbar.bottom,toolbarLeft:toolbar.left,stageTop:stage.top,stageRight:stage.right,panelRight:panel.right,previewWidth:el('gel-figure-preview').clientWidth}})()");
      assert.ok(geometry.railRight <= geometry.stageLeft && (geometry.toolbarLeft >= geometry.stageRight || geometry.toolbarBottom <= geometry.stageTop) && geometry.panelRight <= geometry.stageRight + 1 && geometry.previewWidth > 0, `Stack shares the Gel layout at ${width}×${height}`);
    }
    win.setSize(1440, 950); await settle();
    // Measure after the window is back to size: a resize round trip can return a
    // window one pixel taller, which is not what this check is about.
    const workspaceSettled = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel'),toolbar=document.querySelector('.gel-viewer-toolbar');return {rail:rail.getBoundingClientRect().toJSON(),toolbar:toolbar.getBoundingClientRect().toJSON()}})()");
    fs.writeFileSync(path.join(output, 'figure.png'), (await win.webContents.capturePage()).toPNG());
    // focus() defers focusin until the window has OS focus, which another app can hold;
    // deliver the event the rail listens for so the check does not depend on the desktop.
    await exec("select(0);const c=el('gel-contrast-strength');c.focus();if(!document.hasFocus())c.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'Using the setup sidebar resumes processing in the current viewer');
    assert.equal(await exec("el('gel-name').value"), 'β-actin');
    assert.equal(await exec('document.activeElement.id'), 'gel-contrast-strength', 'Keyboard focus stays on the requested processing control');
    const workspaceAfter = await exec("(()=>{const rail=document.querySelector('.gel-setup-panel'),toolbar=document.querySelector('.gel-viewer-toolbar');return {rail:rail.getBoundingClientRect().toJSON(),toolbar:toolbar.getBoundingClientRect().toJSON()}})()");
    assert.deepEqual(workspaceAfter, workspaceSettled, 'Switching back to processing retains the same sidebar and toolbar geometry');
    await exec("click('gel-open-figure-btn');stackView()");
    await exec("document.body.classList.add('theme-night')"); await new Promise(r => setTimeout(r, 350));
    fs.writeFileSync(path.join(output, 'figure-night.png'), (await win.webContents.capturePage()).toPNG());
    await exec("click('gel-export-image-btn')"); await waitFor("el('gel-figure-status').textContent==='PNG exported.'");
    const png = await exec('pngInfo()'); assert.ok(png.width > 3400); assert.ok(png.height > 300); assert.equal(png.cyan, 0);
    assert.ok(png.width < untrimmedPng.width, 'PNG exports use the same cropped width as the preview');
    assert.equal(png.bandRows.length, 2);
    png.bandRows[0].forEach((center, index) => assert.ok(Math.abs(center - png.bandRows[1][index]) < 20, 'Exported band centers align across blots'));
    const pngData = await exec("exports.findLast(item=>item.fileName.endsWith('.png'))");
    fs.writeFileSync(path.join(output, 'export.png'), Buffer.from(pngData.dataBase64, 'base64'));
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const pptx = await exec('pptxInfo()'); assert.equal(pptx.images, 2, 'The existing viewer export includes the visible Stack');
    assert.match(pptx.xml, /<a:t>β-actin<\/a:t>/); assert.match(pptx.xml, /<a:t>p-ERK1\/2<\/a:t>/);
    assert.match(pptx.xml, /<a:t>Condition<\/a:t>/); assert.match(pptx.xml, /<a:t>S6<\/a:t>/);
    assert.equal((pptx.xml.match(/<a:tbl>/g) || []).length, 6, 'Shared lane table cells remain native PowerPoint tables');
    assert.equal((pptx.xml.match(/<p:pic>/g) || []).length, 2, 'Blots remain separate slide images');
    assert.doesNotMatch(pptx.xml, /anchor="mid"/);
    const pptxData = await exec("exports.findLast(item=>item.fileName.endsWith('.pptx'))");
    fs.writeFileSync(path.join(output, 'export.pptx'), Buffer.from(pptxData.dataBase64, 'base64'));
    await exec("action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    const header = await exec('headerCheck()');
    assert.ok(header.tableBottom < header.blotTop, 'Shared lane table is above the entire blot stack');
    assert.deepEqual(header.values, [['S1'], ['S2'], ['S3'], ['S4'], ['S5'], ['S6']]);
    header.centers.forEach((center, index) => assert.ok(Math.abs(center - header.expected[index]) < 0.001, 'Table columns use the reference blot lane coordinates'));
    await exec("set('gel-figure-table-source','none');click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    assert.doesNotMatch((await exec('pptxInfo()')).xml, /<a:tbl>/, 'The shared header can be hidden');
    await exec("set('gel-figure-table-source','auto')");
    await exec("load('gel-figure-files',[await file('GAPDH.png',800,200,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 3);
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Gel 3');
    await exec("set('gel-figure-antibody','GAPDH');stackView()");
    assert.equal(await exec("el('gel-figure-preview-detail').textContent"), '2 gels', 'Importing a layer keeps the existing Stack intact');
    await exec("check(1,false);action('stack');click('gel-export-pptx-btn')");
    await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const subset = await exec('pptxInfo()');
    assert.equal(subset.images, 2); assert.match(subset.xml, /<a:t>GAPDH<\/a:t>/);
    assert.match(subset.xml, /<a:t>β-actin<\/a:t>/); assert.doesNotMatch(subset.xml, /p-ERK1\/2|Condition/);
    assert.equal(await exec('count()'), 3, 'Stack keeps excluded gel layers available');
    await exec("controller.undo()");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Stack');
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    assert.match((await exec('pptxInfo()')).xml, /p-ERK1\/2/, 'Undo restores the previous Stack membership');
    await exec("el('gel-figure-select-all').click();check(2,false);action('stack')");
    await exec("select(0);click('gel-crop-mode-btn')");
    assert.equal(await exec("el('gel-blot-figure').hidden"), true, 'The existing crop control resumes the selected layer');
    assert.equal(await exec("el('gel-name').value"), 'β-actin');
    await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("el('gel-cropper-image').cropper.setData({x:0,y:40,width:720,height:120,rotate:0});click('gel-apply-crop-btn');click('gel-open-figure-btn');select(1);action('edit')");
    assert.equal(await exec("el('gel-canvas').width"), 900, 'Cropping another blot leaves the first intact');
    await exec("click('gel-open-figure-btn');select(0);action('edit')");
    assert.equal(await exec("el('gel-canvas').height"), 120, 'Individual crops survive switching');
    // Reset lives in crop mode: it shows the full original, and Done keeps it.
    await exec("click('gel-crop-mode-btn')"); await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("click('gel-reset-crop-btn')"); await waitFor("el('gel-cropper-image').cropper?.ready");
    await exec("click('gel-apply-crop-btn')");
    assert.equal(await exec("el('gel-canvas').height"), 200, 'Reset restores this blot original');
    await exec("click('gel-open-figure-btn')");
    await exec("cancelExport=true;action('save')"); await waitFor("el('gel-figure-status').textContent==='Save canceled.'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), true);
    await exec("cancelExport=false;action('save')"); await waitFor("el('gel-figure-status').textContent==='Figure project saved.'");
    assert.equal(await exec('controller.hasUnsavedChanges()'), false);
    assert.equal(await exec('controller.saveUnsavedChanges()'), true);
    const savedProject = await exec("exports.findLast(item=>item.content).content");
    const savedLayers = JSON.parse(savedProject);
    assert.equal(savedLayers.version, 2); assert.equal(savedLayers.rows.length, 3);
    assert.equal(savedLayers.stackTrim.mode, 'auto');
    assert.deepEqual(savedLayers.stack, [0, 1]); assert.deepEqual(savedLayers.checked, [0, 1]);
    await exec("window.savedProject=exports.findLast(item=>item.content).content;load('gel-figure-project-file',[new File([savedProject],'figure.json',{type:'application/json'})])");
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'), 6, 'Opening a project preserves existing layers');
    await exec("load('gel-figure-project-file',[new File(['{}'],'bad.json',{type:'application/json'})])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec('count()'), 6); assert.match(await exec("el('gel-figure-status').textContent"), /supported/);
    await exec('controller.destroy()'); assert.equal(await exec("el('gel-blot-figure')"), null);
    await win.loadFile(fixture); await waitFor('Boolean(window.ready)');
    await exec(`window.savedProject=${JSON.stringify(savedProject)};click('gel-open-figure-btn');load('gel-figure-project-file',[new File([savedProject],'layers.json',{type:'application/json'})])`);
    await waitFor("el('gel-figure-status').textContent==='Figure project opened.'");
    assert.equal(await exec('count()'), 3);
    assert.equal(await exec("document.querySelectorAll('[data-figure-include]:checked').length"), 2);
    await exec("stackView()");
    assert.equal(await exec("document.querySelector('[data-figure-action=trim]').getAttribute('aria-pressed')"), 'true', 'Saved projects restore Stack trim');
    assert.ok(Number(await exec("el('gel-figure-trim-left').value")) > 0);
    await exec("click('gel-export-pptx-btn')"); await waitFor("el('gel-figure-status').textContent==='PPTX exported.'");
    const restored = await exec('pptxInfo()');
    assert.equal(restored.images, 2); assert.match(restored.xml, /p-ERK1\/2/); assert.doesNotMatch(restored.xml, /GAPDH/);
    // In a Stack, dragging one blot aligns that blot only.
    const stacked = await exec("[...document.querySelectorAll('[data-figure-include]')].map((input,i)=>input.checked?i:-1).filter(i=>i>=0)");
    const firstOf = async index => { await exec(`select(${index})`); return Number(await exec("document.querySelector('[data-figure-field=first]').value")); };
    const stackBefore = [await firstOf(stacked[0]), await firstOf(stacked[1])];
    await exec("stackView()"); await settle();
    const lower = await exec(`(()=>{const p=el('gel-figure-preview'),c=p.querySelector('canvas').getBoundingClientRect(),box=p.querySelector('.gel-figure-hover-box'),x=c.left+c.width*.6;
      for(let y=c.bottom-3;y>c.top;y-=4){p.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));if(!box.hidden){const r=box.getBoundingClientRect();return {x,y:r.top+r.height/2};}}return null})()`);
    assert.ok(lower, 'The lower Stack blot can be hovered');
    const stackMouse = (type, x) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(lower.y), button: 'left', clickCount: 1 });
    stackMouse('mouseMove', lower.x); await settle();
    fs.writeFileSync(path.join(output, 'stack-hover.png'), (await win.webContents.capturePage()).toPNG());
    stackMouse('mouseDown', lower.x); stackMouse('mouseMove', lower.x + 40); await settle(); stackMouse('mouseUp', lower.x + 40); await settle();
    const stackAfter = [await firstOf(stacked[0]), await firstOf(stacked[1])];
    assert.equal(stackAfter[0], stackBefore[0], 'The other Stack blot stays put');
    assert.ok(stackAfter[1] < stackBefore[1] - 1, `The dragged Stack blot moves: ${JSON.stringify({ stackBefore, stackAfter })}`);
    await exec('controller.undo()'); await exec("stackView()");
    // Dragging a Stack blot up past the one above reorders the Stack and the layer list.
    const stackOrder = () => exec("[...document.querySelectorAll('[data-figure-include]')].filter(input=>input.checked).map(input=>input.closest('.gel-figure-layer').querySelector('[data-figure-row]').textContent.trim())");
    const orderBefore = await stackOrder();
    const top = await exec("document.querySelector('#gel-figure-preview canvas').getBoundingClientRect().top");
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(lower.x), y: Math.round(lower.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(lower.x), y: Math.round(top + 4), button: 'left' }); await settle();
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(lower.x), y: Math.round(top + 4), button: 'left', clickCount: 1 }); await settle();
    assert.deepEqual(await stackOrder(), [...orderBefore].reverse(), 'Dragging a blot above another reorders the Stack');
    await exec('controller.undo()');
    assert.deepEqual(await stackOrder(), orderBefore, 'Undo restores the Stack order');
    await exec("stackView()");
    await exec("load('gel-figure-files',[await file('next.png',600,120,.1,.9)])");
    await waitFor("el('gel-blot-figure').getAttribute('aria-busy')==='false'");
    assert.equal(await exec("el('gel-figure-preview-title').textContent"), 'Gel 4');
    await exec('controller.destroy()');
    assert.deepEqual(errors, []);
    console.log('gel-blot-figure-electron: passed (shared Gel workspace, sidebar/toolbars, Add menu, named layers, Stack, trim, viewer exports, per-gel processing, lane/table alignment, 4 viewports, PNG/PPTX, project roundtrip, precision, disposal)');
  } finally { win.destroy(); app.quit(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; if (process.versions.electron) require('electron').app.exit(1); });
