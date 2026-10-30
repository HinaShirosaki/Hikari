const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto');
const {pathToFileURL}=require('node:url');
const {SOURCE,filesIn}=require('./trial-runtime.cjs');
const SITE = path.resolve(__dirname, '../hikari-is');
const M = require('../hikari-is/trial-core.js');
// File previews in Safari serialize message origins differently from
// location.origin. Keep that exception scoped to the expected frame/parent.
const sender={}, stranger={};
for(const location of [{protocol:'file:',origin:'file://'},{protocol:'file:',origin:'null'},{protocol:'about:',origin:'file://'}]) {
  assert.equal(M.messageTargetOrigin(location),'*');
  assert.equal(M.isTrialMessage({source:sender,origin:'null'},sender,location),true);
  assert.equal(M.isTrialMessage({source:sender,origin:location.origin},sender,location),true);
  assert.equal(M.isTrialMessage({source:stranger,origin:'null'},sender,location),false);
  assert.equal(M.isTrialMessage({source:sender,origin:'https://other.test'},sender,location),false);
}
for(const origin of ['http://127.0.0.1:8790','https://example.test']) {
  const location={protocol:new URL(origin).protocol,origin};
  assert.equal(M.messageTargetOrigin(location),origin);
  assert.equal(M.isTrialMessage({source:sender,origin},sender,location),true);
  assert.equal(M.isTrialMessage({source:stranger,origin},sender,location),false);
  assert.equal(M.isTrialMessage({source:sender,origin:'null'},sender,location),false);
  assert.equal(M.isTrialMessage({source:sender,origin:'https://other.test'},sender,location),false);
}
assert.deepEqual(M.PUBLIC_FEATURES.map(feature=>feature.id),['cloning','protein-builder','calculations','protocols','workflows','samples']);
assert.equal(M.DEFAULT_FEATURE,'cloning');
assert.deepEqual(M.parseCsv('\uFEFFwell,code,name,notes\r\nW24,S024,"Enzyme, variant A","Line 1\nLine ""2"""\r\n'),[
  ['well','code','name','notes'],['W24','S024','Enzyme, variant A','Line 1\nLine "2"']]);
assert.throws(()=>M.parseCsv('well,name\nW24,"Unclosed'),/unclosed/);
// Exercise the native import handler used by the public inventory, including
// round-trip quoting and the same unique-code rule as manual sample saving.
function checkSampleCsvImport() {
  const source=fs.readFileSync(path.join(SOURCE,'src/renderer/modules/personal-inventory/well-sample-events.js'),'utf8');
  const begin=source.indexOf('function importContainerCsv('),end=source.indexOf('function escapeCsvValue',begin);
  const ctx={window:{HikariTrialModel:M}};vm.createContext(ctx);vm.runInContext(source.slice(begin,end),ctx);
  const state={samples:[{code:'EXISTS'}]},uiState={};let saves=0;
  const runtime={state,uiState,persist:()=>saves++,notifySamplesChanged(){},helpers:{ensureSamples(){},getWellLabel:(_box,i)=>`W${i+1}`,normalizeSampleCode:code=>String(code).toUpperCase(),makeDefaultSampleCode:()=> 'AUTO',normalizeSampleType:type=>type,buildAutoLocationFromLink:()=>({})}};
  const box={id:'box',wells:[{},{}]};
  ctx.importContainerCsv(runtime,'-20 Degree',box,'well,code,name,notes\nW1,NEW,"Enzyme, A","First line\nSecond line"\nW2,EXISTS,Duplicate,Ignore');
  assert.equal(state.samples.length,2);assert.equal(state.samples[1].name,'Enzyme, A');
  assert.equal(state.samples[1].notes,'First line\nSecond line');assert.equal(saves,1);
  assert.match(uiState.wellEditorStatus,/Skipped 1/);
  ctx.importContainerCsv(runtime,'-20 Degree',box,'well,code\nW1,OTHER');
  assert.equal(state.samples.length,2);assert.match(uiState.wellEditorStatus,/name/);
}

for(const id of [undefined,'missing','experiments','plugins','agent-protocols'])assert.equal(M.resolveFeature(id),'cloning');
for(const feature of M.FEATURES)assert.equal(M.resolveFeature(feature.id,true),feature.id,'Capture scenes stay available only in capture mode');
const state = M.freshState();
for (const f of M.FEATURES) {
  assert.equal(M.consumeTry(state,f.id),2);
  assert.equal(M.consumeTry(state,f.id),1);
  assert.equal(M.consumeTry(state,f.id),0);
  assert.throws(()=>M.consumeTry(state,f.id),/three tries/);
}
assert.deepEqual(M.normalizeState(JSON.parse(JSON.stringify(state))),state);
assert.equal(M.normalizeState({version:2,uses:{samples:999,cloning:-5}}).uses.samples,3);
assert.equal(M.normalizeState({version:2,uses:{samples:999,cloning:-5}}).uses.cloning,0);
assert.equal(M.normalizeState({version:2,uses:{samples:2}}).uses.workflows,0,'Existing visitors receive three Workflow tries');
assert.equal(M.normalizeState({version:2,uses:{samples:2}}).uses['protein-builder'],0,'Existing visitors receive three Protein Builder tries');
assert.equal(M.normalizeState({version:2,uses:{samples:2}}).uses.samples,2,'New trials preserve other feature counters');
assert.throws(()=>M.consumeTry(state,'missing'),/Unknown/);
assert.equal(M.nextSuggestionId([
  {id:'demo-suggestion-0',notebookState:'planned'},
  {id:'demo-suggestion-1',notebookState:'suggested'}
]),'demo-suggestion-1','Returning visitors can immediately try the next suggestion');
assert.equal(M.nextSuggestionId([{id:'demo-suggestion-0',notebookState:'planned'}]),'demo-suggestion-0');
assert.equal(M.nextSuggestionId([]),undefined);
const cloning=M.cloningExample();
assert.equal(cloning.original.length,399);
assert.equal(cloning.variant.length,399);
assert.equal(cloning.original.slice(198,201),'GCT');
assert.equal(cloning.variant.slice(198,201),'GGT');
assert.equal(cloning.original.slice(0,198),cloning.variant.slice(0,198));
assert.equal(cloning.original.slice(201),cloning.variant.slice(201));
// The recovery guard must work even when the main app never evaluates.
function checkBootGuard(origin = 'https://example.test', protocol = 'https:', model = M) {
  const listeners = new Map(), messages = [], timers = new Map();
  const ctx = {URLSearchParams,console:{error(){}},location:{search:'?feature=samples',origin,protocol},window:{HikariTrialModel:model},
    parent:{postMessage:(message,target)=>messages.push({message,target})},
    setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id),
    addEventListener:(name,fn)=>listeners.set(name,fn)};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(SITE,'trial-boot.js'),'utf8'),ctx);
  listeners.get('error')({target:{tagName:'SCRIPT',src:'missing.js'}});
  assert.equal(messages.length,1);assert.equal(messages[0].message.type,'hikari-trial:error');
  assert.equal(messages[0].message.feature,'samples');
  assert.equal(messages[0].target,protocol==='file:' || origin==='null'?'*':origin);
  timers.get(1)();assert.equal(messages.length,1,'Do not repeatedly announce a failed startup');
  listeners.get('hikari-trial-ready')();assert.equal(timers.size,0);
  listeners.get('unhandledrejection')({reason:'after-ready'});assert.equal(messages.length,1);
}
checkBootGuard();checkBootGuard('null','file:');checkBootGuard('file://','file:');
checkBootGuard('https://example.test','https:',null);checkBootGuard('file://','file:',null);
// A worksheet opens exactly one renderer. Captures and the other demos still
// need the complete bundle; the startup guard handles a selected script failure.
for(const [feature,capture,expected] of [['calculations',false,['grid.js','worksheet.js']],['calculations',true,['tabulator.js','full.js']],['cloning',false,['tabulator.js','full.js']]]) {
  const loaded=[],preloaded=[];let ready;
  const ctx={window:{HikariBrowserTrial:{feature,capture}},Object,document:{
    currentScript:{dataset:{calculationsBundle:'worksheet.js',defaultBundle:'full.js',grid:'grid.js',tabulator:'tabulator.js'}},
    createElement:tag=>{assert.ok(['script','link'].includes(tag));return {};},
    head:{append:link=>preloaded.push([link.rel,link.as,link.href])},body:{append:script=>{assert.equal(script.async,false);loaded.push(script.src);}},
    addEventListener:(type,listener)=>{assert.equal(type,'DOMContentLoaded');ready=listener;}
  }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(SITE,'trial-launch.js'),'utf8'),ctx);
  // The grid library and bundle download at once, then run in order after the parser-blocking scripts.
  assert.deepEqual(preloaded,expected.map(src=>['preload','script',src]));assert.deepEqual(loaded,[]);
  ready();assert.deepEqual(loaded,expected);
}
// Exercise the browser adapter without a desktop API or real browser storage.
class Storage { constructor(){this.values=new Map();}getItem(k){return this.values.get(k)||null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);} }
function checkFeatureRestart() {
  const adapter=fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8');
  const open=(localStorage,feature)=>{
    const ctx={Storage,localStorage,URLSearchParams,structuredClone,console,location:{search:'?feature='+feature},window:{HikariTrialModel:M}};
    vm.createContext(ctx);vm.runInContext(adapter,ctx);
    return ctx.window.HikariBrowserTrial.getState();
  };
  for(const {id} of M.PUBLIC_FEATURES) {
    const storage=new Storage(), expected=structuredClone(open(storage,id));
    const edited=structuredClone(expected);
    edited.settings.testPreference='changed';
    edited.notebookEntries.push({id:'visitor-extra-page',result:'A visitor’s notes'});
    edited.samples[0].name='Changed sample';
    edited.proteinBuilderTrial={...M.proteinBuilderExample(),constructName:'Changed construct',buildDna:true};
    if(id==='calculations')edited.notebookEntries[0].resultTables[0].rows[0].demo_molarity_4='999';
    if(id==='workflows') {
      edited.workflows[1].name='Changed run';
      Object.assign(edited.workflows[1].entries[0].stepStates.b2,{status:'completed',result:'Finished',values:{sample:'Changed batch'}});
    }
    storage.setItem(M.appStateKey(id),JSON.stringify(edited));
    const savedUsage=M.freshState();
    for(const feature of M.FEATURES)savedUsage.uses[feature.id]=3;
    storage.setItem(M.KEY,JSON.stringify(savedUsage));
    storage.setItem('unrelated-key','keep');
    storage.setItem(M.appStateKey(id,true),'capture-only-state');
    const other=M.PUBLIC_FEATURES.find(feature=>feature.id!==id).id;
    storage.setItem(M.appStateKey(other),'other-feature-draft');
    const usage=M.resetFeature(storage,id);
    assert.equal(usage.uses[id],0,'Restart restores three tries for the selected feature');
    assert.equal(M.normalizeState(JSON.parse(storage.getItem(M.KEY))).uses[id],0);
    for(const feature of M.FEATURES)if(feature.id!==id)assert.equal(usage.uses[feature.id],3,'Other features retain their usage');
    assert.equal(storage.getItem(M.appStateKey(id)),null,'The complete saved feature snapshot is removed');
    assert.deepEqual(structuredClone(open(storage,id)),expected,`${id} reopens with exactly its original examples`);
    assert.equal(storage.getItem('unrelated-key'),'keep');
    assert.equal(storage.getItem(M.appStateKey(id,true)),'capture-only-state');
    assert.equal(storage.getItem(M.appStateKey(other)),'other-feature-draft');
    M.resetFeature(storage,id);
    assert.deepEqual(structuredClone(open(storage,id)),expected,'Repeated restarts are deterministic');
  }
  const storage=new Storage();storage.setItem('unrelated-key','keep');
  for(const id of ['missing','agent-plot',undefined])assert.throws(()=>M.resetFeature(storage,id),/Unknown trial/);
  assert.equal(storage.values.size,1,'Invalid restart requests cannot remove another feature');
}
async function checkAdapter(requestedFeature,requestedFont,fileFrame = false) {
  const feature=M.resolveFeature(requestedFeature);
  const localStorage=new Storage(); localStorage.setItem('unrelated-key','preserved');
  const ctx={Storage,localStorage,URL,URLSearchParams,structuredClone,console,Uint8Array,Blob,setTimeout,btoa,atob,TextEncoder,TextDecoder,
    location:{search:fileFrame?'':'?feature='+requestedFeature+(requestedFont===undefined?'':'&fontSize='+requestedFont)},document:{baseURI:'https://example.test/runtime/'},window:{HikariTrialModel:M,...(fileFrame ? {HikariTrialFrameParams:'?feature='+requestedFeature+(requestedFont===undefined?'':'&fontSize='+requestedFont)} : {})}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
  const s=ctx.window.HikariBrowserTrial.getState(), api=ctx.window.hikariApi;
  assert.equal(ctx.window.HikariBrowserTrial.feature,feature,'Direct app URLs cannot open capture-only scenes');
  assert.equal(s.settings.storagePath,'/demo/hikari');
  const validFont=Number.isFinite(Number(requestedFont)) && Number(requestedFont)>=14 && Number(requestedFont)<=24;
  assert.equal(s.settings.appearance.fontSize,validFont?Number(requestedFont):M.APP_FONT_SIZE,'First layout uses the host font size; invalid values fall back safely');
  assert.equal(s.inventory['-20 Degree'][0].gridRows,5);
  assert.equal(s.inventory['-20 Degree'][0].gridCols,5);
  assert.equal(s.inventory['-20 Degree'][0].wells.length,25);
  assert.equal(s.settings.plugins.find(p=>p.id==='gel').enabled,false);
  assert.equal(s.notebookEntries.length,feature==='workflows'?7:feature==='samples'?2:['calculations','protocols'].includes(feature)?1:0);
  if(feature==='calculations') {
    const {computeNotebookResultTable}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/lib/notebook-table-formulas.js')).href);
    const entry=s.notebookEntries[0], table=entry.resultTables[0], row=table.rows.find(row=>row.id==='demo-formula-row');
    assert.equal(table.rows.length,4,'Public worksheet shows the two-known-value example');
    assert.equal(row.demo_molarity_3,'');assert.equal(row.demo_molarity_4,'','Unknowns stay blank in stored data');
    const cells=computeNotebookResultTable(table).byRowId[row.id];
    assert.equal(cells.demo_molarity_3.text,'50/E4','The real solver supplies the simplified volume formula');
    assert.equal(cells.demo_molarity_4.text,'50/D4','The real solver supplies the simplified molarity formula');
    row.demo_molarity_3='2';
    assert.equal(computeNotebookResultTable(table).byRowId[row.id].demo_molarity_4.text,'25','The guided third value resolves the remaining formula');
    row.demo_molarity_3='';
    assert.equal(computeNotebookResultTable(table).byRowId[row.id].demo_molarity_4.text,'50/D4','Clearing the third value restores the pending formula');
    // Simulate the old three-row worksheet, with edited inputs and units.
    table.rows=table.rows.filter(row=>row.id!=='demo-formula-row');
    table.rows[0].demo_molarity_4='333';
    table.columns[3].title='Volume (uL)';
    entry.resultTable=structuredClone(table);
    const usage=M.freshState();usage.uses.calculations=1;
    localStorage.setItem(M.KEY,JSON.stringify(usage));
  }
  if(feature==='workflows') {
    assert.equal(s.workflows.length,3);
    assert.equal(s.workflowTemplates.length,2);
    assert.equal(s.settings.startup.defaultViewId,'workflow-management-view');
    assert.equal(s.workflows[1].entries[0].stepStates.b2.status,'not_done');
    s.workflows[1].entries[0].stepStates.b1.result='My recorded purification result';
  }
  if(feature==='protein-builder') {
    assert.equal(s.settings.startup.defaultViewId,'sequence-viewer-view');
    s.proteinBuilderTrial={...M.proteinBuilderExample(),constructName:'My saved protein',buildDna:true};
    localStorage.setItem('hikari_state_v1',JSON.stringify(s));
    const desktopSave={...s};delete desktopSave.proteinBuilderTrial;
    localStorage.setItem('hikari_state_v1',JSON.stringify(desktopSave));
    assert.equal(ctx.window.HikariBrowserTrial.getState().proteinBuilderTrial.constructName,'My saved protein','Desktop autosave preserves the browser construct');
  }
  if(feature==='protocols') {
    const entry=s.notebookEntries[0], saved=s.protocols[0];
    assert.equal(entry.values['demo-ph-volume'],'200 µL');
    assert.ok(entry.result.includes('Clear solution'));
    saved.steps[0].text='An updated library method';
    assert.ok(entry.protocolSnapshot.steps[0].text.includes('demo-ph-protein'));
    assert.equal(s.protocols.length,8,'The protocol trial offers several methods, template first');
    for(const step of s.protocols.slice(1).flatMap(p=>p.steps))assert.deepEqual([...step.text.matchAll(/\{\{ph:([^}]+)\}\}/g)].map(m=>m[1]),step.placeholders.map(ph=>ph.id),'Every field token has its placeholder');
  }
  assert.equal(s.settings.plugins.map(p=>p.id).join(),'gel','The trial ships no plugins');
  assert.equal(localStorage.getItem('unrelated-key'),'preserved');
  assert.equal(localStorage.values.has('hikari_state_v1'),false);
  localStorage.setItem('hikari_state_v1',JSON.stringify(s));
  assert.equal(localStorage.values.has('hikari_state_v1'),false);
  assert.equal(localStorage.values.has('hikari-website-app-v3/'+feature),true);
  assert.equal((await api.readPluginFile({pluginId:'scientific-illustration',path:'library.json'})).ok,false);
  assert.equal((await api.readFileBase64({path:'/Users/private'})).ok,false);
  assert.equal((await api.agentChat({})).ok,false);
  assert.equal((await api.servePluginFolder('arbitrary')).ok,false);
  // A returning, previously empty trial receives fixtures without losing edits.
  s.notebookEntries[0] && (s.notebookEntries[0].result='My edited example');
  s.samples=[];
  s.settings.plugins.push({id:'scientific-illustration',name:'Figura',enabled:false});
  const legacyBox=s.inventory['-20 Degree'][0];
  legacyBox.gridRows=9;legacyBox.gridCols=9;
  legacyBox.wells=Array.from({length:81},(_,index)=>({name:`W${index+1}`,content:''}));
  legacyBox.wells[24]={contents:[{id:'edited-well-item'}],note:'Keep this well'};
  if(feature==='samples') {
    legacyBox.wells[80]={name:'W81',content:'Keep the outer well'};
    s.samples.push({id:'saved-outer-sample',name:'My saved sample',code:'DEMO-081',inventoryLink:{section:'-20 Degree',containerId:'demo-box',wellIndex:80},location:{box:'Example box',position:'W81'}});
    localStorage.setItem(M.KEY,JSON.stringify(M.normalizeState({version:2,uses:{samples:1}})));
  }
  localStorage.setItem('hikari_state_v1',JSON.stringify(s));
  vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
  const returning=ctx.window.HikariBrowserTrial.getState();
  assert.equal(returning.samples.length,feature==='samples'?4:3);
  const compactBox=returning.inventory['-20 Degree'][0];
  assert.equal(compactBox.gridRows,5);assert.equal(compactBox.gridCols,5);
  assert.equal(compactBox.wells.length,25);
  assert.equal(compactBox.wells[24].contents[0].id,'edited-well-item');
  assert.equal(compactBox.wells[24].note,'Keep this well');
  if(feature==='samples') {
    const moved=returning.samples.find(sample=>sample.id==='saved-outer-sample');
    assert.equal(moved.inventoryLink.wellIndex,23,'Outer samples move to an available well without overwriting edited wells');
    assert.equal(moved.location.position,'W24');
    assert.equal(compactBox.wells[23].name,'W24');
    assert.equal(compactBox.wells[23].content,'Keep the outer well');
    localStorage.setItem('hikari_state_v1',JSON.stringify(returning));
    vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
    assert.equal(ctx.window.HikariBrowserTrial.getState().samples.find(sample=>sample.id==='saved-outer-sample').inventoryLink.wellIndex,23,'Reload preserves the migrated position');
    assert.equal(JSON.parse(localStorage.getItem(M.KEY)).uses.samples,1,'Resizing the box preserves try counts');
    const dense=structuredClone(returning), denseBox=dense.inventory['-20 Degree'][0];
    Object.assign(denseBox,{gridRows:9,gridCols:9,wells:Array.from({length:81},(_,index)=>({name:`W${index+1}`,content:index<25 || index===80 ? `Saved well ${index}` : ''}))});
    dense.samples.find(sample=>sample.id==='saved-outer-sample').inventoryLink.wellIndex=80;
    localStorage.setItem('hikari_state_v1',JSON.stringify(dense));
    vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
    const denseResult=ctx.window.HikariBrowserTrial.getState(), resized=denseResult.inventory['-20 Degree'][0];
    assert.equal(resized.gridRows,6,'More than 25 occupied wells retain enough capacity');
    assert.equal(resized.wells.filter(well=>well.content).length,26,'No occupied wells are dropped');
    assert.equal(resized.wells[35].content,'Saved well 80');
    assert.equal(denseResult.samples.find(sample=>sample.id==='saved-outer-sample').inventoryLink.wellIndex,35);
  }
  if(returning.notebookEntries.length)assert.equal(returning.notebookEntries[0].result,'My edited example');
  if(feature==='workflows') {
    assert.equal(returning.workflows.length,3,'Returning visits do not duplicate runs');
    assert.equal(returning.workflows[1].entries[0].stepStates.b1.result,'My recorded purification result');
  }
  if(feature==='protein-builder')assert.equal(returning.proteinBuilderTrial.constructName,'My saved protein');
  if(feature==='calculations') {
    const entry=returning.notebookEntries[0];
    for(const table of [entry.resultTables[0],entry.resultTable]) {
      assert.equal(table.rows.filter(row=>row.id==='demo-formula-row').length,1,'Returning worksheet gains one example in both saved table formats');
      assert.equal(table.rows[0].demo_molarity_4,'333','Upgrade preserves existing inputs');
      assert.equal(table.columns[3].title,'Volume (uL)','Upgrade preserves column units');
      table.rows.find(row=>row.id==='demo-formula-row').demo_molarity_3='2000';
    }
    localStorage.setItem('hikari_state_v1',JSON.stringify(returning));
    vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
    for(const table of [ctx.window.HikariBrowserTrial.getState().notebookEntries[0].resultTables[0],ctx.window.HikariBrowserTrial.getState().notebookEntries[0].resultTable]) {
      assert.equal(table.rows.filter(row=>row.id==='demo-formula-row').length,1,'Reload does not duplicate the example');
      assert.equal(table.rows.find(row=>row.id==='demo-formula-row').demo_molarity_3,'2000','Reload preserves edits to the formula example');
    }
    assert.equal(JSON.parse(localStorage.getItem(M.KEY)).uses.calculations,1,'Adding an example never consumes or resets a try');
  }
  assert.equal(returning.settings.plugins.map(p=>p.id).join(),'gel','Returning trials drop the formerly shipped example plugin');
}
async function checkFeatureServices() {
  class BrowserStorage extends Storage {}
  const localStorage=new BrowserStorage();
  const ctx={Storage:BrowserStorage,localStorage,URL,URLSearchParams,structuredClone,console,Uint8Array,atob,
    location:{search:'?feature=cloning'},window:{HikariTrialModel:M}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
  const api=ctx.window.hikariApi;
  const {buildRecordGenbankText}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/modules/sequence-viewer/storage.js')).href);
  const record={name:'Test coding sequence',sequence:'ATGGCTGGT',topology:'circular',features:[{name:'Test protein',type:'CDS',strand:1,segments:[{start:0,end:9}]}]};
  const payload={...record,status:'saved',gbkText:buildRecordGenbankText(record),sequenceLength:9};
  const entry=(await api.sequenceLibraryUpsert(payload)).entry;
  const stale=structuredClone(ctx.window.HikariBrowserTrial.getState());
  stale.trialLibrary={entries:[],folders:[],backbones:[]};
  const folder=(await api.sequenceLibraryUpsertFolder({name:'My sequences'})).folder;
  await api.sequenceLibraryMoveEntry({id:entry.id,folderId:folder.id});
  await api.sequenceLibraryUpsertBackbone({backbone:{id:'backbone',backboneSequence:'ACGTACGT',insertionOffset:4}});
  const file=await api.storeImportedFile({targetFolder:'/demo/hikari/Results',fileName:'result.txt',dataBase64:'aGVsbG8='});
  localStorage.setItem('hikari_state_v1',JSON.stringify(stale));
  assert.equal((await api.sequenceLibraryList({status:'saved'})).entries.length,1,'A stale desktop autosave cannot erase browser-local sequences');
  assert.equal((await api.sequenceLibraryGet({id:entry.id})).gbkText,payload.gbkText);
  assert.equal((await api.sequenceLibraryGet({id:entry.id})).entry.folderId,folder.id);
  const feature=(await api.sequenceLibrarySearchFeatures({query:'test'})).results[0];
  assert.equal(feature.sequence,'ATGGCTGGT');assert.equal(feature.hosts[0].hostVectorId,entry.id);
  assert.equal((await api.sequenceLibraryListBackbones()).results.length,1);
  assert.equal((await api.readFileBase64(file.filePath)).dataBase64,'aGVsbG8=');
  assert.equal(new TextDecoder().decode((await api.readFileBytes(file.filePath)).bytes),'hello');
  assert.equal((await api.storeImportedFile({targetFolder:'/Users/private',dataBase64:'aGVsbG8='})).ok,false);
  assert.equal((await api.readFileBase64('/Users/private')).ok,false);
  await api.sequenceLibraryDeleteFolder({id:folder.id});
  assert.equal((await api.sequenceLibraryGet({id:entry.id})).entry.folderId,'');
  vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
  assert.equal((await ctx.window.hikariApi.sequenceLibraryList()).entries.length,1,'Library survives reloading the selected feature');
  assert.equal((await ctx.window.hikariApi.readFileBase64(file.filePath)).dataBase64,'aGVsbG8=','Attachments survive reload');
  await ctx.window.hikariApi.sequenceLibraryDelete({id:entry.id});
  assert.equal((await ctx.window.hikariApi.sequenceLibraryGet({id:entry.id})).ok,false);
  assert.equal(ctx.window.HikariBrowserTrial.allowsView('sequence-viewer-detail-view'),true);
  for(const view of ['home-view','settings-view','agent-view','biology-notebook-view','sample-registry-view'])assert.equal(ctx.window.HikariBrowserTrial.allowsView(view),false,view+' stays outside the DNA trial');
  for(const feature of M.PUBLIC_FEATURES)assert.ok(M.featureViews(feature.id).length);
  assert.ok(!fs.readFileSync(path.join(SITE,'trial-app.js'),'utf8').includes('M.consumeTry('),'Public actions have no use quota');
  assert.ok(!fs.readFileSync(path.join(SITE,'trial-guide.js'),'utf8').includes('READ_ONLY_GUIDES'),'Legacy exhausted counters cannot select a read-only guide');
}
async function checkCaptureIsolation(feature) {
  class CaptureStorage {
    constructor(){this.values=new Map();this.reads=[];}
    getItem(key){this.reads.push(key);return this.values.get(key)||null;}
    setItem(key,value){this.values.set(key,String(value));}
  }
  const localStorage=new CaptureStorage();
  const privateState=JSON.stringify({settings:{storagePath:'/private/workspace'},projects:[{id:'private',name:'PRIVATE_PROJECT_SENTINEL'}]});
  localStorage.setItem('hikari-website-app-v3/'+feature,privateState);
  localStorage.setItem('hikari-website-capture-v1/'+feature,privateState);
  const ctx={Storage:CaptureStorage,localStorage,URL,URLSearchParams,structuredClone,console,Uint8Array,Blob,setTimeout,btoa,atob,TextEncoder,TextDecoder,
    location:{search:'?feature='+feature+'&capture=1'},document:{baseURI:'https://example.test/runtime/'},window:{HikariTrialModel:M}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE,'agent-scenes.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE,'trial-adapter.js'),'utf8'),ctx);
  assert.equal(ctx.window.HikariBrowserTrial.capture,true);
  assert.equal(ctx.window.HikariBrowserTrial.getState().inventory['-20 Degree'][0].gridRows,9,'Product captures keep their original box');
  assert.equal(ctx.window.HikariBrowserTrial.getState().inventory['-20 Degree'][0].wells.length,81);
  // Agent scenes answer with prepared replies and read only their own fixture files.
  const agentScene=ctx.window.HikariBrowserTrial.agentScene, api=ctx.window.hikariApi;
  assert.equal(!!agentScene,feature.startsWith('agent-'));
  if(agentScene) {
    assert.equal((await api.getCodexLlmStatus()).loggedIn,true);
    assert.equal((await api.runDirectLlmPrompt({task:'unprepared-task'})).ok,false);
    assert.equal((await api.readFileBytes('/Users/private/paper.pdf')).ok,false);
    for(const file of Object.values(agentScene.files))assert.ok(fs.existsSync(path.resolve(SITE,'runtime',file)),`Agent fixture: ${file}`);
  } else assert.equal((await api.agentChat({})).ok,false);
  assert.equal(ctx.window.HikariBrowserTrial.APP_KEY,'hikari-website-capture-v1/'+feature);
  assert.equal(ctx.window.HikariTrialModel.KEY,'hikari-website-capture-usage-v1');
  assert.equal(JSON.stringify(ctx.window.HikariBrowserTrial.getState()).includes('PRIVATE_PROJECT_SENTINEL'),false);
  assert.deepEqual(localStorage.reads,[]);
  assert.equal(localStorage.values.get('hikari-website-app-v3/'+feature),privateState);
  if(feature==='calculations')assert.equal(ctx.window.HikariBrowserTrial.getState().notebookEntries[0].resultTables[0].rows.length,4);
}
async function checkMolarityFormulas() {
  const {createMolarityNotebookResultTable,setNotebookResultTableColumnUnit}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/lib/notebook-result-tables.js')).href);
  const {computeNotebookResultTable}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/lib/notebook-table-formulas.js')).href);
  const table=createMolarityNotebookResultTable(null,1), row=table.rows[0];
  const cells=value=>computeNotebookResultTable(value).byRowId[value.rows[0].id];
  row[table.columns[1].field]='100'; row[table.columns[2].field]='5';
  assert.equal(cells(table)[table.columns[3].field].text,'50/E1','Trial simplifies a pending volume');
  assert.equal(cells(table)[table.columns[4].field].text,'50/D1','Trial simplifies a pending molarity');
  const microlitres=setNotebookResultTableColumnUnit(table,3,'uL');
  assert.equal(cells(microlitres)[microlitres.columns[3].field].text,'50000/E1','Unit conversion keeps pending formulas correct');
  row[table.columns[2].field]=''; row[table.columns[3].field]='1';
  assert.equal(cells(table)[table.columns[2].field].text,'0.1*E1');
  assert.equal(cells(table)[table.columns[4].field].text,'10*C1');
  row[table.columns[4].field]='50';
  assert.equal(cells(table)[table.columns[2].field].text,'5','Three known values still calculate the fourth');
}
async function checkWorkflowRecords() {
  const fixture=M.workflowExample();
  const state={...fixture,projects:[{id:'demo-project',name:'Example enzyme project'}],assays:[]};
  const {buildWorkflowExecutionLayout,computeEntryProgress}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/modules/workflow/execution.js')).href);
  const {createWorkflowStepState}=await import(pathToFileURL(path.join(SOURCE,'src/renderer/modules/workflow/actions/step-state.js')).href);
  const [first,run,other]=state.workflows, entry=run.entries[0], layout=buildWorkflowExecutionLayout(run);
  assert.equal(computeEntryProgress(first.entries[0],buildWorkflowExecutionLayout(first)).completedSteps,4);
  assert.equal(computeEntryProgress(entry,layout).completedSteps,2);
  assert.equal(computeEntryProgress(entry,layout).totalSteps,4,'Inactive optional branch is separate from the main process');
  assert.equal(computeEntryProgress(entry,layout).nextBlockId,'b2');
  const steps=createWorkflowStepState({state,renderer:{titleForBlock:block=>state.protocols.find(p=>p.id===block.protocolId).name},createId:()=> 'trial-created-page',getWorkflowById:id=>state.workflows.find(w=>w.id===id),buildWorkflowStepNotebookFolderPath:()=>'/demo/hikari/notebook'});
  const step=steps.ensureEntryStepState(entry,'b2');
  step.values={sample:'Batch B · replicate 2'};
  step.result='Relative activity: 88% at 25 °C.';step.status='completed';step.completedAt='2026-10-10T12:00:00.000Z';
  const page=steps.upsertNotebookEntryForStep(run,entry,run.blocks[2],{executed:true});
  assert.equal(page.result,step.result);assert.equal(page.notebookState,'executed');
  assert.equal(page.executedAt,step.completedAt);
  assert.deepEqual(page.values,{sample:'Batch B · replicate 2'},'Completed steps retain edited placeholder values in the linked page');
  assert.notEqual(page.values,step.values,'The linked page owns its recorded values');
  assert.equal(page.workflowContext.workflowId,run.id);assert.equal(page.workflowContext.workflowBlockId,'b2');
  assert.equal(step.notebookEntryId,page.id);assert.ok(run.notebookEntryIds.includes(page.id));
  state.protocols.find(p=>p.id==='demo-measure').steps[0].text='Updated template';
  assert.ok(page.protocolSnapshot.steps[0].text.includes('{{ph:sample}}'),'Linked page owns a snapshot of its method');
  assert.equal(steps.upsertNotebookEntryForStep(run,entry,run.blocks[2]).id,page.id,'Reopening the step reuses its notebook page');
  assert.equal(state.notebookEntries.length,8);
  assert.equal(computeEntryProgress(entry,layout).completedSteps,3);
  assert.equal(computeEntryProgress(entry,layout).nextBlockId,'b3');
  assert.equal(computeEntryProgress(other.entries[0],buildWorkflowExecutionLayout(other)).completedSteps,1,'Other runs keep independent progress');
  const purification=steps.ensureEntryStepState(other.entries[0],'b1');
  purification.values={sample:'Batch C · replicate 2',volume:'3 mL'};
  purification.result='Clear eluate.';
  const purificationPage=steps.upsertNotebookEntryForStep(other,other.entries[0],other.blocks[1]);
  assert.deepEqual(purificationPage.values,{sample:'Batch C · replicate 2',volume:'3 mL'},'Multiple placeholder values carry into the method alongside notes');
  assert.equal(purificationPage.result,'Clear eluate.');
  assert.ok(purificationPage.protocolSnapshot.steps[0].text.includes('{{ph:volume}}'));
  assert.equal(state.protocols.find(p=>p.id==='demo-purify').steps[0].text,'Collect {{ph:volume}} from {{ph:sample}}.','Recording a run leaves the reusable method unchanged');
  entry.activeBranchRootIds=['b4'];
  assert.equal(computeEntryProgress(entry,layout).totalSteps,5,'Activating the optional branch adds its own step');
}
async function checkDnaEdits() {
  const native=file=>pathToFileURL(path.join(SOURCE,'src/renderer/modules/sequence-viewer',file)).href;
  const {createSequenceEditActions}=await import(native('runtime/sequence-edit-workflow.js'));
  const {createSequenceViewerSequenceEditingController}=await import(native('detail-sequence-editing.js'));
  const {buildDisplayPlan}=await import(native('cloning-design/plan-building.js'));
  const original=M.cloningExample().original;
  for(const [mode,replacement,expectedType] of [['insert','GGT','insertion'],['replace','AAA','replacement'],['delete','','deletion']]) {
    const state={records:[{name:'Example fragment',sequence:original,topology:'circular',features:[]}],selectedRecordIndex:0,warnings:[]};
    const actions={getSelectedRecord:()=>state.records[0],resetAlignmentState(){},async persistFeatureMutation(){}};
    Object.assign(actions,createSequenceEditActions({state,actions,controllers:{}}));
    const end=mode==='insert' ? 198 : 201;
    const elements={sequenceEditOverlay:{hidden:true},sequenceEditTitle:{},sequenceEditNote:{},sequenceEditInputWrap:{},sequenceEditDeleteMessage:{},sequenceEditTextarea:{value:''},sequenceEditConfirmBtn:{}};
    const editor=createSequenceViewerSequenceEditingController({state:{sequenceCursorBase:198},elements,getSelectedRecord:actions.getSelectedRecord,getSequenceSelectionRange:()=>mode==='insert' ? null : {start:198,end},onApplySequenceEdit:actions.applySequenceEdit});
    assert.equal(editor.openSequenceEditFromKeyboardEvent({key:mode==='delete'?'Delete':'a',target:{tagName:'DIV'},preventDefault(){}}),true);
    assert.equal(elements.sequenceEditTitle.textContent,`${mode[0].toUpperCase()+mode.slice(1)} Bases`);
    elements.sequenceEditTextarea.value=replacement;
    await editor.applySequenceEditDialog();
    assert.equal(elements.sequenceEditOverlay.hidden,true,'A successful edit closes the native confirmation dialog');
    const record=state.records[0],source=state.sequenceEditDesignSource;
    assert.equal(record.sequence,original.slice(0,198)+replacement+original.slice(end),`${mode} changes the actual DNA`);
    assert.equal(source.editRequest.type,expectedType);
    assert.equal(source.originalSequence,original);
    assert.equal(source.editedSequence,record.sequence);
    const plan=buildDisplayPlan({strategy:'q5-kld',record,source});
    assert.equal(plan.feasible,true,`${mode} feeds a feasible native primer design`);
    assert.equal(plan.primers.length,2);
    const before=record.sequence;
    await actions.applySequenceEdit({mode:'insert',range:{start:210,end:210},sequence:'AAC'});
    assert.equal(state.records[0].sequence,before.slice(0,210)+'AAC'+before.slice(210));
    assert.equal(state.sequenceEditDesignSource.originalSequence,original,'Successive edits retain the original cloning template');
    await assert.rejects(actions.applySequenceEdit({mode:'delete',range:{start:0,end:state.records[0].sequence.length}}),/cannot be empty/);
  }
}
async function checkProteinBuilder() {
  const native=file=>pathToFileURL(path.join(SOURCE,'src/renderer/modules/sequence-viewer',file)).href;
  const {buildConstruct}=await import(native('protein-builder/protein-construct.js'));
  const {buildDnaConstruct}=await import(native('protein-builder/dna-construct.js'));
  const {translateDnaSequence}=await import(native('calculations/sequence.js'));
  const {cloneLibraryRow}=await import(native('protein-builder/row-factory.js'));
  const {createSequenceViewerProteinBuilderController}=await import(native('protein-builder.js'));
  const fixture=M.proteinBuilderExample(), protein=buildConstruct(fixture);
  assert.equal(fixture.buildDna,false,'The opening example requires an explicit DNA build');
  assert.equal(protein.sequence.length,103);
  for(const organism of ['ecoli','human']) {
    const dna=buildDnaConstruct(fixture,{organism});
    assert.equal(dna.ok,true);assert.equal(dna.sequence.length,309);
    assert.equal(translateDnaSequence(dna.sequence).protein,protein.sequence,'Coding DNA matches the assembled protein');
  }
  const edited={...fixture,rows:[...fixture.rows,cloneLibraryRow(5,'linker','g4s')]};
  const dna=buildDnaConstruct(edited,{organism:'human'});
  assert.equal(dna.sequence.length,324);assert.equal(translateDnaSequence(dna.sequence).protein,protein.sequence+'GGGGS');
  assert.equal(buildDnaConstruct({...fixture,rows:[]},{organism:'ecoli'}).ok,false,'An empty chain cannot consume a successful build');
  const elements={proteinBuilderNameInput:{value:''},proteinBuilderCodonUsageSelect:{value:'ecoli'}};
  const controller=createSequenceViewerProteinBuilderController({elements});
  controller.loadMcpConstruct({...fixture,constructName:'My edited protein'});
  assert.equal(controller.trialSnapshot().constructName,'My edited protein','Reload preserves a custom construct name');
  assert.equal(controller.trialSnapshot().buildDna,false,'Loading an unbuilt draft does not generate DNA');
  assert.equal(controller.trialBuildDna().sequence.length,309);
  assert.equal(controller.trialSnapshot().buildDna,true,'Only successful builds restore generated output');
}
function checkGuideConditions() {
  // Load the real guide definitions before their DOM layer is mounted. These
  // regressions exercise completion from rendered state, not synthetic keys.
  const source=fs.readFileSync(path.join(SITE,'trial-guide.js'),'utf8');
  const marker='  const $ = id => document.getElementById(id), states = new Map(), bindings = new WeakMap();';
  assert.ok(source.includes(marker));
  const ctx={};
  vm.runInNewContext(source.replace(marker,()=>`  globalThis.guideDefinitions=GUIDES; return;\n${marker}`),ctx);
  const guides=ctx.guideDefinitions;
  const worksheet=(volume,molarity,editing=false)=>{
    const cells={demo_molarity_0:{textContent:'Formula example'},demo_molarity_3:{textContent:volume,querySelector:()=>editing?{}:null},demo_molarity_4:{textContent:molarity}};
    const row={querySelector:selector=>cells[selector.match(/tabulator-field="([^"]+)"/)[1]]};
    return {querySelectorAll:()=>[row]};
  };
  const resolved=guides.calculations.find(step=>step.title==='From formula to number').condition;
  assert.equal(typeof resolved,'function');
  for(const [volume,molarity,editing] of [['50/E4','50/D4',false],['','',false],['2','25',true],['0','Infinity',false],['bad','25',false]]) {
    assert.equal(resolved(worksheet(volume,molarity,editing)),false,'Pending formulas and an active editor must not finish the calculation step');
  }
  assert.equal(resolved(worksheet('2','25')),true,'Committing by Enter or blur advances even when Tabulator removes the original key target');
  assert.equal(resolved(worksheet('4','12.5')),true,'A valid third value need not be exactly the suggested example');
  assert.equal(resolved(worksheet('50/E4','50/D4')),false,'Clearing a known value restores the unresolved state');
  const notes=guides.protocols.find(step=>step.target==='#biology-notebook-result');
  assert.ok(notes,'The observation has its own unobscured guide target');
  assert.equal(notes.ready({querySelector:()=>({value:'   '})}),false);
  assert.equal(notes.ready({querySelector:()=>({value:'Clear after incubation.'})}),true);
  const code=guides.samples.find(step=>step.title==='Set a sample code');
  const name=guides.samples.find(step=>step.title==='Name the sample');
  assert.ok(code.target.includes('label:has(') && name.target.includes('label:has('),'Sample fields are revealed individually, not as a clipped full editor');
  for(const step of [code,name]) {
    assert.equal(step.scrollBelow,'.container-detail-sticky');
    assert.equal(step.ready({querySelector:()=>({value:''})}),false);
    assert.equal(step.ready({querySelector:()=>({value:'Filled'})}),true);
  }
}
(async()=>{
  checkGuideConditions();
  checkFeatureRestart();
  assert.equal(M.appFontSize(1512,982,1),14,'An unscaled desktop uses Hikari\'s native text size');
  assert.ok(M.appFontSize(1512,982,.55)>M.appFontSize(1512,982,1),'A smaller preview compensates for scaling');
  assert.ok(M.appFontSize(800,600,.55)<M.appFontSize(1920,1080,.55),'A narrow desktop caps text before it crowds controls');
  for(const scale of [.01,.4,.8,1,2,0,NaN,Infinity]) {
    const size=M.appFontSize(1512,982,scale);
    assert.ok(Number.isFinite(size) && size>=14 && size<=24,'Preview fonts stay within safe bounds');
  }
  await checkDnaEdits();
  await checkProteinBuilder();
  await checkMolarityFormulas();
  await checkWorkflowRecords();
  checkSampleCsvImport();
  await checkFeatureServices();
  for(const f of M.PUBLIC_FEATURES)await checkAdapter(f.id);
  for(const f of M.PUBLIC_FEATURES)await checkAdapter(f.id,'23.5',true);
  for(const font of ['23.25','14','24','0','100','NaN'])await checkAdapter('calculations',font);
  for(const id of [undefined,'missing','experiments','plugins','agent-protocols'])await checkAdapter(id);
  for(const f of M.FEATURES)await checkCaptureIsolation(f.id);
  const html=fs.readFileSync(path.join(SITE,'index.html'),'utf8');
  for(const f of M.FEATURES)assert.ok(new RegExp(`id:\\s*["']${f.id}["']`).test(html),f.id+' Product link');
  const app=fs.readFileSync(path.join(SITE,'trial-app.html'),'utf8');
  const fileFrame=fs.readFileSync(path.join(SITE,'trial-file-frame.js'),'utf8');
  const frameOutput=[], frameContext={URL,window:{},document:{currentScript:{src:'file:///example/trial-file-frame.js?feature=calculations&fontSize=23.5'},write:markup=>frameOutput.push(markup)}};
  vm.createContext(frameContext);vm.runInContext(fileFrame,frameContext);
  assert.equal(frameContext.window.HikariTrialFrameParams,'?feature=calculations&fontSize=23.5');
  assert.deepEqual(frameOutput,[app],'File previews use exactly the current Trial HTML, styles, and bundles');
  for(const id of ['biology-notebook-view','sample-registry-view','sequence-viewer-cloning-design-workspace','sequence-viewer-protein-builder-workspace','sequence-viewer-protein-builder-copy-dna-btn','workflow-management-view','workflow-process-dialog','setting-view'])assert.ok(app.includes(`id="${id}"`));
  assert.match(app,/data-default-bundle="trial-bundle\.js\?v=[a-f0-9]+"/);
  assert.match(app,/data-calculations-bundle="trial-calculations\.js\?v=[a-f0-9]+"/);
  assert.match(app,/href="trial-styles\.css\?v=[a-f0-9]+"/);
  assert.match(app,/src="\.\.\/trial-boot\.js\?v=[a-f0-9]+"/);
  assert.ok(!app.includes('src="../trial-app.js"'));
  const build=JSON.parse(fs.readFileSync(path.join(__dirname,'trial-build.json'),'utf8'));
  const runtimeRoot=path.join(SITE,'runtime');
  for(const [markup,prefix,files] of [[html,'',['trial-core.js','trial-guide.js','trial.js']],[app,'../',['trial-core.js','trial-boot.js','trial-adapter.js','trial-entry.js','trial-launch.js']]]) {
    for(const file of files) {
      const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(SITE,file))).digest('hex').slice(0,12);
      assert.ok(markup.includes(`src="${prefix}${file}?v=${version}"`),`Rebuild after editing ${file}`);
    }
  }
  const bundleVersion=crypto.createHash('sha256').update(fs.readFileSync(path.join(runtimeRoot,'trial-bundle.js'))).digest('hex').slice(0,12);
  assert.ok(app.includes(`data-default-bundle="trial-bundle.js?v=${bundleVersion}"`),'Trial HTML must load the current bundle fingerprint');
  const calculationBundle=path.join(runtimeRoot,'trial-calculations.js');
  const calculationVersion=crypto.createHash('sha256').update(fs.readFileSync(calculationBundle)).digest('hex').slice(0,12);
  assert.ok(app.includes(`data-calculations-bundle="trial-calculations.js?v=${calculationVersion}"`),'The worksheet must load its current bundle');
  assert.equal(build.calculationScriptBytes,fs.statSync(calculationBundle).size);
  assert.ok(build.calculationScriptBytes < build.scriptBytes*.8,'The worksheet must remain substantially smaller than the full renderer');
  const runtimeManifest=JSON.parse(fs.readFileSync(path.join(__dirname,'trial-runtime-manifest.json'),'utf8'));
  const actualFiles=filesIn(runtimeRoot).map(file=>path.relative(runtimeRoot,file).split(path.sep).join('/')).sort();
  assert.deepEqual(actualFiles,runtimeManifest.files,'Only the traced source graph and runtime resources are vendored');
  assert.equal(actualFiles.reduce((sum,file)=>sum+fs.statSync(path.join(runtimeRoot,file)).size,0),runtimeManifest.bytes);
  for(const obsolete of ['vendor/pdfjs','vendor/plotly','vendor/onnxruntime','vendor/colony-counter','vendor/sqljs','vendor/utif','src/renderer/modules/tool-box','src/renderer/modules/home-dashboard','plugins']) {
    assert.equal(fs.existsSync(path.join(runtimeRoot,obsolete)),false,`Unused desktop runtime: ${obsolete}`);
  }
  assert.equal(build.entryHash,crypto.createHash('sha256').update(fs.readFileSync(path.join(SITE,'trial-app.js'))).digest('hex'),'Rebuild after editing trial-app.js');
  const bundledCss=fs.readFileSync(path.join(SITE,'runtime/trial-styles.css'),'utf8');
  assert.ok(!bundledCss.includes('@import'),'Trial styles load in one request');
  for(const [,asset] of bundledCss.matchAll(/url\("([^"#]+)"\)/g)) if(!/^(?:[a-z]+:|\/)/i.test(asset)) assert.ok(fs.existsSync(path.resolve(SITE,'runtime',asset)),`Bundled style asset: ${asset}`);
  assert.ok(fs.existsSync(path.join(SOURCE,'src/renderer/core/start-hikari-core.js')),'The frozen source remains available to rebuild the Trial');
  assert.deepEqual(actualFiles.filter(file=>file.startsWith('src/')),[],'Bundled renderer source stays outside the served runtime');
  assert.ok(!app.includes('vendor/plotly'),'Plotly loads only for the Agent chart screenshot');
  console.log('PASS: six public trials, complete isolated feature restart, native DNA insert/replace/delete and cumulative primer design, Protein Builder coding DNA and saved drafts, Workflow progress and linked notebook records, capture-only boundaries, molarity formulas, unlimited actions, browser-local sequence and attachment storage, scoped navigation, isolated records, capture privacy, no shipped plugins, native boundaries, startup recovery, minimal runtime inventory, and current bundled Hikari HTML/assets.');
})().catch(error=>{console.error(error);process.exitCode=1;});
