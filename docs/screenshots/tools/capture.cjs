// Run from the repository root: node docs/screenshots/tools/capture.cjs
// Refreshes the workspace gallery used by Readme.md and the guide.
//
// Most images are the full-window captures the illustrated tutorials already
// take and verify, so the gallery and the tutorials never drift apart. The
// notebook page and the agent rail have no tutorial figure showing what the
// gallery needs, so both are captured here from the Notebook chapter's fixture,
// with the real table controls, chat rail, and history renderer.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const folder = path.resolve(__dirname, '..');

// Each entry is a workspace shot the chapter capture already checked.
// notebook-entry.png is captured here instead: the gallery wants a page with a
// result table, which the chapter builds through the UI rather than seeding.
const FROM_TUTORIALS = {
  'home.png': '01-home-dashboard/images/raw/01-home-map.png',
  'protocols-editor.png': '02-protocols/images/raw/01-protocol-workspace.png',
  'notebook-project-dashboard.png': '03-notebook/images/raw/14-project-dashboard.png',
  'papers-viewer.png': '04-papers/images/raw/01-papers-workspace.png',
  'samples-registry.png': '05-samples/images/raw/01-samples-workspace.png',
  'chemicals-list.png': '06-chemicals/images/raw/01-chemicals-workspace.png',
  'workflows-graph.png': '07-workflows/images/raw/01-workflows-workspace.png',
  'sequence-detail.png': '08-dna/images/raw/04-sequence-viewer.png',
  'assay-layout.png': '09-plate/images/raw/01-plate-workspace.png',
  'gel-analysis.png': '10-gel/images/raw/18-save-gel.png'
};

function copyTutorialShots() {
  for (const [target, source] of Object.entries(FROM_TUTORIALS)) {
    const from = path.join(root, 'docs/tutorial', source);
    if (!fs.existsSync(from)) throw new Error(`Missing tutorial capture: ${source}. Run that chapter's capture first.`);
    fs.copyFileSync(from, path.join(folder, target));
    console.log(`Copied ${target} from docs/tutorial/${source}`);
  }
}

if (!process.versions.electron) {
  copyTutorialShots();
  const result = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {
    stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' }, timeout: 120000
  });
  if (result.error || result.signal) console.error(result.error || `Electron exited with signal ${result.signal}`);
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-readme-shots-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const url = file => pathToFileURL(path.join(root, file)).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chapterTools = path.join(root, 'docs/tutorial/03-notebook/tools');

async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="biology-notebook-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8')
    .replace('class="view"', 'class="view is-active"');
  // end.html carries the agent rail the notebook chapter's own fixture leaves out.
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const page = path.join(scratch, 'agent-rail.html');
  fs.writeFileSync(page, `${shell}${view}${end}`
    + `<script src="${url('vendor/tabulator/tabulator.min.js')}"></script>`
    + `<script type="module" src="${pathToFileURL(path.join(chapterTools, 'notebook-fixture.mjs')).href}"></script>`
    + `<script type="module" src="${pathToFileURL(path.join(__dirname, 'agent-rail-fixture.mjs')).href}"></script></body></html>`);

  const win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // The fixture must not fetch any remote resource.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(`renderer: ${message}`); });
  await win.loadFile(page);
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  for (let attempt = 0; ; attempt++) {
    if (await evaluate('return Boolean(window.readmeAgentReady);')) break;
    if (attempt > 160) throw new Error('The agent rail fixture did not finish loading.');
    await pause(30);
  }
  const openEntry = async name => {
    await evaluate(`const row = [...document.querySelectorAll('#biology-notebook-entry-list button')]
      .find(button => button.textContent.includes(${JSON.stringify(name)}));
      row?.click();`);
    await pause(200);
  };
  const typeCell = (rowIndex, column, value) => evaluate(`
    const host = document.querySelectorAll('[data-result-table-host]')[0];
    const cell = host.querySelectorAll('.tabulator-row')[${rowIndex}].querySelectorAll('.tabulator-cell')[${column + 1}];
    cell.click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const field = cell.querySelector('input');
    if (!field) throw new Error('No table cell editor');
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));`);

  // The gallery's notebook tile: an executed page with the protocol it ran and
  // the results recorded against it. The rail belongs to the agent tile only.
  await evaluate('window.readmeRail.setExpanded(false);');
  await openEntry('Buffer A pilot');
  // Add table lives in the bench toolbox, which starts folded.
  await evaluate('document.getElementById("biology-notebook-tool-fold-toggle").click();');
  for (let attempt = 0; ; attempt++) {
    if (await evaluate('return document.getElementById("biology-notebook-layout").classList.contains("is-tool-sidebar-open");')) break;
    if (attempt > 100) throw new Error('The bench toolbox did not open.');
    await pause(30);
  }
  await evaluate('document.getElementById("biology-notebook-add-table-btn").click();');
  for (let attempt = 0; ; attempt++) {
    if (await evaluate('return !document.getElementById("biology-notebook-table-size-overlay").hidden;')) break;
    if (attempt > 100) throw new Error('The table size dialog did not open.');
    await pause(30);
  }
  await evaluate(`for (const [id, value] of [['biology-notebook-table-size-rows', '4'], ['biology-notebook-table-size-columns', '4']]) {
      const field = document.getElementById(id);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('biology-notebook-table-size-form').requestSubmit();`);
  for (let attempt = 0; ; attempt++) {
    if (await evaluate('return document.querySelectorAll("#biology-notebook-result-table .tabulator-row").length === 4;')) break;
    if (attempt > 100) throw new Error('The result table did not appear.');
    await pause(30);
  }
  for (const [row, column, value] of [
    [0, 0, 'Tube'], [0, 1, 'Buffer'], [0, 2, 'Incubation'], [0, 3, 'Appearance'],
    [1, 0, 'A1'], [1, 1, 'Buffer A'], [1, 2, '30 min'], [1, 3, 'clear'],
    [2, 0, 'A2'], [2, 1, 'Buffer A'], [2, 2, '30 min'], [2, 3, 'clear'],
    [3, 0, 'A3'], [3, 1, 'Buffer A'], [3, 2, '30 min'], [3, 3, 'faint haze']
  ]) await typeCell(row, column, value);
  const filled = await evaluate(`return document.querySelectorAll('#biology-notebook-result-table .tabulator-row')[3]
    .textContent.includes('faint haze');`);
  if (!filled) throw new Error('The result table did not keep the typed values.');
  // Fold the toolbox again: the gallery shows the page, not a menu mid-use.
  await evaluate(`if (document.getElementById('biology-notebook-layout').classList.contains('is-tool-sidebar-open'))
    document.getElementById('biology-notebook-tool-collapse-btn').click();`);
  await pause(200);
  await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(toast => { toast.hidden = true; }); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));');
  await pause(150);
  fs.writeFileSync(path.join(folder, 'notebook-entry.png'),
    (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 }).toPNG());
  console.log('Captured notebook-entry.png (executed page with a result table).');

  // Open the executed page the conversation is about, with the rail back out.
  await evaluate('window.readmeRail.setExpanded(true);');
  await openEntry('Buffer B pilot');
  const checks = await evaluate(`return JSON.stringify({
    expanded: document.body.classList.contains('has-agent-chat-rail-expanded'),
    messages: document.querySelectorAll('#agent-rail-chat-history .agent-chat-item-assistant, #agent-rail-chat-history .agent-chat-item-user').length,
    citations: document.querySelectorAll('#agent-rail-chat-history .agent-chat-paper-source').length,
    entry: document.getElementById('biology-notebook-protocol-title')?.textContent || ''
  });`);
  const state = JSON.parse(checks);
  if (!state.expanded) throw new Error('The agent chat rail did not expand.');
  if (state.messages !== 2) throw new Error(`Expected the two scripted messages, rendered ${state.messages}.`);
  if (state.citations !== 2) throw new Error(`Expected two citation buttons, rendered ${state.citations}.`);
  await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(toast => { toast.hidden = true; }); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));');
  await pause(150);
  const image = (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 });
  fs.writeFileSync(path.join(folder, 'agent-chat.png'), image.toPNG());
  console.log(`Captured agent-chat.png (${state.citations} citations, entry "${state.entry.trim()}").`);
}

main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
