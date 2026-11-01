'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || `Electron CDS readout QA failed (${result.signal || result.status})`));
    return;
  }

  const { app, BrowserWindow } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-cds-properties-'));
  const output = path.join(root, 'artifacts/sequence-cds-properties');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = (file) => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body>
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8')}
    <script type="module">
      import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
      import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
      const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.viewer=initSequenceViewer({document, state:{settings:{},projects:[]},
        onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
        if(window.clipboardFailure)throw new Error('Clipboard denied');window.copied=value;
      }}});
      window.loadCds=(unknown=false,translation='')=>{
        const record={name:'CDS protein properties',topology:'circular',
          sequence:'C'.repeat(30)+(unknown?'ATGNNNTAA':'ATGAAATAA')+'C'.repeat(90),
          features:[{id:'qa-cds',name:'Example CDS',type:'cds',strand:1,translation,segments:[{start:30,end:39}]}]};
        viewer.loadFromExternal(record);
        if(translation){
          document.getElementById('sequence-viewer-textarea').value=buildRecordGenbankText(record);
          document.getElementById('sequence-viewer-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        }
      };
      loadCds();window.qaReady=true;
    </script></body></html>`);
  // Render without native pointer/focus events interfering with synthetic hover checks.
  const win = new BrowserWindow({ width: 1280, height: 850, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level >= 3) errors.push(event.message); });
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  for (let i = 0; i < 100 && !await exec('Boolean(window.qaReady)'); i++) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  await new Promise(resolve => setTimeout(resolve, 300));

  const featureSelector = '#sequence-viewer-sequence-host [data-feature-index="0"]';
  const tooltipSelector = '[data-sequence-hover-tooltip="feature"]';
  const readout = (selector) => exec(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {hidden:e.hidden,text:e.textContent,width:r.width,height:r.height,left:r.left,right:r.right,bottom:r.bottom,overflow:e.scrollWidth>e.clientWidth,viewportWidth:innerWidth,viewportHeight:innerHeight,pointerEvents:getComputedStyle(e).pointerEvents}})()`);
  const hoverFeature = async () => {
    await exec(`(()=>{const e=document.querySelector(${JSON.stringify(featureSelector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();for(const type of ['mouseover','mousemove'])e.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`);
  };
  const focus = selector => exec(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))})()`);
  const assertReadout = (value) => {
    assert.equal(value.hidden, false);
    assert.match(value.text, /2 aa/);
    assert.match(value.text, /Monoisotopic MW 277\.15 Da/);
    assert.match(value.text, /pI \d+\.\d{2}/);
    assert.ok(value.width > 100 && value.height > 20);
    assert.equal(value.overflow, false);
    assert.ok(value.left >= 0 && value.right <= value.viewportWidth && value.bottom <= value.viewportHeight);
    assert.equal(value.pointerEvents, 'auto');
  };
  const clickCopy = async (surface, kind, expected) => {
    await exec(`document.querySelector(${JSON.stringify(`${surface} [data-sequence-protein-copy-kind="${kind}"]`)}).click()`);
    const actual = await exec('window.copied');
    assert.equal(actual?.length, expected.length, `${surface}: ${kind} length`);
    assert.ok(actual === expected, `${surface}: ${kind} value`);
  };
  const assertCopies = async surface => {
    await clickCopy(surface, 'sequence', 'MK');
    await clickCopy(surface, 'mw', '277.15');
    const pi = await exec(`document.querySelector(${JSON.stringify(`${surface} [data-sequence-protein-copy-kind="pi"]`)}).dataset.sequenceProteinCopy`);
    assert.match(pi, /^\d+\.\d{2}$/);
    await clickCopy(surface, 'pi', pi);
  };
  await hoverFeature();
  assertReadout(await readout(tooltipSelector));
  await assertCopies(tooltipSelector);
  await fs.promises.writeFile(path.join(output, 'sequence-hover.png'), (await win.webContents.capturePage()).toPNG());
  await exec(`document.getElementById('sequence-viewer-sequence-host').dispatchEvent(new MouseEvent('mouseleave'))`);
  await exec(`document.querySelector(${JSON.stringify(tooltipSelector)}).dispatchEvent(new MouseEvent('mouseenter'))`);
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal((await readout(tooltipSelector)).hidden, false, 'Pointer can reach and stay on the copy card');
  await exec(`document.querySelector(${JSON.stringify(tooltipSelector)}).dispatchEvent(new MouseEvent('mouseleave'))`);
  assert.equal((await readout(tooltipSelector)).hidden, true);
  await focus(featureSelector);
  assert.equal(await exec(`document.activeElement.matches(${JSON.stringify(featureSelector)})`), true);
  assertReadout(await readout(tooltipSelector));
  await focus(`${tooltipSelector} [data-sequence-protein-copy-kind="sequence"]`);
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal((await readout(tooltipSelector)).hidden, false, 'Keyboard focus can move into the copy card');
  await clickCopy(tooltipSelector, 'sequence', 'MK');
  await exec(`document.activeElement.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));document.activeElement.blur()`);
  await exec(`document.querySelector(${JSON.stringify(featureSelector)}).blur()`);
  assert.equal((await readout(tooltipSelector)).hidden, true);

  await exec(`document.querySelector(${JSON.stringify(featureSelector)}).click()`);
  const detail = '#sequence-viewer-feature-detail';
  await exec(`document.querySelector(${JSON.stringify(`${detail} [data-sequence-protein-copy-kind="sequence"]`)}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  await assertCopies(detail);

  await exec(`document.getElementById('sequence-viewer-vector-builder-btn').click()`);
  await focus('#sequence-viewer-vector-builder-map [data-feature-index="0"]');
  const mapReadout = await readout('[data-sequence-hover-tooltip="map"]');
  assertReadout(mapReadout);
  await assertCopies('[data-sequence-hover-tooltip="map"]');
  await fs.promises.writeFile(path.join(output, 'map-focus.png'), (await win.webContents.capturePage()).toPNG());

  await exec('loadCds(true)');
  await focus(featureSelector);
  const unknown = await readout(tooltipSelector);
  assert.equal(unknown.hidden, false);
  assert.match(unknown.text, /MW n\/a/);
  assert.match(unknown.text, /pI n\/a/);
  assert.doesNotMatch(unknown.text, /0\.00 Da|pI 0\.00/);
  assert.equal(unknown.overflow, false);
  await clickCopy(tooltipSelector, 'sequence', 'MX');
  assert.equal(await exec(`document.querySelectorAll(${JSON.stringify(`${tooltipSelector} [data-sequence-protein-copy-kind="mw"], ${tooltipSelector} [data-sequence-protein-copy-kind="pi"]`)}).length`), 0);
  await fs.promises.writeFile(path.join(output, 'unknown-residues.png'), (await win.webContents.capturePage()).toPNG());

  // A very long qualifier must remain fully copyable while its visible sequence scrolls.
  await exec(`loadCds(false,'MK'.repeat(8000))`);
  await hoverFeature();
  await clickCopy(tooltipSelector, 'sequence', 'MK'.repeat(8000));
  const sequenceGeometry = await exec(`(()=>{const e=document.querySelector(${JSON.stringify(`${tooltipSelector} .sequence-viewer-protein-sequence`)});return {height:e.clientHeight,scrollHeight:e.scrollHeight,overflow:e.scrollWidth>e.clientWidth}})()`);
  assert.ok(sequenceGeometry.scrollHeight > sequenceGeometry.height);
  assert.equal(sequenceGeometry.overflow, false);
  await fs.promises.writeFile(path.join(output, 'long-sequence.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(320, 640);
  await new Promise(resolve => setTimeout(resolve, 200));
  await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await exec(`(()=>{const e=document.querySelector(${JSON.stringify(featureSelector)});e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:innerWidth-10,clientY:innerHeight-10}))})()`);
  const narrow = await readout(tooltipSelector);
  assert.equal(narrow.hidden, false);
  assert.ok(narrow.width > 100 && narrow.height > 100);
  assert.equal(narrow.overflow, false);
  assert.ok(narrow.left >= 0 && narrow.right <= narrow.viewportWidth && narrow.bottom <= narrow.viewportHeight);
  await clickCopy(tooltipSelector, 'sequence', 'MK'.repeat(8000));
  await fs.promises.writeFile(path.join(output, 'narrow-sequence.png'), (await win.webContents.capturePage()).toPNG());

  await exec('window.clipboardFailure=true;window.copied="unchanged"');
  await exec(`document.querySelector(${JSON.stringify(`${tooltipSelector} [data-sequence-protein-copy-kind="sequence"]`)}).click()`);
  assert.equal(await exec('window.copied'), 'unchanged');
  assert.match(await exec('document.querySelector("[data-hikari-transient-toast]").textContent'), /Clipboard access is unavailable/);
  assert.deepEqual(errors, []);
  console.log(`CDS Electron QA passed: hover/focus and detail copy actions, map copy actions, unknown residues, clipboard failure, complete 16,000 aa copy, narrow layout. Screenshots: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
