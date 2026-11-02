const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 90000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal || 'Annealing Electron QA failed'));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-annealing-'));
  const output = path.join(root, 'artifacts/cloning-primer-annealing');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}.workspace-main{width:100%;height:100vh}</style></head><body><main class="workspace-main">
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    </main><script type="module">
      import {createSequenceViewerCloningDesignController} from '${url('src/renderer/modules/sequence-viewer/cloning-design.js')}';
      import {getSequenceViewerElements} from '${url('src/renderer/modules/sequence-viewer/dom.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      const dna=(length,seed)=>{let s=seed>>>0;return Array.from({length},()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return 'ACGT'[s%4]}).join('')};
      const original=dna(900,511), insert=dna(20,861);
      const product=original.slice(0,300)+insert+original.slice(300);
      window.source={parentEntryId:'parent',recordName:'Test vector',originalSequence:original,editedSequence:product,
        originalRange:{start:300,end:300},editedRange:{start:300,end:320},editRequest:{type:'insertion',start:301,end:300,editedSequence:insert}};
      window.state={records:[{name:'Final construct',sequence:product,topology:'circular',features:[]}],selectedRecordIndex:0,cloningDesign:{}};
      window.appState={};window.savedPrimers=[];window.orderedPrimers=[];window.writes=[];window.statuses=[];
      const template={name:'Test vector',sequence:original,topology:'circular',features:[]};
      window.controller=createSequenceViewerCloningDesignController({state,appState,elements:getSequenceViewerElements(document),
        getSelectedRecord:()=>state.records[0],getCloningDesignSource:()=>source,
        getStoragePath:()=>'/isolated/qa',persist:()=>{},persistFeatureMutation:async()=>{},
        setStatus:(text,error)=>statuses.push({text,error}),
        onSavePrimersToLibrary:primers=>{window.savedPrimers=primers},onRequestPrimerOrder:primers=>{window.orderedPrimers=primers},
        getBridge:()=>({sequenceLibraryGet:async()=>({ok:true,entry:{id:'parent',name:'Test vector'},gbkText:buildRecordGenbankText(template)}),
          sequenceLibraryUpsert:async payload=>{writes.push(payload);return {ok:true,entry:{id:payload.id||'product',name:payload.name,status:'unsaved'}}}})});
      document.getElementById('sequence-viewer-detail-view').classList.add('is-active');
      document.getElementById('sequence-viewer-detail-view').hidden=false;
      for(const id of ['sequence-viewer-detail-workspace','sequence-viewer-vector-builder-workspace','sequence-viewer-protein-builder-confirm-workspace']) {const e=document.getElementById(id);if(e)e.hidden=true;}
      document.getElementById('sequence-viewer-cloning-design-workspace').hidden=false;
      controller.bindEvents();controller.render();state.cloningDesign.strategy='q5-kld';controller.designPrimers();
      window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 940, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code, true);
  const click = selector => exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const metric = key => exec(`document.querySelector('[data-annealing-metric="${key}"]').textContent`);
  const referenceSnapshot = () => exec(`(()=>{
    const svg=document.querySelector('.primer-annealing-duplex'),reference=svg.querySelector('[data-annealing-reference]');
    const scroller=document.querySelector('.primer-annealing-scroll');
    return {width:svg.getAttribute('width'),viewBox:svg.getAttribute('viewBox'),dna:reference.innerHTML,scrollLeft:scroller.scrollLeft,
      template:source.originalSequence,product:state.records[0].sequence};
  })()`);
  const rememberReference = () => exec(`window.referenceNode=document.querySelector('[data-annealing-reference]');window.referenceScroller=document.querySelector('.primer-annealing-scroll')`);
  const assertMountedReference = async snapshot => {
    assert.deepEqual(await referenceSnapshot(), snapshot, 'DNA bases, coordinates, track width, source sequences, and viewport stay fixed');
    assert.equal(await exec(`document.querySelector('[data-annealing-reference]')===window.referenceNode && document.querySelector('.primer-annealing-scroll')===window.referenceScroller`), true, 'only the primer layer updates during a drag');
  };
  const handlePoint = async () => {
    await exec(`document.querySelector('[data-annealing-length-handle]').scrollIntoView({block:'center',inline:'center'})`);
    return exec(`(()=>{const r=document.querySelector('[data-annealing-length-handle]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  };
  const pointer = (type, point) => win.webContents.sendInputEvent({ type, ...point, ...(type === 'mouseDown' || type === 'mouseUp' ? { button: 'left', clickCount: 1 } : {}) });
  const screenshot = async name => {
    await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(fixture);
    for (let i = 0; i < 120 && !await exec('Boolean(window.qaReady)'); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
    win.show(); win.focus();
    assert.equal(await exec('state.cloningDesign.displayPlan.feasible'), true);
    assert.equal(await exec('document.querySelectorAll(".primer-annealing-duplex").length'), 1);
    assert.notEqual(await metric('template-tm'), await metric('product-tm'));
    assert.equal(await exec('document.querySelectorAll(".primer-annealing-oligo-base").length'), await exec('state.cloningDesign.displayPlan.primers[0].length'));
    assert.ok(await exec('document.querySelectorAll(".primer-annealing-base").length > 0'));
    await screenshot('template.png');
    await click('[data-annealing-mode="product"]');
    assert.equal(await exec('document.querySelector(".primer-annealing-dna-label").textContent.includes("Final plasmid")'), true);
    await screenshot('product.png');
    await click('[data-annealing-action="next"]');
    assert.equal(await exec('document.querySelector("[data-annealing-primer]").value'), '1');
    await click('[data-annealing-action="next"]');
    assert.equal(await exec('document.querySelector("[data-annealing-primer]").value'), '0');
    await click('[data-annealing-action="previous"]');
    const original = await exec('state.cloningDesign.displayPlan.primers[1].sequence');
    const point = await handlePoint();
    const fixedReference = await referenceSnapshot();
    await rememberReference();
    pointer('mouseMove', point); pointer('mouseDown', point);
    pointer('mouseMove', { x: point.x + 30, y: point.y });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence'), original);
    assert.equal(await metric('length'), `${original.length + 2} nt`);
    await assertMountedReference(fixedReference);
    await screenshot('length-preview.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    pointer('mouseUp', { x: point.x + 30, y: point.y });
    assert.equal(await metric('length'), `${original.length} nt`);
    await assertMountedReference(fixedReference);
    const nextPoint = await handlePoint();
    pointer('mouseMove', nextPoint); pointer('mouseDown', nextPoint);
    pointer('mouseMove', { x: nextPoint.x + 15, y: nextPoint.y });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    pointer('mouseMove', { x: nextPoint.x + 30, y: nextPoint.y });
    pointer('mouseUp', { x: nextPoint.x + 30, y: nextPoint.y });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    const applied = await exec('state.cloningDesign.displayPlan.primers[1].sequence');
    assert.equal(applied.length, original.length + 2);
    assert.deepEqual(await referenceSnapshot(), fixedReference, 'releasing the primer does not rebuild its reference window');
    assert.equal(await exec('document.querySelector("[data-annealing-primer]").value'), '1');
    assert.equal(await exec('document.querySelector("[data-annealing-mode=product]").getAttribute("aria-pressed")'), 'true');
    assert.ok(await exec(`document.querySelector('.sequence-viewer-cloning-design-primer-table').textContent.includes(${JSON.stringify(applied)})`));
    assert.ok(await exec(`JSON.stringify(appState.notebookEntries).includes(${JSON.stringify(applied)})`));
    assert.ok(await exec(`state.records[0].features.some(f=>f.primerSequence===${JSON.stringify(applied)})`));
    assert.equal(await exec(`document.querySelectorAll('[data-annealing-length],.primer-annealing-method,.primer-annealing-actions').length`), 0, 'standalone controls and helper paragraph are removed');
    // Keyboard resizing uses the same on-primer handle and commits on key-up.
    await exec(`document.querySelector('[data-annealing-length-handle]').focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence.length'), applied.length - 1);
    await exec(`document.querySelector('[data-annealing-length-handle]').focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence'), applied);
    assert.deepEqual(await referenceSnapshot(), fixedReference, 'keyboard resizing also keeps the reference fixed');
    // Exercise extension and shortening on forward/reverse primers in both DNA views.
    for (const primerIndex of [0, 1]) {
      await exec(`(()=>{const select=document.querySelector('[data-annealing-primer]');select.value='${primerIndex}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      for (const mode of ['template', 'product']) {
        await click(`[data-annealing-mode="${mode}"]`);
        const originalLength = await exec(`state.cloningDesign.displayPlan.primers[${primerIndex}].length`);
        for (const delta of [30, -30]) {
          const position = await handlePoint(), snapshot = await referenceSnapshot();
          await rememberReference();
          pointer('mouseMove', position); pointer('mouseDown', position);
          pointer('mouseMove', {x:position.x+delta,y:position.y});
          await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
          await assertMountedReference(snapshot);
          pointer('mouseUp', {x:position.x+delta,y:position.y});
          await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
          assert.deepEqual(await referenceSnapshot(), snapshot);
        }
        assert.equal(await exec(`state.cloningDesign.displayPlan.primers[${primerIndex}].length`), originalLength);
      }
    }
    // Moving near the edge must not automatically pan the underlying DNA.
    await exec(`(()=>{const s=document.querySelector('.primer-annealing-scroll'),h=document.querySelector('[data-annealing-length-handle]');const r=h.getBoundingClientRect(),b=s.getBoundingClientRect();s.scrollLeft+=r.x+r.width/2-b.right+16})()`);
    const edgePoint = await exec(`(()=>{const r=document.querySelector('[data-annealing-length-handle]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const edgeReference = await referenceSnapshot();
    pointer('mouseMove', edgePoint); pointer('mouseDown', edgePoint);
    pointer('mouseMove', {x:edgePoint.x+5,y:edgePoint.y});
    await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.deepEqual(await referenceSnapshot(), edgeReference);
    pointer('mouseUp', {x:edgePoint.x+5,y:edgePoint.y});
    await click('[data-cloning-design-action="save-primers"]');
    assert.equal(await exec('savedPrimers[1].sequence'), applied);
    if (await exec('state.cloningDesign.displayPlan.feasible')) {
      await click('[data-cloning-design-action="order-primers"]');
      assert.equal(await exec('orderedPrimers[1].sequence'), applied);
    }
    await screenshot('direct-drag.png');
    await exec('controller.confirmDesign()');
    assert.ok(await exec(`writes.some(write=>write.gbkText.includes(${JSON.stringify(applied)}))`));
    for (const [width, night, name] of [[1280, true, 'night.png'], [720, false, 'narrow.png']]) {
      win.setSize(width, 940);
      await exec(`document.body.classList.toggle('theme-night',${night})`);
      await exec(`document.querySelector('[data-primer-annealing-host]').scrollIntoView({block:'start'})`);
      await screenshot(name);
      const dimensions = await exec(`(()=>{const host=document.querySelector('.primer-annealing'),r=host.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,overflow:host.scrollWidth>host.clientWidth}})()`);
      assert.equal(dimensions.overflow, false, JSON.stringify(dimensions));
      assert.ok(dimensions.right <= dimensions.viewport + 1, JSON.stringify(dimensions));
    }
    assert.deepEqual(errors, []);
    console.log('Cloning primer annealing Electron QA passed: navigation, distinct Tms, live resizing, apply/save/order/confirm/notebook synchronization, and day/night/narrow layouts.');
  } finally { win.destroy(); fs.rmSync(temp, { recursive: true, force: true }); app.quit(); }
}
main().catch(error => { console.error(error); process.exit(1); });
