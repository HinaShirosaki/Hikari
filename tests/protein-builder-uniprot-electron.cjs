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
      encoding: 'utf8', timeout: 90000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || `UniProt QA failed (${result.signal || result.status})`));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { createBioinformaticsService } = require('../src/main/bioinformatics');
  const { registerBioinformaticsIpc } = require('../src/main/ipc/register-bioinformatics-ipc');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-uniprot-'));
  const output = path.join(root, 'artifacts/protein-builder-uniprot');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const raw = process.env.HIKARI_UNIPROT_RECORD
    ? JSON.parse(fs.readFileSync(process.env.HIKARI_UNIPROT_RECORD, 'utf8'))
    : {
        primaryAccession: 'Q9NZQ7', uniProtkbId: 'PD1L1_HUMAN', entryType: 'UniProtKB reviewed (Swiss-Prot)',
        proteinDescription: { recommendedName: { fullName: { value: 'Example domain protein' } } },
        genes: [{ geneName: { value: 'CD274' } }], organism: { scientificName: 'Homo sapiens', taxonId: 9606 },
        sequence: { value: 'M'.repeat(18) + 'ACDEFGHIKLMNPQRSTVWY'.repeat(14), length: 298 },
        features: [{ type: 'Domain', description: 'Ig-like V-type', location: { start: { value: 19, modifier: 'EXACT' }, end: { value: 127, modifier: 'EXACT' } } }]
      };
  const service = createBioinformaticsService(process.env.HIKARI_UNIPROT_LIVE === '1' ? {} : {
    fetch: async (url) => ({
      ok: true, status: 200, headers: { get: (key) => key === 'x-total-results' ? '2' : '' },
      text: async () => JSON.stringify(url.includes('/search?') ? { results: [
        { ...raw, primaryAccession: 'Q9TEST', uniProtkbId: 'TEST_HUMAN' }, raw
      ] } : raw)
    })
  });
  registerBioinformaticsIpc({ ipcMain, bioinformaticsService: service });
  const preload = path.join(temp, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
    const {createBioinformaticsApi}=require(${JSON.stringify(path.join(root, 'src/main/preload/api/bioinformatics-api.js'))});
    contextBridge.exposeInMainWorld('uniprotQaApi',createBioinformaticsApi(ipcRenderer));`);
  const url = (file) => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(temp, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}.view{height:100vh}</style></head><body>
    ${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8')}
    <script type="module">
      import {createSequenceViewerProteinBuilderController} from '${url('src/renderer/modules/sequence-viewer/protein-builder.js')}';
      import {getSequenceViewerElements} from '${url('src/renderer/modules/sequence-viewer/dom.js')}';
      window.el=id=>document.getElementById('sequence-viewer-protein-builder-'+id);
      document.querySelector('.view').classList.add('is-active');
      window.builder=createSequenceViewerProteinBuilderController({elements:getSequenceViewerElements(document),getBridge:()=>window.uniprotQaApi});
      builder.bindEvents();
      el('workspace').hidden=false;
      document.getElementById('sequence-viewer-home-workspace').hidden=true;
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.until=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>40000)throw new Error('Timed out: '+el('uniprot-status').textContent);await new Promise(r=>setTimeout(r,30));}};
      window.startSearch=async()=>{
        el('add-protein-btn').click();
        el('add-protein-source-uniprot').click();
        el('uniprot-query').value='gene:CD274 AND organism_id:9606 AND reviewed:true';
        el('uniprot-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        await until(()=>el('uniprot-results').children.length>0);
        window.searchResultCount=el('uniprot-results').children.length;
        [...el('uniprot-results').children].find(button=>button.textContent.includes('Q9NZQ7')).click();
        await until(()=>!el('uniprot-detail').hidden);
        await frames();
      };
      window.qaReady=true;
    </script></body></html>`);
  const win = new BrowserWindow({ width: 1200, height: 940, show: false,
    webPreferences: { preload, sandbox: false, contextIsolation: true } });
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level >= 3) errors.push(event.message); });
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadFile(fixture);
  assert.equal(await exec('Boolean(window.qaReady)'), true, errors.join('\n'));
  await exec("el('add-protein-btn').click();el('add-protein-name').value='Draft protein';el('add-protein-sequence').value='MAKT';el('add-protein-source-manual').focus()");
  assert.equal(await exec("el('add-protein-source-manual').checked"), true);
  assert.equal(await exec("el('add-protein-source').tagName"), 'FIELDSET');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await exec('frames()');
  assert.equal(await exec("el('add-protein-source-uniprot').checked"), true);
  assert.equal(await exec("el('uniprot-panel').hidden"), false);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  await exec('frames()');
  assert.equal(await exec("el('add-protein-source-manual').checked"), true);
  assert.equal(await exec("el('uniprot-panel').hidden"), true);
  assert.equal(await exec("el('add-protein-sequence').value"), 'MAKT');
  await exec("el('add-protein-cancel-btn').click()");
  await exec('startSearch()');
  const fullSequence = await exec("el('add-protein-sequence').value");
  assert.equal(await exec("el('add-protein-overlay').hidden"), false, 'Enter in the query must search without adding a block');
  assert.equal(await exec("el('add-protein-confirm-btn').disabled"), false);
  assert.equal(await exec("el('uniprot-results').children.length"), 1);
  assert.match(await exec("el('uniprot-results').textContent"), /Q9NZQ7/);
  const domainSequence = fullSequence.slice(18, 127);
  await exec(`(()=>{
    const select=el('uniprot-region');select.value=[...select.options].find(o=>o.textContent.includes('Ig-like V-type')).value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })();frames()`);
  assert.equal(await exec("el('add-protein-sequence').value"), domainSequence);
  assert.equal(domainSequence.length, 109);
  if (await exec('searchResultCount>1')) {
    assert.equal(await exec("el('uniprot-results-toggle-btn').getAttribute('aria-expanded')"), 'false');
    await exec("el('uniprot-results-toggle-btn').click();frames()");
    assert.equal(await exec("el('uniprot-results').children.length"), await exec('searchResultCount'));
    assert.equal(await exec("el('add-protein-sequence').value"), domainSequence);
    assert.equal(await exec("el('uniprot-results-toggle-btn').getAttribute('aria-expanded')"), 'true');
    await exec("el('uniprot-results-toggle-btn').click();frames()");
    assert.equal(await exec("el('uniprot-results').children.length"), 1);
    assert.equal(await exec("el('add-protein-sequence').value"), domainSequence);
  }
  assert.equal(await exec("el('uniprot-start')"), null);
  assert.equal(await exec("el('uniprot-end')"), null);
  assert.equal(await exec("el('uniprot-annotation-note')"), null);
  assert.equal(await exec("Boolean(el('uniprot-region').querySelector('[value=custom]'))"), false);
  let cases = 0;
  for (const width of [560, 900, 1200]) {
    win.setSize(width, 940);
    for (const zoom of [0.8, 1, 1.25]) {
      win.webContents.setZoomFactor(zoom);
      await exec('frames()');
      const bounds = await exec(`(()=>{const d=el('add-protein-form'),r=d.getBoundingClientRect();return {
        left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,
        scrollWidth:d.scrollWidth,clientWidth:d.clientWidth};})()`);
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.w + 1 && bounds.top >= 0 && bounds.bottom <= bounds.h + 1, JSON.stringify(bounds));
      assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, 'Dialog must not overflow horizontally');
      if (width === 1200 && zoom === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        fs.writeFileSync(path.join(output, 'uniprot-domain.png'), (await win.webContents.capturePage()).toPNG());
        await exec("el('add-protein-sequence').scrollIntoView({block:'center'});frames()");
        fs.writeFileSync(path.join(output, 'uniprot-sequence.png'), (await win.webContents.capturePage()).toPNG());
      }
      cases++;
    }
  }
  win.setSize(1200, 940);
  win.webContents.setZoomFactor(1);
  await exec("el('add-protein-form').requestSubmit();frames()");
  assert.equal(await exec("el('add-protein-overlay').hidden"), true);
  assert.ok((await exec("el('sequence').value")).includes(domainSequence));
  assert.match(await exec("el('workflow').innerHTML"), /UniProt Q9NZQ7/);
  await exec("el('build-dna-btn').click();frames()");
  assert.match(await exec("el('dna-sequence').textContent"), /[ACGT]{100}/);
  // Manual DNA input remains available after importing a UniProt domain.
  await exec("el('add-protein-btn').click();el('add-protein-type').value='dna';el('add-protein-name').value='Manual DNA';el('add-protein-sequence').value='ATGGCT';el('add-protein-sequence').dispatchEvent(new Event('input',{bubbles:true}));el('add-protein-form').requestSubmit();frames()");
  assert.equal(await exec("el('add-protein-overlay').hidden"), true);
  assert.deepEqual(errors, []);
  service.stop();
  console.log(`Protein Builder UniProt Electron QA passed: ${cases} size/zoom cases, folding results without losing the selected domain, source switch with keyboard arrows and retained drafts, query Enter, annotation-only selection, 109-aa domain, provenance, DNA build, and manual input. Mode: ${process.env.HIKARI_UNIPROT_LIVE === '1' ? 'live UniProt' : 'fixture through real IPC'}. Screenshot: ${output}`);
  win.destroy();
  await fs.promises.rm(temp, { recursive: true, force: true });
  app.quit();
}

main().catch((error) => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
