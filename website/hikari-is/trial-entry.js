// Select the trial's shell before the desktop renderer's module graph loads.
(function () {
  const { feature } = window.HikariBrowserTrial;
  // The desktop Home module owns the clock. Keep just this shell behavior in
  // the website instead of importing the dashboard, timers, and reminders.
  const clock=document.getElementById('topbar-local-time');
  function updateClock() {
    const now=new Date(), time=now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
    clock.dateTime=now.toISOString();clock.textContent=time;
    clock.setAttribute('aria-label',`Current local time ${time}`);
  }
  updateClock();setInterval(updateClock,60000);
  const views = {
    experiments: 'biology-notebook-view', calculations: 'biology-notebook-view',
    protocols: 'biology-notebook-view', cloning: 'sequence-viewer-detail-view', 'protein-builder':'sequence-viewer-view',
    samples: 'personal-inventory-view', workflows: 'workflow-management-view'
  };
  const viewId = views[feature] || window.HikariAgentScenes?.VIEWS[feature] || views[window.HikariTrialModel.DEFAULT_FEATURE];
  window.HikariBrowserTrial.initialViewId = viewId;
  document.body.dataset.trialFeature = feature;
  document.body.dataset.activeView = viewId;
  document.body.dataset.appearanceMode = 'day';
  document.body.classList.add('ui-neutral-compact');
  function applyFontSize(size) {
    const root=document.documentElement, next=`${size}px`, changed=root.style.fontSize!==next;
    root.style.fontSize=next; root.style.setProperty('--app-font-size',next);
    // Let tables, sequences, and the guide remeasure after the rem-based layout changes.
    if(changed && document.body.dataset.trialReady==='true')requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  applyFontSize(window.HikariBrowserTrial.initialFontSize);
  if(!window.HikariBrowserTrial.capture) {
    window.addEventListener('message',event=>{
      if(!window.HikariTrialModel.isTrialMessage(event,parent,location) || event.data?.type!=='hikari-trial:layout')return;
      const size=event.data.fontSize;
      if(typeof size==='number' && Number.isFinite(size) && size>=14 && size<=24)applyFontSize(size);
    });
    const fitStandalone=()=>{if(parent===window)applyFontSize(window.HikariTrialModel.appFontSize(innerWidth,innerHeight));};
    window.addEventListener('resize',fitStandalone);
    window.addEventListener('hikari-trial-ready',fitStandalone);
    fitStandalone();
  }
  if(window.HikariBrowserTrial.capture) {
    document.documentElement.dataset.capture='true';
    // Native density: the capture window renders at devicePixelRatio 3, so no CSS zoom is needed.
    if(new URLSearchParams(location.search).get('density')==='native') document.documentElement.dataset.captureDensity='native';
    const stylesheet=document.createElement('link');
    stylesheet.rel='stylesheet';stylesheet.href='../screenshot-capture.css';
    document.head.append(stylesheet);
    // The website does not ship Plotly; capture-scenes.cjs copies it in for this screenshot.
    if (feature === 'agent-plot') document.head.append(Object.assign(document.createElement('script'), { src: './vendor/plotly/plotly.min.js' }));
  }
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === viewId));
  // Keep unbound controls inactive while the real renderer initializes them.
  document.querySelector('.app-shell').inert = true;
  if (feature === 'cloning') {
    document.getElementById('sequence-viewer-home-workspace').hidden = true;
    document.getElementById('sequence-viewer-detail-workspace').hidden = false;
    document.getElementById('sequence-viewer-cloning-design-workspace').hidden = true;
  }
  document.documentElement.dataset.windowChrome = 'mac';
  const controls = document.createElement('div');
  controls.className = 'trial-window-controls';
  controls.setAttribute('aria-hidden', 'true');
  controls.innerHTML = '<i></i><i></i><i></i>';
  document.querySelector('.topbar').prepend(controls);

  // Show the examples synchronously, before the desktop module graph is ready.
  // This is ordinary Hikari-styled HTML, so the window is useful even on a slow
  // connection. The live workspace replaces it only after its record is open.
  const state = window.HikariBrowserTrial.getState();
  const exampleBox=state.inventory['-20 Degree'].find(box=>box.id==='demo-box');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const table = (headers, rows) => `<div class="trial-example-table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const exampleProtocol=state.protocols.find(p=>p.id===window.HikariBrowserTrial.exampleProtocolId);
  function protocolSteps(protocol, values={}) {
    return `<h4>Protocol · Protein comparison</h4><ol>${protocol.steps.map(step=>`<li>${escape(step.text).replace(/\{\{ph:([^}]+)\}\}/g,(_,id)=>`<span class="trial-example-field">${escape(values[id] || '['+(step.placeholders.find(p=>p.id===id)?.name || 'Value')+']')}</span>`)}</li>`).join('')}</ol>`;
  }
  const steps = protocolSteps(exampleProtocol);
  const records = state.notebookEntries;
  const idea = records.find(p=>p.id==='demo-suggestion-0');
  const page = records.find(p=>p.id==='demo-protocol-fillable-page');
  const cloning=window.HikariTrialModel.cloningExample();
  const configs = {
    experiments: {title:'Confirm the thermal shift', section:'Biology Notebook', rail:['Example enzyme project','Confirm the thermal shift','Check retained activity','Compare purification fractions'], content:`<span class="trial-example-tag">Suggested</span><h3>Why this experiment?</h3><p>${escape(idea?.agentDraftMeta?.rationale)}</p>${table(['Example result','Melting temperature'],[['Wild type','53.0 °C'],['Variant A','59.4 °C']])}${steps}`},
    calculations: {title:'Stock solution worksheet', section:'Biology Notebook', rail:['Example enzyme project','Stock solution worksheet'],content:`<h3>Molarity worksheet</h3><p>Two known values show simplified formulas. A third calculates the fourth.</p>${table(['Entry','MW (g/mol)','Weight (mg)','Volume (mL)','Molarity (mM)'],[['KCl','74.55','1,863.75','100','250'],['NaCl','58.44','5,844','100','1,000'],['Tris base','121.14','6,057','500','100'],['Formula example','100','5','50/E4','50/D4']])}<p class="small-note">D4 is Volume and E4 is Molarity in the example row. Fill either one to calculate the other.</p>`},
    protocols: {title:'Variant A comparison · run 01', section:'Biology Notebook',rail:['Example enzyme project','Variant A comparison · run 01'],content:`<span class="trial-example-tag">Method saved with this run</span>${protocolSteps(page?.protocolSnapshot || exampleProtocol,page?.values)}<h4>Observation</h4><p>${escape(page?.result)}</p><p class="small-note">Start a new experiment to reuse the fillable template with fresh values.</p>`},
    workflows: {title:'Protein production',section:'Workflows',rail:['Workflow templates','Protein production','Culture expansion'],content:`<h3>One process. Separate records for every run.</h3>${table(['Run','Completed steps','Next step'],[['Run 01','4 / 4','Finished'],['Run 02','2 / 4','Measure activity'],['Run 03','1 / 4','Purify protein']])}<p>Grow cells → Purify protein → Measure activity → Archive aliquots</p><p class="small-note">Each step keeps its result, completion date, and linked notebook page.</p>`},
    cloning: {title:'Example fragment · 399 bp',section:'Sequence Viewer',rail:['Example fragment','399 bp · Circular DNA'],content:`<code class="trial-example-dna">${cloning.original.slice(0,198)}<mark>GCT</mark>${cloning.original.slice(201)}</code>`},
    'protein-builder': {title:'Example protein–GS–TEV–6×His',section:'Protein Builder',rail:['Common peptide tags','Linkers','Protease sites'],content:`<h3>Read the chain from N to C</h3><p>Example protein → GS linker → TEV cleavage site → 6×His tag</p><h4>Assembled protein sequence</h4><code class="trial-example-dna">${window.HikariTrialModel.proteinBuilderExample().rows.map(row=>row.sequence).join('')}</code><p>103 amino acids · Add blocks, arrange the chain, then build its coding DNA.</p>`},
    samples: {title:'Example box',section:'Sample Storage · −20 °C',rail:['Room temperature','4 °C','−20 °C · Example box','−80 °C','Liquid nitrogen'],content:`<h3>${exampleBox.gridRows} × ${exampleBox.gridCols} freezer box</h3><div class="trial-example-wells" style="--trial-example-columns:${exampleBox.gridCols}" aria-label="Example freezer box">${Array.from({length:exampleBox.wells.length},(_,i)=>`<div class="trial-example-well${i<3?' is-filled':''}"><span>W${i+1}</span>${i<3?`<strong>${escape(state.samples.find(s=>s.id===`demo-sample-${i}`)?.code)}</strong>`:''}</div>`).join('')}</div>${table(['Sample','Concentration','Position'],state.samples.filter(s=>s.id.startsWith('demo-sample-')).map((s,i)=>[s.name,s.concentration,`W${i+1}`]))}`}
  };
  const example = configs[feature] || configs[window.HikariTrialModel.DEFAULT_FEATURE];
  const preview = document.createElement('section');
  preview.id = 'trial-example-preview';
  preview.className = 'trial-example-preview';
  preview.setAttribute('aria-label',example.section);
  preview.innerHTML = `<aside class="app-left-rail trial-example-rail"><h2>${escape(example.section)}</h2>${example.rail.map((label,i)=>`<div class="trial-example-record${i===1?' is-selected':''}">${escape(label)}</div>`).join('')}</aside><article class="panel trial-example-main"><header><h2>${escape(example.title)}</h2><p class="small-note">Example enzyme project · Fictional trial data</p></header><div class="trial-example-content">${example.content}</div></article>`;
  // Place it outside the inert app shell so readers can inspect the examples.
  document.body.append(preview);
  document.body.classList.add('trial-example-active');
  window.HikariBrowserTrial.dismissExample = () => {
    preview.remove();
    document.body.classList.remove('trial-example-active');
  };
})();
