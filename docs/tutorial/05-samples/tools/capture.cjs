// Run from the repository root: node docs/tutorial/05-samples/tools/capture.cjs
// Captures real Samples controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-samples-tutorial-'));
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
  mode: 'Real Samples renderer and top-bar search; fictional data; in-memory desktop adapters; CSV export saved to a temporary folder only.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="sample-registry-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/sample-registry-view.html'), 'utf8');
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const fixture = path.join(scratch, 'samples.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}<script type="module" src="${pathToFileURL(path.join(__dirname, 'samples-fixture.mjs')).href}"></script></body>`);
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  annotationWin = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true } });
  // The fixture must not fetch any remote resource.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  // Export CSV is a browser download; keep it in the scratch folder.
  const exported = path.join(scratch, 'export.csv');
  win.webContents.session.on('will-download', (_event, item) => item.setSavePath(exported));
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Samples renderer · 24 October 2026</text></svg>`;
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
  const locationBtn = name => `[data-inventory-section="${name}"]`;
  const containerBtn = id => `#inventory-location-nav [data-container-open="${id}"]`;
  const well = index => `#inventory-sections [data-well-index="${index}"]`;
  const sampleOf = id => `tutorial.state.samples.find(s => s.id === ${JSON.stringify(id)})`;
  const sampleCode = code => `tutorial.state.samples.find(s => s.code === ${JSON.stringify(code)})`;
  await win.loadFile(fixture);
  await waitFor('window.tutorialReady && document.querySelector(".well-grid")');

  // 1. Overview: the first location with containers opens its first container.
  await check(`document.querySelector('${locationBtn('-20 Degree')}').classList.contains('active') && document.querySelector('.container-detail-title h4').textContent.includes('Plasmid box A')`, 'Samples opens the first location that has containers, and its first container');
  await click(well(0));
  await waitFor('document.querySelector("[data-well-sample-code]")?.value === "PL-001"');
  await check('[...document.querySelectorAll("#inventory-summary-card .inventory-summary-row")].find(r => r.textContent.includes("Total Samples")).querySelector("strong").textContent === String(tutorial.state.samples.length)', 'Inventory Summary counts every sample');
  await shot('01-samples-workspace', 'Open Samples', 'Locations and containers are on the left. The open container is in the middle, and the selected sample on the right.', null,
    [['#inventory-location-nav', 'Locations and containers'], ['.well-grid-panel', 'Wells'], ['.well-side-editor', 'Sample details'], ['#inventory-summary-card', 'Inventory Summary']]);

  // 2. Add a container
  await click(`[data-location-add-container="4 Degree"]`);
  await waitFor('!document.getElementById("inventory-add-container-overlay").hidden');
  await check('document.getElementById("inventory-add-container-location").value === "4 Degree" && document.getElementById("inventory-add-container-location").disabled', 'The + beside a location adds the container to that location');
  await input('#inventory-add-container-name', 'Fridge box A');
  await input('#inventory-add-container-type', 'box49');
  await shot('02-add-container', 'Add a container', 'Click + beside a location, name the container, and choose its type.', ['#inventory-add-container-form', `.inventory-location-row:has([data-location-add-container="4 Degree"])`],
    [[`[data-location-add-container="4 Degree"]`, 'Add container (+)', 'right'], ['#inventory-add-container-name', 'Container Name', 'right'], ['#inventory-add-container-type', 'Type', 'right'], ['#inventory-add-container-submit', 'Save Container']], { side: true });
  await click('#inventory-add-container-submit');
  await waitFor(`tutorial.state.inventory['4 Degree'].some(c => c.name === 'Fridge box A' && c.wells.length === 49)`);
  await check(`document.querySelector('.container-detail-title h4').textContent.includes('4 Degree / Fridge box A')`, 'Save Container adds the container and opens it');

  // 3. Folders
  await click(locationBtn('-20 Degree'));
  await waitFor(`document.querySelector('${locationBtn('-20 Degree')}').classList.contains('active')`);
  await contextMenu('[data-inventory-folder-context="demo-folder-plasmids"]');
  await waitFor('!document.getElementById("inventory-container-context-menu").hidden');
  await check('document.querySelector("[data-folder-context-add-container]") && document.querySelector("[data-folder-context-add-folder]") && document.querySelector("[data-folder-context-rename]") && document.querySelector("[data-folder-context-delete]")', 'Right-clicking a folder offers Add Container Here, New Folder Inside, Rename, and Delete');
  await shot('03-folder-menu', 'Organize containers in folders', 'Right-click a folder, a container, or a location to add, rename, or delete.', ['#inventory-location-nav .inventory-location-group:has(.inventory-location-btn.active)', '#inventory-container-context-menu', locationBtn('-80 Degree')],
    [['[data-inventory-folder-node="demo-folder-plasmids"] > .inventory-folder-item', 'Right-click a folder'], ['#inventory-container-context-menu', 'Folder menu', 'right']], { side: true });
  await click('[data-folder-context-add-folder]');
  await waitFor('!document.getElementById("inventory-add-container-overlay").hidden && document.getElementById("inventory-add-container-title").textContent === "New Folder Inside"');
  await input('#inventory-add-container-name', 'Primers');
  await click('#inventory-add-container-submit');
  await waitFor(`tutorial.state.inventoryFolders['-20 Degree'].some(f => f.name === 'Primers' && f.parentFolderId === 'demo-folder-plasmids')`);
  manifest.checks.push('New Folder Inside creates a folder within the folder');
  await evaluate(`document.querySelector('${containerBtn('demo-primer-box')}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));`);
  await waitFor('document.querySelector(".folder-tree-template__rename-input")');
  await input('.folder-tree-template__rename-input', 'Primer box 1');
  await key('.folder-tree-template__rename-input', 'Enter');
  await waitFor(`tutorial.state.inventory['-20 Degree'].some(c => c.id === 'demo-primer-box' && c.name === 'Primer box 1')`);
  manifest.checks.push('Double-clicking a container renames it');
  await contextMenu(containerBtn('demo-primer-box'));
  await check('document.querySelector("[data-container-context-rename]") && document.querySelector("[data-container-context-delete]")', 'Right-clicking a container offers Rename Container and Delete Container');
  await key('body', 'Escape');
  await click(locationBtn('4 Degree'));
  await contextMenu(containerBtn((await evaluate(`return tutorial.state.inventory['4 Degree'][0].id;`))));
  await click('[data-container-context-delete]');
  await waitFor(`tutorial.state.inventory['4 Degree'].length === 0`);
  manifest.checks.push('Delete Container removes the container');

  // 4. Add a sample
  await click(locationBtn('-20 Degree'));
  await click(containerBtn('demo-plasmid-box'));
  await waitFor(`document.querySelector('.container-detail-title h4').textContent.includes('Plasmid box A')`);
  await click(well(6));
  await waitFor('document.querySelector("[data-well-sample-create]")');
  await input('[data-well-sample-new-code]', 'PL-004');
  await input('[data-sample-type-fields] [data-sample-detail="backbone"]', 'pDemo vector');
  await input('[data-sample-type-fields] [data-sample-detail="resistance"]', 'Kan');
  await input('[data-well-sample-new-concentration]', '110 ng/µL');
  await evaluate(`const el = document.querySelector('[data-well-sample-new-name]'); el.focus(); el.value = 'pDemo-GFP'; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  await waitFor('document.querySelector(".sample-plasmid-suggestions:not([hidden]) [data-plasmid-option]")');
  await check(`[...document.querySelectorAll('.sample-plasmid-suggestions [data-plasmid-option]')].map(o => o.textContent).join() === 'pDemo-GFP,pDemo-GFP-v2'`, 'Typing a plasmid name suggests matching names from the DNA library');
  await shot('04-add-sample', 'Add a sample to a well', 'After you click an empty well, fill in the sample on the right and click Add Sample.', '.well-side-editor',
    [['.well-editor-title-group', 'The well you clicked'], [['[data-well-sample-new-name]', '.sample-plasmid-suggestions'], 'Sample Name', 'right'],
      ['[data-sample-type-fields]', 'Fields for this type', 'right'], ['[data-well-sample-create]', 'Add Sample', 'right']], { side: true });
  await evaluate(`document.querySelectorAll('.sample-plasmid-suggestions [data-plasmid-option]')[1].click();`);
  await check('document.querySelector("[data-well-sample-new-name]").value === "pDemo-GFP-v2"', 'Clicking a suggestion fills in the name');
  await click('[data-well-sample-create]');
  await waitFor(`${sampleCode('PL-004')}`);
  await check(`${sampleCode('PL-004')}.name === 'pDemo-GFP-v2' && ${sampleCode('PL-004')}.inventoryLink.wellIndex === 6 && ${sampleCode('PL-004')}.details.backbone === 'pDemo vector' && document.querySelector(${JSON.stringify(well(6))}).querySelector('.well-sample-dot.has-sample')`, 'Add Sample stores the sample in the well with its type fields');
  await click(well(7));
  await input('[data-well-sample-new-name]', 'Demo aliquot');
  await click('[data-well-sample-create]');
  await waitFor(`tutorial.state.samples.some(s => s.name === 'Demo aliquot')`);
  await check(`/^S-\\d{6}$/.test(tutorial.state.samples.find(s => s.name === 'Demo aliquot').code)`, 'A blank Sample Code gets a generated code');

  // 5. Edit or delete a sample
  await click('[data-well-sample-delete]');
  await waitFor(`!tutorial.state.samples.some(s => s.name === 'Demo aliquot') && document.querySelector('.well-editor-status').textContent.startsWith('Deleted sample')`);
  manifest.checks.push('Delete Sample removes the sample from its well');
  await click(well(0));
  await input('[data-well-sample-code]', 'PL-002');
  await click('[data-well-sample-save]');
  await check(`document.querySelector('.well-editor-status').textContent === 'Sample code PL-002 already exists.' && ${sampleOf('demo-pl-1')}.code === 'PL-001'`, 'Save refuses a code another sample already uses');
  await input('[data-well-sample-concentration]', '100 ng/µL');
  await click('[data-well-sample-save]');
  await check(`${sampleOf('demo-pl-1')}.concentration === '100 ng/µL' && document.querySelector('.well-editor-status').textContent === 'Saved sample PL-001.'`, 'Save Sample stores the change');
  await shot('05-edit-sample', 'Edit or delete a sample', 'After you click a filled well, change the details and click Save Sample.', '.well-side-editor',
    [['.well-editor-title-group', 'The well you clicked'], ['[data-well-sample-concentration]', 'Change a value', 'right'], ['[data-well-sample-save]', 'Save Sample'],
      ['[data-well-sample-delete]', 'Delete Sample', 'right'], ['.well-editor-status', 'Result', 'right']], { side: true });

  // 6. Fill wells with copies
  await click('[data-well-sample-clone]');
  await check(`document.querySelector('[data-well-sample-clone]').getAttribute('aria-pressed') === 'true' && document.querySelector('.well-editor-status').textContent === 'Drag across wells to fill with PL-001.'`, 'Fill wells turns on fill mode for the selected sample');
  await evaluate(`document.querySelector(${JSON.stringify(well(10))}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    for (const index of [11, 12]) document.querySelector('#inventory-sections [data-well-index="' + index + '"]').dispatchEvent(new MouseEvent('mouseenter'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));`);
  await waitFor(`tutorial.state.samples.filter(s => s.name === 'pDemo-GFP').length === 4`);
  await check(`document.querySelector('.well-editor-status').textContent === 'Cloned PL-001 into 3 wells.' && tutorial.state.samples.filter(s => s.name === 'pDemo-GFP').map(s => s.inventoryLink.wellIndex + ':' + s.code).sort().join() === '0:PL-001,10:PL-001-2,11:PL-001-3,12:PL-001-4'`, 'Dragging across wells fills each one with a copy that has its own code');
  await shot('06-fill-wells', 'Fill more wells with a sample', 'Select a sample, click Fill wells, then drag across empty wells.', '.container-inline-detail',
    [[well(0), 'Selected sample'], ['[data-well-sample-clone]', 'Fill wells', 'right'], [[well(10), well(11), well(12)], 'Drag across wells'], ['.well-editor-status', 'Result']]);
  await click(well(10));
  await input('[data-well-sample-lot]', 'Prep 1, aliquot 2');
  await click('[data-well-sample-save]');
  await check(`document.querySelector('.well-editor-status').textContent === 'Saved sample PL-001-2.' && ${sampleCode('PL-001-2')}.lot === 'Prep 1, aliquot 2'`, 'A filled copy can be edited and saved');

  // 7. Single container
  await click(containerBtn('demo-antibody-tube'));
  await waitFor('document.querySelector(".falcon-preview")');
  await check(`document.querySelector('[data-single-sample-code]').value === 'AB-001' && document.querySelector('[data-sample-detail="target"]').value === 'GFP'`, 'A single container opens its sample with the antibody fields');
  await shot('07-single-container', 'Store a sample in a tube or bottle', 'A single container holds one sample. Its details are on the right.', [containerBtn('demo-antibody-tube'), '.container-inline-detail', '#inventory-summary-card'],
    [[containerBtn('demo-antibody-tube'), 'Single container'], ['.falcon-preview', 'Filled tube'], ['.well-side-editor', 'Sample details']]);

  // 8. CSV import and export
  await click(containerBtn('demo-plasmid-box'));
  await click(well(0));
  await evaluate(`const csv = 'well,code,name,type,concentration,notes\\r\\nW4,PL-005,pDemo-GFP-v3,plasmid,100 ng/µL,Imported example row.\\r\\nW5,PL-006,pDemo-mCherry-v2,plasmid,90 ng/µL,Imported example row.\\r\\nW2,PL-002,pDemo-mCherry,plasmid,80 ng/µL,Updated concentration.\\r\\n';
    const t = new DataTransfer(); t.items.add(new File([csv], 'plasmid-box-a.csv', { type: 'text/csv' }));
    const el = document.querySelector('[data-container-import-input="demo-plasmid-box"]'); el.files = t.files; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`document.querySelector('.well-editor-status')?.textContent.startsWith('Imported')`);
  await check(`document.querySelector('.well-editor-status').textContent === 'Imported 3 samples (2 new, 1 updated).' && ${sampleCode('PL-005')}.inventoryLink.wellIndex === 3 && ${sampleOf('demo-pl-2')}.concentration === '80 ng/µL'`, 'Import CSV adds new codes and updates existing ones');
  await shot('08-csv', 'Import or export a container', 'Each container imports and exports its own CSV file, one row per well.', '.container-inline-detail',
    [['[data-container-import-csv]', 'Import CSV'], ['[data-container-export-csv]', 'Export CSV', 'right'], [[well(3), well(4)], 'Imported samples'], ['.well-editor-status', 'Import result']]);
  await click('[data-container-export-csv]');
  for (let i = 0; i < 100 && !(fs.existsSync(exported) && fs.statSync(exported).size); i++) await pause(30);
  const csv = fs.existsSync(exported) ? fs.readFileSync(exported, 'utf8') : '';
  if (!csv.replace(/^﻿/, '').startsWith('well,code,name,type,lot,concentration,notes') || !csv.includes('W1,PL-001,pDemo-GFP,plasmid') || csv.split('\r\n').length !== 26) throw new Error(`Export CSV: unexpected file\n${csv.slice(0, 300)}`);
  manifest.checks.push('Export CSV writes one row per well, filled or empty');

  // 9. Find a sample from the top bar
  await click('#topbar-search-toggle');
  await waitFor('document.querySelector(".topbar-search-shell").classList.contains("is-expanded")');
  await evaluate(`const el = document.getElementById('topbar-search'); el.value = 'Model protein'; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  await waitFor('document.querySelector("#topbar-search-suggestions:not([hidden]) .topbar-search-suggestion")');
  const result = await markRect('search-result', `[...document.querySelectorAll('#topbar-search-suggestions .topbar-search-suggestion')].find(li => li.textContent.includes('Model protein A') && li.textContent.includes('Sample'))`);
  await shot('09-search', 'Find a sample', 'Search the top bar by name, code, type, lot, concentration, or notes.', ['.topbar-search-shell', '#topbar-search-suggestions'],
    [['.topbar-search-field', 'Type in Search'], [result, 'Click the sample']], { side: true });
  await evaluate(`document.querySelector('${result}').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));`);
  await waitFor(`document.querySelector('[data-well-sample-code]')?.value === 'PRT-001'`);
  await check(`document.querySelector('${locationBtn('-80 Degree')}').classList.contains('active') && document.querySelector('.container-detail-title h4').textContent.includes('Protein box 1') && document.querySelector(${JSON.stringify(well(0))}).classList.contains('well-selected')`, 'Opening a sample result shows its container with the well selected');

  // Locations
  await contextMenu(locationBtn('-80 Degree'));
  await check('document.querySelector("[data-location-context-delete]").disabled', 'A location that holds containers cannot be deleted');
  await key('body', 'Escape');
  await contextMenu(locationBtn('Room Temp'));
  await click('[data-location-context-rename]');
  await waitFor('document.querySelector(".folder-tree-template__rename-input")');
  await input('.folder-tree-template__rename-input', 'Bench shelf');
  await key('.folder-tree-template__rename-input', 'Enter');
  await waitFor(`tutorial.state.settings.sampleInventoryLocations[0] === 'Bench shelf'`);
  manifest.checks.push('Renaming a location from its menu renames it everywhere');
  await contextMenu(locationBtn('Bench shelf'));
  await click('[data-location-context-delete]');
  await waitFor(`!tutorial.state.settings.sampleInventoryLocations.includes('Bench shelf')`);
  manifest.checks.push('An empty location can be deleted');

  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
