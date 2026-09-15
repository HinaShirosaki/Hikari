// Real Biology Notebook module, isolated data, stubbed Codex response and reload.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-experiment-suggestions-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw result.error || new Error(`Electron check failed: ${result.status} (${result.signal || ''})`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const url = file => pathToFileURL(path.join(root, file)).href;
    const fixture = path.join(temp, 'fixture.html');
    const artifacts = path.join(root, 'artifacts/notebook-experiment-suggestions');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}"><style>body{display:block;padding:1rem}#biology-notebook-view{height:calc(100vh - 2rem)}</style></head><body>${fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8')}</body></html>`);
    const win = new BrowserWindow({ width: 1320, height: 860, show: false, webPreferences: { contextIsolation: true, sandbox: false } });
    const bootstrap = `(async () => {
      const {initLabNotebook} = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/index.js'))});
      const protocol = {id:'prot',name:'Growth measurement',steps:[{id:'step',text:'Compare the treatment with the control.',placeholders:[]}]};
      const makeEntry = (id,status,title) => ({id,notebookType:'biology',projectId:'p',projectName:'Growth study',protocolId:'prot',protocolName:protocol.name,protocolSnapshot:protocol,experimentName:title,experimentNameSource:'user',notebookState:status,updatedAt:'2026-09-08T01:00:00Z',values:{},result:'',resultFiles:[],resultFileRecords:[]});
      window.state = JSON.parse(localStorage.getItem('qa-state') || 'null') || {projects:[{id:'p',name:'Growth study',description:'Compare the effect of growth conditions.'}],protocols:[protocol],notebookEntries:[makeEntry('done','executed','Completed control'),makeEntry('planned','planned','Planned comparison'),makeEntry('long','executed','A deliberately very long experiment name that overflows the rail and gets clipped')],samples:[],assays:[],workflows:[],settings:{storagePath:''}};
      window.requestCount = 0;
      window.pendingResponse = null;
      window.hikariApi = {
        listPaperFindingTasks: async () => ({ok:true,tasks:[]}),
        suggestNextExperiment: async () => {
          window.requestCount++;
          await new Promise(resolve => {window.pendingResponse=resolve;});
          const entry = makeEntry('','suggested','Compare the next growth condition');
          entry.agentDraftMeta={source:'agent_notebook_suggestion_v1',suggestionRunId:'run-'+window.requestCount,rationale:'Compare the next condition against the recorded control.'};
          entry.result='Suggestion rationale: Compare the next condition against the recorded control.';
          return {ok:true,notebook:{protocol:{id:protocol.id,name:protocol.name},project:{id:'p',name:'Growth study'},notebook_type:'biology',save:{mode:'suggestion_only'},entry_template:entry}};
        }
      };
      let serial = 0;
      window.notebook = initLabNotebook({state:window.state,persist:()=>localStorage.setItem('qa-state',JSON.stringify(window.state)),createId:()=> 'qa-'+(++serial)+'-'+Date.now(),safeText:value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),onNotebookEntriesChanged:()=>{},onProjectsChanged:()=>{}});
      document.getElementById('biology-notebook-view').classList.add('is-active');
      window.notebook.renderProjectOptions();window.notebook.renderEntries();
      window.check = (condition,message) => {if(!condition) throw new Error(message);};
      window.settle = () => new Promise(resolve=>setTimeout(resolve,80));
    })()`;
    try {
      await win.loadFile(fixture);
      await win.webContents.executeJavaScript(bootstrap);
      await win.webContents.executeJavaScript(`(async () => {
        notebook.openProjectDashboard('p');
        document.querySelector('[data-suggest-experiment]').click();
        await settle();check(requestCount===1,'Project button starts one background request');
        check(document.querySelector('[data-suggest-experiment]').disabled,'Running button disabled');
        notebook.openEntry('done');
        pendingResponse();await settle();
        check(document.getElementById('biology-notebook-protocol-title').textContent==='Completed control','Completion preserves current page');
        const first=document.querySelector('[data-notebook-entry-id]');
        check(first.classList.contains('is-suggested'),'Suggested page sorts before newer completed and planned pages');
        check(first.textContent.includes('Suggested'),'Suggested label is visible');
        window.suggestionId=first.dataset.notebookEntryId;
        first.click();await settle();
        check(!document.getElementById('biology-notebook-take-into-plan-btn').hidden,'Take into plan shown on suggested page');
        check(document.getElementById('biology-notebook-mark-executed-btn').hidden,'Cannot execute an unaccepted suggestion');
        const row=document.querySelector('[data-notebook-entry-id="'+suggestionId+'"]');
        const style=getComputedStyle(row), nameStyle=getComputedStyle(row.querySelector('.biology-notebook-page-name'));
        check(style.backgroundImage.includes('linear-gradient'),'Spectrum gradient survives cascade');
        check(style.fontStyle==='italic' && nameStyle.color==='rgb(80, 84, 90)','Italic dark-grey suggestion text: '+style.fontStyle+' / '+nameStyle.color);
        row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        const reasonBox=document.querySelector('.biology-notebook-suggestion-reason');
        check(reasonBox && !reasonBox.hidden && reasonBox.textContent.includes('recorded control'),'Hover textbox shows the suggestion reason');
        check(reasonBox.getBoundingClientRect().right<=window.innerWidth,'Reason textbox fits the viewport');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        check(reasonBox.hidden,'Escape dismisses the reason');
        const longRow=document.querySelector('[data-notebook-entry-id="long"]');
        longRow.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        check(!reasonBox.hidden && reasonBox.textContent.startsWith('A deliberately very long experiment name'),'Hovering a clipped name shows the full name');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        document.querySelector('[data-notebook-entry-id="done"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        check(reasonBox.hidden,'Short unclipped names show no textbox');
        row.blur();
        row.focus();
        row.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
        check(!reasonBox.hidden,'Keyboard focus reveals the reason');
        row.blur();
        row.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
        check(reasonBox.hidden,'Leaving keyboard focus hides the reason');
        document.getElementById('biology-notebook-result').value += '\\nUser review note.';
        await notebook.saveUnsavedChanges();
        check(state.notebookEntries.find(e=>e.id===suggestionId).notebookState==='suggested','Ordinary save preserves Suggested');
      })()`);
      await win.webContents.executeJavaScript('document.activeElement?.blur();');
      fs.writeFileSync(path.join(artifacts, 'suggested.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.querySelector('[data-suggestion-reason]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));`);
      fs.writeFileSync(path.join(artifacts, 'suggestion-reason.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.querySelector('[data-notebook-entry-id="long"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));`);
      fs.writeFileSync(path.join(artifacts, 'long-name.png'), (await win.webContents.capturePage()).toPNG());
      await win.reload();
      await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      await win.webContents.executeJavaScript(bootstrap);
      const result = await win.webContents.executeJavaScript(`(async () => {
        const suggestion=state.notebookEntries.find(e=>e.notebookState==='suggested');
        check(suggestion && suggestion.result.includes('User review note.'),'Suggested page and edits persist after reload');
        notebook.openEntry(suggestion.id);await settle();
        check(!document.getElementById('biology-notebook-take-into-plan-btn').hidden,'Acceptance action restored after reload');
        document.getElementById('biology-notebook-take-into-plan-btn').click();await settle();
        const planned=state.notebookEntries.find(e=>e.id===suggestion.id);
        check(planned.notebookState==='planned','Acceptance changes the same entry to Planned');
        document.getElementById('biology-notebook-result').focus();
        const selectedRow=document.querySelector('[data-notebook-entry-id="'+suggestion.id+'"]');
        check(selectedRow.classList.contains('is-active'),'Open page stays selected while editing notes');
        check(getComputedStyle(selectedRow).backgroundColor!=='rgba(0, 0, 0, 0)','Open page highlight remains visible without row focus');
        check(!document.getElementById('biology-notebook-mark-executed-btn').hidden,'Executed action now available');
        check(document.getElementById('biology-notebook-take-into-plan-btn').hidden,'Acceptance action removed');
        check(!document.querySelector('[data-notebook-entry-id="'+suggestion.id+'"]').classList.contains('is-suggested'),'Suggestion tint removed after acceptance');
        document.getElementById('biology-notebook-mark-executed-btn').click();await settle();
        check(requestCount===1 && pendingResponse,'Marking executed automatically starts the next suggestion');
        check(state.notebookEntries.find(e=>e.id===suggestion.id).notebookState==='executed','Accepted page can be executed');
        pendingResponse();await settle();
        check(state.notebookEntries.filter(e=>e.notebookState==='suggested').length===1,'Automatic result delivered');
        notebook.openEntry('planned');
        document.getElementById('biology-notebook-mark-executed-btn').click();await settle();
        check(requestCount===1,'Existing unaccepted suggestion suppresses another automatic run');
        notebook.openEntry(state.notebookEntries.find(e=>e.notebookState==='suggested').id);
        return {requests:requestCount,entries:state.notebookEntries.length,statuses:state.notebookEntries.map(e=>e.notebookState)};
      })()`);
      await win.webContents.executeJavaScript("(async () => {document.body.classList.add('theme-night'); await settle();})()");
      fs.writeFileSync(path.join(artifacts, 'suggested-night.png'), (await win.webContents.capturePage()).toPNG());
      console.log('Notebook suggestion Electron QA passed: ' + JSON.stringify(result));
    } finally { win.destroy(); app.quit(); }
  }).catch(error => { console.error(error); app.exit(1); });
}
