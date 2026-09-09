'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
async function main() {
  if (!process.versions.electron) {
    const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-sequence-mcp-ui-'));
    const output = path.join(root, 'artifacts/sequence-mcp');
    fs.mkdirSync(output, { recursive: true });
    const { algorithms } = require('../src/renderer/modules/sequence-viewer/main-process/mcp/service');
    const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library');
    const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway');
    const gateway = createAgentMcpGateway({ storagePath });
    const call = async (name, args = {}) => { const result = await gateway.callGatewayTool(name, args); assert.equal(result.ok, true, JSON.stringify(result)); return result; };
    const model = await algorithms();
    let random = 137;
    const flank = Array.from({ length: 1000 }, () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return 'ACGT'[random >>> 30]; }).join('');
    const record = { name: 'MCP review plasmid', topology: 'circular', sequence: flank.slice(0, 350) + 'ATGGAACGTTTTAAATAA' + flank.slice(350), features: [{ name: 'Demo CDS', type: 'cds', strand: 1, segments: [{ start: 350, end: 368 }] }] };
    await library.upsertSequenceEntry({ storagePath, id: 'review_parent', name: record.name, status: 'saved', topology: record.topology, sequence: record.sequence, sequenceLength: record.sequence.length, featureCount: 1, features: record.features, gbkText: model.buildRecordGenbankText(record) });
    assert.equal((await call('sequence_search', { mode: 'name', query: 'review plasmid' })).total, 1);
    const parent = await call('sequence_get', { entry_id: 'review_parent' });
    const feature_ref = parent.features.items[0].feature_ref;
    const construct = await call('sequence_protein_build', { request_id: 'qa-build', parts: [{ kind: 'catalog', part_id: 'tag:his6' }, { kind: 'catalog', part_id: 'cleavage:tev' }, { kind: 'feature', source: { entry_id: parent.entry_id, expected_revision: parent.revision, feature_ref } }] });
    const derivative = await call('sequence_protein_edit', { entry_id: parent.entry_id, expected_revision: parent.revision, feature_ref, request_id: 'qa-edit', operations: [{ operation: 'substitute', position: 2, expected_amino_acid: 'E', amino_acid: 'G' }] });
    const primer = await call('sequence_mutagenesis_primers', { entry_id: derivative.entry_id, expected_revision: derivative.revision, methods: ['q5-kld', 'whole-plasmid'] });
    assert.equal(primer.status, 'design_ready');
    fs.writeFileSync(path.join(storagePath, 'qa.json'), JSON.stringify({ construct, derivative, primer }));
    for (const phase of ['open', 'restart']) {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, storagePath, output, phase], { encoding: 'utf8', timeout: 60000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.status, 0, String(result.error || `Electron ${phase} failed`));
    }
    await fs.promises.rm(storagePath, { recursive: true, force: true });
    console.log(`Sequence MCP Electron/restart QA passed: ${output}`);
  } else {
    const { app, BrowserWindow, ipcMain } = require('electron');
    const [storagePath, output, phase] = process.argv.slice(2);
    app.setPath('userData', path.join(storagePath, 'profile'));
    await app.whenReady();
    const library = require('../src/renderer/modules/sequence-viewer/main-process/sequence-library');
    require('../src/main/ipc/register-data-ipc/register-sequence-library-ipc').registerSequenceLibraryIpc({ ipcMain, ...library, cleanText: (v, n) => String(v || '').slice(0, n), normalizeJsonPayload: v => v || {} });
    const preload = path.join(storagePath, 'qa-preload.cjs');
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',require(${JSON.stringify(path.join(root, 'src/main/preload/api/sequence-library-api.js'))}).createSequenceLibraryApi(ipcRenderer));`);
    const url = file => pathToFileURL(path.join(root, file)).href;
    const html = path.join(storagePath, 'qa.html');
    fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><style>body{display:block;margin:0} .view{height:calc(100vh - 3rem)} #qa-actions{padding:.5rem;display:flex;gap:.5rem}</style></head><body><div id="qa-actions"></div>${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'))}${fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'))}<script type="module">
    import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
    const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
    window.viewer=initSequenceViewer({document,apiBridge:window.hikariApi,getStoragePath:()=>${JSON.stringify(storagePath)},state:{settings:{storagePath:${JSON.stringify(storagePath)}},projects:[]},homeViewId:'sequence-viewer-view',detailViewId:'sequence-viewer-detail-view',onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
    show('sequence-viewer-view');window.qaReady=true;
    </script></body></html>`);
    const win = new BrowserWindow({ width: 1360, height: 1000, show: false, webPreferences: { preload, sandbox: false, contextIsolation: true } });
    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(html);
    for (let i = 0; i < 100 && !await win.webContents.executeJavaScript('Boolean(window.qaReady)'); i++) await new Promise(r => setTimeout(r, 30));
    assert.equal(await win.webContents.executeJavaScript('Boolean(window.qaReady)'), true, errors.join('\n'));
    const data = JSON.parse(fs.readFileSync(path.join(storagePath, 'qa.json')));
    const exec = code => win.webContents.executeJavaScript(code, true);
    const actions = [...data.derivative.ui_actions, ...data.construct.ui_actions, ...data.primer.ui_actions];
    await exec(`(async()=>{const {renderSequenceActions}=await import(${JSON.stringify(url('src/renderer/modules/sequence-viewer/mcp/action-rendering.js'))});document.getElementById('qa-actions').innerHTML=renderSequenceActions({sequence_actions:${JSON.stringify(actions)}},s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'));})()`);
    await exec(`viewer.openAgentResult(${JSON.stringify({ action: 'open_plasmid', entry_id: data.derivative.entry_id })})`);
    assert.equal(await exec(`document.getElementById('sequence-viewer-detail-view').getBoundingClientRect().height > 100`), true);
    await fs.promises.writeFile(path.join(output, `${phase}-plasmid.png`), (await win.webContents.capturePage()).toPNG());
    // Exercise the actual delegated click handlers, not just the controller API.
    await exec(`document.querySelector('[data-sequence-mcp-action="open_protein_builder"]').click()`);
    for (let i = 0; i < 100 && await exec(`document.getElementById('sequence-viewer-protein-builder-sequence').value`) !== data.construct.protein; i++) await new Promise(r => setTimeout(r, 30));
    assert.equal(await exec(`document.getElementById('sequence-viewer-protein-builder-sequence').value`), data.construct.protein);
    assert.equal(await exec(`document.getElementById('sequence-viewer-protein-builder-dna-sequence').textContent`), data.construct.dna);
    assert.equal(await exec(`document.getElementById('sequence-viewer-protein-builder-protein-sequence-highlight').getBoundingClientRect().width > 100`), true);
    await fs.promises.writeFile(path.join(output, `${phase}-protein-builder.png`), (await win.webContents.capturePage()).toPNG());
    await exec(`document.querySelector('[data-sequence-mcp-action="open_primer_design"]').click()`);
    for (let i = 0; i < 100 && !await exec(`document.body.textContent.includes('Whole-plasmid PCR')`); i++) await new Promise(r => setTimeout(r, 30));
    assert.equal(await exec(`document.querySelector('[data-sequence-mcp-action="open_primer_design"]').textContent`), 'Open Primer Design');
    assert.equal(await exec(`document.getElementById('sequence-viewer-cloning-design-run-btn').disabled`), true);
    assert.equal(await exec(`document.getElementById('sequence-viewer-cloning-design-run-btn').getBoundingClientRect().width > 20`), true);
    assert.ok(await exec(`document.body.textContent.includes('q5') || document.body.textContent.includes('Q5')`));
    await fs.promises.writeFile(path.join(output, `${phase}-primers.png`), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log(`Electron ${phase}: plasmid, Protein Builder, and persisted primer comparison opened.`);
    win.destroy(); app.quit();
  }
}
main().catch(error => { console.error(error); if(process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
