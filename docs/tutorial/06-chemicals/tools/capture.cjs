// Run from the repository root: node docs/tutorial/06-chemicals/tools/capture.cjs
// Captures real Chemicals controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-chemicals-tutorial-'));
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
  mode: 'Real Chemicals renderer; fictional data; in-memory desktop adapters; spreadsheet import read in the renderer; no SQLite or other file writes.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="lab-common-inventory-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/lab-common-inventory-view.html'), 'utf8');
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const fixture = path.join(scratch, 'chemicals.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}<script type="module" src="${pathToFileURL(path.join(__dirname, 'chemicals-fixture.mjs')).href}"></script></body>`);
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Chemicals renderer · 24 October 2026</text></svg>`;
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
  await waitFor('window.tutorialReady && document.querySelector("[data-chemical-open]")');

  // 1. Overview
  await check(`tutorial.state.labInventory.chemicals.every(c => /^[A-Z]+\\d{6}$/.test(c.locationCode))`, 'Every chemical gets a code when Chemicals opens');
  await click('[data-chemical-open="demo-imidazole"]');
  await waitFor('document.getElementById("chemical-detail-title").textContent === "Imidazole"');
  await shot('01-chemicals-workspace', 'Open Chemicals', 'Add, import, and search on the left. The chemical list is in the middle, and the selected chemical on the right.', null,
    [['.chemical-sidebar-stack', 'Add, import, search, and filter'], ['#chemical-list', 'Chemicals'], ['#chemical-detail-panel', 'Selected chemical']]);

  // 2. Add a chemical
  await click('#chemical-open-add-btn');
  await waitFor('!document.getElementById("chemical-dialog-overlay").hidden && document.getElementById("chemical-dialog-title").textContent === "Add Chemical"');
  await input('#chemical-name', 'Sodium phosphate, monobasic');
  await input('#chemical-location', 'Main Storage');
  await input('#chemical-vendor', 'Example Supplier');
  await input('#chemical-catalog-number', 'EX-1005');
  await input('#chemical-unit-size', '500 g');
  await input('#chemical-price', '$41');
  await input('#chemical-stock', '1 bottle');
  await input('#chemical-expiration', '2028-05-31');
  await click('#chemical-form button[type="submit"]');
  await check(`tutorial.state.labInventory.chemicals.length === 8 && !document.getElementById('chemical-dialog-overlay').hidden`, 'Save Chemical waits until the required CAS Number is filled in');
  await input('#chemical-cas', '7558-80-7');
  await shot('02-add-chemical', 'Add a chemical', 'Click + at the top of the left panel, fill in the chemical, and click Save Chemical.', ['#chemical-dialog-overlay .chemical-dialog', '.chemical-quick-actions'],
    [['#chemical-open-add-btn', 'Add chemical (+)', 'right'], ['#chemical-name', 'Name', 'right'], ['#chemical-cas', 'CAS Number', 'right'], ['#chemical-location', 'Location', 'right'],
      ['#chemical-form button[type="submit"]', 'Save Chemical']], { side: true });
  await click('#chemical-form button[type="submit"]');
  await waitFor(`tutorial.state.labInventory.chemicals.length === 9 && document.getElementById('chemical-dialog-overlay').hidden`);
  const added = `tutorial.state.labInventory.chemicals.find(c => c.casNumber === '7558-80-7')`;
  await check(`/^A\\d{6}$/.test(${added}.locationCode) && document.getElementById('chemical-detail-title').textContent === 'Sodium phosphate, monobasic' && tutorial.calls.some(c => c.kind === 'sync' && c.count === 9)`, 'Save Chemical adds it with a code for its location, selects it, and saves the inventory');

  // 3. Details
  const detailItem = label => markRect(`detail-${label}`, `[...document.querySelectorAll('#chemical-detail-content .chemical-detail-item')].find(d => d.querySelector('.chemical-detail-label').textContent === ${JSON.stringify(label)})`);
  await shot('03-chemical-details', 'Check a chemical', 'Click a chemical in the list to see its details. Its code tells you where it is stored.', '#chemical-detail-panel',
    [[await detailItem('Code'), 'Code'], [await detailItem('Location'), 'Location and code'], [await detailItem('Expiration'), 'Expiration'],
      [['#chemical-detail-edit-btn', '#chemical-detail-delete-btn'], 'Edit or delete', 'right']], { side: true });

  // 4. Edit and delete
  const codeBefore = await evaluate(`return ${added}.locationCode;`);
  await click('#chemical-detail-edit-btn');
  await waitFor('!document.getElementById("chemical-dialog-overlay").hidden && document.getElementById("chemical-dialog-title").textContent === "Edit Chemical"');
  await check(`document.getElementById('chemical-name').value === 'Sodium phosphate, monobasic' && document.getElementById('chemical-location').value === 'Main Storage'`, 'Edit opens the chemical in the form');
  await input('#chemical-stock', '2 bottles');
  await shot('04-edit-chemical', 'Edit a chemical', 'Change any field and click Save Chemical.', '#chemical-dialog-overlay .chemical-dialog',
    [['#chemical-dialog-title', 'Edit Chemical'], ['#chemical-stock', 'Change a value', 'right'], ['#chemical-form button[type="submit"]', 'Save Chemical']], { side: true });
  await click('#chemical-form button[type="submit"]');
  await waitFor(`${added}.amountInStock === '2 bottles'`);
  await check(`tutorial.state.labInventory.chemicals.length === 9 && ${added}.locationCode === ${JSON.stringify(codeBefore)}`, 'Saving an edit keeps the chemical and its code');
  await click('[data-chemical-open="demo-glycerol"]');
  await click('#chemical-detail-delete-btn');
  await waitFor(`!tutorial.state.labInventory.chemicals.some(c => c.id === 'demo-glycerol')`);
  await check(`tutorial.state.labInventory.chemicals.length === 8 && !document.querySelector('[data-chemical-open="demo-glycerol"]')`, 'Delete removes the chemical at once');

  // 5. Search, filter, sort
  await input('#chemical-search', '7647');
  await check(`[...document.querySelectorAll('[data-chemical-open]')].map(b => b.textContent.trim()).sort().join() === 'Hydrochloric acid, 37%,Sodium chloride' && document.getElementById('chemical-results-summary').textContent === 'Showing 2 of 8 chemicals.'`, 'Search matches part of a CAS number');
  await input('#chemical-search', '');
  await input('#chemical-filter-location', 'Cold Room');
  await input('#chemical-sort', 'expiration_asc');
  await check(`[...document.querySelectorAll('[data-chemical-open]')].map(b => b.textContent.trim()).join() === 'Dithiothreitol (DTT),Bovine serum albumin'`, 'Filter Location and Sort By narrow and order the list');
  await shot('05-find-chemicals', 'Search, filter, and sort', 'Type in Search, choose a location, or change the order of the list.', ['.chemical-sidebar-stack', '.chemical-list-panel'],
    [['.chemical-search-field', 'Search', 'right'], ['#chemical-filter-location', 'Filter Location', 'right'], ['#chemical-sort', 'Sort By', 'right'], ['#chemical-results-summary', 'How many are shown', 'right'], ['#chemical-list', 'Matching chemicals']]);
  await input('#chemical-filter-location', '');
  await input('#chemical-sort', 'updated_desc');

  // 6. Import a spreadsheet
  await evaluate(`const csv = 'Chemical Name,CAS No,Storage Location,Supplier,Cat #,Pack Size,Qty,Expiry\\r\\nSodium chloride,7647-14-5,Main Storage,Example Supplier,EX-1001,1 kg,3 bottles,2028-03-01\\r\\nPotassium chloride,7447-40-7,Main Storage,Example Supplier,EX-1006,500 g,1 bottle,2028-08-31\\r\\nAgarose,9012-36-6,Shelf B,Example Supplier,EX-4001,100 g,2 bottles,\\r\\n';
    const t = new DataTransfer(); t.items.add(new File([csv], 'lab-chemicals.csv', { type: 'text/csv' }));
    const el = document.getElementById('chemical-import-file'); el.files = t.files; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`document.getElementById('chemical-import-status').dataset.status === 'success'`);
  await check(`document.getElementById('chemical-import-status').textContent.startsWith('Imported 2 new and updated 1 chemicals from lab-chemicals.csv. Skipped 0.') && tutorial.state.labInventory.chemicals.length === 10`, 'Import adds new rows and updates matching chemicals');
  await check(`tutorial.state.labInventory.chemicals.find(c => c.id === 'demo-nacl').amountInStock === '3 bottles' && tutorial.state.settings.inventoryLocations.includes('Shelf B') && /^D\\d{6}$/.test(tutorial.state.labInventory.chemicals.find(c => c.name === 'Agarose').locationCode)`, 'A row with a known CAS updates that chemical, and a new location is added with its own letter');
  await shot('06-import', 'Import a spreadsheet', 'Click the upload icon and choose a CSV or Excel file. The result appears below.', ['.chemical-sidebar-stack', '.chemical-list-panel'],
    [['#chemical-import-btn', 'Import chemicals', 'right'], ['#chemical-import-status', 'Import result', 'right'], ['#chemical-list', 'Imported chemicals']]);

  // Top-bar search
  await click('[data-chemical-open="demo-tris"]');
  await click('#topbar-search-toggle');
  await waitFor('document.querySelector(".topbar-search-shell").classList.contains("is-expanded")');
  await evaluate(`const el = document.getElementById('topbar-search'); el.value = 'EX-2002'; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  await waitFor('document.querySelector("#topbar-search-suggestions:not([hidden]) .topbar-search-suggestion")');
  await evaluate(`[...document.querySelectorAll('#topbar-search-suggestions .topbar-search-suggestion')].find(li => li.textContent.includes('Bovine serum albumin') && li.textContent.includes('Chemical'))
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));`);
  await waitFor('document.getElementById("chemical-detail-title").textContent === "Bovine serum albumin"');
  manifest.checks.push('A Chemical result in the top-bar search, found by catalog number, opens that chemical');

  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
