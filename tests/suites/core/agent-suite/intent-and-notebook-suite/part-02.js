module.exports = function registerAgentIntentAndNotebookSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent dispatcher gathers notebook-draft evidence before terminal draft tool when papers are requested', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'self-agent', 'ipc', 'agent-intent-dispatcher.js'));
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
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run directly for notebook drafts.');
        },
        getDefaultDataFilePath: () => '',
        lifecycleService: {
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async (toolName, args, options) => {
            toolCalls.push({ toolName, args, options });
            if (toolName === 'notebook-lookup') {
              return {
                ok: true,
                summary: 'Local notebooks show the expression run completed and purification is next.',
                result: {
                  status: 'matched',
                  summary: 'Local notebooks show the expression run completed and purification is next.',
                  items: [{ id: 'note-1' }]
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

      assert.deepEqual(toolCalls.map((call) => call.toolName), ['notebook-lookup', 'literature-search', 'notebook-draft']);
      const evidenceArgsValidation = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: toolCalls.slice(0, 2).map((call) => ({
          tool_name: call.toolName,
          arguments: call.args
        }))
      }, {
        selectedToolNames: ['notebook-lookup', 'literature-search']
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
      assert.equal(Object.prototype.hasOwnProperty.call(toolCalls[1].args, 'limit'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(toolCalls[1].args, 'max_per_source'), false);
      assert.equal(toolCalls[2].args.evidence_context.length, 2);
      assert.match(toolCalls[2].args.evidence_context[1].summary, /Recent papers/i);
      assert.equal(result.notebook_draft.status, 'proposal_ready');
      assert.equal(result.notebookDraft.id, 'draft-1');
      assert.equal(lifecycleStages.includes('notebook_draft_evidence_plan'), true);
      assert.equal(lifecycleStages.includes('notebook_draft_evidence_completed'), true);
    });
    test('intent dispatcher returns purchase clarification prompts without invoking the tool executor', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'self-agent', 'ipc', 'agent-intent-dispatcher.js'));
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
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run for purchase clarifications.');
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
  }
};
