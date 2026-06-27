module.exports = function registerAgentIntentAndNotebookSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent dispatcher gathers notebook-draft evidence before terminal draft tool when papers are requested', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-intent-dispatcher.js'));
      const toolLoading = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-loading.js'));
      const lifecycleStages = [];
      const toolCalls = [];
      const dispatcher = createAgentIntentDispatcher({
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        observability: {
          recordLifecycleEvent: (_recorder, event) => {
            lifecycleStages.push(event?.stage || '');
          }
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'session',
          hasPendingSession: () => false,
          clearPendingSession: () => {}
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should not run for hybrid notebook drafts.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for hybrid notebook drafts.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for hybrid notebook drafts.');
          }
        },
        scienceMainUtils: {
          buildScienceRoutingFromParser: () => ({
            intent: 'general_science_question',
            entities: {},
            plan: {
              reasoning_effort: 1
            }
          })
        },
        agentToolRuntime: {
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for notebook drafts.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run directly for notebook drafts.');
        },
        getDefaultDataFilePath: () => '',
        lifecycleService: {
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async (toolName, args, options) => {
            toolCalls.push({ toolName, args, options });
            if (toolName === 'record-lookup') {
              return {
                ok: true,
                summary: 'Local records show the expression run completed and purification is next.',
                result: {
                  status: 'matched',
                  summary: 'Local records show the expression run completed and purification is next.',
                  items: [{ id: 'record-1' }]
                }
              };
            }
            if (toolName === 'literature-search') {
              return {
                ok: true,
                summary: 'Recent papers support a low-temperature soluble expression follow-up.',
                result: {
                  status: 'completed',
                  summary: 'Recent papers support a low-temperature soluble expression follow-up.',
                  items: [{ id: 'paper-1' }],
                  citations: [{ source: 'paper', pointer: 'paper-1', reason: 'Matched recent expression method.' }]
                }
              };
            }
            if (toolName === 'notebook-draft') {
              return {
                ok: true,
                result: {
                  status: 'proposal_ready',
                  selected_protocol: {
                    id: 'prot-1',
                    name: 'Low Temperature Expression'
                  },
                  source_workflow: null,
                  missing_placeholders: [],
                  follow_up_questions: [],
                  proposal_summary: 'Low temperature expression follow-up.',
                  proposal: {
                    proposal_id: 'proposal-1'
                  },
                  notebook: {
                    id: 'draft-1'
                  },
                  summary: 'Planned notebook draft ready.'
                }
              };
            }
            throw new Error(`Unexpected tool ${toolName}`);
          }
        }
      });

      const result = {
        ok: true,
        parser: {
          primary_intent: 'notebook_draft'
        }
      };

      await dispatcher.dispatchIntent({
        payload: {},
        context: {
          provider: 'openai',
          endpoint: 'https://example.test',
          apiKey: 'key',
          model: 'gpt-test',
          message: 'Draft the next Atlas experiment based on recent papers.',
          promptConversation: [],
          snapshot: {},
          projectId: 'proj-1',
          projectName: 'Atlas',
          parserPayload: {
            primary_intent: 'notebook_draft',
            reasoning_effort: 0,
            direct_answer: null,
            needs_clarification: false,
            clarification_reason: null,
            entities: {
              project_name: 'Atlas',
              workflow_step: 'next experiment'
            },
            protocol_candidates: ['Low Temperature Expression']
          },
          traceContext: null,
          lifecycleRecorder: null,
        },
        result
      });

      assert.deepEqual(toolCalls.map((call) => call.toolName), ['record-lookup', 'literature-search', 'notebook-draft']);
      const evidenceArgsValidation = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: toolCalls.slice(0, 2).map((call) => ({
          tool_name: call.toolName,
          arguments: call.args
        }))
      }, {
        selectedToolNames: ['record-lookup', 'literature-search']
      });
      assert.equal(evidenceArgsValidation.ok, true);
      const draftArgsValidation = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [{
          tool_name: toolCalls[2].toolName,
          arguments: toolCalls[2].args
        }]
      }, {
        selectedToolNames: ['notebook-draft']
      });
      assert.equal(draftArgsValidation.ok, true);
      assert.equal(toolCalls[0].args.query.includes('Atlas'), true);
      assert.equal(toolCalls[1].args.prefer_recent, true);
      assert.equal(toolCalls[2].args.evidence_context.length, 2);
      assert.match(toolCalls[2].args.evidence_context[1].summary, /Recent papers/i);
      assert.equal(result.notebook_draft.status, 'proposal_ready');
      assert.equal(result.notebookDraft.id, 'draft-1');
      assert.equal(lifecycleStages.includes('notebook_draft_evidence_plan'), true);
      assert.equal(lifecycleStages.includes('notebook_draft_evidence_completed'), true);
    });
    test('intent dispatcher returns purchase clarification prompts without invoking the tool executor', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-intent-dispatcher.js'));
      let toolCallCount = 0;
      const dispatcher = createAgentIntentDispatcher({
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'session',
          hasPendingSession: () => false,
          clearPendingSession: () => {}
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should not run for purchase clarifications.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for purchase clarifications.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for purchase clarifications.');
          }
        },
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
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for purchase clarifications.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for purchase clarifications.');
        },
        getDefaultDataFilePath: () => '',
        lifecycleService: {
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async () => {
            toolCallCount += 1;
            return { ok: false, error: 'Should not be called.' };
          }
        }
      });

      const result = {
        ok: true,
        parser: {
          primary_intent: 'purchase_recommendation'
        }
      };

      await dispatcher.dispatchIntent({
        payload: {},
        context: {
          provider: 'openai',
          endpoint: 'https://example.test',
          apiKey: 'key',
          model: 'gpt-test',
          message: 'Can you recommend something to buy?',
          promptConversation: [],
          snapshot: {},
          projectId: '',
          projectName: '',
          parserPayload: {
            primary_intent: 'purchase_recommendation',
            reasoning_effort: 0,
            direct_answer: null,
            needs_clarification: true,
            clarification_reason: 'Please tell me which item type you want to buy.',
            entities: {}
          },
          traceContext: null,
          lifecycleRecorder: null,
        },
        result
      });

      assert.equal(toolCallCount, 0);
      assert.equal(result.purchase_recommendation.status, 'needs_more_info');
      assert.equal(result.purchase_recommendation.source, 'parser_only');
      assert.match(String(result.purchase_recommendation.follow_up_questions[0] || ''), /which item type/i);
    });
    test('controller core skips intent parser while protocol notebook context remains open', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
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
            requestId: 'req-pending-context',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped while the protocol context remains open.');
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
          buildSessionKey: () => 'open-protocol-session',
          hasPendingSession: () => true,
          clearPendingSession: () => false,
          setPendingSession: () => null,
          async runFlow({ parserPayload, message }) {
            return {
              status: 'completed',
              selected_protocol: {
                id: 'prot-1',
                name: 'Cell Prep'
              },
              candidate_matches: [],
              missing_placeholders: [],
              follow_up_questions: [],
              project_name: 'Atlas',
              notebook: {
                protocol: {
                  id: 'prot-1',
                  name: 'Cell Prep'
                },
                project: {
                  id: 'proj-1',
                  name: 'Atlas'
                },
                rendered_steps: [message, parserPayload.primary_intent]
              }
            };
          }
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should not run for pending protocol follow-ups.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for pending protocol follow-ups.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for pending protocol follow-ups.');
          }
        },
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
          throw new Error('Inventory lookup should not run for pending protocol follow-ups.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for pending protocol follow-ups.');
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
        message: 'The sample name was Atlas-7.',
        projectId: 'proj-1',
        projectName: 'Atlas',
        conversation: [],
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-pending-context',
          events: []
        },
        requestId: 'req-pending-context'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'protocol_to_notebook');
      assert.match(String(result.parser.reasoning_summary || ''), /context is still open/i);
      assert.equal(result.protocol_to_notebook.status, 'completed');
      assert.equal(result.protocol_to_notebook.selected_protocol.name, 'Cell Prep');
      const parserCompleted = lifecycleStages.find((item) => item.stage === 'parser_completed');
      assert.equal(Boolean(parserCompleted), true);
      assert.equal(parserCompleted.meta.skipped, true);
      assert.equal(parserCompleted.meta.resumed_from_pending, true);
    });
  }
};