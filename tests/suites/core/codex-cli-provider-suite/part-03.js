module.exports = function registerCodexCliProviderSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const os = require('node:os');
    const providerPath = path.join(__dirname, 'src', 'main', 'lib', 'codex-cli-provider.js');
    const loadProvider = () => {
      delete require.cache[require.resolve(providerPath)];
      return require(providerPath);
    };
    const defaultModelsCache = {
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'gpt-5.4',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
            { effort: 'xhigh' }
          ]
        },
        {
          slug: 'gpt-5.1-codex-mini',
          display_name: 'gpt-5.1-codex-mini',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'medium' },
            { effort: 'high' }
          ]
        }
      ]
    };

    function buildJwt(payload = {}) {
      const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
    }

    function withCodexHome({
      modelsCache = defaultModelsCache,
      configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
      authFile = null
    } = {}, callback) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-home-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(modelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), configToml, 'utf8');
      if (authFile && typeof authFile === 'object') {
        fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify(authFile, null, 2), 'utf8');
      }
      process.env.CODEX_HOME = tmpDir;
      delete process.env.HIKARI_CODEX_HOME;
      const cleanup = () => {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousHikariCodexHome === 'string') {
          process.env.HIKARI_CODEX_HOME = previousHikariCodexHome;
        } else {
          delete process.env.HIKARI_CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      };
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          return result.finally(cleanup);
        }
        cleanup();
        return result;
      } catch (error) {
        cleanup();
        throw error;
      } finally {
        // Async callbacks clean up in the promise finalizer above.
      }
    }

    function createFakeCodexBinary(workspaceDir) {
      const fakePath = path.join(workspaceDir, 'fake-codex.js');
      const capturePath = path.join(workspaceDir, 'fake-codex-call.json');
      fs.writeFileSync(fakePath, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        'let stdin = "";',
        "process.stdin.on('data', (chunk) => { stdin += String(chunk || ''); });",
        "process.stdin.on('end', () => {",
        "  const outputIndex = args.indexOf('--output-last-message');",
        "  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : '';",
        '  fs.writeFileSync(process.env.HIKARI_FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }, null, 2));',
        "  if (process.env.HIKARI_FAKE_CODEX_STDOUT) { process.stdout.write(process.env.HIKARI_FAKE_CODEX_STDOUT); }",
        "  if (process.env.HIKARI_FAKE_CODEX_STDERR) { process.stderr.write(process.env.HIKARI_FAKE_CODEX_STDERR); }",
        "  const exitCode = Number(process.env.HIKARI_FAKE_CODEX_EXIT_CODE || 0);",
        "  if (exitCode) { process.exit(exitCode); }",
        "  if (outputFile) { fs.writeFileSync(outputFile, 'OK from fake codex'); }",
        '});'
      ].join('\n'), 'utf8');
      fs.chmodSync(fakePath, 0o755);
      return {
        fakePath,
        capturePath
      };
    }
    test('agent tool executors hydrate bundle snapshots for direct protocol MCP paths', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));
      const executors = new Map();
      const hydratedProtocol = {
        id: 'prot-tev',
        name: 'TEV Protease Cleavage of Fusion Protein',
        purpose: 'Cleave a fusion tag with TEV protease.',
        steps: [
          { id: 'step-1', text: 'Combine fusion protein with TEV protease.' }
        ]
      };
      const staleProtocol = {
        id: 'prot-smoke',
        name: 'MCP Fused Protocol Generation Smoke 2026-05-15 20-06',
        purpose: 'A partial in-memory protocol snapshot.'
      };
      const protocolInputs = [];
      const notebookInputs = [];
      registerAgentToolExecutors({
        cleanText: (value, maxLength = 500) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        genericAgentToolRuntime: {
          registerToolExecutor(name, executor) {
            executors.set(name, executor);
          }
        },
        inventoryLookupRuntime: {},
        notebookLookupRuntime: {},
        agentAppApi: {
          protocol: {
            async matchForNotebook(input) {
              protocolInputs.push(input);
              return {
                ok: true,
                ranked_matches: [{ ...input.snapshot.protocols[0], score: 120 }],
                selected_protocol: { ...input.snapshot.protocols[0], score: 120 },
                selection_method: 'deterministic',
                rationale: 'Exact protocol candidate match.'
              };
            }
          }
        },
        notebookDraftRuntime: {
          async generateNotebookDraft(input) {
            notebookInputs.push(input);
            return {
              status: 'proposal_ready',
              selected_protocol: input.snapshot.protocols[0],
              notebook: { title: input.snapshot.protocols[0]?.name || '' },
              summary: 'Draft ready.'
            };
          }
        },
        hydrateSnapshotFromBundle: async ({ snapshot, dataFilePath }) => ({
          snapshot: {
            ...snapshot,
            data_file_path: dataFilePath,
            protocols: [hydratedProtocol],
            notebookEntries: []
          }
        }),
        getDefaultDataFilePath: () => '/tmp/hikari-data.json'
      });

      const protocolResult = await executors.get('protocol-matching')({
        args: {
          protocol_candidates: ['TEV Protease Cleavage of Fusion Protein']
        },
        context: {
          snapshot: { data_file_path: '/tmp/hikari-data.json', protocols: [staleProtocol] },
          dataFilePath: '/tmp/hikari-data.json'
        },
        state: {}
      });
      assert.equal(protocolResult.status, 'selected');
      assert.equal(protocolInputs[0].snapshot.protocols[0].name, hydratedProtocol.name);

      const notebookResult = await executors.get('notebook-draft')({
        args: {
          project: { name: 'PD-1 Nanobody Binder Discovery' },
          protocol_candidates: ['TEV Protease Cleavage of Fusion Protein']
        },
        context: {
          snapshot: { data_file_path: '/tmp/hikari-data.json', protocols: [staleProtocol] },
          dataFilePath: '/tmp/hikari-data.json',
          parserPayload: { primary_intent: 'notebook_draft' }
        }
      });
      assert.equal(notebookResult.status, 'proposal_ready');
      assert.equal(notebookInputs[0].snapshot.protocols[0].id, 'prot-tev');

      const fallbackExecutors = new Map();
      const { createProtocolMatchingRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-protocol-matching.js'
      ));
      registerAgentToolExecutors({
        cleanText: (value, maxLength = 500) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        genericAgentToolRuntime: {
          registerToolExecutor(name, executor) {
            fallbackExecutors.set(name, executor);
          }
        },
        protocolMatchingRuntime: createProtocolMatchingRuntime({}),
        hydrateSnapshotFromBundle: async ({ snapshot, dataFilePath }) => ({
          snapshot: {
            ...snapshot,
            data_file_path: dataFilePath,
            protocols: [hydratedProtocol],
            notebookEntries: []
          }
        }),
        getDefaultDataFilePath: () => '/tmp/hikari-data.json'
      });
      const fallbackResult = await fallbackExecutors.get('protocol-matching')({
        args: {
          protocol_candidates: ['TEV Protease Cleavage of Fusion Protein']
        },
        context: {
          snapshot: { data_file_path: '/tmp/hikari-data.json', protocols: [staleProtocol] },
          dataFilePath: '/tmp/hikari-data.json'
        },
        state: {}
      });
      assert.equal(fallbackResult.selected_protocol.name, hydratedProtocol.name);

      const weakResult = await createProtocolMatchingRuntime({}).selectProtocol({
        protocols: [staleProtocol],
        protocolCandidates: ['TEV Protease Cleavage of Fusion Protein'],
        message: 'TEV Protease Cleavage of Fusion Protein',
        parserPayload: {
          entities: {
            protocol_name: 'TEV Protease Cleavage of Fusion Protein'
          }
        }
      });
      assert.equal(weakResult.selected_protocol, null);
    });
    test('agent tool executors defer nested web search for Codex MCP literature calls', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));
      const executors = new Map();
      let received = null;
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, executor) {
            executors.set(name, executor);
          }
        },
        literatureSearchRuntime: {
          async execute(input) {
            received = input;
            return { ok: true, status: 'completed' };
          }
        }
      });

      await executors.get('literature-search')({
        args: { query: 'molecular glue degraders' },
        context: {
          agentMcp: true,
          provider: 'codex',
          snapshot: {}
        }
      });

      assert.equal(received.defer_web_search_to_codex, true);
    });
    test('codex agent runtime builds a Codex-session prompt and renders plain final text', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const calls = [];
      const traceRows = [];
      const lifecycleEvents = [];
      const progressEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          input.onStream?.({
            type: 'codex_thinking',
            thinking_text: 'Checking the relevant project records.',
            event_type: 'agent_reasoning_delta'
          });
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'started',
            tool_name: 'inventory_lookup',
            tool_call_text: 'inventory_lookup: {"query":"SUMO1"}',
            event_type: 'tool_call_started'
          });
          input.onStream?.({
            type: 'codex_cli_display',
            display_kind: 'tool',
            display_text: 'Reading paper.md...',
            tool_name: 'exec_command',
            event_type: 'function_call'
          });
          input.onStream?.({
            text_delta: 'Streaming answer.',
            accumulated_text: 'Streaming answer.',
            event_type: 'agent_message_delta'
          });
          return {
            text: 'Atlas SUMO1 likely needs a follow-up expression check.',
            metadata: {
              session_id: 'codex-chat-session-1',
              command: 'exec'
            }
          };
        },
        recordAgentLlmTrace: async (_traceContext, event = {}) => {
          traceRows.push(event);
        },
        recordLifecycleEvent: (_recorder, event = {}) => {
          lifecycleEvents.push(event);
        },
        getWorkingDirectory: () => '/tmp/hikari-workspace'
      });

      const result = await runtime.run({
        message: 'Why was SUMO1 conjugation weak?',
        conversation: [
          { role: 'user', text: 'Open Atlas.' },
          { role: 'assistant', text: 'Atlas is open.' }
        ],
        attachments: [
          {
            name: 'pilot.pdf',
            kind: 'file',
            mimeType: 'application/pdf',
            size: 1234,
            dataUrl: 'data:application/pdf;base64,abc'
          }
        ],
        projectId: 'proj-1',
        projectName: 'Atlas SUMO1',
        selectionInsight: {
          actionType: 'what_is_it',
          selectedText: 'weak conjugation'
        },
        snapshot: {
          data_file_path: '/tmp/hikari-data.json',
          settings: {
            storagePath: '/tmp/hikari-storage',
            preferredJournals: ['Nature Biotechnology', 'Cell']
          },
          activePaper: {
            id: 'paper-1',
            title: 'Atlas SUMO1 pilot paper',
            knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/atlas-sumo1/paper.md'
          },
          paper_agent: {
            active_paper_id: 'paper-1',
            active_paper_title: 'Atlas SUMO1 pilot paper',
            session_prompt: 'This Papers chat is scoped to the active PDF. Read the transformed markdown before answering paper-specific questions.',
            transformed_markdown_relative_path: 'KnowledgeBase/papers.md/atlas-sumo1/paper.md',
            knowledge_status: 'ready',
            has_transformed_markdown: true
          }
        },
        cwd: path.parse('/tmp/hikari-workspace').root,
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        traceContext: { requestId: 'req-codex-runtime', rows: [], entries: [] },
        lifecycleRecorder: { requestId: 'req-codex-runtime', events: [] },
        emitAgentProgress: (event = {}) => {
          progressEvents.push(event);
        }
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, 'gpt-5.4');
      assert.equal(calls[0].reasoningEffort, 'high');
      assert.equal(calls[0].cwd, '/tmp/hikari-workspace');
      assert.equal(calls[0].stream, true);
      assert.equal(typeof calls[0].onStream, 'function');
      assert.equal(calls[0].enableWebSearch, true);
      assert.equal(calls[0].returnMetadata, true);
      assert.equal(calls[0].resumeSessionId, '');
      assert.match(calls[0].prompt, /Codex Chat Turn/);
      assert.match(calls[0].prompt, /Current user request:\nWhy was SUMO1 conjugation weak\?/);
      assert.match(calls[0].prompt, /Protocol generation handoff:/);
      assert.match(calls[0].prompt, /call `mcp__hikari__protocol_generation` with/);
      assert.match(calls[0].prompt, /summarize that the generated protocol is ready for review/);
      assert.match(calls[0].prompt, /mcp__hikari__protocol_generation/);
      assert.match(calls[0].prompt, /Assay context handoff:/);
      assert.match(calls[0].prompt, /Assay plate data \(TSV/);
      assert.match(calls[0].prompt, /retrieve the active assay data by reading/);
      assert.match(calls[0].prompt, /Do not use local lookup tools for active assay plate data/);
      const retiredDirectToolName = ['record', 'lookup'].join('_');
      assert.equal(calls[0].prompt.includes(retiredDirectToolName), false);
      assert.doesNotMatch(calls[0].prompt, /initially visible tool list/);
      assert.doesNotMatch(calls[0].prompt, /Do not answer only with markdown or prose/);
      assert.doesNotMatch(calls[0].prompt, /Recent conversation:/);
      assert.match(calls[0].prompt, /Selection insight context:/);
      assert.match(calls[0].prompt, /Paper agent session:/);
      assert.match(calls[0].prompt, /Read the transformed markdown before answering paper-specific questions/);
      assert.match(calls[0].prompt, /\/tmp\/hikari-storage\/KnowledgeBase\/papers\.md\/atlas-sumo1\/paper\.md/);
      assert.match(calls[0].prompt, /Saved Hikari settings:/);
      assert.match(calls[0].prompt, /"preferred_journals": \[/);
      assert.match(calls[0].prompt, /Nature Biotechnology/);
      assert.match(calls[0].prompt, /Do not call memory just to rediscover these saved settings/);
      assert.match(calls[0].prompt, /soft ranking preferences/);
      assert.match(calls[0].prompt, /including when the user says "from my preferred journals"/);
      assert.match(calls[0].prompt, /make at most one `mcp__hikari__literature_search` call/);
      assert.match(calls[0].prompt, /pilot\.pdf/);
      assert.doesNotMatch(calls[0].prompt, /"assistant_text"/);
      const mcpContext = JSON.parse(calls[0].envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT);
      assert.equal(mcpContext.provider, 'codex');
      assert.equal(mcpContext.model, 'gpt-5.4');
      assert.equal(mcpContext.cwd, '/tmp/hikari-workspace');
      assert.equal(mcpContext.chatSessionId, '');
      assert.equal(mcpContext.codexSessionId, '');
      assert.deepEqual(mcpContext.conversation, []);
      assert.equal(mcpContext.project.name, 'Atlas SUMO1');
      assert.equal(mcpContext.activePaper.title, 'Atlas SUMO1 pilot paper');
      assert.equal(mcpContext.paperAgent.transformed_markdown_relative_path, 'KnowledgeBase/papers.md/atlas-sumo1/paper.md');
      assert.equal(mcpContext.paperAgent.transformed_markdown_path, '/tmp/hikari-storage/KnowledgeBase/papers.md/atlas-sumo1/paper.md');
      assert.deepEqual(mcpContext.snapshot.settings.preferredJournals, ['Nature Biotechnology', 'Cell']);
      assert.equal(mcpContext.snapshot.settings.storagePath, '/tmp/hikari-storage');
      assert.equal(mcpContext.snapshot.data_file_path, '/tmp/hikari-data.json');
      assert.equal(mcpContext.dataFilePath, '/tmp/hikari-data.json');
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT),
        mcpContext
      );
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT),
        mcpContext
      );
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT),
        mcpContext
      );
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'codex_agent');
      assert.equal(result.parser.needs_clarification, false);
      assert.equal(result.codex_agent.status, 'completed');
      assert.match(result.codex_agent.answer, /SUMO1 likely/);
      assert.equal(result.codex_agent.user_question, null);
      assert.equal(result.codex_agent.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_agent.citations.length, 0);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_runtime'), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'codex_agent_completed'), true);
      assert.equal(progressEvents.some((event) => event.stage === 'codex_agent_thinking' && event.meta?.thinking_trace === 'Checking the relevant project records.'), true);
      assert.equal(progressEvents.some((event) => event.stage === 'tool_call_started' && event.tool_name === 'inventory_lookup' && event.meta?.tool_call_text.includes('SUMO1')), true);
      assert.equal(progressEvents.some((event) => event.stage === 'codex_cli_display' && event.meta?.codex_display_text === 'Reading paper.md...'), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'codex_cli_display' && event.message === 'Reading paper.md...'), true);
      assert.equal(progressEvents.some((event) => event.stage === 'codex_agent_stream'), true);
      assert.equal(progressEvents.some((event) => event.meta?.stream_text === 'Streaming answer.'), true);
    });
    test('codex agent runtime prefers streamed final answer over parsed tool arguments', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const traceRows = [];
      const lifecycleEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_cli_display',
            display_kind: 'assistant',
            display_text: 'Ran one Hikari literature_search call with crossref and web results.',
            event_type: 'agent_message:final_answer'
          });
          return {
            text: JSON.stringify({
              query: 'molecular glue degraders',
              source: 'auto',
              message: 'Find papers on molecular glue degraders from my preferred journals.'
            }),
            metadata: {
              session_id: 'codex-final-answer-session'
            }
          };
        },
        recordAgentLlmTrace: async (_traceContext, event = {}) => {
          traceRows.push(event);
        },
        recordLifecycleEvent: (_recorder, event = {}) => {
          lifecycleEvents.push(event);
        },
        getWorkingDirectory: () => '/tmp/hikari-workspace'
      });

      const result = await runtime.run({
        message: 'Find papers on molecular glue degraders from my preferred journals.',
        model: 'gpt-5.4',
        traceContext: { requestId: 'req-codex-streamed-final', rows: [], entries: [] },
        lifecycleRecorder: { requestId: 'req-codex-streamed-final', events: [] }
      });

      assert.equal(result.ok, true);
      assert.equal(result.codex_agent.status, 'completed');
      assert.equal(result.codex_agent.answer, 'Ran one Hikari literature_search call with crossref and web results.');
      assert.equal(result.parser.direct_answer, 'Ran one Hikari literature_search call with crossref and web results.');
      const completedTrace = traceRows.find((row) => row.stage === 'codex_agent_completed');
      assert.equal(completedTrace.response_payload.assistant_text, 'Ran one Hikari literature_search call with crossref and web results.');
      assert.equal(completedTrace.response_payload.raw_response_payload.query, 'molecular glue degraders');
      assert.equal(lifecycleEvents.some((event) => event.stage === 'codex_cli_display' && event.meta?.codex_event_type === 'agent_message:final_answer'), true);
    });
    test('codex agent runtime keeps full streamed final answer while compacting display events', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const longFinalAnswer = `Final answer start ${'paper-result '.repeat(900)}Final answer end`;
      const lifecycleEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_cli_display',
            display_kind: 'assistant',
            display_text: longFinalAnswer,
            event_type: 'message:final_answer'
          });
          return {
            text: JSON.stringify({ answer: 'short parsed fallback' }),
            metadata: { session_id: 'codex-long-final-session' }
          };
        },
        recordAgentLlmTrace: async () => {},
        recordLifecycleEvent: (_recorder, event = {}) => {
          lifecycleEvents.push(event);
        },
        getWorkingDirectory: () => '/tmp/hikari-workspace'
      });

      const result = await runtime.run({
        message: 'Return a long final answer.',
        model: 'gpt-5.4',
        traceContext: { requestId: 'req-codex-long-final', rows: [], entries: [] },
        lifecycleRecorder: { requestId: 'req-codex-long-final', events: [] }
      });

      const displayEvent = lifecycleEvents.find((event) => event.stage === 'codex_cli_display');
      assert.equal(result.codex_agent.answer, longFinalAnswer);
      assert.equal(displayEvent.meta.codex_display_text.length, 8000);
      assert.equal(displayEvent.message.length, 8000);
    });
    test('codex agent runtime prefers a prepared selected-project workspace when cwd is not explicit', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const calls = [];
      const projectWorkspace = path.join(os.tmpdir(), 'hikari-storage', 'Project', 'Atlas');
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        prepareProjectWorkspace: async (input = {}) => {
          assert.equal(input.projectName, 'Atlas');
          return projectWorkspace;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          return {
            text: 'Atlas project answer.',
            metadata: {
              session_id: 'codex-project-session'
            }
          };
        },
        getWorkingDirectory: () => '/tmp/hikari-workspace'
      });

      const result = await runtime.run({
        message: 'Summarize Atlas memory.',
        projectId: 'project-1',
        projectName: 'Atlas',
        model: 'gpt-5.4'
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].cwd, projectWorkspace);
      const mcpContext = JSON.parse(calls[0].envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT);
      assert.equal(mcpContext.cwd, projectWorkspace);
      assert.equal(mcpContext.project.name, 'Atlas');
      assert.equal(result.ok, true);
      assert.equal(result.codex_agent.codex_session_id, 'codex-project-session');
    });
    test('codex agent runtime preserves renderable user questions', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async () => ({
          text: JSON.stringify({
            status: 'needs_more_info',
            assistant_text: 'Which project should I use?',
            follow_up_questions: ['Which project should I use?'],
            user_question: {
              question: 'Which project should I use?',
              options: [
                { label: 'Atlas', value: 'Use Atlas.' },
                { label: 'All projects', value: 'Search all projects.' }
              ],
              allow_custom: true
            },
            reasoning_summary: 'Waiting for one project-scope clarification.',
            citations: []
          }),
          metadata: {
            session_id: 'codex-clarify-session'
          }
        })
      });

      const result = await runtime.run({
        message: 'Summarize the latest notes.',
        model: 'gpt-5.4',
        cwd: '/tmp/hikari-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.parser.clarification_reason, 'Which project should I use?');
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.codex_session_id, 'codex-clarify-session');
      assert.equal(result.codex_agent.user_question.question, 'Which project should I use?');
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Use Atlas.', 'Search all projects.']
      );
    });
  }
};
