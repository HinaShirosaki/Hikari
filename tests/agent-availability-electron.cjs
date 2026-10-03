'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }

  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-agent-availability-ui-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  let win;
  try {
    await app.whenReady();
    const url = (file) => pathToFileURL(path.join(root, file)).href;
    const fixture = path.join(scratch, 'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}"></head><body>
      <nav id="app-dock-nav"></nav><button id="app-more-btn"></button><div id="app-more-menu"></div>
      <section id="home-view" class="view"></section><section id="papers-view" class="view"></section>
      ${fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8')}
      ${fs.readFileSync(path.join(root, 'ui/html/views/agent-view.html'), 'utf8')}
      <aside id="universal-agent-chat-rail" hidden><button id="agent-chat-rail-toggle-btn" data-requires-agent></button></aside>
      <button id="paper-details-toggle-btn" hidden></button><button id="paper-brief-toggle-btn" hidden></button><button id="paper-comment-toggle-btn" hidden></button>
    </body></html>`);
    win = new BrowserWindow({ width: 1100, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(fixture);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const { createNavigationShell } = await import(${JSON.stringify(url('src/renderer/app/navigation-shell.js'))});
      const { setAgentAvailability } = await import(${JSON.stringify(url('src/renderer/lib/agent-availability.js'))});
      const { initLabNotebook } = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/index.js'))});
      const { biologyNotebookManifest } = await import(${JSON.stringify(url('src/renderer/module-manifests/biology-notebook.js'))});
      const { createCodexAccountSettings } = await import(${JSON.stringify(url('src/renderer/modules/settings/codex-account.js'))});
      const check = (value, message) => { if (!value) throw new Error(message); };
      const protocol = { id: 'r', name: 'Protocol', steps: [] };
      const state = {
        projects: [{ id: 'p', name: 'Project' }], protocols: [protocol],
        notebookEntries: [{ id: 'e', notebookType: 'biology', projectId: 'p', projectName: 'Project', protocolId: 'r', protocolName: 'Protocol', protocolSnapshot: protocol, experimentName: 'User title', experimentNameSource: 'user', values: {}, result: 'Saved result', resultFiles: [], resultFileRecords: [] }],
        samples: [], assays: [], workflows: [], settings: { storagePath: '', startup: { defaultViewId: 'agent-view' } }
      };
      window.hikariApi = { listPaperFindingTasks: async () => ({ ok: true, tasks: [] }) };
      const notebook = initLabNotebook({ state, persist() {}, createId: () => crypto.randomUUID(),
        safeText: (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        onNotebookEntriesChanged() {}, onProjectsChanged() {} });
      const VIEWS = { HOME: 'home-view', AGENT: 'agent-view', BIOLOGY_NOTEBOOK: 'biology-notebook-view', PAPERS: 'papers-view' };
      const apps = [
        { id: 'home', viewId: VIEWS.HOME, label: 'Home' },
        { id: 'agent', viewId: VIEWS.AGENT, label: 'Agent' },
        { id: 'biology', viewId: VIEWS.BIOLOGY_NOTEBOOK, label: 'Notebook', agentChatRail: true },
        { id: 'papers', viewId: VIEWS.PAPERS, label: 'Papers', agentChatRail: true }
      ];
      let notebookRenders = 0;
      const shell = createNavigationShell({ VIEWS, TITLES: {}, APP_DOCK_ORDER: [], APP_REGISTRY: apps,
        moduleRuntime: { renderView(id) {
          if (id === VIEWS.BIOLOGY_NOTEBOOK) {
            notebookRenders += 1;
            biologyNotebookManifest.render({ modules: { biologyNotebook: notebook } });
          }
        }, renderAgentChatRail() {} },
        sharedLeftRailRuntime: { syncWidth() {}, ensureHandles() {} }, executeTopbarSearch() {},
        documentObject: document, windowObject: window });
      shell.initNavigation();
      shell.enableLastViewPersistence();
      shell.showView(shell.resolveStartupViewId(state));
      const send = document.getElementById('agent-send-btn');
      check(shell.getActiveViewId() === VIEWS.AGENT, 'Unknown status preserves the requested Agent startup view');
      check(send.getClientRects().length === 0, 'Unknown status hides the entire Agent composer');
      check(!document.querySelector('[data-app-id="agent"]'), 'Unknown status hides Agent navigation');
      setAgentAvailability(true);
      check(shell.getActiveViewId() === VIEWS.AGENT && send.getClientRects().length > 0, 'Connecting restores the pending Agent startup view');
      check(document.querySelector('[data-app-id="agent"]'), 'Connecting restores Agent navigation');
      setAgentAvailability(false);
      check(shell.getActiveViewId() === VIEWS.HOME && send.getClientRects().length === 0, 'Disconnecting leaves Agent and hides its composer');

      delete document.body.dataset.agentAvailability;
      shell.showView(VIEWS.AGENT);
      window.hikariApi.getCodexLlmStatus = async () => { throw new Error('fixture status failure'); };
      const account = createCodexAccountSettings({ state, persist() {}, llmModelCatalog: { hasCodexModels: () => true } });
      await account.refreshCodexLoginStatus();
      check(shell.getActiveViewId() === VIEWS.HOME && send.getClientRects().length === 0, 'A failed initial check leaves Agent hidden');

      shell.showView(VIEWS.BIOLOGY_NOTEBOOK);
      notebook.openEntry('e');
      const input = document.getElementById('biology-notebook-result');
      input.value = 'Unsaved new result';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      check(notebook.hasUnsavedChanges(), 'The fixture has unsaved notebook work');
      const rendersBefore = notebookRenders;
      for (const connected of [true, false, true]) {
        setAgentAvailability(connected);
        check(input.value === 'Unsaved new result' && notebook.hasUnsavedChanges(), 'Availability changes preserve the notebook draft and dirty state');
        check(notebookRenders === rendersBefore, 'Availability changes do not re-render the notebook');
        check(document.getElementById('universal-agent-chat-rail').hidden === !connected, 'The notebook chat rail follows connection state');
      }
      setAgentAvailability(false);
      shell.showView(VIEWS.PAPERS);
      check(!document.getElementById('universal-agent-chat-rail').hidden, 'Offline Papers retains its PDF rail');
      check(!document.getElementById('paper-comment-toggle-btn').hidden, 'Offline Papers retains its outline control');
      check(document.getElementById('agent-chat-rail-toggle-btn').getClientRects().length === 0, 'Offline Papers hides its AI chat control');
      return { startupGate: true, failedStatusGate: true, unsavedNotebookPreserved: true, offlinePaperTools: true };
    })()`);
    console.log('PASS agent availability Electron', result);
  } finally {
    win?.destroy();
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
