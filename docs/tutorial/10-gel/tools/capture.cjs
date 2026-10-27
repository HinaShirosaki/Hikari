// Run from the repository root: node docs/tutorial/10-gel/tools/capture.cjs
// Captures real Gel controls in a disposable Electron profile, then renders
// editable SVG callouts around the screenshots. No production files are edited.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require(path.join(root, 'node_modules/electron')), [__filename], {
    stdio: 'inherit', env: { ...process.env, TZ: 'America/Chicago' }, timeout: 180000
  });
  if (result.error || result.signal) console.error(result.error || `Electron exited with signal ${result.signal}`);
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-gel-tutorial-'));
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
  mode: 'Real Gel renderer; simulated gel images; in-memory desktop adapters; no research workspace opened.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const pluginRoot = path.join(root, 'src/plugins/gel');
  const pluginUrl = file => pathToFileURL(path.join(pluginRoot, file)).href;
  let html = fs.readFileSync(path.join(pluginRoot, 'index.html'), 'utf8');
  const markup = fs.readFileSync(path.join(pluginRoot, 'vendor/gel-view.html'), 'utf8').replace('class="view"', 'class="view is-active"');
  html = html.slice(0, html.indexOf('  <body')) + `<body class="plugin-gel theme-day"><div id="gel-host">${markup}</div><script type="module" src="${pathToFileURL(path.join(__dirname, 'gel-fixture.mjs')).href}"></script></body></html>`;
  html = html.replace(/(?:href|src)="\.\/([^"]+)"/g, (match,file) => match.slice(0,match.indexOf('=')+1)+'"'+pluginUrl(file)+'"');
  const fixture = path.join(scratch, 'gel.html');
  fs.writeFileSync(fixture, html);
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
    await evaluate('document.querySelectorAll("[data-hikari-transient-toast]").forEach(t => { t.hidden = true; }); await document.fonts.ready; await tutorial.controller.waitForProcessing(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));');
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Gel renderer · 25 October 2026</text></svg>`;
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
  await waitFor('window.tutorialReady && document.getElementById("gel-figure-add-btn")');
  await click('#gel-figure-add-btn');
  await shot('01-import-image', 'Open Gel and import an image', 'Use Add gel to choose image files, or drop an image into the empty viewer.', null,
    [['#gel-figure-add-btn','Open Add gel'], ['[data-figure-action=import]','Choose image files']]);
  await evaluate('document.getElementById("gel-figure-add-menu").hidePopover();');
  fs.writeFileSync(path.join(folder,'examples/simulated-gel.png'),Buffer.from((await evaluate('return tutorial.image;')).split(',')[1],'base64'));
  fs.writeFileSync(path.join(folder,'examples/simulated-control.png'),Buffer.from((await evaluate('return tutorial.controlImage;')).split(',')[1],'base64'));
  await evaluate('await tutorial.loadImage();');
  await waitFor('!document.getElementById("gel-crop-mode-btn").disabled && document.querySelector("[data-figure-row]")');
  await shot('02-gel-workspace', 'Find the gel navigator, canvas, and tools', 'Select gels on the left; edit the image in the center with the tools on the right.', null,
    [['#gel-navigation','Select a gel'], ['#gel-canvas','Inspect the image'], ['.gel-viewer-toolbar','Choose an editing tool']]);
  await input('#gel-name','Target signal · example');
  await input('#gel-type','western');
  await shot('03-name-and-type','Name the gel and choose its analysis type','Use Image tools to identify the gel and choose the matching analysis type.','#gel-tools-panel',
    [['#gel-name','Enter the gel name'], ['#gel-type','Choose the analysis type']]);
  await evaluate('document.querySelector("[data-figure-row]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));');
  await input('[data-gel-navigation-rename]','Target signal · example');
  await key('[data-gel-navigation-rename]','Enter');
  await click('#gel-crop-mode-btn');
  await waitFor('document.querySelector(".cropper-container") && !document.getElementById("gel-apply-crop-btn").disabled');
  await input('#gel-crop-angle','1.5');
  await shot('04-crop-and-rotate','Crop and straighten the image','Drag the crop handles, adjust Straighten, then use Done or Cancel.',['.cropper-container','#gel-tools-panel'],
    [['.cropper-crop-box','Drag the crop handles'], ['#gel-crop-angle','Straighten the image'], ['#gel-apply-crop-btn','Done keeps the crop']]);
  await click('#gel-cancel-crop-btn');
  await check('document.getElementById("gel-canvas").width===900','Cancel crop keeps the full simulated source image');
  await click('#gel-process-image-btn');
  await input('#gel-denoise-strength','20');
  await input('#gel-contrast-strength','85');
  await shot('05-processed-preview','Adjust and compare the processed image','Use the sliders, then switch Processed view off and on to compare with the original.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-processed-preview','Compare original and processed'], ['#gel-denoise-strength','Adjust denoise'], ['#gel-contrast-strength','Adjust contrast']]);
  await check('document.getElementById("gel-processed-preview").checked','Processed tools enable the processed preview');
  await click('#gel-tool-lanes-btn');
  await input('#gel-expected-lane-count','6');
  await shot('06-detect-lanes','Detect the lanes','Enter the expected lane count and click Auto-detect, then review every boundary.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-expected-lane-count','Enter the expected lane count'], ['#gel-auto-detect-lanes-btn','Auto-detect the dividers']]);
  await click('#gel-auto-detect-lanes-btn');
  await waitFor('!document.getElementById("gel-finish-dividers-btn").hidden');
  await shot('07-adjust-dividers','Adjust and finish lane dividers','Drag existing boundaries, click to add a boundary, then finish the divider step.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-canvas','Inspect and adjust lane boundaries'], ['#gel-finish-dividers-btn','Finish dividers']]);
  await click('#gel-finish-dividers-btn');
  await check('!document.getElementById("gel-add-table-btn").disabled','Finished lane dividers enable lane tables and image export');
  await click('#gel-tool-lane-vertices-btn');
  await shot('08-lane-vertices','Correct a tilted lane with Vertices','Use the corner handles to refine lane geometry, then leave Vertices when finished.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-tool-lane-vertices-btn','Toggle Vertices'], ['#gel-canvas','Drag a lane corner horizontally']]);
  await click('#gel-tool-lane-vertices-btn');
  await click('#gel-tool-ladder-btn');
  await click('#gel-tool-ladder-lane-btn');
  await evaluate('tutorial.pointer("click",.08,.13);');
  await shot('09-ladder-setup','Select the ladder lane and preset','Pick the ladder lane, choose its preset, and detect the ladder bands.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-ladder-preset','Choose the matching ladder preset'], ['#gel-tool-ladder-lane-btn','Pick the ladder lane'], ['#gel-detect-ladder-btn','Detect ladder bands']]);
  await click('#gel-detect-ladder-btn');
  await click('#gel-tool-ladder-mw-btn');
  await evaluate('tutorial.pointer("click",.08,.13);');
  await waitFor('!document.getElementById("gel-ladder-mw-editor").hidden');
  await input('#gel-ladder-band-mw','250');
  await shot('10-ladder-mw','Enter or correct a ladder label','With Set MW on, click a ladder band, enter its size, and press Enter.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-tool-ladder-mw-btn','Enable Set MW'], ['#gel-ladder-band-mw','Enter the known band size']]);
  await evaluate('document.getElementById("gel-ladder-mw-editor").requestSubmit();');
  await check('document.getElementById("gel-ladder-mw-editor").hidden','Submitting a positive ladder label closes the MW editor');
  await click('#gel-tool-ladder-mw-btn');
  await click('#gel-tool-bands-btn');
  await click('#gel-tool-band-top-btn');
  await evaluate('tutorial.pointer("click",.4,.55);tutorial.pointer("click",.4,.66);');
  await shot('11-band-window','Set the target band window','Use Top and Bottom to surround the band region across the lanes.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-tool-band-top-btn','Set the top edge'], ['#gel-tool-band-bottom-btn','Set the bottom edge'], ['#gel-canvas','Review the selected band window']]);
  await click('#gel-lane-band-mode-btn');
  await evaluate('tutorial.pointer("click",.25,.56);tutorial.pointer("click",.25,.65);');
  await shot('12-per-lane-window','Set a different band window for each lane','Enable Per lane, then place the Top and Bottom edges for each lane.',['#gel-canvas','#gel-tools-panel'],
    [['#gel-lane-band-mode-btn','Use separate per-lane windows'], ['#gel-canvas','Place each lane window']]);
  await click('#gel-lane-band-mode-btn');
  await click('#gel-tool-band-top-btn');
  await evaluate('tutorial.pointer("click",.4,.55);tutorial.pointer("click",.4,.66);');
  await click('#gel-tool-results-btn');
  await click('#gel-open-band-intensity-btn');
  await waitFor('document.querySelectorAll("#gel-cell-table-host tbody tr").length>0');
  await shot('13-band-intensity','Read and copy band intensities','Inspect the graph and measurement table, then copy the table for a spreadsheet.','#gel-cell-table-panel',
    [['#gel-band-intensity-chart','Compare the measured intensities'], ['#gel-cell-table-host','Read the measurement table'], ['#gel-cell-table-copy-btn','Copy the full table']]);
  await click('#gel-cell-table-copy-btn');
  await waitFor('tutorial.copiedText.startsWith("Lane\\tLabel\\tBand intensity")');
  manifest.checks.push('Copy table includes measurement headers and numeric band intensities');
  await click('#gel-cell-table-panel [data-gel-window-close]');
  await input('#gel-lane-profile-select','2');
  await shot('14-lane-profile','Inspect a lane intensity profile','Choose a lane to inspect its intensity profile in Results.','#gel-tools-panel',
    [['#gel-lane-profile-select','Choose the lane'], ['#gel-lane-profile-chart','Inspect its intensity profile'], ['#gel-open-peak-editor-btn','Open the peak editor']]);
  await click('#gel-open-peak-editor-btn');
  await input('#gel-peak-editor-lane-select','2');
  await evaluate('const chart=document.getElementById("gel-peak-editor-chart"),r=chart.getBoundingClientRect();for(const f of [.48,.75])chart.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:r.x+r.width*f,clientY:r.y+r.height*.8}));');
  await waitFor('document.querySelectorAll("#gel-peak-editor-table .tabulator-row").length>0');
  await shot('15-peak-baseline','Define a peak integration baseline','Choose a lane, select Baseline, and click a point on each side of a peak region.','#gel-peak-editor-overlay',
    [['#gel-peak-editor-lane-select','Choose the lane'], ['#gel-peak-editor-baseline-mode-btn','Use Baseline mode'], ['#gel-peak-editor-chart','Click two baseline endpoints']]);
  const peakRows=await evaluate('return document.querySelectorAll("#gel-peak-editor-table .tabulator-row").length;');
  await click('#gel-peak-editor-divider-mode-btn');
  await evaluate('const chart=document.getElementById("gel-peak-editor-chart"),r=chart.getBoundingClientRect();chart.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:r.x+r.width*.615,clientY:r.y+r.height*.5}));');
  await waitFor(`document.querySelectorAll("#gel-peak-editor-table .tabulator-row").length>${peakRows}`);
  await shot('16-peak-divider','Split a selected integration region','Use Divider inside an existing baseline region and inspect the recalculated areas.','#gel-peak-editor-overlay',
    [['#gel-peak-editor-divider-mode-btn','Add a vertical divider'], ['#gel-peak-editor-table','Read the calculated peak areas'], ['#gel-peak-editor-clear-lane-btn','Clear this lane if needed']]);
  manifest.checks.push('A baseline creates a peak integration and Divider splits it into separate rows');
  await click('#gel-peak-editor-close-btn');
  await click('#gel-tool-lanes-btn');
  await click('#gel-open-lane-table-btn');
  await click('#gel-add-table-btn');
  await input('[data-gel-table-role=label]','Label');
  for(let lane=0;lane<6;lane++)await input(`[data-gel-table-role=value][data-gel-table-col="${lane}"]`,['Ladder','Control','Sample A','Sample B','Sample C','Sample D'][lane]);
  await shot('17-lane-table','Add lane labels to the figure','Enter a row label and lane values; add more rows when needed.',['#gel-lane-table-panel','#gel-canvas'],
    [['[data-gel-table-role=label]','Name the table row'], ['.gel-lane-table-grid-shell','Enter each lane label'], ['[data-gel-table-add-row]','Add another table row']]);
  await click('#gel-save-btn');
  await waitFor('document.getElementById("gel-form").getAttribute("aria-busy")==="false"');
  await check('tutorial.state.gelAnalyses.some(r=>r.name.includes("Target signal")&&r.manualOverrides?.laneTable?.rows?.length)','Save retains the named gel, processing selections, and lane table');
  await shot('18-save-gel','Save and reopen a gel','Save the current gel; use its entry in the Gels navigator to return to it.',null,
    [['#gel-save-btn','Save the gel record'], ['[data-figure-row]','Reopen the gel from its row']]);
  await evaluate('await tutorial.loadImage(1,"#gel-figure-files");');
  await waitFor('document.querySelectorAll("[data-figure-row]").length===2');
  await evaluate('document.querySelectorAll("[data-figure-row]")[1].click();');
  await input('#gel-name','Loading control · example');
  await input('#gel-expected-lane-count','6');
  await click('#gel-tool-lanes-btn');
  await click('#gel-auto-detect-lanes-btn');
  await waitFor('!document.getElementById("gel-finish-dividers-btn").hidden');
  await click('#gel-finish-dividers-btn');
  await click('#gel-tool-bands-btn');
  await click('#gel-tool-band-top-btn');
  await evaluate('tutorial.pointer("click",.4,.55);tutorial.pointer("click",.4,.66);');
  await click('#gel-save-btn');
  await waitFor('document.getElementById("gel-form").getAttribute("aria-busy")==="false"');
  await shot('19-create-stack','Create a stack for related gels','Add a stack, then drag gel entries into it to arrange them together.',['.gel-figure-header','[data-figure-row]'],
    [['#gel-figure-stack-btn','Add stack'], ['[data-figure-row]','Drag gel entries into a stack']]);
  await click('#gel-figure-stack-btn');
  await evaluate('const ids=[...document.querySelectorAll("[data-figure-row]")].map(row=>row.dataset.figureRow);for(const id of ids)tutorial.moveGel(id);');
  await check('document.querySelectorAll("[data-figure-stack-member]").length===2','Dragging two gel entries places them in the selected stack');
  await click('[data-figure-stack-view]');
  await shot('20-stack-layout','Arrange gels in a stack','Select a blot to adjust its placement, or return to its processing view.',['.gel-figure-stack-group','#gel-figure-preview canvas','#gel-tools-panel','#gel-open-figure-btn'],
    [['[data-figure-stack-view]','Open the stack preview'], ['#gel-figure-preview canvas','Drag blots to arrange the figure'], ['#gel-open-figure-btn','Open or close Layout tools']]);
  await click('[data-figure-action=trim]');
  await waitFor('document.querySelector("[data-trim-edge=left]")');
  await shot('21-stack-trim','Trim every blot to the same horizontal edges','Move the two trim handles, then apply the shared trim.',['#gel-figure-preview canvas','#gel-tools-panel'],
    [['[data-trim-edge=left]','Set the left edge'], ['[data-trim-edge=right]','Set the right edge'], ['[data-figure-action=apply-trim]','Apply trim']]);
  await key('[data-trim-edge=left]','ArrowRight');
  await click('[data-figure-action=apply-trim]');
  await check('!document.getElementById("gel-figure-preview").classList.contains("is-trimming")','Apply trim leaves trim mode and retains the shared stack crop');
  await click('#gel-export-menu-btn');
  await shot('22-export-menu','Export a gel or the current stack','PNG and PPTX export the displayed figure; Bands CSV uses the active gel report.','#gel-export-menu',
    [['#gel-export-image-btn','Export Image (PNG)'], ['#gel-export-pptx-btn','Export PowerPoint (PPTX)'], ['#gel-export-csv-btn','Export Bands (CSV)']]);
  await evaluate('document.getElementById("gel-export-menu").hidePopover();');
  await click('#gel-save-btn');
  await waitFor('tutorial.exports.some(item=>item.content?.includes("stacks"))');
  await check('JSON.parse(tutorial.exports.findLast(item=>item.content).content).rows.length===2','Save project serializes both gel layers and their stack into a portable JSON file');
  const project=await evaluate('return tutorial.exports.findLast(item=>item.content).content;');
  fs.writeFileSync(path.join(folder,'examples/practice.gel-figure.json'),project);
  await click('#gel-figure-add-btn');
  await shot('23-project-backup','Save and reopen a portable project','In Stack, Save project downloads the project; Add gel > Project opens one.',null,
    [['#gel-save-btn','Save project from the stack'], ['[data-figure-action=open]','Open a project file']]);
  await evaluate('document.getElementById("gel-figure-add-menu").hidePopover();');
  await evaluate('const d=new DataTransfer();d.items.add(new File([tutorial.exports.findLast(item=>item.content).content],"practice.gel-figure.json",{type:"application/json"}));const el=document.getElementById("gel-figure-project-file");el.files=d.files;el.dispatchEvent(new Event("change",{bubbles:true}));');
  await waitFor('document.getElementById("gel-figure-status").textContent.includes("project opened")');
  await check('document.querySelectorAll("[data-figure-row]").length===2 && document.querySelectorAll("[data-figure-stack-view]").length===1','Reopening the serialized practice project restores both layers and its stack without duplicating them');
  await evaluate('document.querySelector("[data-figure-row]").click();const row=document.querySelector("[data-figure-row]");row.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));');
  await shot('24-rename-gel','Rename a gel in the navigator','Double-click a name or press F2, then enter the new name and press Enter.',['.gel-figure-header','[data-gel-navigation-rename]','[data-figure-stack-view]'],
    [['[data-gel-navigation-rename]','Edit the selected name']]);
  await input('[data-gel-navigation-rename]','Target signal · renamed');
  await key('[data-gel-navigation-rename]','Enter');
  await check('[...document.querySelectorAll("[data-figure-row]")].some(row=>row.textContent.includes("renamed"))','Inline rename updates the selected gel entry');
  await tutorialSettle();
  fs.writeFileSync(path.join(folder,'capture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
  async function tutorialSettle(){await evaluate('await tutorial.controller.waitForProcessing();await tutorial.controller.saveUnsavedChanges();');}
}
main().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
