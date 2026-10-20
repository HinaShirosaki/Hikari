// Run: node node_modules/electron/cli.js tests/settings-plugins-electron.cjs
// Real Settings markup/controller, unload guard, manifest IPC and plugin loader.
// All installation state lives in a disposable Electron profile.
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerPluginIpc } = require('../src/main/ipc/register-plugin-ipc');
const { createMainDataHelpers } = require('../src/main/data/data-helpers');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { importStorageRoot } = require('../src/main/storage/storage-import');

const root = path.resolve(__dirname, '..');
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-settings-plugins-'));
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
let win, servers, prevented = 0, checks = 0;
let storageGate = null, failStorage = false, storageCalls = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const url = file => pathToFileURL(path.join(root, file)).href;

async function run() {
  await app.whenReady();
  servers = registerPluginIpc({ ipcMain, session, dialog, fs });
  const storagePath = path.join(temp, 'workspace');
  await fs.mkdir(storagePath, { recursive: true });
  const helpers = createMainDataHelpers({ fs, path, syncBundleFromSnapshot, hasSupportedDataExtension: () => true,
    getDefaultDataFilePath: () => path.join(temp, 'hikari-data.json') });
  ipcMain.handle('qa:auto-save', async (_event, data) => {
    storageCalls++;
    if (storageGate) await storageGate;
    return failStorage ? { ok: false, error: 'Disk full' } : helpers.autoSaveDataFile({ data });
  });
  ipcMain.handle('qa:read-protocols', async () => (await importStorageRoot({ storagePath })).statePatch?.protocols || []);
  const [settings, shell] = await Promise.all([
    fs.readFile(path.join(root, 'ui/html/views/setting-view.html'), 'utf8'),
    fs.readFile(path.join(root, 'ui/html/shell/end.html'), 'utf8')
  ]);
  const unsavedDialog = shell.match(/  <div id="unsaved-changes-overlay"[\s\S]*?(?=  <script)/)[0];
  await fs.writeFile(path.join(temp, 'preload.cjs'), `
    const { contextBridge, ipcRenderer } = require('electron');
    const { createPluginApi } = require(${JSON.stringify(path.join(root, 'src/main/preload/api/plugin-api.js'))});
    contextBridge.exposeInMainWorld('hikariApi', {
      ...createPluginApi(ipcRenderer),
      autoSaveDataFile: data => ipcRenderer.invoke('qa:auto-save', data),
      qaReadProtocols: () => ipcRenderer.invoke('qa:read-protocols'),
      pickStorageDirectory: async () => ({ok:true,path:${JSON.stringify(path.join(root, 'plugins/qpcr-analysis'))}})
    });
  `);
  await fs.writeFile(path.join(temp, 'index.html'), `<!doctype html><html><head>
    <meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}">
    </head><body><div class="workspace-main">${settings.replace('class="view"', 'class="view is-active"')}
    <section id="tool-box-view"><div class="tool-grid"></div><div class="tool-content"></div></section></div>${unsavedDialog}
    <script type="module" src="host.mjs"></script></body></html>`);
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    import { defaultState } from ${JSON.stringify(url('src/renderer/modules/app-state/index.js'))};
    import { settingsManifest } from ${JSON.stringify(url('src/renderer/module-manifests/settings.js'))};
    import { createUnsavedChangesService } from ${JSON.stringify(url('src/renderer/services/unsavedChangesService.js'))};
    import { flushMarkdownRecordState, syncMarkdownRecordState } from ${JSON.stringify(url('src/renderer/services/markdown-record-storage.js'))};
    import { installPlugins } from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    import { createPluginBridge } from ${JSON.stringify(url('src/renderer/app/plugin-bridge.js'))};
    window.qaBoot = Number(sessionStorage.getItem('boot') || 0) + 1;
    sessionStorage.setItem('boot', qaBoot);
    window.qaState = JSON.parse(localStorage.getItem('state') || 'null') || structuredClone(defaultState);
    if (!localStorage.getItem('state')) qaState.settings.plugins = [];
    qaState.settings.storagePath = ${JSON.stringify(storagePath)};
    const storedProtocols = await hikariApi.qaReadProtocols();
    qaState.protocols = storedProtocols.length ? storedProtocols : [{id:'qa-protocol',name:'QA protocol',purpose:'Saved protocol',steps:['Mix.']}];
    const persist = () => {
      localStorage.setItem('state', JSON.stringify(qaState));
      void syncMarkdownRecordState(hikariApi, qaState);
    };
    window.qaDirty = false; window.qaPluginDirty = false; window.qaFailSave = false;
    window.qaResponses = [];
    const editor = {
      hasUnsavedChanges: () => qaDirty,
      saveUnsavedChanges: async () => {
        if (qaFailSave) return false;
        qaDirty = false;
        sessionStorage.setItem('saved', Number(sessionStorage.getItem('saved') || 0) + 1);
        qaState.protocols[0].purpose = 'Saved draft ' + sessionStorage.getItem('saved');
        persist(); return true;
      }
    };
    window.qaGuard = createUnsavedChangesService({
      moduleRegistry: {get: key => key === 'protocol' ? editor : null},
      api: {respondToAppClose: action => qaResponses.push(action)},
      flushPendingSaves: () => flushMarkdownRecordState(hikariApi, qaState),
      externalSources: () => [{key:'plugin-test',label:'Plugin draft',moduleApi:{hasUnsavedChanges:()=>qaPluginDirty}}],
      documentObject: document, windowObject: window
    });
    const controller = settingsManifest.init(settingsManifest.createOptions({
      state:qaState, persist, onReloadRequested:qaGuard.requestReload,
      rendererServices:{inventory:{}}, rootDocument:document, windowObject:window
    }));
    controller.renderForms();
    document.querySelector('[data-settings-target="plugins"]').click();
    const bridge = createPluginBridge({state:qaState,windowObject:window,persist});
    installPlugins({state:qaState,documentObject:document,appRegistry:[],bridge,api:hikariApi});
    window.qaReady = true;
  `);
  win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(temp, 'preload.cjs')
  } });
  win.webContents.on('will-prevent-unload', () => { prevented += 1; });
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async code => {
    for (let i = 0; i < 100; i += 1) {
      if (await evaluate(code)) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${code}`);
  };
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await win.loadFile(path.join(temp, 'index.html'));
  await waitFor('window.qaReady');
  await click('setting-plugins-add-btn');
  await waitFor('qaState.settings.plugins.length === 1');
  check(await evaluate('document.getElementById("setting-plugins-status").textContent === "1 plugin installed."'), 'Adding qPCR omits the added/reload confirmation');

  await evaluate('qaDirty = true; location.reload()');
  await pause(150);
  check(prevented === 1 && await evaluate('qaBoot === 1'), 'Reproduces the old direct reload being silently blocked by a dirty editor');
  await click('setting-plugins-reload-btn');
  check(await evaluate('!document.getElementById("unsaved-changes-overlay").hidden && document.getElementById("unsaved-changes-title").textContent === "Save changes before reloading?"'), 'Reload button opens the unsaved-changes dialog');
  check(await evaluate('document.getElementById("unsaved-changes-save-btn").textContent === "Save & Reload"'), 'Save action describes a reload');
  await click('unsaved-changes-cancel-btn');
  check(await evaluate('qaBoot === 1 && qaDirty && document.getElementById("unsaved-changes-overlay").hidden && !qaResponses.length'), 'Cancel preserves the draft without sending a quit response');

  await click('setting-plugins-reload-btn');
  await evaluate('qaFailSave = true');
  await click('unsaved-changes-save-btn');
  await waitFor('document.getElementById("unsaved-changes-status").textContent.includes("Could not save Protocol")');
  check(await evaluate('qaBoot === 1 && qaDirty && !document.getElementById("unsaved-changes-save-btn").disabled'), 'Failed saves keep the draft open and retryable');
  await evaluate('qaFailSave = false');
  failStorage = true;
  await click('unsaved-changes-save-btn');
  await waitFor('document.getElementById("unsaved-changes-status").textContent.includes("Disk full")');
  check(await evaluate('qaBoot === 1 && !qaDirty && !document.getElementById("unsaved-changes-save-btn").disabled'), 'A disk failure blocks reload after the editor becomes clean and leaves Save available for retry');
  failStorage = false;
  let releaseStorage;
  storageGate = new Promise(resolve => { releaseStorage = resolve; });
  const previousCalls = storageCalls;
  await click('unsaved-changes-save-btn');
  for (let i = 0; i < 100 && storageCalls === previousCalls; i++) await pause(10);
  check(storageCalls > previousCalls && await evaluate('qaBoot === 1 && document.getElementById("unsaved-changes-save-btn").disabled'), 'Retry waits for the durable save before navigating');
  releaseStorage(); storageGate = null;
  await waitFor('window.qaReady && qaBoot === 2');
  check(await evaluate('sessionStorage.getItem("saved") === "1"'), 'Save & Reload saves before navigating');
  check(await evaluate('qaState.protocols[0].purpose === "Saved draft 1"'), 'Reading the real Markdown record after reload preserves the edited protocol');
  await waitFor('document.querySelector("#plugin-qpcr-analysis-tool iframe")?.src.startsWith("http://127.0.0.1:")');
  check(await evaluate('qaState.settings.plugins[0].id === "qpcr-analysis"'), 'Real reload retains qPCR installation and mounts its tool frame');

  await evaluate('qaDirty = true; qaPluginDirty = true');
  await click('setting-plugins-reload-btn');
  check(await evaluate('document.getElementById("unsaved-changes-save-btn").textContent === "Save 2 & Reload" && document.getElementById("unsaved-changes-discard-btn").textContent === "Discard All & Reload"'), 'Plugin drafts participate in the reload guard');
  await click('setting-plugins-reload-btn');
  check(await evaluate('document.querySelectorAll("#unsaved-changes-list input:checked").length === 2'), 'Repeated reload clicks preserve the active choice');
  await evaluate('const box = document.querySelectorAll("#unsaved-changes-list input")[1]; box.checked = false; box.dispatchEvent(new Event("change"))');
  await click('unsaved-changes-save-btn');
  await waitFor('window.qaReady && qaBoot === 3');
  check(prevented === 1 && await evaluate('sessionStorage.getItem("saved") === "2"'), 'Selective save reloads even when an unchecked plugin draft remains dirty');

  await evaluate('qaDirty = true');
  await click('setting-plugins-reload-btn');
  await click('unsaved-changes-discard-btn');
  await waitFor('window.qaReady && qaBoot === 4');
  check(await evaluate('sessionStorage.getItem("saved") === "2"'), 'Discard & Reload navigates without saving');
  await click('setting-plugins-reload-btn');
  await waitFor('window.qaReady && qaBoot === 5');
  check(prevented === 1, 'Clean reload navigates immediately');

  await evaluate('qaDirty = true; qaGuard.handleCloseRequested()');
  check(await evaluate('document.getElementById("unsaved-changes-title").textContent === "Save changes before quitting?" && document.getElementById("unsaved-changes-save-btn").textContent === "Save & Quit"'), 'Normal close retains quit wording');
  await click('unsaved-changes-cancel-btn');
  check(await evaluate('qaResponses.join(",") === "pending,cancel"'), 'Normal close retains the main-process handshake');
  console.log(`Settings plugins Electron: ${checks} checks passed.`);
}

const timeout = setTimeout(() => { console.error('Settings plugins QA timed out'); app.exit(1); }, 30000);
run().then(() => 0, error => { console.error(error.stack || error); return 1; }).then(async code => {
  clearTimeout(timeout);
  win?.destroy();
  await servers?.closeAll();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
});
