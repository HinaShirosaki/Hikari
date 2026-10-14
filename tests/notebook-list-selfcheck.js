'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAgentNotebookLookupRuntime } = require('../src/main/agent/tools/agent-notebook-lookup.js');
const { createAgentLookupSupport } = require('../src/main/agent/tools/agent-lookup-support.js');
const { createAgentSubAppApi } = require('../src/main/agent/runtime/agent-sub-app-api.js');
const { createAgentRuntimeSupport } = require('../src/main/agent/runtime/agent-runtime-support.js');
const { loadEsmStyleModule } = require('./support/runtime.js');
const path = require('node:path');
const { getDirectMcpToolDefinitions, createDirectMcpToolRouter } = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const { buildHikariCodexMcpConfigBlock } = require('../src/main/agent/codex-agent/runtime-files.js');
const contract = require('../docs/agent/mcp-contract/mcp-contract.json');
const cleanText = (value, max = 20000) => String(value ?? '').trim().slice(0, max);

const entry = (id, fields = {}) => ({
  id, experimentName: `Experiment ${id}`, projectId: 'p1', projectName: 'Atlas',
  protocolId: 'protocol1', protocolName: 'Cell prep', notebookState: 'executed',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z',
  ...fields
});
const run = (notebookEntries, input = {}, deps = {}) => createAgentNotebookLookupRuntime(deps)
  .executeList({ snapshot: { notebookEntries }, ...input });
const ids = result => result.items.map(item => item.id);

test('notebook_list retrieves every page beyond lookup caps, with stable tie order and compact metadata', async () => {
  const entries = Array.from({ length: 623 }, (_, i) => entry(String(i).padStart(4, '0'), {
    result: 'private content', values: { secret: 'not needed' }, storageFolder: '/private/example',
    resultFileRecords: [{ name: 'raw.csv', path: '/private/raw.csv' }]
  })).reverse();
  const runtime = createAgentNotebookLookupRuntime({ cleanText, agentAppApi: createAgentSubAppApi({ cleanText }) });
  const snapshot = { notebookEntries: entries };
  let cursor;
  const all = [];
  do {
    const result = await runtime.executeList({ snapshot, limit: 200, ...(cursor ? { cursor } : {}) });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.pagination.total, 623);
    assert.equal(result.counts.candidates, 623);
    assert.equal(result.access.complete, true);
    assert.ok(result.items.length <= 200);
    assert.doesNotMatch(JSON.stringify(result.items), /private|secret|raw\.csv/);
    all.push(...ids(result));
    cursor = result.pagination.next_cursor;
  } while (cursor);
  assert.deepEqual(all, entries.map(item => item.id).sort());
  assert.equal(new Set(all).size, entries.length);
  assert.equal((await runtime.executeList({ snapshot })).items.length, 100);
});

test('filters apply before pagination so rare older project and workflow records remain reachable', async () => {
  const entries = Array.from({ length: 500 }, (_, i) => entry(`recent${i}`, { projectId: 'other', projectName: 'Other' }));
  entries.push(entry('old-workflow', { experimentName: 'Old Target', updatedAt: '2024-01-01T00:00:00Z',
    notebookState: 'planned', workflowContext: { workflowId: 'w1' } }));
  entries.push(entry('suggested', { notebookState: 'suggested', experimentName: 'Target suggestion' }));
  const result = await run(entries, { project_id: 'p1', project_name: 'aTlAs', protocol_id: 'protocol1',
    protocol_name: 'PREP', notebook_state: 'planned', query: 'TARGET', limit: 1 },
  { cleanText, agentAppApi: createAgentSubAppApi({ cleanText }) });
  assert.deepEqual(ids(result), ['old-workflow']);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.pagination.has_more, false);
  assert.deepEqual(ids(await run(entries, { notebook_state: 'suggested' })), ['suggested']);
  assert.deepEqual(ids(await run(entries, { project_id: 'p1', project_name: 'Other' })), []);
});

test('date-only ranges include both UTC boundaries and exclude missing or invalid selected dates', async () => {
  const entries = [
    entry('before', { executedAt: '2026-10-13T23:59:59.999Z' }),
    entry('start', { executedAt: '2026-10-14T00:00:00.000Z' }),
    entry('end', { executedAt: '2026-10-14T23:59:59.999Z' }),
    entry('after', { executedAt: '2026-10-15T00:00:00.000Z' }),
    entry('missing', { updatedAt: '' }), entry('invalid', { executedAt: '2026-02-30' })
  ];
  const result = await run(entries, { date_field: 'executed', date_from: '2026-10-14', date_to: '2026-10-14' });
  assert.deepEqual(ids(result), ['end', 'start']);
  assert.equal(result.counts.missing_dates, 2);
  assert.equal(result.scope.date_field, 'executed');
  assert.deepEqual(ids(await run(entries, { date_field: 'executed', date_from: '2026-10-15' })), ['after']);
  assert.deepEqual(ids(await run(entries, { date_field: 'executed', date_to: '2026-10-13' })), ['before']);
  const unfiltered = await run(entries, { date_field: 'executed' });
  assert.equal(unfiltered.items.length, entries.length);
  assert.deepEqual(ids(unfiltered).slice(-2), ['invalid', 'missing']);
});

test('explicit offsets support local calendar days and exact inclusive timestamp boundaries', async () => {
  const entries = [
    entry('too-early', { executedAt: '2026-10-14T04:59:59.999Z' }),
    entry('start', { executedAt: '2026-10-14T05:00:00.000Z' }),
    entry('end', { executedAt: '2026-10-15T04:59:59.999Z' }),
    entry('too-late', { executedAt: '2026-10-15T05:00:00.000Z' })
  ];
  const result = await run(entries, { date_field: 'executed',
    date_from: '2026-10-14T00:00:00-05:00', date_to: '2026-10-14T23:59:59.999-05:00' });
  assert.deepEqual(ids(result), ['end', 'start']);
  assert.deepEqual(ids(await run(entries, { date_field: 'executed',
    date_from: '2026-10-14T05:00:00Z', date_to: '2026-10-14T05:00:00Z' })), ['start']);
});

test('created, updated default and executed ranges use their selected fields and legacy timestamp aliases', async () => {
  const entries = [entry('a', { executedAt: '2026-10-10T12:00:00Z' }),
    entry('b', { createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-13T12:00:00Z' }),
    { id: 'legacy', title: 'Legacy title', created_at: '2026-10-14T01:00:00Z' }];
  const range = { date_from: '2026-10-14', date_to: '2026-10-14' };
  assert.deepEqual(ids(await run(entries, range)), ['a', 'legacy']);
  assert.deepEqual(ids(await run(entries, { ...range, date_field: 'created' })), ['b', 'legacy']);
  assert.deepEqual(ids(await run(entries, { ...range, date_field: 'executed' })), []);
});

test('stored timestamps are dated the way the notebook UI shows them', async () => {
  const entries = [
    // Microsecond fractions occur in stored records and must still parse.
    entry('micro', { notebookState: 'suggested', createdAt: '2026-09-08T14:44:54.021843Z' }),
    // Executed without executedAt: the UI shows its update time as the executed time.
    entry('updated-only', { updatedAt: '2026-03-20T16:43:07.684Z' }),
    // Planned pages have no executed time, even with a stale executedAt.
    entry('planned', { notebookState: 'planned', executedAt: '2026-03-21T10:00:00.000Z' })
  ];
  const created = await run(entries, { date_field: 'created', date_from: '2026-09-08', date_to: '2026-09-08' });
  assert.deepEqual(ids(created), ['micro']);
  assert.equal(created.counts.missing_dates, 0);
  const executed = await run(entries, { date_field: 'executed', date_from: '2026-03-20', date_to: '2026-03-23' });
  assert.deepEqual(ids(executed), ['updated-only']);
  assert.equal(executed.items[0].executed_at, '2026-03-20T16:43:07.684Z');
  assert.equal(executed.counts.missing_dates, 0, 'planned and suggested pages have no executed date to miss');
});

test('invalid inputs are rejected before storage access', async () => {
  const runtime = createAgentNotebookLookupRuntime({ buildLookupContext: async () => { throw new Error('Must not hydrate'); } });
  for (const input of [
    { date_from: '2026-02-30' }, { date_to: '2025-02-29' }, { date_from: 'October 14' },
    { date_from: '2026-10-14T12:00:00' }, { date_to: '2026-10-14T24:00:00Z' },
    { date_from: '2026-10-15', date_to: '2026-10-14' }, { date_field: 'unknown' },
    { notebook_state: 'unknown' }, { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { cursor: 'nonsense' },
    { cursor: Buffer.from('{}').toString('base64url') }
  ]) {
    const result = await runtime.executeList(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.ok(['invalid_input', 'invalid_cursor'].includes(result.status));
  }
  assert.equal((await run([], { date_from: '2024-02-29' })).ok, true);
});

test('pagination tolerates page-size changes but requires restart on metadata, filters or access changes', async () => {
  const entries = [entry('a'), entry('b'), entry('c'), entry('d')];
  const first = await run(entries, { limit: 1 });
  const cursor = first.pagination.next_cursor;
  const next = await run(entries, { limit: 200, cursor });
  assert.deepEqual(ids(next), ['b', 'c', 'd']);
  assert.equal(next.pagination.next_cursor, null);
  for (const [data, input, deps] of [
    [entries, { cursor, project_id: 'p1' }, {}],
    [[{ ...entries[0], experimentName: 'Renamed' }, ...entries.slice(1)], { cursor }, {}],
    [[...entries, entry('new')], { cursor }, {}],
    [entries.slice(1), { cursor }, {}],
    [entries, { cursor }, { buildLookupContext: async () => ({ hydratedSnapshot: { notebookEntries: entries }, warnings: ['EPERM'] }) }]
  ]) {
    const result = await run(data, input, deps);
    assert.equal(result.status, 'stale_cursor');
    assert.equal(result.ok, false);
  }
});

test('hydration enumerates persisted older pages and merges current live metadata by stable id', async () => {
  const support = createAgentLookupSupport({ cleanText, hydrateSnapshotFromBundle: async () => ({
    snapshot: { notebookEntries: [entry('a'), entry('b'), entry('older')] },
    migration: { applied: ['project_root_storage', 'notebook_markdown'], warnings: [] }
  }) });
  const runtime = createAgentNotebookLookupRuntime({ ...support, cleanText });
  const result = await runtime.executeList({ snapshot: {
    notebook_lookup_bridge: { complete: false, entries: [entry('a', { experimentName: 'Live title' })] }
  } });
  assert.deepEqual(ids(result), ['a', 'b', 'older']);
  assert.equal(result.items[0].title, 'Live title');
  assert.equal(result.access.complete, true);
  assert.equal(result.source, 'markdown');
});

test('storage errors and a bounded live index never report a complete inventory', async () => {
  for (const [warnings, entries, expected] of [
    [['EACCES: permission denied'], [entry('a')], 'partial'],
    [['EPERM'], [], 'permission_denied'],
    [['Corrupt notebook document'], [], 'partial']
  ]) {
    const result = await run(entries, {}, { buildLookupContext: async () => ({ hydratedSnapshot: { notebookEntries: entries }, warnings }) });
    assert.equal(result.status, expected);
    assert.equal(result.access.complete, false);
    if (/EPERM|EACCES/.test(warnings[0])) assert.match(result.access.user_action, /Grant Hikari access/);
  }
  const result = await createAgentNotebookLookupRuntime({ ...createAgentLookupSupport() }).executeList({
    snapshot: { notebook_lookup_bridge: { complete: false, entries: [entry('a')] } }
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.access.complete, false);
  assert.ok(result.access.warning_codes.includes('notebook_index_incomplete'));
});

test('renderer and main snapshots preserve live title metadata and explicit incomplete coverage', async () => {
  const { buildStateSnapshot } = loadEsmStyleModule(path.resolve(__dirname, '../src/renderer/modules/agent-chat/state-snapshot.js'));
  const state = { settings: {}, projects: [{ id: 'p1', name: 'Atlas' }], protocols: [], workflows: [],
    papers: [], inventory: {}, labInventory: { chemicals: [] },
    notebookEntries: Array.from({ length: 80 }, (_, i) => entry(`n${i}`)) };
  const snapshot = createAgentRuntimeSupport({ cleanText }).normalizeAgentSnapshot(buildStateSnapshot(state));
  assert.equal(snapshot.notebook_lookup_bridge.complete, false);
  assert.equal(snapshot.notebook_lookup_bridge.entries.length, 60);
  const result = await createAgentNotebookLookupRuntime({ ...createAgentLookupSupport({ cleanText }), cleanText }).executeList({ snapshot });
  assert.equal(result.status, 'partial');
  assert.equal(result.access.complete, false);
  assert.equal(result.items.length, 60);
  assert.ok(result.items.every(item => item.title.startsWith('Experiment')));
  const capped = createAgentRuntimeSupport({ cleanText }).normalizeAgentSnapshot({ notebookEntries: Array.from({ length: 200 }, (_, i) => entry(`n${i}`)) });
  assert.equal(capped.notebook_lookup_bridge.complete, false);
});

test('bounded live title summaries preserve persisted rich page content during hydration', async () => {
  const persisted = entry('a', { result: 'Complete saved notebook notes', values: { dose: '10' },
    resultTables: [{ rows: [{ signal: 1 }] }], toolCalculations: [{ title: 'Saved calculation' }] });
  const support = createAgentLookupSupport({ cleanText, hydrateSnapshotFromBundle: async () => ({
    snapshot: { notebookEntries: [persisted] }, migration: { applied: ['project_root_storage'], warnings: [] }
  }) });
  const runtime = createAgentNotebookLookupRuntime({ ...support, cleanText });
  const snapshot = { notebook_lookup_bridge: { complete: true, entries: [entry('a', {
    experimentName: 'Current title', result: 'Truncated summary', toolCalculations: [], bridgeSnapshot: true
  })] } };
  const list = await runtime.executeList({ snapshot });
  assert.equal(list.items[0].title, 'Current title');
  assert.equal(list.access.complete, true);
  const full = await runtime.execute({ snapshot, query: 'a', detail: 'full' });
  assert.equal(full.items[0].content.result, persisted.result);
  assert.deepEqual(full.items[0].content.values, persisted.values);
  assert.deepEqual(full.items[0].content.result_tables, persisted.resultTables);
  assert.deepEqual(full.items[0].content.tool_calculations, persisted.toolCalculations);
});

test('notebook_list is advertised, configurable and synchronized with the app and documentation schemas', async () => {
  const tool = getDirectMcpToolDefinitions().find(item => item.name === 'notebook_list');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(contract.mcp.tools.find(item => item.name === tool.name), tool);
  const appSchema = require('../src/main/agent/tools/Tool-call.json')['notebook-list'].input_schema;
  assert.deepEqual(appSchema, tool.inputSchema);
  const disabled = { snapshot: { settings: { agent: { disabledMcpToolNames: ['notebook_list'] } } } };
  assert.equal(getDirectMcpToolDefinitions(disabled).some(item => item.name === 'notebook_list'), false);
  const router = createDirectMcpToolRouter({ runTool: () => { throw new Error('Disabled tools must not execute'); } });
  assert.equal((await router.callTool('notebook_list', {}, disabled)).status, 'disabled');
  assert.match(buildHikariCodexMcpConfigBlock({ cwd: '/tmp/list-test' }), /"notebook_list"/);
});
