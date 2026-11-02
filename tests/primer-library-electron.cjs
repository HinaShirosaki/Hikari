'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 90000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || `Primer Library QA failed (${result.signal || result.status})`));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-primer-library-electron-'));
  const output = path.join(root, 'artifacts/primer-library');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body>
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {normalizeState} from '${url('src/renderer/modules/app-state/index.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.show=show;window.appState=normalizeState(JSON.parse(localStorage.getItem('primer-qa')||'{}'));
      window.copied='';window.persistCount=0;
      window.viewer=initSequenceViewer({document,state:appState,createId:()=>crypto.randomUUID(),
        persist:()=>{persistCount++;localStorage.setItem('primer-qa',JSON.stringify(appState))},
        apiBridge:{writeTextToClipboard:async text=>{window.copied=text;return {ok:true}}},
        onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
      let seed=1701;
      const randomDna=Array.from({length:800},()=>{seed=(1664525*seed+1013904223)>>>0;return 'ACGT'[seed>>>30]}).join('');
      const record={name:'Test construct',topology:'circular',
        sequence:'ATGGCACGTTTAGGCCATAC'+'CGATCCGACATGCTAGCATGCGACTGGCACTAGCTAGCATGCGACATGCGATCG'+randomDna,
        features:[{id:'forward',name:'Construct F',type:'primer_bind',strand:1,primerSequence:'GGTCTCGATGGCACGTTTAGGCCATAC',segments:[{start:0,end:20}]},
          {id:'reverse',name:'Imported R',type:'primer_bind',strand:-1,segments:[{start:25,end:45}]}]};
      window.primerFixture=record;
      window.loadPrimerFixture=(next)=>{
        viewer.loadFromExternal(next);
        document.getElementById('sequence-viewer-textarea').value=buildRecordGenbankText(next);
        document.getElementById('sequence-viewer-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      };
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedHover=value}}});
      loadPrimerFixture(record);
      window.qaReady=true;
    </script></body></html>`);
  // Synthetic hover/focus checks must not be replaced by the desktop pointer.
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`${error.message}\nScript: ${code}\n${errors.join('\n')}`); }
  };
  const click = id => exec(`document.getElementById(${JSON.stringify(id)}).click()`);
  const focus = selector => exec(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    e.focus();e.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));})()`);
  const ready = async () => {
    for (let i = 0; i < 120 && !await exec('Boolean(window.qaReady)'); i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  };
  const hover = async index => {
    // This fixture targets a fresh card directly; native pointer paths have
    // their own regression test, including preservation across nearby features.
    await exec(`(()=>{document.querySelectorAll('[data-sequence-hover-tooltip]').forEach(e=>e.hidden=true);
      const e=document.querySelector('#sequence-viewer-sequence-host [data-feature-index="${index}"]');
      const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:r.left+5,clientY:r.top+5}))})()`);
  };
  const rows = () => exec('appState.primerLibrary');
  const screenshot = async name => {
    await new Promise(resolve => setTimeout(resolve, 180));
    await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.promises.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const assertHoverLayout = async selector => {
    const geometry = await exec(`(()=>{
      const e=document.querySelector(${JSON.stringify(selector)});
      if (!e) return {diagnostic:'Hover card did not open'};
      const r=e.getBoundingClientRect();
      if (!e.querySelector('.sequence-viewer-primer-hover-title')) return {diagnostic:e.outerHTML};
      const title=e.querySelector('.sequence-viewer-primer-hover-title').getBoundingClientRect();
      const actions=e.querySelector('.sequence-viewer-primer-hover-head .sequence-viewer-primer-hover-buttons').getBoundingClientRect();
      return {hidden:e.hidden,left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,
        overflow:e.scrollWidth>e.clientWidth,titleRight:title.right,actionsLeft:actions.left};
    })()`);
    assert.equal(geometry.diagnostic, undefined);
    assert.equal(geometry.hidden, false);
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height);
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.titleRight <= geometry.actionsLeft);
  };
  try {
    await win.loadFile(fixture); await ready();
    for (const night of [true, false]) {
      await exec(`document.body.classList.toggle('theme-night',${night})`);
      await hover(0);
      await assertHoverLayout('[data-sequence-hover-tooltip="feature"]');
      await screenshot(night ? 'hover-save-night.png' : 'hover-save.png');
    }
    await exec(`loadPrimerFixture({...primerFixture,features:[{...primerFixture.features[0],name:'Junction_'.repeat(12)+'F',primerSequence:'ACGT'.repeat(45)}]})`);
    await exec(`document.querySelector('#sequence-viewer-sequence-host [data-feature-index="0"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:innerWidth-12,clientY:innerHeight-12}))`);
    await assertHoverLayout('[data-sequence-hover-tooltip="feature"]');
    await screenshot('hover-long-primer.png');
    await exec('loadPrimerFixture(primerFixture)');
    assert.equal(await exec(`document.querySelector('[data-sequence-hover-tooltip="feature"]').hidden`), true);
    await click('sequence-viewer-vector-builder-btn');
    await focus('#sequence-viewer-vector-builder-map [data-feature-index="0"]');
    await assertHoverLayout('[data-sequence-hover-tooltip="map"]');
    assert.equal(await exec(`document.querySelectorAll('[data-sequence-hover-tooltip]:not([hidden])').length`), 1);
    await focus('[data-sequence-hover-tooltip="map"] [data-sequence-primer-copy-kind="name"]');
    assert.equal(await exec(`document.querySelector('[data-sequence-hover-tooltip="map"]').hidden`), false);
    await exec(`document.querySelector('[data-sequence-hover-tooltip="map"] [data-sequence-primer-copy-kind="name"]').click()`);
    assert.equal(await exec('window.copiedHover'), 'Construct F');
    await exec(`document.querySelector('[data-sequence-hover-tooltip="map"] [data-sequence-primer-copy-kind="sequence"]').click()`);
    assert.equal(await exec('window.copiedHover'), 'GGTCTCGATGGCACGTTTAGGCCATAC');
    assert.equal(await exec(`document.querySelector('[data-sequence-hover-tooltip="map"]').hidden`), false);
    await screenshot('hover-map.png');
    await click('sequence-viewer-vector-builder-back-btn');
    await hover(0);
    await screenshot('hover-save.png');
    await exec(`document.querySelector('[data-sequence-hover-tooltip="feature"] [data-sequence-primer-library-save]').click()`);
    assert.equal((await rows())[0].sequence, 'GGTCTCGATGGCACGTTTAGGCCATAC');
    await exec(`document.querySelector('[data-sequence-hover-tooltip="feature"] [data-sequence-primer-library-save]').click()`);
    assert.equal((await rows()).length, 1);
    await hover(1);
    await exec(`document.querySelector('[data-sequence-hover-tooltip="feature"] [data-sequence-primer-library-save]').click()`);
    assert.equal((await rows()).length, 2);
    assert.equal((await rows())[1].sequence, 'AGTCGCATGCTAGCATGTCG');
    await click('sequence-viewer-detail-primer-library-open');
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-overlay').open`), true);
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-export').disabled`), true);
    await exec(`document.querySelector('[data-primer-library-select]').click()`);
    await click('sequence-viewer-primer-library-export');
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-order-preview').value`), 'Construct F\tGGTCTCGATGGCACGTTTAGGCCATAC\t25nm\tSTD');
    await click('sequence-viewer-primer-order-copy-idt');
    assert.equal(await exec('window.copied'), 'Construct F\tGGTCTCGATGGCACGTTTAGGCCATAC\t25nm\tSTD');
    // Native <dialog> Escape needs a trusted key event; it closes only the top dialog.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-order-overlay').open`), false);
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-overlay').open`), true);
    await exec(`(()=>{const e=document.querySelector('[data-primer-library-name]');e.value='Order F';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert.equal((await rows())[0].name, 'Order F');
    await screenshot('library-selected.png');
    await exec(`(()=>{const e=document.getElementById('sequence-viewer-primer-library-search');e.value='Imported';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click('sequence-viewer-primer-library-select-all');
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-count').textContent`), '2 primers · 2 selected');
    await click('sequence-viewer-primer-library-export');
    assert.equal((await exec(`document.getElementById('sequence-viewer-primer-order-preview').value`)).split('\n').length, 2);
    await click('sequence-viewer-primer-order-close');
    await click('sequence-viewer-primer-library-close');
    await win.reload(); await ready();
    assert.equal((await rows()).length, 2);
    assert.equal((await rows())[0].name, 'Order F');
    await exec(`show('sequence-viewer-view');viewer.render({activeViewId:'sequence-viewer-view'})`);
    await click('sequence-viewer-primer-library-open');
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-overlay').open`), true);
    await click('sequence-viewer-primer-library-select-all');
    await click('sequence-viewer-primer-library-export');
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-order-overlay').getBoundingClientRect().width > 0`), true);
    await screenshot('home-idt-export.png');
    await click('sequence-viewer-primer-order-close');
    await click('sequence-viewer-primer-library-close');
    await exec(`show('sequence-viewer-detail-view');viewer.render({activeViewId:'sequence-viewer-detail-view'});document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}))`);
    assert.equal(await exec(`document.getElementById('sequence-viewer-sequence-edit-overlay').hidden`), false);
    await exec(`document.getElementById('sequence-viewer-sequence-edit-textarea').value='GAATTC';document.getElementById('sequence-viewer-sequence-edit-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
    for (let i = 0; i < 100 && await exec(`document.getElementById('sequence-viewer-cloning-design-btn').disabled`); i++) await new Promise(resolve => setTimeout(resolve, 20));
    await click('sequence-viewer-cloning-design-btn');
    for (let i = 0; i < 150 && !await exec(`Boolean(document.querySelector('[data-cloning-design-action="save-primers"]'))`); i++) await new Promise(resolve => setTimeout(resolve, 30));
    await screenshot('cloning-design.png');
    assert.equal(await exec(`Boolean(document.querySelector('[data-cloning-design-action="save-primers"]'))`), true,
      await exec(`document.getElementById('sequence-viewer-cloning-design-result').textContent`));
    const before = (await rows()).length;
    await exec(`document.querySelector('[data-cloning-design-action="save-primers"]').click()`);
    assert.ok((await rows()).length > before);
    await screenshot('cloning-save-all.png');
    const added = (await rows()).length;
    await exec(`document.querySelector('[data-cloning-design-action="save-primers"]').click()`);
    assert.equal((await rows()).length, added);
    await click('sequence-viewer-cloning-design-back-btn');
    await click('sequence-viewer-detail-primer-library-open');
    // The dialog remains usable on narrower windows and in the night theme.
    for (const width of [1280, 800, 480]) {
      win.setSize(width, 850);
      await exec(`document.body.classList.toggle('theme-night',${width === 800})`);
      const geometry = await exec(`(()=>{const e=document.querySelector('.sequence-viewer-primer-library-dialog'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height);
      await screenshot(`library-${width}.png`);
    }
    await click('sequence-viewer-primer-library-select-all');
    await click('sequence-viewer-primer-library-remove');
    assert.equal((await rows()).length, 0);
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-library-export').disabled`), true);

    // The feature-design result is an unboxed reading surface, with direct save
    // using the exact same pair shown in its copy/order actions.
    await click('sequence-viewer-primer-library-close');
    win.setSize(1280, 850);
    await exec(`document.body.classList.add('ui-neutral-compact');window.designFixture={...primerFixture,name:'Primer_design_QA',features:[
      {id:'bom',name:'bom',type:'misc_feature',strand:1,segments:[{start:43,end:183}]}]};
      loadPrimerFixture(designFixture)`);
    const design = async (map = false) => {
      const host = map ? '#sequence-viewer-vector-builder-map' : '#sequence-viewer-sequence-host';
      await exec(`(()=>{
        for(const type of ['mousedown','contextmenu']){
          const e=document.querySelector('${host} [data-feature-index="0"]'),r=e.getBoundingClientRect();
          e.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:r.left+5,clientY:r.top+5}));
        }
        document.querySelector('${map ? '#sequence-viewer-vector-builder-context-menu [data-vector-action="design-primer"]' : '#sequence-viewer-feature-context-menu [data-sequence-feature-action="design-primer"]'}').click();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await exec(`document.getElementById('sequence-viewer-primer-design-overlay').hidden`), false);
    };
    const displayedPair = () => exec(`Array.from(document.querySelectorAll('#sequence-viewer-primer-design-result tbody tr')).map(row=>({
      name:row.querySelector('[data-sequence-primer-copy-kind="name"]').dataset.sequencePrimerCopy,
      sequence:row.querySelector('[data-sequence-primer-copy-kind="sequence"]').dataset.sequencePrimerCopy
    }))`);
    await design();
    const pair = await displayedPair();
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map(primer => primer.name), ['bom F', 'bom R']);
    for (const [width, night] of [[1280, false], [800, true], [480, false]]) {
      win.setSize(width, 850);
      await exec(`document.body.classList.toggle('theme-night',${night})`);
      const geometry = await exec(`(()=>{
        const e=document.getElementById('sequence-viewer-primer-design-result'),style=getComputedStyle(e);
        const r=document.querySelector('.sequence-viewer-primer-design-dialog').getBoundingClientRect();
        const sequence=document.querySelector('.sequence-viewer-primer-design-table .sequence-viewer-cloning-design-primer-seq');
        const action=document.getElementById('sequence-viewer-primer-design-save').getBoundingClientRect();
        return {background:style.backgroundColor,border:style.borderTopWidth,font:style.fontFamily,
          sequenceFont:getComputedStyle(sequence).fontFamily,left:r.left,right:r.right,bottom:r.bottom,
          actionLeft:action.left,actionRight:action.right,actionBottom:action.bottom,width:innerWidth,height:innerHeight};
      })()`);
      assert.equal(geometry.background, 'rgba(0, 0, 0, 0)');
      assert.equal(geometry.border, '0px');
      assert.doesNotMatch(geometry.font, /mono/i);
      assert.match(geometry.sequenceFont, /mono/i);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height);
      assert.ok(geometry.actionLeft >= 0 && geometry.actionRight <= geometry.width && geometry.actionBottom <= geometry.height);
      await screenshot(`designed-primers-${width}${night ? '-night' : ''}.png`);
    }
    await click('sequence-viewer-primer-design-save');
    assert.deepEqual((await rows()).map(({ name, sequence }) => ({ name, sequence })), pair);
    assert.ok((await rows()).every(primer => primer.sourceName === 'Primer_design_QA'));
    const persisted = await exec('persistCount');
    await click('sequence-viewer-primer-design-save');
    assert.equal((await rows()).length, 2, 'Saving the pair again does not duplicate it');
    assert.equal(await exec('persistCount'), persisted);
    await click('sequence-viewer-primer-design-order');
    assert.equal((await exec(`document.getElementById('sequence-viewer-primer-order-preview').value`)).split('\n').length, 2);
    await click('sequence-viewer-primer-order-close');
    await click('sequence-viewer-primer-design-dismiss');

    win.setSize(1280, 850);
    await click('sequence-viewer-vector-builder-btn');
    await design(true);
    const mapPair = await displayedPair();
    assert.equal(mapPair.length, 2);
    await click('sequence-viewer-primer-design-save');
    const mapSaved = await rows();
    assert.ok(mapPair.every(primer => mapSaved.some(saved => saved.name === primer.name && saved.sequence === primer.sequence)));
    await win.reload(); await ready();
    assert.deepEqual(await rows(), mapSaved, 'Directly saved designed primers survive reload');

    await exec(`loadPrimerFixture({...primerFixture,name:'Ambiguous_design_QA',sequence:'N'.repeat(200),features:[
      {id:'bom',name:'bom',type:'misc_feature',strand:1,segments:[{start:43,end:183}]}]})`);
    await design();
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-design-save').disabled`), true);
    assert.equal(await exec(`document.getElementById('sequence-viewer-primer-design-order').disabled`), true);
    assert.equal((await displayedPair()).length, 0, 'Failed design clears the previous pair');
    assert.deepEqual(errors, []);
    console.log('Primer Library Electron QA passed: hover/map copy actions; full oligos, duplicates, IDT, rename/search, persistence, cloning save-all and removal; unboxed feature-design layouts in day/night/narrow windows, direct save from sequence/maps, ordering, reload and failed-design actions.');
  } finally {
    win.destroy();
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  app.quit();
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
