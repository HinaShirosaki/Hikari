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
    assert.equal(result.status, 0, String(result.error || result.signal || 'Assembly UI QA failed'));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-assembly-ui-'));
  const output = path.join(root, 'artifacts/sequence-assembly');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
  const { registerSequenceLibraryIpc } = require('../src/main/ipc/register-data-ipc/register-sequence-library-ipc.js');
  let failAfterWrite = true;
  let outputWrites = 0;
  let holdRead = false;
  let releaseRead = null;
  registerSequenceLibraryIpc({ ...library, ipcMain,
    cleanText: (value, limit) => String(value || '').trim().slice(0, limit), normalizeJsonPayload: value => value || {},
    getSequenceEntry: async payload => {
      if (payload.id === 'c' && holdRead) await new Promise(resolve => { releaseRead = resolve; });
      return library.getSequenceEntry(payload);
    },
    upsertSequenceEntry: async payload => {
      const result = await library.upsertSequenceEntry(payload);
      if (payload.name === 'Overlap product') {
        outputWrites++;
        if (failAfterWrite) { failAfterWrite = false; throw new Error('Fixture lost save response'); }
      }
      return result;
    }
  });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const preload = path.join(scratch, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',require(${JSON.stringify(path.join(root, 'src/main/preload/api/sequence-library-api.js'))}).createSequenceLibraryApi(ipcRenderer));`);
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body class="ui-neutral-compact theme-day">
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      import {buildRestrictionDigestProducts} from '${url('src/renderer/modules/sequence-viewer/restriction-digestion.js')}';
      import {i18n} from '${url('src/renderer/lib/i18n/index.js')}';
      import {bindTranslations} from '${url('src/renderer/lib/i18n/dom.js')}';
      bindTranslations(document);window.switchLocale=locale=>i18n.setLocale(locale);
      window.show=id=>document.querySelectorAll('.view').forEach(e=>{e.hidden=e.id!==id;e.classList.toggle('is-active',e.id===id)});
      window.detailLoads=0;
      window.viewer=initSequenceViewer({document,state:{settings:{},projects:[]},storagePath:${JSON.stringify(scratch)},
        homeViewId:'sequence-viewer-view',detailViewId:'sequence-viewer-detail-view',onNavigateHome:()=>show('sequence-viewer-view'),
        onNavigateDetail:()=>{show('sequence-viewer-detail-view');detailLoads++}});
      window.overlap='ACGTCAGTACGATGC';window.overlap2='TATGCGATCGTACGA';
      window.records={a:{name:'Overlap A',sequence:'TTCGAACGTA'+overlap,topology:'linear',features:[]},
        b:{name:'Overlap B',sequence:overlap+'GGACTCCAGTA'+overlap2,topology:'linear',features:[{id:'gene',name:'Gene B',type:'CDS',strand:-1,segments:[{start:3,end:12}]}]},
        c:{name:'Overlap C',sequence:overlap2+'CGATTTGCATA',topology:'linear',features:[]}};
      const sequence='ACGTTACGTA'+'GAATTC'+'TATCCGATGCTAGTACGTAC'+'GGATCC'+'CTAGTCGTAA'+'CCCGGG'+'ATGCTAGC';
      window.template={name:'Source template',sequence,topology:'circular',features:[]};
      const site=(name,site,cut,start)=>({name,site,cut,type:'restriction_site',strand:1,segments:[{start,end:start+site.length}]});
      const products=buildRestrictionDigestProducts(template,[{site:site('EcoRI','GAATTC','G^AATTC',10)},{site:site('BamHI','GGATCC','G^GATCC',36)}]);
      records['sticky-a']={...products[0],name:'Sticky A'};records['sticky-b']={...products[1],name:'Sticky B'};
      const persist=async(id,record,parentEntryId='')=>hikariApi.sequenceLibraryUpsert({storagePath:${JSON.stringify(scratch)},id,parentEntryId,
        name:record.name,status:'saved',topology:record.topology,sequence:record.sequence,sequenceLength:record.sequence.length,
        features:record.features,featureCount:record.features.length,gbkText:buildRecordGenbankText(record)});
      await persist('template',template);
      for(const [id,record] of Object.entries(records))await persist(id,record,'template');
      window.openEntry=id=>document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="'+id+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));
      window.readSequence=()=>[...document.querySelectorAll('#sequence-viewer-sequence-host .sequence-viewer-strand-row-top .sequence-viewer-seq-base')].map(e=>e.textContent).join('');
      window.rightClick=(selector)=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+4}))};
      viewer.render({activeViewId:'sequence-viewer-detail-view'});window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { sandbox: false, contextIsolation: true, preload } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level >= 3) errors.push(event.message); });
  const run = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`${error.message}\nScript: ${code}\n${errors.join('\n')}`); }
  };
  const waitFor = async code => {
    for (let i = 0; i < 150; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const field = key => `document.querySelector('[data-assembly-${key}]')`;
  const open = `!!document.querySelector('.sequence-viewer-assembly-banner:not([hidden])')`;
  const count = `document.querySelectorAll('[data-assembly-row]').length`;
  const entries = async () => (await library.listSequenceEntries({ storagePath: scratch })).entries;
  const change = (key, value) => run(`${field(key)}.value=${JSON.stringify(value)};${field(key)}.dispatchEvent(new Event('change',{bubbles:true}))`);
  const add = async id => {
    const before = await run(count);
    const list = await run(`document.getElementById('sequence-viewer-view').hidden?'sequence-viewer-detail-library-list':'sequence-viewer-library-list'`);
    await click(`#${list} [data-sequence-entry-id="${id}"]`);
    await waitFor(`${count}===${before + 1} && !document.querySelector('[data-assembly-loading="true"]')`);
  };
  const openAssembly = async (id, home = false) => {
    const view = home ? 'sequence-viewer-view' : 'sequence-viewer-detail-view';
    const list = home ? 'sequence-viewer-library-list' : 'sequence-viewer-detail-library-list';
    const menu = home ? 'sequence-viewer-library-context-menu' : 'sequence-viewer-detail-library-context-menu';
    await run(`show('${view}');viewer.render({activeViewId:'${view}'})`);
    await waitFor(`!!document.querySelector('#${list} [data-sequence-entry-id="${id}"]')`);
    await run(`(()=>{const e=document.querySelector('#${list} [data-sequence-dna-toggle="template"]');if(e?.getAttribute('aria-expanded')==='false')e.click()})();rightClick('#${list} [data-sequence-entry-id="${id}"]')`);
    assert.equal(await run(`document.querySelector('#${menu} [data-sequence-library-action="assemble"]').hidden`), false);
    await click(`#${menu} [data-sequence-library-action="assemble"]`);
    await waitFor(`${open} && ${count}===1 && !document.querySelector('[data-assembly-loading="true"]')`);
  };
  const screenshot = async name => {
    await new Promise(resolve => setTimeout(resolve, 180));
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const nativeClick = async selector => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'start'});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    assert.equal(await run(`document.elementFromPoint(${point.x},${point.y})?.closest('[data-sequence-entry-id]')===document.querySelector(${JSON.stringify(selector)})`), true, 'the DNA item remains reachable above the banner');
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  };
  try {
    await win.loadFile(fixture);
    await waitFor(`window.ready && !!document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="a"]')`);
    await openAssembly('a');
    assert.equal(await run(`${field('save')}.disabled`), true);
    assert.equal(await run(`!!document.querySelector('dialog[open]')`), false, 'starting assembly opens a banner without a modal');
    assert.equal(await run(`${field('details')}.hidden`), true, 'advanced options start collapsed');
    const initialLoads = await run('detailLoads');
    await change('method', 'overlap-pcr');
    assert.equal(await run(`${field('topology')}.disabled && ${field('topology')}.value==='linear'`), true);
    await add('b');
    await add('c');
    assert.equal(await run('detailLoads'), initialLoads, 'picking DNA items does not navigate or load a different record');
    assert.equal(await run(`document.querySelectorAll('#sequence-viewer-detail-library-list [data-assembly-selected="true"]').length`), 3);
    await click('#sequence-viewer-detail-library-list [data-sequence-entry-id="c"]');
    assert.equal(await run(count), 2, 'clicking a selected DNA item removes it');
    await add('c');
    await run(`document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="b"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))`);
    assert.equal(await run('detailLoads'), initialLoads, 'double clicks cannot open an item during picking');
    await click('#sequence-viewer-detail-library-list [data-sequence-dna-toggle="template"]');
    await click('#sequence-viewer-detail-library-list [data-sequence-dna-toggle="template"]');
    assert.equal(await run(`document.querySelectorAll('#sequence-viewer-detail-library-list [data-assembly-selected="true"]').length`), 3, 'folder reflow restores picked highlights');
    assert.equal(await run(`${field('save')}.disabled`), false);
    assert.match(await run(`${field('junctions')}.textContent`), /15 bp overlap/);
    await screenshot('banner-picking.png');
    assert.equal(await run(`(()=>{const a=document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="a"]'),b=document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="b"]');return getComputedStyle(a.closest('.sequence-viewer-dna-row')).backgroundColor===getComputedStyle(b.closest('.sequence-viewer-dna-row')).backgroundColor&&getComputedStyle(a).backgroundColor==='rgba(0, 0, 0, 0)'})()`), true, 'picked items use one consistent highlight layer');
    await click('[data-assembly-options]');
    await run(`const orientation=document.querySelectorAll('[data-assembly-orientation]')[2];orientation.value='reverse';orientation.dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.equal(await run(`${field('save')}.disabled`), true, 'wrong orientation blocks an incompatible assembly');
    await run(`const orientation2=document.querySelectorAll('[data-assembly-orientation]')[2];orientation2.value='forward';orientation2.dispatchEvent(new Event('change',{bubbles:true}))`);
    await click('[data-assembly-row]:nth-child(2) [data-assembly-move="up"]');
    assert.equal(await run(`${field('save')}.disabled`), true, 'fragment order controls the junctions');
    await click('[data-assembly-row]:nth-child(1) [data-assembly-move="down"]');
    await click('[data-assembly-row]:nth-child(3) [data-assembly-remove]');
    assert.equal(await run(count), 2);
    await add('c');
    await run(`${field('name')}.value='Overlap product'`);
    for (const [locale, label] of [['es', 'Ensamblar'], ['zh-Hans', '组装'], ['zh-Hant', '組裝'], ['ja', '組み立て']]) {
      await run(`${field('name')}.focus();${field('name')}.setSelectionRange(1,5);switchLocale('${locale}')`);
      assert.equal(await run(`${field('save')}.textContent`), label);
      assert.deepEqual(await run(`[${field('name')}.value,document.activeElement===${field('name')},${field('name')}.selectionStart,${field('name')}.selectionEnd]`), ['Overlap product', true, 1, 5]);
      assert.deepEqual(await run(`[...document.querySelectorAll('[data-assembly-orientation]')].map(e=>e.value)`), ['forward', 'forward', 'forward']);
    }
    await run(`switchLocale('en')`);
    for (const [width, height] of [[1280, 900], [800, 700], [480, 650]]) {
      win.setSize(width, height);
      await run(`document.body.classList.toggle('theme-night',${width === 800})`);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await run(`(()=>{const e=document.querySelector('.sequence-viewer-assembly-banner'),r=e.getBoundingClientRect(),s=${field('save')}.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1&&s.bottom<=innerHeight})()`), true, `assembly fits ${width} × ${height}`);
      assert.equal(await run(`document.querySelector('.sequence-viewer-assembly-body').getBoundingClientRect().top>=document.querySelector('.sequence-viewer-assembly-controls').getBoundingClientRect().bottom`), true, 'scrolling options never overlap the assemble controls');
      await screenshot(`overlap-${width}.png`);
    }
    await click('[data-assembly-save]');
    await run(`document.querySelector('.sequence-viewer-assembly-banner').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
    await waitFor(`${field('error')}.textContent.includes('Fixture lost save response')`);
    assert.equal(outputWrites, 1, 'duplicate submits are ignored');
    assert.equal((await entries()).filter(entry => entry.name === 'Overlap product').length, 1, 'a lost response does not lose the saved record');
    await click('[data-assembly-save]');
    await waitFor(`!${open}`);
    assert.equal(await run(`document.querySelectorAll('[data-assembly-selected]').length`), 0, 'finishing clears rail highlights');
    const assembled = (await entries()).filter(entry => entry.name === 'Overlap product');
    assert.equal(assembled.length, 1, 'retry reuses the output ID');
    assert.equal(assembled[0].parentEntryId, '');
    assert.ok(assembled[0].gbkRelPath.endsWith('.gbk'));
    const expected = await run(`records.a.sequence+records.b.sequence.slice(15)+records.c.sequence.slice(15)`);
    assert.equal(await run('readSequence()'), expected);
    const stored = await library.getSequenceEntry({ storagePath: scratch, id: assembled[0].id, includeGbk: true });
    assert.match(stored.gbkText, /hikari_assembly_method="overlap-pcr"/);
    assert.equal((await entries()).filter(entry => ['a', 'b', 'c'].includes(entry.id)).every(entry => entry.parentEntryId === 'template'), true);
    win.setSize(1280, 900);
    await openAssembly('sticky-a', true);
    await add('sticky-b');
    await click('[data-assembly-options]');
    await change('topology', 'circular');
    assert.equal(await run(`${field('save')}.disabled`), false);
    await run(`${field('name')}.value='Sticky circle'`);
    await screenshot('sticky-circle.png');
    await click('[data-assembly-save]');
    await waitFor(`!${open}`);
    const circle = (await entries()).find(entry => entry.name === 'Sticky circle');
    assert.equal(circle.parentEntryId, '');
    assert.equal(circle.topology, 'circular');
    assert.equal(await run('readSequence()'), await run('template.sequence.slice(11)+template.sequence.slice(0,11)'));
    await openAssembly('a');
    await add('b');
    await change('method', 'blunt');
    await click('[data-assembly-options]');
    await run(`const reverse=document.querySelectorAll('[data-assembly-orientation]')[1];reverse.value='reverse';reverse.dispatchEvent(new Event('change',{bubbles:true}));${field('name')}.value='Blunt product'`);
    assert.equal(await run(`${field('save')}.disabled`), false);
    await screenshot('blunt.png');
    await click('[data-assembly-save]');
    await waitFor(`!${open}`);
    const blunt = (await entries()).find(entry => entry.name === 'Blunt product');
    assert.equal(blunt.parentEntryId, '');
    assert.equal(blunt.sequenceLength, await run('records.a.sequence.length+records.b.sequence.length'));
    // An ordinary sequence right-click also opens assembly for the current DNA.
    await run(`rightClick('#sequence-viewer-sequence-host .sequence-viewer-strand-row-top .sequence-viewer-seq-base')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-assembly-current]');
    await waitFor(`${open} && ${count}===1 && !document.querySelector('[data-assembly-loading="true"]')`);
    assert.equal(await run(`document.querySelector('.sequence-viewer-assembly-source strong').textContent`), 'Blunt product');
    const beforeCancel = (await entries()).length;
    await click('[data-assembly-cancel]');
    assert.equal((await entries()).length, beforeCancel);
    assert.equal(await run(`document.querySelectorAll('[data-assembly-selected]').length`), 0, 'cancelling clears all assembly selection');
    await openAssembly('a');
    await change('method', 'blunt');
    holdRead = true;
    await click('#sequence-viewer-detail-library-list [data-sequence-entry-id="c"]');
    await waitFor(`!!document.querySelector('[data-assembly-loading="true"]')`);
    for (let i = 0; i < 100 && !releaseRead; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(releaseRead);
    await click('#sequence-viewer-detail-library-list [data-sequence-entry-id="c"]');
    assert.equal(await run(count), 1);
    holdRead = false;
    releaseRead();
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(await run(count), 1, 'deselecting a loading DNA item prevents late re-addition');
    win.setSize(480, 650);
    await new Promise(resolve => setTimeout(resolve, 150));
    await nativeClick('#sequence-viewer-detail-library-list [data-sequence-entry-id="b"]');
    await waitFor(`${count}===2 && !document.querySelector('[data-assembly-loading="true"]')`);
    await screenshot('banner-picking-480.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(`!${open}`);
    assert.equal(await run(`document.querySelectorAll('[data-assembly-selected]').length`), 0);
    const previousLoads = await run('detailLoads');
    await run(`openEntry('a')`);
    await waitFor(`detailLoads>${previousLoads}`);
    assert.equal((await entries()).length, beforeCancel, 'Escape cancels assembly and restores ordinary DNA navigation');
    assert.deepEqual(errors, []);
    console.log('Sequence assembly Electron QA passed: right-click initiation, nonmodal banner, DNA rail picking/toggle without navigation, fold/reflow highlights, options/order/orientation, all three methods, circular ligation, independent GBK outputs, stable retries, duplicate submits, localization, responsive layout, and cancellation.');
  } finally {
    win.destroy();
    await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    app.quit();
  }
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
