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
      const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
      window.viewer=initSequenceViewer({document, state:{settings:{},projects:[]},
        onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
      window.loadCds=(unknown=false)=>viewer.loadFromExternal({name:'CDS protein properties',topology:'circular',
        sequence:'C'.repeat(30)+(unknown?'ATGNNNTAA':'ATGAAATAA')+'C'.repeat(90),
        features:[{id:'qa-cds',name:'Example CDS',type:'cds',strand:1,segments:[{start:30,end:39}]}]});
      loadCds();window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1280, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level >= 3) errors.push(event.message); });
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  for (let i = 0; i < 100 && !await exec('Boolean(window.qaReady)'); i++) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  win.show();
  win.focus();
  await new Promise(resolve => setTimeout(resolve, 300));

  const featureSelector = '#sequence-viewer-sequence-host [data-feature-index="0"]';
  const tooltipSelector = '[data-sequence-hover-tooltip="feature"]';
  const readout = (selector) => exec(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {hidden:e.hidden,text:e.textContent,width:r.width,height:r.height,left:r.left,right:r.right,bottom:r.bottom,overflow:e.scrollWidth>e.clientWidth,viewportWidth:innerWidth,viewportHeight:innerHeight,pointerEvents:getComputedStyle(e).pointerEvents}})()`);
  const hoverFeature = async () => {
    await exec(`(()=>{const e=document.querySelector(${JSON.stringify(featureSelector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();for(const type of ['mouseover','mousemove'])e.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`);
  };
  const assertReadout = (value) => {
    assert.equal(value.hidden, false);
    assert.match(value.text, /2 aa/);
    assert.match(value.text, /Monoisotopic MW 277\.15 Da/);
    assert.match(value.text, /pI \d+\.\d{2}/);
    assert.ok(value.width > 100 && value.height > 20);
    assert.equal(value.overflow, false);
    assert.ok(value.left >= 0 && value.right <= value.viewportWidth && value.bottom <= value.viewportHeight);
    assert.equal(value.pointerEvents, 'none');
  };
  await hoverFeature();
  assertReadout(await readout(tooltipSelector));
  await fs.promises.writeFile(path.join(output, 'sequence-hover.png'), (await win.webContents.capturePage()).toPNG());
  await exec(`document.getElementById('sequence-viewer-sequence-host').dispatchEvent(new MouseEvent('mouseleave'))`);
  await exec(`document.querySelector(${JSON.stringify(featureSelector)}).focus()`);
  assert.equal(await exec(`document.activeElement.matches(${JSON.stringify(featureSelector)})`), true);
  assertReadout(await readout(tooltipSelector));
  await exec(`document.querySelector(${JSON.stringify(featureSelector)}).blur()`);
  assert.equal((await readout(tooltipSelector)).hidden, true);

  await exec(`document.getElementById('sequence-viewer-vector-builder-btn').click()`);
  await exec(`document.querySelector('#sequence-viewer-vector-builder-map [data-feature-index="0"]').focus()`);
  const mapReadout = await readout('[data-sequence-hover-tooltip="map"]');
  assertReadout(mapReadout);
  await fs.promises.writeFile(path.join(output, 'map-focus.png'), (await win.webContents.capturePage()).toPNG());

  await exec('loadCds(true)');
  await exec(`document.querySelector(${JSON.stringify(featureSelector)}).focus()`);
  const unknown = await readout(tooltipSelector);
  assert.equal(unknown.hidden, false);
  assert.match(unknown.text, /MW n\/a/);
  assert.match(unknown.text, /pI n\/a/);
  assert.doesNotMatch(unknown.text, /0\.00 Da|pI 0\.00/);
  assert.equal(unknown.overflow, false);
  await fs.promises.writeFile(path.join(output, 'unknown-residues.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log(`CDS Electron QA passed: sequence hover/focus, map focus, unknown residues, visible geometry. Screenshots: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
