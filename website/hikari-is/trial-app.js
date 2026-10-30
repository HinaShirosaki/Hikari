import { startHikariCore } from './runtime/src/renderer/core/start-hikari-core.js';
import { APP_REGISTRY } from './runtime/src/renderer/modules/app-registry.generated.js';
import { installIconButtonCaptions } from './runtime/src/renderer/app/icon-button-captions.js';
import { installDialogLayout } from './runtime/src/renderer/app/dialog-layout.js';
import { installSearchFieldLens, runSearchInput } from './runtime/src/renderer/lib/search-field-lens.js';
import { createSequenceViewerCloningDesignController } from './runtime/src/renderer/modules/sequence-viewer/cloning-design.js';
import { buildSequenceEditDesignSource } from './runtime/src/renderer/modules/sequence-viewer/runtime/sequence-edit-helpers.js';
import { createSequenceViewerProteinBuilderController } from './runtime/src/renderer/modules/sequence-viewer/protein-builder.js';
import { getSequenceViewerElements } from './runtime/src/renderer/modules/sequence-viewer/dom.js';
import { setSharedLeftRailWidth } from './runtime/src/renderer/app/shared-left-rail.js';
import { buildRecordGenbankText } from './runtime/src/renderer/modules/sequence-viewer/storage.js';
import { reverseTranslateProteinSequence } from './runtime/src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { buildNotebookSampleLinkMetadata } from './runtime/src/renderer/modules/biology-notebook/samples/sample-helpers.js';
import { buildPrimerOrderCsv } from './runtime/src/renderer/modules/sequence-viewer/primer-order.js';
// The worksheet bundle excludes controllers used only by other demos.
const CALCULATIONS_ONLY = typeof __HIKARI_TRIAL_CALCULATIONS_ONLY__ !== 'undefined' && __HIKARI_TRIAL_CALCULATIONS_ONLY__;
const { feature } = window.HikariBrowserTrial, M = window.HikariTrialModel;
const savedProteinConstruct = window.HikariBrowserTrial.getState().proteinBuilderTrial;
const trialNavigationView = window.HikariBrowserTrial.getState().settings.startup.defaultViewId;
// Scope the native dock before it is created, so resize cannot restore desktop
// modules or put the current feature in an otherwise empty overflow menu.
if (!window.HikariBrowserTrial.capture) {
  const label = M.PUBLIC_FEATURES.find(item => item.id === feature).name;
  for (const app of APP_REGISTRY) {
    app.hiddenFromNavigation = app.viewId !== trialNavigationView;
    if (!app.hiddenFromNavigation) app.label = label;
  }
}
const runtime = startHikariCore();
let returnToFeature=()=>runtime.navigationShell.showView(trialNavigationView);
installIconButtonCaptions(); installDialogLayout(); installSearchFieldLens();
const $ = id => document.getElementById(id);
let pending = false, cloneController = null, cloningState = {};
let proteinController = null, persistProteinConstruct = () => {};
function tell(type, extra = {}) { if (parent !== window) parent.postMessage({type:`hikari-trial:${type}`,feature,...extra},M.messageTargetOrigin(location)); }
function complete() { tell('action-complete'); }
function notice(text) { tell('status',{message:text}); }
const selectors = {
  experiments: '#biology-notebook-take-into-plan-btn',
  calculations: '#save-biology-notebook-btn',
  protocols: '#biology-notebook-experiment-start-btn, #biology-notebook-new-experiment-btn',
  workflows: '[data-workflow-step-status="completed"]',
  samples: '[data-well-sample-create], [data-well-sample-save], [data-single-sample-create], [data-single-sample-save]',
  cloning: '#sequence-viewer-cloning-design-run-btn',
  'protein-builder': '#sequence-viewer-protein-builder-build-dna-btn'
};
// Report validated native actions to the walkthrough; actions are unlimited.
function signature(kind) {
  const state = runtime.state;
  if (kind === 'experiments') return state.notebookEntries.filter(e=>e.notebookState==='planned' && e.id.startsWith('demo-suggestion')).length;
  if (kind === 'protocols') return $('biology-notebook-experiment-dialog-overlay').hidden;
  if (kind === 'samples') return JSON.stringify(state.samples);
  if (kind === 'calculations') return JSON.stringify(state.notebookEntries.find(e=>e.id==='demo-calculations'));
  if (kind === 'workflows') return state.workflows.reduce((count,workflow)=>count+workflow.entries.reduce((sum,entry)=>sum+Object.values(entry.stepStates).filter(step=>step.status==='completed').length,0),0);
}
function watchSuccess(kind,before) {
  pending = true; const began = performance.now();
  const check = () => {
    if (signature(kind) !== before) { pending = false; complete(); return; }
    if (performance.now()-began > (['samples','protocols'].includes(kind) ? 200 : 3500)) { pending = false; return; }
    setTimeout(check,50);
  };
  setTimeout(check,0);
}
function action(event) {
  const target = event.target.closest?.('button');
  if (!target) return;
  const kinds = Object.entries(selectors).filter(([id])=>id===feature);
  if (!kinds.some(([,selector])=>target.matches(selector))) return;
  if (feature==='protocols' && target.id==='biology-notebook-experiment-start-btn') return; // Count the form's validated submit.
  if (feature==='protocols' && target.id==='biology-notebook-new-experiment-btn') return;
  if (feature === 'cloning') {
    event.preventDefault(); event.stopImmediatePropagation(); cloneController.designPrimers();
    if (cloningState.cloningDesign?.displayPlan?.feasible) {complete();notice('Primer design complete.');}
    return;
  }
  if (feature === 'protein-builder') {
    event.preventDefault(); event.stopImmediatePropagation();
    const built = proteinController.trialBuildDna();
    persistProteinConstruct();
    if (built.ok && built.sequence) {
      complete();
      notice('Coding DNA built. You can copy either sequence.');
    }
    return;
  }
  if (feature !== 'cloning') watchSuccess(feature,signature(feature));
}
// Opens a capture-only Agent scene the way a reader would: real clicks and hovers on Hikari's
// own controls. Model replies come from agent-scenes.js through the browser adapter.
async function openAgentScene(scene) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test, label) => {
    for (let i = 0; i < 300; i++) { const value = test(); if (value) return value; await pause(50); }
    throw new Error(`Agent scene ${feature} did not reach: ${label}`);
  };
  const modules = runtime.moduleRuntime.modules;
  const railItems = () => document.querySelectorAll('#universal-agent-chat-rail .agent-chat-item');
  async function openRail() {
    const toggle = await until(() => { const button = $('agent-chat-rail-toggle-btn'); return button && !button.hidden && button; }, 'agent rail toggle');
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    await until(() => document.body.classList.contains('has-agent-chat-rail-expanded') && railItems().length, 'agent rail history');
  }
  await until(() => document.body.dataset.agentAvailability === 'connected', 'Codex connection');
  if (feature === 'agent-protocols') {
    document.querySelector('[data-protocol-select="demo-protocol-rough"]').click();
    (await until(() => $('protocol-view-edit-btn')?.offsetParent && $('protocol-view-edit-btn'), 'protocol view')).click();
    await until(() => !$('protocol-editor-panel').hidden, 'protocol editor');
    $('protocol-polish-btn').click();
    await until(() => !$('protocol-polish-overlay').hidden && $('protocol-polish-result-preview').textContent.includes('His-Tag Purification'), 'polished protocol');
  }
  if (feature === 'agent-insights') {
    // Saved highlights are drawn once the protocol panel is already in view mode.
    document.querySelector('[data-protocol-select="demo-protocol"]').click();
    await pause(300);
    document.querySelector('[data-protocol-select="demo-protocol-his"]').click();
    const anchor = await until(() => document.querySelector('[data-selection-insight-anchor-id="demo-insight-imidazole"]'), 'saved selection');
    anchor.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await until(() => document.querySelector('.selection-insight-panel:not([hidden])'), 'saved answer');
  }
  if (feature === 'agent-papers') {
    document.querySelector('[data-paper-view="demo-paper-lipase"]').click();
    await until(() => !$('paper-viewer-stage').hidden && document.querySelector('#paper-viewer-workspace canvas'), 'paper page');
    await openRail();
    // Bring the latest answer into view with the rail's own Latest button.
    await pause(300);
    document.querySelector('#universal-agent-chat-rail .agent-scroll-to-bottom-btn:not([hidden])')?.click();
    await pause(400);
    // Frame the source passage next to its answer, rather than cropping the title page.
    const pageInput=$('paper-viewer-page-input');
    pageInput.value='2';pageInput.dispatchEvent(new Event('change',{bubbles:true}));
    const methods=await until(()=>[...document.querySelectorAll('#paper-viewer-page-layer span')].find(span=>span.textContent==='4. Methods' && span.getBoundingClientRect().height), 'Methods text layer');
    const stage=$('paper-viewer-stage');
    stage.scrollTop+=methods.getBoundingClientRect().top-stage.getBoundingClientRect().top-64;
    await pause(200);
  }
  if (feature === 'agent-plot') {
    $('assay-mode-results-btn').click();
    const select = await until(() => $('assay-results-assay-select'), 'assay picker');
    await pause(800);
    if (select.value !== 'demo-assay-inhibition') {
      select.value = 'demo-assay-inhibition';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(800);
    }
    await until(() => !$('assay-analysis-panel').hidden, 'assay analysis');
    await openRail();
    await until(() => window.Plotly, 'Plotly');
    if (!modules.assay.renderAgentPlotlyGraph(scene.plot)) throw new Error('Agent scene agent-plot could not draw its chart.');
    const chart = await until(() => document.querySelector('[data-assay-agent-plotly-chart] .main-svg'), 'agent chart');
    // Start the analysis column at its top, where the chart card begins, once the layout settles.
    for (const delay of [500, 300]) {
      await pause(delay);
      for (let node = chart.parentElement; node; node = node.parentElement) if (node.scrollTop) node.scrollTop = 0;
    }
  }
  if (feature === 'agent-review') {
    modules.biologyNotebook.openEntry(scene.openEntry);
    await openRail();
    (await until(() => document.querySelector('#universal-agent-chat-rail [data-agent-review-message]'), 'draft card')).click();
    await until(() => [...document.querySelectorAll('[id$="review-overlay"]')].some(overlay => !overlay.hidden), 'review overlay');
  }
}
document.addEventListener('click',action,true);
document.addEventListener('submit',event => {
  if (feature==='protocols' && event.target.id==='biology-notebook-experiment-form') {
    if (pending) return; // Its button click is already being observed.
    watchSuccess('protocols',signature('protocols'));
  }
},true);
await runtime.whenReady().then(result => {
  if(!result.ok) { notice('This trial could not open. Reload the page to try again.'); throw result.error; }
});
if (document.body) {
document.body.dataset.trialFeature = feature;
document.documentElement.dataset.windowChrome = 'mac';
if(!window.HikariBrowserTrial.capture)setSharedLeftRailWidth(360,{persist:false});
// Reaffirm the selected workspace after the desktop's startup preferences run.
runtime.navigationShell.showView(window.HikariBrowserTrial.initialViewId);
document.querySelector('.app-shell').inert=false;
const notebook = runtime.moduleRuntime.modules.biologyNotebook;
if (feature==='experiments') notebook.openEntry(M.nextSuggestionId(runtime.state.notebookEntries));
if (feature==='calculations') {
  notebook.openEntry('demo-calculations');
  requestAnimationFrame(()=>{$('biology-notebook-result-table')?.scrollIntoView({block:'center'});});
}
if (feature==='protocols') {
  const last=runtime.state.notebookEntries.at(-1);
  if(last)notebook.openEntry(last.id);
  else notebook.openExperimentDialog({projectId:'demo-project'});
}
if (feature==='samples') {
  document.querySelector('[data-inventory-section="-20 Degree"]')?.click();
  document.querySelector('[data-container-open="demo-box"]')?.click();
  document.querySelector('[data-container-id="demo-box"][data-well-index="0"]')?.click();
  // Keep the sample's experiment context inside this feature, without opening
  // the entire Notebook workspace. Links use Hikari's real record schema.
  function bindSampleExperimentLinks() {
    if(window.HikariBrowserTrial.capture)return;
    const editor=document.querySelector('.well-side-editor');
    const save=editor?.querySelector('[data-well-sample-save], [data-single-sample-save]');
    if(!save || editor.querySelector('.trial-sample-links'))return;
    const sample=runtime.state.samples.find(item=>item.id===(save.dataset.wellSampleSave || save.dataset.singleSampleSave));
    if(!sample)return;
    const details=document.createElement('details');details.className='trial-sample-links';
    const summary=document.createElement('summary');summary.textContent='Experiment links';details.append(summary);
    const list=document.createElement('div');details.append(list);
    const label=document.createElement('label');label.textContent='Link to experiment';
    const select=document.createElement('select');select.setAttribute('aria-label','Link to experiment');
    for(const entry of runtime.state.notebookEntries)select.add(new Option(entry.experimentName,entry.id));
    label.append(select);details.append(label);
    const link=document.createElement('button');link.type='button';link.className='ghost-btn';link.textContent='Link sample';details.append(link);
    function renderLinks() {
      list.replaceChildren();
      const entries=runtime.state.notebookEntries.filter(entry=>entry.sampleLinks?.some(item=>item.sampleId===sample.id));
      if(!entries.length){const text=document.createElement('p');text.className='small-note';text.textContent='No linked experiments yet.';list.append(text);}
      for(const entry of entries) {
        const item=document.createElement('details'),title=document.createElement('summary'),notes=document.createElement('p');
        title.textContent=entry.experimentName;notes.textContent=entry.result;notes.className='small-note';item.append(title,notes);list.append(item);
      }
    }
    link.addEventListener('click',()=>{
      const entry=runtime.state.notebookEntries.find(item=>item.id===select.value);
      if(!entry || entry.sampleLinks?.some(item=>item.sampleId===sample.id))return;
      entry.sampleLinks ??= [];entry.sampleLinks.push(buildNotebookSampleLinkMetadata({sample,inventory:runtime.state.inventory}));
      entry.updatedAt=new Date().toISOString();
      localStorage.setItem('hikari_state_v1',JSON.stringify(runtime.state));renderLinks();
    });
    editor.append(details);renderLinks();
  }
  const sampleContextObserver=new MutationObserver(bindSampleExperimentLinks);
  sampleContextObserver.observe($('inventory-sections'),{childList:true,subtree:true});bindSampleExperimentLinks();
}
if(!CALCULATIONS_ONLY && !window.HikariBrowserTrial.capture && ['cloning','protein-builder'].includes(feature)) {
  const download=document.createElement('button');download.type='button';download.className='ghost-btn';download.textContent='Download CSV';
  download.addEventListener('click',()=>{
    const rows=$('sequence-viewer-primer-order-preview').value.split('\n').filter(Boolean).map(line=>{const [name,sequence]=line.split('\t');return {name,sequence};});
    const csv=buildPrimerOrderCsv(rows,{scale:$('sequence-viewer-primer-order-scale').value,purification:$('sequence-viewer-primer-order-purification').value});
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='hikari-example-primers.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('sequence-viewer-primer-order-copy-csv').after(download);
}
if (feature==='workflows') {
  const workflow = runtime.moduleRuntime.modules.workflowManagement;
  const openWorkflow = () => {
    runtime.navigationShell.showView('workflow-management-view');
    workflow.openProcess('demo-run-2');
    // Keep unfinished timeline dots visible until the visitor opens a step.
    if(!window.HikariBrowserTrial.capture)document.querySelector('[data-workflow-drawer-close]')?.click();
  };
  openWorkflow();
  const back = document.createElement('button');
  back.id='trial-workflow-back';back.type='button';back.className='ghost-btn trial-workflow-back';
  back.textContent='← Back to workflow';
  back.addEventListener('click',()=>runtime.navigationShell.showView('workflow-management-view'));
  document.querySelector('.biology-notebook-viewer-actions').prepend(back);
  $('biology-notebook-result').readOnly=true;
}
if (!CALCULATIONS_ONLY && !window.HikariBrowserTrial.capture && ['cloning','protein-builder'].includes(feature)) {
  // A small fictional local library exercises the same native search/save/assembly code.
  if(!window.HikariBrowserTrial.getState().trialLibrary?.seeded) {
    const dna=reverseTranslateProteinSequence(M.proteinBuilderExample().rows[0].sequence,{organism:'ecoli'}).dna;
    const record={name:'pDemo enzyme · example source',sequence:M.cloningExample().original+dna,topology:'circular',features:[
      {id:'demo-enzyme-cds',name:'Example enzyme',type:'CDS',strand:1,segments:[{start:399,end:399+dna.length}]}]};
    await window.hikariApi.sequenceLibraryUpsert({...record,status:'saved',sequenceLength:record.sequence.length,featureCount:1,gbkText:buildRecordGenbankText(record)});
    await window.hikariApi.sequenceLibraryUpsertBackbone({backbone:{id:'demo-backbone',name:'pDemo backbone',backboneName:'pDemo backbone',
      sourceKind:'recognized_backbone',topology:'circular',variantMode:'gibson',backboneSequence:M.cloningExample().original,
      backboneLength:399,insertionOffset:198,features:[]}});
    window.HikariBrowserTrial.getState().trialLibrary.seeded=true;
  }
}
if (!CALCULATIONS_ONLY && feature==='protein-builder') {
  // Replace nodes already bound by the desktop module before attaching the
  // standalone controller. A palette click must add exactly one block.
  for (const id of ['sequence-viewer-protein-builder-workspace','sequence-viewer-protein-builder-add-protein-overlay']) {
    const el=$(id);el.replaceWith(el.cloneNode(true));
  }
  const elements=getSequenceViewerElements(document);
  // Cloning the workspace also clones the lens markup without its listener.
  elements.proteinBuilderWorkspace.querySelectorAll('.search-field__lens').forEach(button=>button.addEventListener('click',()=>runSearchInput(button.parentElement.querySelector('input'))));
  elements.homeWorkspace.hidden=true;
  elements.detailWorkspace.hidden=true;
  elements.proteinBuilderWorkspace.hidden=false;
  const sequenceViewer=runtime.moduleRuntime.modules.sequenceViewer;
  const showBuilder=()=>{
    runtime.navigationShell.showView('sequence-viewer-view');
    elements.homeWorkspace.hidden=true;elements.detailWorkspace.hidden=true;
    $('sequence-viewer-cloning-design-workspace').hidden=true;
    elements.proteinBuilderWorkspace.hidden=false;
  };
  returnToFeature=showBuilder;
  proteinController=createSequenceViewerProteinBuilderController({elements,hasStoragePath:()=>true,
    getBridge:()=>window.hikariApi,getStoragePath:()=>runtime.state.settings.storagePath,
    state:runtime.state,persist:()=>localStorage.setItem('hikari_state_v1',JSON.stringify(runtime.state)),
    createId:()=>`trial-notebook-${Date.now()}`,onNavigateHome:showBuilder,onNavigateBuilder:showBuilder,
    loadExternalRecord:(payload,options)=>{persistProteinConstruct();sequenceViewer.loadFromExternal(payload,options);}
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#sequence-viewer-cloning-design-back-btn, #sequence-viewer-protein-builder-confirmation-back-btn'))return;
    event.preventDefault();event.stopImmediatePropagation();showBuilder();
  },true);
  proteinController.bindEvents();
  const draft=savedProteinConstruct && Array.isArray(savedProteinConstruct.rows) ? savedProteinConstruct : M.proteinBuilderExample();
  // Removed blocks can leave holes in saved IDs; loading starts its counter at
  // the row count, so give restored rows sequential IDs before adding more.
  proteinController.loadMcpConstruct({...draft,rows:draft.rows.map((row,index)=>({...row,id:`builder_row_${index+1}`}))});
  persistProteinConstruct=()=>{
    runtime.state.proteinBuilderTrial=proteinController.trialSnapshot();
    try {localStorage.setItem('hikari_state_v1',JSON.stringify(runtime.state));} catch {}
  };
  const saveAfterEdit=()=>setTimeout(()=>{persistProteinConstruct();},0);
  for(const name of ['input','change','click','submit']) {
    elements.proteinBuilderWorkspace.addEventListener(name,saveAfterEdit);
    elements.proteinBuilderAddProteinOverlay.addEventListener(name,saveAfterEdit);
  }
  persistProteinConstruct();
}
if (!CALCULATIONS_ONLY && feature==='cloning' && !window.HikariBrowserTrial.capture) {
  const sequenceViewer=runtime.moduleRuntime.modules.sequenceViewer;
  const editor=sequenceViewer.trialSequence;
  returnToFeature=()=>editor.returnToDetail();
  cloneController=editor.cloningDesign;
  cloningState=editor.snapshot().state;
  const savedDraft=window.HikariBrowserTrial.getState().trialSequenceDraft;
  sequenceViewer.loadFromExternal(savedDraft?.record || {name:'Example fragment · 399 bp',sequence:M.cloningExample().original,topology:'circular',features:[]});
  if(savedDraft?.source && savedDraft.source.editedSequence===savedDraft.record.sequence)cloningState.sequenceEditDesignSource=savedDraft.source;
  if(savedDraft?.entryId && window.HikariBrowserTrial.getState().trialLibrary?.entries.some(entry=>entry.id===savedDraft.entryId)) {
    cloningState.activeEntryId=savedDraft.entryId;cloningState.activeEntryStatus=savedDraft.entryStatus;
  }
  // Desktop selection prevents default mousedown behavior. In an iframe that
  // also prevents keyboard focus from entering the DNA editor unless explicit.
  const sequenceHost=$('sequence-viewer-sequence-host');
  sequenceHost.tabIndex=0;
  sequenceHost.setAttribute('aria-label','DNA sequence. Type to insert; select bases and type to replace, or press Delete.');
  sequenceHost.addEventListener('mousedown',()=>sequenceHost.focus({preventScroll:true}));
  let previous='';
  function syncSequenceGuide() {
    const {record,source}=editor.snapshot();
    const edited=!!(record?.sequence && source?.editedSequence===record.sequence && source.originalSequence!==record.sequence);
    const stage=$('sequence-viewer-cloning-design-workspace').hidden ? 'sequence' : 'design';
    const signature=JSON.stringify([record?.sequence,record?.features,edited,stage,cloningState.activeEntryId]);
    if(signature===previous)return;
    previous=signature;
    runtime.state.trialSequenceDraft={record:structuredClone(record),source:structuredClone(source),entryId:cloningState.activeEntryId,entryStatus:cloningState.activeEntryStatus};
    try{localStorage.setItem('hikari_state_v1',JSON.stringify(runtime.state));}catch{}
    document.body.dataset.trialSequenceEdited=String(edited);
    document.body.dataset.trialCloningStage=stage;
    tell('cloning-state',{edited});
  }
  const sequenceObserver=new MutationObserver(syncSequenceGuide);
  sequenceObserver.observe($('sequence-viewer-detail-workspace'),{childList:true,subtree:true});
  sequenceObserver.observe($('sequence-viewer-cloning-design-workspace'),{attributes:true,attributeFilter:['hidden']});
  syncSequenceGuide();
}
if (!CALCULATIONS_ONLY && feature==='cloning' && window.HikariBrowserTrial.capture) {
  runtime.navigationShell.showView('sequence-viewer-detail-view');
  // The real cloning controller receives a known edit, as it does after editing
  // a record in the desktop sequence viewer. Its own algorithms build the plan.
  const {original,variant}=M.cloningExample();
  const record = {sequence:variant,name:'Example fragment · Ala → Gly',topology:'circular',features:[]};
  const source=buildSequenceEditDesignSource({record:{name:'Example fragment'},originalSequence:original,nextSequence:variant,generatedName:record.name});
  const map={cloningDesignWorkspace:'workspace',cloningDesignBackBtn:'back-btn',cloningDesignStrategyList:'strategy-list',cloningDesignRunBtn:'run-btn',cloningDesignConfirmBtn:'confirm-btn',cloningDesignStatus:'status',cloningDesignResult:'result'};
  const elements={};
  for(const [key,suffix]of Object.entries(map)) {const el=$('sequence-viewer-cloning-design-'+suffix);if(key!=='cloningDesignWorkspace')el.replaceWith(el.cloneNode(true));elements[key]=$('sequence-viewer-cloning-design-'+suffix);}
  cloningState={};
  const sequenceViewer=runtime.moduleRuntime.modules.sequenceViewer;
  function showSequence() {
    $('sequence-viewer-home-workspace').hidden=true;
    $('sequence-viewer-detail-workspace').hidden=false;
    elements.cloningDesignWorkspace.hidden=true;
    document.body.dataset.trialCloningStage='sequence';
    tell('cloning-state',{edited:document.body.dataset.trialSequenceEdited==='true'});
  }
  const controller=createSequenceViewerCloningDesignController({elements,state:cloningState,getSelectedRecord:()=>record,getCloningDesignSource:()=>source,onReturnToDetail:showSequence,onRequestPrimerOrder:()=>notice('Primer ordering is available in the desktop app.')});
  cloneController=controller; controller.bindEvents();
  function openDesigner() {
    $('sequence-viewer-detail-workspace').hidden=true;
    elements.cloningDesignWorkspace.hidden=false;
    document.body.dataset.trialCloningStage='design';
    controller.open();controller.render();
    // Captures inspect a worked example.
    if(window.HikariBrowserTrial.capture)controller.designPrimers();
  }
  const entryButton=$('sequence-viewer-cloning-design-btn');
  entryButton.replaceWith(entryButton.cloneNode(true));
  const openButton=$('sequence-viewer-cloning-design-btn');
  openButton.addEventListener('click',openDesigner);
  sequenceViewer.loadFromExternal({...record,name:'Example fragment · 399 bp',sequence:original});
  function applyExampleEdit() {
    if(document.body.dataset.trialSequenceEdited==='true')return;
    sequenceViewer.loadFromExternal(record);
    document.body.dataset.trialSequenceEdited='true';
    openButton.hidden=false;openButton.disabled=false;
    showSequence();
  }
  elements.cloningDesignConfirmBtn.hidden=true;
  showSequence();
  if(window.HikariBrowserTrial.capture) {applyExampleEdit();openDesigner();elements.cloningDesignBackBtn.hidden=true;}
}
// Restrict navigation to the selected feature; the Product tabs select other
// trials, each with an independent counter. No desktop settings or sign-in flow.
const allowedViews=M.featureViews(feature);
if(!window.HikariBrowserTrial.capture)document.querySelectorAll('[data-view]').forEach(el=>{if(!allowedViews.includes(el.dataset.view)) el.hidden=true;});
if(feature==='protocols' && !window.HikariBrowserTrial.capture) {
  const methods=document.createElement('button');methods.type='button';methods.className='ghost-btn';methods.textContent='Edit methods';
  methods.addEventListener('click',()=>runtime.navigationShell.showView('protocol-management-view'));
  $('biology-notebook-new-experiment-btn').after(methods);
  const back=document.createElement('button');back.type='button';back.className='ghost-btn';back.textContent='← Notebook';
  back.addEventListener('click',()=>runtime.navigationShell.showView('biology-notebook-view'));
  document.querySelector('#protocol-list-panel .protocol-list-pinned').prepend(back);
}
if (!window.HikariBrowserTrial.capture) {
  document.querySelector('.app-dock').addEventListener('click', event => {
    if (!event.target.closest('.app-dock-nav .app-nav-btn')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    returnToFeature();
  }, true);
}
// Keep the main action readable at the scale of the website's app window.
const primaryAction = feature==='experiments' ? $('biology-notebook-take-into-plan-btn') : feature==='calculations' ? $('save-biology-notebook-btn') : null;
if(primaryAction) {
  primaryAction.dataset.trialLabel=feature==='experiments'?'Take into plan':'Save worksheet';
  primaryAction.classList.add('trial-main-action');
}
// Agent screenshots (capture only): open each prepared scene through the app's own controls.
// The app has started at this point, so release the startup guard first: background errors from
// the opened workspace are not a failed start. A scene that cannot open never sets trialReady.
if (window.HikariBrowserTrial.agentScene) {
  window.dispatchEvent(new Event('hikari-trial-ready'));
  await openAgentScene(window.HikariBrowserTrial.agentScene);
}
window.HikariBrowserTrial.dismissExample();
document.body.dataset.trialReady='true';
window.dispatchEvent(new Event('hikari-trial-ready'));
tell('ready');

}
