import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { normalizePlotElements, validatePlotRequest, plotRevision } from '../src/shared/assay-plot.mjs';
const require = createRequire(import.meta.url);
const { loadEsmStyleModule } = require('./support/runtime.js');
const path = require('node:path');
const root = path.resolve(import.meta.dirname, '..');
const load = (file) => loadEsmStyleModule(path.join(root, 'src/renderer/modules/assay/plotly', file), { crypto, TextEncoder });
const { createDefaultChartStyle } = load('chart-style-model.js');
const { preparePlotStylePatch, createPlotAgentController } = load('plot-agent-controller.js');
const { buildPlotElements, plotElementEditPatch } = load('plot-elements.js');
const { createMainMcpService } = require('../src/main/core/services/create-mcp-service.js');
const { createAssayPlotBridge } = require('../src/main/core/services/assay-plot-bridge.js');
const { createAssayApi } = require('../src/main/preload/api/assay-api.js');
const { createDirectMcpToolRouter } = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const { ASSAY } = require('../src/shared/ipc/channels.js');
const plain = (value) => JSON.parse(JSON.stringify(value));

const elements = normalizePlotElements([
  { id: 'label', type: 'label', text: 'Half response', coordinates: 'data', x: 10, y: 50 },
  { id: 'threshold', type: 'line', axis: 'y', value: 50 },
  { id: 'region', type: 'band', axis: 'x', start: 1, end: 100 }
]);
const axes = { x: { type: 'log' }, y: { type: 'linear' } };
const layout = buildPlotElements(elements, axes);
assert.equal(layout.annotations[0].x, 1, 'log label position uses log10');
assert.equal(layout.shapes[1].x1, 100, 'log shapes retain raw data units');
assert.equal(layout.shapes[1].layer, 'below');
const dragged = plotElementEditPatch({ 'annotations[2].x': 2, 'annotations[2].text': 'Moved' }, [{}, {}, ...layout.annotations], elements, axes);
assert.equal(dragged.plotElements[0].x, 100);
assert.equal(dragged.plotElements[0].text, 'Moved');
assert.throws(() => normalizePlotElements([{ ...elements[0], text: '<script>' }]), /plain text/);
assert.throws(() => normalizePlotElements([elements[0], elements[0]]), /unique ID/);
assert.throws(() => normalizePlotElements([{ ...elements[2], start: 100, end: 1 }]), /smaller/);
assert.throws(() => validatePlotRequest({ action: 'update', style: { title: 'A' } }), /assay_id/);
const context = { seriesLabels: ['A', 'B'], hasFittedCurve: true, hasCategoryX: false };
const original = createDefaultChartStyle();
original.seriesStyles.A = { pointSize: 8, color: '#123456' };
const next = preparePlotStylePatch(original, { seriesStyles: { A: { color: '#abcdef' } }, plotElements: elements }, context);
assert.equal(next.seriesStyles.A.pointSize, 8);
assert.equal(next.seriesStyles.A.color, '#abcdef');
assert.throws(() => preparePlotStylePatch(original, { lineWidth: 500 }, context), /out-of-range/);
assert.throws(() => preparePlotStylePatch(original, { xColumn: 'different' }, context), /Unsupported/);
assert.throws(() => preparePlotStylePatch(original, { textStyles: { title: { imaginary: 1 } } }, context), /Unsupported/);
assert.throws(() => preparePlotStylePatch(original, { seriesStyles: { missing: { color: '#aaaaaa' } } }, context), /Unknown series/);
assert.throws(() => preparePlotStylePatch(original, { yScale: 'log10', plotElements: [{ id: 'zero', type: 'line', axis: 'y', value: 0 }] }, context), /positive/);
assert.throws(() => preparePlotStylePatch(original, { chartType: 'bar' }, context), /fitted/);
assert.equal(await plotRevision({ a: 1, b: 2 }), await plotRevision({ b: 2, a: 1 }));

// Actual controller with a deterministic renderer: persistence and rendering
// failures roll back; an intervening user update survives conflict handling.
let plot = { available: true, style: plain(original), context, model: { y: [1, 2] } };
const assay = { id: 'assay-1', chartStyle: plain(original) };
let failSave = false, failRender = false;
const controller = createPlotAgentController({ getAssay: () => assay, isActive: () => true,
  analysisView: { getPlotSnapshot: () => plain(plot), plotReady: async () => ({ ok: true }),
    replacePlotStyle: (style) => { plot.style = plain(style); return Promise.resolve({ ok: !failRender, error: 'render failed' }); } },
  persist: () => { if (failSave) throw new Error('save failed'); }
});
const read = await controller.execute({ action: 'read' });
const update = { action: 'update', assay_id: assay.id, expected_revision: read.revision, request_id: 'update-1', style: { title: 'Signal', plotElements: elements } };
assert.equal((await controller.execute(update)).status, 'applied');
assert.equal((await controller.execute(update)).status, 'already_applied');
assert.equal(assay.chartStyle.title, 'Signal');
assert.equal((await controller.execute({ ...update, request_id: 'old' })).status, 'revision_conflict');
const updated = await controller.execute({ action: 'read' });
failSave = true;
assert.equal((await controller.execute({ ...update, expected_revision: updated.revision, request_id: 'save', style: { title: 'Lose me' } })).status, 'update_failed');
assert.equal(assay.chartStyle.title, 'Signal'); assert.equal(plot.style.title, 'Signal');
failSave = false; failRender = true;
assert.equal((await controller.execute({ ...update, expected_revision: updated.revision, request_id: 'render', style: { title: 'Lose me' } })).status, 'update_failed');
assert.equal(plot.style.title, 'Signal'); failRender = false;
plot.model.y.push(3);
assert.notEqual((await controller.execute({ action: 'read' })).revision, updated.revision, 'data updates invalidate previous revisions');

// Real public MCP -> main service -> preload -> renderer callback, with sender
// validation and propagation of actual renderer failures.
const ipcMain = new EventEmitter(), ipcRenderer = new EventEmitter();
const sender = { mainFrame: {}, isDestroyed: () => false, send: (channel, payload) => ipcRenderer.emit(channel, {}, payload) };
ipcRenderer.send = (channel, payload) => ipcMain.emit(channel, { sender, senderFrame: sender.mainFrame }, payload);
const api = createAssayApi(ipcRenderer);
let sent;
let unsubscribe = api.onAssayPlotRequest((payload) => { sent = payload; });
const bridge = createAssayPlotBridge({ ipcMain, getMainWindow: () => ({ webContents: sender }), timeoutMs: 60 });
const pending = bridge.run({ action: 'read' });
await new Promise((resolve) => setTimeout(resolve, 10));
let finished = false; pending.then(() => { finished = true; });
ipcMain.emit(ASSAY.PLOT_RESPONSE, { sender: {}, senderFrame: sender.mainFrame }, { id: sent.id, result: { ok: true } });
ipcMain.emit(ASSAY.PLOT_RESPONSE, { sender, senderFrame: {} }, { id: sent.id, result: { ok: true } });
await Promise.resolve(); assert.equal(finished, false);
api.respondToAssayPlotRequest({ id: sent.id, result: { ok: false, status: 'assay_mismatch' } });
assert.equal((await pending).status, 'assay_mismatch');
assert.equal((await bridge.run({ action: 'read' })).status, 'acknowledgement_timeout');
bridge.close(); unsubscribe();
let runTool, legacyCalls = 0;
const service = createMainMcpService({ ipcMain, getMainWindow: () => ({ webContents: sender }),
  agentToolRuntime: { runAgentTool: () => { legacyCalls += 1; } },
  createMcpHost: (options) => { runTool = options.runTool; return { close: async () => {} }; }
});
unsubscribe = api.onAssayPlotRequest(async (payload) => api.respondToAssayPlotRequest({ id: payload.id, result: await controller.execute(payload.args) }));
const router = createDirectMcpToolRouter({ runTool });
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createAgentMcpStdioServer } = require('../src/main/agent/mcp-contract/stdio-server.js');
const server = createAgentMcpStdioServer({ env: {}, gateway: { callGatewayTool: (...args) => router.callTool(...args) } });
const client = new Client({ name: 'assay-plot-test', version: '1' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport); await client.connect(clientTransport);
  assert((await client.listTools()).tools.some((tool) => tool.name === 'assay_plot'));
  const response = await client.callTool({ name: 'assay_plot', arguments: { action: 'read' } });
  assert.equal(response.isError, false); assert.equal(response.structuredContent.style.title, 'Signal');
  const wireUpdate = await client.callTool({ name: 'assay_plot', arguments: {
    action: 'update', assay_id: assay.id, expected_revision: response.structuredContent.revision,
    request_id: 'wire-update', style: { title: 'Via MCP', legendPosition: 'right', plotElements: elements }
  } });
  assert.equal(wireUpdate.isError, false, JSON.stringify(wireUpdate));
  assert.equal(wireUpdate.structuredContent.style.title, 'Via MCP');
  assert.equal(wireUpdate.structuredContent.style.legendPosition, 'right');
  const disabled = await router.callTool('assay_plot', { action: 'read' }, { snapshot: { settings: { agent: { disabledMcpToolNames: ['assay_plot'] } } } });
  assert.equal(disabled.status, 'disabled');
  await runTool('assay-table', {}); assert.equal(legacyCalls, 1);
} finally { await client.close(); await server.close(); unsubscribe(); await service.stop(); }
assert.equal(ipcMain.listenerCount(ASSAY.PLOT_RESPONSE), 0);
console.log('Assay plot validation, style merge, coordinates, rollback, revision and MCP/IPC checks passed.');
