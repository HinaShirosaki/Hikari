'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { createAgentAssayTableRuntime } = require('../src/main/agent/tools/agent-assay-table.js');
const { callAssayTable } = require('../src/main/agent/mcp-contract/direct-tools/assay-table.js');
const { createAgentControllerCore } = require('../src/main/ipc/register-agent-ipc/agent-controller-core.js');
const { buildCodexAgentPrompt } = require('../src/main/agent/codex-agent/prompts.js');
const { runPythonSandbox } = require('../src/main/agent/tools/agent-python-sandbox.js');
const load = file => loadEsmStyleModule(path.resolve('src/renderer', file));
const { createAssayAgentContext } = load('modules/assay/agent/context.js');
const { createScopedAgentChatState } = load('modules/agent-chat/scoped-state.js');
const { createAgentPayloadBuilder } = load('modules/agent-chat/payload-builder.js');
const { createAgentRequestController } = load('modules/agent-chat/agent-request-controller.js');
const { bindAgentChatEvents } = load('modules/agent-chat/event-bindings.js');
const { createAgentPlotReplay } = load('modules/agent-chat/plot-replay.js');
const cleanText = (value, limit = 5000) => String(value ?? '').trim().slice(0, limit);

function plateContext(count = 1536, sampleLength = 160) {
  const rowLabel = index => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
  const layout = Array.from({ length: count }, (_, i) => ({
    well: `${rowLabel(Math.floor(i / 48))}${i % 48 + 1}`, sampleId: 'S'.repeat(sampleLength), concentration: String(i % 48)
  }));
  const results = Object.fromEntries(layout.map((item, i) => [item.well, String(i)]));
  const assay = { id: 'full-plate', name: 'Complete screen', plateType: '1536', wellLayout: layout, resultValues: results };
  return createAssayAgentContext({
    runtime: { assayMode: 'results', activeResultsAssayId: assay.id, currentLayout: layout, currentResults: results },
    elements: { assayPlateTypeInput: { value: '1536' } }, state: { projects: [] }, getAssayById: () => assay,
    getLayoutManager: () => ({}), getResultsManager: () => ({ syncCurrentResultsFromGrid() {} }), hasUnsavedResultsDraft: () => false
  }).getAgentChatContext();
}

test('1536 long-label wells reach the scratch table through the actual renderer payload and controller prompt', async () => {
  const context = plateContext();
  const state = createScopedAgentChatState({ projects: [], settings: {} }, { getScopeContext: () => context });
  const builder = createAgentPayloadBuilder({ state, input: { value: 'Plot every well, including AF48.' },
    getComposerAttachments: () => [], ensureAgentState() {} });
  const draft = builder.getDraftRequest();
  assert.equal(draft.hiddenContexts[0].assayTable.rows.length, 1536);
  assert.ok(draft.hiddenContexts[0].text.length < 16000);
  assert.match(draft.hiddenContexts[0].text, /1536 rows; showing first/);
  const tables = createAgentAssayTableRuntime();
  let input;
  const controller = createAgentControllerCore({
    deps: { LLM_PROVIDERS: { CODEX: 'codex' }, getStorageRoot: () => os.tmpdir() }, cleanText,
    controllerUtils: { resolveAgentLlmSource: () => ({ provider: 'codex' }), createAgentLlmTraceContext: () => ({}), extractConversation: () => [] },
    lifecycleService: { normalizeJsonPayload: value => value || {}, asArray: value => Array.isArray(value) ? value : [] },
    agentToolRuntime: { normalizeAgentSnapshot: value => value, runAgentTool: (_name, args) => tables.execute(args) },
    codexAgentRuntime: { run: async value => { input = value; return { ok: true }; } },
    observability: { recordLifecycleEvent() {} }, setCodexCliModel() {}, setCodexCliReasoningEffort() {}
  });
  await controller.runAgentControllerCore({ message: draft.messageText, agent: builder.buildAgentFlagsPayload({ hiddenContexts: draft.hiddenContexts }), llm: { provider: 'codex' } });
  const prompt = buildCodexAgentPrompt(input);
  assert.match(prompt, /Plot every well, including AF48/);
  assert.match(prompt, /table_id="1", row_count=1536/);
  assert.match(prompt, /fix the figure size at creation: use layout.width=700 and layout.height=500/);
  assert.match(prompt, /layout.autosize=false and config.responsive=false/);
  assert.match(prompt, /preserve all observations and numeric X spacing/);
  assert.match(prompt, /Honor explicit user size requests/);
  assert.match(prompt, /Structural inspection does not verify that labels fit/);
  const stored = tables.getTable({ table_id: '1' });
  assert.equal(stored.rows.length, 1536);
  assert.deepEqual(stored.rows.at(-1), { well: 'AF48', row: 'AF', column: '48', sample: 'S'.repeat(160), concentration: '47', result: '1535' });
  assert.equal(stored.rows[0].result, '0');
});

test('Python processes every row of 96-, 384-, and 1536-well inputs; public read pages recover complete output', async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'plate-agent-data-'));
  try {
    const tables = createAgentAssayTableRuntime({ runPythonSandbox, sandboxRoot });
    const deps = { runTool: (_name, args) => tables.execute(args) };
    for (const count of [96, 384, 1536]) {
      const created = await callAssayTable({ action: 'create', rows: Array.from({ length: count }, (_, i) => ({ result: i })) }, {}, deps);
      assert.equal(created.table.rows.length, 50);
      const result = await callAssayTable({ action: 'python', table_id: created.table.id, code: [
        'import json', 'from pathlib import Path',
        "table=json.loads(Path('input_table.json').read_text())",
        "assert not table['preview_truncated'] and len(table['rows']) == table['row_count']",
        "assert all(not t['preview_truncated'] and len(t['rows']) == t['row_count'] for t in json.loads(Path('tables.json').read_text()))",
        "rows=table['rows']",
        "Path('output_table.json').write_text(json.dumps({'rows':[{'n':len(rows),'total':sum(r['result'] for r in rows)}]}))"
      ].join('\n') }, {}, deps);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(result.table.rows, [{ n: count, total: count * (count - 1) / 2 }]);
      const received = [];
      let offset = 0;
      do {
        const page = await callAssayTable({ action: 'read', table_id: created.table.id, offset, max_rows: 37 }, {}, deps);
        assert.equal(page.ok, true, JSON.stringify(page));
        assert.equal(page.table.offset, offset);
        received.push(...page.table.rows);
        offset = page.table.next_offset;
      } while (offset !== null);
      assert.deepEqual(received, tables.getTable({ table_id: created.table.id }).rows);
    }
  } finally { await fs.rm(sandboxRoot, { recursive: true, force: true }); }
});

test('a plot completed in a background plate persists in its own chat and replays after returning or restoring state', async () => {
  const root = { projects: [], settings: {} };
  let active = 'A', finish, progress, draws = 0;
  const state = createScopedAgentChatState(root, { getScopeContext: () => ({ scopeType: 'assay', assayId: active }) });
  const runtime = { activeRequests: new Map() };
  const api = { agentChat: () => new Promise(resolve => { finish = resolve; }), onAgentProgress: callback => { progress = callback; } };
  const node = { value: 'Make a graph', addEventListener() {} };
  const noOp = () => {};
  const controller = createAgentRequestController({ api, state, runtime, input: node, createId: () => 'id', persist: noOp,
    payloadBuilder: { getDraftRequest: () => ({ rawMessageText: node.value, messageText: node.value, attachments: [], hiddenContexts: [] }),
      buildAgentFlagsPayload: () => ({}), buildAgentLlmPayload: () => ({}), getCurrentProjectDetails: () => ({}), consumeHiddenContexts: noOp },
    attachmentsController: { reset: noOp }, sessionManager: { ensureCurrentChatSession: async () => {
      state.agentChat = { ...state.agentChat, currentSessionId: 'session-A' }; return 'session-A';
    }, renderSessionList: noOp, upsertSessionSummary: noOp },
    buildSyncedStateSnapshot: async () => ({}), ensureAgentState: noOp, renderContextSummary: noOp,
    renderHistoryView: noOp, setStatus: noOp, syncComposerHeight: noOp
  });
  const replay = createAgentPlotReplay({ state, runtime, onPlotlyGraphArtifact: () => { draws++; return true; } });
  bindAgentChatEvents({ dom: { input: node, sendBtn: node, historyNode: node }, api, state, runtime,
    shell: { renderHistoryView: noOp, setStatus: noOp }, onPlotlyGraphArtifact: replay.deliver });
  const sending = controller.sendMessage();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const requestId = [...runtime.activeRequests.keys()][0];
  active = 'B'; state.agentChat = { ...state.agentChat, currentSessionId: 'session-B' }; replay.replay();
  const artifact = { id: 'graph-A', figure: { data: [{ type: 'scatter', x: [1, 2], y: [3, 4] }] } };
  progress({ client_request_id: requestId, stage: 'tool_call_completed', tool_name: 'plotly_graph', meta: { plotly_graph_artifact: artifact } });
  progress({ client_request_id: requestId, stage: 'codex_agent_stream', meta: { stream_text: 'Done.' } });
  assert.equal(draws, 0);
  finish({ ok: true, chat_session: { id: 'session-A' }, parser: { reasoning_summary: 'Done.' } });
  await sending;
  const saved = root.paperAgentChatSessions['assay:A'].messages.at(-1);
  assert.equal(saved.role, 'assistant');
  assert.equal(saved.meta.plotly_graph_artifacts[0].id, 'graph-A');
  assert.equal(root.paperAgentChatSessions['assay:B'].messages.length, 0);
  active = 'A'; replay.replay(); replay.replay();
  assert.equal(draws, 1, 'returning renders once without overwriting later chart edits');
  active = 'B'; replay.replay(); active = 'A'; replay.replay();
  assert.equal(draws, 2);
  const restored = createScopedAgentChatState(JSON.parse(JSON.stringify(root)), { getScopeContext: () => ({ scopeType: 'assay', assayId: 'A' }) });
  createAgentPlotReplay({ state: restored, runtime: {}, onPlotlyGraphArtifact: () => { draws++; return true; } }).replay();
  assert.equal(draws, 3);
});

test('the chat IPC retains graph figures on disk and in the final response even without a progress sender', async () => {
  const { registerAgentChatHandler } = require('../src/main/ipc/register-agent-ipc/agent-chat-handler.js');
  const { createAgentLifecycleService } = require('../src/main/ipc/register-agent-ipc/agent-lifecycle-service.js');
  const { createAgentChatLogRuntime } = require('../src/main/agent/context/agent-chat-log.js');
  const observability = require('../src/main/agent/shared/agent-observability.js');
  const { AGENT } = require('../src/shared/ipc/channels.js');
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'plate-agent-chat-'));
  const handlers = new Map();
  try {
    let fail = false;
    registerAgentChatHandler({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, cleanText,
      controllerUtils: { buildAgentLogRequestId: () => fail ? 'failed-plot' : 'complete-plot', extractConversation: () => [],
        summarizeLlmForAgentLog: () => ({}), summarizeAgentResultForLog: () => ({ ok: true }) },
      observability, agentChatLogRuntime: createAgentChatLogRuntime(), getAgentChatSessionStoragePath: () => storagePath,
      lifecycleService: createAgentLifecycleService({ cleanText }), runAgentController: async (_payload, runtime) => {
        runtime.emitAgentProgress({ tool_name: 'plotly_graph', status: 'completed', meta: { plotly_graph_artifact: {
          id: 'persisted-graph', figure: { data: [{ type: 'scatter', x: [0, 1], y: [2, 3] }] }
        } } });
        if (fail) throw new Error('Failure after graph creation');
        return { ok: true, parser: { reasoning_summary: 'Graph ready.' } };
      } });
    for (const shouldFail of [false, true]) {
      fail = shouldFail;
      const result = await handlers.get(AGENT.CHAT)({}, { message: 'Plot the current plate' });
      assert.equal(result.ok, !shouldFail);
      assert.equal(result.plotly_graph_artifacts[0].id, 'persisted-graph');
      const loaded = await createAgentChatLogRuntime().getSession({ storagePath, sessionId: result.chat_session.id });
      assert.deepEqual(loaded.messages.at(-1).meta.plotly_graph_artifacts[0].figure.data[0].y, [2, 3]);
    }
  } finally { await fs.rm(storagePath, { recursive: true, force: true }); }
});
