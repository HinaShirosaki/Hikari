module.exports = function registerAgentIntentAndNotebookSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('controller core skips parser for unresolved inventory follow-up turns in the same chat session', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let inventoryLookupCalls = 0;
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
            requestId: 'req-inventory-followup',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for unresolved inventory follow-ups.');
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
          buildSessionKey: () => 'inventory-session',
          hasPendingSession: () => false,
          clearPendingSession: () => false,
          setPendingSession: () => null
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should not run for unresolved inventory follow-ups.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for unresolved inventory follow-ups.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for unresolved inventory follow-ups.');
          }
        },
        deepResearchRuntime: null,
        scienceMainUtils: {
          buildScienceRoutingFromParser: () => ({
            intent: 'general_science_question',
            entities: {},
            plan: {
              reasoning_effort: 1,
              needs_clarification: false,
              clarification_reason: ''
            }
          })
        },
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async ({ message, parserPayload }) => {
          inventoryLookupCalls += 1;
          return {
            status: 'matched',
            query: message,
            terms_used: [],
            source: 'fallback_json',
            backfilled_sql: false,
            items: [{
              id: 'inv-1',
              name: 'Tris-HCl'
            }],
            parser_intent: parserPayload.primary_intent
          };
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for unresolved inventory follow-ups.');
        },
        agentChatLogRuntime: {
          async getSession() {
            return {
              ok: true,
              rows: [{
                type: 'assistant-message',
                session_id: 'chat-followup-1',
                timestamp: '2026-04-12T21:40:00.000Z',
                meta: {
                  parser: {
                    primary_intent: 'inventory_lookup'
                  },
                  inventory_lookup: {
                    status: 'needs_more_info',
                    follow_up_questions: ['Which reagent do you want me to look up?']
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
        message: 'It was Tris-HCl.',
        conversation: [],
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-inventory-followup',
          events: []
        },
        requestId: 'req-inventory-followup',
        chatSessionId: 'chat-followup-1',
        chatSessionStoragePath: '/tmp/chat-followup-1'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(inventoryLookupCalls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'inventory_lookup');
      assert.match(String(result.parser.reasoning_summary || ''), /inventory_lookup context is still open/i);
      assert.equal(result.inventory_lookup.status, 'matched');
      assert.equal(result.inventory_lookup.parser_intent, 'inventory_lookup');
      const parserCompleted = lifecycleStages.find((item) => item.stage === 'parser_completed');
      assert.equal(Boolean(parserCompleted), true);
      assert.equal(parserCompleted.meta.skipped, true);
      assert.equal(parserCompleted.meta.resumed_from_pending, false);
    });
    test('controller core skips parser for unresolved record follow-up turns in the same chat session', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let recordLookupCalls = 0;
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
            requestId: 'req-record-followup',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for unresolved record follow-ups.');
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
          buildSessionKey: () => 'record-session',
          hasPendingSession: () => false,
          clearPendingSession: () => false,
          setPendingSession: () => null
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should not run for unresolved record follow-ups.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for unresolved record follow-ups.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for unresolved record follow-ups.');
          }
        },
        deepResearchRuntime: null,
        scienceMainUtils: {
          buildScienceRoutingFromParser: () => ({
            intent: 'general_science_question',
            entities: {},
            plan: {
              reasoning_effort: 1,
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
          throw new Error('Inventory lookup should not run for unresolved record follow-ups.');
        },
        executeRecordLookup: async ({ message, parserPayload }) => {
          recordLookupCalls += 1;
          return {
            status: 'matched',
            query: message,
            source: 'fallback_json',
            backfilled_sql: false,
            items: [{
              id: 'rec-1',
              title: 'Atlas notebook'
            }],
            parser_intent: parserPayload.primary_intent
          };
        },
        agentChatLogRuntime: {
          async getSession() {
            return {
              ok: true,
              rows: [{
                type: 'assistant-message',
                session_id: 'chat-followup-2',
                timestamp: '2026-04-12T21:41:00.000Z',
                meta: {
                  parser: {
                    primary_intent: 'record_lookup'
                  },
                  record_lookup: {
                    status: 'needs_more_info',
                    follow_up_questions: ['Which project record do you want me to find?']
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
            throw new Error('Tracked tool runner should not execute in this general science follow-up test.');
          }
        }
      });

      const result = await controller.runAgentControllerCore({
        message: 'Find the Atlas notebook entry.',
        conversation: [],
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-record-followup',
          events: []
        },
        requestId: 'req-record-followup',
        chatSessionId: 'chat-followup-2',
        chatSessionStoragePath: '/tmp/chat-followup-2'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(recordLookupCalls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'record_lookup');
      assert.match(String(result.parser.reasoning_summary || ''), /record_lookup context is still open/i);
      assert.equal(result.record_lookup.status, 'matched');
      assert.equal(result.record_lookup.parser_intent, 'record_lookup');
      const parserCompleted = lifecycleStages.find((item) => item.stage === 'parser_completed');
      assert.equal(Boolean(parserCompleted), true);
      assert.equal(parserCompleted.meta.skipped, true);
      assert.equal(parserCompleted.meta.resumed_from_pending, false);
    });
  }
};