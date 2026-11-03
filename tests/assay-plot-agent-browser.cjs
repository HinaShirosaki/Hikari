// Source UI integration; provide PLAYWRIGHT_MODULE_PATH and CHROME_PATH as needed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createMainMcpService } = require('../src/main/core/services/create-mcp-service.js');
const { createDirectMcpToolRouter } = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const { ASSAY } = require('../src/shared/ipc/channels.js');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'assay-plot-qa-'));
let html = require('./support/assay-workspace-qa.cjs')({ root, url: (file) => pathToFileURL(path.join(root, file)).href });
html = html.replace('<script type="module">', `<script>
  window.hikariApi = {
    onAssayPlotRequest: handler => { window.plotRequestHandler = handler; },
    respondToAssayPlotRequest: payload => window.plotReply(payload)
  };
  </script><script type="module">`);
fs.writeFileSync(path.join(output, 'index.html'), html);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--allow-file-access-from-files'] });
  let service;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const ipcMain = new EventEmitter();
    const sender = { mainFrame: {}, isDestroyed: () => false,
      send: (_channel, payload) => { void page.evaluate((value) => window.plotRequestHandler(value), payload); } };
    await page.exposeFunction('plotReply', (payload) => ipcMain.emit(ASSAY.PLOT_RESPONSE, { sender, senderFrame: sender.mainFrame }, payload));
    let runTool;
    service = createMainMcpService({ ipcMain, getMainWindow: () => ({ webContents: sender }),
      createMcpHost: (options) => { runTool = options.runTool; return { close: async () => {} }; } });
    const router = createDirectMcpToolRouter({ runTool });
    const tool = (input) => router.callTool('assay_plot', input);
    await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
    await page.waitForFunction(() => window.qa?.host?.data?.length);
    await page.evaluate(() => { document.body.dataset.activeView = 'assay-view'; });
    const source = await page.evaluate(() => JSON.stringify(qa.state.assays[0].resultValues));
    let current = await tool({ action: 'read' });
    assert.equal(current.ok, true, JSON.stringify(current));
    const update = (style) => ({ action: 'update', assay_id: current.assay_id, expected_revision: current.revision, request_id: randomUUID(), style });
    const series = current.context.seriesLabels[0];
    const added = [
      { id: 'callout', type: 'label', text: 'Half-response threshold', coordinates: 'plot', x: 0.55, y: 0.75, arrow: true },
      { id: 'threshold', type: 'line', axis: 'y', value: 50, color: '#b26b44', dash: 'dash' },
      { id: 'range', type: 'band', axis: 'x', start: 10, end: 100, color: '#809168', opacity: 0.15 }
    ];
    const first = update({ title: 'Reporter response', xTitle: 'Concentration', yTitle: 'Signal', xScale: 'log10',
      legendPosition: 'right', seriesStyles: { [series]: { color: '#687b50', pointSize: 9 } }, plotElements: added });
    current = await tool(first);
    assert.equal(current.ok, true, JSON.stringify(current)); assert.equal(current.rendered, true);
    assert(await page.evaluate(() => decodeURIComponent(qa.state.assays[0].latestAnalysis.chartDataUrl).includes('Half-response threshold')));
    const rendered = await page.evaluate(() => ({ title: qa.host.layout.title.text, annotations: qa.host.layout.annotations,
      shapes: qa.host.layout.shapes, type: qa.host.layout.xaxis.type, data: qa.host.data.map((trace) => ({ name: trace.name, line: trace.line, marker: trace.marker })) }));
    assert.equal(rendered.title, 'Reporter response'); assert.equal(rendered.type, 'log');
    assert(rendered.annotations.some((item) => item.name === 'assay-element-callout'));
    assert.equal(rendered.shapes.find((item) => item.name === 'assay-element-range').x1, 100);
    assert.equal(rendered.shapes.find((item) => item.name === 'assay-element-threshold').y0, 50);
    assert.equal(rendered.data.find((trace) => trace.name === series).line.color, '#687b50');
    assert.equal((await tool(first)).status, 'already_applied');
    assert.equal((await tool({ ...first, request_id: 'stale' })).status, 'revision_conflict');
    assert.equal((await tool({ ...update({ title: 'wrong' }), assay_id: 'other' })).status, 'assay_mismatch');
    assert.equal((await tool(update({ xColumn: 'wrong' }))).status, 'invalid_arguments');
    assert.equal((await tool(update({ lineWidth: 999 }))).status, 'invalid_arguments');
    assert.equal(await page.locator('#assay-component-canvas').count(), 0);
    // Plot elements still render without an Elements formatting tab.
    assert.equal(await page.locator('[data-cc-tab="elements"]').count(), 0);
    // Directly dragging a label round-trips into the same style data.
    await page.evaluate(async () => { await Plotly.relayout(qa.host, { 'annotations[2].x': 0.65, 'annotations[2].y': 0.8 }); await qa.ready(); });
    current = await tool({ action: 'read' });
    assert.equal(current.style.plotElements[0].x, 0.65); assert.equal(current.style.plotElements[0].y, 0.8);
    // Export includes all new plot elements.
    const exported = await page.evaluate(async () => decodeURIComponent(await Plotly.toImage(qa.host, { format: 'svg' })));
    assert(exported.includes('Half-response threshold'));
    assert.equal(await page.evaluate(() => JSON.stringify(qa.state.assays[0].resultValues)), source);
    await page.screenshot({ path: path.join(output, 'plot-desktop.png') });
    const savedStyle = JSON.stringify(current.style);
    await page.reload(); await page.waitForFunction(() => window.qa?.host?.data?.length);
    current = await tool({ action: 'read' });
    assert.equal(JSON.stringify(current.style), savedStyle);
    await page.click('#assay-mode-create-btn');
    assert.equal((await tool({ action: 'read' })).status, 'plot_unavailable');
    await page.fill('#assay-name', 'Reporter dose response'); await page.click('#assay-save-btn');
    await page.click('#assay-mode-results-btn'); await page.waitForTimeout(200);
    // Restore the fixture's fitted method after Setup reload clears the output.
    await page.evaluate(() => { document.getElementById('assay-analysis-panel').open = true; const kind = document.getElementById('assay-analysis-kind'); kind.value = 'linear'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
    current = await tool({ action: 'read' });
    assert.equal(JSON.stringify(current.style), savedStyle);
    // Saving failures restore both visible and saved styles.
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('test save failed'); }; });
    const failed = await tool(update({ title: 'Must roll back' }));
    assert.equal(failed.status, 'update_failed');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    assert.equal((await tool({ action: 'read' })).style.title, 'Reporter response');
    await page.evaluate(() => { window.originalReact = Plotly.react; Plotly.react = () => Promise.reject(new Error('test render failed')); });
    const failedRender = await tool(update({ title: 'Must roll back' }));
    assert.equal(failedRender.status, 'update_failed');
    await page.evaluate(() => { Plotly.react = window.originalReact; });
    current = await tool({ action: 'read' });
    assert.equal(current.style.title, 'Reporter response');
    current = await tool(update({ title: 'Reporter response' })); assert.equal(current.ok, true);
    await page.click('#assay-workspace-format-btn');
    assert.equal(await page.locator('[data-cc-tab="elements"]').count(), 0);
    await page.setViewportSize({ width: 1000, height: 950 });
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, 'plot-narrow.png') });
    // Agent figures use the same four format tabs and retain their annotations.
    await page.evaluate(() => qa.module.renderAgentPlotlyGraph({ id: 'test-custom', name: 'Custom', figure: { data: [{ type: 'scatter', x: [1, 2], y: [2, 3] }], layout: {
      annotations: [{text: 'Original annotation', x: 1, y: 2, showarrow: false}],
      shapes: [{type: 'line', x0: 1, x1: 2, y0: 2, y1: 2}]
    } } }));
    await page.waitForFunction(() => document.querySelector('[data-assay-agent-plotly-chart]')?._fullLayout);
    assert.equal((await tool({ action: 'read' })).status, 'plot_unavailable');
    assert.equal(await page.locator('[data-cc-tab="elements"], [data-cc-panel="elements"], [data-plot-element]').count(), 0);
    assert.deepEqual(await page.locator('[data-cc-tab]').allTextContents(), ['Frame', 'Axis', 'Data Series', 'Text']);
    await page.locator('[data-cc-tab="frame"]').focus(); await page.keyboard.press('End');
    assert.equal(await page.locator('[data-cc-tab="text"]').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-cc-tab="frame"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => JSON.stringify(qa.state.assays[0].chartStyle)), savedStyle);
    const agentSvg = await page.evaluate(async () => decodeURIComponent(await Plotly.toImage(document.querySelector('[data-assay-agent-plotly-chart]'), {format: 'svg'})));
    assert(agentSvg.includes('Original annotation'));
    assert(await page.evaluate(() => document.querySelector('[data-assay-agent-plotly-chart]').layout.shapes
      .some((shape) => shape.type === 'line' && shape.x0 === 1 && shape.x1 === 2 && shape.y0 === 2 && shape.y1 === 2)));
    await page.screenshot({path: path.join(output, 'agent-format.png')});
    await page.evaluate(() => { const kind = document.getElementById('assay-analysis-kind'); kind.value = 'linear'; kind.dispatchEvent(new Event('change', {bubbles: true})); });
    await page.evaluate(() => qa.ready());
    assert.equal(await page.locator('[data-cc-tab="elements"]').count(), 0);
    assert.equal(await page.locator('[data-cc-tab="frame"]').getAttribute('aria-selected'), 'true');
    await page.locator('[data-cc-tab="frame"]').focus(); await page.keyboard.press('End');
    assert.equal(await page.locator('[data-cc-tab="text"]').getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    console.log(`Assay plot live MCP, rendering, format tabs, drag, export, reload, Setup and rollback checks passed. Screenshots: ${output}`);
  } finally { await service?.stop(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
