// Run with: node node_modules/electron/cli.js tests/flow-cytometry-electron.cjs
// Launches a disposable profile and the real plugin loader, without user data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { registerPluginIpc } = require('../src/main/ipc/register-plugin-ipc');
const { inspectPluginFolder } = require('../src/main/lib/inspect-plugin-folder');

const root = path.resolve(__dirname, '..');
const folderPath = path.join(root, 'plugins/flow-cytometry');
const temporary = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'hikari-flow-qa-'));
app.setPath('userData', path.join(temporary, 'profile'));
app.setPath('sessionData', path.join(temporary, 'session'));
let win, registry;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let attempt = 0; attempt < 140; attempt++) {
    const value = await predicate();
    if (value) return value;
    await wait(50);
  }
  throw new Error('Timed out: ' + label);
}

async function run() {
  await app.whenReady();
  registry = registerPluginIpc({ app, ipcMain, session, dialog, fs });
  const plugin = await inspectPluginFolder({ fs, folderPath });
  assert.ok(plugin.ok, plugin.error);
  const appModule = file => pathToFileURL(path.join(root, 'src/renderer/app', file)).href;
  const csp = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/)[0];
  const hostPath = path.join(temporary, 'index.html');
  await fs.writeFile(hostPath, `<!doctype html><head>${csp}<link rel="stylesheet" href="host.css"></head><body>
    <button id="topbar-left-rail-toggle">Toggle rail</button><main class="workspace-main"></main>
    <script type="module" src="host.mjs"></script></body>`);
  await fs.writeFile(path.join(temporary, 'host.css'), 'body{margin:0}.plugin-frame{width:100%;height:93vh;border:0}');
  await fs.writeFile(path.join(temporary, 'host.mjs'), `
    import { installPlugins } from '${appModule('plugin-loader.js')}';
    import { createPluginBridge } from '${appModule('plugin-bridge.js')}';
    import { getActivePluginLeftRailHeader } from '${appModule('plugin-left-rail-header.js')}';
    import { SHARED_LEFT_RAIL_CHANGED_EVENT } from '${appModule('shared-left-rail.js')}';
    const state = { settings: { plugins: [${JSON.stringify({ ...plugin, path: folderPath, enabled: true })}] } };
    const bridge = createPluginBridge({ state, windowObject: window, persist() {} });
    window.setAppearance = (mode, fontSize = 16) => {
      state.settings.appearance = { mode, fontSize };
      bridge.broadcastAppContext('appearance');
    };
    window.addEventListener(SHARED_LEFT_RAIL_CHANGED_EVENT, () => bridge.broadcastAppContext('layout'));
    installPlugins({ state, documentObject: document, appRegistry: [], bridge, api: hikariApi });
    document.getElementById('topbar-left-rail-toggle').addEventListener('click', () => {
      const rail = getActivePluginLeftRailHeader(window, document.querySelector('[data-plugin-id]'));
      rail?.setFolded(!rail.folded);
    });
  `);
  win = new BrowserWindow({ show: false, width: 1320, height: 920, webPreferences: {
    preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } });
  win.webContents.on('console-message', ({ level, message, sourceId }) => {
    if (level === 'error') console.error(sourceId, message);
  });
  await win.loadFile(hostPath);
  const frame = await until(() => win.webContents.mainFrame.frames.find(child => child.url.startsWith('http://127.0.0.1:')), 'plugin frame');
  const evaluate = source => frame.executeJavaScript(source, true);
  const host = source => win.webContents.executeJavaScript(source, true);
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await until(() => evaluate("document.querySelectorAll('.axis-form').length === 3"), 'axis editors ready');
  await until(() => evaluate("document.querySelector('#toggle-rail').hidden"), 'Hikari header owns the rail toggle');
  for (const hidden of [true, false]) {
    await host("document.querySelector('#topbar-left-rail-toggle').click()");
    await until(() => evaluate(`document.querySelector('#file-rail').hidden === ${hidden}`), 'host controls the file rail');
  }
  for (const [theme, color] of [['night', 'rgb(19, 20, 23)'], ['miku', 'rgb(242, 250, 250)']]) {
    await host(`setAppearance('${theme}', 18)`);
    await until(() => evaluate(`getComputedStyle(document.body).backgroundColor === '${color}'`), theme + ' appearance synchronized');
  }
  assert.equal(await evaluate('getComputedStyle(document.documentElement).fontSize'), '18px');
  await host("setAppearance('day')");
  await until(() => evaluate('!document.body.classList.contains("theme-miku")'), 'day appearance restored');
  assert.ok(await evaluate("document.fonts.load('13px Inter').then(fonts => fonts.length > 0 && fonts[0].status === 'loaded')"));

  // Exercise the real file input and worker, with independent states for each
  // file and a bad file in the same selection.
  await evaluate(`(async () => {
    const {makeDemoFcs} = await import('./fcs.mjs');
    const bytes = makeDemoFcs();
    const selected = new DataTransfer();
    for (const name of ['First.fcs', 'Second.fcs']) selected.items.add(new File([bytes], name));
    selected.items.add(new File(['not FCS'], 'Invalid.fcs'));
    const input = document.getElementById('files-input');
    input.files = selected.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await until(() => evaluate(`document.querySelectorAll('.file-row').length === 2
    && document.querySelector('#import-status').textContent.includes('Invalid.fcs')
    && !document.querySelector('[data-gate-tool=freehand]').disabled`), 'file batch imported and plotted');
  assert.equal(await evaluate("document.querySelector('#file-title').textContent"), 'First.fcs');
  assert.ok(await evaluate(`document.querySelector('#density').getContext('2d')
    .getImageData(0, 0, 320, 320).data.some(value => value > 0)`), 'density canvas contains data');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#chart-axes text')).fontFamily"), 'Arial, sans-serif');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.axis-frame')).stroke"), 'rgb(0, 0, 0)');
  assert.equal(await evaluate("document.querySelector('.population-panel')"), null);

  const change = (selector, value) => evaluate(`{
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }`);
  const set = (axis, key, value) => change(`[data-axis="${axis}"] [name="${key}"]`, value);
  await set('y', 'channel', '2');
  await set('y', 'scale', 'asinh');
  await until(() => evaluate("document.querySelector('#chart-axes').getAttribute('aria-label').includes('GFP') && !document.querySelector('[data-gate-tool=freehand]').disabled"), 'GFP on asinh axis');

  const [left, top] = await host("(() => { const box = document.querySelector('.plugin-frame').getBoundingClientRect(); return [box.x,box.y]; })()");
  const bounds = id => evaluate(`(() => {
    const { x, y, width, height } = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    return [x, y, width, height];
  })()`);
  const gateBounds = await bounds('gate-overlay');
  function pointer([x, y, width, height], type, fx, fy) {
    return win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type,
      x: left + x + width * fx, y: top + y + height * fy,
      button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  }
  const gateButton = kind => `document.querySelector('[data-gate-tool=${kind}]')`;
  assert.equal(await evaluate("document.querySelectorAll('#gate-tools [data-gate-tool]').length"), 7);
  await evaluate(`{
    ${gateButton('freehand')}.focus();
    ${gateButton('freehand')}.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  }`);
  assert.equal(await evaluate('document.activeElement.dataset.gateTool'), 'triangle');
  async function chooseGate(kind) {
    await evaluate(`${gateButton(kind)}.click()`);
    assert.equal(await evaluate("document.querySelector('#gate-tools [aria-pressed=true]').dataset.gateTool"), kind);
  }
  await chooseGate('freehand');
  win.webContents.debugger.attach('1.3');
  const mouse = (type, fx, fy) => pointer(gateBounds, type, fx, fy);
  const groupStats = () => evaluate(`Array.from(document.querySelectorAll(
    '.file-list li:has(> :is(.file-row, .group-row) > [aria-current="true"]) > .group-list > li > .group-row .file-meta'
  ), node => node.textContent)`);
  const countText = stats => stats.split(' events')[0];
  const countEvents = stats => Number(countText(stats).replaceAll(',', ''));
  const completed = groups => until(async () => {
    const stats = await groupStats();
    return stats.length === groups && stats.every(text => text.includes(' events'));
  }, 'gate results ready');
  const manageGate = (name, root = 'document') => evaluate(`${root}.querySelector('[aria-label="Manage gate for ${name}"]').click()`);
  const renameGate = name => evaluate(`{
    document.getElementById('gate-dialog-name').value = ${JSON.stringify(name)};
    document.getElementById('gate-dialog-form').requestSubmit();
  }`);
  await mouse('mousePressed', .12, .12);
  for (const point of [[.88, .12], [.88, .88], [.12, .88], [.12, .12]]) {
    await mouse('mouseMoved', ...point);
  }
  await mouse('mouseReleased', .12, .12);
  await completed(1);
  assert.equal(await evaluate("document.querySelectorAll('#gate-tools [aria-pressed=true]').length"), 0);
  const gated = countText((await groupStats())[0]);
  assert.ok(Number(gated.replaceAll(',', '')) > 0);
  assert.equal(await evaluate("document.querySelectorAll('.gate-outline').length"), 1);
  const formatPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
  const gatePercent = formatPercent.format(Number(gated.replaceAll(',', '')) / 16000);
  assert.equal(await evaluate("document.querySelector('.gate-percent').textContent"), gatePercent);
  assert.ok(await evaluate(`(() => {
    const frame = document.querySelector('.axis-frame').getBBox();
    const label = document.querySelector('.gate-percent');
    const x = Number(label.getAttribute('x')) - frame.x;
    const y = Number(label.getAttribute('y')) - frame.y;
    return label.getAttribute('text-anchor') === 'end' && x / frame.width > .8 && y / frame.height < .2;
  })()`), 'freehand percentage sits near the upper-right of the gate');
  async function clickPlot(box, x, y) {
    await pointer(box, 'mousePressed', x, y);
    await pointer(box, 'mouseReleased', x, y);
  }
  const point = (x, y) => clickPlot(gateBounds, x, y);
  await chooseGate('triangle');
  for (const vertex of [[.4, .85], [.75, .85], [.55, .32]]) await point(...vertex);
  await completed(2);
  assert.match(await evaluate("document.querySelector('#gate-outlines > :last-child').getAttribute('d')"), /^M[^L]+L[^L]+L[^L]+Z$/);

  await chooseGate('circle');
  await mouse('mousePressed', .55, .65);
  await mouse('mouseMoved', .69, .65);
  await mouse('mouseReleased', .69, .65);
  await completed(3);
  assert.equal(await evaluate("document.querySelectorAll('#gate-outlines circle').length"), 1);
  const circleX = () => evaluate("Number(document.querySelector('#gate-outlines circle').getAttribute('cx'))");
  const originalX = await circleX();
  await mouse('mousePressed', .55, .65);
  await mouse('mouseMoved', .68, .65);
  await mouse('mouseReleased', .68, .65);
  await until(async () => (await circleX()) > originalX + 100, 'circle gate moved');
  assert.equal((await groupStats()).length, 3);
  const movedX = await circleX();
  await mouse('mousePressed', .68, .65);
  await mouse('mouseMoved', .76, .65);
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))");
  await mouse('mouseReleased', .76, .65);
  assert.equal(await circleX(), movedX);

  const circleRadius = () => evaluate("Number(document.querySelector('#gate-outlines circle').getAttribute('r'))");
  const radius = await circleRadius();
  const priorCircleCount = countEvents((await groupStats())[2]);
  await mouse('mousePressed', (movedX + radius) / 1000, .65);
  await mouse('mouseMoved', .9, .65);
  await mouse('mouseReleased', .9, .65);
  await until(async () => (await circleRadius()) > radius + 50, 'circle resized with its edge handle');
  assert.equal(await circleX(), movedX);
  assert.notEqual(countEvents((await groupStats())[2]), priorCircleCount);

  const trianglePath = () => evaluate("document.querySelector('.gate-outline[data-gate-id=\"2\"]').getAttribute('d')");
  const triangle = await trianglePath();
  await point(.47, .76);
  assert.equal(await evaluate("document.querySelectorAll('#gate-handles .handle-vertex').length"), 3);
  await mouse('mousePressed', .4, .85);
  await mouse('mouseMoved', .34, .8);
  await mouse('mouseReleased', .34, .8);
  await until(async () => (await trianglePath()) !== triangle, 'triangle vertex reshaped');
  assert.equal((await trianglePath()).split('L').slice(1).join('L'), triangle.split('L').slice(1).join('L'));

  await chooseGate('polygon');
  for (const vertex of [[.6, .6], [.62, .33], [.86, .16], [.94, .51]]) await point(...vertex);
  assert.equal(await evaluate("document.querySelector('#finish-gate').hidden"), false);
  await point(.6, .6);
  await completed(4);

  for (const [total, kind, regionCount] of [[6, 'vertical', 2], [8, 'horizontal', 2], [12, 'quadrant', 4]]) {
    await chooseGate(kind);
    await point(.55, .49);
    await completed(total);
    const counts = (await groupStats()).slice(-regionCount).map(countEvents);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 16000);
  }
  assert.equal(await evaluate("document.querySelectorAll('.gate-outline.is-partition').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.gate-percent').length"), 12);
  const quadrant = () => evaluate("document.querySelector('.gate-outline.is-active').getAttribute('d')");
  const [vertical, horizontal] = (await quadrant()).split(' M');
  await mouse('mousePressed', .98, .49);
  await mouse('mouseMoved', .98, .37);
  await mouse('mouseReleased', .98, .37);
  await until(async () => !(await quadrant()).endsWith(horizontal), 'quadrant horizontal line adjusted');
  assert.equal((await quadrant()).split(' M')[0], vertical);
  win.webContents.debugger.detach();

  const setRange = async (min, max, key = 'x') => {
    await set(key, 'min', min);
    await set(key, 'max', max);
    await evaluate(`document.querySelector('[data-axis=${key}]').requestSubmit()`);
  };
  await setRange('150000', '1000');
  assert.ok(await evaluate("!document.querySelector('[data-axis=x] .axis-error').hidden"), 'invalid range shown');
  await setRange('25000', '150000');
  await until(() => evaluate(`document.querySelector('[data-axis=x] .axis-error').hidden && !${gateButton('freehand')}.disabled`), 'new plot range applied');
  assert.equal((await groupStats())[0], `${gated} events · ${gatePercent} of parent`);
  await evaluate("document.querySelector('[aria-label=\"View Second.fcs\"]').click()");
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'second file rendered');
  assert.equal(await evaluate("document.querySelector('#file-title').textContent"), 'Second.fcs');
  assert.equal((await groupStats()).length, 0);
  await evaluate("document.querySelector('[aria-label=\"View First.fcs\"]').click()");
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'first file restored');
  assert.equal(await evaluate("document.querySelector('[data-axis=x] [name=min]').value"), '25000');
  assert.equal(await evaluate("document.querySelector('[data-axis=y] [name=scale]').value"), 'asinh');
  assert.equal(countText((await groupStats())[0]), gated);
  assert.equal((await groupStats()).length, 12);
  assert.equal(await evaluate("document.querySelectorAll('#file-list > li:nth-child(2) .group-select').length"), 0);

  const railGroup = label => `document.querySelector('.group-select[aria-label="View ${label}"]')`;
  await manageGate('Gate 1');
  await renameGate('Selected cells');
  await evaluate(`${railGroup('Selected cells')}.click()`);
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'gated group rendered');
  assert.equal(await evaluate("document.querySelector('#file-title').textContent"), 'Selected cells');
  assert.equal(await evaluate(`${railGroup('Selected cells')}.querySelector('.file-meta').textContent`), `${gated} events · ${gatePercent} of parent`);

  win.webContents.debugger.attach('1.3');
  await chooseGate('vertical');
  await point(.5, .5);
  await completed(2);
  win.webContents.debugger.detach();
  const nestedCounts = (await groupStats()).map(countEvents);
  assert.equal(nestedCounts.reduce((sum, count) => sum + count, 0), Number(gated.replaceAll(',', '')));
  const nestedPercents = nestedCounts.map(count => formatPercent.format(count / Number(gated.replaceAll(',', ''))));
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.gate-percent'), node => node.textContent)"), nestedPercents);
  assert.equal(await evaluate(`${railGroup('Gate 8 · Left')}.closest('.group-list').previousElementSibling.textContent.includes('Selected cells')`), true);
  await evaluate(`${railGroup('Gate 8 · Left')}.click()`);
  await until(() => evaluate("document.querySelector('#chart-notice').hidden"), 'nested group rendered');
  const leftCount = nestedCounts[0].toLocaleString('en-US');
  assert.equal(await evaluate(`${railGroup('Gate 8 · Left')}.querySelector('.file-meta').textContent`), `${leftCount} events · ${nestedPercents[0]} of parent`);

  await click('show-histogram');
  const histogramReady = () => until(() => evaluate(`document.getElementById('chart-axes').getAttribute('aria-label').startsWith('Histogram')
    && document.getElementById('chart-notice').hidden`), 'histogram rendered');
  await histogramReady();
  assert.ok(await evaluate("document.querySelector('[data-axis=y]').hidden && document.querySelector('#gate-tools').hidden"));
  await set('x', 'channel', '2');
  await set('x', 'scale', 'asinh');
  await change('#histogram-bins', '64');
  await histogramReady();
  assert.equal(await evaluate("document.getElementById('chart-axes').getAttribute('aria-label')"), 'Histogram: FL1-A · GFP by event count');
  assert.ok(await evaluate(`document.querySelector('#density').getContext('2d')
    .getImageData(0, 0, 1024, 1024).data.some(value => value > 0)`), 'histogram canvas contains bars');
  const histogramImage = () => evaluate("document.querySelector('#density').toDataURL()");
  const rawHistogram = await histogramImage();
  await change('#histogram-smoothing', '8');
  assert.notEqual(await histogramImage(), rawHistogram);
  assert.match(await evaluate("document.querySelector('#chart-axes').getAttribute('aria-label')"), /by smoothed count$/);
  await click('show-density');
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'density restored');
  assert.equal(await evaluate("document.querySelector('#histogram-options').hidden"), true);
  assert.equal(await evaluate("document.querySelector('[data-axis=x] [name=channel]').value"), '0');
  await click('show-histogram');
  await histogramReady();
  assert.equal(await evaluate("document.querySelector('#histogram-bins').value"), '64');
  assert.equal(await evaluate("document.querySelector('#histogram-smoothing').value"), '8');
  assert.equal(await evaluate("document.querySelector('[data-axis=x] [name=channel]').value"), '2');
  await change('#histogram-smoothing', '0');
  assert.equal(await histogramImage(), rawHistogram);
  await click('edit-histogram-overlay');
  await evaluate("[...document.querySelectorAll('.histogram-source')].find(label => label.textContent === 'Gate 8 · Right').click()");
  await change('#histogram-normalization', 'percent');
  await evaluate("document.getElementById('histogram-overlay-form').requestSubmit()");
  await until(() => evaluate("document.querySelectorAll('#histogram-legend li').length === 2 && document.querySelector('#chart-axes').ariaLabel.endsWith('% of in-range events')"), 'sibling gate overlay with a percent axis');
  await click('show-scatter-3d');
  await until(() => evaluate("!document.querySelector('#scatter-reset').disabled"), '3D plot of the selected group');
  assert.equal(await evaluate("document.querySelector('#scatter-footer .legend').checkVisibility()"), true);
  await set('z', 'channel', '3');
  await setRange('100000000', '1000000000', 'z');
  await until(() => evaluate("document.querySelector('#scatter-notice').textContent.includes('No events')"), 'Z range filters the group');
  await set('z', 'scale', 'asinh');
  await until(() => evaluate(`document.querySelector('#scatter-notice').hidden
    && document.querySelector('#scatter-canvas').ariaLabel.includes('Z: FL2-A · mCherry')`), 'Z channel changed');
  const scatterImage = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('#scatter-canvas').toDataURL()))))");
  const beforeRotation = await scatterImage();
  await evaluate("document.querySelector('#scatter-canvas').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight'}))");
  await until(async () => (await scatterImage()) !== beforeRotation, 'arrow key rotates 3D plot');
  win.webContents.debugger.attach('1.3');
  const scatterBounds = await bounds('scatter-canvas');
  async function dragScatter(fy) {
    await click('scatter-reset');
    await pointer(scatterBounds, 'mousePressed', .4, .4);
    await pointer(scatterBounds, 'mouseMoved', .55, .4);
    await pointer(scatterBounds, 'mouseMoved', .65, fy);
    const image = await scatterImage();
    await pointer(scatterBounds, 'mouseReleased', .65, fy);
    return image;
  }
  const sidewaysView = await dragScatter(.4);
  assert.ok(sidewaysView !== beforeRotation, 'drag rotates 3D plot');
  assert.ok((await dragScatter(.44)) === sidewaysView, 'sideways drag ignores vertical drift');
  win.webContents.debugger.detach();
  if (process.env.HIKARI_FLOW_SCREENSHOT) {
    await fs.writeFile(process.env.HIKARI_FLOW_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  await manageGate('Selected cells');
  await click('remove-gate');
  assert.equal(await evaluate("document.querySelector('#file-title').textContent"), 'First.fcs');
  assert.equal(await evaluate("document.querySelector('[data-axis=x] [name=min]').value"), '25000');
  assert.equal(await evaluate(`Boolean(${railGroup('Selected cells')} || ${railGroup('Gate 8 · Left')})`), false);
  await evaluate("document.querySelector('[aria-label=\"Close First.fcs\"]').click()");
  assert.equal(await evaluate("document.querySelector('#file-title').textContent"), 'Second.fcs');
  await click('new-folder');
  await evaluate(`{
    document.getElementById('folder-name').value = 'Screen';
    document.getElementById('folder-form').requestSubmit();
  }`);
  await evaluate(`{
    const transfer = new DataTransfer();
    const sample = document.querySelector('[aria-label="View Second.fcs"]');
    sample.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true }));
    document.querySelector('.folder-item').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }`);
  assert.equal(await evaluate("document.querySelector('.folder-list .file-select').getAttribute('aria-label')"), 'View Second.fcs');
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'folder sample plotted');

  const plotClick = async (x, y) => clickPlot(await bounds('gate-overlay'), x, y);
  win.webContents.debugger.attach('1.3');
  await chooseGate('vertical');
  await plotClick(.45, .5);
  await completed(2);
  await evaluate("document.querySelector('.folder-list [aria-label=\"View Gate 1 · Left\"]').click()");
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'folder group plotted');
  await chooseGate('horizontal');
  await plotClick(.5, .45);
  await completed(2);
  win.webContents.debugger.detach();

  // Import reordered and shifted data to check that the nested gates use each file's own events.
  await evaluate(`(async () => {
    const {makeDemoFcs} = await import('./fcs.mjs');
    const bytes = makeDemoFcs();
    const view = new DataView(bytes);
    const text = new TextDecoder().decode(bytes.slice(0, 58));
    const start = Number(text.slice(26, 34));
    for (let at = start; at < bytes.byteLength; at += 16) {
      const fsc = view.getFloat32(at, true);
      const ssc = view.getFloat32(at + 4, true);
      view.setFloat32(at, ssc, true);
      view.setFloat32(at + 4, fsc * .55, true);
    }
    const replace = (data, before, after) => {
      const header = new TextDecoder().decode(data.slice(58, start));
      new Uint8Array(data).set(new TextEncoder().encode(header.replace(before, after)), 58);
    };
    replace(bytes, '$P1N|FSC-A', '$P1N|SSC-A');
    replace(bytes, '$P2N|SSC-A', '$P2N|FSC-A');
    const missing = bytes.slice(0);
    replace(missing, '$P2N|FSC-A', '$P2N|FSC-H');
    document.querySelector('[aria-label="Add data files to Screen"]').click();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'Shifted.fcs'));
    transfer.items.add(new File([missing], 'Missing channel.fcs'));
    const input = document.getElementById('files-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  const fileItem = name => `document.querySelector('[aria-label="View ${name}"]')?.closest('li')`;
  await until(() => evaluate(`${fileItem('Shifted.fcs')}?.querySelectorAll('.group-select:not(:disabled)').length === 4
    && ${fileItem('Missing channel.fcs')}`), 'new files inherit nested gates');
  const groupCount = name => evaluate(`${fileItem(name)}.querySelector('[aria-label="View Gate 1 · Left"] .file-meta').textContent`);
  assert.notEqual(await groupCount('Second.fcs'), await groupCount('Shifted.fcs'));
  await evaluate("document.querySelector('[aria-label=\"View Missing channel.fcs\"]').click()");
  assert.match(await evaluate("document.getElementById('shared-gate-status').textContent"), /No matching channel for FSC-A/);
  assert.match(await evaluate("document.getElementById('chart-notice').textContent"), /Unavailable axes in this file: X \(FSC-A\)/);
  assert.equal(await evaluate(`${fileItem('Missing channel.fcs')}.querySelectorAll('.group-select').length`), 0);
  await evaluate("document.querySelector('[aria-label=\"View Shifted.fcs\"]').click()");
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'second folder sample plotted');
  const priorCounts = await Promise.all(['Second.fcs', 'Shifted.fcs'].map(groupCount));
  const childCount = name => evaluate(`${fileItem(name)}.querySelector('[aria-label="View Gate 2 · Bottom"] .file-meta').textContent`);
  const priorChild = await childCount('Second.fcs');
  await manageGate('Gate 1 · Left', fileItem('Shifted.fcs'));
  await click('show-gate');
  await until(() => evaluate(`!${gateButton('freehand')}.disabled`), 'shared gate axes restored');
  const splitBounds = await bounds('gate-overlay');
  win.webContents.debugger.attach('1.3');
  for (const [type, fraction] of [['mousePressed', .45], ['mouseMoved', .24], ['mouseReleased', .24]]) {
    await pointer(splitBounds, type, fraction, .5);
  }
  win.webContents.debugger.detach();
  await until(async () => (await groupCount('Second.fcs')) !== priorCounts[0], 'shared split recalculated');
  assert.notEqual(await groupCount('Shifted.fcs'), priorCounts[1]);
  assert.notEqual(await childCount('Second.fcs'), priorChild);
  assert.equal(await evaluate("document.querySelectorAll('.folder-list .group-select').length"), 8);
  win.webContents.debugger.attach('1.3');
  await chooseGate('vertical');
  await plotClick(.55, .5);
  await until(() => evaluate(`document.querySelectorAll('[aria-label="View Gate 3 · Left"]:not(:disabled)').length === 2`),
    'gate drawn in an already open file is shared');
  win.webContents.debugger.detach();
  await manageGate('Gate 3 · Left', fileItem('Shifted.fcs'));
  await click('remove-gate');
  await manageGate('Gate 1 · Left', fileItem('Shifted.fcs'));
  await renameGate('Shared population');
  assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"View Shared population · Left\"]').length"), 2);
  await manageGate('Shared population · Left', fileItem('Shifted.fcs'));
  await click('remove-gate');
  assert.equal(await evaluate("document.querySelectorAll('.folder-list .group-select').length"), 0);
  await evaluate("document.querySelector('[aria-label=\"View Missing channel.fcs\"]').click()");
  assert.equal(await evaluate("document.getElementById('shared-gate-status').hidden"), true);
  await evaluate(`(async () => {
    const {makeDemoFcs} = await import('./fcs.mjs');
    const transfer = new DataTransfer();
    transfer.items.add(new File([makeDemoFcs()], 'Imported.FCS'));
    transfer.items.add(new File(['FSC-A,SSC-A\\n100,25\\n200,50\\n'], 'Events.CSV'));
    transfer.items.add(new File(['notes'], 'Notes.md'));
    const input = document.getElementById('folder-input');
    input.files = transfer.files;
    Object.defineProperty(input.files[0], 'webkitRelativePath', { value: 'Run 2/Day 1/Imported.FCS' });
    input.dispatchEvent(new Event('change'));
  })()`);
  const folder = name => `document.querySelector('.folder-toggle[aria-label="${name}"]')?.closest('.folder-item')`;
  const importedFolder = folder('Run 2');
  await until(() => evaluate(`${importedFolder}?.querySelectorAll('.file-select').length === 2
    && ${importedFolder}.querySelector('[aria-label="View Events.CSV"] .file-meta')?.textContent === '2 events'`), 'mixed-format folder imported');
  await click('rail-demo');
  const example = folder('Example · CD19 panel');
  await until(() => evaluate(`${example}?.querySelectorAll('.file-select').length === 3`), 'example folder imported');
  await until(() => evaluate("document.querySelector('#chart-axes').ariaLabel.includes('CD19 · B525')"), 'example alias shown');
  await click('edit-channel-names');
  await change('#channel-alias-list input[name=B525]', 'B cells');
  await click('save-channel-aliases');
  assert.match(await evaluate("document.querySelector('#chart-axes').ariaLabel"), /B cells · B525/);
  await evaluate(`${example}.querySelector('[aria-label="View CD19-enriched.fcs"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-axis=x] option[value="2"]').textContent`), 'B cells · B525');
  console.log('flow-cytometry-electron: ok (gating, histograms, 3D scatter, shared gates and channel names)');
}

app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Flow Cytometry Electron test timed out'); app.exit(1); }, 25000);
run().then(() => 0, error => { console.error(error); return 1; }).then(async code => {
  clearTimeout(timeout);
  win?.destroy();
  await registry?.closeAll();
  await fs.rm(temporary, { recursive: true, force: true });
  app.exit(code);
});
