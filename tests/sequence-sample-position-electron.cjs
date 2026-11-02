'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      encoding: 'utf8', timeout: 90000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal || 'Sample position QA failed'));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-sequence-sample-'));
  const output = path.join(root, 'artifacts/sequence-sample-position');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body class="ui-neutral-compact theme-day">
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {normalizeState} from '${url('src/renderer/modules/app-state/index.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      const box=(id,name,type,count)=>({id,name,type,wells:Array.from({length:count},(_,i)=>({name:'W'+(i+1),content:''}))});
      window.appState=normalizeState(JSON.parse(localStorage.getItem('sample-position-qa')||'null')||{
        inventory:{'-20 Degree':[box('box-1','Cloning box','box25',25)],'4 Degree':[box('tube-1','Primer stocks','single',1)]},
        samples:[{id:'occupied',code:'S-OLD',name:'Existing stock',type:'plasmid',inventoryLink:{section:'-20 Degree',containerId:'box-1',wellIndex:0}}],
        primerLibrary:[{id:'primer-1',name:'Test primer F',sequence:'ACGTTAGCCGATCGATCG',sourceName:'Test construct'}]
      });
      window.show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.failPersist=false;window.holdPersist=false;window.getRequests=0;window.navigations=0;
      const library=[{id:'dna-1',name:'pTest <long construct name>',status:'saved',folderId:'folder-1'},{id:'dna-2',name:'Temporary construct',status:'temporary'}];
      const gbkText=buildRecordGenbankText({name:'pTest',sequence:'ATGCGATCGATCGATCGATCGATC',topology:'circular',features:[]});
      window.viewer=initSequenceViewer({document,state:appState,storagePath:'/fixture-library',createId:()=>crypto.randomUUID(),
        homeViewId:'sequence-viewer-view',detailViewId:'sequence-viewer-detail-view',
        persist:async()=>{if(failPersist)throw new Error('Fixture save failed');if(holdPersist)await new Promise(resolve=>window.releasePersist=resolve);localStorage.setItem('sample-position-qa',JSON.stringify(appState))},
        apiBridge:{sequenceLibraryList:async({status})=>({ok:true,entries:library.filter(e=>e.status===status),folders:[{id:'folder-1',name:'Test project'}]}),
          sequenceLibraryGet:async({id})=>{getRequests++;return {ok:true,entry:library.find(e=>e.id===id),gbkText}}},
        onNavigateHome:()=>{navigations++;show('sequence-viewer-view')},onNavigateDetail:()=>{navigations++;show('sequence-viewer-detail-view')}});
      show('sequence-viewer-view');window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = code => win.webContents.executeJavaScript(code);
  const waitFor = async code => {
    for (let i = 0; i < 100; i++) {
      if (await run(code)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${code}`);
  };
  const click = async selector => {
    const bounds = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing button');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...bounds });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...bounds });
    await new Promise(resolve => setTimeout(resolve, 40));
  };
  const field = suffix => `document.getElementById('sequence-viewer-quick-sample-${suffix}')`;
  const pickerOpen = `${field('overlay')}.open`;
  const screenshot = async name => fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadFile(fixture);
    await waitFor(`window.ready && !!document.querySelector('#sequence-viewer-library-list [data-sequence-sample-position]')`);
    await screenshot('dna-rail.png');
    const before = await run(`({requests:getRequests,navigations})`);
    await click('#sequence-viewer-library-list [data-sequence-sample-position]');
    assert.equal(await run(pickerOpen), true);
    assert.equal(await run(`${field('name')}.value`), 'pTest <long construct name>');
    assert.equal(await run(`${field('type')}.value`), 'dna');
    assert.equal(await run(`Array.from(${field('type')}.options).some(option=>option.value==='rna' && option.textContent==='RNA')`), true);
    await click('#sequence-viewer-quick-sample-location-list [data-quick-sample-location="-20 Degree"]');
    assert.equal(await run(`${field('grid-label')}.textContent`), 'Cloning box · W2');
    assert.deepEqual(await run(`({requests:getRequests,navigations})`), before, 'Recording must preserve the current DNA workspace');
    await screenshot('dna-picker.png');
    await click('#sequence-viewer-quick-sample-grid [data-quick-sample-well="4"]');
    await run(`${field('code')}.value='DNA-1';${field('concentration')}.value='80 ng/uL'`);
    await click('#sequence-viewer-quick-sample-submit-btn');
    await waitFor(`!${pickerOpen}`);
    const dna = await run(`appState.samples.at(-1)`);
    assert.equal(dna.name, 'pTest <long construct name>');
    assert.equal(dna.type, 'dna');
    assert.equal(dna.concentration, '80 ng/uL');
    assert.deepEqual(dna.inventoryLink, { section: '-20 Degree', containerId: 'box-1', wellIndex: 4 });
    assert.equal(dna.location.position, 'W5');

    // The detail rail uses the same action, including temporary entries.
    await run(`show('sequence-viewer-detail-view');viewer.render({activeViewId:'sequence-viewer-detail-view'})`);
    await click('#sequence-viewer-detail-library-list [data-sequence-sample-position]');
    assert.equal(await run(pickerOpen), true);
    await click('#sequence-viewer-quick-sample-cancel-btn');
    await click('#sequence-viewer-detail-library-filter-temporary');
    await waitFor(`!!document.querySelector('#sequence-viewer-detail-library-list [data-sequence-sample-position="dna-2"]')`);
    await click('#sequence-viewer-detail-library-list [data-sequence-sample-position="dna-2"]');
    assert.equal(await run(`${field('name')}.value`), 'Temporary construct');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(`!${pickerOpen}`);
    assert.equal(await run(`appState.samples.length`), 2, 'Cancel and Escape must not create samples');

    await click('#sequence-viewer-detail-primer-library-open');
    await click('[data-primer-sample-position]');
    assert.equal(await run(pickerOpen), true);
    assert.equal(await run(`${field('type')}.value`), 'primer');
    assert.equal(await run(`${field('name')}.value`), 'Test primer F');
    assert.equal(await run(`${field('code')}.value`), '');
    assert.equal(await run(`${field('concentration')}.value`), '');
    assert.equal(await run(`${field('overlay')}.matches(':modal') && document.getElementById('sequence-viewer-primer-library-overlay').open`), true);
    await screenshot('primer-picker.png');
    // Duplicate codes stay in the picker with no new record.
    await run(`${field('code')}.value='DNA-1'`);
    await click('#sequence-viewer-quick-sample-submit-btn');
    assert.equal(await run(pickerOpen), true);
    assert.equal(await run(`appState.samples.length`), 2);
    await run(`${field('code')}.value='PRIMER-1'`);
    await click('#sequence-viewer-quick-sample-location-list [data-quick-sample-location="4 Degree"]');
    assert.equal(await run(`${field('grid')}.querySelectorAll('[data-quick-sample-well="single"]').length`), 1);
    await click('#sequence-viewer-quick-sample-submit-btn');
    await waitFor(`!${pickerOpen}`);
    const primer = await run(`appState.samples.at(-1)`);
    assert.equal(primer.type, 'primer');
    assert.deepEqual(primer.details, { sequence: 'ACGTTAGCCGATCGATCG', target: 'Test construct' });
    assert.deepEqual(primer.inventoryLink, { section: '4 Degree', containerId: 'tube-1', wellIndex: null });
    assert.equal(await run(`document.getElementById('sequence-viewer-primer-library-overlay').open`), true);

    // Persistence errors roll back the new sample and keep the picker retryable.
    await click('[data-primer-sample-position]');
    await run(`failPersist=true`);
    await click('#sequence-viewer-quick-sample-submit-btn');
    await waitFor(`${field('status')}.textContent.includes('Fixture save failed')`);
    assert.equal(await run(`appState.samples.length`), 3);
    assert.equal(await run(pickerOpen), true);
    await run(`failPersist=false;holdPersist=true`);
    await click('#sequence-viewer-quick-sample-submit-btn');
    await run(`${field('form')}.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
    assert.equal(await run(`appState.samples.length`), 4, 'Repeated submission during persistence must create one sample');
    await run(`holdPersist=false;releasePersist()`);
    await waitFor(`!${pickerOpen}`);

    await click('[data-primer-sample-position]');
    // Empty locations are explicit and cannot create unplaced samples.
    await click('#sequence-viewer-quick-sample-location-list [data-quick-sample-location="Room Temp"]');
    assert.equal(await run(`${field('container')}.value`), '');
    await run(`${field('form')}.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
    assert.equal(await run(`appState.samples.length`), 4);
    assert.equal(await run(pickerOpen), true);
    await click('#sequence-viewer-quick-sample-location-list [data-quick-sample-location="-20 Degree"]');
    for (const width of [1280, 800, 480]) {
      win.setSize(width, 850);
      await run(`document.body.classList.toggle('theme-night',${width === 800});document.body.classList.toggle('theme-day',${width !== 800})`);
      await new Promise(resolve => setTimeout(resolve, 200));
      const fits = await run(`(()=>{const r=${field('overlay')}.querySelector('.app-dialog-surface').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`);
      assert.equal(fits, true, `Picker fits at ${width}px`);
      await screenshot(`picker-${width}.png`);
    }
    await click('#sequence-viewer-quick-sample-cancel-btn');
    await win.reload();
    await waitFor(`window.ready`);
    assert.equal(await run(`appState.samples.length`), 4);
    assert.equal(await run(`appState.samples.find(s=>s.code==='PRIMER-1').details.sequence`), primer.details.sequence);
    assert.deepEqual(errors, []);
    console.log('Sequence sample position Electron QA passed: both rails, saved/temporary DNA, primer modal stacking, prefilled types/names, wells/single containers, duplicates, cancellation, failure rollback, repeated submits, reload, and responsive layouts.');
  } finally {
    win.destroy();
    await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    app.quit();
  }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
