// Production Notebook and Transform Plate controllers with real Tabulator input.
// Run: node tests/spreadsheet-fill-electron.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-fill-'));
  const result = spawnSync(require('electron'), [__filename, temp], { encoding: 'utf8', timeout: 60000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  fs.rmSync(temp, { recursive: true, force: true });
  if (result.status !== 0) throw result.error || new Error(`Fill QA failed: ${result.status}`);
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  const output = path.join(root, 'artifacts/spreadsheet-fill');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  const url = file => pathToFileURL(path.join(root, file)).href;
  const html = `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="${url('vendor/tabulator/tabulator.min.css')}">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0;padding:2rem;background:var(--theme-background)}
    main{max-width:58rem;margin:auto}section{margin-bottom:2.5rem}h2{font-size:1rem;margin:0 0 1rem}
    #plate{overflow:auto} .tabulator{max-width:100%}</style>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <main><section><h2>Notebook · Results table</h2><div id="notebook"></div></section>
    <section id="plate-panel"><h2>Assay · Transformed Plate (Table2)</h2><div id="plate"></div></section></main>
    <script type="module">
      import {createSpreadsheetTables} from '${url('src/renderer/modules/biology-notebook/spreadsheet-tables/index.js')}';
      import {createAssayAnalysisView} from '${url('src/renderer/modules/assay/analysis-view.js')}';
      import {createResultGridModel} from '${url('src/renderer/modules/assay/results/grid-model.js')}';
      const def={rows:4,columns:6};
      const runtime={currentResults:{},currentLayout:[]};
      for(let r=0;r<4;r++)for(let c=0;c<6;c++){
        const well=String.fromCharCode(65+r)+(c+1);
        if(well==='B2')continue;
        runtime.currentResults[well]=String(10+r+c);
        runtime.currentLayout.push({well,sampleId:'Sample '+(r+1),concentration:String(c+1)});
      }
      const model=createResultGridModel({runtime,getSampleAxis:()=> 'row',
        isMappedWell:well=>runtime.currentLayout.some(item=>item.well===well),
        escapeHtml:String,toResultField:c=>'c'+(c+1)});
      const notebook=createSpreadsheetTables({host:document.getElementById('notebook'),TabulatorLib:Tabulator,createId:()=>crypto.randomUUID()});
      notebook.renderEditor([{id:'qa',columns:[{field:'a',title:'Input'},{field:'b',title:'Response'},{field:'c',title:'Replicate'}],
        rows:Array.from({length:4},(_,r)=>({id:'r'+r,a:String(10+r),b:r?'':'=A1*2',c:''}))}]);
      let commits=0;
      const plate=createAssayAnalysisView({safeText:String,runtime,TabulatorLib:Tabulator,
        getCurrentDefinition:()=>def,...model,
        elements:{assayDerivedPlateTable:document.getElementById('plate'),assayDerivedPlatePanel:document.getElementById('plate-panel')},
        syncCurrentResultsFromGrid:()=>runtime.currentResults,
        getResultValueCount:()=>Object.keys(runtime.currentResults).length,
        onTransformChanged:()=>{commits++}});
      plate.createTransformPlate();
      window.qa={notebook,plate,get commits(){return commits},resetCommits:()=>{commits=0},runtime};
    </script>`;
  fs.writeFileSync(path.join(temp, 'qa.html'), html);
  let win;
  async function run() {
    await app.whenReady();
    win = new BrowserWindow({ show:false, width:1060, height:640, webPreferences:{contextIsolation:true,nodeIntegration:false} });
    win.webContents.on('console-message', event => { if(event.level==='error') console.error(event.message); });
    await win.loadFile(path.join(temp, 'qa.html'));
    const js = code => win.webContents.executeJavaScript(code);
    const settle = () => new Promise(resolve => setTimeout(resolve, 90));
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(await js('Boolean(window.qa)'), true, 'controllers loaded');
    const cell = async (host, row, field) => js(`(() => {
      const e=document.querySelectorAll('#${host} .tabulator-row')[${row}].querySelector('[tabulator-field="${field}"]');
      const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`);
    const point = (r, axis) => ({x:Math.round(axis==='column'?r.x+r.width-8:r.x+r.width/2),y:Math.round(axis==='row'?r.y+r.height-3:r.y+r.height/2)});
    const input = async (type,p,buttons=0) => {
      await js(`document.elementFromPoint(${p.x},${p.y}).dispatchEvent(new MouseEvent('${type}',{bubbles:true,cancelable:true,clientX:${p.x},clientY:${p.y},button:0,buttons:${buttons}}))`);await settle();
    };
    const nativeClick = async (p) => {
      win.webContents.sendInputEvent({type:'mouseMove',x:p.x,y:p.y});
      win.webContents.sendInputEvent({type:'mouseDown',x:p.x,y:p.y,button:'left',clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp',x:p.x,y:p.y,button:'left',clickCount:1});
      await settle();
    };
    const move = p => input('mousemove',p);
    const shot = async name => { await settle();fs.writeFileSync(path.join(output, name+'.png'),(await win.webContents.capturePage()).toPNG()); };
    const drag = async (host, row, field, axis, targetRow, targetField, preview) => {
      const from=point(await cell(host,row,field),axis);
      await move({x:4,y:4});
      await move(from);
      assert.equal(await js(`document.querySelector('#${host} .spreadsheet-fill-handle')?.getAttribute('aria-hidden')`),'true');
      const geometry=await js(`(() => {const e=document.querySelector('#${host} .spreadsheet-fill-handle');
        const r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();
        return r.left>=c.left&&r.top>=c.top&&r.right<=c.right&&r.bottom<=c.bottom})()`);
      assert.equal(geometry,true,'grip stays inside its source cell');
      await shot(host+'-'+axis+'-grip');
      await input('mousedown',from,1);
      const to=point(await cell(host,targetRow,targetField),'center');
      await move(to);
      assert.ok(await js(`document.querySelectorAll('#${host} .is-fill-target').length`) > 0,'destination preview appears');
      if(preview)await shot(preview);
      await input('mouseup',to);
      assert.equal(await js('document.querySelectorAll(".is-fill-target").length'),0,'preview clears after release');
    };
    assert.equal(await js('JSON.stringify(qa.plate.getTransformSpec().formulas)'),'{}','new plate contains no formulas');
    assert.equal(await js(`Array.from(document.querySelectorAll('#plate .tabulator-cell[tabulator-field^="c"]:not(.assay-result-disabled)')).every(e=>e.textContent==='')`),true,'new plate renders empty wells');
    await shot('empty-transformed-plate');
    await js('window.savedEmpty=JSON.parse(JSON.stringify(qa.plate.getTransformSpec()));qa.plate.clearTransform()');await settle();
    assert.equal(await js('document.getElementById("plate-panel").hidden'),true,'remove hides the plate');
    await js('qa.plate.loadTransformSpec(savedEmpty)');await settle();
    assert.equal(await js('document.getElementById("plate-panel").hidden'),false,'saved empty plate reopens');
    assert.equal(await js('JSON.stringify(qa.plate.getTransformSpec().formulas)'),'{}','reopened empty plate stays empty');
    const seed=point(await cell('plate',0,'c1'),'row');
    await move(seed);
    assert.equal(await js("Boolean(document.querySelector('#plate .spreadsheet-fill-handle'))"),false,'an empty cell keeps its full click area for editing');
    await nativeClick(seed);
    assert.equal(await js("Boolean(document.querySelector('#plate .tabulator-cell input'))"),true,'one real click opens the transformed-cell editor');
    for (const keyCode of '=Table1:A1*2') {
      win.webContents.sendInputEvent({type:'char',keyCode});
    }
    assert.equal(await js("document.querySelector('#plate .tabulator-cell input')?.value"),'=Table1:A1*2','normal keyboard input reaches the transformed-cell editor');
    await shot('transformed-plate-editing');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'ENTER'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'ENTER'});
    await settle();
    assert.equal(await js('qa.plate.getTransformSpec().formulas.A1'),'=Table1:A1*2','first formula can be entered in the empty plate');
    await js('qa.resetCommits()');
    await shot('initial');
    await drag('notebook',0,'b','row',3,'b','notebook-fill-preview');
    assert.equal(await js('qa.notebook.getCurrentTables()[0].rows[3].b'),'=A4*2','Notebook shifts row references');
    await drag('notebook',0,'b','column',0,'c');
    assert.equal(await js('qa.notebook.getCurrentTables()[0].rows[0].c'),'=B1*2','Notebook shifts column references');
    await drag('plate',0,'c1','row',3,'c1','plate-fill-preview');
    assert.equal(await js('qa.plate.getTransformSpec().formulas.D1'),'=Table1:D1*2','plate shifts row letters');
    assert.equal(await js('qa.commits'),1,'plate fill commits once');
    await drag('plate',0,'c1','column',0,'c3');
    assert.equal(await js('qa.plate.getTransformSpec().formulas.A3'),'=Table1:A3*2','plate shifts column numbers');
    await drag('plate',1,'c1','column',1,'c3');
    assert.equal(await js('qa.plate.getTransformSpec().formulas.B2'),undefined,'unmapped well is skipped');
    assert.equal(await js('qa.plate.getTransformSpec().formulas.B3'),'=Table1:B3*2','fill continues beyond unmapped well');
    const raw=await js('JSON.stringify(qa.runtime.currentResults)');
    await js("document.body.classList.add('theme-night')");
    await move(point(await cell('plate',0,'c1'),'row'));await shot('plate-night-grip');
    await move(point(await cell('notebook',0,'b'),'column'));await shot('notebook-night-grip');
    const center=point(await cell('notebook',0,'b'),'center');await move(center);
    assert.notEqual(await js("getComputedStyle(document.querySelector('#notebook .is-fill-edge')).cursor"),'crosshair','cell body keeps editing cursor');
    await input('mousedown',center,1);await input('mouseup',center);await input('click',center);
    assert.equal(await js("Boolean(document.querySelector('#notebook .tabulator-cell input'))"),true,'cell body still opens the editor');
    assert.equal(await js('JSON.stringify(qa.runtime.currentResults)'),raw,'raw assay data stays unchanged');
    console.log('Spreadsheet fill Electron QA passed: both axes, plate references, unmapped wells, editing, day/night captures.');
    win.destroy();app.quit();
  }
  run().catch(error=>{console.error(error);win?.destroy();app.exit(1)});
}
