'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 90000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal || 'Fragment UI QA failed'));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-fragments-ui-'));
  const output = path.join(root, 'artifacts/sequence-fragments');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
  const { registerSequenceLibraryIpc } = require('../src/main/ipc/register-data-ipc/register-sequence-library-ipc.js');
  let failChild = false;
  let releaseChild = null;
  let holdChild = false;
  registerSequenceLibraryIpc({ ...library, ipcMain,
    cleanText: (value, limit) => String(value || '').trim().slice(0, limit), normalizeJsonPayload: value => value || {},
    upsertSequenceEntry: async payload => {
      if (payload.parentEntryId && failChild) throw new Error('Fixture disk write failed');
      if (payload.parentEntryId && holdChild) await new Promise(resolve => { releaseChild = resolve; });
      return library.upsertSequenceEntry(payload);
    }
  });
  const preload = path.join(scratch, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('hikariApi',require(${JSON.stringify(path.join(root, 'src/main/preload/api/sequence-library-api.js'))}).createSequenceLibraryApi(ipcRenderer));`);
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body class="ui-neutral-compact theme-day">
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {reverseComplementIupac} from '${url('src/renderer/modules/sequence-viewer/shared.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      let seed=431;window.sequence=Array.from({length:240},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return 'ACGT'[seed>>>30]}).join('');
      window.show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.viewer=initSequenceViewer({document,state:{settings:{},projects:[],primerLibrary:[{id:'lib-r',name:'Library R',sequence:reverseComplementIupac(sequence.slice(150,168))}]},
        storagePath:${JSON.stringify(scratch)},homeViewId:'sequence-viewer-view',detailViewId:'sequence-viewer-detail-view',
        onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
      window.template={name:'Parent DNA',sequence,topology:'circular',features:[
        {id:'f',name:'Primer F',type:'primer_bind',strand:1,primerSequence:'GGGG'+sequence.slice(20,38),segments:[{start:20,end:38}]},
        {id:'r',name:'Primer R',type:'primer_bind',strand:-1,primerSequence:'CCCC'+reverseComplementIupac(sequence.slice(150,168)),segments:[{start:150,end:168}]},
        {id:'gene',name:'Test gene',type:'CDS',strand:1,segments:[{start:40,end:130}]}]};
      window.host=document.getElementById('sequence-viewer-sequence-host');
      window.menu=document.getElementById('sequence-viewer-feature-context-menu');
      window.bases=()=>[...host.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')];
      window.baseEvent=(index,type)=>{const base=bases()[index],r=base.getBoundingClientRect();base.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:r.left,clientY:r.top+2}))};
      window.selectRange=(start,end)=>{baseEvent(start,'mousedown');baseEvent(end,'mousemove');window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));baseEvent(start,'contextmenu')};
      window.openEntry=id=>document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="'+id+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));
      window.readSequence=()=>bases().map(e=>e.textContent).join('');
      await window.hikariApi.sequenceLibraryUpsert({storagePath:${JSON.stringify(scratch)},id:'parent-fixture',name:template.name,status:'saved',
        sequence,sequenceLength:sequence.length,features:template.features,featureCount:template.features.length,topology:template.topology,gbkText:buildRecordGenbankText(template)});
      viewer.render({activeViewId:'sequence-viewer-detail-view'});window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { sandbox: false, contextIsolation: true, preload } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level >= 3) errors.push(event.message); });
  const run = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`${error.message}\nScript: ${code}\n${errors.join('\n')}`); }
  };
  const waitFor = async code => {
    for (let i = 0; i < 150; i++) {
      if (await run(code)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const field = suffix => `document.querySelector('[data-fragment-${suffix}]')`;
  const open = `document.querySelector('.sequence-viewer-fragment-overlay')?.open`;
  const entries = async () => (await library.listSequenceEntries({ storagePath: scratch, status: 'saved' })).entries;
  const screenshot = async name => fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadFile(fixture);
    await waitFor('window.ready');
    await waitFor(`!!document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="parent-fixture"]')`);
    await run(`openEntry('parent-fixture')`);
    await waitFor('readSequence().length===240');
    await run('selectRange(50,100)');
    assert.equal(await run('menu.hidden'), false);
    await click('[data-sequence-feature-action="save-fragment"]');
    assert.equal(await run(open), true);
    assert.match(await run(`${field('preview')}.textContent`), /50 bp/);
    await run(`${field('name')}.value='Selection child'`);
    await screenshot('save-selection.png');
    failChild = true;
    await click('[data-fragment-save]');
    await waitFor(`${field('error')}.textContent.includes('Fixture disk write failed')`);
    assert.equal(await run(open), true);
    assert.equal((await entries()).length, 1, 'failed child save keeps the persisted parent');
    failChild = false;
    await click('[data-fragment-save]');
    await waitFor(`!${open}`);
    let saved = await entries();
    assert.equal(saved.length, 2);
    const parent = saved.find(entry => entry.name === 'Parent DNA');
    const child = saved.find(entry => entry.name === 'Selection child');
    assert.equal(child.parentEntryId, parent.id, 'real IPC retains parent identity');
    assert.equal(await run('readSequence()'), await run('sequence.slice(50,100)'));
    const toggle = `#sequence-viewer-detail-library-list [data-sequence-dna-toggle="${parent.id}"]`;
    assert.equal(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'true');
    await click(toggle);
    assert.equal(await run(`document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="${child.id}"]').getClientRects().length`), 0);
    await click(toggle);
    await run(`openEntry('${parent.id}')`);
    await waitFor(`readSequence().length===240`);
    await run(`document.querySelector('#sequence-viewer-feature-rail-host [aria-label^="Primer F"]').click()`);
    await click('#sequence-viewer-feature-detail [data-sequence-primer-pcr]');
    assert.equal(await run(open), true);
    assert.match(await run(`${field('preview')}.textContent`), /156 bp/);
    assert.equal(await run(`${field('partner')}.options.length`), 3, 'annotated, library and pasted partners are available');
    await run(`${field('partner')}.value='custom';${field('partner')}.dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.equal(await run(`${field('save')}.disabled`), true);
    await run(`${field('sequence')}.value=template.features[1].primerSequence;${field('sequence')}.dispatchEvent(new Event('input',{bubbles:true}));${field('name')}.value='PCR child'`);
    assert.equal(await run(`${field('save')}.disabled`), false);
    for (const width of [1280, 800, 480]) {
      win.setSize(width, 850);
      await run(`document.body.classList.toggle('theme-night',${width === 800})`);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await run(`(()=>{const e=document.querySelector('.sequence-viewer-fragment-dialog'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1})()`), true, `PCR dialog fits ${width}px`);
      await screenshot(`pcr-${width}.png`);
    }
    holdChild = true;
    await click('[data-fragment-save]');
    for (let i = 0; i < 100 && !releaseChild; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(releaseChild);
    await run(`document.querySelector('.sequence-viewer-fragment-dialog').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
    holdChild = false;
    releaseChild();
    await waitFor(`!${open}`);
    saved = await entries();
    assert.equal(saved.length, 3, 'repeated submits create exactly one PCR child');
    const pcr = saved.find(entry => entry.name === 'PCR child');
    assert.equal(pcr.parentEntryId, parent.id);
    assert.equal(await run('readSequence()'), await run(`'GGGG'+sequence.slice(20,168)+'GGGG'`));
    await run(`openEntry('${parent.id}')`);
    await waitFor('readSequence().length===240');
    await run(`document.querySelector('#sequence-viewer-feature-rail-host [aria-label^="Primer R"]').click()`);
    await click('#sequence-viewer-feature-detail [data-sequence-primer-pcr]');
    assert.equal(await run(open), true);
    assert.equal(await run(`${field('partner-label')}.textContent`), 'Forward primer');
    assert.match(await run(`${field('preview')}.textContent`), /156 bp/);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(`!${open}`);
    await run(`(()=>{const e=host.querySelector('[data-feature-index="0"]'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:r.left,clientY:r.top}))})()`);
    await click('[data-sequence-hover-tooltip="feature"] [data-sequence-primer-pcr]');
    assert.equal(await run(open), true, 'primer hover cards can launch PCR');
    await click('[data-fragment-cancel]');
    assert.equal((await entries()).length, 3, 'cancellation does not save another fragment');
    await run(`show('sequence-viewer-view');viewer.render({activeViewId:'sequence-viewer-view'})`);
    await waitFor(`!!document.querySelector('#sequence-viewer-library-list [data-sequence-dna-toggle]')`);
    await screenshot('dna-family.png');
    // On a fresh runtime the family is folded, and search reveals its ancestry.
    await win.reload();
    await waitFor('window.ready');
    await run(`show('sequence-viewer-view');viewer.render({activeViewId:'sequence-viewer-view'})`);
    await waitFor(`!!document.querySelector('#sequence-viewer-library-list [data-sequence-dna-toggle]')`);
    assert.equal(await run(`document.querySelector('#sequence-viewer-library-list [data-sequence-dna-toggle]').getAttribute('aria-expanded')`), 'false');
    await run(`const search=document.getElementById('sequence-viewer-library-search-input');search.value='PCR child';search.dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await run(`document.querySelector('#sequence-viewer-library-list [data-sequence-entry-id="${pcr.id}"]').getClientRects().length>0`), true);
    assert.deepEqual(errors, []);
    console.log('Sequence fragment Electron QA passed: selection save, forward/reverse primer and hover PCR, real IPC and GBK storage, fold/unfold, ancestry search, reload, cancellation, failed-save retry, duplicate submits, and responsive layouts.');
  } finally {
    win.destroy();
    await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    app.quit();
  }
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
