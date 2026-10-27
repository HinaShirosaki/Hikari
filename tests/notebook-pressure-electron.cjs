// Real UI + real jsPDF pressure test. No user workspace or research data is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { encoding: 'utf8', timeout: 180000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-notebook-pressure-'));
  const output = path.resolve(root, 'artifacts/notebook-pressure', process.argv[2] || 'current');
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(scratch, 'profile')); app.disableHardwareAcceleration();
  await app.whenReady();
  ipcMain.handle('pressure-pdf', (_event, label, bytes) => { fs.writeFileSync(path.join(output, path.basename(label) + '.pdf'), Buffer.from(bytes)); return true; });
  const preload = path.join(scratch, 'preload.cjs');
  fs.writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('pressureApi',{qaSavePdf:(label,bytes)=>ipcRenderer.invoke('pressure-pdf',label,bytes)});");
  const url = file => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="' + url('styles.css') + '"><link rel="stylesheet" href="' + url('vendor/tabulator/tabulator.min.css') + '"><script src="' + url('vendor/tabulator/tabulator.min.js') + '"></script><script src="' + url('vendor/jspdf.umd.min.js') + '"></script><style>html,body{height:100%;margin:0}body{display:block}#biology-notebook-view{height:100vh;padding:16px;box-sizing:border-box}.view{display:block}</style></head><body>' + fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8').replace('class="view"', 'class="view is-active"') + '<script type="module" src="' + url('tests/notebook-pressure-fixture.mjs') + '"></script></body></html>');
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload, contextIsolation: true, sandbox: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 3) errors.push(event.message); });
  try {
    await win.loadFile(fixture);
    const execution = await win.webContents.executeJavaScript('(async()=>{try{return {ok:true,result:await window.pressureRun()};}catch(error){return {ok:false,error:error.stack};}})()');
    assert.equal(execution.ok, true, execution.error || errors.join('\n'));
    const result = execution.result;
    if (process.argv[2] !== 'baseline') verifyPdfLayouts(result.reports);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
    for (const width of [1440, 1024, 800]) {
      win.setContentSize(width, 950);
      await win.webContents.executeJavaScript('pressure.notebook.openEntry(pressure.mixedId);pressure.pause()');
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const layout = await win.webContents.executeJavaScript('({width:innerWidth,body:document.body.scrollWidth,viewer:document.querySelector(".biology-notebook-viewer-scroll").getBoundingClientRect().toJSON()})');
      checkLayout(layout, width);
      fs.writeFileSync(path.join(output, 'notebook-' + width + '-top.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('document.getElementById("biology-notebook-tool-calculations").scrollIntoView({block:"start"});pressure.pause()');
      fs.writeFileSync(path.join(output, 'notebook-' + width + '-tools.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('document.querySelector(".biology-notebook-linked-assay-serial-dilution").scrollIntoView({block:"start"});pressure.pause()');
      fs.writeFileSync(path.join(output, 'notebook-' + width + '-dilution.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('pressure.notebook.openEntry("wide-ui");pressure.pause()');
      await win.webContents.executeJavaScript('document.getElementById("biology-notebook-result-table-wrap").scrollIntoView({block:"start"});pressure.pause()');
      const wideLayout = await win.webContents.executeJavaScript('({width:innerWidth,body:document.body.scrollWidth,viewer:document.querySelector(".biology-notebook-viewer-scroll").getBoundingClientRect().toJSON()})');
      checkLayout(wideLayout, width);
      const lastColumnWidth = await win.webContents.executeJavaScript('Tabulator.findTable(document.querySelector(".spreadsheet-table"))[0].getColumn("c23").getWidth()');
      assert.ok(lastColumnWidth >= 120, 'Wide notebook columns keep readable widths');
      fs.writeFileSync(path.join(output, 'notebook-' + width + '-wide.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('document.querySelector(".tabulator-tableholder").scrollLeft=100000;pressure.pause()');
      fs.writeFileSync(path.join(output, 'notebook-' + width + '-wide-last-columns.png'), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output, persists: result.persists, appends: result.appends, files: result.files, tools: result.tools, pdfs: result.reports.map(r => ({ label: r.label, pages: r.pages })) }));
  } finally {
    win.destroy(); app.quit(); fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function verifyPdfLayouts(reports) {
  for (const report of reports) {
    for (const draw of report.draws) {
      if (!draw.text.trim()) continue;
      const footer = Math.abs(draw.y - (draw.pageHeight - 40)) < 0.1;
      assert.ok(draw.x >= 20 && draw.x + draw.width <= draw.pageWidth - 20 + 0.5, report.label + ': text exceeds the page width: ' + draw.text);
      assert.ok(draw.y >= 20 && (footer || draw.y <= draw.pageHeight - 60), report.label + ': text runs into the footer or off the page: ' + draw.text);
      assert.ok(draw.size >= 7, report.label + ': text is too small to read');
    }
  }
  const text = label => reports.find(report => report.label === label).draws.map(draw => draw.text).join(' ');
  assert.ok(text('long-cell').includes('Line 159:'), 'The last line of the oversized cell must survive');
  assert.ok(text('long-notes').includes('Append 69:'), 'The final appended note must survive');
  assert.ok(text('wide-table').includes('Measurement 23') && text('wide-table').includes('35.714'), 'The far-right column and its last value must survive');
  assert.ok(text('plate-1536').includes('1536 mapped wells') && text('plate-1536').includes('Protein-32'), 'The entire large plate and its assignments must survive');
  assert.ok(text('markdown-append').includes('Clone B') && !text('markdown-append').includes('##'), 'Appended Markdown sections and table rows must render');
  assert.ok(text('many-rows').includes('Clone 120'), 'The last row of the long table must survive');
  assert.ok(text('plate-irregular').includes('Last well marker') && text('plate-irregular').includes('0.25 nM'), 'Sparse large-plate assignments must survive');
  assert.ok(text('tool-stress').includes('Ingredient 32') && text('tool-stress').includes('Lot 32'), 'The final tool ingredient and its note must survive');
  assert.ok(text('oversized-header-a5').includes('LAST_HEADER_WORD'), 'The complete oversized column heading must survive');
  const boundary = reports.find(report => report.label === 'tool-heading-boundary').draws;
  const firstHeader = boundary.find(draw => draw.text === 'Chemical');
  for (const name of ['Tool Calculation', 'Buffer Preparer', 'NaCl']) {
    assert.equal(boundary.find(draw => draw.text === name).page, firstHeader.page, 'Tool heading and first row must stay with their table');
  }
}

function checkLayout(layout, width) {
  assert.ok(layout.body <= width + 1, 'Notebook must not cause horizontal window overflow');
  assert.ok(layout.viewer.width > 200 && layout.viewer.height > 300, 'Notebook viewer remains usable');
}

main().catch(error => { console.error(error.stack); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
