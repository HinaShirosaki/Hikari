(function (root) {
  'use strict';
  const LIMIT = 3, KEY = 'hikari-website-trial-v2', APP_FONT_SIZE = 20;
  // Safari exposes file:// in location.origin, but file messages have an
  // opaque origin. A file preview needs '*' for delivery and must still check
  // the exact parent/iframe window before accepting any message.
  function messageTargetOrigin(location) {
    return location.protocol === 'file:' || location.origin === 'file://' || location.origin === 'null' ? '*' : location.origin;
  }
  function isTrialMessage(event, source, location) {
    if (!source || event.source !== source) return false;
    return location.protocol === 'file:' || location.origin === 'file://'
      ? event.origin === 'null' || event.origin === location.origin
      : event.origin === location.origin;
  }
  // Compensate for preview scaling without outgrowing the desktop controls.
  function appFontSize(width, height, scale = 1) {
    const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    const ceiling = Math.floor(Math.max(14, Math.min(24, positive(width,1280)/64, positive(height,800)/40))*4)/4;
    return Math.min(ceiling, Math.max(14, Math.round(14/positive(scale,1)*4)/4));
  }
  const FEATURES = [
    { id: 'experiments', name: 'AI experiments', captureOnly: true, title: 'Plan the next experiment' },
    { id: 'cloning', name: 'Cloning & primers', title: 'From sequence to primer pair' },
    { id: 'protein-builder', name: 'Protein Builder', title: 'Build a protein. Prepare the sequence.' },
    { id: 'calculations', name: 'Bench calculations', title: 'Find the missing value' },
    { id: 'protocols', name: 'Protocol → notebook', title: 'Start a notebook page' },
    { id: 'workflows', name: 'Workflows', title: 'Repeat the process. Trace the run.' },
    { id: 'samples', name: 'Samples', title: 'Give a sample a place' },
    // Agent screenshots only: these need a live model, so the public Trial never lists them.
    // Capture mode opens each one with prepared model output (see trial-adapter.js).
    { id: 'agent-protocols', name: 'Agent · Protocols', captureOnly: true, title: 'Polish a protocol' },
    { id: 'agent-insights', name: 'Agent · Selection', captureOnly: true, title: 'Explain a selection' },
    { id: 'agent-papers', name: 'Agent · Papers', captureOnly: true, title: 'Ask about a paper' },
    { id: 'agent-plot', name: 'Agent · Plot', captureOnly: true, title: 'Plot assay results' },
    { id: 'agent-review', name: 'Agent · Review', captureOnly: true, title: 'Review agent drafts' }
  ];
  const PUBLIC_FEATURES = FEATURES.filter(feature => !feature.captureOnly);
  const DEFAULT_FEATURE = PUBLIC_FEATURES[0].id;
  function resolveFeature(id, capture = false) {
    return (capture ? FEATURES : PUBLIC_FEATURES).find(feature => feature.id === id)?.id || DEFAULT_FEATURE;
  }
  function featureViews(id) {
    return ({cloning:['sequence-viewer-view','sequence-viewer-detail-view'],
      'protein-builder':['sequence-viewer-view','sequence-viewer-detail-view'],
      calculations:['biology-notebook-view'], protocols:['biology-notebook-view','protocol-management-view'],
      workflows:['workflow-management-view','biology-notebook-view'],
      samples:['sample-registry-view','personal-inventory-view']})[id] || [];
  }
  function parseCsv(text) {
    const rows=[];let row=[],cell='',quoted=false;
    const source=String(text).replace(/^\uFEFF/,'');
    for(let i=0;i<source.length;i++) {
      const c=source[i];
      if(c==='"') {if(quoted && source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(c===',' && !quoted){row.push(cell);cell='';}
      else if((c==='\n' || c==='\r') && !quoted){row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';if(c==='\r' && source[i+1]==='\n')i++;}
      else cell+=c;
    }
    if(quoted)throw new Error('CSV contains an unclosed quoted field.');
    row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
    return rows;
  }
  const freshState = () => ({ version: 2, uses: Object.fromEntries(FEATURES.map(f => [f.id, 0])) });
  function normalizeState(raw) {
    const state = freshState();
    if (raw?.version === 2) for (const f of FEATURES) state.uses[f.id] = Math.max(0, Math.min(LIMIT, Math.floor(Number(raw.uses?.[f.id]) || 0)));
    return state;
  }
  function appStateKey(feature, capture = false) {
    return (capture ? 'hikari-website-capture-v1/' : 'hikari-website-app-v3/') + resolveFeature(feature, capture);
  }
  function resetFeature(storage, feature) {
    if (!PUBLIC_FEATURES.some(item => item.id === feature)) throw new Error('Unknown trial feature.');
    let raw;
    const saved = storage.getItem(KEY);
    try { raw = JSON.parse(saved); } catch {}
    const usage = normalizeState(raw);
    usage.uses[feature] = 0;
    storage.removeItem(appStateKey(feature));
    storage.setItem(KEY, JSON.stringify(usage));
    return usage;
  }
  function consumeTry(state, id) {
    if (!FEATURES.some(f => f.id === id)) throw new Error('Unknown trial feature.');
    if (state.uses[id] >= LIMIT) throw new Error('All three tries for this feature have been used.');
    state.uses[id] += 1;
    return LIMIT - state.uses[id];
  }
  function nextSuggestionId(entries) {
    const examples = entries.filter(entry => entry.id?.startsWith('demo-suggestion-'));
    return (examples.find(entry => entry.notebookState === 'suggested') || examples[0])?.id;
  }
  function cloningExample() {
    let seed=7189;
    const flank=length=>Array.from({length},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return 'ACGT'[seed>>>30];}).join('');
    const original=flank(198)+'GCT'+flank(198);
    return {original,variant:original.slice(0,198)+'GGT'+original.slice(201)};
  }
  function proteinBuilderExample() {
    return {constructName:'Example protein–GS–TEV–6×His',codonUsageProfile:'ecoli',buildDna:false,rows:[
      {id:'builder_row_1',kind:'custom',type:'custom',label:'Example protein',sequence:'MVEAKKLEAAGADVVVTNPKAEVLEKAGVEVVEAPGKTKAKVEAVKAGADVVVAGPKAEVLEKAGVEVVEAPGKTKAKVEAVKAG',note:'Fictional trial protein.'},
      {id:'builder_row_2',kind:'library',type:'linker',libraryId:'g4s',label:'GS Linker (G4S)',sequence:'GGGGS'},
      {id:'builder_row_3',kind:'library',type:'cleavage',libraryId:'tev',label:'TEV',sequence:'ENLYFQG'},
      {id:'builder_row_4',kind:'library',type:'tag',libraryId:'his6',label:'6×His',sequence:'HHHHHH'}
    ]};
  }
  function workflowExample(projectName = 'Example enzyme project') {
    const at = day => `2026-10-${String(day).padStart(2,'0')}T12:00:00.000Z`;
    const protocols = [
      ['grow','Grow cells','Label the culture {{ph:sample}}.'],
      ['purify','Purify protein','Collect {{ph:volume}} from {{ph:sample}}.'],
      ['measure','Measure activity','Compare the activity of {{ph:sample}} with the reference.'],
      ['archive','Archive aliquots','Label and store aliquots from {{ph:sample}}.'],
      ['qc','Check purity','Record the purity check for {{ph:sample}}.']
    ].map(([id,name,text]) => ({id:'demo-'+id,name,category:'Example workflow methods',purpose:'Fictional browser-trial method.',materials:[],steps:[{id:'demo-'+id+'-step',text,placeholders:[{id:'sample',name:'Sample'},...(id==='purify'?[{id:'volume',name:'Elution volume'}]:[])]}],createdAt:at(1),updatedAt:at(1)}));
    const blocks = protocols.map((p,i) => ({id:'b'+i,type:'protocol',protocolId:p.id,x:i===4?300:i*300,y:i===4?220:0}));
    const links = [[0,1],[1,2],[2,3],[1,4]].map(([from,to],i) => ({id:'link'+i,fromBlockId:'b'+from,toBlockId:'b'+to}));
    const template = {id:'demo-template',name:'Protein production',description:'Grow, purify, measure, and archive each batch.',blocks,links,createdAt:at(1),updatedAt:at(1)};
    const notebookEntries = [];
    const workflows = [4,2,1].map((completed,i) => {
      const start = [2,6,9][i], name = 'Run 0'+(i+1), id = 'demo-run-'+(i+1), entryId = 'entry-'+i;
      const stepStates = Object.fromEntries(blocks.map((block,j) => {
        const done = j<completed, protocol = protocols[j], notebookId = done ? `demo-notebook-${i}-${j}` : '';
        const result = !done ? '' : j===1 ? 'Clear eluate; 3.8 mg/mL protein. Aliquot saved for the activity assay.' : j===2 ? 'Relative activity: 92% at 25 °C. Example data only.' : 'Completed and recorded in the notebook.';
        const values = {sample:['Batch A','Batch B','Batch C'][i],volume:'2.5 mL'};
        if(done) notebookEntries.push({id:notebookId,notebookType:'biology',projectId:'demo-project',projectName,protocolId:protocol.id,protocolName:protocol.name,experimentName:`${name} · ${protocol.name}`,experimentNameSource:'manual',protocolSnapshot:structuredClone(protocol),values:{...values},result,resultFiles:[],resultTables:[],sampleLinks:[],notebookState:'executed',executedAt:at(start+j),createdAt:at(start),updatedAt:at(start+j),workflowContext:{workflowId:id,workflowName:name,workflowEntryId:entryId,workflowEntryName:name,workflowBlockId:block.id,workflowBlockTitle:protocol.name}});
        return [block.id,{status:done?'completed':'not_done',values,result,resultFiles:[],resultFileRecords:[],notebookEntryId:notebookId,assayIds:[],gelAnalysisIds:[],completedAt:done?at(start+j):'',updatedAt:at(start+Math.min(j,completed-1))}];
      }));
      return {id,templateId:template.id,name,projectId:'demo-project',blocks:structuredClone(blocks),links:structuredClone(links),notebookEntryIds:notebookEntries.filter(page=>page.workflowContext.workflowId===id).map(page=>page.id),entries:[{id:entryId,name,activeBranchRootIds:[],stepStates,createdAt:at(start),updatedAt:at(start+completed-1)}],createdAt:at(start),updatedAt:at(start+completed-1)};
    });
    return {protocols,workflowTemplates:[template,{...structuredClone(template),id:'demo-other',name:'Culture expansion'}],workflows,notebookEntries};
  }
  const api = { LIMIT, KEY, APP_FONT_SIZE, messageTargetOrigin, isTrialMessage, appFontSize, FEATURES, PUBLIC_FEATURES, DEFAULT_FEATURE, resolveFeature, featureViews, parseCsv, freshState, normalizeState, appStateKey, resetFeature, consumeTry, nextSuggestionId, cloningExample, proteinBuilderExample, workflowExample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HikariTrialModel = api;
})(typeof window === 'undefined' ? globalThis : window);
