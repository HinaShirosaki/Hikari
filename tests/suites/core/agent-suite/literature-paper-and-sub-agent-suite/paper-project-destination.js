'use strict';

module.exports = function registerPaperProjectDestinationSuite({ scope, __dirname }) {
  const { assert, fsPromises: fs, path, test, agentPaperDownload, agentLiteratureSearchWorkflow } = scope;
  const { loadEsmStyleModule } = require(path.join(__dirname, 'tests/support/runtime.js'));
  const { registerResearchToolExecutors } = require(path.join(__dirname, 'src/main/agent/tools/tool-executors/research-executors.js'));
  const { resolvePaperDownloadContext } = require(path.join(__dirname, 'src/main/agent/tools/tool-executors/shared.js'));
  const { createDirectMcpToolRouter } = require(path.join(__dirname, 'src/main/agent/mcp-contract/direct-tools/index.js'));
  const { buildMcpToolResponseContent } = require(path.join(__dirname, 'src/main/agent/mcp-contract/result-shaping/paper-results.js'));
  const { discoverPapersFromStorageRoot } = require(path.join(__dirname, 'src/main/storage/paper-discovery.js'));
  const project = { id: 'cd19', name: 'CD19 CAR Binder Optimization' };
  const otherProject = { id: 'other', name: 'Other Project' };
  const snapshot = { projects: [project, otherProject], settings: { storagePath: '/tmp/hikari-storage' } };
  const cleanText = (value, max = 0) => String(value || '').trim().slice(0, max || undefined);

  function connectTools(deps) {
    const executors = new Map();
    registerResearchToolExecutors({ registerToolExecutor: (name, handler) => executors.set(name, handler) }, { cleanText, ...deps });
    return createDirectMcpToolRouter({
      runTool: (name, args, snapshot, context) => executors.get(name)({ args, context: { ...context, snapshot } })
    });
  }

  test('paper destinations distinguish explicit projects from general collections and reject unresolved selectors', () => {
    const context = { snapshot, project: otherProject };
    const explicit = resolvePaperDownloadContext({ project_name: 'cd19 car binder optimization', collection_name: 'Daily digest' }, context);
    assert.deepEqual([explicit.linked_type, explicit.linked_name], ['project', project.name]);
    assert.equal(resolvePaperDownloadContext({ project_id: project.id }, { snapshot }).linked_name, project.name);
    assert.equal(resolvePaperDownloadContext({}, context).linked_name, otherProject.name);
    const collection = resolvePaperDownloadContext({ collection_name: project.name }, { snapshot });
    assert.deepEqual([collection.linked_type, collection.linked_name], ['literature-search', project.name]);
    for (const args of [{ project_name: 'Typo project' }, { project_id: 'gone' }, { project_id: project.id, project_name: otherProject.name }]) {
      assert.match(resolvePaperDownloadContext(args, context).error, /not found/);
    }
    const duplicates = { snapshot: { projects: [project, { ...project, id: 'duplicate' }] } };
    assert.match(resolvePaperDownloadContext({ project_name: project.name }, duplicates).error, /multiple projects/);
    assert.equal(resolvePaperDownloadContext({ project_id: project.id, project_name: project.name }, duplicates).linked_name, project.name);
  });

  test('explicit paper destinations resolve from the real chat snapshot, whatever its scope or caps', () => {
    const { buildStateSnapshot } = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/agent-chat/state-snapshot.js'));
    const { createAgentRuntimeSupport } = require(path.join(__dirname, 'src/main/agent/runtime/agent-runtime-support.js'));
    const { normalizeAgentSnapshot } = createAgentRuntimeSupport({ cleanText, asArray: (value) => (Array.isArray(value) ? value : []) });
    const projects = Array.from({ length: 45 }, (_, index) => ({ id: `p${index + 1}`, name: `Project ${index + 1}` }));
    const state = { projects, notebookEntries: [], protocols: [], workflows: [], settings: {}, inventory: {}, labInventory: {} };
    const chat = (projectId) => normalizeAgentSnapshot(buildStateSnapshot(state, projectId));

    const selected = { snapshot: chat('p1'), project: projects[0] };
    assert.equal(selected.snapshot.projects.length, 1, 'chat data stays scoped');
    assert.equal(resolvePaperDownloadContext({ project_name: 'project 2' }, selected).linked_name, 'Project 2');
    assert.equal(resolvePaperDownloadContext({ project_id: 'p45' }, selected).linked_name, 'Project 45');
    assert.equal(resolvePaperDownloadContext({}, selected).linked_name, 'Project 1');

    const allProjects = { snapshot: chat(''), project: { id: '', name: '' } };
    assert.equal(resolvePaperDownloadContext({ project_name: 'Project 45' }, allProjects).linked_name, 'Project 45');
    assert.match(resolvePaperDownloadContext({ project_name: 'Project 46' }, allProjects).error, /not found/);

    const camelCase = { snapshot: { project_directory: [] }, project: { projectId: 'c1', projectName: 'Camel' } };
    assert.equal(resolvePaperDownloadContext({}, camelCase).linked_name, 'Camel');
    assert.equal(resolvePaperDownloadContext({ project: { projectId: 'c1' } }, camelCase).linked_name, 'Camel');
  });

  test('research polling follows the live job until Markdown is ready, then stops reporting running', async () => {
    const { createLiteratureResearchSession, closeLiteratureResearchSession } = require(
      path.join(__dirname, 'src/main/papers/workflow/literature-research-session.js'));
    const executors = new Map();
    const transferring = { ok: true, status: 'running', download_status: 'browser_downloading', in_progress: true, download_id: 'job-a' };
    const extracting = { ...transferring, download_status: 'completed', knowledge_markdown_path: '/storage/paper.md',
      relative_path: 'Project/X/Papers/paper.pdf' };
    const responses = [transferring, extracting];
    let calls = 0;
    registerResearchToolExecutors({ registerToolExecutor: (name, handler) => executors.set(name, handler) }, {
      cleanText, literatureSearchRuntime: { execute: async () => ({}) },
      paperDownloadRuntime: { downloadPaper: async () => { calls += 1; return responses.shift(); } }
    });
    const session = createLiteratureResearchSession({ query: 'q', project: { id: 'x', name: 'X' } });
    session.findLocalPaper = async () => null;
    const context = { snapshot: { literature_research: { id: session.id }, settings: { storagePath: '/storage' } } };
    const poll = () => executors.get('paper-download')({ args: { doi: '10.1/X', paper_title: 'Paper' }, context });
    try {
      assert.equal((await poll()).status, 'running');
      assert.equal((await poll()).status, 'running');
      assert.equal(calls, 2, 'a paper without Markdown keeps reaching the live job');
      const saved = await poll();
      assert.deepEqual([saved.status, saved.in_progress], ['completed', true], 'extraction may continue, but the PDF is saved');
      assert.equal(saved.summary, 'Reused extracted paper Markdown for Paper.');
      assert.equal(calls, 2, 'readable Markdown is reused without another wait');
      assert.deepEqual(session.downloads.map((paper) => paper.status), ['completed']);

      session.downloads.splice(0, session.downloads.length, { ...transferring, doi: '10.1/x', paper_title: 'Paper' });
      session.findLocalPaper = async () => ({ ok: true, status: 'completed', reused: true, knowledge_markdown_path: '/storage/paper.md' });
      await poll();
      assert.deepEqual(session.downloads.map((paper) => paper.status), ['completed'], 'a job that finished between polls leaves no running entry');
    } finally {
      closeLiteratureResearchSession(session);
    }
  });

  test('paper_download from All projects saves the PDF and ingestion metadata under its explicit project', async () => {
    const root = await fs.mkdtemp(path.join(__dirname, 'tmp', 'paper-project-destination-'));
    const ingestions = [];
    let transfers = 0;
    try {
      const runtime = agentPaperDownload.createPaperDownloadRuntime({
        fetch: async () => {
          transfers += 1;
          return { ok: true, status: 200, headers: { get: () => 'application/pdf' },
            body: { async *[Symbol.asyncIterator]() { yield Buffer.from('%PDF-1.7\nproject destination fixture\n'); } } };
        },
        paperKnowledgeDatabaseRuntime: {
          ingestPaperPdf: async (input) => { ingestions.push(input); return { ok: true, status: 'ready' }; }
        }
      });
      const router = connectTools({ paperDownloadRuntime: runtime,
        literatureSearchRuntime: { execute: async () => { throw new Error('Invalid project must fail before research starts'); } } });
      const context = { snapshot: { ...snapshot, settings: { storagePath: root } } };
      const args = { doi: '10.1000/project-test', paper_title: 'VHH FMC63 comparison',
        candidate_urls: ['https://example.test/paper.pdf'], project_name: project.name };
      const downloaded = await router.callTool('paper_download', args, context);
      assert.equal(downloaded.ok, true, downloaded.error);
      assert.equal(downloaded.output.relative_path, 'Project/CD19_CAR_Binder_Optimization/Papers/VHH_FMC63_comparison.pdf');
      assert.equal((await fs.readFile(downloaded.output.file_path)).subarray(0, 5).toString(), '%PDF-');
      assert.deepEqual([ingestions[0].linked_type, ingestions[0].linked_name], ['project', project.name]);
      assert.equal(ingestions[0].stored_relative_path, downloaded.output.relative_path);
      const discovered = await discoverPapersFromStorageRoot({ storagePath: root, projects: snapshot.projects });
      assert.equal(discovered.papers.length, 1);
      assert.deepEqual([discovered.papers[0].linkedType, discovered.papers[0].linkedId], ['project', project.id]);
      assert.equal(discovered.journalClubs.length, 0);
      const repeated = await router.callTool('paper_download', args, context);
      assert.equal(repeated.output.reused, true);
      assert.equal(repeated.output.file_path, downloaded.output.file_path);
      assert.equal(transfers, 1);
      for (const name of ['paper_download', 'literature_search']) {
        const invalidArgs = name === 'literature_search' ? { query: 'CD19' } : args;
        const invalid = await router.callTool(name, { ...invalidArgs, project_name: 'Missing project' }, context);
        assert.equal(invalid.ok, false);
        assert.equal(invalid.output.status, 'invalid_project');
      }
      assert.equal(transfers, 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('paper download browser fallback retains a supplied open-access source instead of the DOI publisher', async () => {
    const root = await fs.mkdtemp(path.join(__dirname, 'tmp', 'paper-open-source-fallback-'));
    const page = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4176945/';
    const pdf = `${page}pdf/emss-59131.pdf`;
    const input = { doi: '10.1038/nature13579', storage_path: root, linked_type: 'project', linked_name: project.name };
    const browserEntries = [];
    try {
      const runtime = agentPaperDownload.createPaperDownloadRuntime({
        fetch: async () => ({ ok: false, status: 403, headers: { get: () => 'text/html' }, text: async () => 'Browser verification required' }),
        startBrowserDownloadSession: async ({ browserEntryUrl, targetFilePath }) => {
          browserEntries.push(browserEntryUrl);
          await fs.writeFile(targetFilePath, Buffer.from('%PDF-1.7\nopen-access fixture\n'));
          return { ok: true, file_path: targetFilePath };
        }
      });
      assert.equal(agentPaperDownload.extractPaperDownloadTargets({ ...input, candidate_urls: [page] }).browser_entry_url, page);
      const result = await runtime.downloadPaper({ ...input, candidate_urls: [pdf] });
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(browserEntries, [pdf]);
      assert.match(result.relative_path, /^Project\/CD19_CAR_Binder_Optimization\/Papers\//);
      assert.equal(agentPaperDownload.extractPaperDownloadTargets(input).browser_entry_url, 'https://doi.org/10.1038/nature13579');
      assert.equal(agentPaperDownload.extractPaperDownloadTargets({ ...input, candidate_urls: [pdf], page_url: page }).browser_entry_url, page);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('literature_search carries an All projects destination through delegation and verifies reuse in that project', async () => {
    const root = await fs.mkdtemp(path.join(__dirname, 'tmp', 'research-project-destination-'));
    let transfers = 0;
    let globalKnowledgeLookups = 0;
    let router;
    const markdownPath = path.join(root, 'KnowledgeBase', 'comparison.md');
    try {
      await fs.mkdir(path.dirname(markdownPath), { recursive: true });
      await fs.writeFile(markdownPath, '# Comparison\nVHH and FMC63 CARs were compared.\n');
      const downloadRuntime = agentPaperDownload.createPaperDownloadRuntime({
        fetch: async () => {
          transfers += 1;
          return { ok: true, status: 200, headers: { get: () => 'application/pdf' },
            body: { async *[Symbol.asyncIterator]() { yield Buffer.from('%PDF-1.7\nresearch project fixture\n'); } } };
        },
        paperKnowledgeDatabaseRuntime: {
          ingestPaperPdf: async () => ({ ok: true, markdown_path: markdownPath })
        }
      });
      const lookupCalls = [];
      const workflow = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
        paperDownloadRuntime: {
          downloadPaper: downloadRuntime.downloadPaper,
          findSavedPaper: async (args) => {
            lookupCalls.push(args);
            const saved = await downloadRuntime.findSavedPaper(args);
            // The fixture supplies Markdown enrichment after verifying the saved PDF.
            return saved ? { ...saved, knowledge_markdown_path: markdownPath } : null;
          }
        },
        paperKnowledgeDatabaseRuntime: {
          lookupPaper: async () => { globalKnowledgeLookups += 1; return { ok: true, status: 'found', paper: { wiki_exists: true, wiki_file_path: markdownPath } }; }
        },
        subAgentRuntime: {
          createSubAgent: async (input) => {
            assert.deepEqual(input.metadata.project, project);
            const context = { snapshot: input.metadata.snapshot, project: input.metadata.project };
            const args = { doi: '10.1000/research-test', paper_title: 'Research comparison', candidate_urls: ['https://example.test/research.pdf'] };
            const transfersBefore = transfers;
            const wrong = await router.callTool('paper_download', { ...args, project_id: otherProject.id }, context);
            assert.equal(wrong.ok, false);
            assert.equal(transfers, transfersBefore);
            const result = await router.callTool('paper_download', args, context);
            assert.equal(result.ok, true, result.error);
            assert.match(result.output.relative_path, /^Project\/CD19_CAR_Binder_Optimization\/Papers\//);
            assert.equal(result.output.knowledge_markdown_path, markdownPath);
            return { ok: true, agent: { last_response: { assistant_message: JSON.stringify({ ok: true,
              papers: [{ knowledge_markdown_path: markdownPath, selected_line_ranges: [{
                line_ranges: [{ start_line: 2, end_line: 2 }], relevance_reason: 'Direct comparison.'
              }] }] }) } } };
          }
        }
      });
      router = connectTools({ literatureSearchRuntime: workflow, paperDownloadRuntime: downloadRuntime });
      const context = { provider: 'codex', snapshot: { ...snapshot, settings: { storagePath: root } } };
      const result = await router.callTool('literature_search', { query: 'CD19 VHH versus FMC63', project_name: project.name }, context);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.output.papers_read_count, 1);
      assert.equal(result.output.loaded_context_blocks[0].source_lines[0].content, 'VHH and FMC63 CARs were compared.');
      assert.equal(transfers, 1);
      assert.equal(globalKnowledgeLookups, 0, 'Markdown elsewhere must not skip a project PDF save');
      assert.deepEqual([lookupCalls[0].linked_type, lookupCalls[0].linked_name], ['project', project.name]);
      const second = await router.callTool('literature_search', { query: 'CD19 VHH versus FMC63', project_name: project.name }, context);
      assert.equal(second.ok, true, second.error);
      assert.equal(second.output.downloaded_papers[0].reused, true);
      assert.equal(transfers, 1, 'A verified PDF in this project must be reused');
      assert.equal(lookupCalls.length, 2);
      const modelPayload = JSON.parse(buildMcpToolResponseContent('literature_search', second));
      assert.equal(modelPayload.downloaded_papers[0].linked_name, project.name);
      assert.match(modelPayload.downloaded_papers[0].relative_path, /^Project\/CD19_CAR_Binder_Optimization\/Papers\//);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
};
