'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createAgentMcpHost } = require('../src/main/agent/mcp-contract/host.js');
const { createAgentMcpStdioServer, buildMcpToolResponseContent } = require('../src/main/agent/mcp-contract/stdio-server.js');
const { createAgentSubAgentRuntime } = require('../src/main/agent/tools/agent-sub-agent.js');
const { registerResearchToolExecutors } = require('../src/main/agent/tools/tool-executors/research-executors.js');
const { createAgentRuntimeSupport } = require('../src/main/agent/runtime/agent-runtime-support.js');
const { buildCodexMcpContext } = require('../src/main/agent/codex-agent/prompts.js');
const { createLiteratureSearchWorkflowRuntime } = require('../src/main/papers/workflow/agent-literature-search-workflow.js');
const { runCodexLiteratureResearch } = require('../src/main/papers/workflow/codex-literature-research-workflow.js');
const { getLiteratureResearchSession, recordLiteratureResearchDownload } = require('../src/main/papers/workflow/literature-research-session.js');

async function connectClient(env) {
  const server = createAgentMcpStdioServer({ env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'research-test', version: '1' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.server.close(); } };
}

test('paper research repeats discovery and downloads through both MCP layers, then returns verified lines and comments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-research-'));
  const executors = new Map();
  const env = {};
  const normalize = createAgentRuntimeSupport().normalizeAgentSnapshot;
  const host = createAgentMcpHost({
    env,
    runTool: async (toolId, args, snapshot, context) => executors.get(toolId)({
      args, context: { ...context, snapshot: normalize(snapshot) }
    })
  });
  const searches = [];
  const downloads = [];
  let researchSnapshot;
  let agentCalls = 0;
  const objective = 'Compare supporting and conflicting evidence. ' + 'Include relevant context. '.repeat(85) + 'PRESERVE_FINAL_REQUIREMENT';
  const comment = 'Explains the evidence and its limitation. '.repeat(20);
  const subAgentRuntime = createAgentSubAgentRuntime({
    runSubAgentTurn: async (turn) => {
      agentCalls += 1;
      assert.match(turn.message, /PRESERVE_FINAL_REQUIREMENT/);
      assert.match(turn.system_prompt, /no one-search or fixed-round limit/);
      assert.equal(turn.metadata.enable_web_search, true);
      assert.equal(turn.metadata.timeout_ms, null);
      researchSnapshot = turn.metadata.snapshot;
      const context = buildCodexMcpContext({
        snapshot: researchSnapshot,
        projectName: turn.metadata.project.name,
        traceContext: { requestId: turn.metadata.parent_request_id }
      });
      const child = await connectClient({ ...env, HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(context) });
      const papers = [];
      try {
        for (const query of ['initial mechanism', 'conflicting mechanism']) {
          const searched = await child.client.callTool({ name: 'literature_search', arguments: { query } });
          assert.equal(searched.isError, false, searched.content[0].text);
          const candidate = JSON.parse(searched.content[0].text).selected_papers[0];
          assert.equal(candidate.paper_title, query);
          const downloaded = await child.client.callTool({ name: 'paper_download', arguments: {
            doi: candidate.doi, paper_title: candidate.paper_title, collection_name: 'incorrect refined folder'
          } });
          assert.equal(downloaded.isError, false, downloaded.content[0].text);
          const result = JSON.parse(downloaded.content[0].text).output;
          papers.push({ knowledge_markdown_path: result.knowledge_markdown_path, selected_line_ranges: [
            { line_ranges: [{ start_line: 2, end_line: 14 }], relevance_reason: comment }
          ] });
          const reused = await child.client.callTool({ name: 'paper_download', arguments: { doi: candidate.doi, paper_title: candidate.paper_title } });
          assert.equal(reused.isError, false);
        }
        const failed = await child.client.callTool({ name: 'paper_download', arguments: { doi: '10.1000/fail', paper_title: 'Unavailable' } });
        assert.equal(failed.isError, true);
        papers.push({ knowledge_markdown_path: '/untrusted/model/path.md', selected_line_ranges: [{ line_ranges: [{ start_line: 1, end_line: 1 }] }] });
        return { assistant_message: JSON.stringify({ ok: true, papers, summary: 'Evidence gathered; one paper unavailable.', notes: ['One full text was inaccessible.'] }) };
      } finally {
        await child.close();
      }
    }
  });
  const runtime = createLiteratureSearchWorkflowRuntime({
    subAgentRuntime,
    researchPollWaitMs: 1,
    literatureSearchRuntime: {
      searchLiteratureCandidates: async (input) => {
        searches.push(input);
        return { ok: true, items: [{ title: input.query, doi: `10.1000/${searches.length}`, source: 'pubmed' }], sources: ['pubmed'] };
      }
    }
  });
  registerResearchToolExecutors({ registerToolExecutor: (id, executor) => executors.set(id, executor) }, {
    cleanText: (value, max = 2000) => String(value || '').slice(0, max),
    literatureSearchRuntime: runtime,
    paperDownloadRuntime: {
      downloadPaper: async (input) => {
        downloads.push(input);
        if (input.doi.endsWith('/fail')) return { ok: false, status: 'failed', error: 'Unavailable PDF' };
        const markdownPath = path.join(root, `paper-${downloads.length}.md`);
        await fs.writeFile(markdownPath, '# Results\n' + Array.from({ length: 15 }, (_, i) => `Physical evidence line ${i + 2}`).join('\n'));
        return { ok: true, status: 'downloaded', knowledge_markdown_path: markdownPath,
          knowledge_markdown_relative_path: path.basename(markdownPath), knowledge_database: { paper_id: `saved-${downloads.length}` } };
      }
    }
  });
  let parent;
  try {
    await host.ensureStarted();
    parent = await connectClient({ ...env, HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({
      provider: 'codex', traceRequestId: 'same-parent-and-child-request', project: { name: 'Evidence Project' },
      snapshot: { settings: { storagePath: root, preferredJournals: ['Nature'] },
        papers: [{ id: 'saved-1', title: 'initial mechanism', comments: [{ id: 'note-1', text: 'Saved user interpretation' }] }] }
    }) });
    let response = await parent.client.callTool({ name: 'literature_search', arguments: {
      query: 'initial mechanism', message: objective, journals: ['Cell'], allow_unfiltered_fallback: false
    } });
    assert.equal(response.isError, false, response.content[0].text);
    let result = JSON.parse(response.content[0].text);
    assert.equal(result.status, 'running');
    const researchId = result.research_id;
    while (result.status === 'running') {
      assert.equal(result.research_id, researchId);
      response = await parent.client.callTool({ name: 'literature_search', arguments: { research_id: researchId } });
      assert.equal(response.isError, false, response.content[0].text);
      result = JSON.parse(response.content[0].text);
    }
    assert.equal(agentCalls, 1);
    assert.equal(searches.length, 2);
    assert.ok(searches.every((input) => input.defer_web_search_to_codex && input.allow_unfiltered_fallback === false && input.journals[0] === 'Cell'));
    assert.ok(downloads.every((input) => input.storage_path === root && input.linked_name === 'Evidence Project' && input.linked_type === 'project'));
    assert.equal(result.delegated_research, true);
    assert.equal(result.search_count, 2);
    assert.equal(result.loaded_context_blocks.length, 2);
    assert.equal(result.loaded_context_blocks[0].source_lines.length, 13);
    assert.equal(result.loaded_context_blocks[0].source_lines[12].content, 'Physical evidence line 14');
    assert.equal(result.analysis_comments[0].comment, comment.trim());
    assert.equal(result.loaded_context_blocks[0].related_comments[0].text, 'Saved user interpretation');
    assert.equal(downloads.length, 3);
    assert.equal(result.downloaded_papers.length, 3);
    assert.equal(result.downloaded_papers[2].ok, false);
    assert.ok(result.notes.some((note) => note.includes('not returned by a successful download')));
    assert.equal(getLiteratureResearchSession(researchSnapshot), null);
    const duplicate = await parent.client.callTool({ name: 'literature_search', arguments: { query: 'repeat main delegation' } });
    assert.equal(duplicate.isError, true);
    assert.equal(agentCalls, 1);
  } finally {
    await parent?.close();
    await host.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('paper research rejects invalid output and closes the session while preserving download results', async () => {
  let snapshot;
  const result = await runCodexLiteratureResearch({ query: 'test' }, {}, {
    createSubAgent: async (input) => {
      snapshot = input.metadata.snapshot;
      recordLiteratureResearchDownload(snapshot, { paper_title: 'Saved PDF' }, { ok: true, status: 'downloaded' });
      return { ok: true, agent: { id: 'invalid-json', last_response: { assistant_message: 'not JSON' } } };
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid evidence JSON/);
  assert.equal(result.downloaded_papers.length, 1);
  assert.equal(getLiteratureResearchSession(snapshot), null);
});

test('paper research rejects out-of-range evidence and files not returned by the download tool', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-research-range-'));
  const markdownPath = path.join(root, 'paper.md');
  await fs.writeFile(markdownPath, '# Paper\nOnly evidence\n');
  try {
    const result = await runCodexLiteratureResearch({ query: 'test' }, {}, {
      createSubAgent: async (input) => {
        recordLiteratureResearchDownload(input.metadata.snapshot, {}, { ok: true, knowledge_markdown_path: markdownPath });
        return { ok: true, agent: { id: 'invalid-lines', last_response: { assistant_message: JSON.stringify({
          ok: true, papers: [{ knowledge_markdown_path: markdownPath, selected_line_ranges: [{ line_ranges: [{ start_line: 99, end_line: 100 }], relevance_reason: 'Unsupported' }] }]
        }) } } };
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid_evidence');
    assert.equal(result.loaded_context_blocks.length, 0);
    assert.match(result.notes.join(' '), /beyond/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('metadata-only scheduled research never delegates or downloads, including legacy download flags', async () => {
  const runtime = createLiteratureSearchWorkflowRuntime({
    subAgentRuntime: { createSubAgent: () => { throw new Error('Must not delegate'); } },
    paperDownloadRuntime: { downloadPaper: () => { throw new Error('Must not download'); } },
    literatureSearchRuntime: { searchLiteratureCandidates: async () => ({ ok: true, items: [{ title: 'Metadata only', doi: '10.1000/meta' }] }) }
  });
  const result = await runtime.execute({ query: 'test', provider: 'codex', auto_download_selected_papers: true,
    snapshot: { scheduled_task: { task_type: 'paper_finding', deny_paper_download: true } } });
  assert.equal(result.ok, true);
  assert.equal(result.selected_papers.length, 1);
  assert.deepEqual(result.downloaded_papers, []);
  assert.deepEqual(result.loaded_context_blocks, []);
});

test('expired research sessions cannot recurse into another researcher', async () => {
  const runtime = createLiteratureSearchWorkflowRuntime({ subAgentRuntime: {
    createSubAgent: () => { throw new Error('Must not recurse'); }
  } });
  const result = await runtime.execute({ query: 'test', provider: 'codex', snapshot: { literature_research: { id: 'expired' } } });
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer active/);
});

test('research evidence transport keeps exact source lines and comments above the legacy text budget', () => {
  const text = 'Long physical source line. '.repeat(4000);
  const result = JSON.parse(buildMcpToolResponseContent('literature_search', {
    ok: true, delegated_research: true,
    loaded_context_blocks: [{ paper_id: 'p1', source_lines: [{ line_number: 1, text }], relevance_reason: text }]
  }));
  assert.equal(result.loaded_context_blocks[0].source_lines[0].content, text);
  assert.equal(result.analysis_comments[0].comment, text.trim());
  assert.equal(result.truncated, undefined);
});

test('paper research reuses a locally ingested paper and retains exact lines without downloading again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-research-local-'));
  const markdownPath = path.join(root, 'saved.md');
  await fs.writeFile(markdownPath, '# Existing paper\nSaved evidence');
  const executors = new Map();
  try {
    const runtime = createLiteratureSearchWorkflowRuntime({
      paperKnowledgeDatabaseRuntime: { lookupPaper: async () => ({ ok: true, status: 'found', paper: {
        id: 'local-paper', wiki_exists: true, wiki_file_path: markdownPath, wiki_path: 'saved.md'
      } }) },
      subAgentRuntime: { createSubAgent: async (input) => {
        const result = await executors.get('paper-download')({ args: { doi: '10.1000/local', paper_title: 'Existing paper' }, context: { snapshot: input.metadata.snapshot } });
        assert.equal(result.status, 'reused');
        return { ok: true, agent: { last_response: { assistant_message: JSON.stringify({ ok: true, papers: [{
          knowledge_markdown_path: result.knowledge_markdown_path,
          selected_line_ranges: [{ line_ranges: [{ start_line: 2, end_line: 2 }], relevance_reason: 'Relevant saved evidence' }]
        }] }) } } };
      } }
    });
    registerResearchToolExecutors({ registerToolExecutor: (id, executor) => executors.set(id, executor) }, {
      cleanText: (value) => String(value || ''),
      paperDownloadRuntime: { downloadPaper: () => { throw new Error('Must reuse local paper'); } }
    });
    const result = await runtime.execute({ provider: 'codex', query: 'existing evidence', storage_path: root });
    assert.equal(result.ok, true);
    assert.equal(result.downloaded_papers[0].status, 'reused');
    assert.equal(result.selected_papers[0].paper_id, 'local-paper');
    assert.equal(result.loaded_context_blocks[0].source_lines[0].content, 'Saved evidence');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('empty database searches in a research session do not start a nested Codex web fallback', async () => {
  const { createLiteratureSearchRuntime } = require('../src/main/papers/search/agent-literature-search.js');
  let webCalls = 0;
  const runtime = createLiteratureSearchRuntime({
    searchPubMedRecords: async () => [],
    searchWebResults: async () => { webCalls += 1; return []; }
  });
  const result = await runtime.searchLiteratureCandidates({ query: 'rare mechanism', sources: ['pubmed'], defer_web_search_to_codex: true });
  assert.equal(result.ok, true);
  assert.equal(webCalls, 0);
});

test('Codex sub-agent service preserves explicit unlimited deadlines while retaining other helper defaults', async () => {
  const { createMainCodexService } = require('../src/main/core/services/create-codex-service.js');
  const requests = [];
  const service = createMainCodexService({
    cleanText: (value) => String(value || ''),
    requestCodexCliText: async (input) => { requests.push(input); return { text: 'Done', metadata: {} }; },
    getCodexCliWorkingDirectory: () => '/tmp/hikari-research-service-test',
    getCodexCliHomePath: () => '/tmp/hikari-research-service-test',
    getDefaultDataFilePath: () => '',
    getBundlePaths: () => ({}),
    processObject: { env: {} },
    agentFoundation: {
      controllerUtils: { recordAgentLlmTrace: async () => {} },
      observability: { recordLifecycleEvent: () => {} },
      agentToolRuntime: { runAgentTool: async () => ({ ok: true }) }
    },
    createWorkspaceInitializer: () => ({ initialize: async () => ({ ok: true }), getLastResult: () => null })
  });
  await service.runSubAgentTurn({ message: 'Research', metadata: { timeout_ms: null } });
  await service.runSubAgentTurn({ message: 'Resume', agent: { metadata: { timeout_ms: null } } });
  await service.runSubAgentTurn({ message: 'Other helper', metadata: {} });
  await service.runSubAgentTurn({ message: 'Bounded helper', metadata: { timeout_ms: 15000 } });
  assert.deepEqual(requests.map((request) => request.timeoutMs), [null, null, 180000, 15000]);
});

test('research can outlive any number of poll waits without being restarted', async () => {
  const { startLiteratureResearchJob, waitForLiteratureResearch, hasLiteratureResearchJob } = require('../src/main/papers/workflow/literature-research-jobs.js');
  let finish;
  let runs = 0;
  const started = await startLiteratureResearchJob('Long research', () => {
    runs += 1;
    return new Promise((resolve) => { finish = resolve; });
  }, 1);
  assert.equal(started.status, 'running');
  for (let i = 0; i < 3; i += 1) {
    const poll = await waitForLiteratureResearch(started.research_id, 1);
    assert.equal(poll.status, 'running');
    assert.equal(poll.research_id, started.research_id);
  }
  assert.equal(runs, 1);
  finish({ ok: true, status: 'completed', summary: 'Evidence ready' });
  assert.equal((await waitForLiteratureResearch(started.research_id, 1)).summary, 'Evidence ready');
  assert.equal(hasLiteratureResearchJob(started.research_id), false);
  assert.equal((await waitForLiteratureResearch(started.research_id, 1)).status, 'missing');
});
