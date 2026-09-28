// Run explicitly with: node node_modules/electron/cli.js tests/plugin-runtime-electron.cjs
// Uses a hidden window and a temporary Electron profile; never opens user data.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerPluginIpc } = require('../src/main/ipc/register-plugin-ipc');

const projectRoot = path.resolve(__dirname, '..');
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'hikari-plugin-electron-'));
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
let registry;
let window;

async function write(relative, content) {
  const file = path.join(temp, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function run() {
  await app.whenReady();
  registry = registerPluginIpc({ ipcMain, session, dialog, fs });
  await fs.mkdir(path.join(temp, 'storage'));
  const client = await fs.readFile(path.join(projectRoot, 'examples/plugins/notebook-results/hikari.js'), 'utf8');
  await write('local-audit/hikari.js', client);
  await write('local-audit/style.css', '#probe { color: rgb(12, 34, 56); }');
  await write('local-audit/index.html', '<!DOCTYPE html><link rel="stylesheet" href="./style.css"><p id="probe">Local</p><script src="./hikari.js"></script><script type="module" src="./main.js"></script>');
  await write('local-audit/main.js', `
    const { hikari } = window.HikariPlugin;
    try {
      const info = await hikari.call('app.info');
      await hikari.call('files.write', {path:'nested/result.txt', dataBase64:btoa('saved bytes')});
      const file = await hikari.call('files.read', {path:'nested/result.txt'});
      await hikari.call('storage.set', {value:{latest:'nested/result.txt'}});
      await hikari.call('notebook.appendResult', {entryId:'n1', text:'Plugin result'});
      let hostBlocked = false;
      try { parent.document.body; } catch { hostBlocked = true; }
      parent.postMessage({audit:'local-complete', info, file, hostBlocked,
        preloadVisible: typeof window.hikariApi !== 'undefined', color:getComputedStyle(document.getElementById('probe')).color}, '*');
    } catch(error) { parent.postMessage({audit:'failure',error:String(error)}, '*'); }
  `);
  await write('other-origin/index.html', `<script>
    addEventListener('message', e => { if(e.data?.id === 'navigation-call') parent.postMessage({audit:'leaked-reply',reply:e.data}, '*'); });
    parent.postMessage({audit:'navigated'}, '*');
    parent.postMessage({hikari:1,id:'navigation-call',verb:'notebook.get',params:{id:'n1'}}, '*');
  </script>`);
  const other = await registry.serve('other-origin', path.join(temp, 'other-origin'));
  assert.equal(other.ok, true, other.error);
  await write('served-audit/index.html', `<script>setTimeout(() => location.href = ${JSON.stringify(other.baseUrl)}, 100);</script>`);
  await write('service-audit/hikari.js', client);
  await write('service-audit/index.html', '<script src="./hikari.js"></script><script src="./main.js"></script>');
  await write('service-audit/main.js', `
    addEventListener('message', e => {
      if(e.source !== parent || e.data?.call !== 'convert') return;
      parent.postMessage({hikari:1, call:'convert:result',id:e.data.id,ok:true,text:'Converted '+e.data.bytes.length}, '*');
    });
    window.HikariPlugin.hikari.call('app.info').then(info => parent.postMessage({audit:'service-info',info}, '*'));
    parent.postMessage({hikari:1,call:'service:ready'}, '*');
  `);
  const sourceHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
  const csp = sourceHtml.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/)[0];
  const local = (id, extra = {}) => ({ id, name: id, path: path.join(temp, id), entryUrl: pathToFileURL(path.join(temp, id, 'index.html')).href, ...extra });
  const plugins = [
    local('local-audit', { permissions: ['storage', 'files', 'notebook:write'] }),
    local('served-audit', { serve: true, permissions: ['notebook:read'] }),
    local('service-audit', { service: { fileConversions: [{ from: 'dna', to: 'gbk' }] } })
  ];
  await write('index.html', `<!DOCTYPE html><head>${csp}</head><body><div class="workspace-main"></div><script type="module" src="./host.js"></script></body>`);
  const moduleUrl = (file) => pathToFileURL(path.join(projectRoot, 'src/renderer/app', file)).href;
  await write('host.js', `
    import { installPlugins } from '${moduleUrl('plugin-loader.js')}';
    import { createPluginBridge } from '${moduleUrl('plugin-bridge.js')}';
    import { createPluginServiceRegistry } from '${moduleUrl('plugin-services.js')}';
    window.auditEvents=[];
    addEventListener('message', e => { if(e.data?.audit) auditEvents.push({origin:e.origin,...e.data}); });
    window.auditState={settings:{plugins:${JSON.stringify(plugins)},storagePath:${JSON.stringify(path.join(temp, 'storage'))}},notebookEntries:[{id:'n1',result:'Existing result'}]};
    const bridge=createPluginBridge({state:auditState,windowObject:window,persist:()=>localStorage.setItem('audit-state',JSON.stringify(auditState))});
    const services=createPluginServiceRegistry({windowObject:window});
    installPlugins({state:auditState,documentObject:document,appRegistry:[],bridge,services,api:window.hikariApi});
    services.convert({extension:'dna',filename:'test.dna',bytes:new Uint8Array([1,2,3])})
      .then(result=>auditEvents.push({audit:'converted',result}),error=>auditEvents.push({audit:'failure',error:String(error)}));
  `);
  window = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false,
    preload: path.join(projectRoot, 'src/main/preload.js')
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  await window.loadFile(path.join(temp, 'index.html'));
  let events;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    events = await window.webContents.executeJavaScript('window.auditEvents || []');
    if (events.some(e => e.audit === 'failure')) throw new Error(JSON.stringify(events));
    if (['local-complete', 'navigated', 'converted', 'service-info'].every(name => events.some(e => e.audit === name))) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  events = await window.webContents.executeJavaScript('window.auditEvents');
  const completed = events.find(e => e.audit === 'local-complete');
  assert.ok(completed, JSON.stringify(events));
  assert.equal(completed.info.pluginId, 'local-audit');
  assert.equal(completed.file.dataBase64, Buffer.from('saved bytes').toString('base64'));
  assert.equal(completed.color, 'rgb(12, 34, 56)');
  assert.equal(completed.hostBlocked, true);
  assert.equal(completed.preloadVisible, false);
  assert.ok(events.some(e => e.audit === 'navigated'));
  assert.equal(events.some(e => e.audit === 'leaked-reply'), false, 'navigation must not transfer the grant');
  assert.equal(events.find(e => e.audit === 'converted')?.result.text, 'Converted 3');
  assert.equal(events.find(e => e.audit === 'service-info')?.info.pluginId, 'service-audit');
  const snapshot = await window.webContents.executeJavaScript('JSON.parse(localStorage.getItem("audit-state"))');
  assert.equal(snapshot.notebookEntries[0].result, 'Existing result\n\nPlugin result');
  assert.equal(snapshot.settings.pluginStorage['local-audit'].latest, 'nested/result.txt');
  assert.equal(await fs.readFile(path.join(temp, 'storage/Plugins/local-audit/nested/result.txt'), 'utf8'), 'saved bytes');
  assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".plugin-service-frame")).display'), 'none');

  // The OS reuses ephemeral ports across runs and a port is the whole origin,
  // so a plugin can be handed one another plugin's storage is still filed
  // under. Emptying it is what the registry does before serving a new origin.
  const probe = new BrowserWindow({ show: false });
  try {
    await probe.loadURL(other.baseUrl);
    await probe.webContents.executeJavaScript("localStorage.setItem('stale', 'LEAK')");
    await session.defaultSession.clearStorageData({ origin: new URL(other.baseUrl).origin });
    await probe.loadURL(other.baseUrl);
    assert.equal(
      await probe.webContents.executeJavaScript("localStorage.getItem('stale')"),
      null,
      'a recycled loopback origin is emptied before a plugin loads on it'
    );
  } finally {
    probe.destroy();
  }
  console.log('plugin-runtime-electron: ok (assets, isolation, origin grants, origin reuse, file IPC, notebook, storage, service conversion)');
}

const timeout = setTimeout(() => { console.error('plugin-runtime-electron timed out'); app.exit(1); }, 20000);
run().then(() => 0, error => { console.error(error); return 1; }).then(async (code) => {
  clearTimeout(timeout);
  window?.destroy();
  await registry.closeAll();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
});
