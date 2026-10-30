// Browser-only services for the actual desktop renderer. No native bridge,
// filesystem, accounts, research folders, or live model is connected.
(function () {
  'use strict';
  const params = new URLSearchParams(window.HikariTrialFrameParams || location.search);
  const capture = params.get('capture') === '1', feature = window.HikariTrialModel.resolveFeature(params.get('feature'), capture);
  const requestedFont=Number(params.get('fontSize'));
  // Polish's two cards span the whole window, so its capture uses a larger app text size to stay legible on the site.
  const initialFontSize=capture ? (feature==='agent-protocols' ? 17 : 14) : Number.isFinite(requestedFont) && requestedFont>=14 && requestedFont<=24
    ? requestedFont : window.parent===window && window.innerWidth
      ? window.HikariTrialModel.appFontSize(window.innerWidth,window.innerHeight) : window.HikariTrialModel.APP_FONT_SIZE;
  const APP_KEY = window.HikariTrialModel.appStateKey(feature, capture), APP_STATE = 'hikari_state_v1';
  if(capture)window.HikariTrialModel={...window.HikariTrialModel,KEY:'hikari-website-capture-usage-v1'};
  const storageGet = Storage.prototype.getItem, storageSet = Storage.prototype.setItem;
  if(capture)try{storageSet.call(localStorage,window.HikariTrialModel.KEY,JSON.stringify(window.HikariTrialModel.freshState()));}catch{}
  const root = '/demo/hikari', now = '2026-10-01T09:00:00.000Z';
  const steps = feature==='protocols' ? [
    {id:'demo-step-0',text:'Label an aliquot of {{ph:demo-ph-protein}}.',placeholders:[{id:'demo-ph-protein',name:'Protein'}]},
    {id:'demo-step-1',text:'Prepare {{ph:demo-ph-volume}} of buffer.',placeholders:[{id:'demo-ph-volume',name:'Volume'}]},
    {id:'demo-step-2',text:'Compare after {{ph:demo-ph-time}} and record the observation.',placeholders:[{id:'demo-ph-time',name:'Time'}]}
  ] : ['Label a tube for the example protein.', 'Prepare matching aliquots for the comparison.', 'Record the observation and attach the result.'].map((text, i) => ({ id: `demo-step-${i}`, text, placeholders: [] }));
  const protocol = { id: feature==='protocols'?'demo-protocol-fillable':'demo-protocol', name: feature==='protocols'?'Protein comparison · fillable template':'Protein comparison', category: 'Example methods', purpose: 'Compare fictional protein aliquots and keep a traceable record.', materials: ['Example protein', 'Example buffer', 'Labeled tubes'], steps, createdAt: now, updatedAt: now };
  // More methods to start a page from in the protocol trial. [Name] becomes a value each run fills in;
  // dated after the template so it stays first in the methods list.
  const moreProtocols = feature!=='protocols' ? [] : [
    ['miniprep','Plasmid miniprep','Molecular biology','Isolate plasmid DNA from an overnight E. coli culture.',['Overnight culture','Miniprep kit','Microcentrifuge'],[
      'Pellet [Culture volume] of overnight culture carrying [Plasmid] at 6,000 × g for 3 min.',
      'Resuspend, lyse, and neutralize the pellet in the kit’s buffer order.',
      'Bind the cleared lysate to the column, wash twice, and elute in [Elution volume].',
      'Record the DNA yield: [Concentration].']],
    ['pcr','PCR amplification','Molecular biology','Amplify a DNA fragment and confirm its size on a gel.',['Polymerase master mix','Nuclease-free water','Agarose gel'],[
      'Assemble a [Reaction volume] reaction with [Plasmid] as template and [Primers].',
      'Run [Cycles] cycles with annealing at [Annealing temperature].',
      'Check 5 µL of the product on a 1% agarose gel and note the band size.']],
    ['bradford','Bradford protein assay','Protein biochemistry','Estimate protein concentration against a BSA standard curve.',['BSA standard','Bradford reagent','96-well plate'],[
      'Prepare BSA standards from 0 to [Top standard].',
      'Dilute [Protein] [Dilution] in assay buffer.',
      'Mix 5 µL of each standard or sample with 250 µL of dye reagent and incubate for [Time].',
      'Read absorbance at 595 nm and calculate the concentration from the standard curve.']],
    ['sds-page','SDS-PAGE','Protein biochemistry','Check protein size and purity on a denaturing gel.',['Precast gel','Sample buffer','Protein ladder','Coomassie stain'],[
      'Mix [Protein] with sample buffer and heat at 95 °C for [Time].',
      'Load [Load amount] per lane on a [Gel percentage] gel beside a protein ladder.',
      'Run at [Voltage] until the dye front reaches the bottom of the gel.',
      'Stain, image, and note the size of the main band.']],
    ['passage','Passage adherent cells','Cell culture','Split a confluent flask and keep the passage count traceable.',['PBS','Trypsin-EDTA','Complete medium','T75 flasks'],[
      'Aspirate the medium from [Cell line] and rinse once with PBS.',
      'Add [Trypsin volume] of trypsin-EDTA and incubate at 37 °C until the cells detach.',
      'Neutralize with medium, count, and reseed at a [Split ratio] split.',
      'Label the new flasks with passage [Passage number].']],
    ['buffer','Buffer preparation','Solutions','Make a pH-adjusted buffer and record what went into it.',['Balance','pH meter','0.22 µm filter'],[
      'Dissolve [Mass] of [Reagent] in about 80% of [Final volume] of water.',
      'Adjust to pH [pH] at room temperature.',
      'Bring to volume, filter, and store at [Temperature].']],
    ['melting-point','Melting point check','Chemistry','Check the identity and purity of a solid compound.',['Capillary tubes','Melting point apparatus'],[
      'Dry and finely grind [Compound].',
      'Pack a capillary to [Fill height] and heat at [Ramp rate] near the expected melting point.',
      'Record the onset and clear-point temperatures: [Melting range].']]
  ].map(([key,name,category,purpose,materials,texts],i) => {
    const at = `2026-10-0${i+2}T09:00:00.000Z`;
    const steps = texts.map((text,j) => {
      const placeholders = [];
      return {text:text.replace(/\[([^\]]+)\]/g,(_,name) => {const id=`demo-ph-${key}-${j}-${placeholders.length}`;placeholders.push({id,name});return `{{ph:${id}}}`;}),placeholders};
    });
    return {id:`demo-method-${key}`,name,category,purpose,materials,steps,createdAt:at,updatedAt:at};
  });
  const project = { id: 'demo-project', name: 'Example enzyme project', description: 'Fictional trial records. All numbers are illustrative.', createdAt: now, updatedAt: now };
  const workflowScene = feature==='workflows' ? window.HikariTrialModel.workflowExample(project.name) : null;
  function page(id, name, notebookState = 'planned') {
    return { id, notebookType: 'biology', projectId: project.id, projectName: project.name, protocolId: protocol.id, protocolName: protocol.name, experimentName: name, experimentNameSource: 'manual', protocolSnapshot: structuredClone(protocol), values: {}, result: 'Example data for the browser trial.', resultTables: [], sampleLinks: [], resultFiles: [], createdAt: now, updatedAt: now, notebookState };
  }
  // Capture rows divide evenly, so the pending formulas read 40*D2 and 50000/E4, not 13-digit factors.
  const worksheetRows = capture ? [['KCl','74.55','','100','250'],['NaOH','40.00','','','1000'],['MgCl2·6H2O','203.3','2033','100',''],['Tris base','121.14','6057','','']] : [['KCl','74.55','','100','250'],['NaCl','58.44','','100','1000'],['Tris base','121.14','','500','100']];
  const worksheet = { columns: ['Entry', 'MW (g/mol)', 'Weight (mg)', 'Volume (mL)', 'Molarity (mM)'].map((title,i) => ({ field: `demo_molarity_${i}`, title })), rows: worksheetRows.map((row,i) => Object.fromEntries([['id', `demo-row-${i}`], ...row.map((v,j) => [`demo_molarity_${j}`,v])])), solve: true };
  const calc = { ...page('demo-calculations', 'Stock solution worksheet'), result: 'With two known values, the other two cells show simplified formulas. Fill a third value to calculate the fourth. Double-click a cell to edit it.', resultTable: worksheet, resultTables: [worksheet] };
  const protocolPage = { ...page('demo-protocol-fillable-page', 'Variant A comparison · run 01'), values:{'demo-ph-protein':'Variant A','demo-ph-volume':'200 µL','demo-ph-time':'15 min'}, result:'Clear solution; no precipitate.\nExample run: Variant A, 200 µL, 15 min.\nThis page keeps the method used for this run. Start a new experiment to reuse the template with fresh values.' };
  const samplePages=feature==='samples' ? [
    {...page('demo-sample-run-1','Enzyme comparison · run 01'),sampleLinks:[{id:'demo-sample-link',sampleId:'demo-sample-0',sampleCode:'PROT-001',sampleName:'Enzyme variant A'}],result:'Variant A retained 88% relative activity in this fictional comparison.'},
    {...page('demo-sample-run-2','Buffer comparison · run 02'),result:'Compare the same preparation in two example buffers.'}
  ] : [];
  const ideas = [
    ['Confirm the thermal shift', 'Variant A measured 59.4 °C against 53.0 °C for wild type on one example plate. Repeat with a fresh preparation before selecting the lead.'],
    ['Check retained activity', 'The example sample retains 82% activity after a short heat exposure. Compare matched heated and unheated aliquots in a time course.'],
    ['Compare purification fractions', 'An upper band appears in two example samples. Compare fresh fractions at equivalent loads before downstream experiments.']
  ].map(([title,rationale],i) => ({ ...page(`demo-suggestion-${i}`,title,'suggested'), agentDraftMeta: { source: 'agent', rationale, proposalId: `demo-proposal-${i}` }, result: rationale }));
  const boxSize = capture ? 9 : 5;
  const inventory = { 'Room Temp': [], '4 Degree': [], '-20 Degree': [{ id: 'demo-box', name: 'Example box', type: 'customGrid', gridRows: boxSize, gridCols: boxSize, wells: Array.from({length:boxSize*boxSize}, () => ({contents: []})), createdAt: now, updatedAt: now }], '-80 Degree': [], 'Liquid Nitrogen': [] };
  const samples = ['protein','plasmid','primer'].map((type,i) => ({ id: `demo-sample-${i}`, code: ['PROT-001','DNA-001','OLIGO-001'][i], name: ['Enzyme variant A','pDemo-GFP','GFP forward primer'][i], type, lot: 'Demo A', concentration: ['2 mg/mL','150 ng/µL','10 µM'][i], notes: ['Purification fraction 3 · comparison aliquot','Example plasmid preparation','Example oligo stock'][i], inventoryLink: {section:'-20 Degree', containerId:'demo-box', wellIndex:i}, chemicalLinks: [], location: {storageType:'freezer',freezer:'-20 Degree',box:'Example box',position:`W${i+1}`}, updatedAt:now }));
  // Capture only: a lived-in example box (one sample type per row) and a complete protein record.
  if (capture) {
    samples[0].details = { molecular_weight: '42', tag: 'His6', buffer: '20 mM Tris pH 7.5, 150 mM NaCl', expression_host: 'E. coli BL21(DE3)' };
    const place = (sample, well) => Object.assign(sample, { inventoryLink: {...sample.inventoryLink, wellIndex: well}, location: {...sample.location, position: `W${well+1}`} });
    place(samples[1], 9); place(samples[2], 18);
    [
      [1,'protein','PROT-002','Enzyme variant B','1.6 mg/mL'], [2,'protein','PROT-003','Enzyme variant C','2.4 mg/mL'],
      [3,'protein','PROT-004','Wild-type enzyme','3.1 mg/mL'], [4,'protein','PROT-005','Variant A · heat-treated','2 mg/mL'],
      [5,'protein','PROT-006','TEV protease','1 mg/mL'], [6,'protein','PROT-007','Variant B · fraction 4','0.8 mg/mL'],
      [10,'plasmid','DNA-002','pDemo-VarA','210 ng/µL'], [11,'plasmid','DNA-003','pDemo-VarB','185 ng/µL'],
      [12,'plasmid','DNA-004','pDemo-VarC','240 ng/µL'], [13,'plasmid','DNA-005','pDemo-WT','120 ng/µL'], [14,'plasmid','DNA-006','pDemo-TEV','160 ng/µL'],
      [19,'primer','OLIGO-002','GFP reverse primer','10 µM'], [20,'primer','OLIGO-003','Variant A mutagenesis F','10 µM'],
      [21,'primer','OLIGO-004','Variant A mutagenesis R','10 µM'], [22,'primer','OLIGO-005','T7 sequencing primer','10 µM'],
      [27,'strain','STR-001','Expression strain stock','Glycerol stock'], [28,'strain','STR-002','Cloning strain stock','Glycerol stock'],
      [29,'antibody','AB-001','Anti-His antibody','1 mg/mL']
    ].forEach(([well,type,code,name,concentration]) => samples.push(place({ id: `demo-capture-${code}`, code, name, type, lot: 'Demo A', concentration, notes: '', inventoryLink: {section:'-20 Degree', containerId:'demo-box'}, chemicalLinks: [], location: {storageType:'freezer',freezer:'-20 Degree',box:'Example box'}, updatedAt: now }, well)));
  }
  let appState;
  if(!capture)try { appState = JSON.parse(storageGet.call(localStorage, APP_KEY)); } catch {}
  if (!appState?.settings?.storagePath) appState = { projects:[project], protocols:[protocol], notebookEntries:feature==='calculations' ? [calc] : feature==='experiments' ? ideas : [], samples, inventory, settings: { storagePath:root, appearance:{fontSize:14,themeColor:'#ff6a3f',mode:'day',uiStyle:'neutral-compact'}, plugins:[{id:'gel',name:'Gel Analysis',version:'2.0.0',path:'@bundled/gel',enabled:false}], pluginStorage:{} } };
  // Fill missing examples in returning trials too. Preserve edits and usage.
  for (const [key, examples] of Object.entries({projects:[project], protocols:workflowScene?.protocols || [protocol, ...moreProtocols], samples, notebookEntries:workflowScene?.notebookEntries || (feature==='experiments'?ideas:feature==='calculations'?[calc]:feature==='protocols'?[protocolPage]:samplePages), ...(workflowScene ? {workflows:workflowScene.workflows,workflowTemplates:workflowScene.workflowTemplates} : {})})) {
    if (!Array.isArray(appState[key])) appState[key]=[];
    for (const example of examples) if (!appState[key].some(item=>item.id===example.id)) appState[key].push(structuredClone(example));
  }
  // Give new and returning visitors a two-known-value example. Leave existing
  // inputs, column units, saved formula-row edits, and try counts intact.
  if(feature==='calculations' && !capture) {
    const entry=appState.notebookEntries.find(item=>item.id==='demo-calculations');
    for(const table of new Set([...(entry?.resultTables || []),entry?.resultTable].filter(Boolean))) {
      if(!table.solve || !table.columns?.some(column=>column.field==='demo_molarity_4') || !Array.isArray(table.rows))continue;
      if(!table.rows.some(row=>row.id==='demo-formula-row'))table.rows.push({id:'demo-formula-row',demo_molarity_0:'Formula example',demo_molarity_1:'100',demo_molarity_2:'5',demo_molarity_3:'',demo_molarity_4:''});
    }
  }
  appState.inventory ??= inventory;
  appState.inventory['-20 Degree'] ??= [];
  if (!appState.inventory['-20 Degree'].some(box=>box.id==='demo-box')) appState.inventory['-20 Degree'].push(structuredClone(inventory['-20 Degree'][0]));
  // Compact the former 9 × 9 public example without discarding saved samples
  // or well notes. Keep occupied positions where possible; relocate outer
  // wells together with their sample links. Dense saved boxes retain enough room.
  const exampleBox=appState.inventory['-20 Degree'].find(box=>box.id==='demo-box');
  if(!capture && exampleBox.type==='customGrid' && exampleBox.gridRows===9 && exampleBox.gridCols===9) {
    const linkedSamples=appState.samples.filter(sample=>sample.inventoryLink?.section==='-20 Degree' && sample.inventoryLink.containerId===exampleBox.id && sample.inventoryLink.wellIndex!==null && sample.inventoryLink.wellIndex!=='' && Number.isInteger(Number(sample.inventoryLink.wellIndex)) && Number(sample.inventoryLink.wellIndex)>=0);
    const occupied=new Set(linkedSamples.map(sample=>Number(sample.inventoryLink.wellIndex)));
    exampleBox.wells.forEach((well,index)=>{
      const hasData=typeof well==='string' ? well.trim() : Object.entries(well || {}).some(([key,value])=>
        key==='name' ? value && value!==`W${index+1}` : Array.isArray(value) ? value.length : value!==null && value!==undefined && value!=='');
      if(hasData)occupied.add(index);
    });
    const size=Math.max(5,Math.ceil(Math.sqrt(occupied.size))), capacity=size*size;
    const reserved=new Set([...occupied].filter(index=>index<capacity)), moved=new Map();
    let destination=capacity-1;
    for(const index of [...occupied].filter(index=>index>=capacity).sort((a,b)=>b-a)) {
      while(reserved.has(destination))destination--;
      moved.set(index,destination);reserved.add(destination--);
    }
    const wells=Array.from({length:capacity},(_,index)=>exampleBox.wells[index] || {contents:[]});
    for(const [from,to] of moved) {
      const well=exampleBox.wells[from] || {contents:[]};
      wells[to]=typeof well==='object' && well.name===`W${from+1}` ? {...well,name:`W${to+1}`} : well;
    }
    for(const sample of linkedSamples) {
      const index=moved.get(Number(sample.inventoryLink.wellIndex));
      if(index===undefined)continue;
      sample.inventoryLink.wellIndex=index;
      sample.location={...sample.location,position:wells[index]?.name || `W${index+1}`};
    }
    Object.assign(exampleBox,{gridRows:size,gridCols:size,wells});
  }
  // Keep public trials readable after the host scales down the desktop canvas.
  // Capture scenes retain their original typography for the Product assets.
  appState.settings.appearance = {...appState.settings.appearance, mode:'day',fontSize:initialFontSize};
  // Returning trials may still list the example plugin that earlier versions shipped.
  appState.settings.plugins = (appState.settings.plugins || []).filter(p=>p.id!=='gel' && p.id!=='scientific-illustration');
  appState.settings.plugins.unshift({id:'gel',name:'Gel Analysis',version:'2.0.0',path:'@bundled/gel',serve:true,enabled:false});
  // Agent screenshots (capture only): fictional records plus prepared model replies.
  const agentScene = capture && window.HikariAgentScenes?.SCENES.includes(feature) ? window.HikariAgentScenes.build(feature, { now, project }) : null;
  if (agentScene) {
    for (const key of ['protocols', 'notebookEntries', 'papers', 'assays']) appState[key] = [...(appState[key] || []), ...structuredClone(agentScene[key])];
    appState.paperAgentChatSessions = structuredClone(agentScene.paperAgentChatSessions);
  }
  appState.settings.startup = { defaultViewId: agentScene ? agentScene.startView : feature === 'workflows' ? 'workflow-management-view' : ['cloning','protein-builder'].includes(feature) ? 'sequence-viewer-view' : feature === 'samples' ? 'sample-registry-view' : 'biology-notebook-view', rememberLastView: false };
  // Redirect only the desktop state key; preserve every other site storage key.
  Storage.prototype.getItem = function (key) { return this === localStorage && key === APP_STATE ? JSON.stringify(appState) : storageGet.call(this,key); };
  Storage.prototype.setItem = function (key,value) {
    if (this === localStorage && key === APP_STATE) {
      const next=JSON.parse(value);
      // Desktop serializers don't know browser-local sequence/file storage.
      for(const key of ['proteinBuilderTrial','trialSequenceDraft','trialLibrary','trialFiles','trialPageLogs']) {
        if(appState[key]!==undefined && (next[key]===undefined || ['trialLibrary','trialFiles','trialPageLogs'].includes(key)))next[key]=appState[key];
      }
      appState=next;try {storageSet.call(this,APP_KEY,JSON.stringify(appState));} catch {} return;
    }
    return storageSet.call(this,key,value);
  };
  const unavailable = () => Promise.resolve({ok:false,error:'This action is available in the Hikari desktop app.'});
  const library=()=>appState.trialLibrary ??= {entries:[],folders:[],backbones:[]};
  const copy=value=>structuredClone(value);
  const commit=()=>storageSet.call(localStorage,APP_KEY,JSON.stringify(appState));
  const find=id=>library().entries.find(entry=>entry.id===id);
  function featureSequence(entry,item) {
    const sequence=(item.segments || []).map(segment=>entry.sequence.slice(segment.start,segment.end)).join('');
    const complement={A:'T',T:'A',G:'C',C:'G',R:'Y',Y:'R',K:'M',M:'K',B:'V',V:'B',D:'H',H:'D',S:'S',W:'W',N:'N'};
    return item.strand===-1 ? [...sequence].reverse().map(base=>complement[base.toUpperCase()] || 'N').join('') : sequence;
  }
  const missing=()=>({ok:false,error:'This sequence is no longer in this trial’s library.'});
  let nextId=0;
  const id=()=>`trial-${Date.now().toString(36)}-${++nextId}`;
  function writeEntry(request={}) {
    const previous=find(request.id);
    if(!request.gbkText || !request.sequenceLength)return {ok:false,error:'Provide a sequence before saving.'};
    const entry={...previous,...copy(request),id:previous?.id || id(),name:String(request.name || 'Sequence'),
      status:request.status==='saved'?'saved':'temporary',updatedAt:new Date().toISOString()};
    delete entry.storagePath;
    const index=library().entries.findIndex(item=>item.id===entry.id);
    if(index<0)library().entries.push(entry);else library().entries[index]=entry;
    try{commit();}catch(error){if(index<0)library().entries.pop();else library().entries[index]=previous;return {ok:false,error:'Browser storage is full. Remove a trial attachment or restart this feature.'};}
    return {ok:true,entry:copy(entry),alignments:copy(entry.alignmentSessions || [])};
  }
  const api = {
    ensureStorageDirectory: async path => ({ok:true,path}),
    getLastStorageRoot: async () => ({storagePath:root}),
    importStorageRoot: async () => ({ok:true,recognized:true,statePatch:structuredClone(appState),summary:{},warnings:[]}),
    autoSaveDataFile: async () => ({ok:true}),
    getCodexLoginStatus: async () => ({ok:true,cliAvailable:false,canRefresh:false,loggedIn:false}),
    sequenceLibraryList: async ({status}={}) => ({ok:true,entries:copy(library().entries.filter(entry=>!status || status==='all' || entry.status===status)),folders:copy(library().folders)}),
    sequenceLibraryGet: async ({id}={}) => {const entry=find(id);return entry ? {ok:true,entry:copy(entry),gbkText:entry.gbkText,alignments:copy(entry.alignmentSessions || [])} : missing();},
    sequenceLibraryUpsert: async request => writeEntry(request),
    sequenceLibraryPromote: async ({id}={}) => {const entry=find(id);return entry ? writeEntry({...entry,status:'saved'}) : missing();},
    sequenceLibraryDelete: async ({id}={}) => {if(!find(id))return missing();library().entries=library().entries.filter(entry=>entry.id!==id);commit();return {ok:true};},
    sequenceLibraryUpsertFolder: async ({id:requestedId,name}={}) => {
      if(!String(name || '').trim())return {ok:false,error:'Enter a folder name.'};
      const folder=library().folders.find(item=>item.id===requestedId) || {id:id()};
      if(!library().folders.includes(folder))library().folders.push(folder);
      folder.name=String(name).trim();commit();return {ok:true,folder:copy(folder)};
    },
    sequenceLibraryDeleteFolder: async ({id}={}) => {library().folders=library().folders.filter(folder=>folder.id!==id);for(const entry of library().entries)if(entry.folderId===id)entry.folderId='';commit();return {ok:true};},
    sequenceLibraryMoveEntry: async ({id,folderId=''}={}) => {
      const entry=find(id);if(!entry)return missing();
      if(folderId && !library().folders.some(folder=>folder.id===folderId))return {ok:false,error:'Folder not found.'};
      return writeEntry({...entry,folderId});
    },
    sequenceLibrarySearchFeatures: async ({query='',limit=24}={}) => ({ok:true,results:library().entries.flatMap(entry=>(entry.features || []).map((item,index)=>({
      ...copy(item),id:`${entry.id}-${index}`,sequence:featureSequence(entry,item),
      sequenceLength:(item.segments || []).reduce((sum,segment)=>sum+segment.end-segment.start,0),hostCount:1,
      hosts:[{hostVectorId:entry.id,hostVectorName:entry.name}]
    }))).filter(item=>String(item.name || '').toLowerCase().includes(query.toLowerCase())).slice(0,limit)}),
    sequenceLibraryListBackbones: async () => ({ok:true,results:copy(library().backbones)}),
    sequenceLibraryUpsertBackbone: async ({backbone}={}) => {if(!backbone?.backboneSequence)return {ok:false,error:'Select a backbone first.'};const saved={...copy(backbone),id:backbone.id || id()};library().backbones=library().backbones.filter(item=>item.id!==saved.id);library().backbones.push(saved);commit();return {ok:true,backbone:copy(saved)};},
    listPaperFindingTasks: async () => ({ok:true,tasks:[]}),
    syncSqliteBundle: async () => ({ok:true}),
    agentChatLogListSessions: async () => ({ok:true,items:[]}),
    notebookPageLogAppend: async () => ({ok:true}),
    notebookPageLogList: async () => ({ok:true,events:[]}),
    appendNotebookPageLog: async event => {
      if(!event?.entryId)return {ok:false,error:'Notebook page is missing.'};
      (appState.trialPageLogs ??= []).push(copy(event));
      try{commit();return {ok:true};}catch{return {ok:false,error:'Browser storage is full.'};}
    },
    pickStorageDirectory: async () => ({ok:false,canceled:true}),
    storeImportedFile: async ({targetFolder,fileName,dataBase64}={}) => {
      if(!String(targetFolder || '').startsWith(root+'/') || !dataBase64)return {ok:false,error:'Choose a file to attach to this trial.'};
      const safeName=String(fileName || 'attachment').replace(/[\\/]/g,'_');
      const filePath=`${targetFolder}/${id()}-${safeName}`;
      const files=appState.trialFiles ??= {};
      files[filePath]={fileName:safeName,dataBase64};
      try{commit();}catch{delete files[filePath];return {ok:false,error:'This file exceeds available browser storage. Try a smaller file.'};}
      return {ok:true,fileName:safeName,filePath,relativePath:filePath.slice(root.length+1)};
    },
    readFileBase64: async path => {const file=appState.trialFiles?.[typeof path==='string'?path:path?.path];return file ? {ok:true,...copy(file)} : {ok:false,error:'File is not attached to this trial.'};},
    readFileBytes: async path => {const result=await api.readFileBase64(path);return result.ok ? {ok:true,bytes:Uint8Array.from(atob(result.dataBase64),c=>c.charCodeAt(0))} : result;},
    agentChat: unavailable
  };
  // Agent screenshots show Codex as connected and answer each model task with its prepared
  // reply. Only the scene's own fixture files can be read; everything else stays unavailable.
  if (agentScene) Object.assign(api, {
    getCodexLlmStatus: async () => ({ok:true,cliAvailable:true,loggedIn:true,source:'login',cliVersion:'demo'}),
    runDirectLlmPrompt: async request => agentScene.llm[request?.task] ? {ok:true,text:agentScene.llm[request.task]} : {ok:false,error:'This example has no prepared reply for that request.'},
    readFileBytes: async path => {
      const file = agentScene.files[typeof path === 'string' ? path : path?.path];
      if (!file) return {ok:false,error:'This action is available in the Hikari desktop app.'};
      const response = await fetch(new URL(file, document.baseURI));
      return response.ok ? {ok:true,bytes:new Uint8Array(await response.arrayBuffer())} : {ok:false,error:'Example file is missing.'};
    },
    discoverStoredPapers: async () => ({ok:true,papers:[],journalClubs:[]})
  });
  // Event subscriptions are no-ops; unsupported native actions fail explicitly.
  window.hikariApi = new Proxy(api,{get:(target,key) => key in target ? target[key] : typeof key === 'string' && /^on[A-Z]/.test(key) ? () => () => {} : unavailable});
  window.HikariBrowserTrial = {feature, capture, initialFontSize, APP_KEY, exampleProtocolId:protocol.id, agentScene, getState:()=>appState,
    allowsView:view=>capture || window.HikariTrialModel.featureViews(feature).includes(view)};
})();
