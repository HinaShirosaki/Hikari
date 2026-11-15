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
    <link rel="stylesheet" href="${url('styles.css')}">
    <link rel="stylesheet" href="${url('vendor/tabulator/tabulator.min.css')}">
    <style>html{overflow-anchor:none}body{display:block;margin:0;padding:2rem;background:var(--theme-background)}
    main{max-width:58rem;margin:auto}section{margin-bottom:2.5rem}h2{font-size:1rem;margin:0 0 1rem}
    #plate{overflow:auto} .tabulator{max-width:100%}</style>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <main><section><h2 id="notebook-heading" tabindex="-1">Notebook · Results table</h2><div id="notebook"></div></section>
    <section id="plate-panel"><h2>Assay · Transformed Plate (Table2)</h2><div id="plate"></div></section>
    <div id="analysis-output" hidden></div></main>
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
        rows:Array.from({length:6},(_,r)=>({id:'r'+r,a:String(10+r),b:['=A1*2','=A2*3'][r]||'',c:''}))}]);
      let commits=0;
      const plate=createAssayAnalysisView({safeText:String,runtime,TabulatorLib:Tabulator,
        getCurrentDefinition:()=>def,...model,
        elements:{assayDerivedPlateTable:document.getElementById('plate'),assayDerivedPlatePanel:document.getElementById('plate-panel'),
          assayAnalysisTable:document.getElementById('analysis-output')},
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
      const e = hostCell();
      const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
      function hostCell() {
        const host = document.getElementById('${host}');
        if ('${host}' === 'notebook') {
          return Tabulator.findTable(host.querySelector('.spreadsheet-table'))[0]
            .getRowFromPosition(${row + 1}).getCell('${field}').getElement();
        }
        return host.querySelectorAll('.tabulator-row')[${row}].querySelector('[tabulator-field="${field}"]');
      }
    })()`);
    const point = (r, axis) => ({x:Math.round(axis==='column'?r.x+r.width-8:r.x+r.width/2),y:Math.round(axis==='row'?r.y+r.height-3:r.y+r.height/2)});
    const input = async (type,p,buttons=0) => {
      await js(`document.elementFromPoint(${p.x},${p.y}).dispatchEvent(new MouseEvent('${type}',{bubbles:true,cancelable:true,clientX:${p.x},clientY:${p.y},button:0,buttons:${buttons}}))`);await settle();
    };
    const nativeMouse = async (type, p, { clickCount = 1, modifiers = [] } = {}) => {
      win.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount, modifiers });
      await settle();
    };
    const nativeClick = async (p, options) => {
      await nativeMouse('mouseMove', p);
      await nativeMouse('mouseDown', p, options);
      await nativeMouse('mouseUp', p, options);
    };
    const key = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
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
    const notebookPoint = async (row, field) => point(await cell('notebook', row, field), 'center');
    const selected = () => js(`Array.from(document.querySelectorAll('#notebook .tabulator-cell[tabulator-field].tabulator-range-selected'),
      cell => cell.getAttribute('tabulator-field'))`);
    const select = async (row, field, endRow, endField) => {
      const from = await notebookPoint(row, field);
      const to = await notebookPoint(endRow, endField);
      await nativeMouse('mouseMove', from);
      await nativeMouse('mouseDown', from);
      await nativeMouse('mouseMove', to);
      await nativeMouse('mouseUp', to);
    };
    const rangeHandlePoint = async () => {
      const position = await js(`(() => {
        const grip = document.querySelector('#notebook .notebook-range-fill-handle');
        const rect = grip.getBoundingClientRect();
        const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
        const target = document.elementFromPoint(x, y);
        return { x, y, reachable: target === grip, target: target?.className, field: grip.parentElement.getAttribute('tabulator-field') };
      })()`);
      assert.equal(position.reachable, true, 'range handle is a real hit target: ' + JSON.stringify(position));
      return position;
    };
    const fillNotebook = async (row, field, expectedPreview, cancel = false) => {
      const from = await rangeHandlePoint();
      const to = await notebookPoint(row, field);
      await nativeMouse('mouseMove', from);
      await nativeMouse('mouseDown', from);
      await nativeMouse('mouseMove', to);
      assert.equal(await js("document.querySelectorAll('#notebook .is-fill-target').length"), expectedPreview,
        'only the cells outside the selection are previewed');
      if (cancel) await key('ESC');
      await nativeMouse('mouseUp', to);
      assert.equal(await js("document.querySelectorAll('#notebook .is-fill-target').length"), 0, 'preview clears');
    };
    const rows = () => js('qa.notebook.getCurrentTables()[0].rows');
    await select(1, 'b', 0, 'a');
    assert.deepEqual(await selected(), ['a', 'b', 'a', 'b'], 'reverse drag selects the whole rectangle');
    assert.equal(await js("Boolean(document.querySelector('#notebook .tabulator-cell input'))"), false,
      'selecting cells does not open the editor');
    const before = await rows();
    await fillNotebook(5, 'b', 8, true);
    assert.deepEqual(await rows(), before, 'Escape cancels the fill without writing');
    await fillNotebook(5, 'b', 8);
    const filled = await rows();
    assert.deepEqual(filled.slice(0, 2), before.slice(0, 2), 'the source is unchanged');
    assert.deepEqual(filled.slice(2).map(({ a, b, c }) => [a, b, c]), [
      ['10', '=A3*2', ''], ['11', '=A4*3', ''], ['10', '=A5*2', ''], ['11', '=A6*3', '']
    ], 'Notebook repeats a two-by-two block and translates each source formula');
    assert.equal((await selected()).length, 12, 'the selection includes the filled cells after release');
    await nativeClick(await notebookPoint(0, 'b'));
    await nativeClick(await notebookPoint(1, 'b'), { modifiers: ['shift'] });
    assert.deepEqual(await selected(), ['b', 'b'], 'Shift-click extends the selection');
    await fillNotebook(1, 'c', 2);
    assert.deepEqual((await rows()).slice(0, 2).map(({ c }) => c), ['=B1*2', '=B2*3'],
      'horizontal fill translates both source formulas');
    await select(3, 'a', 4, 'a');
    await fillNotebook(2, 'a', 1);
    assert.equal((await rows())[2].a, '10', 'upward fill uses the matching row from the repeated block');
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
    await shot('notebook-night-range');
    const center = await notebookPoint(0, 'b');
    await nativeClick(center);
    await key('ENTER');
    assert.equal(await js("document.querySelector('#notebook .tabulator-cell input')?.value"), '=A1*2',
      'Enter edits the selected cell’s underlying formula');
    await nativeClick(await notebookPoint(2, 'a'));
    assert.match(await js("document.querySelector('#notebook .tabulator-cell input')?.value"), /Table1:A3/,
      'formula point mode still inserts the clicked address');
    await key('ESC');
    await nativeClick(center);
    await nativeClick(center, { clickCount: 2 });
    assert.equal(await js("document.querySelector('#notebook .tabulator-cell input')?.value"), '=A1*2',
      'double-click edits the cell');
    assert.equal(await js('JSON.stringify(qa.runtime.currentResults)'),raw,'raw assay data stays unchanged');
    await key('ESC');

    win.setContentSize(800, 700);
    await js(`qa.notebook.renderEditor([{
      columns: Array.from({ length: 10 }, (_, i) => ({ field: 'd' + i, title: 'Column ' + (i + 1) })),
      rows: Array.from({ length: 40 }, (_, i) => ({ id: 'long' + i, d0: ['first', 'second'][i] || '' }))
    }]); document.getElementById('notebook').scrollIntoView({ block: 'start' })`);
    await settle();
    await select(0, 'd0', 1, 'd0');
    const from = await rangeHandlePoint();
    const below = await js(`(() => {
      const rect = document.querySelector('#notebook .tabulator-tableholder').getBoundingClientRect();
      return Math.round(rect.bottom - 4);
    })()`);
    await nativeMouse('mouseMove', from);
    await nativeMouse('mouseDown', from);
    await nativeMouse('mouseMove', { x: from.x, y: below });
    const scroll = await js(`new Promise(resolve => {
      const holder = document.querySelector('#notebook .tabulator-tableholder');
      const timer = setTimeout(() => resolve(holder.scrollTop), 2000);
      function read() {
        if (holder.scrollTop < 380) return requestAnimationFrame(read);
        clearTimeout(timer);
        resolve(holder.scrollTop);
      }
      read();
    })`);
    assert.ok(scroll >= 380, 'holding the drag at the edge scrolls a long table');
    assert.equal((await rows())[15].d0, '', 'scrolling the preview does not commit changes');
    await nativeMouse('mouseUp', { x: from.x, y: below });
    const scrolledRows = await rows();
    assert.equal(scrolledRows[14].d0, 'first');
    assert.equal(scrolledRows[15].d0, 'second', 'fill reaches cells beyond the initially visible rows');

    await js(`document.getElementById('notebook-heading').focus({ preventScroll: true });
      qa.notebook.renderEditor(qa.notebook.getCurrentTables())`);
    await settle();
    assert.equal(await js('document.activeElement.id'), 'notebook-heading', 'building a table does not steal focus');
    await js("document.getElementById('notebook').scrollIntoView({ block: 'start' })");
    await settle();
    await select(0, 'd0', 1, 'd0');
    const across = await rangeHandlePoint();
    const edge = await js(`(() => {
      const holder = document.querySelector('#notebook .tabulator-tableholder');
      return Math.round(holder.getBoundingClientRect().left + holder.clientWidth - 4);
    })()`);
    await nativeMouse('mouseMove', across);
    await nativeMouse('mouseDown', across);
    await nativeMouse('mouseMove', { x: edge, y: across.y });
    const scrollX = await js(`new Promise(resolve => {
      const holder = document.querySelector('#notebook .tabulator-tableholder');
      const timer = setTimeout(() => resolve(holder.scrollLeft), 2000);
      function read() {
        if (holder.scrollLeft + holder.clientWidth < holder.scrollWidth - 1) return requestAnimationFrame(read);
        clearTimeout(timer);
        resolve(holder.scrollLeft);
      }
      read();
    })`);
    assert.ok(scrollX > 0, 'holding the drag at the right edge scrolls a wide table');
    await nativeMouse('mouseUp', { x: edge, y: across.y });
    assert.deepEqual((await rows()).slice(0, 3).map(({ d9 }) => d9), ['first', 'second', ''],
      'horizontal edge scrolling fills the last column without adding rows to the selection');
    console.log('Spreadsheet fill Electron QA passed: Notebook range selection and fill, plate fill, formula editing, day/night captures.');
    win.destroy();app.quit();
  }
  run().catch(error=>{console.error(error);win?.destroy();app.exit(1)});
}
