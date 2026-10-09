'use strict';

// The actual MCP server, registered app executors and Markdown storage, with
// synthetic data. --http also exercises a child stdio process and app callback
// host over loopback; the default transport needs no listening permission.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createAgentMcpStdioServer } = require('../src/main/agent/mcp-contract/stdio-server');
const { createAgentMcpHost } = require('../src/main/agent/mcp-contract/host');
const { createAgentToolCallRuntime } = require('../src/main/agent/tools/agent-tool-execution');
const { registerAgentToolExecutors } = require('../src/main/agent/tools/register-agent-tool-executors');
const { createAgentLookupSupport } = require('../src/main/agent/tools/agent-lookup-support');
const { createAgentNotebookLookupRuntime } = require('../src/main/agent/tools/agent-notebook-lookup');
const { createProtocolMatchingRuntime } = require('../src/main/agent/tools/agent-protocol-matching');
const { createProtocolGenerationRuntime } = require('../src/main/agent/tools/agent-protocol-generation');
const { createProtocolSaveRuntime } = require('../src/main/agent/tools/agent-protocol-save');
const { createNotebookDraftRuntime } = require('../src/main/agent/tools/agent-notebook-draft');
const { createAgentSubAppApi } = require('../src/main/agent/runtime/agent-sub-app-api');
const { hydrateSnapshotFromBundle } = require('../src/main/storage/storage-hydration');
const { syncBundleFromSnapshot } = require('../src/main/storage/storage-sidecars');
const { rebuildRecordMarkdown } = require('../src/main/storage/record-markdown/rebuild');
const { readRecordDocument } = require('../src/main/storage/record-markdown/document-storage');
const { block, blocks } = require('../src/main/storage/record-markdown/document-fields');

const httpMode = process.argv.includes('--http');
const cleanText = (value, limit = 20000) => String(value ?? '').trim().slice(0, limit);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1cAAAAASUVORK5CYII=';
const load = async root => (await hydrateSnapshotFromBundle({ snapshot: { settings: { storagePath: root } } })).snapshot;

function legacySnapshot(root) {
  const protocol = { id: 'p1', name: 'MCP migration assay', purpose: 'Original purpose', materials: ['PBS'],
    steps: [{ id: 'step-1', text: 'Add {{ph:volume}} to {{ph:sample}}.', placeholders: [
      { id: 'volume', name: 'Volume' }, { id: 'sample', name: 'Sample' }
    ] }], aliases: ['Migration QA'], customField: { provenance: 'Preserve this producer field' } };
  const entry = { id: 'n1', experimentName: 'Migrated observation', projectId: 'proj', projectName: 'Migration project',
    protocolId: 'p1', protocolName: protocol.name, protocolSnapshot: structuredClone(protocol),
    notebookState: 'executed', updatedAt: '2026-10-08T12:00:00.000Z', result: 'Original result αβγ',
    values: { volume: '10 µL', sample: 'QA-1', zero: 0, empty: '' },
    resultTables: [{ columns: [{ field: 'signal', title: 'Signal' }], rows: [{ signal: 0 }, { signal: '=SUM(A1:A1)' }] }],
    toolCalculations: [{ id: 'buffer', title: 'Buffer Preparer', inputs: { pH: 7.4, volume: 100 },
      table: { headers: ['Chemical', 'Volume'], rows: [['NaCl', '3 mL']], footerRows: [['Water', '97 mL']] } }],
    sampleLinks: [{ sampleId: 's1', sampleName: 'QA-1', placeholderId: 'sample' }], assayIds: ['a1'], gelIds: ['g1'],
    resultFileRecords: [{ name: 'raw.csv', relativePath: 'raw.csv', size: 12, path: '/private/not-for-agent', dataUrl: png }],
    illustration: png, provenance: { futureField: false } };
  return { settings: { storagePath: root }, protocols: [protocol],
    projects: [{ id: 'proj', name: 'Migration project' }, { id: 'other', name: 'Other project' }],
    notebookEntries: [entry,
      { ...structuredClone(entry), id: 'n2', experimentName: 'Workflow plan', notebookState: 'planned',
        workflowContext: { workflowId: 'w1', templateId: 't1', blockId: 'b1' } },
      { ...structuredClone(entry), id: 'n3', experimentName: 'Other observation', projectId: 'other', projectName: 'Other project' }],
    workflowTemplates: [{ id: 't1', name: 'QA template', blocks: [{ id: 'b1', protocolId: 'p1' }], links: [] }],
    workflows: [{ id: 'w1', name: 'QA run', templateId: 't1', projectId: 'proj', projectName: 'Migration project',
      notebookEntryIds: ['n2'], blocks: [{ id: 'b1', protocolId: 'p1', notebookEntryIds: ['n2'] }], links: [] }],
    samples: [{ id: 's1', name: 'QA-1' }], assays: [{ id: 'a1', name: 'Linked assay' }], gelAnalyses: [{ id: 'g1', name: 'Linked gel' }] };
}

async function inventory(root) {
  const output = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) output.push([path.relative(root, file), (await fs.stat(file)).mtimeMs, (await fs.readFile(file)).toString('base64')]);
    }
  }
  await walk(root);
  return output.sort((a, b) => a[0].localeCompare(b[0]));
}

async function edit(file, field, body) {
  const source = await fs.readFile(file, 'utf8');
  assert.ok(blocks(source).has(field), `Missing ${field} block`);
  await fs.writeFile(file, source.replace(blocks(source).get(field).source, () => block('field', field, body)));
}

async function fixture(work, requestContext = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari md mcp-'));
  let server, host, client;
  let stderr = '';
  try {
    const original = legacySnapshot(root);
    await fs.writeFile(path.join(root, 'raw.csv'), 'signal\n0\n');
    const input = path.join(root, 'legacy.json');
    await fs.writeFile(input, JSON.stringify(original));
    const migration = await rebuildRecordMarkdown(input, { migrate: true });
    assert.deepEqual([migration.protocols, migration.notebooks], [1, 3]);
    // Force fresh reads to obtain records from Markdown alone.
    await fs.unlink(input);
    const protocolFile = migration.markdownPaths.find(file => file.endsWith('protocol.md'));
    const pageFiles = {};
    for (const file of migration.markdownPaths.filter(file => file.endsWith('page.md'))) {
      pageFiles[(await readRecordDocument(file, 'notebook')).data.notebookEntry.id] = file;
    }
    for (const file of migration.markdownPaths) await assert.rejects(fs.stat(file.replace(/\.md$/, '.json')), { code: 'ENOENT' });

    const runtimeDeps = { cleanText, requestStructuredJsonPayload: async () => ({ ok: false, error: 'No LLM in this storage test.' }) };
    const agentAppApi = createAgentSubAppApi(runtimeDeps);
    const protocolGenerationRuntime = createProtocolGenerationRuntime(runtimeDeps);
    const getDefaultDataFilePath = () => path.join(root, 'runtime-context.json');
    const protocolSaveRuntime = createProtocolSaveRuntime({ hydrateSnapshotFromBundle, syncBundleFromSnapshot, protocolGenerationRuntime, getDefaultDataFilePath });
    const runtime = createAgentToolCallRuntime();
    registerAgentToolExecutors({ genericAgentToolRuntime: runtime, cleanText, hydrateSnapshotFromBundle, getDefaultDataFilePath,
      agentAppApi, protocolGenerationRuntime, protocolSaveRuntime,
      notebookLookupRuntime: createAgentNotebookLookupRuntime({ ...createAgentLookupSupport({ cleanText, hydrateSnapshotFromBundle }), agentAppApi }),
      protocolMatchingRuntime: createProtocolMatchingRuntime(runtimeDeps),
      notebookDraftRuntime: createNotebookDraftRuntime({ ...runtimeDeps, agentAppApi }) });
    const runTool = (toolId, args, snapshot, context) => runtime.executeToolCall({ tool_name: toolId, arguments: args }, { ...context, snapshot });
    const stale = { ...structuredClone(original), protocols: [{ ...original.protocols[0], purpose: 'Stale request purpose' }] };
    const env = { HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({ ...requestContext, snapshot: stale, cwd: root }) };
    client = new Client({ name: 'record-markdown-mcp-check', version: '1' });
    if (httpMode) {
      host = createAgentMcpHost({ env, runTool });
      await host.ensureStarted();
      const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HIKARI_')));
      const transport = new StdioClientTransport({ command: process.execPath,
        args: [path.resolve(__dirname, '../src/main/agent/mcp-contract/stdio-server.js')],
        env: { ...childEnv, ...env }, stderr: 'pipe' });
      transport.stderr?.on('data', chunk => { stderr += chunk; });
      await client.connect(transport);
    } else {
      server = createAgentMcpStdioServer({ env, runTool });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    }
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      const payload = JSON.parse(response.content[0].text);
      if (name === 'notebook_draft') assert.equal(response.structuredContent, undefined);
      else assert.deepEqual(payload, response.structuredContent);
      assert.equal(response.isError, payload.ok === false);
      return payload;
    };
    await work({ root, original, protocolFile, pageFiles, call, client, runtime, protocolSaveRuntime });
    assert.equal(stderr, '');
  } finally {
    if (client) await client.close();
    if (server) await server.close();
    if (host) await host.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('MCP advertises protocol and notebook contracts after Markdown migration', async () => fixture(async ({ client }) => {
  const { tools } = await client.listTools();
  for (const name of ['protocol_lookup', 'protocol_generation', 'notebook_lookup', 'notebook_draft', 'notebook_append']) {
    assert.ok(tools.some(tool => tool.name === name), name);
  }
  for (const name of ['protocol_lookup', 'notebook_lookup', 'notebook_draft', 'notebook_append']) {
    assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, true);
  }
}));

test('MCP lookup reads external Markdown and rich typed data, without touching files', async () => fixture(async ({ root, original, pageFiles, call }) => {
  const resultText = 'Externally edited αβγ result with literal $& and `code`.';
  await edit(pageFiles.n1, 'result', `## Notes and results\n\n${resultText}`);
  const before = await inventory(root);
  const result = await call('notebook_lookup', { query: 'Externally edited', detail: 'full' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.source, 'markdown');
  assert.equal(result.access.complete, true);
  assert.deepEqual(result.items.map(item => item.id), ['n1']);
  const content = result.items[0].content;
  assert.equal(content.result, resultText);
  assert.deepEqual(content.values, original.notebookEntries[0].values);
  assert.deepEqual(content.result_tables, original.notebookEntries[0].resultTables);
  assert.deepEqual(content.tool_calculations, original.notebookEntries[0].toolCalculations);
  assert.deepEqual(content.sample_links, original.notebookEntries[0].sampleLinks);
  assert.equal(content.protocol_snapshot.purpose, 'Original purpose');
  assert.deepEqual(content.result_files, [{ name: 'raw.csv', relative_path: 'raw.csv', size: 12, imported_at: '' }]);
  assert.doesNotMatch(JSON.stringify(content), /not-for-agent|data:image|base64,/);
  const stored = (await readRecordDocument(pageFiles.n1, 'notebook')).data.notebookEntry;
  for (const key of ['assayIds', 'gelIds', 'provenance', 'illustration']) assert.deepEqual(stored[key], original.notebookEntries[0][key]);
  assert.deepEqual(await inventory(root), before);
}));

test('MCP notebook text search still narrows results when a project or protocol filter is supplied', async () => fixture(async ({ pageFiles, call }) => {
  await edit(pageFiles.n1, 'result', '## Notes and results\n\nObservation scopedneedle987654.');
  const matches = [];
  for (const filter of [{ project_name: 'Migration project' }, { protocol_name: 'MCP migration assay' }]) {
    const result = await call('notebook_lookup', { query: 'scopedneedle987654', ...filter, detail: 'full' });
    assert.equal(result.ok, true, result.error);
    matches.push(result.items.map(item => item.id).sort());
  }
  assert.deepEqual(matches, [['n1'], ['n1']], 'Text query must apply alongside both project and protocol filters');
}));

test('MCP notebook lookup discovers a migrated page by its experiment title', async () => fixture(async ({ call }) => {
  for (const filter of [{}, { project_name: 'Migration project' }, { protocol_name: 'MCP migration assay' }]) {
    const result = await call('notebook_lookup', { query: 'Migrated', ...filter, detail: 'full' });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.items.map(item => item.id), ['n1']);
  }
}));

test('MCP filter-only notebook lookup ignores unrelated chat text', async () => fixture(async ({ call }) => {
  const result = await call('notebook_lookup', { project_name: 'Migration project', notebook_state: 'planned' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.query || '', '');
  assert.deepEqual(result.items.map(item => item.id), ['n2']);
}, { message: 'unrelatedcontextneedle987654' }));

test('MCP notebook filters include migrated project and workflow pages with limits and summaries', async () => fixture(async ({ root, pageFiles, call }) => {
  assert.match(pageFiles.n2, /[/\\]Workflow[/\\]/);
  const before = await inventory(root);
  for (const [args, ids] of [
    [{ project_name: 'Migration project', detail: 'full' }, ['n1', 'n2']],
    [{ notebook_state: 'planned', detail: 'full' }, ['n2']],
    [{ project_name: 'Other project' }, ['n3']],
    [{ project_name: 'Migration project', notebook_state: 'executed' }, ['n1']],
    [{ query: 'absentneedle987654' }, []]
  ]) {
    const result = await call('notebook_lookup', args);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.items.map(item => item.id).sort(), ids);
    assert.equal(result.access.complete, true);
  }
  const limited = await call('notebook_lookup', { protocol_name: 'MCP migration assay', limit: 1, detail: 'summary' });
  assert.equal(limited.items.length, 1);
  assert.equal(limited.items[0].content, undefined);
  assert.equal((await call('notebook_lookup', {})).status, 'invalid_input');
  assert.deepEqual(await inventory(root), before);
}));

test('MCP protocol lookup and notebook drafts consume edited Markdown and preserve frozen snapshots', async () => fixture(async ({ root, protocolFile, pageFiles, call }) => {
  await edit(protocolFile, 'purpose', '## Purpose\n\nPurpose authored in Markdown.');
  await edit(protocolFile, 'steps', '## Steps\n\n<!-- hikari-step:0 -->\n1. Slowly add [Volume] to [Sample].');
  const before = await inventory(root);
  const found = await call('protocol_lookup', { query: 'MCP migration assay' });
  assert.equal(found.ok, true, found.error);
  assert.equal(found.selected_protocol.purpose, 'Purpose authored in Markdown.');
  assert.equal(found.selected_protocol.steps[0].text, 'Slowly add {{ph:volume}} to {{ph:sample}}.');
  const draft = await call('notebook_draft', { project_name: 'Migration project', protocol_candidates: ['MCP migration assay'],
    pending_values: { volume: '20 µL', sample: 'QA-2' }, title: 'Reviewable planned page',
    step_edits: [{ step_number: 1, text: 'Gently add {{ph:volume}} to {{ph:sample}}.' }] });
  assert.equal(draft.ok, true, draft.error);
  assert.equal(draft.status, 'proposal_ready');
  assert.deepEqual(draft.missing_placeholders || [], []);
  assert.equal(draft.notebook.entry_template.experimentName, 'Reviewable planned page');
  assert.equal(draft.notebook.entry_template.values.volume, '20 µL');
  assert.match(draft.notebook.rendered_steps[0], /Gently add 20 µL to QA-2/);
  assert.equal(draft.notebook.save.applied, false);
  assert.equal(draft.notebook.save.mode, 'confirm_before_save');
  assert.equal((await readRecordDocument(pageFiles.n1, 'notebook')).data.notebookEntry.protocolSnapshot.purpose, 'Original purpose');
  assert.deepEqual(await inventory(root), before);
}));

test('MCP generation queues approval, and approved protocol persistence creates only Markdown records', async () => fixture(async ({ root, call, protocolSaveRuntime }) => {
  const before = await inventory(root);
  const input = { name: 'Generated migration QA', purpose: 'Synthetic test only', materials: ['Water'],
    steps: ['Add [Volume] of water.'], customField: { provenance: 'Generated test source' } };
  const result = await call('protocol_generation', { protocol: input, save: true });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.status, 'awaiting_user_approval');
  assert.equal(result.requires_user_approval, true);
  assert.ok(result.protocol.steps[0].placeholders[0].id);
  assert.deepEqual(await inventory(root), before);
  // Exercise the app's approval continuation against synthetic storage only.
  const saved = await protocolSaveRuntime.saveProtocol({ protocol: result.protocol }, { snapshot: { settings: { storagePath: root } } });
  assert.equal(saved.ok, true, saved.error);
  const file = saved.sidecar_paths.protocolFilePaths.find(file => file.includes('Generated_migration_QA'));
  assert.ok(file.endsWith('protocol.md'));
  await assert.rejects(fs.stat(file.replace(/\.md$/, '.json')), { code: 'ENOENT' });
  const found = await call('protocol_lookup', { query: 'Generated migration QA' });
  assert.equal(found.selected_protocol.id, saved.protocol.id);
  assert.deepEqual(found.selected_protocol.steps, saved.protocol.steps);
}));

test('an approved MCP notebook draft persists through the real renderer adapter and reloads without duplicates', async () => fixture(async ({ root, call }) => {
  const state = await load(root);
  const before = await inventory(root);
  const result = await call('notebook_draft', { project_name: 'Migration project', protocol_candidates: ['MCP migration assay'],
    pending_values: { volume: '25 µL', sample: 'newdraftneedle987' }, title: 'Approved MCP page' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(await inventory(root), before);
  const { createPlannedNotebookPage } = await import(pathToFileURL(path.resolve(__dirname, '../src/renderer/modules/biology-notebook/agent/notebook-drafts.js')).href);
  const accepted = createPlannedNotebookPage(result.notebook, 'Synthetic approval', { state, createId: () => 'n4' });
  assert.equal(accepted.created, true);
  const saved = await syncBundleFromSnapshot({ snapshot: state });
  assert.deepEqual(saved.sidecarPaths.skippedRecords, []);
  const file = saved.sidecarPaths.notebookPageFolderPaths.find(file => file.includes('__n4'));
  assert.ok(file.endsWith('page.md'));
  await assert.rejects(fs.stat(file.replace(/\.md$/, '.json')), { code: 'ENOENT' });
  const reloaded = await load(root);
  const entry = reloaded.notebookEntries.find(item => item.id === 'n4');
  assert.equal(entry.experimentName, 'Approved MCP page');
  assert.equal(entry.notebookState, 'planned');
  assert.deepEqual(entry.values, { volume: '25 µL', sample: 'newdraftneedle987' });
  assert.deepEqual(entry.protocolSnapshot.steps, accepted.entry.protocolSnapshot.steps);
  const after = await inventory(root);
  const repeated = createPlannedNotebookPage(result.notebook, 'Repeated synthetic approval', { state: reloaded });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, false);
  assert.equal(reloaded.notebookEntries.length, 4);
  const found = await call('notebook_lookup', { query: 'newdraftneedle987', detail: 'full' });
  assert.deepEqual(found.items.map(item => item.id), ['n4']);
  assert.deepEqual(await inventory(root), after);
}));

test('MCP drafts retain missing placeholder keys after Markdown migration', async () => fixture(async ({ root, call }) => {
  const before = await inventory(root);
  const result = await call('notebook_draft', { project_name: 'Migration project', protocol_candidates: ['MCP migration assay'],
    pending_values: { Volume: '25 µL', Sample: 'QA-3' } });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.missing_placeholders.map(item => item.placeholder_key).sort(), ['sample', 'volume']);
  assert.deepEqual(result.notebook.entry_template.values, {});
  assert.equal(result.notebook.save.applied, false);
  assert.deepEqual(await inventory(root), before);
}));

test('MCP append proposal, real approval adapter, reload, duplicate and stale guards preserve rich data', async () => fixture(async ({ root, original, pageFiles, call }) => {
  const state = await load(root);
  const entry = state.notebookEntries.find(item => item.id === 'n1');
  const before = await inventory(root);
  const target = { notebook_entry_id: entry.id, page_title: entry.experimentName, project_name: entry.projectName,
    protocol_name: entry.protocolName, expected_updated_at: entry.updatedAt, content_markdown: 'New synthetic QA observation.' };
  const result = await call('notebook_append', target);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.save.applied, false);
  assert.deepEqual(await inventory(root), before);
  const { createSavedNotebookAppend } = await import(pathToFileURL(path.resolve(__dirname, '../src/renderer/modules/biology-notebook/agent/saved-append.js')).href);
  const { syncMarkdownRecordState } = await import(pathToFileURL(path.resolve(__dirname, '../src/renderer/services/markdown-record-storage.js')).href);
  const apply = createSavedNotebookAppend({ state, persist: async () => {
    const saved = await syncMarkdownRecordState({ autoSaveDataFile: snapshot => syncBundleFromSnapshot({ snapshot }).then(result => ({ ok: true, ...result })) }, state);
    assert.equal(saved.ok, true, saved.error);
  } });
  assert.equal((await apply(result.proposal)).saved, true);
  const stored = (await readRecordDocument(pageFiles.n1, 'notebook')).data.notebookEntry;
  assert.match(stored.result, /Original result αβγ[\s\S]*New synthetic QA observation/);
  for (const key of ['values', 'resultTables', 'toolCalculations', 'sampleLinks', 'protocolSnapshot', 'assayIds', 'gelIds', 'provenance', 'illustration']) {
    assert.deepEqual(stored[key], original.notebookEntries[0][key], key);
  }
  const after = await inventory(root);
  assert.equal((await apply(result.proposal)).ok, true);
  assert.deepEqual(await inventory(root), after);
  const stale = await call('notebook_append', { ...target, content_markdown: 'Stale content must not reach disk.' });
  assert.equal((await apply(stale.proposal)).ok, false);
  assert.deepEqual(await inventory(root), after);
  const found = await call('notebook_lookup', { query: 'New synthetic QA observation', detail: 'full' });
  assert.equal(found.items[0].content.result, stored.result);
}));

test('MCP reports damaged notebook metadata as incomplete evidence without overwriting it', async () => fixture(async ({ root, pageFiles, call }) => {
  const source = await fs.readFile(pageFiles.n1, 'utf8');
  await fs.writeFile(pageFiles.n1, source.replace('<!-- hikari-record:v2', '<!-- hikari-record:v999'));
  const before = await inventory(root);
  const result = await call('notebook_lookup', { project_name: 'Migration project', notebook_state: 'executed', detail: 'full' });
  assert.equal(result.access.complete, false);
  assert.equal(result.status, 'partial');
  assert.ok(result.access.warning_codes.includes('storage_read_warning'));
  // The request snapshot may supply recovery content; it must remain partial.
  assert.ok(result.items.every(item => item.project_id === 'proj' && item.notebook_state === 'executed'));
  assert.deepEqual(await inventory(root), before);
}));
