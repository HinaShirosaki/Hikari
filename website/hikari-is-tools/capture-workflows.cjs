// Capture the current desktop Workflow renderer with fictional records only.
// This capture command leaves the website's frozen Trial source unchanged.
// Run from the repository root with the repository's Electron executable.
const {app, BrowserWindow, screen} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const REPO = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.HIKARI_CAPTURES || 'tmp/hikari-is-synthetic-captures');
const sourceURL = file => pathToFileURL(path.join(REPO, file)).href;
const at = day => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
const protocols = [
  {id: 'demo-grow', name: 'Grow cells', steps: []},
  {id: 'demo-purify', name: 'Purify protein', steps: [{placeholders: [{id: 'sample', name: 'Sample'}, {id: 'volume', name: 'Elution volume'}]}]},
  {id: 'demo-measure', name: 'Measure activity', steps: []},
  {id: 'demo-archive', name: 'Archive aliquots', steps: []},
  {id: 'demo-qc', name: 'Check purity', steps: []}
];
const blocks = protocols.map((protocol, i) => ({id: 'b' + i, type: 'protocol', protocolId: protocol.id, x: i === 4 ? 300 : i * 300, y: i === 4 ? 220 : 0}));
const links = [[0, 1], [1, 2], [2, 3], [1, 4]].map(([from, to], i) => ({id: 'link' + i, fromBlockId: 'b' + from, toBlockId: 'b' + to}));
const template = {id: 'demo-template', name: 'Protein production', description: 'Grow, purify, measure, and archive each batch.', blocks, links, createdAt: at(1), updatedAt: at(1)};
const runs = [4, 2, 1].map((completed, i) => {
  const start = [2, 6, 9][i];
  const stepStates = Object.fromEntries(blocks.map((block, j) => [block.id, {
    status: j < completed ? 'completed' : 'not_done',
    completedAt: j < completed ? at(start + j) : '',
    updatedAt: at(start + Math.min(j, completed - 1)),
    values: {sample: ['Batch A', 'Batch B', 'Batch C'][i], volume: '2.5 mL'},
    result: j === 1 ? 'Clear eluate; 3.8 mg/mL protein. Aliquot saved for the activity assay.' : 'Completed and recorded in the notebook.',
    resultFiles: j === 1 ? ['purification-trace.csv'] : [],
    notebookEntryId: `demo-notebook-${i}-${j}`
  }]));
  return {id: 'demo-run-' + (i + 1), templateId: template.id, name: 'Run 0' + (i + 1), projectId: 'demo-project', blocks, links,
    entries: [{id: 'entry-' + i, activeBranchRootIds: [], stepStates}], createdAt: at(start), updatedAt: at(start + completed - 1)};
});
const state = {workflowTemplates: [template, {...template, id: 'demo-other', name: 'Culture expansion', updatedAt: at(1)}], workflows: runs,
  projects: [{id: 'demo-project', name: 'Example enzyme study'}], protocols, notebookEntries: []};
const dockApps = [
  ['home', 'Home', 'home-view'], ['biology-notebook', 'Notebook', 'biology-notebook-view'],
  ['protocols', 'Protocols', 'protocol-management-view'], ['sequence-viewer', 'Sequences', 'sequence-viewer-view'],
  ['assay', 'Assays', 'assay-view'], ['sample-inventory', 'Inventory', 'sample-registry-view'],
  ['workflows', 'Workflows', 'workflow-management-view'], ['papers', 'Papers', 'papers-view'], ['settings', 'Settings', 'setting-view']
].map(([id, label, viewId]) => ({id, label, viewId, iconMarkup: fs.readFileSync(path.join(REPO, 'assets/icons', id + '.svg'), 'utf8')}));

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUT, {recursive: true});
    const scratch = fs.mkdtempSync(path.join(REPO, 'tmp/workflow-capture-'));
    const generated = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    const shell = generated.slice(generated.indexOf('<main class="app-shell">'), generated.indexOf('<!-- SOURCE: ui/html/views/home-view.html -->'));
    const view = fs.readFileSync(path.join(REPO, 'ui/html/views/workflow-management-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
    const script = `
      import {createWorkflowRenderer} from ${JSON.stringify(sourceURL('src/renderer/modules/workflow/renderer.js'))};
      import {getWorkflowElements} from ${JSON.stringify(sourceURL('src/renderer/modules/workflow/dom.js'))};
      import {createAppDock} from ${JSON.stringify(sourceURL('src/renderer/app/navigation-shell/app-dock.js'))};
      const state = ${JSON.stringify(state)};
      const runtime = {draft: {}, activeTemplateId: 'demo-template', activeWorkflowId: 'demo-run-2', activeEntryId: 'entry-1', activeBlockId: 'b1'};
      const $ = id => document.getElementById(id);
      const renderer = createWorkflowRenderer({state, runtime, elements: getWorkflowElements(document), getBlockType: block => block.type,
        safeText: value => String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])),
        parseTimestamp: value => Date.parse(value) || 0, formatTimestamp: value => new Date(value).toLocaleString('en-US')});
      renderer.setWorkflowEntryMode('list'); renderer.renderWorkflowList(); renderer.renderExecutionBoard();
      const apps = ${JSON.stringify(dockApps)};
      const dock = createAppDock({documentObject: document, windowObject: window, TITLES: {}, dockNav: $('app-dock-nav'),
        appDockDivider: document.querySelector('.app-dock-divider'), moreBtn: $('app-more-btn'), moreMenu: $('app-more-menu'),
        expandedDockApps: apps, getActiveViewId: () => 'workflow-management-view', getAppForView: id => apps.find(a => a.viewId === id), resolveNavigationViewId: id => id});
      dock.renderAppNavigation(); dock.syncNavigationState('workflow-management-view');
      const lights = document.createElement('div'); lights.className = 'trial-window-controls'; lights.innerHTML = '<i></i><i></i><i></i>';
      document.querySelector('.topbar').prepend(lights); $('topbar-local-time').textContent = '09:41';
      await document.fonts.ready; document.body.dataset.captureReady = 'true';
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${sourceURL('./')}">
      <link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="${sourceURL('website/hikari-is/trial-app.css')}">
      <style>html,body{margin:0;overflow:hidden}.app-shell{height:800px}body{--app-font-size:16px}</style>
      </head><body class="ui-neutral-compact" data-trial-feature="workflows">${shell}${view}</section></div></main><script type="module">${script}</script></body></html>`;
    const file = path.join(scratch, 'workflow-capture.html'); fs.writeFileSync(file, html);
    const density = 3, zoom = density / screen.getPrimaryDisplay().scaleFactor;
    win = new BrowserWindow({show: false, width: Math.round(1280 * zoom), height: Math.round(800 * zoom), useContentSize: true,
      webPreferences: {offscreen: true, zoomFactor: zoom, partition: 'workflow-capture-' + Date.now(), webSecurity: false, nodeIntegration: false, sandbox: true}});
    // This source-only window renders local files and never contacts a service.
    win.webContents.session.webRequest.onBeforeRequest((details, done) => done({cancel: !/^(file|data|about):/.test(details.url)}));
    win.webContents.setFrameRate(30);
    const url = pathToFileURL(file).href + '?feature=workflows&capture=1';
    await win.loadURL(url);
    for (let attempt = 0; ; attempt++) {
      const ready = await win.webContents.executeJavaScript('document.body.dataset.captureReady');
      if (ready === 'true') break;
      if (attempt === 75) throw new Error('Workflow capture did not become ready');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    const auditText = await win.webContents.executeJavaScript('document.body.innerText');
    if (/TestData3|CalB|pETDuet|SUMO/i.test(auditText)) throw new Error('Non-demo records appeared in the capture');
    const image = await win.webContents.capturePage();
    if (image.getSize().width !== 3840 || image.getSize().height !== 2400) throw new Error('Capture dimensions must be 3840 × 2400');
    fs.writeFileSync(path.join(OUT, 'workflow.jpg'), image.toJPEG(95));
    const manifestFile = path.join(OUT, 'capture-manifest.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {logicalSize: [1280, 800], renderScale: 3, scenes: []};
    manifest.scenes = manifest.scenes.filter(scene => scene.name !== 'workflow');
    manifest.scenes.push({name: 'workflow', feature: 'workflows', url, source: 'Current desktop Workflow renderer, HTML, and styles; fictional fixture records only', auditText});
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    console.log('workflow.jpg: 3840 × 2400; current Hikari Workflow view with fictional runs.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (win && !win.isDestroyed()) win.destroy(); app.quit(); }
});
