// Run after build:ui: node node_modules/electron/cli.js tests/storage-setup-electron.cjs
// Real renderer, preload, storage IPC, import and save; only the native picker
// and unrelated services are replaced. All data lives in a temporary profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = process.env.HIKARI_TEST_APP_ROOT || path.resolve(__dirname, '..');
const fromApp = (file) => require(path.join(root, file));
const { STORAGE } = fromApp('src/shared/ipc/channels.js');
const { registerDataIpc } = fromApp('src/main/ipc/register-data-ipc.js');
const { createMainDataHelpers } = fromApp('src/main/data/data-helpers.js');
const storage = fromApp('src/main/storage/index.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-storage-setup-'));
const workspace = path.join(scratch, 'workspace');
const pointer = path.join(scratch, 'profile', 'Config', 'last-storage-root.json');
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
let pickerMode = 'cancel';
let failureChannel = '';
let pickerCalls = 0;
const realHandlers = new Map();
const calls = [];
registerDataIpc({
  ipcMain: { handle: (channel, handler) => realHandlers.set(channel, handler) },
  fs: fs.promises,
  dialog: { showOpenDialog: async () => {
    pickerCalls++;
    if (pickerMode === 'throw') throw new Error('Picker fixture failure');
    return { canceled: pickerMode === 'cancel', filePaths: pickerMode === 'cancel' ? [] : [workspace] };
  } },
  getStorageRootPointerPath: () => pointer,
  getDefaultDataFilePath: () => path.join(scratch, 'profile', 'hikari-data.json'),
  mainDataHelpers: createMainDataHelpers({ fs: fs.promises, path, ...storage }),
  ...storage
});
const exercised = new Set([STORAGE.LAST_ROOT, STORAGE.PICK_DIRECTORY, STORAGE.ENSURE_DIRECTORY, STORAGE.IMPORT_ROOT, STORAGE.AUTO_SAVE]);
const registered = new Set();
function registerChannels(value) {
  if (typeof value !== 'string') {
    Object.values(value || {}).forEach(registerChannels);
    return;
  }
  if (registered.has(value)) return;
  registered.add(value);
  ipcMain.handle(value, async (event, payload) => {
    if (!exercised.has(value)) return { ok: true };
    calls.push(value);
    if (failureChannel === value) return { ok: false, error: 'Storage fixture failure' };
    return realHandlers.get(value)(event, payload);
  });
}
registerChannels(fromApp('src/shared/ipc/channels.js'));

let win;
const run = (script) => win.webContents.executeJavaScript(script);
async function waitFor(script) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await run(script)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${script}`);
}
async function clickChoose() {
  const before = pickerCalls;
  await run(`document.getElementById('storage-setup-choose').click()`);
  await waitFor(`!document.getElementById('storage-setup-choose').disabled`);
  assert.equal(pickerCalls, before + 1);
}
async function assertSetup() {
  assert.equal(await run(`!document.getElementById('storage-setup-page').hidden && document.querySelector('.app-shell').hidden && document.querySelector('.app-shell').inert`), true);
  assert.notEqual(await run(`localStorage.getItem('hikari_last_active_view_v1')`), 'setting-view');
}
async function reload() {
  await win.loadFile(path.join(root, 'index.html'));
  await waitFor(`document.documentElement.classList.contains('app-ready') && !document.getElementById('app-loading-cover')`);
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false,
    preload: path.join(root, 'src/main/preload.js')
  } });
  const moduleErrors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && /Module .*failed|Failed to initialize Hikari/.test(event.message)) moduleErrors.push(event.message);
  });
  await reload();
  await assertSetup();
  const artifacts = path.join(__dirname, '..', 'artifacts', 'storage-setup');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'first-launch.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.body.classList.add('theme-night')`);
  fs.writeFileSync(path.join(artifacts, 'first-launch-night.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.body.classList.remove('theme-night')`);
  await clickChoose();
  await assertSetup();
  assert.equal(fs.existsSync(pointer), false, 'cancel must not save a root');
  pickerMode = 'throw';
  await clickChoose();
  await assertSetup();
  assert.match(await run(`document.getElementById('storage-setup-status').textContent`), /Picker fixture failure/);
  pickerMode = 'select';
  for (const channel of [STORAGE.ENSURE_DIRECTORY, STORAGE.IMPORT_ROOT, STORAGE.AUTO_SAVE]) {
    failureChannel = channel;
    await clickChoose();
    await assertSetup();
    assert.match(await run(`document.getElementById('storage-setup-status').textContent`), /Storage fixture failure/);
    assert.equal(fs.existsSync(pointer), false, 'failed setup must not save a root pointer');
  }
  failureChannel = '';
  await clickChoose();
  assert.equal(await run(`document.getElementById('storage-setup-page').hidden && !document.querySelector('.app-shell').hidden && !document.querySelector('.app-shell').inert`), true);
  assert.equal(await run(`document.body.dataset.activeView`), 'home-view');
  assert.equal(JSON.parse(fs.readFileSync(pointer, 'utf8')).storagePath, workspace);
  assert.ok(fs.readdirSync(workspace).length, 'workspace sidecars must be written');
  for (const channel of exercised) assert.ok(calls.includes(channel), `Missing IPC ${channel}`);
  // Recover solely from the durable pointer, including after renderer cache loss.
  await run(`localStorage.clear()`);
  await reload();
  assert.equal(await run(`document.getElementById('storage-setup-page').hidden`), true);
  assert.equal(await run(`JSON.parse(localStorage.getItem('hikari_state_v1')).settings.storagePath`), workspace);
  failureChannel = STORAGE.IMPORT_ROOT;
  await reload();
  await assertSetup();
  failureChannel = '';
  await clickChoose();
  assert.equal(await run(`document.getElementById('storage-setup-page').hidden`), true);
  // An unwritable remembered workspace also returns to setup.
  failureChannel = STORAGE.AUTO_SAVE;
  await reload();
  await assertSetup();
  assert.deepEqual(moduleErrors, []);
  console.log('PASS: fresh launch, cancel, picker error, folder/import/save failures, retry, durable save, pointer recovery, and unavailable workspace');
  win.destroy();
  await fs.promises.rm(scratch, { recursive: true, force: true });
  app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Storage setup test timed out'); app.exit(1); }, 60000).unref();
