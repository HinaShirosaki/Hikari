const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway.js');
const { getDirectMcpToolDefinitions } = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const { createNotebookDraftRuntime } = require('../src/main/agent/tools/agent-notebook-draft.js');
const { createCodexAgentRuntime } = require('../src/main/agent/codex-agent/runtime.js');
const { createNotebookSuggestionService } = require('../src/main/core/services/create-notebook-suggestion-service.js');
const { HIKARI_MCP_TOOL_NAMES } = require('../src/main/agent/mcp-contract/instructions.js');
const { createAgentRuntimeSupport } = require('../src/main/agent/runtime/agent-runtime-support.js');
const { registerAgentToolExecutors } = require('../src/main/agent/tools/register-agent-tool-executors.js');
const esm = file => loadEsmStyleModule(path.join(__dirname, '../src/renderer/', file));

async function run() {
  const snapshot = {
    settings: {}, projects: [{ id: 'p', name: 'Project', description: 'Compare growth conditions.' }],
    protocols: [{ id: 'prot', name: 'Measure growth', steps: [{ id: 'step', text: 'Measure the control.', placeholders: [] }] }],
    notebookEntries: [{ id: 'done', projectId: 'p', protocolName: 'Previous experiment', notebookType: 'biology', notebookState: 'executed', updatedAt: '2026-09-08', result: 'Control measurement recorded.' }]
  };
  const draftRuntime = createNotebookDraftRuntime({ requestStructuredJsonPayload: async () => ({ ok: false }) });
  let draftCalls = 0;
  const gateway = createAgentMcpGateway({
    runTool: async (tool, args, source, context) => {
      draftCalls++;
      assert.equal(tool, 'notebook-draft');
      return draftRuntime.generateNotebookDraft({
        snapshot: source, project: args.project, protocolCandidates: args.protocol_candidates,
        stepEdits: args.step_edits, pendingValues: args.pending_values, message: context.message
      });
    }
  });
  assert.ok(HIKARI_MCP_TOOL_NAMES.includes('notebook_suggest'), 'CLI configuration permits the conditional tool');
  assert.ok(!getDirectMcpToolDefinitions().some(tool => tool.name === 'notebook_suggest'));
  assert.equal((await gateway.callGatewayTool('notebook_suggest', {}, {})).ok, false);
  assert.equal(draftCalls, 0, 'Ordinary chat cannot invoke the suggestion executor');

  let requestContext, workspaceSyncCalls = 0;
  const runtime = createCodexAgentRuntime({
    prepareProjectWorkspace: async () => { workspaceSyncCalls++; return ''; },
    requestCodexAgentText: async input => {
      requestContext = JSON.parse(input.envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT);
      assert.equal(input.enableWebSearch, false);
      assert.match(input.prompt, /Do not download/);
      const tools = getDirectMcpToolDefinitions(requestContext).map(tool => tool.name);
      assert.deepEqual(tools.sort(), ['chemical_lookup', 'inventory_lookup', 'literature_search', 'notebook_lookup', 'notebook_suggest', 'protocol_lookup']);
      for (const blocked of ['paper_download', 'notebook_draft', 'protocol_generation', 'ask_user', 'sequence_feature_edit']) {
        assert.equal((await gateway.callGatewayTool(blocked, {}, requestContext)).status, 'rejected');
      }
      const result = await gateway.callGatewayTool('notebook_suggest', {
        project_name: 'Wrong project', protocol_candidates: ['Measure growth'], title: 'Compare the next condition',
        rationale: 'The prior control is recorded; compare the next condition.',
        step_edits: [{ step_number: 1, text: 'Measure the next condition alongside the control.' }]
      }, requestContext);
      assert.equal(result.ok, true);
      assert.equal(result.notebook.entry_template.projectId, 'p');
      assert.equal(result.notebook.entry_template.projectName, 'Project');
      assert.equal(result.notebook.entry_template.protocolSnapshot.steps[0].text, 'Measure the next condition alongside the control.');
      assert.equal(snapshot.protocols[0].steps[0].text, 'Measure the control.', 'Source protocol is unchanged');
      input.onStream({ type: 'codex_tool_call', tool_name: 'notebook_suggest', status: 'completed', tool_result: result });
      return { text: 'Suggested experiment prepared.' };
    }
  });
  const service = createNotebookSuggestionService({ codexAgentRuntime: runtime });
  const response = await service.suggest({ projectId: 'p', snapshot });
  assert.equal(response.ok, true, response.error);
  assert.equal(workspaceSyncCalls, 0, 'A background request never synchronizes its partial snapshot into storage');

  const normalized = createAgentRuntimeSupport({}).normalizeAgentSnapshot(requestContext.snapshot);
  assert.equal(normalized.scheduled_task.deny_paper_download, true);
  const executors = new Map();
  let downloads = 0;
  registerAgentToolExecutors({
    genericAgentToolRuntime: { registerToolExecutor: (name, handler) => executors.set(name, handler) },
    paperDownloadRuntime: { downloadPaper: async () => { downloads++; } }
  });
  const denied = await executors.get('paper-download')({ args: {}, context: { snapshot: normalized } });
  assert.equal(denied.ok, false);
  assert.equal(downloads, 0, 'Paper downloads also fail at the executor boundary');

  const { createLiteratureSearchWorkflowRuntime } = require('../src/main/papers/workflow/agent-literature-search-workflow.js');
  const unexpected = () => { throw new Error('Suggestion lookup attempted PDF acquisition or delegated reading'); };
  const literature = createLiteratureSearchWorkflowRuntime({
    literatureSearchRuntime: { searchLiteratureCandidates: async () => ({ ok: true, items: [{ title: 'Growth conditions', doi: '10.example/condition', summary: 'Abstract metadata.' }] }) },
    paperDownloadRuntime: { downloadPaper: unexpected },
    paperContextLoaderRuntime: { loadPaperContext: unexpected },
    createSubAgentRuntime: unexpected,
    subAgentRuntime: { createSubAgent: unexpected, runSubAgentTask: unexpected }
  });
  const metadata = await literature.execute({ query: 'Growth conditions', snapshot: normalized, download_selected_papers: true });
  assert.equal(metadata.ok, true);
  assert.equal(metadata.selected_papers[0].download_status, 'not_requested');
  assert.equal(metadata.downloaded_papers.length, 0);
  assert.equal(metadata.papers_read_count, 0);

  const { createExperimentSuggestions } = esm('modules/biology-notebook/project/experiment-suggestions.js');
  const { normalizeNotebookState, resolveEntryExecutedAt } = esm('modules/biology-notebook/entry/entry-helpers.js');
  let calls = 0, persisted = '', activeId = '', opened = '';
  const state = JSON.parse(JSON.stringify(snapshot));
  const controller = createExperimentSuggestions({
    state, createId: () => 'suggestion', persist: () => { persisted = JSON.stringify(state); },
    api: { suggestNextExperiment: async () => { calls++; return response; } },
    getActiveEntry: () => state.notebookEntries.find(entry => entry.id === activeId),
    saveEntry: async () => state.notebookEntries.find(entry => entry.id === activeId),
    editEntry: id => { opened = id; },
    onEntriesChanged: () => {}
  });
  const entry = await controller.suggest('p', { automatic: true });
  assert.equal(entry.notebookState, 'suggested');
  assert.equal(entry.executedAt, '');
  assert.equal(entry.experimentName, 'Compare the next condition');
  assert.equal(resolveEntryExecutedAt(entry), '');
  assert.equal(normalizeNotebookState('suggested'), 'suggested');
  assert.equal(JSON.parse(persisted).notebookEntries[1].notebookState, 'suggested');
  await controller.suggest('p', { automatic: true });
  assert.equal(calls, 1, 'Automatic repeats reuse an unaccepted suggestion');
  await controller.suggest('p');
  assert.equal(opened, 'suggestion', 'Manual trigger opens a pending suggestion');
  activeId = entry.id;
  const planned = await controller.takeIntoPlan();
  assert.equal(planned.id, entry.id);
  assert.equal(planned.notebookState, 'planned');
  assert.equal(planned.executedAt, '');
  assert.ok(planned.agentDraftMeta.acceptedAt);
  assert.equal(JSON.parse(persisted).notebookEntries[1].notebookState, 'planned');
  assert.equal(state.notebookEntries.length, 2, 'Accepting changes the existing entry');
  assert.equal(await controller.takeIntoPlan(), null, 'Acceptance is idempotent');

  // Batch artifacts travel through the same stream envelope, including an explicit empty batch.
  const { extractNotebookDraftArtifactFromToolEvent } = require('../src/main/agent/codex-agent/artifacts.js');
  let batchSize = 5;
  const batchService = createNotebookSuggestionService({ codexAgentRuntime: { run: async request => {
    const context = { ...requestContext, snapshot: request.snapshot };
    const result = await gateway.callGatewayTool('notebook_suggest', { suggestions: Array.from({length: batchSize}, (_, i) => ({
      protocol_candidates: ['Measure growth'], title: 'Follow-up ' + i, rationale: 'Evidence for follow-up ' + i
    })) }, context);
    const artifact = extractNotebookDraftArtifactFromToolEvent({tool_name:'notebook_suggest', status:'completed', tool_result:result});
    return {ok:true, notebook_draft:artifact};
  } } });
  const five = await batchService.suggest({projectId:'p', snapshot});
  assert.equal(five.ok, true);
  assert.equal(five.notebooks.length, 5);
  batchSize = 0;
  const zero = await batchService.suggest({projectId:'p', snapshot});
  assert.equal(zero.ok, true);
  assert.deepEqual(zero.notebooks, []);
  batchSize = 6;
  assert.equal((await batchService.suggest({projectId:'p', snapshot})).ok, false);
  const batchState = JSON.parse(JSON.stringify(snapshot));
  let batchCalls = 0, nextBatch = zero, sequence = 0, savedBatch;
  const makeController = () => createExperimentSuggestions({state:batchState, createId:()=> 'batch-' + ++sequence,
    persist:()=>{savedBatch=JSON.parse(JSON.stringify(batchState));},
    api:{suggestNextExperiment:async()=>{batchCalls++;return nextBatch;}}
  });
  let batchController = makeController();
  await batchController.suggest('p');
  assert.equal(batchState.notebookEntries.length, 1, 'Zero creates no notebook pages');
  assert.ok(savedBatch.settings.notebookSuggestionPauses.p);
  batchState.settings = savedBatch.settings;
  batchController = makeController();
  await batchController.suggest('p');
  await batchController.suggest('p', {automatic:true,completedEntry:batchState.notebookEntries[0]});
  assert.equal(batchCalls,1,'Pause survives controller reload and blocks manual retry and old experiment completion');
  const agentEntry={id:'accepted-agent',projectId:'p',notebookState:'executed',agentDraftMeta:{source:'agent_notebook_suggestion_v1'}};
  batchState.notebookEntries.push(agentEntry);
  await batchController.suggest('p',{automatic:true,completedEntry:agentEntry});
  assert.equal(batchCalls,1,'Finishing an agent suggestion does not release the pause');
  const manualEntry={id:'new-manual',projectId:'p',notebookState:'planned'};
  batchState.notebookEntries.push(manualEntry);
  await batchController.suggest('p',{automatic:true,completedEntry:manualEntry});
  assert.equal(batchCalls,1,'A new manual experiment must be finished');
  manualEntry.notebookState='executed';
  nextBatch=five;
  await batchController.suggest('p',{automatic:true,completedEntry:manualEntry});
  assert.equal(batchCalls,2);
  assert.equal(batchState.notebookEntries.filter(e=>e.notebookState==='suggested').length,5);
  assert.equal(batchState.settings.notebookSuggestionPauses.p,undefined);
  assert.equal(new Set(batchState.notebookEntries.map(e=>e.id)).size,batchState.notebookEntries.length);
  const { normalizeState } = esm('modules/app-state/state-normalizer.js');
  // Pause metadata is part of normalized settings, rather than ephemeral UI state.
  assert.deepEqual(normalizeState({settings:{notebookSuggestionPauses:{p:{entryIds:['done']}}}}).settings.notebookSuggestionPauses, {p:{entryIds:['done']}});
  const rollbackState=JSON.parse(JSON.stringify(snapshot));
  const rollbackController=createExperimentSuggestions({state:rollbackState,createId:()=> 'rollback-' + ++sequence,
    persist:()=>{throw new Error('Disk full');},api:{suggestNextExperiment:async()=>five}});
  await rollbackController.suggest('p');
  assert.equal(rollbackState.notebookEntries.length,1,'An entire batch rolls back on save failure');
  const zeroFailure=createExperimentSuggestions({state:rollbackState,createId:()=> 'unused',
    persist:()=>{throw new Error('Disk full');},api:{suggestNextExperiment:async()=>zero}});
  await zeroFailure.suggest('p');
  assert.equal(rollbackState.settings.notebookSuggestionPauses.p,undefined,'A failed save cannot leave the project paused');

  const { syncBundleFromSnapshot, hydrateSnapshotFromBundle } = require('../src/main/storage/index.js');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-suggestion-roundtrip-'));
  try {
    const dataFilePath = path.join(temp, 'state.json');
    const bundle = { ...snapshot, settings: { storagePath: temp }, notebookEntries: [entry] };
    await syncBundleFromSnapshot({ dataFilePath, snapshot: bundle });
    const restored = await hydrateSnapshotFromBundle({ dataFilePath, snapshot: { settings: { storagePath: temp }, notebookEntries: [] } });
    const recovered = restored.snapshot.notebookEntries.find(item => item.id === entry.id);
    assert.equal(recovered.notebookState, 'suggested');
    assert.equal(recovered.executedAt, '');
    assert.equal(recovered.protocolSnapshot.steps[0].text, entry.protocolSnapshot.steps[0].text);
    assert.equal(recovered.agentDraftMeta.suggestionRunId, entry.agentDraftMeta.suggestionRunId);
    const memory = await fs.readFile(path.join(temp, 'Project', 'Project', 'MEMORY.md'), 'utf8');
    assert.ok(!memory.includes('Compare the next condition'), 'Suggested rationale is not an experimental conclusion');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }

  let release;
  const busyService = createNotebookSuggestionService({ codexAgentRuntime: { run: () => new Promise(resolve => { release = resolve; }) } });
  const pending = busyService.suggest({ projectId: 'p', snapshot });
  assert.equal((await busyService.suggest({ projectId: 'p', snapshot })).ok, false);
  release({ ok: false, error: 'Fixture failure' });
  assert.equal((await pending).ok, false);
  const failedController = createExperimentSuggestions({
    state: { ...snapshot, notebookEntries: [] }, createId: () => 'failed', persist: () => { throw new Error('Disk full'); },
    api: { suggestNextExperiment: async () => response }
  });
  assert.equal(await failedController.suggest('p'), null, 'Save failures do not report success');
  console.log('Notebook experiment suggestions passed: scoped MCP and executor policy, Codex streamed artifact, copied protocol edits, project binding, persistence, acceptance, deduplication, concurrency and failures.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
