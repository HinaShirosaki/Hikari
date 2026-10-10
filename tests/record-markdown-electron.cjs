// Real protocol/notebook editors, WebCrypto, IPC, storage, reload and PDF output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-markdown-electron-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw result.error || new Error(`Electron check failed: ${result.status} (${result.signal || ''})`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { createMainDataHelpers } = require('../src/main/data/data-helpers');
  const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
  const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration');
  const { importStorageRoot } = require('../src/main/storage/storage-import');
  const { blocks, block } = require('../src/main/storage/record-markdown/document-fields');
  const { createAgentNotebookLookupRuntime } = require('../src/main/agent/tools/agent-notebook-lookup');
  const temp = process.argv[2];
  const storage = path.join(temp, 'storage');
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const url = file => pathToFileURL(path.join(root, file)).href;
    const helpers = createMainDataHelpers({ fs: fsp, path, syncBundleFromSnapshot, hasSupportedDataExtension: () => true });
    let lastSave;
    ipcMain.handle('markdown-qa-save', async (_event, state) => {
      lastSave = await helpers.autoSaveDataFile({ data: state, filePath: '' });
      assert.equal(lastSave.ok, true, lastSave.error);
      return lastSave;
    });
    ipcMain.handle('markdown-qa-load', async () => (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: storage } } })).snapshot);
    ipcMain.handle('markdown-qa-import', async () => (await importStorageRoot({ storagePath: storage })).statePatch);
    ipcMain.handle('markdown-qa-edit', async () => {
      for (const [file, field, content] of [
        [lastSave.sidecarPaths.protocolFilePaths[0], 'purpose', '## Purpose\n\nPurpose from the external Markdown editor.'],
        [lastSave.sidecarPaths.notebookPageFolderPaths[0], 'result', '## Notes and results\n\nExternal pressure-test observation.']
      ]) {
        const md = file.replace(/\.json$/, '.md');
        const source = await fsp.readFile(md, 'utf8');
        await fsp.writeFile(md, source.replace(blocks(source).get(field).source, block('field', field, content)));
      }
    });
    ipcMain.handle('markdown-qa-search', async () => {
      const lookup = createAgentNotebookLookupRuntime({ buildLookupContext: async () => {
        const hydrated = await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: storage } } });
        return { hydratedSnapshot: hydrated.snapshot, migration: hydrated.migration, warnings: [] };
      } });
      return lookup.searchNotebookEntries({ query: 'External pressure-test', detail: 'full' });
    });
    ipcMain.handle('markdown-qa-pdf', async (_event, name, bytes) => {
      const buffer = Buffer.from(bytes);
      assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
      assert.ok(buffer.length > 2000);
      await fsp.writeFile(path.join(temp, path.basename(name)), buffer);
      return true;
    });
    const preload = path.join(temp, 'preload.cjs');
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',{
      autoSaveDataFile:(state)=>ipcRenderer.invoke('markdown-qa-save',state),
      qaLoad:()=>ipcRenderer.invoke('markdown-qa-load'),qaImport:()=>ipcRenderer.invoke('markdown-qa-import'),
      qaEdit:()=>ipcRenderer.invoke('markdown-qa-edit'),qaSearch:()=>ipcRenderer.invoke('markdown-qa-search'),
      qaPdf:(name,bytes)=>ipcRenderer.invoke('markdown-qa-pdf',name,bytes)
    });`);
    const fixture = path.join(temp, 'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}"><script src="${url('vendor/jspdf.umd.min.js')}"></script></head><body>${
      fs.readFileSync(path.join(root, 'ui/html/views/protocol-management-view.html'), 'utf8')
    }${fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8')}</body></html>`);
    const win = new BrowserWindow({ width: 1300, height: 900, show: false, webPreferences: { preload, contextIsolation: true, sandbox: false } });
    const errors = [];
    win.webContents.on('console-message', (event) => { if (event.level === 3) errors.push(event.message); });
    try {
      await win.loadFile(fixture);
      await win.webContents.executeJavaScript(`(async()=>{
        const {initProtocolManagement}=await import(${JSON.stringify(url('src/renderer/modules/protocol/index.js'))});
        const {initLabNotebook}=await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/index.js'))});
        const {syncMarkdownRecordState}=await import(${JSON.stringify(url('src/renderer/services/markdown-record-storage.js'))});
        window.check=(condition,message)=>{if(!condition)throw new Error(message);};
        window.state={settings:{storagePath:${JSON.stringify(storage)}},projects:[{id:'project',name:'Pressure project'}],protocols:[],notebookEntries:[],samples:[],assays:[],workflows:[]};
        window.saves=[];window.pdfSaves=[];
        const persist=()=>{const operation=syncMarkdownRecordState(hikariApi,state);saves.push(operation);return operation;};
        window.flush=async()=>{while(saves.length){const results=await Promise.all(saves.splice(0));for(const result of results)check(result.ok,result.error);}};
        let serial=0;const deps={state,persist,createId:()=> 'qa-'+(++serial),safeText:value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
        window.protocols=initProtocolManagement(deps);window.notebook=initLabNotebook(deps);
        document.getElementById('protocol-management-view').classList.add('is-active');
        document.getElementById('create-protocol-btn').click();
        for(const [id,value] of Object.entries({'protocol-name':'Electron protocol','protocol-purpose':'Purpose made in the editor.','protocol-materials':'PBS\\nSample','protocol-steps':'Add [Volume] to the sample.\\nIncubate for 5 minutes.','protocol-troubleshooting':'Avoid bubbles.'}))document.getElementById(id).value=value;
        check(await protocols.saveUnsavedChanges(),'Protocol editor submits');await flush();
        check(state.protocols.length===1,'Protocol created');check(state.protocols[0].markdownRevision,'Protocol revision acknowledged');
        notebook.renderProjectOptions();notebook.renderProtocolOptions();
        document.getElementById('biology-notebook-project-select').value='project';
        notebook.openExperimentDialog();
        document.getElementById('biology-notebook-protocol-select').value=state.protocols[0].id;
        document.getElementById('biology-notebook-protocol-select').dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('biology-notebook-experiment-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        document.getElementById('biology-notebook-result').value='Notes made in the notebook editor.';
        check(await notebook.saveUnsavedChanges(),'Notebook editor submits');await flush();
        check(state.notebookEntries.length===1,'Notebook created');
        window.entryId=state.notebookEntries[0].id;window.protocolId=state.protocols[0].id;
        await hikariApi.qaEdit();
        const loaded=await hikariApi.qaLoad();Object.assign(state,loaded);
        protocols.renderList();notebook.renderProjectOptions();notebook.renderProtocolOptions();notebook.renderEntries();notebook.openEntry(entryId);
        check(document.getElementById('biology-notebook-result').value==='External pressure-test observation.','MD notes consumed by the real editor');
        check(state.protocols[0].purpose==='Purpose from the external Markdown editor.','Protocol Markdown consumed');
        check(state.notebookEntries[0].protocolSnapshot.purpose==='Purpose made in the editor.','Historical protocol snapshot remains frozen');
        const imported=await hikariApi.qaImport();check(imported.notebookEntries[0].result==='External pressure-test observation.','Folder import consumes MD');
        const found=await hikariApi.qaSearch();check(found.items.length===1&&found.source==='markdown','Agent lookup consumes MD');
        document.getElementById('biology-notebook-result').value+='\\nEdited after reload.';
        check(await notebook.saveUnsavedChanges(),'Notebook edits after reload');await flush();
        protocols.editProtocol(protocolId);document.getElementById('protocol-purpose').value+=' Edited after reload.';
        check(await protocols.saveUnsavedChanges(),'Protocol edits after reload');await flush();
        const JsPDF=window.jspdf.jsPDF;
        window.jspdf.jsPDF=function(...args){const doc=new JsPDF(...args);doc.save=name=>{pdfSaves.push(hikariApi.qaPdf(name,Array.from(new Uint8Array(doc.output('arraybuffer')))));};return doc;};
        const {exportProtocolPdf,exportNotebookEntryPdf}=await import(${JSON.stringify(url('src/renderer/modules/pdf-export/index.js'))});
        check(exportProtocolPdf(state.protocols[0]),'Protocol PDF generated');
        check(await exportNotebookEntryPdf({entry:state.notebookEntries[0],protocol:state.notebookEntries[0].protocolSnapshot,project:state.projects[0],safeText:deps.safeText}),'Notebook PDF generated');
        await Promise.all(pdfSaves);check(pdfSaves.length===2,'Two real PDFs captured');
        const final=await hikariApi.qaLoad();check(final.notebookEntries[0].result.endsWith('Edited after reload.'),'Final notebook persisted');
      })()`);
      assert.deepEqual(errors, []);
      console.log('PASS Electron: protocol and notebook creation, Markdown edits, WebCrypto/IPC saves, reload, import, agent lookup and two real PDF exports.');
      win.destroy();app.exit(0);
    } catch (error) { console.error(error.stack);win.destroy();app.exit(1); }
  });
}
