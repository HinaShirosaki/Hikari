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
      import {reconstructPcrProduct} from '${url('src/renderer/modules/sequence-viewer/mcp/primer-products.js')}';
      const dna=(length,seed)=>{let s=seed>>>0;return Array.from({length},()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return 'ACGT'[s%4]}).join('')};
      const original=dna(900,511), insert=dna(20,861);
      const product=original.slice(0,300)+insert+original.slice(300);
      window.source={parentEntryId:'parent',recordName:'Test vector',originalSequence:original,editedSequence:product,
        originalRange:{start:300,end:300},editedRange:{start:300,end:320},editRequest:{type:'insertion',start:301,end:300,editedSequence:insert}};
      window.state={records:[{name:'Final construct',sequence:product,topology:'circular',features:[]}],selectedRecordIndex:0,cloningDesign:{}};
      window.appState={};window.savedPrimers=[];window.orderedPrimers=[];window.writes=[];window.statuses=[];
      const rc=text=>[...text].reverse().map(base=>({A:'T',T:'A',G:'C',C:'G'})[base]).join('');
      window.expectedResize=(sequence,side,bases)=>{
        let start=product.indexOf(sequence);
        if(start>=0)return side==='5'?product.slice(start+bases,start+sequence.length):product.slice(start,start+sequence.length+bases);
        start=product.indexOf(rc(sequence));
        if(start<0)throw new Error('Primer not found in final product');
        return side==='5'?rc(product.slice(start,start+sequence.length-bases)):rc(product.slice(start-bases,start+sequence.length));
      };
      const template={name:'Test vector',sequence:original,topology:'circular',features:[]};
      window.fullQ5Coverage=()=>{const p=reconstructPcrProduct(...state.cloningDesign.displayPlan.primers,template);return p.length===product.length&&(p+p).includes(product)};
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
  const direction = () => exec('Number(document.querySelector(".primer-annealing-duplex").dataset.annealingDirection)');
  const assertOrientation = async () => {
    const geometry = await exec(`(()=>{
      const svg=document.querySelector('.primer-annealing-duplex'),bases=[...svg.querySelectorAll('.primer-annealing-oligo-base')];
      const selected=Number(document.querySelector('select[data-annealing-primer]').value),primer=state.cloningDesign.displayPlan.primers[selected];
      const reverse=primer.role.includes('reverse');
      const reference=[...svg.querySelectorAll('.primer-annealing-base')];
      const adjacent=[...svg.querySelectorAll('[data-reference-strand="'+(reverse?'1':'-1')+'"]')];
      const complement=base=>({A:'T',T:'A',G:'C',C:'G'})[base];
      const markers=[...svg.querySelectorAll('[data-annealing-reference] .primer-annealing-coordinate')];
      const marker=markers[0],origin=Number(marker.textContent)-1,originX=Number(marker.getAttribute('x'));
      const dna=document.querySelector('[data-annealing-mode="product"]').getAttribute('aria-pressed')==='true'?state.records[0].sequence:source.originalSequence;
      const plus=[...svg.querySelectorAll('[data-reference-strand="1"]')];
      return {reverse,direction:Number(svg.dataset.annealingDirection),sequence:primer.sequence,shown:bases.map(base=>base.textContent).join(''),
        indices:bases.map(base=>Number(base.dataset.primerIndex)),ys:bases.map(base=>Number(base.getAttribute('y'))),
        referenceYs:reference.map(base=>Number(base.getAttribute('y'))),
        paired:bases.filter(base=>base.dataset.pairState==='paired').every(base=>{
          const template=adjacent.find(item=>item.getAttribute('x')===base.getAttribute('x'));
          return template&&complement(base.textContent)===template.textContent;
        }),
        genomicOrder:plus.every(base=>{
          const index=((origin+(Number(base.getAttribute('x'))-originX)/15)%dna.length+dna.length)%dna.length;
          return base.textContent===dna[index];
        }),
        fiveX:Number(svg.querySelector('[data-annealing-length-handle="5"] .primer-annealing-handle-grip').getAttribute('x')),
        threeX:Number(svg.querySelector('[data-annealing-length-handle="3"] .primer-annealing-handle-grip').getAttribute('x')),
        fiveLabelX:Number(svg.querySelector('[data-primer-end="5"]').getAttribute('x')),
        threeLabelX:Number(svg.querySelector('[data-primer-end="3"]').getAttribute('x')),
        arrow:svg.querySelector('[data-primer-end="3"]').textContent};
    })()`);
    assert.equal(geometry.direction, geometry.reverse ? -1 : 1);
    assert.equal(geometry.shown, geometry.reverse ? [...geometry.sequence].reverse().join('') : geometry.sequence);
    assert.deepEqual(geometry.indices, Array.from({length:geometry.sequence.length},(_,i)=>geometry.reverse?geometry.sequence.length-1-i:i));
    assert.equal(geometry.paired, true, 'primer bases complement the adjacent reference strand');
    assert.equal(geometry.genomicOrder, true, 'reference DNA remains in genomic left-to-right order for both primer directions');
    if (geometry.reverse) {
      assert.ok(Math.min(...geometry.ys)>Math.max(...geometry.referenceYs));
      assert.ok(geometry.fiveX>geometry.threeX && geometry.fiveLabelX>geometry.threeLabelX);
      assert.ok(geometry.arrow.includes('←'));
    } else {
      assert.ok(Math.max(...geometry.ys)<Math.min(...geometry.referenceYs));
      assert.ok(geometry.fiveX<geometry.threeX && geometry.fiveLabelX<geometry.threeLabelX);
      assert.ok(geometry.arrow.includes('→'));
    }
  };
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
  const handlePoint = async (side = '3') => {
    await exec(`document.querySelector('[data-annealing-length-handle="${side}"]').scrollIntoView({block:'center',inline:'center'})`);
    return exec(`(()=>{const r=document.querySelector('[data-annealing-length-handle="${side}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
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
    assert.equal(await exec('document.querySelectorAll("[data-annealing-length-handle]").length'), 2);
    await assertOrientation();
    await screenshot('template.png');
    await click('[data-annealing-mode="product"]');
    await assertOrientation();
    assert.equal(await exec('document.querySelector(".primer-annealing-dna-label").textContent.includes("Final plasmid")'), true);
    await screenshot('product.png');
    await click('[data-annealing-action="next"]');
    assert.equal(await exec('document.querySelector("[data-annealing-primer]").value'), '1');
    await click('[data-annealing-action="next"]');
    assert.equal(await exec('document.querySelector("[data-annealing-primer]").value'), '0');
    await click('[data-annealing-action="previous"]');
    const original = await exec('state.cloningDesign.displayPlan.primers[1].sequence');
    await assertOrientation();
    const extendPixels = 30 * await direction();
    const point = await handlePoint();
    const fixedReference = await referenceSnapshot();
    await rememberReference();
    pointer('mouseMove', point); pointer('mouseDown', point);
    pointer('mouseMove', { x: point.x + extendPixels, y: point.y });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence'), original);
    assert.equal(await metric('length'), `${original.length + 2} nt`);
    await assertMountedReference(fixedReference);
    await screenshot('length-preview.png');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    pointer('mouseUp', { x: point.x + extendPixels, y: point.y });
    assert.equal(await metric('length'), `${original.length} nt`);
    await assertMountedReference(fixedReference);
    const nextPoint = await handlePoint();
    pointer('mouseMove', nextPoint); pointer('mouseDown', nextPoint);
    pointer('mouseMove', { x: nextPoint.x + extendPixels / 2, y: nextPoint.y });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    pointer('mouseMove', { x: nextPoint.x + extendPixels, y: nextPoint.y });
    pointer('mouseUp', { x: nextPoint.x + extendPixels, y: nextPoint.y });
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
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence.length'), applied.length + 1, 'Left extends a reverse primer at its 3′ end');
    await exec(`document.querySelector('[data-annealing-length-handle]').focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence'), applied);
    assert.deepEqual(await referenceSnapshot(), fixedReference, 'keyboard resizing also keeps the reference fixed');
    // Cancelling a linked 5′ drag must abandon the partner preview as well.
    const beforeCancel = await exec('JSON.stringify(state.cloningDesign.displayPlan.primers)');
    const cancelPoint = await handlePoint('5'), cancelDelta = -30 * await direction();
    pointer('mouseMove', cancelPoint); pointer('mouseDown', cancelPoint);
    pointer('mouseMove', {x:cancelPoint.x+cancelDelta,y:cancelPoint.y});
    await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    pointer('mouseUp', {x:cancelPoint.x+cancelDelta,y:cancelPoint.y});
    await click('[data-annealing-action="next"]'); await assertOrientation();
    await click('[data-annealing-action="previous"]'); await assertOrientation();
    assert.equal(await exec('JSON.stringify(state.cloningDesign.displayPlan.primers)'), beforeCancel);
    // Exercise extension and shortening on forward/reverse primers in both DNA views.
    for (const primerIndex of [0, 1]) {
      await exec(`(()=>{const select=document.querySelector('[data-annealing-primer]');select.value='${primerIndex}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      for (const mode of ['template', 'product']) {
        await click(`[data-annealing-mode="${mode}"]`);
        await assertOrientation();
        const displayDirection = await direction();
        const originalLength = await exec(`state.cloningDesign.displayPlan.primers[${primerIndex}].length`);
        for (const side of ['3', '5']) {
          for (const baseDelta of side === '5' ? [-2, 2] : [2, -2]) {
            const delta = baseDelta * 15 * displayDirection;
            const before = await exec(`state.cloningDesign.displayPlan.primers[${primerIndex}].sequence`);
            const beforePair = await exec('state.cloningDesign.displayPlan.primers.map(primer=>primer.sequence)');
            const expected = await exec(`expectedResize(${JSON.stringify(before)},'${side}',${baseDelta})`);
            const position = await handlePoint(side), snapshot = await referenceSnapshot();
            await rememberReference();
            pointer('mouseMove', position); pointer('mouseDown', position);
            pointer('mouseMove', {x:position.x+delta,y:position.y});
            await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
            await assertMountedReference(snapshot);
            assert.deepEqual(await exec('state.cloningDesign.displayPlan.primers.map(primer=>primer.sequence)'), beforePair, 'linked previews do not partially save the pair');
            pointer('mouseUp', {x:position.x+delta,y:position.y});
            await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
            assert.deepEqual(await referenceSnapshot(), snapshot);
            assert.equal(await exec(`state.cloningDesign.displayPlan.primers[${primerIndex}].sequence`), expected, `${side}′ editing in ${mode} uses product bases`);
            const partner = 1 - primerIndex;
            const afterPair = await exec('state.cloningDesign.displayPlan.primers.map(primer=>primer.sequence)');
            assert.equal(afterPair[partner].length, beforePair[partner].length + (side === '5' ? baseDelta : 0), 'the paired 5′ overhang compensates exactly; 3′ edits stay independent');
            if (side === '5') {
              assert.equal(await exec('fullQ5Coverage()'), true, 'the actual PCR and KLD retain the complete insertion once');
              assert.equal(await exec(`document.querySelector('.sequence-viewer-cloning-design-primer-table').textContent.includes(${JSON.stringify(afterPair[partner])})`), true);
              assert.equal(await exec(`JSON.stringify(appState.notebookEntries).includes(${JSON.stringify(afterPair[partner])})`), true);
            }
            await assertOrientation();
          }
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
    await click('[data-annealing-mode="product"]');
    await assertOrientation();
    await screenshot('direct-drag.png');
    await exec('controller.confirmDesign()');
    assert.ok(await exec(`writes.some(write=>write.gbkText.includes(${JSON.stringify(applied)}))`));
    const setFloor = value => exec(`(()=>{const input=document.querySelector('[data-annealing-tm-floor]');input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert.equal(await exec('document.querySelector("[data-annealing-tm-floor]").value'), '54');
    await click('[data-annealing-mode="product"]');
    const floorReference = await referenceSnapshot();
    await rememberReference();
    const templateTm = parseFloat(await metric('template-tm')), productTm = parseFloat(await metric('product-tm'));
    const customFloor = Math.ceil(templateTm * 2) / 2 + 0.5;
    assert.ok(productTm > customFloor, 'fixture product binding is stronger than its template binding');
    await setFloor(customFloor);
    assert.equal(await exec('document.querySelector("g[data-annealing-primer]").classList.contains("is-low-template-binding")'), true, 'template floor controls red color even when product binding passes');
    await assertMountedReference(floorReference);
    assert.equal(await exec('state.cloningDesign.primerTmFloor'), customFloor);
    await click('[data-annealing-action="next"]');
    await click('[data-annealing-mode="template"]');
    assert.equal(await exec('document.querySelector("[data-annealing-tm-floor]").value'), String(customFloor));
    await click('[data-annealing-action="previous"]');
    await setFloor(0);
    assert.equal(await exec('document.querySelector("g[data-annealing-primer]").classList.contains("is-low-template-binding")'), false);
    await setFloor(100);
    assert.equal(await exec('document.querySelector("g[data-annealing-primer]").classList.contains("is-low-template-binding")'), true);
    await setFloor(54);
    await setFloor('');
    assert.equal(await exec('document.querySelector("[data-annealing-tm-floor]").value'), '54', 'empty edits retain the last valid floor');
    // Either endpoint can be shortened into the red state and extended back,
    // without a product-view match hiding weak binding to the template.
    for (const mode of ['template', 'product']) {
      await click(`[data-annealing-mode="${mode}"]`);
      for (const side of ['3', '5']) {
        const before = await exec('state.cloningDesign.displayPlan.primers[1].sequence');
        await handlePoint(side);
        const snapshot = await referenceSnapshot();
        await exec(`document.querySelector('[data-annealing-length-handle="${side}"]').focus({preventScroll:true})`);
        const displayDirection = await direction();
        const shrinkKey = side === '5' ? (displayDirection === 1 ? 'End' : 'Home') : (displayDirection === 1 ? 'Home' : 'End');
        win.webContents.sendInputEvent({type:'keyDown',keyCode:shrinkKey});
        await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
        assert.equal(await metric('length'), '8 nt');
        assert.equal(await exec('document.querySelector("g[data-annealing-primer]").classList.contains("is-low-template-binding")'), true);
        assert.equal(await exec(`(()=>{const base=document.querySelector('.primer-annealing-oligo-base'),probe=document.createElement('span');probe.style.color='var(--theme-danger)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(base).fill===expected})()`), true);
        await screenshot(`weak-${mode}-${side}.png`);
        win.webContents.sendInputEvent({type:'keyUp',keyCode:shrinkKey});
        await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
        assert.deepEqual(await referenceSnapshot(), snapshot);
        const point = await handlePoint(side);
        const delta = (before.length - 8) * 15 * (side === '5' ? -1 : 1) * displayDirection;
        pointer('mouseMove',point);pointer('mouseDown',point);pointer('mouseMove',{x:point.x+delta,y:point.y});pointer('mouseUp',{x:point.x+delta,y:point.y});
        await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
        assert.equal(await exec('state.cloningDesign.displayPlan.primers[1].sequence'), before);
        assert.equal(await exec('fullQ5Coverage()'), true);
        assert.equal(await exec('document.querySelector("g[data-annealing-primer]").classList.contains("is-low-template-binding")'), false);
        await assertOrientation();
      }
    }
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
