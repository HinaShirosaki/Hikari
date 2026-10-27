// Run from the repository root: node docs/tutorial/09-plate/tools/capture.cjs
// Captures real Plate controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-plate-tutorial-'));
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
  exampleDate: '2026-10-25', timezone: 'America/Chicago', viewport: [1600, 1000],
  mode: 'Real Plate renderer; fictional assay values; in-memory desktop adapters; no research workspace opened.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="assay-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/assay-view.html'), 'utf8');
  const libraries = `<script src="${url('vendor/plotly/plotly.min.js')}"></script><script src="${url('vendor/tabulator/tabulator.min.js')}"></script>`;
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const fixture = path.join(scratch, 'plate.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}${libraries}<script type="module" src="${pathToFileURL(path.join(__dirname, 'plate-fixture.mjs')).href}"></script></body>`);
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
  const pointerClick = async selector => {
    const point = await evaluate(`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const input = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`);
  const editingInput = (selector, value) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  const key = async (selector, keyName) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: keyName });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: keyName });
  };
  // The menu opens at the pointer; right-click low on the row so the menu sits below it.
  const contextMenu = selector => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.bottom - 2 }));`);
  // A selector, or a list of them, covers every element it matches.
  const box = async selector => {
    const boxes = (await Promise.all((Array.isArray(selector) ? selector : [selector]).map(item => evaluate(`const els = [...document.querySelectorAll(${JSON.stringify(item)})];
      if (!els.length) throw new Error('Missing ' + ${JSON.stringify(item)});
      const rects = els.map(el => el.getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rects.length) throw new Error('Not visible ' + ${JSON.stringify(item)});
      return rects.map(r => ({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }));`)))).flat();
    const x = Math.min(...boxes.map(r => r.x)), y = Math.min(...boxes.map(r => r.y));
    return { x, y, width: Math.max(...boxes.map(r => r.x + r.width)) - x, height: Math.max(...boxes.map(r => r.y + r.height)) - y };
  };
  const cropOf = async selector => {
    if (!selector) return { x: 0, y: 0, width: 1600, height: 1000 };
    const r = await box(selector);
    const x = Math.max(0, r.x - 18), y = Math.max(0, r.y - 18);
    return { x, y, width: Math.min(1600, r.x + r.width + 18) - x, height: Math.min(1000, r.y + r.height + 18) - y };
  };
  const shot = async (name, title, subtitle, cropSelector, targets, { side } = {}) => {
    // Notices are transient; a reported error means the preview drifted from the real flow.
    const errors = await evaluate('return tutorial.calls.filter(c => c.kind === "error").map(c => c.message);');
    if (errors.length) throw new Error(`Renderer reported an error before ${name}: ${errors.join('; ')}`);
    await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(t => { t.hidden = true; }); await document.fonts.ready; await tutorial.readyPlot(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
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
    const boxes = targetsWithRects.map(({ rect }) => ({ x: imageX + rect.x - crop.x - 4, y: imageY + rect.y - crop.y - 4, w: rect.width + 8, h: rect.height + 8 }));
    const labelAt = slot => {
      const labelX = sideRail ? imageX + crop.width + 32 : 32 + laneWidth * slot + 7;
      const labelY = sideRail ? imageY + (slot + .5) * (height - 140) / targets.length - 20 : imageY + crop.height + 35;
      const labelWidth = sideRail ? width - labelX - 24 : laneWidth - 14;
      return { labelX, labelY, labelWidth, ax: sideRail ? labelX - 7 : labelX + labelWidth / 2, ay: sideRail ? labelY + 20 : labelY - 9 };
    };
    // Arrows end at the nearest point of the highlight, so they cross as little of the UI as possible.
    const arrowFor = (b, l) => [[l.ax, l.ay], [Math.min(Math.max(l.ax, b.x), b.x + b.w), Math.min(Math.max(l.ay, b.y), b.y + b.h)]];
    // Label boxes take the order whose arrows cross each other and the other
    // highlights least, then the shortest; the numbers still follow the steps.
    const orient = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const crosses = ([a, b], [c, d]) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
    const hitsBox = (arrow, b) => [[[b.x, b.y], [b.x + b.w, b.y]], [[b.x + b.w, b.y], [b.x + b.w, b.y + b.h]], [[b.x, b.y + b.h], [b.x + b.w, b.y + b.h]], [[b.x, b.y], [b.x, b.y + b.h]]].some(edge => crosses(arrow, edge));
    const orders = items => items.length < 2 ? [items] : items.flatMap((item, i) => orders(items.filter((_item, j) => j !== i)).map(rest => [item, ...rest]));
    const cost = order => {
      const arrows = boxes.map((b, i) => arrowFor(b, labelAt(order[i])));
      return arrows.reduce((sum, arrow, i) => sum + Math.hypot(arrow[0][0] - arrow[1][0], arrow[0][1] - arrow[1][1])
        + arrows.filter((other, j) => j > i && crosses(arrow, other)).length * 1e6
        + boxes.filter((b, j) => j !== i && hitsBox(arrow, b)).length * 1e4, 0);
    };
    const slots = orders(boxes.map((_b, i) => i)).reduce((best, order) => cost(order) < cost(best) ? order : best);
    const callouts = targetsWithRects.map(({ label, badge }, i) => {
      const { x, y, w, h } = boxes[i];
      const { labelX, labelY, labelWidth } = labelAt(slots[i]);
      const [[ax, ay], [ex, ey]] = arrowFor(boxes[i], labelAt(slots[i]));
      // Badges sit on the top-left corner unless that would cover the target's text.
      const badgeX = badge === 'right' ? x + w - 1 : x + 1;
      const cx = labelX + labelWidth / 2, cy = labelY;
      const reach = Math.hypot(ax - ex, ay - ey) || 1;
      const arrow = `M${ax},${ay} L${ex + (ax - ex) / reach * 5},${ey + (ay - ey) / reach * 5}`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}" fill-opacity=".045" stroke="${color}" stroke-width="3"/>
        <path d="${arrow}" stroke="${color}" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>
        <circle cx="${badgeX}" cy="${y + 1}" r="14" fill="${color}" stroke="white" stroke-width="2"/><text x="${badgeX}" y="${y + 6}" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i + 1}</text>
        <rect x="${labelX}" y="${cy}" width="${labelWidth}" height="40" rx="8" fill="#fffaf3" stroke="#dfdad9"/>
        <text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="#191724" font-size="16" font-weight="600">${i + 1}. ${esc(label)}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Plate renderer · 25 October 2026</text></svg>`;
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
  const markRect = async (name, expression) => {
    await evaluate(`(${expression}).setAttribute('data-tutorial-target', ${JSON.stringify(name)});`);
    return `[data-tutorial-target="${name}"]`;
  };
  const scrollTo = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'});`);
  const upload = (selector, content, name) => evaluate(`const d=new DataTransfer();d.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:'text/csv'}));const el=document.querySelector(${JSON.stringify(selector)});el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));`);
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelector("[data-assay-edit=demo-plate]")');
  fs.mkdirSync(path.join(folder, 'examples'), {recursive:true});
  const layoutCsv = await evaluate('return tutorial.layoutCsv;');
  const resultCsv = await evaluate('return tutorial.matrixCsv;');
  fs.writeFileSync(path.join(folder, 'examples/plate-layout.csv'), layoutCsv);
  fs.writeFileSync(path.join(folder, 'examples/result-matrices.csv'), resultCsv);
  await click('[data-assay-edit=demo-plate]');
  await shot('01-plate-workspace', 'Open Plate and choose Setup or Analyze', 'Setup defines sample IDs and concentrations; Analyze holds results, calculations, and charts.', null,
    [['#assay-mode-switch', 'Setup or Analyze'], ['#assay-form', 'Plate details'], ['#assay-plate-preview', 'Well mappings']]);
  await click('#assay-new-btn');
  await input('#assay-plate-type', '24');
  await input('#assay-name', 'Plate tutorial · practice');
  await input('#assay-project', 'demo-project');
  await shot('02-create-plate', 'Create a new assay plate', 'Choose the well count, name the assay, and assign a project.', '#assay-form',
    [['#assay-plate-type', 'Choose a plate size'], ['#assay-name', 'Name the assay'], ['#assay-project', 'Choose its project']]);
  for (let row = 0; row < 4; row++) await input(`#assay-plate-preview [data-axis-dimension=row][data-axis-index="${row}"]`, row < 2 ? 'Sample A' : 'Sample B');
  await shot('03-axis-mapping', 'Map sample IDs along an axis', 'Choose Row or Column for sample IDs, then enter labels in the plate headers.', ['.assay-axis-config-grid', '#assay-plate-preview'],
    [['#assay-sample-axis-row-btn', 'Sample IDs along rows'], ['#assay-plate-preview [data-axis-dimension=row]', 'Enter the sample labels']]);
  await click('#assay-plate-field-concentration-btn');
  await input('#assay-plate-preview [data-axis-dimension=column][data-axis-index="0"]', '100 uM');
  await input('#assay-dilution-factor', '2');
  await shot('05-fill-concentrations', 'Fill the concentration series', 'Enter the starting concentration, choose a fill method, and click Fill.', ['.assay-plate-toolbar', '#assay-plate-preview'],
    [['#assay-plate-preview [data-axis-dimension=column][data-axis-index="0"]', 'Enter the starting value'], ['#assay-fill-mode', 'Choose the fill method'], ['#assay-dilution-fill-btn', 'Fill the axis']]);
  await click('#assay-dilution-fill-btn');
  await check('document.querySelectorAll("#assay-plate-preview [data-axis-dimension=column]")[1].value.startsWith("50")', 'Dilution fill divides the starting concentration by the factor');
  await click('#assay-plate-field-sample-btn');
  await input('#assay-plate-preview input[data-well="D6"]', 'Blank');
  await shot('04-edit-well', 'Override a single well', 'Choose Sample ID or Concentration and edit the well directly.', ['.assay-plate-toolbar', '#assay-plate-preview'],
    [['#assay-plate-field-sample-btn', 'Choose the field to edit'], ['#assay-plate-preview input[data-well="D6"]', 'Enter the well override']]);
  await input('#assay-plate-preview input[data-well="D6"]', 'Sample B');
  await click('#assay-serial-dilution-btn');
  await input('#assay-serial-dilution-volume', '100');
  for (const sample of ['Sample A', 'Sample B']) await input(`[data-assay-serial-stock-sample="${sample}"]`, '1000 uM');
  await shot('06-serial-dilution', 'Review the serial dilution plan', 'Enter volume per well and stock concentrations, then inspect the calculated tables.', '.assay-serial-dilution-dialog',
    [['#assay-serial-dilution-volume', 'Volume per well'], ['.assay-serial-dilution-stock-table', 'Stock concentrations'], ['#assay-serial-dilution-content > .assay-serial-dilution-sample', 'Review the dilution steps']]);
  await click('#assay-serial-dilution-close-btn');
  await shot('07-layout-csv-save', 'Import or export mappings, then save', 'The CSV controls manage plate mappings; Save keeps the current assay definition.', '.assay-form-actions',
    [['#assay-export-template-btn', 'Export CSV template'], ['#assay-import-template-btn', 'Import layout CSV'], ['#assay-save-btn', 'Save assay']]);
  await upload('#assay-import-file', layoutCsv, 'plate-layout.csv');
  await waitFor('document.getElementById("assay-csv-status").textContent.includes("Imported")');
  await evaluate('document.getElementById("assay-form").requestSubmit();');
  await check('tutorial.state.assays.length === 2 && tutorial.state.assays.some(a=>a.name.includes("Plate tutorial")&&a.wellLayout.length===24)', 'Layout CSV import and Save create a plate with all 24 well mappings');
  await click('#assay-mode-results-btn');
  await waitFor('tutorial.grid()?.getRows().length === 4');
  await shot('08-analyze-workspace', 'Open Analyze for the selected plate', 'The left rail controls analysis; the main area shows the chart and plate tables.', null,
    [['#assay-analysis-panel', 'Data and analysis settings'], ['.assay-workspace-chart', 'Analysis chart'], ['.assay-workspace-data', 'Result and summary tables']]);
  await pointerClick('#assay-result-table .tabulator-row [tabulator-field=c1]');
  await waitFor('document.querySelector("#assay-result-table .tabulator-cell.tabulator-editing input")');
  await editingInput('#assay-result-table .tabulator-editing input', '3');
  await shot('09-enter-results', 'Enter numeric results in the plate grid', 'Edit a result cell, or paste a rectangular block starting at the selected cell.', ['#assay-result-table', '#assay-save-results-btn'],
    [['#assay-result-table .tabulator-cell.tabulator-editing', 'Enter the result value'], ['#assay-save-results-btn', 'Save the current results']]);
  await key('#assay-result-table .tabulator-editing input', 'Enter');
  await waitFor('tutorial.activeAssay().resultValues.A1 === "3"');
  manifest.checks.push('Editing a Table1 cell saves the numeric result on the active plate');
  await upload('#assay-result-file-input', resultCsv, 'result-matrices.csv');
  await waitFor('!document.getElementById("assay-result-import-overlay").hidden');
  await shot('10-import-results', 'Choose the result matrix to import', 'Select the matching matrix, check its preview, then use it for the active plate.', '.assay-result-import-dialog',
    [['#assay-result-import-candidates', 'Choose a detected matrix'], ['#assay-result-import-preview', 'Check the row and column layout'], ['#assay-result-import-apply-btn', 'Use This Matrix']]);
  await click('#assay-result-import-apply-btn');
  await waitFor('document.getElementById("assay-result-import-overlay").hidden && Object.keys(tutorial.activeAssay().resultValues).length===24');
  await check('tutorial.activeAssay().resultAttachments.length === 1', 'Result import fills 24 wells and attaches the source CSV');
  await click('#assay-save-results-btn');
  await click('#assay-transform-open-btn');
  await waitFor('tutorial.transformedGrid()?.getRows().length === 4');
  await pointerClick('#assay-derived-plate-table .tabulator-row [tabulator-field=c1]');
  await waitFor('document.querySelector("#assay-derived-plate-table .tabulator-cell.tabulator-editing input")');
  await editingInput('#assay-derived-plate-table .tabulator-editing input', '=A1*2');
  await shot('11-transform-formula', 'Create a transformed plate with formulas', 'Enter a formula in Table2; bare well references read the original Plate results.', ['#assay-derived-plate-panel', '#assay-data-tabs'],
    [['#assay-data-tab-transformed', 'Transformed plate · Table2'], ['#assay-derived-plate-table .tabulator-cell.tabulator-editing', 'Enter a per-well formula']]);
  await key('#assay-derived-plate-table .tabulator-editing input', 'Enter');
  await waitFor('tutorial.activeAssay().transformSpec?.formulas?.A1 === "=A1*2"');
  manifest.checks.push('A Table2 formula is stored separately from the raw plate results');
  await waitFor('tutorial.transformedGrid().getRows()[0].getCell("c1").getElement().textContent === "6"');
  manifest.checks.push('The transformed A1 formula computes 6 from the original A1 value of 3');
  await scrollTo('#assay-analysis-data-source');
  await shot('12-analysis-source', 'Choose which plate supplies analysis values', 'Switch between original Plate results and the computed Transformed plate.', '#assay-analysis-source-panel',
    [['#assay-analysis-data-source', 'Choose Table1 or Table2']]);
  await input('#assay-analysis-data-source', 'raw');
  await click('#assay-data-tab-raw');
  await evaluate('const g=tutorial.grid();g.addRange(g.getRows()[0].getCell("c1"),g.getRows()[1].getCell("c6"));');
  await click('#assay-analysis-add-row-group-btn');
  await scrollTo('#assay-groups-panel');
  await shot('13-custom-groups', 'Group selected rows or columns', 'Select the table area, then add its rows or columns as a named group.', ['#assay-groups-panel', '#assay-result-table'],
    [['#assay-analysis-add-row-group-btn', 'Add selected rows as a group'], ['#assay-analysis-add-column-group-btn', 'Or group selected columns'], ['#assay-analysis-clear-groups-btn', 'Clear custom groups']]);
  await check('document.getElementById("assay-analysis-row-groups").value.includes("A,B")', 'A selected range can become a custom row group');
  await input('#assay-analysis-group-by', 'sample_concentration');
  await input('#assay-analysis-kind', 'summary');
  await scrollTo('#assay-analysis-settings-panel');
  await shot('14-summary-analysis', 'Choose grouping and a summary method', 'Settings update the analysis; use the Summary tab to read the calculated table.', ['#assay-analysis-settings-panel', '#assay-analysis-table'],
    [['#assay-analysis-group-by', 'Choose how to group wells'], ['#assay-analysis-kind', 'Choose the analysis method'], ['#assay-analysis-table', 'Inspect the resulting chart']]);
  await input('#assay-analysis-group-by', 'sample');
  await input('#assay-analysis-kind', 'linear');
  await input('#assay-analysis-x-axis', 'concentration');
  await evaluate('document.getElementById("assay-analysis-panel").open=false;');
  await shot('15-curve-fit', 'Inspect a fitted curve and its summary', 'Choose a fitting method and X axis, then compare the plotted data and fitted curves.', null,
    [['.assay-workspace-chart', 'Inspect data and fitted curves'], ['#assay-data-tab-summary', 'Open the analysis summary'], ['#assay-workspace-format-btn', 'Format the chart']]);
  await check('document.querySelector("[data-assay-analysis-chart]")?.data?.length > 0', 'The analysis renders real Plotly traces for the example plate');
  await click('#assay-workspace-format-btn');
  await scrollTo('#assay-chart-format-panel');
  await shot('16-format-frame', 'Format the chart frame and canvas', 'Use Chart Format tabs to adjust the frame, axes, data series, text, and elements.', '#assay-chart-format-panel',
    [['.assay-chart-style-tabs', 'Choose a format section'], ['[data-cc=backgroundColor]', 'Set the chart background'], ['[data-cc=presetSaveBtn]', 'Save formatting as a preset']]);
  await click('[data-cc-tab=axis]');
  await input('[data-cc=xScale]', 'log10');
  await shot('17-format-axis', 'Set axis scale and range', 'Choose a scale, use automatic limits, or enter your own axis settings.', '#assay-chart-format-panel',
    [['[data-cc=xScale]', 'Choose the X-axis scale'], ['[data-cc=yScale]', 'Choose the Y-axis scale'], ['[data-cc=xRangeAuto]', 'Keep automatic range or set limits']]);
  await check('tutorial.activeAssay().chartStyle.xScale === "log10"', 'Changing the chart scale saves formatting on the active assay');
  await shot('18-export-chart', 'Export or focus the chart', 'Save an image as PNG or SVG, or expand the chart for a closer look.', '.assay-workspace-chart-header',
    [['#assay-chart-export-png-btn', 'Export PNG'], ['#assay-chart-export-svg-btn', 'Export SVG'], ['#assay-chart-focus-btn', 'Focus the chart']]);
  await click('#assay-chart-focus-btn');
  await check('document.getElementById("assay-chart-focus-btn").getAttribute("aria-pressed")==="true"', 'Focus chart expands the analysis chart');
  await click('#assay-chart-focus-btn');
  await click('#assay-mode-create-btn');
  await evaluate('document.getElementById("assay-browser-panel").open=true;');
  await scrollTo('#assay-browser-panel');
  await shot('19-existing-plates', 'Find and edit a saved plate', 'Use Existing Assays to search records and open the selected plate for editing.', '#assay-browser-panel',
    [['#assay-search', 'Search saved assays'], ['[data-assay-edit=demo-plate]', 'Edit the saved plate']]);
  await shot('20-delete-plate', 'Delete a plate record', 'Check the assay name before using its Delete control.', '#assay-browser-panel',
    [['[data-assay-delete=demo-plate]', 'Delete this plate record']]);
  await click('[data-assay-delete=demo-plate]');
  await check('!tutorial.state.assays.some(a=>a.id==="demo-plate")', 'Delete removes the chosen example assay from the list');
  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
