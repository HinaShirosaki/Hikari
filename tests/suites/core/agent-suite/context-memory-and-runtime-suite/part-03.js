module.exports = function registerAgentContextMemoryAndRuntimeSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('agent chat handler persists internal request, tool, trace, and response rows into the session log', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-handler-'));
      try {
        const { registerAgentIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'index.js'));
        const handlers = new Map();
        const ipcMain = {
          handle(channel, handler) {
            handlers.set(channel, handler);
          }
        };
        const agentLogPath = path.join(tempDir, 'agent-chat.log');
        const chatLogRuntime = agentChatLog.createAgentChatLogRuntime();
        const progressEvents = [];
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-fixed-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T16:00:00.000Z',
              ...entry
            });
          },
          summarizeLlmForAgentLog(llm) {
            return {
              provider: String(llm?.provider || 'openai'),
              model: String(llm?.model || 'gpt-5')
            };
          },
          extractConversation(conversation) {
            return Array.isArray(conversation) ? conversation : [];
          },
          resolveAgentExecutionFlags() {
            return { developerMode: true };
          },
          createAgentLlmTraceContext(input = {}) {
            return {
              enabled: input.enabled === true,
              requestId: String(input.requestId || ''),
              logPath: String(input.logPath || ''),
              provider: String(input.provider || ''),
              model: String(input.model || ''),
              rows: [],
              entries: []
            };
          },
          resolveAgentProvider() {
            return 'openai';
          },
          resolveAgentEndpoint() {
            return 'https://api.example.test';
          },
          resolveAgentModel() {
            return 'gpt-5';
          },
          resolveAgentApiKey() {
            return 'test-key';
          },
          async requestIntentParserPayload(input = {}) {
            input.traceContext?.rows.push({
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parser round completed.',
              timestamp: '2026-03-22T16:00:01.000Z'
            });
            input.traceContext?.entries.push({
              type: 'agent-llm-trace',
              requestId: 'req-fixed-1',
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parser round completed.',
              timestamp: '2026-03-22T16:00:01.000Z',
              request_direction: 'app->llm',
              response_direction: 'llm->app',
              request_payload: { prompt: input.message },
              response_payload: { primary_intent: 'notebook_draft' }
            });
            return {
              ok: true,
              payload: {
                primary_intent: 'notebook_draft',
                needs_clarification: false,
                entities: {},
                protocol_candidates: [],
                reasoning_summary: 'Plan the next notebook draft.'
              }
            };
          },
          summarizeAgentResultForLog(result) {
            return {
              ok: result?.ok === true,
              provider: 'openai',
              model: 'gpt-5',
              response_type: result?.notebook_draft ? 'notebook_draft' : 'intent_parser'
            };
          }
        };
        const protocolNotebookRuntime = {
          buildSessionKey() {
            return 'protocol-session-fixed';
          },
          hasPendingSession() {
            return false;
          },
          clearPendingSession() {},
          setPendingSession() {},
          async runFlow() {
            throw new Error('protocol flow should not run in this test');
          }
        };
        const agentToolRuntime = {
          normalizeAgentSnapshot(snapshot) {
            return snapshot && typeof snapshot === 'object' ? snapshot : {};
          },
          normalizeToolInvocationArgs(args) {
            return args;
          },
          async runAgentTool() {
            return {
              ok: true,
              summary: 'Notebook draft prepared.',
              result: {
                status: 'proposal_ready',
                selected_protocol: {
                  id: 'prot-1',
                  name: 'Atlas Protocol'
                },
                proposal: {
                  proposal_id: 'proposal-1',
                  title: 'Atlas next step',
                  purpose: 'Prepare the next notebook entry.'
                },
                notebook: null
              }
            };
          },
          buildAgentSystemPrompt() {
            return 'system prompt';
          }
        };

        registerAgentIpc({
          ipcMain,
          controllerUtils,
          observability: agentObservability,
          protocolNotebookRuntime,
          scienceReasoningLoopRuntime: {
            async runGeneralScienceQuestion() {
              throw new Error('science runtime should not run in this test');
            },
            async runProjectScienceQuestion() {
              throw new Error('science runtime should not run in this test');
            },
            async runResultAnalysis() {
              throw new Error('science runtime should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser() {
              return {};
            },
            retrieveProjectEvidence() {
              return null;
            }
          },
          agentToolRuntime,
          agentChatLogRuntime: chatLogRuntime,
          agentToolSmokeTestRuntime: {
            async runTool() {
              return { ok: true };
            }
          },
          executeInventoryLookup: async () => ({ status: 'matched', items: [] }),
          executeRecordLookup: async () => ({ status: 'matched', items: [] }),
          getAgentChatLogPath: () => agentLogPath,
          getAgentChatSessionStoragePath: () => tempDir,
          appendAgentChatLogEntry: async (logPath, entry) => {
            await agentObservability.appendLogWithRotation({ logPath, entry });
          },
          normalizeJsonPayload: (value) => value,
          cleanText: (value, maxLength = 2000) => {
            const text = String(value || '').trim();
            if (!text) {
              return '';
            }
            return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
          },
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          },
          getDefaultDataFilePath: () => ''
        });

        const handler = handlers.get('agent:chat');
        assert.equal(typeof handler, 'function');

        const result = await handler({
          sender: {
            send(channel, payload) {
              if (channel === 'agent-progress') {
                progressEvents.push(payload);
              }
            }
          }
        }, {
          clientRequestId: 'client-fixed-1',
          message: 'Plan the next Atlas notebook step.',
          projectId: 'proj-1',
          projectName: 'Atlas',
          chatSessionId: 'session-fixed-1',
          llm: {
            provider: 'openai',
            model: 'gpt-5'
          },
          agent: {
            developerMode: true
          },
          stateSnapshot: {
            settings: {
              agent: {
                developerMode: true
              }
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.chat_session.id, 'session-fixed-1');
        assert.equal(result.request_id, 'req-fixed-1');
        assert.equal(result.client_request_id, 'client-fixed-1');
        assert.equal(progressEvents.length > 0, true);
        assert.equal(progressEvents.every((item) => item.request_id === 'req-fixed-1'), true);
        assert.equal(progressEvents.every((item) => item.client_request_id === 'client-fixed-1'), true);
        assert.equal(progressEvents.every((item) => item.chat_session_id === 'session-fixed-1'), true);
        assert.equal(progressEvents.some((item) => item.stage === 'parser_completed'), true);
        assert.equal(progressEvents.some((item) => item.stage === 'tool_call_started' && item.tool_name === 'notebook-draft'), true);

        const loaded = await chatLogRuntime.getSession({
          storagePath: tempDir,
          sessionId: 'session-fixed-1',
          includeRows: true
        });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-chat-request'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle' && row.stage === 'tool_call_started'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle' && row.stage === 'tool_call_completed'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-llm-trace'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-chat-result'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'user-message' && row.direction === 'user->llm'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'assistant-message' && row.direction === 'llm->user'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('agent observability lifecycle recorder invokes onEvent immediately with normalized events', () => {
      const seen = [];
      const recorder = agentObservability.createLifecycleRecorder({
        requestId: 'req-observe-1',
        onEvent: (event) => {
          seen.push(event);
        }
      });

      const recorded = agentObservability.recordLifecycleEvent(recorder, {
        stage: 'science_round_started',
        status: 'started',
        routing_intent: 'general_science_question',
        tool_name: 'literature-search',
        message: 'Science reasoning round 1 started with literature-search.',
        meta: {
          round: 1
        }
      });

      assert.equal(recorder.events.length, 1);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0], recorded);
      assert.equal(seen[0].requestId, 'req-observe-1');
      assert.equal(seen[0].stage, 'science_round_started');
      assert.equal(seen[0].meta.round, 1);
    });
    test('lifecycle tool runner forwards request context into tool execution', async () => {
      const { createAgentLifecycleService } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-lifecycle-service.js'));
      let receivedCall = null;
      const lifecycleService = createAgentLifecycleService({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          if (!text) {
            return '';
          }
          return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        controllerUtils: {},
        appendAgentChatLogEntry: async () => {},
        agentToolRuntime: {
          normalizeToolInvocationArgs(args) {
            return args;
          },
          async runAgentTool(toolName, args, snapshot, options) {
            receivedCall = {
              toolName,
              args,
              snapshot,
              options
            };
            return {
              ok: true,
              summary: 'Tracked tool executed.',
              result: {
                status: 'matched',
                items: []
              }
            };
          }
        }
      });

      const runTrackedTool = lifecycleService.createLifecycleToolRunner({
        snapshot: {
          data_file_path: '/tmp/agent-data.json'
        },
        allowWriteTools: false,
        lifecycleRecorder: {
          requestId: 'req-lifecycle-1'
        },
        provider: 'codex',
        endpoint: '',
        apiKey: '',
        model: 'gpt-5.4-mini',
        message: 'Find endotoxin-free pipette tips to buy.',
        conversation: [
          { role: 'user', text: 'Find endotoxin-free pipette tips to buy.' }
        ],
        parserPayload: {
          primary_intent: 'purchase_recommendation',
          entities: {
            product_query: 'pipette tips'
          }
        },
        traceContext: {
          trace_id: 'trace-1'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });

      await runTrackedTool('purchase-recommendation', {
        query: 'pipette tips'
      }, {
        allowWriteTools: false
      });

      assert.equal(receivedCall.toolName, 'purchase-recommendation');
      assert.equal(receivedCall.args.query, 'pipette tips');
      assert.equal(receivedCall.snapshot.data_file_path, '/tmp/agent-data.json');
      assert.equal(receivedCall.options.message, 'Find endotoxin-free pipette tips to buy.');
      assert.equal(receivedCall.options.conversation.length, 1);
      assert.equal(receivedCall.options.parserPayload.entities.product_query, 'pipette tips');
      assert.equal(receivedCall.options.project.name, 'Atlas');
      assert.equal(receivedCall.options.requestId, 'req-lifecycle-1');
    });
  }
};