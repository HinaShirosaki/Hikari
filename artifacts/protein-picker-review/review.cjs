const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '../..');
async function main() {
  if (!process.versions.electron) {
    const r = require('node:child_process').spawnSync(require('electron'), [__filename], {encoding:'utf8', timeout:60000});
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    assert.equal(r.status, 0, String(r.error || r.signal)); return;
  }
  const {app, BrowserWindow} = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'protein-picker-'));
  app.setPath('userData', path.join(temp, 'profile'));
  await app.whenReady();
  const url = f => pathToFileURL(path.join(root, f)).href;
  const fixture = path.join(temp, 'review.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><style>body{display:block;margin:0}.view{height:100vh}</style></head><body>
  ${fs.readFileSync(path.join(root,'ui/html/views/sequence-viewer-view.html'),'utf8')}
  ${fs.readFileSync(path.join(root,'ui/html/views/sequence-viewer-detail-view.html'),'utf8')}
  <script type="module">
  import {initSequenceViewer} from '${url('src/renderer/modules/sequence-viewer/index.js')}';
  import {buildRecordGenbankText} from '${url('src/renderer/modules/sequence-viewer/storage.js')}';
  const record = {name:'CZ013_pFUSE-PD-1', topology:'circular', sequence:'ATG'.repeat(1571),features:[
    {name:'PD-1 full length',type:'cds',strand:1,segments:[{start:600,end:1041}]},
    {name:'EF-1a promoter',type:'promoter',strand:1,segments:[{start:0,end:560}]},
    {name:'IgG1-Fc2',type:'cds',strand:1,segments:[{start:1100,end:1800}]},
    {name:'BleoR',type:'cds',strand:1,segments:[{start:2600,end:3000}]},
    {name:'CMV enhancer',type:'enhancer',strand:1,segments:[{start:3500,end:3900}]}]};
  const feature = {id:'pd1',name:'PD-1 full length',type:'cds',sequence:'ATG'.repeat(147),sequenceLength:441,hostCount:1,
    hosts:[{hostVectorId:'source',hostVectorName:record.name,topology:'circular',sequenceLength:4713,locations:[{startPos:600,endPos:1041,strand:1}]}]};
  window.hikariApi = {sequenceLibrarySearchFeatures:async()=>({ok:true,results:[feature]}),
    sequenceLibraryGet:async()=>({ok:true,entry:{id:'source',name:record.name},gbkText:buildRecordGenbankText(record)})};
  const show=id=>document.querySelectorAll('.view').forEach(e=>{e.classList.toggle('is-active',e.id===id);e.hidden=e.id!==id});
  window.viewer = initSequenceViewer({document,apiBridge:window.hikariApi,getStoragePath:()=>'/tmp/protein-picker-fixture',onNavigateHome:()=>show('sequence-viewer-view'),onNavigateDetail:()=>show('sequence-viewer-detail-view')});
  viewer.loadFromExternal(record);
  document.getElementById('sequence-viewer-vector-builder-btn').click();
  document.getElementById('sequence-viewer-vector-builder-protein-builder-btn').click();
  const search=document.getElementById('sequence-viewer-protein-builder-feature-search-input');search.value='PD-1';search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  window.qaReady=true;
  </script></body></html>`);
  const win = new BrowserWindow({width:1280,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  const errors=[];
  win.webContents.on('console-message', e=>{if(e.level>=3)errors.push(e.message)});
  const exec=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<100;i++){if(await exec(code))return;await new Promise(r=>setTimeout(r,30))}throw Error('Timed out: '+code+' '+errors.join('\n'))};
  await win.loadFile(fixture);
  await wait('Boolean(window.qaReady)');
  await wait("Boolean(document.querySelector('[data-protein-builder-feature-select-id]'))");
  await exec(`document.querySelector('[data-protein-builder-feature-select-id]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await wait("!document.getElementById('sequence-viewer-protein-builder-feature-add-btn').disabled");
  await new Promise(r=>setTimeout(r,5300));
  const metrics=await exec(`(()=>{const q=s=>document.querySelector(s),p=q('.sequence-viewer-protein-picker'),a=q('#sequence-viewer-protein-builder-feature-add-btn'),m=q('.sequence-viewer-protein-picker-map');p.scrollIntoView({block:'start'});return {selected:q('[data-protein-builder-feature-select-id]').getAttribute('aria-pressed'),buttonAboveMap:a.getBoundingClientRect().bottom<=m.getBoundingClientRect().top,proteinFolded:!q('#sequence-viewer-protein-builder-feature-picker').open,hostsOpen:q('#sequence-viewer-protein-builder-feature-hosts-fold').open,previewOpen:m.open,sourceShadow:getComputedStyle(q('.sequence-viewer-feature-source-item')).boxShadow,overflow:p.scrollWidth>p.clientWidth,buttonVisible:a.getBoundingClientRect().bottom<=innerHeight}})()`);
  assert.equal(metrics.selected,'true');assert.equal(metrics.proteinFolded,true);assert.equal(metrics.hostsOpen,true);assert.equal(metrics.previewOpen,true);assert.equal(metrics.sourceShadow,'none');assert.equal(metrics.buttonAboveMap,true);assert.equal(metrics.overflow,false);assert.equal(metrics.buttonVisible,true);
  await fs.promises.writeFile(path.join(__dirname,'desktop.png'),(await win.webContents.capturePage()).toPNG());
  // Isolate the actual mounted picker for close inspection at typical rail widths.
  await exec(`(()=>{const p=document.querySelector('.sequence-viewer-protein-picker');document.body.append(p);document.querySelectorAll('.view').forEach(e=>e.remove());document.body.style.cssText='display:block;padding:1rem;margin:0';p.style.width='19rem'})()`);
  win.setSize(360,780);
  await new Promise(r=>setTimeout(r,120));
  await fs.promises.writeFile(path.join(__dirname,'picker-day.png'),(await win.webContents.capturePage()).toPNG());
  await exec(`document.body.classList.add('theme-night')`);
  await new Promise(r=>setTimeout(r,400));
  await fs.promises.writeFile(path.join(__dirname,'picker-night.png'),(await win.webContents.capturePage()).toPNG());
  await exec(`document.querySelector('.sequence-viewer-protein-picker-map summary').click()`);
  assert.equal(await exec(`document.querySelector('.sequence-viewer-protein-picker-map').open`),false);
  await exec(`document.querySelector('.sequence-viewer-protein-picker').style.width='15rem';document.querySelector('[data-protein-builder-feature-select-id] strong').textContent='PD-1_full_length_with_a_long_protein_name';document.querySelector('.sequence-viewer-protein-picker-host-name').textContent='CZ013_pFUSE-PD-1_source_vector_with_a_long_name'`);
  assert.equal(await exec(`(()=>{const p=document.querySelector('.sequence-viewer-protein-picker');return p.scrollWidth>p.clientWidth})()`),false);
  await fs.promises.writeFile(path.join(__dirname,'narrow-collapsed.png'),(await win.webContents.capturePage()).toPNG());
  await exec(`document.querySelector('#sequence-viewer-protein-builder-feature-picker > summary').click();document.querySelector('#sequence-viewer-protein-builder-feature-hosts-fold').open=false;document.querySelector('[data-protein-builder-feature-select-id]').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))`);
  assert.equal(await exec(`!document.querySelector('#sequence-viewer-protein-builder-feature-picker').open && document.querySelector('#sequence-viewer-protein-builder-feature-hosts-fold').open && document.querySelector('.sequence-viewer-protein-picker-map').open`),true);
  assert.equal(await exec(`document.activeElement === document.querySelector('#sequence-viewer-protein-builder-feature-hosts-fold > summary')`),true);
  await exec(`document.querySelector('#sequence-viewer-protein-builder-feature-picker > summary').click();const search=document.querySelector('#sequence-viewer-protein-builder-feature-search-input');search.value='';search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  assert.equal(await exec(`document.querySelector('#sequence-viewer-protein-builder-feature-source').hidden`),true);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({metrics,checks:['keyboard feature selection','source hydration enables Add Block','action above preview','no picker horizontal overflow','map disclosure','long names at 240 CSS pixels','protein folds and source plus preview open','same protein reselection','keyboard focus moves to source','clear search hides stale source','no green edge']},null,2));
  console.log('Electron protein picker QA passed. '+JSON.stringify(metrics));
  win.destroy();app.quit();
}
main().catch(e=>{console.error(e);process.exit(1)});
