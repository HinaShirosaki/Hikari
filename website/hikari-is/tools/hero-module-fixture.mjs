// Disposable marketing capture only. Research records are fictional;
// Papers contains real landmark citations with clearly marked demo annotations.
import { defaultState, STORAGE_KEY } from '../../../src/renderer/modules/app-state/index.js';
import { startHikariCore } from '../../../src/renderer/core/start-hikari-core.js';
import { buildRecordGenbankText } from '../../../src/renderer/modules/sequence-viewer/storage.js';
import { installDialogLayout } from '../../../src/renderer/app/dialog-layout.js';

export async function initHeroModules(pdfs = {}) {
  const state = structuredClone(defaultState);
  const at = '2026-10-29T15:00:00.000Z';
  state.settings.storagePath = '/preview/fictional-lab';
  state.settings.plugins = [];
  state.settings.appearance = {...state.settings.appearance, mode:'day', fontSize:14};
  state.settings.startup = {...state.settings.startup, defaultViewId:'biology-notebook-view'};
  const project = {id:'hero-project',name:'Enzyme stability screen',description:'Fictional enzyme engineering study.',createdAt:at,updatedAt:at};
  state.projects = [project];
  const protocol = {id:'hero-protocol',name:'Thermal challenge · activity assay',category:'Protein biochemistry',purpose:'Compare retained activity after a controlled heat challenge.',materials:['Purified enzyme variants','Assay buffer B','Substrate solution','96-well plate'],steps:[
    {id:'s1',text:'Prepare matched aliquots of {{ph:sample}} in assay buffer B.',placeholders:[{id:'sample',name:'Sample'}]},
    {id:'s2',text:'Incubate at {{ph:temperature}} for {{ph:time}}. Keep a matched unheated control.',placeholders:[{id:'temperature',name:'Temperature'},{id:'time',name:'Duration'}]},
    {id:'s3',text:'Add substrate, read activity at 405 nm, and normalize against the unheated control.',placeholders:[]},
    {id:'s4',text:'Record retained activity and return the remaining aliquots to box B2.',placeholders:[]}
  ],createdAt:at,updatedAt:at};
  state.protocols = [protocol,{...structuredClone(protocol),id:'hero-purify',name:'Affinity purification · His-tag',category:'Protein purification'},{...structuredClone(protocol),id:'hero-buffer',name:'Buffer B · preparation',category:'Solutions'}];
  const columns = ['Variant','Sample','Retained activity (%)','Observation'].map((title,i)=>({field:'c'+i,title}));
  const resultTable = {columns, rows:[['A17','PROT-017','92','Clear after heat challenge'],['B08','PROT-008','78','Slight haze'],['Wild type','PROT-001','61','Visible aggregation']].map((row,i)=>Object.fromEntries([['id','r'+i],...row.map((v,j)=>['c'+j,v])]))};
  const page = {id:'hero-page',notebookType:'biology',projectId:project.id,projectName:project.name,protocolId:protocol.id,protocolName:protocol.name,experimentName:'A17 · heat challenge at 42°C',experimentNameSource:'manual',protocolSnapshot:structuredClone(protocol),values:{sample:'A17 · PROT-017',temperature:'42°C',time:'30 min'},result:'A17 retained 92% activity after 30 min at 42°C and remained clear. Compare against wild type and B08 on Plate 04.\n\nAliquots: box B2, wells C4–C6. Repeat using an independent preparation.\n\nFictional demonstration data.',resultTable,resultTables:[resultTable],sampleLinks:[{id:'hero-link',sampleId:'hero-sample-0',sampleCode:'PROT-017',sampleName:'A17 · enzyme variant'}],assayIds:[],resultFiles:[],notebookState:'executed',executedAt:at,createdAt:at,updatedAt:at};
  state.notebookEntries=[page,{...structuredClone(page),id:'hero-page-2',experimentName:'Plate 04 · activity readout',result:'Triplicate activity measurements recorded. Fictional demo data.'},{...structuredClone(page),id:'hero-page-3',experimentName:'A17 · purification and aliquots',result:'Elution pool: 2.4 mg/mL. Aliquots stored in box B2.'}];
  const section='-20 Degree';
  state.settings.sampleInventoryLocations=[section,'4 Degree','-80 Degree','Liquid Nitrogen'];
  state.inventory = Object.fromEntries(state.settings.sampleInventoryLocations.map(x=>[x,[]]));
  const box={id:'hero-box',name:'B2 · enzyme variants',type:'customGrid',gridRows:8,gridCols:8,wells:Array.from({length:64},()=>({content:'',contents:[]})),createdAt:at,updatedAt:at};
  state.inventory[section]=[box,{...structuredClone(box),id:'hero-box-2',name:'B3 · reference stocks'}];
  state.samples = Array.from({length:28},(_,i)=>({id:'hero-sample-'+i,code:'PROT-'+String(i===0?17:i+20).padStart(3,'0'),name:i===0?'A17 · enzyme variant':i%4===0?'Wild-type reference':`Enzyme variant ${['B','C','D'][i%3]}${String(i+1).padStart(2,'0')}`,type:'protein',lot:'Screen 04',concentration:[2.4,1.8,2.1,3.0][i%4]+' mg/mL',notes:'Activity screen · fictional sample',details:{molecular_weight:'42',tag:'His6',buffer:'20 mM HEPES, 150 mM NaCl, pH 7.5',expression_host:'E. coli BL21(DE3)'},inventoryLink:{section,containerId:box.id,wellIndex:i===0?19:i===19?0:i},chemicalLinks:[],updatedAt:at}));
  const resultValues={};
  for(let r=0;r<8;r++) for(let c=1;c<=12;c++) resultValues[String.fromCharCode(65+r)+c]=String(Math.round((r<3?92:r<6?78:61)*(1-.032*(c-1))+((r*7+c*3)%9-4)));
  state.assays=[{id:'hero-plate',assayNumber:'AS-004',name:'Plate 04 · retained enzyme activity',projectId:project.id,notebookEntryId:'hero-page-2',plateType:'96',plateLabel:'96 well',plateRows:8,plateColumns:12,wellCount:96,sampleAxis:'row',concentrationAxis:'column',concentrationUnit:'µM',sampleAxisValues:['A17 · rep 1','A17 · rep 2','A17 · rep 3','B08 · rep 1','B08 · rep 2','B08 · rep 3','Wild type · rep 1','Wild type · rep 2'],concentrationAxisValues:['0','0.5','1','2','4','8','16','32','64','128','256','512'],manualWellOverrides:{},suppressedWells:[],resultValues,createdAt:at,updatedAt:at}];
  const blocks=[state.protocols[1],state.protocols[2],state.protocols[0]].map((p,i)=>({id:'hero-block-'+i,type:'protocol',protocolId:p.id,x:i*300,y:0}));
  const links=blocks.slice(1).map((b,i)=>({id:'hero-edge-'+i,fromBlockId:blocks[i].id,toBlockId:b.id}));
  const template={id:'hero-template',name:'Enzyme screening cycle',description:'Purify, prepare buffer, and compare retained activity.',blocks,links,createdAt:at,updatedAt:at};
  state.workflowTemplates=[template];
  state.workflows=[2,1,0].map((done,i)=>({id:'hero-workflow-'+i,name:['A17 · confirmatory run','B08 · buffer comparison','Wild type · reference'][i],templateId:template.id,projectId:project.id,blocks:structuredClone(blocks),links:structuredClone(links),notebookEntryIds:[page.id],entries:[{id:'hero-execution-'+i,name:'Run 0'+(i+1),activeBranchRootIds:[],stepStates:Object.fromEntries(blocks.map((b,j)=>[b.id,{status:j<done?'completed':'not_done',values:{sample:i?'B08':'A17',temperature:'42°C',time:'30 min'},result:j<done?'Recorded in notebook · fictional data.':'',resultFiles:[],resultFileRecords:[],notebookEntryId:j<done?page.id:'',assayIds:j<done?['hero-plate']:[],gelAnalysisIds:[],completedAt:j<done?at:'',updatedAt:at}])),createdAt:at,updatedAt:at}],createdAt:at,updatedAt:at}));
  state.journalClubs=[{id:'hero-club',name:'Landmark methods'}];
  state.papers=[
    {id:'hero-alphafold',title:'Highly accurate protein structure prediction with AlphaFold',fileName:'Jumper_2021_AlphaFold.pdf',doi:'10.1038/s41586-021-03819-2',pdfMetadata:{title:'Highly accurate protein structure prediction with AlphaFold',author:'John Jumper et al.'},pdfDataUrl:pdfs.alphafold},
    {id:'hero-click',title:'Copper-free click chemistry for dynamic in vivo imaging',fileName:'Baskin_2007_Click_chemistry.pdf',doi:'10.1073/pnas.0707090104',pdfMetadata:{title:'Copper-free click chemistry for dynamic in vivo imaging',author:'Jeremy M. Baskin et al.'},pdfDataUrl:pdfs.chemistry}
  ].map(p=>({...p,linkedType:'journal-club',linkedId:'hero-club',linkedName:'Landmark methods',ingestionStatus:'ready',createdAt:at,updatedAt:at,comments:[],highlights:[]}));
  let dnaSeed=17029;
  const sequence=Array.from({length:6120},()=>{dnaSeed=(Math.imul(dnaSeed,1664525)+1013904223)>>>0;return 'ACGT'[dnaSeed>>>30];}).join('');
  const features=[
    ['T7 promoter','promoter',120,260,1],['A17 enzyme','cds',320,1580,1],
    ['TEV–His6','cds',1580,1664,1],['T7 terminator','terminator',1710,1840,1],
    ['GFP reporter','cds',2080,2800,1],['p15A ori','rep_origin',3200,3750,1],
    ['KanR','cds',4100,4910,-1],['lacI','cds',5100,6070,-1]
  ].map(([name,type,start,end,strand],i)=>({id:'hero-feature-'+i,name,type,strand,segments:[{start,end}]}));
  const dnaRecords=['pA17-GFP · expression vector','pB08-GFP · comparison vector','pWT-GFP · reference vector'].map((name,i)=>{
    const record={name,sequence,topology:'circular',features:structuredClone(features)};
    const entry={id:'hero-dna-'+i,name,status:'saved',sequenceLength:sequence.length,featureCount:features.length,topology:'circular',createdAt:at,updatedAt:at};
    return {entry,gbkText:buildRecordGenbankText(record)};
  });
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  window.hikariApi = new Proxy({
    ensureStorageDirectory:async()=>({ok:true}),importStorageRoot:async()=>({ok:true,statePatch:{},summary:{}}),autoSaveDataFile:async()=>({ok:true}),
    agentChatLogListSessions:async()=>({ok:true,items:[]}),agentChatLogGetSession:async()=>({ok:true,messages:[]}),
    getCodexLlmStatus:async()=>({ok:true,loggedIn:false,source:'none',cliAvailable:true}),sequenceLibraryList:async()=>({ok:true,entries:dnaRecords.map(r=>r.entry),folders:[]}),sequenceLibraryGet:async({id})=>{const record=dnaRecords.find(r=>r.entry.id===id);return record?{ok:true,...record}:{ok:false};},listPaperFindingTasks:async()=>({ok:true,tasks:[]}),reportError(){}
  },{get:(obj,key)=>key in obj?obj[key]:undefined});
  installDialogLayout();
  const core=startHikariCore();
  const ready=await core.whenReady(); if(!ready.ok) throw Error('Renderer did not boot');
  document.getElementById('topbar-local-time').textContent='10:30';
  window.heroCore=core;
  return core;
}
