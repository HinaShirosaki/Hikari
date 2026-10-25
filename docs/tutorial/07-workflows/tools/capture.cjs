// Run from the repository root: node docs/tutorial/07-workflows/tools/capture.cjs
// Captures real Workflows controls in a disposable Electron profile, then renders
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-workflows-tutorial-'));
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
  mode: 'Real Workflows renderer; fictional data; in-memory desktop adapters; notebook pages created in memory only; no file writes.', screenshots: [], checks: [] };
let win, annotationWin;
async function main() {
  await app.whenReady();
  const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const shell = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/start.html'), 'utf8'))
    .replace(/<div id="app-loading-cover"[\s\S]*?(?=  <main id="storage-setup-page")/, '')
    .replace(/<main id="storage-setup-page"[\s\S]*?<\/main>/, '')
    .replace(/href="([^"#]+)"/g, (_match, file) => `href="${url(file)}"`)
    .replace('<body>', '<body class="theme-day ui-neutral-compact has-shared-left-rail-view" data-active-view="workflow-management-view" data-agent-availability="connected">');
  const view = fs.readFileSync(path.join(root, 'ui/html/views/workflow-management-view.html'), 'utf8');
  const end = stripScripts(fs.readFileSync(path.join(root, 'ui/html/shell/end.html'), 'utf8')).replace('</body>', '');
  const fixture = path.join(scratch, 'workflows.html');
  fs.writeFileSync(fixture, `${shell}${view}${end}<script type="module" src="${pathToFileURL(path.join(__dirname, 'workflows-fixture.mjs')).href}"></script></body>`);
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="${color}"/></marker></defs><rect width="100%" height="100%" fill="#f8f5ee"/><text x="24" y="33" fill="#191724" font-size="25" font-weight="700">${esc(title)}</text><text x="24" y="61" fill="#6e6a86" font-size="16">${esc(subtitle)}</text><image x="${imageX}" y="${imageY}" width="${crop.width}" height="${crop.height}" href="data:image/png;base64,${capture.toPNG().toString('base64')}"/>${callouts}<text x="24" y="${height - 12}" fill="#797593" font-size="12">HIKARI TUTORIAL · Fictional example data · Real Workflows renderer · 24 October 2026</text></svg>`;
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
  await waitFor('window.tutorialReady && document.querySelector(".workflow-ledger")');

  // 1. Overview, with the selected process opened at its next step as a click on its row does.
  await evaluate(`[...document.querySelectorAll('.workflow-ledger-row')].find(r => r.textContent.includes('Protein prep · buffer B')).querySelector('td').click();`);
  await waitFor(`document.querySelector('.workflow-drawer details[open] [data-workflow-drawer-toggle]')?.textContent.includes('Purification')`);
  await shot('01-workflows-workspace', 'Open Workflows', 'Templates are on the left, the selected template\'s processes in the middle, and the open process on the right.', null,
    [['#workflow-list', 'Templates'], ['.workflow-ledger', 'Processes'], ['.workflow-drawer', 'Selected process']]);
  const run = name => `tutorial.state.workflows.find(w => w.name === ${JSON.stringify(name)})`;
  const runId = async name => evaluate(`return ${run(name)}.id;`);
  const blockOf = async (name, index) => evaluate(`return ${run(name)}.blocks[${index}].id;`);
  const stepOf = (name, index) => `${run(name)}.entries[0].stepStates[${run(name)}.blocks[${index}].id]`;

  // 2. Start a process
  await click('#workflow-add-run-btn');
  await waitFor('document.getElementById("workflow-process-dialog").open');
  await check(`document.getElementById('workflow-process-template').value === 'demo-template-protein'`, 'New process starts from the selected template');
  await input('#workflow-process-project', 'demo-stability');
  await input('#workflow-process-name', 'Protein prep · buffer C');
  await shot('02-new-process', 'Start a process', 'Click + (New process), choose the template and project, and click Create process.', '#workflow-process-form',
    [['#workflow-process-template', 'Workflow template', 'right'], ['#workflow-process-project', 'Project', 'right'], ['#workflow-process-name', 'Process name', 'right'], ['#workflow-process-form button[type="submit"]', 'Create process', 'right']], { side: true });
  await click('#workflow-process-form button[type="submit"]');
  await waitFor(`!document.getElementById('workflow-process-dialog').open && ${run('Protein prep · buffer C')}`);
  await check(`${run('Protein prep · buffer C')}.projectId === 'demo-stability' && ${run('Protein prep · buffer C')}.blocks.length === 5 && document.querySelector('.workflow-drawer-name').value === 'Protein prep · buffer C'`, 'Create process adds the process to its project and opens it');
  await click('[data-workflow-project-add="demo-stability"]');
  await waitFor('document.getElementById("workflow-process-dialog").open');
  await check(`document.getElementById('workflow-process-project').value === 'demo-stability'`, 'New process on a project heading starts in that project');
  await click('#workflow-process-cancel');

  // 6 (prepared here). Rename and delete the extra process.
  await input('.workflow-drawer-name', 'Protein prep · buffer C (renamed)');
  await check(`${run('Protein prep · buffer C (renamed)')}`, 'Typing a new name in the drawer renames the process');
  await click('#workflow-delete-run-btn');
  await waitFor(`!tutorial.state.workflows.some(w => w.name.startsWith('Protein prep · buffer C'))`);
  manifest.checks.push('Delete process removes the open process at once');

  // 3. Progress
  const rowOf = async name => `tr[data-workflow-run-open="${await runId(name)}"]`;
  const rowB = await rowOf('Protein prep · buffer B'), rowA = await rowOf('Protein prep · buffer A'), rowRepeat = await rowOf('Protein prep · repeat');
  await check(`!document.querySelector('.workflow-drawer')`, 'Deleting the open process closes its drawer');
  await shot('03-progress', 'Follow each process', 'Each row shows a process: its steps, how many are done, and what comes next.', '.workflow-ledger',
    [[`${rowB} .workflow-stepper`, 'Steps'], [`${rowB} .workflow-ledger-count`, 'Steps done', 'right'], [`${rowB} td:nth-child(3)`, 'Next step'],
      [`${rowRepeat} .workflow-ledger-chip.is-bad`, 'Failed', 'right'], [`${rowA} .workflow-ledger-chip.is-ok`, 'Finished', 'right']]);

  // 4. Record a step
  const checkId = await blockOf('Protein prep · buffer B', 2), purifyId = await blockOf('Protein prep · buffer B', 1);
  await check(`document.querySelector('${rowB} [data-workflow-step-open="${checkId}"]').disabled`, 'A step is locked until the steps before it are complete');
  await evaluate(`document.querySelector('${rowB} td').click();`);
  await waitFor(`document.querySelector('.workflow-drawer-name')?.value === 'Protein prep · buffer B'`);
  await check(`document.querySelector('[data-workflow-drawer-toggle="${purifyId}"]').closest('details').open`, 'Opening a process opens its next step');
  await input(`[data-workflow-block-id="${purifyId}"][data-workflow-step-value="p-column"]`, 'Example column');
  await input(`[data-workflow-block-id="${purifyId}"][data-workflow-step-value="p-buffer"]`, 'Buffer B');
  await input(`[data-workflow-step-result-field="${purifyId}"]`, 'Example note: the protein eluted in fractions 3 to 5.');
  await check(`${stepOf('Protein prep · buffer B', 1)}.values['p-buffer'] === 'Buffer B' && ${stepOf('Protein prep · buffer B', 1)}.result.startsWith('Example note')`, 'Field values and the result are saved as you type');
  const stepBody = `[data-workflow-drawer-toggle="${purifyId}"] + .workflow-drawer-step-body`;
  await shot('04-record-step', 'Record a step', 'Fill in the protocol fields and the result, then mark the step complete.', '.workflow-drawer',
    [[`${stepBody} .workflow-placeholder-table`, 'Protocol fields', 'right'], [`${stepBody} .workflow-drawer-field`, 'Result', 'right'],
      [`${stepBody} .workflow-drawer-actions`, 'Complete, Fail, Notebook, Attach']], { side: true });
  await evaluate(`const t = new DataTransfer(); t.items.add(new File(['example'], 'elution-fractions.csv', { type: 'text/csv' }));
    const el = document.querySelector('${stepBody} [data-workflow-step-files]'); el.files = t.files; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`${stepOf('Protein prep · buffer B', 1)}.resultFiles.includes('elution-fractions.csv') && document.querySelector('.workflow-drawer-files')?.textContent.includes('elution-fractions.csv')`);
  await check(`tutorial.calls.some(c => c.kind === 'store' && c.fileName === 'elution-fractions.csv')`, 'Attach copies the file into the process folder and lists it under the step');
  await click(`${stepBody} [data-workflow-step-status="completed"]`);
  await waitFor(`${stepOf('Protein prep · buffer B', 1)}.status === 'completed'`);
  await check(`tutorial.state.notebookEntries.some(e => e.workflowContext?.workflowBlockId === '${purifyId}' && e.notebookState === 'executed' && e.values['p-buffer'] === 'Buffer B')
    && !document.querySelector('${rowB} [data-workflow-step-open="${checkId}"]').disabled
    && document.querySelector('${rowB} .workflow-ledger-count').textContent === '2/4'
    && document.querySelector('[data-workflow-drawer-toggle="${checkId}"]').closest('details').open`, 'Complete records an executed notebook page, unlocks the next step, and opens it');
  await click(`[data-workflow-drawer-toggle="${checkId}"] + .workflow-drawer-step-body [data-workflow-step-status="failed"]`);
  await check(`${stepOf('Protein prep · buffer B', 2)}.status === 'failed' && document.querySelector('${rowB}').textContent.includes('Failed')`, 'Fail marks the step failed in the drawer and the list');
  await click(`[data-workflow-drawer-toggle="${checkId}"] + .workflow-drawer-step-body [data-workflow-step-status="pending"]`);
  await check(`${stepOf('Protein prep · buffer B', 2)}.status === 'pending'`, 'Retry clears the failure');
  await click(`[data-workflow-drawer-toggle="${checkId}"] + .workflow-drawer-step-body [data-workflow-step-open-notebook]`);
  await check(`tutorial.calls.some(c => c.kind === 'open-notebook') && tutorial.state.notebookEntries.some(e => e.workflowContext?.workflowBlockId === '${checkId}' && e.notebookState === 'planned')`, 'Notebook opens the step as a planned notebook page');

  // 5. Optional branch
  const expressId = await blockOf('Protein prep · buffer B', 0);
  await shot('05-branch', 'Add an optional branch', 'A branch is extra work some processes need. Click Activate to add it to this process.', ['.workflow-drawer-fork', `[data-workflow-drawer-toggle="${expressId}"]`, `[data-workflow-drawer-toggle="${checkId}"]`],
    [['.workflow-drawer-fork-card', 'Optional branch'], ['.workflow-drawer-fork-card [data-workflow-branch-toggle]', 'Activate', 'right']], { side: true });
  const gelId = await blockOf('Protein prep · buffer B', 4);
  await click('.workflow-drawer-fork-card [data-workflow-branch-toggle]');
  await waitFor(`document.querySelector('[data-workflow-drawer-toggle="${gelId}"]')`);
  await check(`document.querySelector('${rowB} [data-workflow-step-open="${gelId}"]') && document.querySelector('${rowB} .workflow-ledger-count').textContent === '2/5'`, 'Activate adds the branch steps to the process');
  await click(`[data-workflow-drawer-toggle="${gelId}"]`);
  await click(`[data-workflow-drawer-toggle="${gelId}"] + .workflow-drawer-step-body [data-workflow-branch-toggle]`);
  await waitFor(`!document.querySelector('[data-workflow-drawer-toggle="${gelId}"]') && document.querySelector('.workflow-drawer-fork-card')`);
  manifest.checks.push('Skip branch removes an untouched branch again');

  // 7-8. Template editor and graph
  await click('#workflow-entry-template-btn');
  await waitFor('!document.querySelector(".workflow-main-editor-panel").hidden');
  await input('#workflow-template-name', 'Plasmid check · tutorial');
  await input('#workflow-template-description', 'Fictional teaching template.');
  const addProtocol = async (term, protocolId) => {
    await input('#workflow-block-protocol-search', term);
    await click(`[data-workflow-block-protocol-id="${protocolId}"]`);
    await click('#workflow-block-add-btn');
  };
  await addProtocol('miniprep', 'demo-miniprep');
  await addProtocol('gel', 'demo-gel');
  await evaluate(`const radio = document.querySelector('input[name="workflow-block-type-option"][value="text"]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));`);
  await check(`document.getElementById('workflow-block-add-btn').textContent === 'Add Text Block' && !document.getElementById('workflow-block-text-field').hidden`, 'Plain Text switches the composer to a text step');
  await input('#workflow-block-text', 'Send the plasmid for sequencing.');
  await click('#workflow-block-add-btn');
  await waitFor('document.querySelectorAll("#workflow-graph-nodes [data-workflow-node]").length === 3');
  const nodeIds = await evaluate('return [...document.querySelectorAll("#workflow-graph-nodes [data-workflow-node]")].map(n => n.dataset.workflowNode);');
  const connect = async (from, to) => {
    await click(`[data-workflow-port-out="${from}"]`);
    await click(`[data-workflow-port-in="${to}"]`);
  };
  await connect(nodeIds[0], nodeIds[1]);
  await connect(nodeIds[1], nodeIds[2]);
  await waitFor('document.querySelectorAll("#workflow-graph-svg [data-workflow-link-id]").length === 2');
  await evaluate(`document.querySelector('#workflow-graph-svg [data-workflow-link-id]:last-child').dispatchEvent(new MouseEvent('click', { bubbles: true }));`);
  await check('document.querySelectorAll("#workflow-graph-svg [data-workflow-link-id]").length === 1', 'Clicking a connection deletes it');
  await connect(nodeIds[1], nodeIds[2]);
  await evaluate(`const radio = document.querySelector('input[name="workflow-block-type-option"][value="protocol"]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));`);
  await input('#workflow-block-protocol-search', 'gel');
  await click('[data-workflow-block-protocol-id="demo-gel"]');
  await shot('06-template-editor', 'Create a workflow template', 'Name the template, then add its steps as protocol or plain-text blocks.', '.workflow-editor-sidebar',
    [['#workflow-template-name', 'Template name', 'right'], ['#workflow-block-type', 'Protocol or Plain Text'], [['#workflow-block-protocol-search', '.workflow-block-protocol-search-result'], 'Find and pick a protocol', 'right'],
      ['#workflow-block-add-btn', 'Add Protocol Block', 'right'], ['#workflow-save-template-btn', 'Save the template', 'right']], { side: true });
  // Ports and the delete button show while a block is hovered or focused.
  await evaluate(`const node = document.querySelector('[data-workflow-node="${nodeIds[2]}"] .workflow-node-header'); const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.bottom + 12 }));`);
  await waitFor('!document.getElementById("workflow-graph-context-menu").hidden');
  await check('document.getElementById("workflow-graph-context-menu").textContent.includes("Delete Block")', 'Right-clicking a block offers Delete, Disconnect, and Clear Selection');
  await evaluate(`document.querySelector('[data-workflow-port-out="${nodeIds[1]}"]').focus();`);
  await shot('07-connect-blocks', 'Connect blocks', "Point to a block to show its dots. Click an output dot, then the next block's input dot.", ['#workflow-graph-nodes [data-workflow-node]', '#workflow-graph-context-menu'],
    [[`[data-workflow-port-in="${nodeIds[1]}"]`, 'Input dot'], [`[data-workflow-port-out="${nodeIds[1]}"]`, 'Output dot', 'right'],
      [`[data-workflow-node="${nodeIds[1]}"] .workflow-node-remove`, 'Delete block', 'right'], ['#workflow-graph-context-menu', 'Right-click menu']]);
  await key('body', 'Escape');
  await click('#workflow-save-template-btn');
  await waitFor(`tutorial.state.workflowTemplates.some(t => t.name === 'Plasmid check · tutorial')`);
  await check(`tutorial.state.workflowTemplates.find(t => t.name === 'Plasmid check · tutorial').blocks.length === 3 && tutorial.state.workflowTemplates.find(t => t.name === 'Plasmid check · tutorial').links.length === 2`, 'Save Current Graph saves the blocks and connections as a template');
  await click('#workflow-entry-back-btn');
  await waitFor('!document.querySelector("#workflow-list").closest(".workflow-list-panel").hidden');
  await check(`document.getElementById('workflow-list').textContent.includes('Plasmid check · tutorial')`, 'The back arrow returns to the template list, which shows the new template');
  await input('#workflow-search', 'plasmid');
  await check(`document.querySelectorAll('[data-workflow-template-open]').length === 2`, 'Search templates filters the template list');
  await input('#workflow-search', '');

  // Delete a template from its right-click menu.
  const templateRow = name => `[...document.querySelectorAll('[data-workflow-template-open]')].find(b => b.textContent.includes(${JSON.stringify(name)}))`;
  const rightClickTemplate = name => evaluate(`const row = ${templateRow(name)}; const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 60, clientY: r.bottom - 4 }));`);
  await rightClickTemplate('Protein prep · tutorial');
  await waitFor('!document.getElementById("workflow-template-context-menu").hidden');
  await check(`document.getElementById('workflow-template-delete-btn').disabled`, 'Delete Template is unavailable while the template has processes');
  await key('body', 'Escape');
  await check(`document.getElementById('workflow-template-context-menu').hidden`, 'Escape closes the template menu');
  await rightClickTemplate('Plasmid check · tutorial');
  await waitFor('!document.getElementById("workflow-template-context-menu").hidden && !document.getElementById("workflow-template-delete-btn").disabled');
  const newTemplateRow = await markRect('new-template', templateRow('Plasmid check · tutorial'));
  await shot('08-delete-template', 'Delete a template', 'Right-click a template that has no processes and choose Delete Template.', ['.workflow-template-name-list', '#workflow-template-context-menu'],
    [[newTemplateRow, 'Right-click a template'], ['#workflow-template-delete-btn', 'Delete Template', 'right']], { side: true });
  await click('#workflow-template-delete-btn');
  await waitFor(`!tutorial.state.workflowTemplates.some(t => t.name === 'Plasmid check · tutorial')`);
  await check(`document.getElementById('workflow-template-context-menu').hidden && !document.getElementById('workflow-list').textContent.includes('Plasmid check · tutorial')`, 'Delete Template removes a template that has no processes');

  fs.writeFileSync(path.join(folder, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Finished: ${manifest.screenshots.length} screenshots; ${manifest.checks.length} checks.`);
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
