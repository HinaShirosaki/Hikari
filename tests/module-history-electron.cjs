// Real renderer shell/modules with temporary browser storage and stubbed disk
// IPC. No live workspace or account is opened.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-module-history-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
let win;
const timeout = setTimeout(() => app.exit(1), 60000);
async function main() {
  await app.whenReady();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<head>', `<head><base href="${pathToFileURL(root + path.sep).href}">`)
    .replace(/<script type="module" src="src\/renderer\/renderer.js"><\/script>/, '');
  const fixture = path.join(scratch, 'index.html'); fs.writeFileSync(fixture, html);
  win = new BrowserWindow({ show: false, width: 1300, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(fixture);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const base = ${JSON.stringify(pathToFileURL(root + '/').href)};
    const { defaultState, STORAGE_KEY } = await import(base + 'src/renderer/modules/app-state/index.js');
    const initial = structuredClone(defaultState);
    initial.settings.storagePath = '/fixture/workspace-a';
    initial.settings.plugins = [];
    initial.protocols = [{ id: 'p', name: 'Protocol', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      steps: [{ text: 'Measure.', placeholders: [] }] }];
    initial.projects = [{ id: 'project', name: 'Project' }];
    initial.notebookEntries = [{ id: 'n', notebookType: 'biology', projectId: 'project', projectName: 'Project',
      protocolId: 'p', protocolName: 'Protocol', protocolSnapshot: initial.protocols[0], experimentName: 'Page',
      values: {}, result: 'Saved notes', resultFiles: [], resultFileRecords: [], sampleLinks: [],
      updatedAt: '2026-10-01T00:00:00.000Z', notebookState: 'planned' }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    window.hikariApi = {
      ensureStorageDirectory: async () => ({ ok: true }),
      importStorageRoot: async () => ({ ok: true, statePatch: {}, summary: {} }),
      autoSaveDataFile: async () => ({ ok: true }),
      reportError() {}
    };
    const { startHikariCore } = await import(base + 'src/renderer/core/start-hikari-core.js');
    const core = startHikariCore(); const ready = await core.whenReady();
    const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
    let checks = 0;
    check(ready.ok, 'Core boot failed');
    const modules = core.moduleRuntime.modules;
    check(Object.values(modules).every(module => module.history), 'Every module must receive its history');
    const settle = () => new Promise(resolve => setTimeout(resolve, 30));
    const view = async id => { core.navigationShell.showView(id); document.activeElement?.blur(); await settle(); };
    const click = async direction => { const button = document.getElementById('global-' + direction + '-btn'); button.focus(); button.click(); await settle(); };
    await view('setting-view');
    const remembered = core.state.settings.startup.rememberLastView;
    document.getElementById('setting-startup-remember-last-view').checked = !remembered;
    document.getElementById('startup-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    check(modules.settings.history.getHistoryState().canUndo, 'Actual Settings submit must belong to Settings');
    await view('protocol-management-view');
    check(document.getElementById('global-undo-btn').disabled, 'Empty Protocol history must not use Settings history');
    core.state.protocols[0].name = 'Edited protocol'; modules.protocol.history.persist();
    await click('undo');
    check(core.state.protocols[0].name === 'Protocol', 'Protocol Undo restores its own record');
    check(core.state.settings.startup.rememberLastView === !remembered, 'Protocol Undo must preserve Settings');
    await view('setting-view'); await click('undo');
    check(core.state.settings.startup.rememberLastView === remembered, 'Settings Undo restores its own change');
    await view('protocol-management-view'); await click('redo');
    check(core.state.protocols[0].name === 'Edited protocol', 'Protocol redo survives changes in another module');
    modules.protocol.editProtocol('p'); await click('undo');
    check(document.getElementById('protocol-name').value === 'Protocol', 'Protocol Undo refreshes a clean open editor');
    check(!modules.protocol.hasUnsavedChanges(), 'Restored Protocol editor has a matching saved baseline');
    await click('redo');
    check(document.getElementById('protocol-name').value === 'Edited protocol', 'Protocol Redo refreshes a clean open editor');
    await view('biology-notebook-view'); modules.biologyNotebook.openEntry('n');
    document.getElementById('biology-notebook-result').value = 'Unsaved observations';
    check(modules.biologyNotebook.hasUnsavedChanges(), 'Notebook draft must be dirty');
    await view('setting-view'); await click('redo');
    check(document.getElementById('biology-notebook-result').value === 'Unsaved observations', 'Settings redo must preserve the hidden notebook draft');
    check(modules.biologyNotebook.hasUnsavedChanges(), 'Notebook draft must remain dirty');
    await view('biology-notebook-view');
    check(document.getElementById('biology-notebook-result').value === 'Unsaved observations', 'Returning to the notebook must keep its draft');
    await view('setting-view');
    core.state.protocols[0].name = 'Background completion'; modules.protocol.history.persist();
    check(core.moduleRuntime.getHistoryOwner() === 'settings', 'Visible owner stays Settings during background completion');
    check(modules.protocol.history.getHistoryState().canUndo, 'Background completion belongs to Protocol');
    await view('tool-box-view');
    check(document.getElementById('global-undo-btn').disabled, 'Toolbox cannot undo Protocol changes');
    await view('sample-registry-view');
    check(core.moduleRuntime.getHistoryOwner() === 'personalInventory', 'The Samples view belongs to Personal Inventory');
    await view('assay-view');
    document.getElementById('assay-name').value = 'Original assay';
    document.getElementById('assay-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const assayId = document.getElementById('assay-id').value;
    check(Boolean(assayId), 'Assay form creates and keeps its saved record open');
    document.getElementById('assay-name').value = 'Renamed assay';
    document.getElementById('assay-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle(); await click('undo');
    check(core.state.assays.find(assay => assay.id === assayId)?.name === 'Original assay', 'Assay Undo restores saved content');
    check(document.getElementById('assay-name').value === 'Original assay', 'Assay Undo refreshes the open form');
    check(!modules.assay.hasUnsavedChanges(), 'Restored assay form has a matching saved baseline');
    await click('redo');
    check(document.getElementById('assay-name').value === 'Renamed assay', 'Assay Redo refreshes the open form');
    await view('setting-view');
    core.state.settings.storagePath = '/fixture/workspace-b'; modules.settings.history.persist();
    check(Object.values(modules).every(module => !module.history.getHistoryState().canUndo && !module.history.getHistoryState().canRedo),
      'Workspace switch resets all module stacks');
    return { checks, modules: Object.keys(modules).length };
  })()`);
  assert.ok(result.modules >= 13, `Expected all built-in modules, got ${result.modules}`);
  console.log(`Module history UI: ${result.checks} checks passed across ${result.modules} initialized modules.`);
}
main().then(() => { clearTimeout(timeout); win?.destroy(); app.exit(0); })
  .catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1); });
