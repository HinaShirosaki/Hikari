module.exports = function registerAgentIntentAndNotebookSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('controller core skips parser for the next general science follow-up turn and re-enters the reasoning loop', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let scienceRuntimeCalls = 0;
      let receivedScienceInput = null;
      const lifecycleStages = [];
      const controller = createAgentControllerCore({
        deps: {
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          }
        },
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        controllerUtils: {
          resolveAgentProvider: () => 'openai',
          resolveAgentEndpoint: () => 'https://example.test',
          resolveAgentModel: () => 'gpt-test',
          resolveAgentApiKey: () => 'key',
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-science-followup',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for the next general science follow-up turn.');
          }
        },
        observability: {
          recordLifecycleEvent: (_recorder, event = {}) => {
            lifecycleStages.push({
              stage: event.stage || '',
              meta: event.meta && typeof event.meta === 'object' ? event.meta : {}
            });
          }
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'science-followup-session',
          hasPendingSession: () => false,
          clearPendingSession: () => false,
          setPendingSession: () => null
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async (input) => {
            scienceRuntimeCalls += 1;
            receivedScienceInput = input;
            return {
              status: 'completed',
              answer: 'Deeper answer',
              confidence: 0.72,
              citations: [],
              rounds_executed: 1
            };
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for this general science follow-up.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for this general science follow-up.');
          }
        },
        scienceMainUtils: {
          buildScienceRoutingFromParser: (parserPayload = {}) => ({
            intent: parserPayload.primary_intent,
            entities: {},
            plan: {
              reasoning_effort: Number(parserPayload.reasoning_effort) || 0,
              needs_clarification: false,
              clarification_reason: ''
            }
          })
        },
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for this general science follow-up.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for this general science follow-up.');
        },
        agentChatLogRuntime: {
          async getSession() {
            return {
              ok: true,
              rows: [{
                type: 'assistant-message',
                session_id: 'chat-science-followup-1',
                timestamp: '2026-04-12T21:42:00.000Z',
                meta: {
                  parser: {
                    primary_intent: 'general_science_question',
                    reasoning_effort: 0,
                    direct_answer: 'Short answer',
                    reasoning_summary: 'Intent parser selected general_science_question.'
                  },
                  general_science_question: {
                    status: 'completed'
                  }
                }
              }]
            };
          }
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '',
        setCodexCliModel: () => {},
        setCodexCliReasoningEffort: () => {},
        lifecycleService: {
          normalizeJsonPayload: (payload, fallback = {}) => (
            payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback
          ),
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async () => {
            throw new Error('Tracked tool runner should not execute in this bounded follow-up test.');
          }
        }
      });

      const result = await controller.runAgentControllerCore({
        message: 'Think harder',
        conversation: [],
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-science-followup',
          events: []
        },
        requestId: 'req-science-followup',
        chatSessionId: 'chat-science-followup-1',
        chatSessionStoragePath: '/tmp/chat-science-followup-1'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(scienceRuntimeCalls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'general_science_question');
      assert.equal(result.parser.reasoning_effort, 1);
      assert.equal(result.parser.direct_answer, null);
      assert.match(String(result.parser.reasoning_summary || ''), /following question continues the previous general_science_question intent/i);
      assert.equal(receivedScienceInput.parserPayload.primary_intent, 'general_science_question');
      assert.equal(receivedScienceInput.parserPayload.reasoning_effort, 1);
      assert.equal(receivedScienceInput.parserPayload.direct_answer, null);
      assert.equal(result.general_science_question.status, 'completed');
      const parserCompleted = lifecycleStages.find((item) => item.stage === 'parser_completed');
      assert.equal(Boolean(parserCompleted), true);
      assert.equal(parserCompleted.meta.skipped, true);
      assert.equal(parserCompleted.meta.resumed_from_pending, false);
    });
    test('controller core runs the parser again after a skipped follow-up turn was already used', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let scienceRuntimeCalls = 0;
      const lifecycleStages = [];
      const controller = createAgentControllerCore({
        deps: {
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          }
        },
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        controllerUtils: {
          resolveAgentProvider: () => 'openai',
          resolveAgentEndpoint: () => 'https://example.test',
          resolveAgentModel: () => 'gpt-test',
          resolveAgentApiKey: () => 'key',
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-science-followup-bounded',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            return {
              ok: true,
              payload: {
                primary_intent: 'general_science_question',
                reasoning_effort: 1,
                direct_answer: null,
                needs_clarification: false,
                clarification_reason: null,
                entities: {},
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: [],
                reasoning_summary: 'Intent parser selected general_science_question.'
              }
            };
          }
        },
        observability: {
          recordLifecycleEvent: (_recorder, event = {}) => {
            lifecycleStages.push({
              stage: event.stage || '',
              meta: event.meta && typeof event.meta === 'object' ? event.meta : {}
            });
          }
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'science-followup-bounded-session',
          hasPendingSession: () => false,
          clearPendingSession: () => false,
          setPendingSession: () => null
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            scienceRuntimeCalls += 1;
            return {
              status: 'completed',
              answer: 'Freshly parsed answer',
              confidence: 0.7,
              citations: [],
              rounds_executed: 1
            };
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run here.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run here.');
          }
        },
        scienceMainUtils: {
          buildScienceRoutingFromParser: (parserPayload = {}) => ({
            intent: parserPayload.primary_intent,
            entities: {},
            plan: {
              reasoning_effort: Number(parserPayload.reasoning_effort) || 0,
              needs_clarification: false,
              clarification_reason: ''
            }
          })
        },
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run here.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run here.');
        },
        agentChatLogRuntime: {
          async getSession() {
            return {
              ok: true,
              rows: [{
                type: 'assistant-message',
                session_id: 'chat-science-followup-2',
                timestamp: '2026-04-12T21:43:00.000Z',
                meta: {
                  parser: {
                    primary_intent: 'general_science_question',
                    reasoning_effort: 1,
                    direct_answer: null,
                    reasoning_summary: 'Skipped intent parsing because the following question continues the previous general_science_question intent.'
                  },
                  general_science_question: {
                    status: 'completed'
                  }
                }
              }]
            };
          }
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '',
        setCodexCliModel: () => {},
        setCodexCliReasoningEffort: () => {},
        lifecycleService: {
          normalizeJsonPayload: (payload, fallback = {}) => (
            payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback
          ),
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async () => {
            throw new Error('Tracked tool runner should not execute in this bounded follow-up test.');
          }
        }
      });

      const result = await controller.runAgentControllerCore({
        message: 'Add a table too',
        conversation: [],
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-science-followup-bounded',
          events: []
        },
        requestId: 'req-science-followup-bounded',
        chatSessionId: 'chat-science-followup-2',
        chatSessionStoragePath: '/tmp/chat-science-followup-2'
      });

      assert.equal(parserCallCount, 1);
      assert.equal(scienceRuntimeCalls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'general_science_question');
      const parserCompleted = lifecycleStages.find((item) => item.stage === 'parser_completed');
      assert.equal(Boolean(parserCompleted), true);
      assert.equal(parserCompleted.meta.skipped, false);
      assert.equal(parserCompleted.meta.resumed_from_pending, false);
    });
    test('controller core dispatches direct skill commands to tools before intent parsing or LLM setup', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let toolCallCount = 0;
      const controller = createAgentControllerCore({
        deps: {
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          }
        },
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        controllerUtils: {
          resolveAgentProvider: () => {
            throw new Error('Provider resolution should not run for direct skill commands.');
          },
          resolveAgentEndpoint: () => '',
          resolveAgentModel: () => '',
          resolveAgentApiKey: () => '',
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-skill-command',
            logPath: '',
            provider: '',
            model: '',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should not run for direct skill commands.');
          }
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'skill-command-session',
          hasPendingSession: () => false
        },
        scienceReasoningLoopRuntime: {},
        scienceMainUtils: {},
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          listSkills: () => ([
            {
              name: 'command-line',
              description: 'Run shell commands.',
              command_name: 'command_line',
              path: '/skills/command-line/SKILL.md'
            }
          ]),
          parseSkillInvocation: () => ({
            type: 'direct_tool',
            skill: {
              name: 'command-line'
            },
            tool_name: 'command-line',
            command_name: 'skill',
            raw_args: 'pwd',
            active_skill_names: ['command-line'],
            cleaned_message: 'pwd'
          }),
          async runAgentTool(toolName, args) {
            toolCallCount += 1;
            assert.equal(toolName, 'command-line');
            assert.equal(args.command, 'pwd');
            return {
              ok: true,
              summary: 'Command completed successfully.',
              result: {
                status: 'completed',
                summary: 'Command completed successfully.',
                stdout: '/tmp/workspace'
              }
            };
          }
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for direct skill commands.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for direct skill commands.');
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '',
        setCodexCliModel: () => {},
        setCodexCliReasoningEffort: () => {},
        lifecycleService: {
          normalizeJsonPayload: (payload, fallback = {}) => (
            payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback
          ),
          asArray: (value) => (Array.isArray(value) ? value : [])
        }
      });

      const result = await controller.runAgentControllerCore({
        message: '/skill command-line pwd',
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-skill-command',
          events: []
        },
        requestId: 'req-skill-command'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(toolCallCount, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'skill_command');
      assert.equal(result.skill_command.status, 'completed');
      assert.equal(result.skill_command.skill_name, 'command-line');
      assert.equal(result.skill_command.tool_name, 'command-line');
      assert.match(String(result.skill_command.summary || ''), /completed successfully/i);
    });
  }
};