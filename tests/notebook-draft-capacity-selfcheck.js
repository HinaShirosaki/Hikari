'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { callNotebookDraft, NOTEBOOK_DRAFT_MCP_TOOL } = require('../src/main/agent/mcp-contract/direct-tools/notebook-draft.js');
const { createNotebookDraftRuntime } = require('../src/main/agent/tools/agent-notebook-draft.js');
const { createCodexStreamProgressHandler } = require('../src/main/agent/codex-agent/stream-events.js');
const { extractCodexJsonEventToolCall } = require('../src/main/lib/codex-cli-provider/event-progress.js');
const { buildMcpToolResponseContent } = require('../src/main/agent/mcp-contract/stdio-server.js');
const { AGENT_TOOL_CALL_CATALOG } = require('../src/main/agent/tools/agent-tool-loading.js');
const { createAgentSubAppApi } = require('../src/main/agent/runtime/agent-sub-app-api.js');
const { createDraftSelectionPrompt } = require('../src/main/agent/tools/notebook-draft/selection-prompt.js');
const cleanText = (value, limit = 0) => limit > 0 ? String(value || '').trim().slice(0, limit) : String(value || '').trim();
const asArray = (value) => Array.isArray(value) ? value : [];
const renderer = (file) => loadEsmStyleModule(path.join(__dirname, '../src/renderer/modules', file));
const { normalizeAgentResponse } = renderer('agent-chat/response.js');
const { buildStateSnapshot } = renderer('agent-chat/state-snapshot.js');
const { buildAssistantResponseMessage } = renderer('agent-chat/assistant-message-meta.js');
const { createNotebookDraftAgentAdapter, normalizeNotebookDraft, buildNotebookEntryFromDraft } = renderer('biology-notebook/agent/notebook-drafts.js');
const { createNotebookHistoryActions } = renderer('agent-chat/history-notebook-actions.js');
const { collectReviewItemsForMessage } = renderer('agent-chat/review-overlay/review-items.js');
const { renderDraftCards } = renderer('agent-chat/rendering-drafts.js');

function draft(id, title = id) {
  return { project: { id: 'project', name: 'Project' }, protocol: { id: 'protocol', name: 'Protocol' },
    proposal: { proposal_id: id, title }, rendered_steps: ['A real step'],
    save: { mode: 'confirm_before_save', applied: false, status: 'awaiting_user_confirmation' },
    entry_template: { projectId: 'project', protocolId: 'protocol', notebookState: 'planned',
      result: title, agentDraftMeta: { proposalId: id } } };
}

test('one batch returns 20 independent reviewable pages and enforces its upper boundary', async () => {
  let calls = 0;
  const runTool = async (id, args) => {
    assert.equal(id, 'notebook-draft');
    assert.equal(args.protocol_candidates.length, 20);
    assert.equal(args.step_edits.length, 240);
    return { ok: true, status: 'proposal_ready', notebook: draft(`proposal-${++calls}`) };
  };
  const item = { protocol_candidates: Array.from({ length: 20 }, (_, i) => `Protocol ${i}`),
    step_edits: Array.from({ length: 240 }, (_, i) => ({ text: `Edit ${i}` })) };
  const response = await callNotebookDraft({ project_name: 'Project', drafts:
    Array.from({ length: 20 }, (_, i) => ({ ...item, title: `Page ${i}` })) }, {}, { runTool });
  assert.equal(calls, 20);
  assert.equal(response.notebooks.length, 20);
  assert.equal(response.results.length, 20);
  assert.equal(new Set(response.notebooks.map((page) => page.proposal.proposal_id)).size, 20);
  assert.equal(response.notebooks[19].proposal.title, 'Page 19');
  assert.equal(response.notebooks.every((page) => page.save.applied === false), true);
  for (const drafts of [[], Array(21).fill(item), [{ drafts: [item] }]]) {
    assert.equal((await callNotebookDraft({ drafts }, {}, { runTool })).ok, false);
  }
  assert.equal(calls, 20);
  assert.equal(NOTEBOOK_DRAFT_MCP_TOOL.inputSchema.properties.drafts.maxItems, 20);
  assert.equal(AGENT_TOOL_CALL_CATALOG['notebook-draft'].input_schema.properties.protocol_candidates.maxItems, 20);
  assert.equal(AGENT_TOOL_CALL_CATALOG['notebook-draft'].input_schema.properties.step_edits.maxItems, 240);
  const exported = require('../docs/agent/mcp-contract/mcp-contract.json').mcp.tools.find((tool) => tool.name === 'notebook_draft');
  assert.deepEqual(exported, NOTEBOOK_DRAFT_MCP_TOOL);
});

test('batch failures preserve successful pages and refining uses the existing proposal ID', async () => {
  let calls = 0;
  const result = await callNotebookDraft({ drafts: [{ title: 'First' }, {}, { title: 'Third', draft_id: 'existing' }] }, {}, {
    runTool: async () => {
      calls += 1;
      if (calls === 2) throw new Error('Missing protocol');
      return { ok: true, notebook: draft(`page-${calls}`) };
    }
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.notebooks.length, 2);
  assert.match(result.results[1].error, /Missing protocol/);
  assert.equal(result.notebooks[1].proposal.proposal_id, 'existing');
  assert.equal(result.notebooks[1].entry_template.agentDraftMeta.proposalId, 'existing');
});

test('streamed pages survive later calls, refinement, replay, response transport and review history', () => {
  const stream = createCodexStreamProgressHandler({ cleanText });
  const emit = (payload) => stream.emitStreamProgress({ type: 'codex_tool_call', tool_name: 'mcp__hikari__notebook_draft',
    status: 'completed', result: payload });
  emit({ ok: true, status: 'proposal_ready', notebook: draft('one') });
  const batch = { ok: true, status: 'proposal_ready', notebook: draft('two'), notebooks: [draft('two'), draft('three')] };
  emit(batch);
  emit(batch);
  emit({ ok: true, status: 'proposal_ready', notebook: draft('one', 'Refined first page') });
  const artifact = stream.getStreamState().streamedNotebookDraftPayload;
  assert.equal(artifact.notebooks.length, 3);
  assert.equal(artifact.notebooks[0].proposal.title, 'Refined first page');
  const response = normalizeAgentResponse({ notebook_draft: artifact });
  const state = { notebookEntries: [], agentChat: { messages: [] } };
  let id = 0;
  const adapter = createNotebookDraftAgentAdapter({ state, createId: () => `entry-${++id}` });
  const drafts = response.notebookPayloads.map(adapter.normalizeDraft);
  const message = buildAssistantResponseMessage({ createId: () => 'message', response,
    notebookDraft: drafts[0], notebookDrafts: drafts, traceRows: {}, messageText: 'Prepare three pages' });
  state.agentChat.messages.push(JSON.parse(JSON.stringify(message)));
  const restored = state.agentChat.messages[0];
  const collect = () => collectReviewItemsForMessage(restored, { notebookDraftAdapter: adapter });
  assert.equal(collect().length, 3);
  const html = renderDraftCards(restored.meta, restored.id, { notebookDraftAdapter: adapter, safeText: String });
  assert.match(html, /data-agent-draft-id="two"/);
  assert.match(html, /data-agent-draft-id="three"/);
  const opened = [];
  const actions = createNotebookHistoryActions({ state, notebookDraftAdapter: adapter,
    persist() {}, setStatus() {}, renderContextSummary() {}, renderHistoryView() {},
    onOpenNotebookEntry: (entryId) => opened.push(entryId) });
  assert.equal(actions.createPlannedPage('message', 'two'), true);
  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].agentDraftMeta.proposalId, 'two');
  assert.equal(collect().length, 2);
  assert.equal(actions.createPlannedPage('message', 'two'), true);
  assert.equal(state.notebookEntries.length, 1);
  actions.rejectPlannedPage('message', 'one');
  assert.equal(actions.createPlannedPage('message', 'one'), false);
  assert.equal(actions.rejectPlannedPage('message', 'two'), false);
  assert.equal(collect().length, 1);
  assert.equal(collect()[0].draftId, 'three');
  assert.equal(actions.createPlannedPage('message', 'missing'), false);
  assert.equal(state.notebookEntries.length, 1);
  actions.openNotebookPage('message', 'two');
  assert.equal(opened.at(-1), state.notebookEntries[0].id);
  actions.createPlannedPage('message', 'three');
  assert.equal(state.notebookEntries.length, 2);
  assert.equal(collect().length, 0);
});

test('large draft fields remain complete through model transport, UI normalization and save', () => {
  const page = draft('large');
  page.rendered_steps = Array.from({ length: 240 }, (_, i) => `Step ${i} ` + 'a'.repeat(3000));
  page.entry_template.result = 'n'.repeat(35000);
  const encoded = buildMcpToolResponseContent('notebook_draft', { ok: true, notebook: page });
  assert.equal(JSON.parse(encoded).notebook.rendered_steps.length, 240);
  assert.equal(JSON.parse(encoded).notebook.entry_template.result.length, 35000);
  const normalized = normalizeNotebookDraft(page);
  assert.equal(normalized.rendered_steps[239].length, page.rendered_steps[239].length);
  assert.equal(buildNotebookEntryFromDraft(normalized).result.length, 35000);
  const stream = createCodexStreamProgressHandler({ cleanText });
  const event = extractCodexJsonEventToolCall({ type: 'item.completed', item: { type: 'mcp_tool_call',
    server: 'hikari', tool: 'notebook_draft', result: { content: [{ type: 'text', text: encoded }] } } });
  assert.ok(event.notebook_draft_artifact);
  stream.emitStreamProgress(event);
  assert.equal(stream.getStreamState().streamedNotebookDraftPayload.notebook.rendered_steps.length, 240);
});

test('larger protocols and late placeholders survive the real notebook preparation path', async () => {
  const protocol = { id: 'protocol', name: 'Long protocol', materials: Array.from({ length: 100 }, (_, i) => `Material ${i}`),
    steps: Array.from({ length: 200 }, (_, i) => ({ text: i === 199 ? 'Final {{ph:p}}' : `Step ${i}`,
      placeholders: i === 199 ? [{ id: 'p', name: 'sample' }] : [] })) };
  const snapshot = buildStateSnapshot({ projects: [{ id: 'project', name: 'Project' }], protocols: [protocol],
    notebookEntries: [], settings: {}, agentChat: {}, workflows: [] }, 'project');
  assert.equal(snapshot.protocols[0].steps.length, 200);
  assert.equal(snapshot.protocols[0].materials.length, 100);
  let fillPrompt = '';
  const deps = { cleanText, requestStructuredJsonPayload: async (request) => {
    if (request.stage === 'notebook_draft_selection') return { ok: false };
    fillPrompt = request.userPrompt;
    return { ok: true, payload: { filled_values: [{ placeholder_key: 'p', value: 'sample A', source: 'user' }],
      missing_placeholders: [], follow_up_questions: [], result_summary: 'Ready' } };
  } };
  const runtime = createNotebookDraftRuntime({ ...deps, agentAppApi: createAgentSubAppApi(deps) });
  const result = await runtime.generateNotebookDraft({ message: 'Draft Long protocol for sample A',
    snapshot,
    project: { id: 'project', name: 'Project' }, protocolCandidates: ['Long protocol'],
    stepEdits: [{ text: 'Appended final check' }] });
  assert.ok(result.notebook);
  assert.equal(result.notebook.rendered_steps.length, 201);
  assert.equal(result.notebook.rendered_steps[199], 'Final sample A');
  assert.equal(result.notebook.proposal.planned_materials.length, 101);
  assert.match(fillPrompt, /Appended final check/);
  assert.match(fillPrompt, /Final \{\{ph:p\}\}/);
});

test('planning prompt includes expanded history and candidates at the advertised boundaries', () => {
  const { buildNotebookDraftSelectionPrompt } = createDraftSelectionPrompt({ asArray, cleanText, ensureObject: (v) => v || {} });
  const prompt = buildNotebookDraftSelectionPrompt({
    conversation: Array.from({ length: 33 }, (_, i) => ({ text: `history-marker-${i}!` })),
    notebookRuns: Array.from({ length: 61 }, (_, i) => ({ id: `run-marker-${i}!` })),
    candidates: Array.from({ length: 41 }, (_, i) => ({ id: `candidate-marker-${i}!` }))
  });
  assert.match(prompt, /history-marker-1!/);
  assert.doesNotMatch(prompt, /history-marker-0!/);
  assert.match(prompt, /run-marker-59!/);
  assert.doesNotMatch(prompt, /run-marker-60!/);
  assert.match(prompt, /candidate-marker-39!/);
  assert.doesNotMatch(prompt, /candidate-marker-40!/);
});
