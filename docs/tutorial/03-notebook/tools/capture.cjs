// Run from the repository root: node docs/tutorial/03-notebook/tools/capture.cjs
// Captures real Notebook controls in a disposable Electron profile, then renders
// editable SVG callouts around the screenshots. No production files are edited.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {
    stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' }, timeout: 120000
  });
  if (result.error || result.signal) console.error(result.error || `Electron exited with signal ${result.signal}`);
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-notebook-tutorial-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const folder = path.resolve(__dirname, '..');
const rawFolder = path.join(folder, 'images/raw');
const annotatedFolder = path.join(folder, 'images');
fs.mkdirSync(rawFolder, { recursive: true });
const url = file => pathToFileURL(path.join(root, file)).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const manifest = { sourceVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
  exampleDate: '2026-10-24', timezone: 'America/Chicago', viewport: [1600, 1000],
  mode: 'Real Notebook renderer; fictional data; in-memory desktop adapters; no live AI, file writes, or PDF export.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  let shell = fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="biology-notebook-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/biology-notebook-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  const fixture = path.join(scratch, 'notebook.html');
  fs.writeFileSync(fixture, `${shell}${view}</section></div></main><script src="${url('vendor/tabulator/tabulator.min.js')}"></script><script type="module" src="${pathToFileURL(path.join(__dirname, 'notebook-fixture.mjs')).href}"></script></body></html>`);
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  annotationWin = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // The fixture must not fetch any remote resource.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(`renderer: ${message}`); });
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const waitFor = async code => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(`return Boolean(${code});`)) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${code}`);
  };
  const check = async (code, label) => {
    if (!await evaluate(`return Boolean(${code});`)) throw new Error(label);
    manifest.checks.push(label);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click();`);
  const input = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`);
  const key = (selector, keyName) => evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, bubbles: true, cancelable: true }));`);
  // A selector, or a list of them, covers every element it matches.
  const box = async selector => {
    const boxes = (await Promise.all((Array.isArray(selector) ? selector : [selector]).map(item => evaluate(`const els = [...document.querySelectorAll(${JSON.stringify(item)})];
      if (!els.length) throw new Error('Missing ' + ${JSON.stringify(item)});
      return els.map(el => { const r = el.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; });`)))).flat();
    const x = Math.min(...boxes.map(r => r.x)), y = Math.min(...boxes.map(r => r.y));
    return { x, y, width: Math.max(...boxes.map(r => r.x + r.width)) - x, height: Math.max(...boxes.map(r => r.y + r.height)) - y };
  };
  const cropOf = async selector => {
    if (!selector) return { x: 0, y: 0, width: 1600, height: 1000 };
    const r = await box(selector);
    const x = Math.max(0, r.x - 18), y = Math.max(0, r.y - 18);
    return { x, y, width: Math.min(1600, r.x + r.width + 18) - x, height: Math.min(1000, r.y + r.height + 18) - y };
  };
  const scrollTo = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center', behavior:'instant'});`);
  const shot = async (name, title, subtitle, cropSelector, targets, { side } = {}) => {
    // Notices are transient; a reported error means the preview drifted from the real flow.
    const errors = await evaluate('return tutorial.calls.filter(c => c.kind === "error").map(c => c.message);');
    if (errors.length) throw new Error(`Renderer reported an error before ${name}: ${errors.join('; ')}`);
    await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(t => { t.hidden = true; }); await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
    await pause(120);
    const crop = await cropOf(cropSelector);
    const capture = (await win.webContents.capturePage()).resize({ width: 1600, height: 1000 }).crop(crop);
    fs.writeFileSync(path.join(rawFolder, `${name}.png`), capture.toPNG());
    const targetsWithRects = [];
    for (const [selector, label, badge] of targets) {
      const rect = await box(selector);
      if (rect.x < crop.x || rect.y < crop.y || rect.x + rect.width > crop.x + crop.width || rect.y + rect.height > crop.y + crop.height) throw new Error(`Annotation outside screenshot: ${name}: ${selector}`);
      targetsWithRects.push({ selector, label, rect, ...(badge ? { badge } : {}) });
    }
    const sideRail = side ?? (crop.width < 1000 && crop.height > 300);
    const width = Math.max(crop.width + (sideRail ? 400 : 48), 1000);
    const height = sideRail ? Math.max(crop.height + 140, targets.length * 84 + 160) : crop.height + 210;
    const imageX = sideRail ? 24 : Math.round((width - crop.width) / 2), imageY = 94;
    const laneWidth = (width - 64) / targets.length;
    const color = '#286983';
    const callouts = targetsWithRects.map(({ label, rect, badge }, i) => {
      const x = imageX + rect.x - crop.x - 4, y = imageY + rect.y - crop.y - 4;
      const w = rect.width + 8, h = rect.height + 8;
      // Badges sit on the top-left corner unless that would cover the target's text.
      const badgeX = badge === 'right' ? x + w - 1 : x + 1;
      const labelX = sideRail ? imageX + crop.width + 32 : 32 + laneWidth * i + 7;
      const labelY = sideRail ? imageY + (i + .5) * (height - 140) / targets.length - 20 : imageY + crop.height + 35;
      const labelWidth = sideRail ? width - labelX - 24 : laneWidth - 14;
      const cx = labelX + labelWidth / 2, cy = labelY;
      // Arrows end at the nearest point of the highlight, so they cross as little of the UI as possible.
      const ax = sideRail ? labelX - 7 : cx, ay = sideRail ? labelY + 20 : cy - 9;
      const ex = Math.min(Math.max(ax, x), x + w), ey = Math.min(Math.max(ay, y), y + h);
      const reach = Math.hypot(ax - ex, ay - ey) || 1;
      const arrow = `M${ax},${ay} L${ex + (ax - ex) / reach * 5},${ey + (ay - ey) / reach * 5}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity=".045" stroke="${color}" stroke-width="3"/>
        <path d="${arrow}" stroke="${color}" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>
        <circle cx="${badgeX}" cy="${y + 1}" r="14" fill="${color}" stroke="white" stroke-width="2"/><text x="${badgeX}" y="${y + 6}" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i + 1}</text>
        <rect x="${labelX}" y="${cy}" width="${labelWidth}" height="40" rx="8" fill="#fffaf3" stroke="#dfdad9"/>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#191724" font-size="16" font-weight="600">${i + 1}. ${esc(label)}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Notebook renderer · 24 October 2026</text></svg>`;
    fs.writeFileSync(path.join(annotatedFolder, `${name}.svg`), svg);
    const annotationFile = path.join(scratch, 'annotation.html');
    fs.writeFileSync(annotationFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block}</style>${svg}`);
    annotationWin.setContentSize(width, height);
    await annotationWin.loadFile(annotationFile);
    await annotationWin.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode()))');
    await pause(150);
    fs.writeFileSync(path.join(annotatedFolder, `${name}.png`), (await annotationWin.webContents.capturePage()).resize({ width, height }).toPNG());
    manifest.screenshots.push({ name, title, crop, targets: targetsWithRects });
    console.log(`Captured ${name}`);
  };
  const entry = id => `tutorial.state.notebookEntries.find(e => e.id === ${JSON.stringify(id)})`;
  const row = id => `[data-notebook-entry-id="${id}"]`;
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelectorAll("[data-notebook-entry-id]").length === 6');

  // 1. Workspace overview
  await click(row('demo-run-a'));
  await check('document.getElementById("biology-notebook-protocol-title").textContent === "Buffer A pilot"', 'Selecting a page row opens that page');
  await shot('01-notebook-workspace', 'Open the Notebook', 'Projects and their pages are on the left; the open page is on the right.', null,
    [['#biology-notebook-rail', 'Projects and pages'], ['#biology-notebook-protocol-area', 'Read and edit the page'], ['#biology-notebook-tool-fold-toggle', 'Bench toolbox']]);

  // 2. New project
  await click('#biology-notebook-header-add-project-btn');
  await input('#biology-notebook-project-name', 'Enzyme assay · tutorial');
  await evaluate('document.getElementById("biology-notebook-project-details").open = true;');
  await input('#biology-notebook-project-description', 'Fictional teaching project for trying the Notebook.');
  await shot('02-new-project', 'Create a project', 'Name the project, optionally describe it, then create it.', '.biology-notebook-project-dialog',
    [['#biology-notebook-project-name', 'Project name'], ['#biology-notebook-project-details summary', 'Optional description'], ['#biology-notebook-project-create-btn', 'Create project']]);
  await evaluate('document.getElementById("biology-notebook-project-form").requestSubmit();');
  await waitFor('tutorial.state.projects.length === 3 && !document.getElementById("biology-notebook-project-dashboard").hidden');
  await check('document.querySelector("[data-notebook-project-name=\\"Enzyme assay · tutorial\\"]")', 'Create project adds a project folder and opens its dashboard');

  // 3. New experiment
  await click('#biology-notebook-new-experiment-btn');
  await input('#biology-notebook-project-select', 'demo-stability');
  await input('#biology-notebook-protocol-search', 'buffer');
  await click('[data-notebook-experiment-protocol-id="demo-buffer-check"]');
  await check('!document.getElementById("biology-notebook-experiment-start-btn").disabled', 'Choosing a project and protocol enables Start Experiment');
  await shot('03-new-experiment', 'Start a new experiment', 'Choose the project and protocol for the new notebook page.', '.biology-notebook-experiment-dialog',
    [['#biology-notebook-project-select', 'Choose the project'], ['#biology-notebook-experiment-kind', 'Start from a single protocol'], ['#biology-notebook-protocol-search', 'Search protocols'],
      ['[data-notebook-experiment-protocol-id="demo-buffer-check"]', 'Select the protocol'], ['#biology-notebook-experiment-start-btn', 'Start Experiment']]);
  await evaluate('document.getElementById("biology-notebook-experiment-form").requestSubmit();');
  await check('document.getElementById("biology-notebook-experiment-dialog-overlay").hidden && document.getElementById("biology-notebook-protocol-title").textContent === "Buffer exchange check" && tutorial.state.notebookEntries.length === 6',
    'Start Experiment opens an unsaved page from the protocol');

  // 4. Fill fields
  const token = id => `[data-inline-token][data-nb-key-ref="${id}"]`;
  const editor = id => `[data-inline-input][data-nb-key-ref="${id}"]`;
  await check(`document.querySelector('${token('b-temp')}').classList.contains('is-suggested') && !document.querySelector('${token('b-protein')}').classList.contains('is-suggested')`,
    'Repeated parameter values appear as suggestions; sample fields never do');
  await click(token('b-protein'));
  await input(editor('b-protein'), 'Model');
  await shot('04-fill-fields', 'Fill in the protocol fields', 'Click a field and type. Sample fields offer matching samples.', ['#biology-notebook-steps .notebook-step-line strong', '#biology-notebook-steps .notebook-step-content', '.biology-notebook-sample-suggestions'],
    [[editor('b-protein'), 'Type in the field'], ['.biology-notebook-sample-suggestions [role="option"]', 'Choose a matching sample', 'right'], [token('b-temp'), 'Suggested value: press Tab']], { side: true });
  await evaluate('document.querySelector(".biology-notebook-sample-suggestions [role=\\"option\\"]").click();');
  await click(token('b-buffer'));
  await input(editor('b-buffer'), 'Buffer A');
  await key(editor('b-buffer'), 'Enter');
  await click(token('b-temp'));
  await key(editor('b-temp'), 'Tab');
  await check(`document.querySelector('[data-nb-key="b-buffer"]').value === 'Buffer A' && document.querySelector('[data-nb-key="b-temp"]').value === '4 °C'`, 'Enter keeps a typed value; Tab accepts a suggested value');
  await check(`document.querySelector('[data-nb-key="b-protein"]').value.includes('Model protein A') && document.querySelector('${token('b-protein')}').classList.contains('is-linked-sample')`, 'Choosing a sample links it to the field');
  await click(token('b-conc'));
  await key(editor('b-conc'), 'Tab');
  await click(token('b-time'));
  await input(editor('b-time'), '30 min');
  await key(editor('b-time'), 'Enter');

  // 5. Notes and result files
  await input('#biology-notebook-result', 'Fictional teaching note: the Buffer A tube stayed clear after 30 min.');
  await evaluate('const t = new DataTransfer(); t.items.add(new File(["tube,appearance\\nA,clear\\n"], "buffer-a-observations.csv", { type: "text/csv" })); const el = document.getElementById("biology-notebook-result-file"); el.files = t.files; el.dispatchEvent(new Event("change", { bubbles: true }));');
  await waitFor('!document.getElementById("biology-notebook-result-attachments").hidden');
  await scrollTo('#biology-notebook-result-file');
  await shot('05-notes-files', 'Record notes and result files', 'Type your observations, then choose any result files for this page.',
    ['.biology-notebook-notes-field', '#biology-notebook-result-file', '#biology-notebook-result-attachments'],
    [['#biology-notebook-result', 'Type your notes'], ['#clarify-save-biology-notebook-btn', 'Optional: Clarify and Save'], ['#biology-notebook-result-file', 'Choose result files']], { side: true });

  // 6. Save and rename
  await click('#save-biology-notebook-btn');
  await waitFor('tutorial.state.notebookEntries.length === 7');
  const pageId = await evaluate('return tutorial.state.notebookEntries.at(-1).id;');
  await check(`${entry(pageId)}.values['b-buffer'] === 'Buffer A' && ${entry(pageId)}.result.includes('stayed clear') && ${entry(pageId)}.resultFiles.includes('buffer-a-observations.csv') && tutorial.calls.some(c => c.kind === 'store')`,
    'Save notebook page stores the field values, notes, and a copy of the result file');
  await check(`${entry(pageId)}.notebookState === 'executed' && document.querySelector('${row(pageId)}')?.textContent.includes('Executed')`, 'A new page saved directly is listed in its project as Executed');
  await scrollTo('#biology-notebook-protocol-title');
  await shot('06-save-page', 'Save the page', 'Use the disk icon to save. Double-click the title to rename the page.', '.biology-notebook-viewer-head',
    [['#biology-notebook-protocol-title', 'Double-click the title to rename', 'right'], ['#save-biology-notebook-btn', 'Save notebook page']]);
  await evaluate('document.getElementById("biology-notebook-protocol-title").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));');
  await input('#biology-notebook-experiment-name', 'Buffer A second run');
  await key('#biology-notebook-experiment-name', 'Enter');
  await check(`document.getElementById('biology-notebook-protocol-title').textContent === 'Buffer A second run' && ${entry(pageId)}.experimentName !== 'Buffer A second run'`, 'A renamed title waits for Save');
  await click('#save-biology-notebook-btn');
  await waitFor(`${entry(pageId)}.experimentName === 'Buffer A second run'`);
  manifest.checks.push('Save stores the new page title');

  // 6. Bench toolbox
  await click('#biology-notebook-tool-fold-toggle');
  await waitFor('document.getElementById("biology-notebook-layout").classList.contains("is-tool-sidebar-open")');
  // The toolbox is 132 px square; this one figure magnifies the real widget so its icons stay legible.
  await evaluate('document.getElementById("biology-notebook-tool-sidebar").style.transform = "scale(2)"; document.getElementById("biology-notebook-tool-sidebar").style.transformOrigin = "top right";');
  await shot('07-bench-toolbox', 'Open the bench toolbox', 'Shown at twice its size. Calculators are in the top row; the other icons add work to the page.', '#biology-notebook-tool-sidebar',
    [['.biology-notebook-tool-tab', 'Buffer and reaction calculators'], ['.biology-notebook-tool-icon-action', 'Add gel, assay, samples, or tables', 'right'], ['#biology-notebook-tool-collapse-btn', 'Fold the toolbox', 'right']], { side: true });
  await evaluate('document.getElementById("biology-notebook-tool-sidebar").style.transform = "";');

  // 7. Tables
  const typeCell = (table, rowIndex, column, value) => evaluate(`
    const host = document.querySelectorAll('[data-result-table-host]')[${table}];
    const cell = host.querySelectorAll('.tabulator-row')[${rowIndex}].querySelectorAll('.tabulator-cell')[${column + 1}];
    cell.click();
    await new Promise(r => setTimeout(r, 40));
    const field = cell.querySelector('input');
    if (!field) throw new Error('No table cell editor');
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(r => setTimeout(r, 40));`);
  // Tabulator cells carry no stable selector, so the preview tags the ones a callout needs.
  const cellExpression = (table, rowIndex, column) => `document.querySelectorAll('[data-result-table-host]')[${table}].querySelectorAll('.tabulator-row')[${rowIndex}].querySelectorAll('.tabulator-cell')[${column + 1}]`;
  const markCell = async (name, table, rowIndex, column) => {
    await evaluate(`${cellExpression(table, rowIndex, column)}.setAttribute('data-tutorial-target', ${JSON.stringify(name)});`);
    return `[data-tutorial-target="${name}"]`;
  };
  await click('#biology-notebook-add-table-btn');
  await waitFor('!document.getElementById("biology-notebook-table-size-overlay").hidden');
  await input('#biology-notebook-table-size-rows', '3');
  await evaluate('document.getElementById("biology-notebook-table-size-form").requestSubmit();');
  await waitFor('document.querySelectorAll("#biology-notebook-result-table .tabulator-row").length === 3');
  manifest.checks.push('Add Table inserts a table of the chosen size');
  for (const [r, c, v] of [[0, 0, 'Tube'], [0, 1, 'Buffer'], [0, 2, 'Appearance'], [1, 0, 'A1'], [1, 1, 'Buffer A'], [1, 2, 'clear']]) await typeCell(0, r, c, v);
  await check('[...document.querySelectorAll("#biology-notebook-result-table .tabulator-row")[1].querySelectorAll(".tabulator-cell")].some(c => c.textContent.trim() === "Buffer A")', 'Clicking a cell and typing fills the table');
  await scrollTo('#biology-notebook-result-table-wrap');
  await evaluate(`const cell = document.querySelectorAll('#biology-notebook-result-table .tabulator-row')[2].querySelectorAll('.tabulator-cell')[2]; const r = cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10 }));`);
  await waitFor('!document.getElementById("biology-notebook-table-context-menu").hidden');
  await shot('08-result-table', 'Fill and shape the table', 'Click a cell to type. Right-click the table for row, column, and remove actions.', ['#biology-notebook-result-table-wrap', '#biology-notebook-table-context-menu'],
    [[await markCell('typed-cell', 0, 1, 1), 'Click a cell and type'], ['#biology-notebook-table-context-menu', 'Right-click: rows, columns, remove'], ['[data-result-table-add-row="0"]', 'Add row']], { side: true });
  await click('#biology-notebook-add-table-column-btn');
  await check('document.querySelectorAll("#biology-notebook-result-table .tabulator-row")[0].querySelectorAll(".tabulator-cell").length === 5', 'Add Column adds a column to the table');
  await click('#biology-notebook-add-molarity-btn');
  await waitFor('document.querySelectorAll("[data-result-table-host]").length === 2');
  for (const [c, v] of [[0, 'NaCl'], [1, '58.44'], [2, '292.2'], [3, '50']]) await typeCell(1, 0, c, v);
  await check('document.querySelectorAll("[data-result-table-host]")[1].querySelector(".tabulator-row").querySelectorAll(".tabulator-cell")[5].textContent.trim() === "100"', 'The molarity table computes the missing value');
  await scrollTo('[data-result-table-editor="1"]');
  await shot('09-molarity-table', 'Calculate molarity in a table', 'Fill any three of MW, weight, volume, and molarity; the fourth is calculated.', '[data-result-table-editor="1"]',
    [[await markCell('mw', 1, 0, 1), 'MW'], [await markCell('weight', 1, 0, 2), 'Weight'], [await markCell('volume', 1, 0, 3), 'Volume'], [await markCell('molarity', 1, 0, 4), 'Calculated molarity']]);
  await click('#save-biology-notebook-btn');
  await waitFor(`${entry(pageId)}.resultTables.length === 2`);
  manifest.checks.push('Save stores both tables with the page');

  // 8. Buffer preparer
  await click('#biology-notebook-tool-tab-buffer');
  await waitFor('!document.getElementById("biology-notebook-tool-workspace").hidden');
  for (const [id, value] of [['volume', '50'], ['ph', '7.4'], ['name-1', 'Tris base'], ['mw-1', '121.14'], ['final-1', '20 mM'], ['name-2', 'NaCl'], ['mw-2', '58.44'], ['final-2', '150 mM']]) {
    await input(`#biology-notebook-tool-buffer-${id}`, value);
  }
  await evaluate('document.dispatchEvent(new MouseEvent("click", { bubbles: true }));');
  await check('document.getElementById("biology-notebook-tool-buffer-amount-2").placeholder.includes("g")', 'The buffer preparer calculates each amount');
  await scrollTo('#biology-notebook-tool-workspace');
  await shot('10-buffer-preparer', 'Prepare a buffer', 'Enter the volume and each ingredient; amounts are calculated in the sheet.', '#biology-notebook-tool-workspace',
    [['.biology-notebook-buffer-meta-row', 'Volume and pH'], ['#biology-notebook-tool-buffer-row-1', 'One ingredient per row'], ['#biology-notebook-tool-buffer-amount-1', 'Calculated amount', 'right'], ['#biology-notebook-tool-buffer-add-row', 'Add ingredient']]);
  await click('#biology-notebook-tool-tab-buffer');
  await check('document.getElementById("biology-notebook-tool-workspace").hidden && document.querySelector("#biology-notebook-tool-calculations [data-tool-calculation-edit]")', 'Closing the calculator leaves its table on the page');
  await click('#save-biology-notebook-btn');
  await waitFor(`${entry(pageId)}.toolCalculations.length === 1`);
  manifest.checks.push('Save stores the buffer calculation with the page');

  // 9. Samples, gels, assays
  await click('#biology-notebook-add-samples-btn');
  await waitFor('!document.getElementById("biology-notebook-quick-sample-overlay").hidden');
  await input('#biology-notebook-quick-sample-name', 'Protein A in Buffer A');
  await input('#biology-notebook-quick-sample-type', 'protein');
  await input('#biology-notebook-quick-sample-concentration', '1 mg/mL');
  await shot('11-add-sample', 'Add a sample to the page', 'Choose where it is stored, enter its details, then add it.', '.biology-notebook-quick-sample-dialog',
    [['.biology-notebook-quick-sample-location.is-selected', 'Storage location'], ['#biology-notebook-quick-sample-container', 'Container'], ['.biology-notebook-quick-sample-well.is-selected', 'Position'],
      ['#biology-notebook-quick-sample-name', 'Sample Name'], ['#biology-notebook-quick-sample-submit-btn', 'Add Sample']], { side: false });
  await evaluate('document.getElementById("biology-notebook-quick-sample-form").requestSubmit();');
  await waitFor('document.getElementById("biology-notebook-quick-sample-overlay").hidden');
  await check(`tutorial.state.samples.length === 2 && ${entry(pageId)}.sampleLinks.some(link => link.sampleId === tutorial.state.samples[1].id) && ${entry(pageId)}.result.includes('Protein A in Buffer A')`,
    'Add Sample creates the sample, links it to the page, and adds a note line');
  await click('#biology-notebook-add-gel-btn');
  await waitFor(`tutorial.calls.some(c => c.kind === 'gel' && c.notebookEntryId === ${JSON.stringify(pageId)})`);
  manifest.checks.push('Add gel opens Gel for the current page');
  await click('#biology-notebook-tool-collapse-btn');

  // 10. Page protocol copy
  await scrollTo('#biology-notebook-protocol-title');
  await click('#biology-notebook-edit-protocol-btn');
  await evaluate('const el = document.getElementById("biology-notebook-page-protocol-steps"); el.value += "\\n• Photograph each tube."; el.dispatchEvent(new Event("input", { bubbles: true }));');
  await shot('12-edit-page-copy', 'Change this page’s protocol copy', 'Edits apply to this page only; the saved protocol stays unchanged.', ['.biology-notebook-viewer-head', '#biology-notebook-protocol-editor'],
    [['#biology-notebook-page-protocol-steps', 'One step per line'], ['#biology-notebook-apply-protocol-edit-btn', 'Apply page edit'], ['#biology-notebook-cancel-protocol-edit-btn', 'Cancel page edit', 'right']]);
  await click('#biology-notebook-apply-protocol-edit-btn');
  await check(`${entry(pageId)}.protocolSnapshot.steps.length === 5 && tutorial.state.protocols.find(p => p.id === 'demo-buffer-check').steps.length === 4`, 'Apply page edit changes the page copy only');

  // 11. Suggested and planned pages
  await click(row('demo-suggested'));
  await check('!document.getElementById("biology-notebook-take-into-plan-btn").hidden && document.getElementById("biology-notebook-mark-executed-btn").hidden', 'A suggested page offers Take Into Plan');
  await click('#biology-notebook-take-into-plan-btn');
  await waitFor(`${entry('demo-suggested')}.notebookState === 'planned'`);
  manifest.checks.push('Take Into Plan turns a suggested page into a planned page');
  await click(row('demo-run-repeat'));
  await check('!document.getElementById("biology-notebook-mark-executed-btn").hidden', 'A planned page offers Executed');
  await shot('13-planned-page', 'Complete a planned experiment', 'Open a Planned page, record the run, then mark it Executed.', ['[data-notebook-project-id="demo-stability"]', row('demo-run-a'), '.biology-notebook-viewer-head'],
    [[row('demo-run-repeat'), 'Planned page'], ['#biology-notebook-mark-executed-btn', 'Executed']]);
  await click('#biology-notebook-mark-executed-btn');
  await check(`${entry('demo-run-repeat')}.notebookState === 'executed' && ${entry('demo-run-repeat')}.executedAt`, 'Executed records the page as executed with a time');

  // 12. Project dashboard
  await click('[data-notebook-project-id="demo-stability"]');
  await waitFor('!document.getElementById("biology-notebook-project-dashboard").hidden');
  await shot('14-project-dashboard', 'Review a project', 'Click a project folder to open its dashboard.', null,
    [['[data-notebook-project-id="demo-stability"]', 'Project folder'], ['[data-suggest-experiment]', 'Suggest next experiment'], ['#biology-notebook-project-export-pdf-btn', 'Export All Pages as PDF']]);

  // 13. Export and print
  await click(row(pageId));
  await scrollTo('#biology-notebook-protocol-title');
  await shot('15-export-print', 'Export or print the page', 'Use the document icon for a PDF, or the printer icon to print.', '.biology-notebook-viewer-head',
    [['#biology-notebook-export-btn', 'Export PDF'], ['#biology-notebook-print-btn', 'Print', 'right']]);

  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
