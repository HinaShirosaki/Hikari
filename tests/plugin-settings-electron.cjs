// Run: node node_modules/electron/cli.js tests/plugin-settings-electron.cjs
// Real Settings UI, manifest inspection, persistence, and isolated plugin bridge.
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerPluginIpc } = require('../src/main/ipc/register-plugin-ipc');

const root = path.resolve(__dirname, '..');
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-plugin-settings-'));
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
let win, servers, checks = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, message) => { assert.ok(value, message); checks++; };
const url = file => pathToFileURL(path.join(root, file)).href;

async function run() {
  await app.whenReady();
  servers = registerPluginIpc({ app, ipcMain, session, dialog, fs });
  await fs.writeFile(path.join(temp, 'preload.cjs'), `
    const { contextBridge, ipcRenderer } = require('electron');
    const { createPluginApi } = require(${JSON.stringify(path.join(root, 'src/main/preload/api/plugin-api.js'))});
    contextBridge.exposeInMainWorld('hikariApi', {
      ...createPluginApi(ipcRenderer),
      pickStorageDirectory: async () => ({ok:true,path:${JSON.stringify(path.join(root, 'examples/plugins/settings-demo'))}})
    });
  `);
  const settings = await fs.readFile(path.join(root, 'ui/html/views/setting-view.html'), 'utf8');
  await fs.writeFile(path.join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}"></head><body><div class="workspace-main">
    ${settings.replace('class="view"', 'class="view is-active"')}</div><script type="module" src="host.mjs"></script></body></html>`);
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    import { normalizeState } from ${JSON.stringify(url('src/renderer/modules/app-state/state-normalizer.js'))};
    import { settingsManifest } from ${JSON.stringify(url('src/renderer/module-manifests/settings.js'))};
    import { installPlugins } from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    import { createPluginBridge } from ${JSON.stringify(url('src/renderer/app/plugin-bridge.js'))};
    window.qaState = normalizeState(JSON.parse(localStorage.getItem('state') || '{}'));
    qaState.settings.plugins = qaState.settings.plugins.filter(p => !p.bundled);
    window.qaFailPersist = false;
    const persist = () => {
      if (qaFailPersist) throw new Error('Disk full');
      localStorage.setItem('state', JSON.stringify(qaState));
    };
    window.qaController = settingsManifest.init(settingsManifest.createOptions({ state:qaState, persist,
      onReloadRequested:()=>location.reload(), rendererServices:{inventory:{}}, rootDocument:document, windowObject:window }));
    qaController.renderForms();
    document.querySelector('[data-settings-target="plugins"]').click();
    window.qaBridge = createPluginBridge({state:qaState,windowObject:window,persist});
    installPlugins({state:qaState,documentObject:document,appRegistry:[],bridge:qaBridge,api:hikariApi});
    // Observe calls and events forwarded by the real example frame.
    window.qaValues = null; window.qaEvents = 0; window.qaPending = new Map(); window.qaNextId = 0;
    window.qaCall = (verb, params={}) => new Promise((resolve,reject) => {
      const frame = document.querySelector('.plugin-frame');
      const id = 'qa-' + ++qaNextId;
      qaPending.set(id,{resolve,reject});
      frame.contentWindow.postMessage({qaCall:true,id,verb,params}, new URL(frame.src).origin);
    });
    window.addEventListener('message', event => {
      const frame = document.querySelector('.plugin-frame');
      if (!frame || event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin) return;
      if (event.data.qaResult) {
        const pending = qaPending.get(event.data.id);
        qaPending.delete(event.data.id);
        if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data.result);
      }
      if (event.data.qaValues) { window.qaValues = event.data.values; window.qaEvents++; }
    });
    window.qaReady = true;
  `);
  win = new BrowserWindow({ show: false, width: 1280, height: 960, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(temp, 'preload.cjs')
  } });
  const errors = [];
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async code => {
    for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await pause(20); }
    throw new Error(`Timed out: ${code}\n${errors.join('\n')}`);
  };
  const form = 'document.querySelector("[data-plugin-settings=settings-demo]")';
  const field = key => `${form}.querySelector('[data-plugin-setting=${key}]')`;
  const set = (key, value) => evaluate(`{
    const input=${field(key)}; ${typeof value === 'boolean' ? `input.checked=${value}` : `input.value=${JSON.stringify(String(value))}`};
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  const action = name => evaluate(`${form}.querySelector(${JSON.stringify(name === 'save' ? '[type=submit]' : `[data-plugin-settings-${name}]`)}).click()`);
  const stateValue = key => evaluate(`qaState.settings.pluginSettings['settings-demo']?.[${JSON.stringify(key)}]`);
  const reload = async () => { await evaluate('location.reload()'); await waitFor('window.qaReady'); };
  await win.loadFile(path.join(temp, 'index.html'));
  await waitFor('window.qaReady');
  await evaluate('document.getElementById("setting-plugins-add-btn").click()');
  await waitFor(`${form} !== null`);
  check(await evaluate('qaState.settings.plugins[0].settings.length === 4'), 'Installation preserves the schema');
  await evaluate(`${form}.closest('details').open=true`);
  check(await evaluate(`${field('autoSave')}.checked && ${field('resolution')}.value==='300' && ${field('defaultFormat')}.value==='svg'`), 'All four control types display their defaults');
  check(await evaluate(`${form}.querySelector('[type=submit]').disabled`), 'An unchanged form cannot be saved');
  await set('author', 'Ada');
  await evaluate('qaController.renderForms()');
  check(await evaluate(`${field('author')}.value==='Ada' && !${form}.querySelector('[type=submit]').disabled`), 'Drafts survive Settings rerenders');
  await action('discard');
  check(await evaluate(`${field('author')}.value===''`), 'Discard restores current saved preferences');
  await set('resolution', 71);
  await action('save');
  check(await evaluate(`${field('resolution')}.validity.rangeUnderflow`) && await stateValue('resolution') === undefined, 'Invalid numbers cannot be saved');
  await set('resolution', 600);
  await set('author', 'Ada');
  await set('autoSave', false);
  await set('defaultFormat', 'png');
  await action('save');
  check(await stateValue('author') === 'Ada' && await stateValue('resolution') === 600 && await stateValue('autoSave') === false, 'Save persists validated values of each type');
  check(await evaluate('JSON.parse(localStorage.getItem("state")).settings.pluginSettings["settings-demo"].defaultFormat === "png"'), 'Preferences reach durable app state');
  await reload();
  check(await evaluate(`${field('author')}.value==='Ada' && ${field('resolution')}.value==='600' && !${field('autoSave')}.checked`), 'Reload retains the installed schema and preferences');

  // Instrument the real example frame through Electron's frame execution API.
  await waitFor('document.querySelector(".plugin-frame")?.src.startsWith("http://127.0.0.1:")');
  const frame = () => win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1:'));
  let clientReady = false;
  for (let i = 0; i < 150 && !clientReady; i++) {
    clientReady = await frame()?.executeJavaScript('Boolean(window.HikariPlugin?.hikari)').catch(() => false);
    if (!clientReady) await pause(20);
  }
  check(clientReady, `The example frame loads its client: ${errors.join('; ')}`);
  await frame().executeJavaScript(`
    window.addEventListener('message', async event => {
      if (!event.data.qaCall || event.source !== window.parent) return;
      try { const result = await HikariPlugin.hikari.call(event.data.verb,event.data.params);
        parent.postMessage({qaResult:true,id:event.data.id,result},'*');
      } catch(error) { parent.postMessage({qaResult:true,id:event.data.id,error:error.message},'*'); }
    });
    HikariPlugin.hikari.on('settings.changed', ({values}) => parent.postMessage({qaValues:true,values},'*'));
  `);
  check((await evaluate('qaCall("settings.get")')).values.author === 'Ada', 'The running plugin reads its persisted preferences');
  await evaluate(`${form}.closest('details').open=true`);
  await set('author', 'Draft author');
  await evaluate('qaCall("settings.set",{values:{resolution:900,author:"Grace"}})');
  await waitFor('qaValues?.resolution===900');
  check(await evaluate(`${field('author')}.value==='Draft author' && ${field('resolution')}.value==='900'`), 'Live plugin updates preserve edited fields and update untouched fields');
  await action('save');
  check((await evaluate('qaCall("settings.get")')).values.author === 'Draft author' && await stateValue('resolution') === 900, 'Saving a draft preserves a concurrent plugin change');
  await evaluate('qaCall("storage.set",{value:{records:["x"]}}).catch(error=>{window.qaDenied=error.message})');
  check(await evaluate('qaDenied.includes("storage")'), 'The settings grant does not confer blob access');
  await set('author', 'Retry me');
  await evaluate('qaFailPersist=true; window.qaEventsBefore=qaEvents');
  await action('save');
  check(await stateValue('author') === 'Draft author' && await evaluate(`${field('author')}.value==='Retry me' && ${form}.querySelector('[data-plugin-settings-status]').textContent.includes('Disk full') && qaEvents===qaEventsBefore`), 'Failed saves roll back state, keep the draft, and send no event');
  await evaluate('qaFailPersist=false');
  await action('save');
  check(await stateValue('author') === 'Retry me', 'Failed saves can be retried');
  await action('reset');
  check(await stateValue('author') === 'Retry me' && await evaluate(`${field('author')}.value===''`), 'Reset defaults prepares a draft without saving');
  await action('save');
  await waitFor('qaValues?.author==="" && qaValues?.resolution===300');
  check((await evaluate('qaCall("settings.get")')).values.autoSave === true, 'Saving defaults updates the live plugin');

  await evaluate('qaState.settings.plugins[0].settings[1].label="<img src=x onerror=alert(1)>"; qaController.renderForms()');
  check(await evaluate(`${form}.textContent.includes('<img src=x onerror=alert(1)>') && !${form}.querySelector('img')`), 'Manifest labels render as text');
  await evaluate('qaState.settings.plugins[0].settings[1].label="Author"; qaController.renderForms()');
  await set('author', 'Remember me');
  await action('save');
  if (process.env.HIKARI_QA_SCREENSHOT) {
    await evaluate(`${form}.closest('details').open=true; ${form}.scrollIntoView({block:'center'})`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(process.env.HIKARI_QA_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  await evaluate('document.querySelector("[data-plugin-remove]").click()');
  check(await stateValue('author') === 'Remember me', 'Removing a plugin retains its preferences');
  await evaluate('document.getElementById("setting-plugins-add-btn").click()');
  await waitFor(`${form} !== null`);
  check(await evaluate(`${field('author')}.value==='Remember me'`), 'Reinstallation restores saved preferences');
  check(errors.length === 0, `No renderer errors: ${errors.join('; ')}`);
  console.log(`Plugin settings Electron: ${checks} checks passed.`);
}

const timeout = setTimeout(() => { console.error('Plugin settings QA timed out'); app.exit(1); }, 45000);
run().then(() => 0, error => { console.error(error.stack || error); return 1; }).then(async code => {
  clearTimeout(timeout);
  win?.destroy();
  await servers?.closeAll();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
});
