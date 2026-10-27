// Run from the repository root: node docs/tutorial/08-dna/tools/capture.cjs
// Captures real DNA controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-dna-tutorial-'));
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
  mode: 'Real DNA renderer; fictional data; in-memory desktop adapters; sequence library kept in memory; no research workspace opened; no live searches or orders.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="sequence-viewer-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-view.html'), 'utf8') + fs.readFileSync(path.join(root, 'ui/html/views/sequence-viewer-detail-view.html'), 'utf8');
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const fixture = path.join(scratch, 'dna.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}<script type="module" src="${pathToFileURL(path.join(__dirname, 'dna-fixture.mjs')).href}"></script></body>`);
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real DNA renderer · 25 October 2026</text></svg>`;
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
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelector("#sequence-viewer-library-list [data-sequence-entry-id]")');
  fs.mkdirSync(path.join(folder, 'examples'), {recursive:true});
  fs.writeFileSync(path.join(folder, 'examples/teaching-vector.gbk'), await evaluate('return tutorial.entries.get("demo-vector").gbkText;'));
  const openVector = async () => {
    await evaluate('tutorial.home();');
    await click('#sequence-viewer-library-filter-saved');
    await waitFor('document.querySelector("#sequence-viewer-library-list [data-sequence-entry-id=demo-vector]")');
    await evaluate('document.querySelector("#sequence-viewer-library-list [data-sequence-entry-id=demo-vector]").dispatchEvent(new MouseEvent("dblclick", {bubbles:true}));');
    await waitFor('document.body.dataset.activeView === "sequence-viewer-detail-view" && document.querySelector("#sequence-viewer-sequence-host .sequence-viewer-seq-base")');
  };
  await click('#sequence-viewer-library-list [data-sequence-entry-id="demo-vector"]');
  await waitFor('document.querySelector("#sequence-viewer-preview-host svg")');
  await shot('01-dna-library', 'Open DNA and choose a sequence', 'Click to preview a record; double-click it to open the base-level viewer.', null,
    [['#sequence-viewer-library-list', 'Stored sequences'], ['#sequence-viewer-preview-host', 'Map preview'], ['.sequence-viewer-library-switch', 'Saved or Unsaved']]);
  await click('#sequence-viewer-home-paste-btn');
  const practice = '>Practice DNA\nATGGCTGGTGAACTGAAACAGGCTGGTGAACTGAAACAGGCTGGTGAACTGAAACAGTAA';
  await input('#sequence-viewer-new-textarea', practice);
  await shot('02-new-sequence', 'Load a new sequence', 'Paste sequence text and choose Linear or Circular, then Load Sequence.', '.sequence-viewer-new-dialog',
    [['#sequence-viewer-new-textarea', 'Paste sequence text'], ['.sequence-viewer-new-topology', 'Choose the topology'], ['#sequence-viewer-new-form button[type=submit]', 'Load Sequence']]);
  await evaluate('document.getElementById("sequence-viewer-new-form").requestSubmit();');
  await waitFor('document.body.dataset.activeView === "sequence-viewer-detail-view"');
  await shot('03-save-sequence', 'Save a loaded sequence to the library', 'Use Save in the DNA toolbar; find the record under Saved afterwards.', ['.sequence-viewer-detail-toolbar', '#sequence-viewer-vector-builder-btn'],
    [['#sequence-viewer-save-btn', 'Save to library'], ['#sequence-viewer-annotate-btn', 'Annotate from stored features'], ['#sequence-viewer-vector-builder-btn', 'Open Vector Builder']]);
  await click('#sequence-viewer-save-btn');
  await waitFor('tutorial.calls.some(c=>c.kind === "save" && c.status === "saved")');
  manifest.checks.push('New sequence loads and Save promotes it to the Saved library');
  await click('#sequence-viewer-detail-new-btn');
  await check('document.getElementById("sequence-viewer-new-form").getBoundingClientRect().height > 0', 'New Sequence dialog is visible from the detail viewer as well as the home library');
  await click('#sequence-viewer-new-cancel-btn');
  await openVector();
  await shot('04-sequence-viewer', 'Read bases and feature tracks', 'Use the DNA toolbar and scroll through the top and complementary strands.', null,
    [['.sequence-viewer-detail-toolbar', 'Viewing tools'], ['#sequence-viewer-sequence-host .sequence-viewer-dual-line:first-child', 'Bases and feature tracks']]);
  await evaluate('tutorial.select(6,16); tutorial.cursor(8);');
  await waitFor('!document.getElementById("sequence-viewer-feature-context-menu").hidden');
  await shot('05-selection-menu', 'Add an annotation to a selected range', 'Drag across bases, then right-click the selection to open its actions.', '#sequence-viewer-feature-context-menu',
    [['[data-sequence-feature-action=add]', 'Add Feature'], ['[data-sequence-feature-action=design-primer]', 'Design Primer']]);
  await click('[data-sequence-feature-action=add]');
  await input('#sequence-viewer-feature-editor-name', 'Practice note');
  await input('#sequence-viewer-feature-editor-type', 'misc_feature');
  await input('#sequence-viewer-feature-editor-description', 'Example annotation added in the tutorial.');
  await shot('06-feature-editor', 'Save feature details', 'Check the name, type, strand, and base range before saving.', '.sequence-viewer-feature-editor',
    [['#sequence-viewer-feature-editor-name', 'Name the feature'], ['.sequence-viewer-feature-editor-grid', 'Check type and coordinates'], ['#sequence-viewer-feature-editor-save', 'Save Feature']]);
  await evaluate('document.getElementById("sequence-viewer-feature-editor-form").requestSubmit();');
  await waitFor('tutorial.entries.get("demo-vector").gbkText.includes("Practice note")');
  manifest.checks.push('Adding a feature updates the active saved record');
  await evaluate('document.getElementById("sequence-viewer-sequence-host").dispatchEvent(new MouseEvent("mousedown", {button:0, bubbles:true,clientX:0,clientY:0})); document.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));');
  await openVector();
  await evaluate('tutorial.cursor(5);');
  await click('[data-sequence-cursor-action=insert]');
  await input('#sequence-viewer-sequence-edit-textarea', 'GCT');
  await shot('07-edit-bases', 'Insert bases at the cursor', 'Right-click a base boundary, choose Insert Sequence, and apply the DNA you entered.', '.sequence-viewer-sequence-edit-dialog',
    [['#sequence-viewer-sequence-edit-title', 'Check the edit action'], ['#sequence-viewer-sequence-edit-textarea', 'Enter DNA bases'], ['#sequence-viewer-sequence-edit-confirm', 'Apply the edit']]);
  const before = await evaluate('return tutorial.readSequence().length;');
  await evaluate('document.getElementById("sequence-viewer-sequence-edit-form").requestSubmit();');
  await check(`tutorial.readSequence().length === ${before + 3}`, 'Applying an insertion adds the expected three bases');
  await click('#sequence-viewer-orf-menu-btn');
  await shot('08-orf-options', 'Choose ORF display options', 'Show ORFs and select the stop codons and reading frames to display.', '#sequence-viewer-orf-menu',
    [['#sequence-viewer-orf-menu', 'Choose display, stops, and frames']]);
  await click('#sequence-viewer-orf-menu-btn');
  await click('#sequence-viewer-cutter-menu-btn');
  await shot('09-restriction-cutters', 'Show restriction cutters', 'Use the vendor toggles to control the displayed unique cutter sites.', '#sequence-viewer-cutter-menu',
    [['#sequence-viewer-restriction-neb-toggle', 'NEB sites'], ['#sequence-viewer-restriction-thermo-toggle', 'Thermo sites']]);
  await click('#sequence-viewer-cutter-menu-btn');
  await click('#sequence-viewer-alignment-menu-btn');
  await click('#sequence-viewer-alignment-open-btn');
  const query = await evaluate('return tutorial.readSequence().slice(100,360);');
  await input('#sequence-viewer-alignment-query-textarea', '>Practice read\n' + query.slice(0,100) + (query[100] === 'A' ? 'C' : 'A') + query.slice(101));
  await shot('10-alignment-query', 'Align a query to the open reference', 'Paste the query or choose a sequence file, then Run Alignment.', '.sequence-viewer-alignment-dialog',
    [['#sequence-viewer-alignment-query-mode-file', 'Or choose a query file'], ['#sequence-viewer-alignment-query-textarea', 'Paste a query sequence'], ['#sequence-viewer-alignment-run-btn', 'Run Alignment']]);
  await click('#sequence-viewer-alignment-run-btn');
  await waitFor('document.getElementById("sequence-viewer-alignment-workspace").hidden');
  const alignedRow = await markRect('aligned-row', 'document.querySelector("#sequence-viewer-sequence-host .sequence-viewer-alignment-query-row").closest(".sequence-viewer-dual-line")');
  await evaluate(`document.querySelector(${JSON.stringify(alignedRow)}).scrollIntoView({block:'center',behavior:'instant'});`);
  await shot('11-alignment-result', 'Inspect the aligned sequence', 'Compare the reference and the query row at the same coordinates.', alignedRow,
    [[`${alignedRow} .sequence-viewer-strand-row-top`, 'Reference strand'], [`${alignedRow} .sequence-viewer-alignment-query-row`, 'Aligned query']]);
  await click('#sequence-viewer-cloning-design-btn');
  await waitFor('!document.getElementById("sequence-viewer-cloning-design-workspace").hidden');
  await click('[data-cloning-design-strategy]');
  await click('#sequence-viewer-cloning-design-run-btn');
  await shot('16-cloning-design', 'Choose a cloning route and design primers', 'Read the plan and any review messages before confirming a design.', null,
    [['#sequence-viewer-cloning-design-strategy-list', 'Choose a route'], ['#sequence-viewer-cloning-design-run-btn', 'Design Primers'], ['#sequence-viewer-cloning-design-confirm-btn', 'Confirm the reviewed design']]);
  await click('#sequence-viewer-cloning-design-back-btn');
  await click('#sequence-viewer-vector-builder-btn');
  await waitFor('document.querySelector("#sequence-viewer-vector-builder-map svg")');
  await shot('12-vector-builder', 'Work with the map and bases together', 'Select an annotation on the map to locate the same range in Bases.', null,
    [['#sequence-viewer-vector-builder-map', 'Select a map feature'], ['#sequence-viewer-vector-builder-sequence', 'Inspect its bases'], ['#sequence-viewer-vector-builder-protein-builder-btn', 'Open Protein Builder']]);
  await evaluate('const el=[...document.querySelectorAll("#sequence-viewer-vector-builder-map [data-feature-index]")].find(e=>e.dataset.featureIndex==="1"); el.dispatchEvent(new MouseEvent("click",{bubbles:true})); const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));');
  await shot('13-map-actions', 'Open actions for a map selection', 'Right-click a feature or selected range to insert, replace, or delete content.', '#sequence-viewer-vector-builder-context-menu',
    [['[data-vector-action=replace-feature]', 'Replace from stored features'], ['[data-vector-action=delete-bases]', 'Delete selected bases'], ['[data-vector-action=protein-replace]', 'Build a replacement protein']]);
  await key('body', 'Escape');
  await click('#sequence-viewer-vector-builder-protein-builder-btn');
  await click('#sequence-viewer-protein-builder-add-protein-btn');
  await input('#sequence-viewer-protein-builder-add-protein-name', 'Practice protein');
  await input('#sequence-viewer-protein-builder-add-protein-sequence', 'MAGELKQAGELKQAGELKQAGELKQ');
  await shot('14-add-protein', 'Add a protein block', 'Enter amino acids or a DNA coding sequence, then add it to the chain.', '.sequence-viewer-protein-builder-add-protein-dialog',
    [['#sequence-viewer-protein-builder-add-protein-name', 'Name the block'], ['#sequence-viewer-protein-builder-add-protein-type', 'Choose sequence type'], ['#sequence-viewer-protein-builder-add-protein-confirm-btn', 'Add to Chain']]);
  await evaluate('document.getElementById("sequence-viewer-protein-builder-add-protein-form").requestSubmit();');
  await evaluate('document.querySelector("#sequence-viewer-protein-builder-common-blocks details").open=true;');
  await click('[data-protein-builder-add-library-id=his6]');
  await click('#sequence-viewer-protein-builder-build-dna-btn');
  await shot('15-protein-builder', 'Arrange a protein construct', 'Order blocks from N to C, review the protein sequence, and choose codon settings for DNA.', null,
    [['#sequence-viewer-protein-builder-workflow', 'Arrange the assembly chain'], ['#sequence-viewer-protein-builder-protein-sequence-highlight', 'Review amino acids'], ['#sequence-viewer-protein-builder-codon-usage', 'Choose codon usage']]);
  await check('document.getElementById("sequence-viewer-protein-builder-meta").textContent.includes("aa")', 'A manual protein and a common tag form an assembled chain');
  await click('#sequence-viewer-protein-builder-back-btn');
  await openVector();
  for (const index of [3, 4]) {
    await evaluate(`const el=document.querySelector('#sequence-viewer-sequence-host [data-feature-index="${index}"]');el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:r.x+5,clientY:r.y+5}));`);
    await click('[data-sequence-hover-tooltip="feature"] [data-sequence-primer-library-save]');
  }
  await check('tutorial.state.primerLibrary.length === 2', 'Saving two annotated primers from their hover cards populates Primer Library');
  await click('#sequence-viewer-detail-primer-library-open');
  await click('#sequence-viewer-primer-library-select-all');
  await shot('17-primer-library', 'Select primers in Primer Library', 'Search, rename, and select primers before exporting their order block.', '.sequence-viewer-primer-library-dialog',
    [['#sequence-viewer-primer-library-search', 'Search primers'], ['#sequence-viewer-primer-library-body', 'Check names and sequences'], ['#sequence-viewer-primer-library-export', 'Export Selected to IDT']]);
  await click('#sequence-viewer-primer-library-export');
  await shot('18-primer-order', 'Copy an order block', 'Choose scale and purification, then copy the block for your ordering workflow.', '.sequence-viewer-primer-order-dialog',
    [['.sequence-viewer-primer-order-controls', 'Choose order options'], ['#sequence-viewer-primer-order-preview', 'Review the order block'], ['#sequence-viewer-primer-order-copy-idt', 'Copy IDT Block']]);
  await click('#sequence-viewer-primer-order-copy-idt');
  await check('tutorialCopied.includes("Teaching F") && tutorialCopied.includes("Teaching R")', 'Copy IDT Block copies the selected primer names and sequences');
  await click('#sequence-viewer-primer-order-close');
  await click('#sequence-viewer-primer-library-close');
  await evaluate('tutorial.home();');
  await click('#sequence-viewer-library-filter-saved');
  await waitFor('document.querySelector("#sequence-viewer-library-list [data-sequence-entry-id=demo-vector]")');
  await contextMenu('#sequence-viewer-library-list [data-sequence-entry-id=demo-vector]');
  await shot('19-library-actions', 'Organize the sequence library', 'Right-click an entry to rename it, create a folder, or choose Move to Folder.', '#sequence-viewer-library-context-menu',
    [['#sequence-viewer-library-context-menu [data-sequence-library-action=new-folder]', 'New Folder'], ['#sequence-viewer-library-context-menu [data-sequence-library-action=rename]', 'Rename'], ['#sequence-viewer-library-context-menu [data-sequence-library-action=move-entry]', 'Move to Folder']]);
  await click('#sequence-viewer-library-context-menu [data-sequence-library-action=rename]');
  await shot('20-rename-sequence', 'Rename a sequence', 'Type the new name in the library row and press Enter to keep it.', '.folder-tree-template__rename-input',
    [['#sequence-viewer-library-list input', 'Edit the name, then Enter']]);
  await input('#sequence-viewer-library-list input', 'Teaching vector · renamed');
  await key('#sequence-viewer-library-list input', 'Enter');
  await waitFor('tutorial.entries.get("demo-vector").entry.name.includes("renamed")');
  manifest.checks.push('Inline Rename updates the selected library record');
  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
