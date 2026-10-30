(function () {
  'use strict';
  const formulaRow = doc => [...doc.querySelectorAll('#biology-notebook-result-table .tabulator-row')]
    .find(row=>row.querySelector('[tabulator-field="demo_molarity_0"]')?.textContent.trim()==='Formula example');
  const formulaVolume = doc => formulaRow(doc)?.querySelector('[tabulator-field="demo_molarity_3"]');
  function formulaResolved(doc) {
    const volume=formulaVolume(doc), molarity=formulaRow(doc)?.querySelector('[tabulator-field="demo_molarity_4"]');
    // Tabulator can replace its editor before the guide receives Enter. Follow
    // the committed result instead, including commits made by clicking away.
    return !!volume && !volume.querySelector('input, textarea') && [volume,molarity].every(cell => {
      const value=cell?.textContent.trim();
      return !!value && Number.isFinite(Number(value)) && Number(value)>0;
    });
  }
  // The guide lives in the Hikari window, outside its scaled iframe. Every
  // target is converted to this window's coordinates so captions stay readable.
  const GUIDES = {
    'protein-builder': [
      {target:'#sequence-viewer-protein-builder-common-blocks details:has([data-protein-builder-add-library-id="g4s"]) > summary',title:'Open the linker palette',text:'Click Linkers under Common Blocks.',condition:doc=>doc.querySelector('[data-protein-builder-add-library-id="g4s"]')?.closest('details')?.open},
      {target:'[data-protein-builder-add-library-id="g4s"]',title:'Add a linker',text:'Click (GGGGS)1.',on:'click',match:'[data-protein-builder-add-library-id="g4s"]'},
      {target:'#sequence-viewer-protein-builder-codon-usage',title:'Choose codon usage',text:'Hikari uses this organism’s codons for the DNA sequence.'},
      {target:'#sequence-viewer-protein-builder-build-dna-btn',title:'Build coding DNA',text:'Build and copy the protein or DNA sequence, then keep experimenting.',on:'complete'}
    ],
    cloning: [
      { target: doc => doc.querySelector('#sequence-viewer-sequence-edit-overlay')?.hidden===false ? doc.querySelector('#sequence-viewer-sequence-edit-form') : doc.querySelector('#sequence-viewer-sequence-host .sequence-viewer-dual-line'), title: 'Edit the DNA', text: 'Click between bases and type to insert. Drag across bases, then type to replace or press Delete. Confirm the change in the dialog.', condition: doc => doc.body.dataset.trialSequenceEdited === 'true' },
      { target: '#sequence-viewer-cloning-design-btn', title: 'Open Cloning Design', text: 'Compare cloning routes for your sequence edit.', condition: doc => doc.body.dataset.trialCloningStage === 'design' },
      { target: '#sequence-viewer-cloning-design-strategy-list', title: 'Choose a cloning route', text: 'Compare the routes available for your insertion, replacement, or deletion.', on: 'click', match: '[data-cloning-design-strategy]' },
      { target: '#sequence-viewer-cloning-design-run-btn', title: 'Design the primers', text: 'Inspect the primer sequences and compare the available routes.', on: 'complete' }
    ],
    calculations: [
      { target: formulaRow, title: 'Two known values', text: 'With only molecular weight and mass, the remaining cells show formulas that reference each other.' },
      { target: formulaVolume, title: 'Supply one more value', text: 'Double-click Volume in Formula example.', on:'dblclick', match: formulaVolume },
      { target: formulaVolume, title: 'From formula to number', text: 'Type 2 and press Enter to calculate molarity. Clear Volume to restore the formulas.', condition: formulaResolved },
      { target: '#save-biology-notebook-btn', title: 'Save the worksheet', text: 'Keep your worksheet in this browser.', on: 'complete' }
    ],
    protocols: [
      { target: '#biology-notebook-new-experiment-btn', title: 'Start another run', text: 'Click New experiment to reuse the method.', on: 'click', match: '#biology-notebook-new-experiment-btn' },
      { target: '#biology-notebook-experiment-protocol-fields', title: 'Select a method', text: 'Choose Protein comparison · fillable template.', condition: doc => doc.querySelector('#biology-notebook-protocol-select')?.value === 'demo-protocol-fillable' },
      { target: '#biology-notebook-experiment-start-btn', title: 'Create a notebook page', text: 'Start a fresh page with its own values and observations.', on: 'complete' },
      { target: '#biology-notebook-steps', title: 'Fill in the method', text: 'Set Protein, Volume, and Incubation for this run.' },
      { target: '#biology-notebook-result', title: 'Record an observation', text: 'Add what happened in Notes. These observations belong to this run.', ready: doc => !!doc.querySelector('#biology-notebook-result')?.value.trim(), wait: 'Enter an observation to continue.' },
      { target: '#save-biology-notebook-btn', title: 'Save the run', text: 'Save notebook page keeps these values separate from the reusable method.', on: 'click', match: '#save-biology-notebook-btn' }
    ],
    workflows: [], // Built from the next unfinished step when the walkthrough starts.
    samples: [
      { target: '[data-container-id="demo-box"][data-well-index="24"]', title: 'Choose a well', text: 'Click W25 to add or edit a sample.', on: 'click', match: '[data-container-id="demo-box"][data-well-index="24"]' },
      { target: '.well-side-editor > label:has([data-well-sample-new-code]), .well-side-editor > label:has([data-well-sample-code])', scrollBelow: '.container-detail-sticky', title: 'Set a sample code', text: 'Enter a unique code, such as DEMO-025.', ready: doc => !!doc.querySelector('.well-side-editor [data-well-sample-new-code], .well-side-editor [data-well-sample-code]')?.value.trim(), wait: 'Enter a sample code to continue.' },
      { target: '.well-side-editor > label:has([data-well-sample-new-name]), .well-side-editor > label:has([data-well-sample-name])', scrollBelow: '.container-detail-sticky', title: 'Name the sample', text: 'Give this sample a name. You can also set its type, concentration, and notes.', ready: doc => !!doc.querySelector('.well-side-editor [data-well-sample-new-name], .well-side-editor [data-well-sample-name]')?.value.trim(), wait: 'Enter a sample name to continue.' },
      { target: '.well-side-editor button[data-well-sample-create], .well-side-editor button[data-well-sample-save]', scrollBelow: '.container-detail-sticky', title: 'Save the sample', text: 'Keep your worksheet in this browser.', on: 'complete' }
    ]
  };
  function workflowGuide(doc) {
    const next = doc.querySelector('[data-workflow-run-open="demo-run-2"] [data-workflow-step-open].is-pending:not(:disabled):not(.is-branch)')
      || doc.querySelector('.workflow-ledger [data-workflow-step-open].is-pending:not(:disabled):not(.is-branch)');
    if(!next)return [{target:'.workflow-ledger',title:'Explore another run',text:'Start a new run or reopen a completed step to keep exploring.'}];
    const workflowId=CSS.escape(next.dataset.workflowWorkflowId), blockId=CSS.escape(next.dataset.workflowStepOpen);
    const name=next.closest('[data-workflow-run-open]').querySelector('.workflow-ledger-name').textContent;
    const method=next.title.split(':')[0].replace(/^\d+\.\s*/, '');
    const example={'Measure activity':'Relative activity: 88% at 25 °C.','Purify protein':'Clear eluate; 3.8 mg/mL protein.','Archive aliquots':'Aliquots labeled and placed in the example freezer box.','Grow cells':'Culture labeled and ready for purification.'}[method] || 'Step finished; the observation is recorded here.';
    const row=`[data-workflow-run-open="${workflowId}"]`;
    const nextStep=`${row} [data-workflow-step-open="${blockId}"]`;
    const drawerStep=`[data-workflow-drawer-toggle="${blockId}"][data-workflow-workflow-id="${workflowId}"]`;
    const result=`[data-workflow-step-result-field="${blockId}"][data-workflow-workflow-id="${workflowId}"]`;
    const values=`[data-workflow-step-value][data-workflow-block-id="${blockId}"][data-workflow-workflow-id="${workflowId}"]`;
    let originalValues;
    const valuesEdited=doc=>{
      const inputs=[...doc.querySelectorAll(values)];
      if(!originalValues && inputs.length)originalValues=new Map(inputs.map(input=>[input.dataset.workflowStepValue,input.value.trim()]));
      return inputs.length>0 && inputs.every(input=>input.value.trim())
        && inputs.some(input=>input.value.trim()!==originalValues.get(input.dataset.workflowStepValue));
    };
    const stepIsOpen=doc=>doc.querySelector(result)?.closest('details')?.open===true;
    return [
      { target:nextStep, title:'Start the next step', text:`Click the empty dot for ${method} in ${name}.`, on:'click', match:nextStep },
      { target:doc=>doc.querySelector(values)?.closest('.workflow-placeholder-table'), title:'Fill in the method', text:'Change Sample or another placeholder for this run. These values are saved with this step.', ready:valuesEdited, wait:'Edit a placeholder and fill all method fields to continue.' },
      { target: result, title: 'Record a result', text:`Enter an example result: “${example}”`, ready:doc=>!!doc.querySelector(result)?.value.trim(), wait:'Enter a result to continue.' },
      { target:`[data-workflow-step-status="completed"][data-workflow-block-id="${blockId}"][data-workflow-workflow-id="${workflowId}"]`, title:'Complete the step', text:'Mark complete saves the method values, notes, and completion date.', on:'complete' },
      { target:drawerStep, title:'Review the saved step', text:`Reopen ${method} to review its values and notes.`, condition:stepIsOpen },
      { target:doc=>doc.querySelector(values)?.closest('.workflow-placeholder-table'), title:'Saved with this run', text:'Your placeholder values and notes stay with this completed step. The reusable method stays unchanged.' }
    ];
  }
  const $ = id => document.getElementById(id), states = new Map(), bindings = new WeakMap();
  let active = null, scheduled = 0, watchedTarget = null;
  const motions = new Map(), geometryObserver = new ResizeObserver(queue);
  const layer = document.createElement('div');
  layer.className = 'trial-guide-layer'; layer.hidden = true;
  layer.innerHTML = `<svg class="trial-guide-art" aria-hidden="true"><defs><marker id="trial-guide-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M1 1 7 4.5 1 8" fill="none" stroke="currentColor" stroke-width="1.7"/></marker></defs><path class="trial-guide-mask" fill-rule="evenodd"/><rect class="trial-guide-spotlight" rx="7"/><path class="trial-guide-arrow" marker-end="url(#trial-guide-arrowhead)"/></svg>
    <section class="trial-guide-caption" role="dialog" aria-modal="false" aria-labelledby="trial-guide-title" aria-describedby="trial-guide-copy">
      <div class="trial-guide-caption-head"><span id="trial-guide-step"></span><button type="button" class="trial-guide-skip" aria-label="Skip walkthrough">Skip guide</button></div>
      <div class="trial-guide-caption-body"><h3 id="trial-guide-title"></h3><p id="trial-guide-copy"></p><p id="trial-guide-wait" class="trial-guide-wait" aria-live="polite" hidden></p></div>
      <div class="trial-guide-actions"><button type="button" class="trial-guide-back">Back</button><button type="button" class="trial-guide-next" aria-describedby="trial-guide-wait">Next <span aria-hidden="true">→</span></button></div>
    </section>`;
  document.body.append(layer);
  const card = layer.querySelector('.trial-guide-caption'), next = layer.querySelector('.trial-guide-next'), back = layer.querySelector('.trial-guide-back');
  const mask = layer.querySelector('.trial-guide-mask'), spot = layer.querySelector('.trial-guide-spotlight'), arrow = layer.querySelector('.trial-guide-arrow');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function roundedRectPath(left, top, right, bottom, radius) {
    const r = Math.max(0, Math.min(radius, (right-left)/2, (bottom-top)/2));
    if (!r) return `M${left},${top}H${right}V${bottom}H${left}Z`;
    return `M${left+r},${top}H${right-r}A${r},${r} 0 0 1 ${right},${top+r}`
      + `V${bottom-r}A${r},${r} 0 0 1 ${right-r},${bottom}`
      + `H${left+r}A${r},${r} 0 0 1 ${left},${bottom-r}`
      + `V${top+r}A${r},${r} 0 0 1 ${left+r},${top}Z`;
  }
  function current() { return active && active.steps[active.state.index]; }
  function targetFor(step) {
    const doc=step.host ? document : active.frame.contentDocument;
    const modal=step.host ? null : [...doc.querySelectorAll('.app-dialog-overlay:not([hidden])')].find(el=>el.getBoundingClientRect().height);
    const targets=typeof step.target==='function' ? [step.target(doc)].filter(Boolean) : [...doc.querySelectorAll(step.target)];
    return targets.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width && rect.height && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden' && (!modal || modal.contains(el));
    });
  }
  function scrollportRect(element) {
    const rect = element.getBoundingClientRect();
    const left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
    return {left, top, right:left + element.clientWidth, bottom:top + element.clientHeight};
  }
  function revealInFrame(target, scrollBelow) {
    // Scroll only the app's own panels. scrollIntoView can also move the host window.
    const view = target.ownerDocument.defaultView;
    const headers = scrollBelow ? [...target.ownerDocument.querySelectorAll(scrollBelow)] : [];
    const offset = (start, end, near, far) => end-start > far-near
      ? (start > near ? start-near : end < far ? end-far : 0)
      : (start < near ? start-near : end > far ? end-far : 0);
    for (let parent=target.parentElement; parent; parent=parent.parentElement) {
      const style = view.getComputedStyle(parent), clip = scrollportRect(parent), rect = target.getBoundingClientRect();
      // A sticky toolbar can cover a control even while it is inside the panel's
      // scrollport. Reveal the control below that toolbar, not behind its CSV actions.
      const visibleTop = headers.reduce((top, header) => {
        if (!parent.contains(header) || header.contains(target)) return top;
        const bounds = header.getBoundingClientRect();
        return bounds.width && bounds.height && bounds.top <= clip.top + 1 && bounds.bottom > clip.top
          && bounds.left < rect.right && bounds.right > rect.left ? Math.max(top, bounds.bottom) : top;
      }, clip.top);
      const dx = /auto|scroll/.test(style.overflowX) ? offset(rect.left,rect.right,clip.left+8,clip.right-8) : 0;
      const dy = /auto|scroll/.test(style.overflowY) ? offset(rect.top,rect.bottom,visibleTop+8,clip.bottom-8) : 0;
      if (dx || dy) parent.scrollTo({left:parent.scrollLeft+dx,top:parent.scrollTop+dy,behavior:'instant'});
    }
  }
  function visibleFrameBounds(target) {
    const doc = target.ownerDocument, view = doc.defaultView;
    const bounds = {left:0,top:0,right:doc.documentElement.clientWidth,bottom:doc.documentElement.clientHeight};
    for (let parent=target.parentElement; parent; parent=parent.parentElement) {
      const style = view.getComputedStyle(parent), clip = scrollportRect(parent);
      if (style.overflowX !== 'visible') { bounds.left=Math.max(bounds.left,clip.left); bounds.right=Math.min(bounds.right,clip.right); }
      if (style.overflowY !== 'visible') { bounds.top=Math.max(bounds.top,clip.top); bounds.bottom=Math.min(bounds.bottom,clip.bottom); }
    }
    return bounds;
  }
  function hide() {
    layer.hidden = true; active = null; watchedTarget = null;
    geometryObserver.disconnect(); motions.clear();
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = 0;
  }
  function stop() { if (active) active.state.done = true; hide(); }
  function advance() {
    if (!active) return;
    if (++active.state.index >= active.steps.length) { stop(); return; }
    refresh();
  }
  function isWaiting(step, doc, target) {
    return !!(step.on || step.condition || (step.ready && !step.ready(doc)));
  }
  function queue() {
    if (!active || scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0; refresh();
      for (const element of motions.keys()) if (!element.isConnected || !affectsLayout(element)) motions.delete(element);
      if (motions.size) queue();
    });
  }
  function watchGeometry(target) {
    if (watchedTarget === target) return;
    watchedTarget = target; geometryObserver.disconnect();
    // Frame scaling and late font/panel layout can happen after window.resize.
    // Watch the actual control, its clipping panels, and the outer presentation.
    for (let element=target; element; element=element.parentElement) geometryObserver.observe(element);
    for (const element of [active.frame, $('trial-workbench'), $('trial-frame-pool'), card, document.querySelector('.trial-sidebar')]) geometryObserver.observe(element);
  }
  function affectsLayout(element) {
    return active && (element.ownerDocument === active.frame.contentDocument ||
      element.contains(active.frame) || $('trial-layout').contains(element));
  }
  function motion(event) {
    const element=event.target;
    const key=`${event.animationName ? 'animation' : 'transition'}:${event.animationName || event.propertyName}:${event.pseudoElement}`;
    if (/end|cancel$/.test(event.type)) {
      const running=motions.get(element);
      running?.delete(key); if (!running?.size) motions.delete(element);
    } else {
      if (!watchedTarget || !element.contains || !affectsLayout(element)) return;
      // Opacity-only animations do not move an anchor, and may repeat forever.
      if (event.propertyName === 'opacity' || (event.animationName && element.ownerDocument.defaultView.getComputedStyle(element).animationIterationCount.split(',').some(count=>count.trim()==='infinite'))) return;
      if (!motions.has(element)) motions.set(element,new Set());
      motions.get(element).add(key);
    }
    queue();
  }
  function bindLayout(doc) {
    for (const name of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel']) doc.addEventListener(name,motion,true);
    doc.defaultView.addEventListener('resize',queue);
    doc.fonts.ready.then(queue);
    doc.fonts.addEventListener('loadingdone',queue);
  }
  function bind(frame) {
    const doc = frame.contentDocument, previous = bindings.get(frame);
    if (previous?.doc === doc) return;
    previous?.observer.disconnect();
    const onAction = event => {
      if (active?.frame !== frame) return;
      const step = current();
      const session=active, index=active.state.index;
      const matches=step.on===event.type && (!step.key || step.key===event.key) &&
        (typeof step.match==='function' ? step.match(doc)?.contains(event.target) : event.target.closest?.(step.match));
      if (matches) setTimeout(()=>{if(active===session && active.state.index===index)advance();}, 0);
      else setTimeout(queue, 0);
    };
    for (const name of ['click', 'dblclick', 'input', 'change', 'submit','keydown']) doc.addEventListener(name, onAction, true);
    doc.addEventListener('keydown', event => { if (event.key === 'Escape' && active?.frame === frame) stop(); });
    doc.addEventListener('scroll', queue, true);
    bindLayout(doc);
    const observer = new MutationObserver(queue);
    observer.observe(doc.body, {subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style','data-trial-cloning-stage','data-trial-sequence-edited']});
    bindings.set(frame, {doc, observer});
  }
  function show(feature, frame, restart = false) {
    hide();
    if (!GUIDES[feature] || frame.dataset.ready !== 'true' || !frame.contentDocument?.body) return;
    // Every guide shares the window's coordinate system and clipping boundary.
    const windowElement=frame.closest('.trial-app-wrap');
    if(layer.parentElement!==windowElement)windowElement.append(layer);
    const mode='interactive';
    if (restart || !states.has(feature) || states.get(feature).mode!==mode) states.set(feature, {index:0,done:false,mode,steps:feature==='workflows' ? workflowGuide(frame.contentDocument) : GUIDES[feature]});
    const state = states.get(feature); if (state.done) return;
    active = {feature,frame,state,steps:state.steps}; bind(frame); refresh();
  }
  function refresh() {
    if (!active || active.frame.hidden || $('trial-panel').hidden || $('trial-workbench').hidden) { layer.hidden = true; return; }
    const step = current(), doc = active.frame.contentDocument;
    if (!doc?.body) { layer.hidden = true; return; }
    if (step.condition?.(doc)) { advance(); return; }
    const target = targetFor(step);
    if (!target) { layer.hidden = true; return; }
    watchGeometry(target);
    if (!step.host) revealInFrame(target, step.scrollBelow);
    layer.hidden = false;
    const windowElement=active.frame.closest('.trial-app-wrap'), windowRect=windowElement.getBoundingClientRect();
    const viewportWidth=layer.clientWidth, viewportHeight=layer.clientHeight;
    const frameRect=active.frame.getBoundingClientRect(), rect = target.getBoundingClientRect();
    const app={left:frameRect.left-windowRect.left,top:frameRect.top-windowRect.top,right:frameRect.right-windowRect.left,bottom:frameRect.bottom-windowRect.top};
    const sx = frameRect.width / active.frame.clientWidth, sy = frameRect.height / active.frame.clientHeight;
    const clip = step.host ? {left:0,top:0,right:viewportWidth,bottom:viewportHeight} : visibleFrameBounds(target);
    if (!step.host) {
      clip.left=Math.max(app.left+clip.left*sx,0);
      clip.right=Math.min(app.left+clip.right*sx,viewportWidth);
      clip.top=Math.max(app.top+clip.top*sy,0);
      clip.bottom=Math.min(app.top+clip.bottom*sy,viewportHeight);
    }
    let left = step.host ? rect.left-windowRect.left : app.left + rect.left*sx, top = step.host ? rect.top-windowRect.top : app.top + rect.top*sy;
    let right = left + rect.width*(step.host ? 1 : sx), bottom = top + rect.height*(step.host ? 1 : sy);
    if (right <= clip.left || left >= clip.right || bottom <= clip.top || top >= clip.bottom) { layer.hidden=true; return; }
    left = clamp(left-7,clip.left+1,clip.right-1); right = clamp(right+7,clip.left+1,clip.right-1);
    top = clamp(top-7,clip.top+1,clip.bottom-1); bottom = clamp(bottom+7,clip.top+1,clip.bottom-1);
    layer.dataset.feature = active.feature; layer.dataset.step = String(active.state.index+1);
    $('trial-guide-step').textContent = `Step ${active.state.index+1} of ${active.steps.length}`;
    $('trial-guide-title').textContent = step.title; $('trial-guide-copy').textContent = step.text;
    const waiting = isWaiting(step, doc, target), hint = $('trial-guide-wait');
    hint.hidden = !waiting || !step.wait;
    hint.textContent = step.wait || '';
    // Keep the path forward visible, even when the app action must happen first.
    next.hidden = false; next.disabled = waiting;
    next.textContent = active.state.index === active.steps.length-1 ? 'Finish guide' : 'Next →';
    back.hidden = !active.steps.slice(0,active.state.index).some(previous=>!previous.condition?.(doc) && targetFor(previous));
    // The cutout and outline share their bounds and radius. A square cutout
    // under a rounded outline leaves bright slivers outside its four corners.
    const radius=Math.max(0,Math.min(7,(right-left)/2,(bottom-top)/2));
    const windowRadius=parseFloat(getComputedStyle(windowElement).borderTopLeftRadius) || 0;
    mask.setAttribute('d', roundedRectPath(0,0,viewportWidth,viewportHeight,windowRadius)
      +' '+roundedRectPath(left,top,right,bottom,radius));
    for (const [name,value] of Object.entries({x:left,y:top,width:right-left,height:bottom-top,rx:radius,ry:radius})) spot.setAttribute(name,String(value));
    // Measure the full caption first; a previous compact step must not constrain it.
    card.style.width = ''; card.style.maxHeight = '';
    let w = card.offsetWidth, h = card.offsetHeight;
    const gap = 34;
    const sides=[{x:right+gap,y:(top+bottom-h)/2}, {x:left-w-gap,y:(top+bottom-h)/2}];
    const above={x:(left+right-w)/2,y:top-h-gap}, below={x:(left+right-w)/2,y:bottom+gap};
    const candidates = [
      ...sides,below,above,
      {x:viewportWidth-w-12,y:viewportHeight-h-12}, {x:12,y:viewportHeight-h-12},
      {x:12,y:12}, {x:viewportWidth-w-12,y:12}
    ].map(p => ({x:clamp(p.x,12,viewportWidth-w-12),y:clamp(p.y,12,viewportHeight-h-12)}));
    const overlap = p => Math.max(0,Math.min(p.x+w,right)-Math.max(p.x,left))*Math.max(0,Math.min(p.y+h,bottom)-Math.max(p.y,top));
    let chosen = candidates.reduce((best,p) => overlap(p)<overlap(best) ? p : best);
    if (overlap(chosen)) {
      // In a small window, scroll the caption body instead of covering an action.
      // Keep enough height for the step header, navigation, and two lines of copy.
      const style=getComputedStyle(card), head=card.querySelector('.trial-guide-caption-head'), actions=card.querySelector('.trial-guide-actions');
      const minimumHeight=head.offsetHeight+actions.offsetHeight+42
        +parseFloat(getComputedStyle(head).marginBottom)+parseFloat(getComputedStyle(actions).marginTop)
        +parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;
      const regions=[
        {left:12,top:12,right:viewportWidth-12,bottom:top-16},
        {left:12,top:bottom+16,right:viewportWidth-12,bottom:viewportHeight-12},
        {left:12,top:12,right:left-16,bottom:viewportHeight-12},
        {left:right+16,top:12,right:viewportWidth-12,bottom:viewportHeight-12}
      ].filter(region=>region.right-region.left>=Math.min(w,220) && region.bottom-region.top>=minimumHeight);
      if (regions.length) {
        const area=region=>Math.min(w,region.right-region.left)*Math.min(h,region.bottom-region.top);
        const region=regions.reduce((best,item)=>area(item)>area(best) ? item : best);
        card.style.width=`${Math.min(w,region.right-region.left)}px`;
        card.style.maxHeight=`${region.bottom-region.top}px`;
        w=card.offsetWidth; h=card.offsetHeight;
        chosen={x:clamp((left+right-w)/2,region.left,region.right-w),y:clamp((top+bottom-h)/2,region.top,region.bottom-h)};
      }
    }
    card.style.left = `${chosen.x}px`; card.style.top = `${chosen.y}px`;
    const tx = (left+right)/2, ty = (top+bottom)/2;
    let ax = clamp(tx,chosen.x+18,chosen.x+w-18), ay = clamp(ty,chosen.y+18,chosen.y+h-18);
    if (ty < chosen.y) ay=chosen.y; else if (ty > chosen.y+h) ay=chosen.y+h;
    else if (tx < chosen.x) ax=chosen.x; else ax=chosen.x+w;
    const bx = clamp(ax,left,right), by = clamp(ay,top,bottom);
    arrow.setAttribute('d',`M${ax},${ay} Q${(ax+bx)/2},${ay} ${bx},${by}`);
    arrow.setAttribute('visibility',Math.hypot(ax-bx,ay-by)<1 ? 'hidden' : 'visible');
  }
  next.addEventListener('click',() => {
    if (!active) return;
    const step = current(), doc = active.frame.contentDocument, target = targetFor(step);
    if (target && !isWaiting(step, doc, target)) advance();
  });
  back.addEventListener('click',() => {
    const doc=active.frame.contentDocument;
    for (let index=active.state.index-1;index>=0;index--) {
      const step=active.steps[index];
      if(!step.condition?.(doc) && targetFor(step)) {active.state.index=index;refresh();break;}
    }
  });
  layer.querySelector('.trial-guide-skip').addEventListener('click',stop);
  document.addEventListener('keydown',event => {if(event.key==='Escape' && active)stop();});
  bindLayout(document);
  window.visualViewport?.addEventListener('resize',queue);
  window.HikariTrialGuide = {show,hide,refresh:queue,reset(feature,frame) {
    if(active?.feature===feature)hide();
    states.delete(feature);
    bindings.get(frame)?.observer.disconnect();
    bindings.delete(frame);
  },complete(feature) {if(active?.feature===feature && current().on==='complete')advance();}};
})();
