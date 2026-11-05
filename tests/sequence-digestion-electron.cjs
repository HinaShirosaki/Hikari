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
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal || 'Digestion UI QA failed'));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-digestion-ui-'));
  const output = path.join(root, 'artifacts/sequence-digestion');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js');
  const { registerSequenceLibraryIpc } = require('../src/main/ipc/register-data-ipc/register-sequence-library-ipc.js');
  let failSecond = false;
  let holdChild = false;
  let releaseChild = null;
  registerSequenceLibraryIpc({ ...library, ipcMain,
    cleanText: (value, limit) => String(value || '').trim().slice(0, limit), normalizeJsonPayload: value => value || {},
    upsertSequenceEntry: async payload => {
      if (payload.name === 'Double fragment 2' && failSecond) throw new Error('Fixture second fragment write failed');
      if (payload.parentEntryId && holdChild) await new Promise(resolve => { releaseChild = resolve; });
      return library.upsertSequenceEntry(payload);
    }
  });
  const preload = path.join(scratch, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',require(${JSON.stringify(path.join(root, 'src/main/preload/api/sequence-library-api.js'))}).createSequenceLibraryApi(ipcRenderer));`);
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body class="ui-neutral-compact theme-day">
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      import {i18n} from '${url('src/renderer/lib/i18n/index.js')}';
      import {translateTree} from '${url('src/renderer/lib/i18n/dom.js')}';
      window.switchLocale=locale=>{i18n.setLocale(locale);translateTree(document)};
      window.detailLoads=0;
      window.show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.viewer=initSequenceViewer({document,state:{settings:{},projects:[]},storagePath:${JSON.stringify(scratch)},
        homeViewId:'sequence-viewer-view',detailViewId:'sequence-viewer-detail-view',onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>{show('sequence-viewer-detail-view');detailLoads++}});
      window.sequence='ACGTTACGTA'+'GAATTC'+'TATCCGATGCTAGTACGTAC'+'GGATCC'+'CTAGTCGTAA'+'CCCGGG'+'ATGCTAGC';
      window.template={name:'Digest parent',sequence,topology:'circular',features:[{id:'gene',name:'Test CDS',type:'CDS',strand:1,segments:[{start:5,end:25}]}]};
      for(const topology of ['circular','linear']){
        const record={...template,name:topology==='circular'?'Digest parent':'Linear parent',topology};
        await hikariApi.sequenceLibraryUpsert({storagePath:${JSON.stringify(scratch)},id:topology,name:record.name,status:'saved',topology,
          sequence,sequenceLength:sequence.length,features:record.features,featureCount:record.features.length,gbkText:buildRecordGenbankText(record)});
      }
      window.host=document.getElementById('sequence-viewer-sequence-host');
      window.menu=document.getElementById('sequence-viewer-feature-context-menu');
      window.rail=name=>[...document.querySelectorAll('#sequence-viewer-feature-rail-host [data-feature-index]')].find(e=>e.getAttribute('aria-label').startsWith(name+' ('));
      window.openEntry=id=>document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="'+id+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));
      window.rightClick=name=>{const e=rail(name),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.top}))};
      window.hover=name=>{const e=host.querySelector('[data-feature-index="'+rail(name).dataset.featureIndex+'"]'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:r.left,clientY:r.top}))};
      window.readSequence=()=>[...host.querySelectorAll('.sequence-viewer-strand-row-top .sequence-viewer-seq-base')].map(e=>e.textContent).join('');
      viewer.render({activeViewId:'sequence-viewer-detail-view'});window.ready=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { sandbox: false, contextIsolation: true, preload } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level >= 3) errors.push(event.message); });
  const run = async code => { try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`${error.message}\nScript: ${code}\n${errors.join('\n')}`); } };
  const waitFor = async code => {
    for (let i = 0; i < 150; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  };
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const field = suffix => `document.querySelector('[data-digest-${suffix}]')`;
  const open = `document.querySelector('.sequence-viewer-digest-overlay')?.open`;
  const entries = async () => (await library.listSequenceEntries({ storagePath: scratch, status: 'saved' })).entries;
  const screenshot = async name => {
    await new Promise(resolve => setTimeout(resolve, 180));
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const saveButton = index => `[data-digest-save="${index}"]`;
  const savedButton = index => `document.querySelector('${saveButton(index)}').dataset.digestState==='saved'`;
  const loadParent = async (id = 'circular') => {
    const previousLoads = await run('detailLoads');
    await run(`openEntry('${id}')`);
    await waitFor(`detailLoads>${previousLoads} && readSequence()===sequence && document.getElementById('sequence-viewer-record-select').selectedOptions[0]?.textContent.startsWith('${id === 'linear' ? 'Linear parent' : 'Digest parent'}')`);
  };
  try {
    await win.loadFile(fixture);
    await waitFor(`window.ready && !!document.querySelector('#sequence-viewer-detail-library-list [data-sequence-entry-id="circular"]')`);
    await loadParent();
    await run(`rightClick('EcoRI')`);
    assert.equal(await run(`menu.querySelectorAll('[data-sequence-digest-action]').length`), 2);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="single"]');
    assert.equal(await run(open), true);
    assert.equal(await run(`document.querySelectorAll('[data-digest-save]').length`), 1);
    assert.equal(await run(`document.querySelectorAll('.sequence-viewer-digest-dialog input[type="checkbox"]').length`), 0);
    assert.doesNotMatch(await run(`document.querySelector('.sequence-viewer-digest-dialog').textContent`), /Left end:|Right end:|Choose which fragments|Confirm digestion|overhang|G\^AATTC/);
    assert.equal(await run(`getComputedStyle(document.querySelector('.sequence-viewer-digest-product')).borderTopWidth`), '0px');
    assert.equal((await entries()).length, 2, 'preview does not write files');
    await run(`document.querySelector('[data-digest-name="0"]').value='Single EcoRI'`);
    await screenshot('single-preview.png');
    holdChild = true;
    await click(saveButton(0));
    await waitFor(`document.querySelector('${saveButton(0)}').disabled`);
    for (let i = 0; i < 100 && !releaseChild; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(releaseChild);
    await run(`document.querySelector('${saveButton(0)}').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    holdChild = false;
    releaseChild();
    await waitFor(savedButton(0));
    assert.equal(await run(open), true, 'saving leaves the digest dialog open');
    assert.equal(await run(`document.querySelector('${saveButton(0)}').disabled`), true);
    assert.match(await run(`document.querySelector('${saveButton(0)}').textContent`), /✓/);
    await run(`document.querySelector('${saveButton(0)}').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    let saved = await entries();
    assert.equal(saved.length, 3, 'repeat clicks create only one child');
    const single = saved.find(entry => entry.name === 'Single EcoRI');
    assert.equal(single.parentEntryId, 'circular');
    assert.equal(saved.find(entry => entry.id === single.id).sequenceLength, await run('sequence.length'));
    const singleRecord = await library.getSequenceEntry({ storagePath: scratch, id: single.id, includeGbk: true });
    assert.match(singleRecord.gbkText, /hikari_digest_overhang="AATT"/);
    assert.equal(await run('readSequence()===sequence'), true, 'saving keeps the template in the sequence view');
    await click('[data-digest-cancel]');
    await loadParent();
    await run(`hover('EcoRI')`);
    await click('[data-sequence-hover-tooltip="feature"] [data-sequence-digest-action="double"]');
    assert.equal(await run(`!!document.querySelector('.sequence-viewer-digest-picker')`), true);
    for (const width of [1600, 1280, 800, 480]) {
      win.setSize(width, 850);
      await run(`document.body.classList.toggle('theme-night',${width === 800})`);
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(await run(`(()=>{const b=document.querySelector('.sequence-viewer-digest-picker'),t=document.getElementById('sequence-viewer-detail-toolbar'),r=b.getBoundingClientRect(),tr=t.getBoundingClientRect(),content=document.querySelector('.sequence-viewer-results').getBoundingClientRect();const before=[tr.top,tr.height,content.top];b.style.display='none';const after=[t.getBoundingClientRect().top,t.getBoundingClientRect().height,document.querySelector('.sequence-viewer-results').getBoundingClientRect().top];b.style.removeProperty('display');return b.parentElement===document.body&&getComputedStyle(b).position==='fixed'&&r.left>=tr.left-1&&r.right<=tr.right+1&&r.top>=0&&r.bottom<=content.top+1&&JSON.stringify(before)===JSON.stringify(after)})()`), true, `restriction card floats over the header without moving controls or covering DNA at ${width}px`);
      await screenshot(`restriction-toolbar-${width}.png`);
    }
    assert.equal(await run(open), false);
    await run(`rail('EcoRI').click()`);
    assert.equal(await run(open), false, 'the same site cannot be selected twice');
    await run(`rail('BamHI').click()`);
    assert.equal(await run(open), true);
    assert.equal(await run(`document.querySelector('.sequence-viewer-digest-picker')===null`), true, 'choosing the second restriction site removes the floating card');
    assert.equal(await run(`document.querySelectorAll('[data-digest-save]').length`), 2);
    assert.match(await run(`${field('sites')}.textContent`), /EcoRI/);
    assert.match(await run(`${field('sites')}.textContent`), /BamHI/);
    await run(`document.querySelector('[data-digest-name="0"]').value='Double fragment 1';document.querySelector('[data-digest-name="1"]').value='Double fragment 2'`);
    for (const width of [1280, 800, 480]) {
      win.setSize(width, 850);
      await run(`document.body.classList.toggle('theme-night',${width === 800})`);
      await new Promise(resolve => setTimeout(resolve, 70));
      assert.equal(await run(`(()=>{const e=document.querySelector('.sequence-viewer-digest-dialog'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1})()`), true, `Digest dialog fits ${width}px`);
      await screenshot(`double-${width}.png`);
    }
    await click(saveButton(0));
    await waitFor(savedButton(0));
    assert.equal((await entries()).length, 4);
    assert.equal(await run(`document.querySelector('${saveButton(1)}').textContent`), 'Save');
    assert.equal(await run(`document.querySelector('[data-digest-name="1"]').disabled`), false, 'unsaved names remain editable');
    assert.equal(await run(`${field('enzyme-0')}.disabled && ${field('enzyme-1')}.disabled`), true, 'saved products retain their digest choices');
    for (const [locale, save, status] of [['es', 'Guardar', 'Guardado'], ['zh-Hans', '保存', '已保存'], ['zh-Hant', '儲存', '已儲存'], ['ja', '保存', '保存済み']]) {
      await run(`document.querySelector('[data-digest-name="1"]').focus();document.querySelector('[data-digest-name="1"]').setSelectionRange(2,6);switchLocale('${locale}')`);
      assert.equal(await run(`document.querySelector('${saveButton(1)}').textContent`), save);
      assert.match(await run(`document.querySelector('${saveButton(0)}').textContent`), new RegExp(status));
      assert.equal(await run(`document.querySelector('[data-digest-name="1"]').value`), 'Double fragment 2');
      assert.deepEqual(await run(`(()=>{const e=document.querySelector('[data-digest-name="1"]');return [document.activeElement===e,e.selectionStart,e.selectionEnd]})()`), [true, 2, 6]);
    }
    await run(`switchLocale('en')`);
    await screenshot('double-one-saved.png');
    failSecond = true;
    await click(saveButton(1));
    await waitFor(`${field('error')}.textContent.includes('Fixture second fragment write failed')`);
    assert.equal((await entries()).length, 4, 'first child remains saved when another save fails');
    assert.equal(await run(open), true);
    assert.equal(await run(savedButton(0)), true);
    assert.equal(await run(`document.querySelector('${saveButton(1)}').disabled`), false, 'failed fragment can be retried');
    failSecond = false;
    await click(saveButton(1));
    await waitFor(savedButton(1));
    saved = await entries();
    assert.equal(saved.length, 5, 'retry does not duplicate the first child');
    assert.ok(saved.filter(entry => entry.name.startsWith('Double fragment')).every(entry => entry.parentEntryId === 'circular' && entry.gbkRelPath.endsWith('.gbk')));
    await click('[data-digest-cancel]');
    await loadParent();
    await run(`rightClick('SmaI')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="single"]');
    assert.equal(await run(`${field('enzyme-0')}.value`), 'SmaI');
    assert.equal(await run(`[...${field('enzyme-0')}.options].every(option=>!option.textContent.includes('^') && !option.textContent.includes('CCCGGG'))`), true, 'options show enzyme names without cut sequences');
    await run(`${field('enzyme-0')}.value='XmaI';${field('enzyme-0')}.dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.match(await run(`document.querySelector('[data-digest-name="0"]').value`), /XmaI/);
    await run(`document.querySelector('[data-digest-name="0"]').value='XmaI variant'`);
    await click(saveButton(0));
    await waitFor(savedButton(0));
    const variant = (await entries()).find(entry => entry.name === 'XmaI variant');
    assert.match((await library.getSequenceEntry({ storagePath: scratch, id: variant.id, includeGbk: true })).gbkText, /hikari_digest_overhang="CCGG"/);
    await click('[data-digest-cancel]');
    await loadParent('linear');
    await run(`rightClick('EcoRI')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="double"]');
    await run(`rail('BamHI').click()`);
    assert.equal(await run(`document.querySelectorAll('[data-digest-save]').length`), 3);
    await click('[data-digest-cancel]');
    await run(`rightClick('EcoRI')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="single"]');
    assert.equal(await run(`document.querySelectorAll('[data-digest-save]').length`), 2);
    await run(`document.querySelector('[data-digest-name="1"]').value='Kept linear fragment'`);
    await click(saveButton(1));
    await waitFor(savedButton(1));
    assert.equal(await run(savedButton(0)), false, 'other products stay available to save or discard');
    assert.equal(await run(`document.querySelector('${saveButton(0)}').disabled`), false);
    await click('[data-digest-cancel]');
    assert.equal((await entries()).filter(entry => entry.parentEntryId === 'linear').length, 1, 'closing discards only unsaved products');
    win.setSize(1280, 850);
    await loadParent();
    await click('#sequence-viewer-vector-builder-btn');
    await run(`const toggle=document.getElementById('sequence-viewer-vector-builder-cutters-toggle');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}))`);
    await run(`(()=>{const e=document.querySelector('#sequence-viewer-vector-builder-map [data-feature-index="'+rail('EcoRI').dataset.featureIndex+'"]'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.top}))})()`);
    await click('#sequence-viewer-vector-builder-context-menu [data-sequence-digest-action="double"]');
    assert.equal(await run(`!!document.querySelector('.sequence-viewer-digest-picker')`), true);
    assert.equal(await run(`document.querySelector('.sequence-viewer-digest-picker').dataset.pickerAnchor`), 'sequence-viewer-vector-toolbar');
    assert.equal(await run(`(()=>{const b=document.querySelector('.sequence-viewer-digest-picker').getBoundingClientRect(),content=document.querySelector('.sequence-viewer-vector-builder-layout').getBoundingClientRect();return b.bottom<=content.top+1})()`), true, 'the map prompt stays above the map and sequence');
    await screenshot('restriction-toolbar-vector.png');
    await click('#sequence-viewer-vector-builder-back-btn');
    await waitFor(`document.querySelector('.sequence-viewer-digest-picker').dataset.pickerAnchor==='sequence-viewer-detail-toolbar'`);
    await click('#sequence-viewer-vector-builder-btn');
    await waitFor(`document.querySelector('.sequence-viewer-digest-picker').dataset.pickerAnchor==='sequence-viewer-vector-toolbar'`);
    await run(`document.querySelector('#sequence-viewer-vector-builder-map [data-feature-index="'+rail('BamHI').dataset.featureIndex+'"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}))`);
    assert.equal(await run(open), true, 'map mousedown picks the second site before its selection rerenders');
    await click('[data-digest-cancel]');
    const beforeCancel = (await entries()).length;
    await run(`rightClick('EcoRI')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="double"]');
    await run(`viewer.loadFromExternal({name:'Other template',sequence:'ACGTACGTACGT',topology:'linear',features:[]})`);
    assert.equal(await run(`!!document.querySelector('.sequence-viewer-digest-picker')`), false, 'changing template cancels site picking');
    assert.equal((await entries()).length, beforeCancel);
    // The first individual save also creates a durable parent for an imported
    // template. A child-write failure must not make the next save look stale.
    await run(`viewer.loadFromExternal({name:'Imported digest parent',sequence,topology:'circular',features:[]});rightClick('EcoRI')`);
    await click('#sequence-viewer-feature-context-menu [data-sequence-digest-action="double"]');
    await run(`rail('BamHI').click();document.querySelector('[data-digest-name="0"]').value='  '`);
    await click(saveButton(0));
    assert.match(await run(`${field('error')}.textContent`), /Enter a fragment name/);
    assert.equal((await entries()).length, beforeCancel);
    await run(`document.querySelector('[data-digest-name="0"]').value='Double fragment 2'`);
    failSecond = true;
    await click(saveButton(0));
    await waitFor(`${field('error')}.textContent.includes('Fixture second fragment write failed')`);
    assert.equal((await entries()).length, beforeCancel + 1, 'failed child write still saves the imported parent');
    failSecond = false;
    await run(`document.querySelector('[data-digest-name="0"]').value='Imported fragment 1'`);
    await click(saveButton(0));
    await waitFor(savedButton(0));
    await click(saveButton(1));
    await waitFor(savedButton(1));
    saved = await entries();
    const importedParent = saved.find(entry => entry.name === 'Imported digest parent');
    assert.equal(saved.filter(entry => entry.parentEntryId === importedParent.id).length, 2);
    assert.equal(saved.length, beforeCancel + 3, 'all saves share the same newly persisted template');
    assert.equal(await run('readSequence()===sequence'), true);
    await click('[data-digest-cancel]');
    assert.deepEqual(errors, []);
    console.log('Sequence digestion Electron QA passed: compact enzyme selectors, individual saves and checkmarks, unsaved edits, save failure/retry, duplicate clicks, stable template, GBK end metadata, locale/focus preservation, discard on close, single/double digestion, vector map, and responsive layouts.');
  } finally {
    win.destroy();
    await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    app.quit();
  }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
