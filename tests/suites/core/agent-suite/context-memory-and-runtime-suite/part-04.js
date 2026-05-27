module.exports = function registerAgentContextMemoryAndRuntimeSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('agent chat handler uses the parser-direct science answer for reasoning_effort 0', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-direct-science-'));
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
        let retrieveProjectEvidenceCalls = 0;
        let scienceRuntimeCalls = 0;
        let buildAgentSystemPromptCalls = 0;
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-direct-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T17:00:00.000Z',
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
            return { developerMode: false };
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
          async requestIntentParserPayload() {
            return {
              ok: true,
              payload: {
                primary_intent: 'project_science_question',
                reasoning_effort: 0,
                direct_answer: 'A likely cause is transient transfection stress combined with plasmid quality loss, so expression drops after delivery.',
                needs_clarification: false,
                clarification_reason: null,
                entities: {
                  project: 'Atlas'
                },
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: [],
                reasoning_summary: 'Direct project-science answer.'
              }
            };
          },
          summarizeAgentResultForLog(result) {
            return {
              ok: result?.ok === true,
              parser: result?.parser || {},
              response_type: result?.project_science_question ? 'project_science_question' : 'intent_parser'
            };
          }
        };
        const protocolNotebookRuntime = {
          buildSessionKey() {
            return 'protocol-session-direct';
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
            throw new Error('tools should not run for parser-direct science answers');
          },
          buildAgentSystemPrompt() {
            buildAgentSystemPromptCalls += 1;
            throw new Error('system prompt builder should not run for parser-direct science answers');
          }
        };

        registerAgentIpc({
          ipcMain,
          controllerUtils,
          observability: agentObservability,
          protocolNotebookRuntime,
          scienceReasoningLoopRuntime: {
            async runGeneralScienceQuestion() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            },
            async runProjectScienceQuestion() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            },
            async runResultAnalysis() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser() {
              return {
                intent: 'project_science_question',
                confidence: 0.64,
                entities: {
                  project: 'Atlas'
                },
                plan: {
                  reasoning_effort: 0
                },
                classifier: {
                  reasoning_effort: 0
                }
              };
            },
            retrieveProjectEvidence() {
              retrieveProjectEvidenceCalls += 1;
              throw new Error('project evidence lookup should not run for parser-direct science answers');
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

        const result = await handler(null, {
          message: 'Why did the Atlas binder lose expression after transfection?',
          projectName: 'Atlas',
          llm: {
            provider: 'openai',
            model: 'gpt-5'
          },
          stateSnapshot: {
            settings: {
              agent: {
                developerMode: false
              }
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.project_science_question.execution_mode, 'intent_parser');
        assert.equal(result.project_science_question.rounds_executed, 0);
        assert.equal(result.project_science_question.reasoning_effort, 0);
        assert.match(String(result.project_science_question.answer || ''), /transfection stress/i);
        assert.equal(retrieveProjectEvidenceCalls, 0);
        assert.equal(scienceRuntimeCalls, 0);
        assert.equal(buildAgentSystemPromptCalls, 0);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('selected project upgrades general science parsing into project science execution', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-project-scope-'));
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
        let routedParserPayload = null;
        let receivedScienceInput = null;
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-project-scope-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T17:10:00.000Z',
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
            return { developerMode: false };
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
          async requestIntentParserPayload() {
            return {
              ok: true,
              payload: {
                primary_intent: 'general_science_question',
                reasoning_effort: 1,
                direct_answer: null,
                needs_clarification: true,
                clarification_reason: 'Please tell me which project should I use for this analysis.',
                entities: {},
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: [],
                reasoning_summary: 'Parser classified this as a general science question.'
              }
            };
          },
          summarizeAgentResultForLog(result) {
            return {
              ok: result?.ok === true,
              parser: result?.parser || {},
              response_type: result?.project_science_question ? 'project_science_question' : 'intent_parser'
            };
          }
        };
        const protocolNotebookRuntime = {
          buildSessionKey() {
            return 'protocol-session-project-scope';
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
            throw new Error('tools should not run in this science routing test');
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
              throw new Error('general science runtime should not run when a project is selected');
            },
            async runProjectScienceQuestion(input) {
              receivedScienceInput = input;
              return {
                status: 'completed',
                answer: 'Atlas-specific science answer.',
                rounds_executed: 1,
                citations: []
              };
            },
            async runResultAnalysis() {
              throw new Error('result analysis should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser(parserPayload = {}) {
              routedParserPayload = parserPayload;
              return {
                intent: String(parserPayload.primary_intent || ''),
                confidence: parserPayload.needs_clarification === true ? 0.35 : 0.64,
                entities: parserPayload.entities || {},
                plan: {
                  reasoning_effort: Number(parserPayload.reasoning_effort || 1),
                  needs_clarification: parserPayload.needs_clarification === true,
                  clarification_reason: String(parserPayload.clarification_reason || '')
                },
                classifier: {
                  reasoning_effort: Number(parserPayload.reasoning_effort || 1)
                }
              };
            },
            retrieveProjectEvidence(input = {}) {
              return {
                selected_project: {
                  id: String(input.selectedProjectId || ''),
                  name: String(input.selectedProjectName || ''),
                  resolution_source: 'selected_project'
                },
                clarification_question: 'Which project should I use?'
              };
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

        const result = await handler(null, {
          message: 'Why did the binder signal drop after transfection?',
          projectId: 'proj-1',
          projectName: 'Atlas',
          llm: {
            provider: 'openai',
            model: 'gpt-5'
          },
          stateSnapshot: {
            settings: {
              agent: {
                developerMode: false
              }
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.parser.primary_intent, 'project_science_question');
        assert.equal(result.parser.needs_clarification, false);
        assert.equal(result.parser.entities.project_name, 'Atlas');
        assert.equal(routedParserPayload.primary_intent, 'project_science_question');
        assert.equal(routedParserPayload.needs_clarification, false);
        assert.equal(receivedScienceInput.parserPayload.primary_intent, 'project_science_question');
        assert.equal(receivedScienceInput.parserPayload.entities.project_name, 'Atlas');
        assert.equal(receivedScienceInput.project.id, 'proj-1');
        assert.equal(receivedScienceInput.project.name, 'Atlas');
        assert.equal(result.project_science_question.status, 'completed');
        assert.equal(Boolean(result.general_science_question), false);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('agent chat log runtime builds fallback assistant message for controller errors', () => {
      const runtime = agentChatLog.createAgentChatLogRuntime();
      const assistantMessage = runtime.buildAssistantMessageFromError({
        errorMessage: 'Provider timeout.',
        requestText: 'Analyze the latest assay.'
      });

      assert.equal(assistantMessage.role, 'assistant');
      assert.match(String(assistantMessage.text || ''), /Provider timeout/);
      assert.equal(assistantMessage.meta.parser.needs_clarification, true);
      assert.equal(assistantMessage.meta.parser.clarification_reason, 'agent_error');
      assert.equal(assistantMessage.meta.requestText, 'Analyze the latest assay.');
    });
    test('agent tool smoke-test runtime manually exercises every registered tool', async () => {
      const runtime = agentToolSmokeTest.createAgentToolSmokeTestRuntime();
      const result = await runtime.runAllTools();

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.tool_count, runtime.toolNames.length);
      assert.equal(result.failed_count, 0);
      assert.equal(result.passed_count, result.tool_count);
      assert.deepEqual(result.items.map((item) => item.tool_name), runtime.toolNames);
      assert.equal(result.items.every((item) => item.ok === true), true);
      assert.equal(result.items.every((item) => Number.isFinite(Number(item.duration_ms))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'notebook-draft' && /Viability Assay/i.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'python-sandbox' && /out\.json/.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'paper-download' && /\.pdf/i.test(String(item.preview || ''))), true);
      assert.match(String(result.summary || ''), /tools passed/i);
    });
  }
};