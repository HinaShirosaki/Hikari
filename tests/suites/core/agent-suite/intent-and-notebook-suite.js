module.exports = function registerAgentIntentAndNotebookSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent parser normalizes compact inventory payloads', () => {
      const raw = {
        primary_intent: 'inventory_lookup',
        inventory_search: {
          normalized_query: 'Tris-HCl',
          candidate_terms: ['Tris-HCl', 'tris', 'Tris-HCl'],
          aliases: ['tris(hydroxymethyl)aminomethane'],
          search_mode: 'exact_then_alias_then_fuzzy'
        }
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'inventory_lookup');
      assert.equal(result.payload.reasoning_effort, 0);
      assert.equal(result.payload.needs_clarification, false);
      assert.deepEqual(result.payload.entities, {});
      assert.equal(result.payload.inventory_search.normalized_query, 'Tris-HCl');
      assert.equal(Array.isArray(result.payload.inventory_search.candidate_terms), true);
      assert.equal(result.payload.inventory_search.candidate_terms.length >= 2, true);
      assert.deepEqual(result.payload.protocol_candidates, []);
      assert.match(result.payload.reasoning_summary, /inventory_lookup/i);
    });

    test('intent parser normalizes protocol candidates for protocol_to_notebook intent', () => {
      const raw = {
        primary_intent: 'protocol_to_notebook',
        protocol_candidates: ['HEK293 Transfection', 'HEK293 transfection', 'Expi293 Transfection']
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'protocol_to_notebook');
      assert.equal(Array.isArray(result.payload.protocol_candidates), true);
      assert.equal(result.payload.protocol_candidates.length <= 3, true);
      assert.equal(result.payload.protocol_candidates[0], 'HEK293 Transfection');
    });

    test('intent parser preserves science reasoning effort and defaults missing science effort to level 1', () => {
      const explicit = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        reasoning_effort: 2
      });
      assert.equal(explicit.ok, true);
      assert.equal(explicit.payload.reasoning_effort, 2);

      const defaulted = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'project_science_question'
      });
      assert.equal(defaulted.ok, true);
      assert.equal(defaulted.payload.reasoning_effort, 1);
    });

    test('intent parser keeps direct_answer only for reasoning-effort 0 science intents', () => {
      const direct = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        reasoning_effort: 0,
        direct_answer: 'Imidazole competes with histidines for nickel binding sites on the resin.'
      });
      assert.equal(direct.ok, true);
      assert.match(String(direct.payload.direct_answer || ''), /nickel binding sites/i);

      const routed = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'project_science_question',
        reasoning_effort: 1,
        direct_answer: 'This should be ignored because the request should enter the loop.'
      });
      assert.equal(routed.ok, true);
      assert.equal(routed.payload.direct_answer, null);
    });

    test('intent parser keeps protocol candidates for notebook_draft intent', () => {
      const raw = {
        primary_intent: 'notebook_draft',
        protocol_candidates: ['Viability Assay', 'cell viability assay']
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'notebook_draft');
      assert.deepEqual(result.payload.protocol_candidates, ['Viability Assay', 'cell viability assay']);
    });

    test('intent parser defaults unclear and mixed_request to clarification-required payloads', () => {
      const unclear = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'unclear'
      });
      assert.equal(unclear.ok, true);
      assert.equal(unclear.payload.needs_clarification, true);
      assert.match(String(unclear.payload.clarification_reason || ''), /missing detail|route this request/i);

      const mixed = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'mixed_request'
      });
      assert.equal(mixed.ok, true);
      assert.equal(mixed.payload.needs_clarification, true);
      assert.match(String(mixed.payload.clarification_reason || ''), /tell me which task to handle first|split the request/i);
    });

    test('intent parser rejects legacy confidence and secondary_intents fields', () => {
      const withConfidence = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        confidence: 0.91
      });
      assert.equal(withConfidence.ok, false);
      assert.match(String(withConfidence.error || ''), /must not include confidence/i);

      const withSecondary = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        secondary_intents: ['inventory_lookup']
      });
      assert.equal(withSecondary.ok, false);
      assert.match(String(withSecondary.error || ''), /secondary_intents/i);
    });

    test('intent parser rejects protocol_candidates lists longer than 3', () => {
      const result = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'protocol_to_notebook',
        protocol_candidates: ['A', 'B', 'C', 'D']
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error || ''), /at most 3/i);
    });

    test('intent parser normalizes purchase recommendation payloads and forces reasoning_effort to 0', () => {
      const result = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'shopping_recommendation',
        reasoning_effort: 2,
        entities: {
          product_query: 'endotoxin-free pipette tips',
          required_attributes: 'endotoxin-free, metal-free',
          excluded_attributes: 'latex',
          budget_preference: 'cheap'
        },
        protocol_candidates: ['Should be cleared']
      });

      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'purchase_recommendation');
      assert.equal(result.payload.reasoning_effort, 0);
      assert.equal(result.payload.entities.product_query, 'endotoxin-free pipette tips');
      assert.equal(result.payload.entities.required_attributes, 'endotoxin-free, metal-free');
      assert.equal(result.payload.entities.excluded_attributes, 'latex');
      assert.equal(result.payload.entities.budget_preference, 'cheap');
      assert.deepEqual(result.payload.protocol_candidates, []);
      assert.deepEqual(result.payload.inventory_search, {
        normalized_query: null,
        candidate_terms: [],
        aliases: [],
        search_mode: null
      });
    });

    test('intent parser maps aliases and typo variants to canonical intents', () => {
      assert.equal(agentIntentParser.normalizeParserIntent('data_analysis_or_coding'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('coding-data-analysis'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('inventory_loopup'), 'inventory_lookup');
      assert.equal(agentIntentParser.normalizeParserIntent('record_loopup'), 'record_lookup');
      assert.equal(agentIntentParser.normalizeParserIntent('product_recommendation'), 'purchase_recommendation');
      assert.equal(agentIntentParser.normalizeParserIntent('shopping-search'), 'purchase_recommendation');
    });

    test('science routing promotes unclear parser intent into deep general science reasoning', () => {
      const { createAgentScienceMainUtils } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'agent-science-main-utils.js'));
      const utils = createAgentScienceMainUtils({
        asArray: (value) => (Array.isArray(value) ? value : []),
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        uniqueStrings: (values, max = 50) => {
          const seen = new Set();
          const output = [];
          (Array.isArray(values) ? values : []).forEach((value) => {
            const text = String(value || '').trim();
            if (!text) {
              return;
            }
            const key = text.toLowerCase();
            if (seen.has(key) || output.length >= max) {
              return;
            }
            seen.add(key);
            output.push(text);
          });
          return output;
        },
        clamp: (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)),
        normalizeRoutingPayload: (value) => (value && typeof value === 'object' ? value : {}),
        mapCanonicalIntentToExecutionIntent: agentIntentParser.mapCanonicalIntentToExecutionIntent,
        normalizeParserEntitiesToRoutingEntities: agentIntentParser.normalizeParserEntitiesToRoutingEntities
      });

      const routing = utils.buildScienceRoutingFromParser({
        primary_intent: 'unclear',
        reasoning_effort: 0,
        needs_clarification: true,
        clarification_reason: 'The request is too vague to route directly.',
        entities: {
          requested_output: 'mechanistic explanation'
        },
        reasoning_summary: 'The user asked an intentless science question.'
      });

      assert.equal(routing.intent, 'general_science_question');
      assert.equal(routing.plan.reasoning_effort, 2);
      assert.equal(routing.plan.needs_clarification, true);
      assert.equal(routing.classifier.fallbackAttempted, true);
      assert.equal(routing.classifier.fallbackUsed, true);
    });

    test('intent dispatcher routes unclear parser intents into general science execution', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-intent-dispatcher.js'));
      let receivedScienceInput = null;
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
          runGeneralScienceQuestion: async (input) => {
            receivedScienceInput = input;
            return {
              status: 'completed',
              answer: 'Fallback science answer.'
            };
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for unclear fallback.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for unclear fallback.');
          }
        },
        deepResearchRuntime: null,
        scienceMainUtils: {
          buildScienceRoutingFromParser: () => ({
            intent: 'general_science_question',
            entities: {},
            plan: {
              reasoning_effort: 2,
              needs_clarification: true,
              clarification_reason: 'The question needs broader reasoning.'
            }
          })
        },
        agentToolRuntime: {
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for unclear fallback.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for unclear fallback.');
        },
        getDefaultDataFilePath: () => '',
        lifecycleService: {
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async () => ({
            ok: false,
            error: 'No tool should run in this test.'
          })
        }
      });

      const result = {
        ok: true,
        parser: {
          primary_intent: 'unclear'
        }
      };

      await dispatcher.dispatchIntent({
        payload: {},
        context: {
          provider: 'openai',
          endpoint: 'https://example.test',
          apiKey: 'key',
          model: 'gpt-test',
          message: 'Help with that science thing from earlier.',
          promptConversation: [],
          snapshot: {},
          projectId: '',
          projectName: '',
          parserPayload: {
            primary_intent: 'unclear',
            reasoning_effort: 0,
            direct_answer: null,
            needs_clarification: true,
            clarification_reason: 'The question needs broader reasoning.',
            entities: {}
          },
          traceContext: null,
          lifecycleRecorder: null,
          deepResearchEnabled: false
        },
        result
      });

      assert.equal(receivedScienceInput !== null, true);
      assert.equal(receivedScienceInput.routing.intent, 'general_science_question');
      assert.equal(receivedScienceInput.routing.plan.reasoning_effort, 2);
      assert.equal(result.general_science_question.status, 'completed');
    });

    test('intent dispatcher routes purchase recommendations through the tracked tool executor', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-intent-dispatcher.js'));
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
            throw new Error('Science runtime should not run for purchase recommendations.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should not run for purchase recommendations.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should not run for purchase recommendations.');
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
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for purchase recommendations.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for purchase recommendations.');
        },
        getDefaultDataFilePath: () => '',
        lifecycleService: {
          asArray: (value) => (Array.isArray(value) ? value : []),
          createLifecycleToolRunner: () => async (toolName, args, options) => {
            toolCalls.push({ toolName, args, options });
            return {
              ok: true,
              result: {
                status: 'matched',
                query: 'endotoxin-free metal-free pipette tips',
                source: 'web',
                filters: {
                  required_terms: ['endotoxin-free', 'metal-free'],
                  excluded_terms: ['latex'],
                  budget_preference: 'cheap'
                },
                items: [
                  {
                    id: 'item-1',
                    title: 'Endotoxin-Free Metal-Free Pipette Tips',
                    vendor: 'Lab Vendor',
                    price_text: '$14.99',
                    price_value: 14.99,
                    currency: 'USD',
                    image_url: 'https://vendor.example/item-1.png',
                    product_url: 'https://vendor.example/item-1'
                  }
                ],
                follow_up_questions: [],
                summary: 'Found 1 purchase recommendation.'
              }
            };
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
          message: 'Find cheap endotoxin-free metal-free pipette tips.',
          promptConversation: [],
          snapshot: {},
          projectId: '',
          projectName: '',
          parserPayload: {
            primary_intent: 'purchase_recommendation',
            reasoning_effort: 0,
            direct_answer: null,
            needs_clarification: false,
            clarification_reason: null,
            entities: {
              product_query: 'pipette tips',
              required_attributes: 'endotoxin-free, metal-free',
              excluded_attributes: 'latex',
              budget_preference: 'cheap'
            }
          },
          traceContext: null,
          lifecycleRecorder: null,
          deepResearchEnabled: false
        },
        result
      });

      assert.equal(toolCalls.length, 1);
      assert.equal(toolCalls[0].toolName, 'purchase-recommendation');
      assert.equal(toolCalls[0].args.query, 'pipette tips');
      assert.deepEqual(toolCalls[0].args.required_terms, ['endotoxin-free', 'metal-free']);
      assert.deepEqual(toolCalls[0].args.excluded_terms, ['latex']);
      assert.equal(toolCalls[0].args.budget_preference, 'cheap');
      assert.equal(toolCalls[0].options.allowWriteTools, false);
      assert.equal(result.purchase_recommendation.status, 'matched');
      assert.equal(result.purchase_recommendation.items.length, 1);
      assert.deepEqual(result.purchase_recommendation.filters.required_terms, ['endotoxin-free', 'metal-free']);
      assert.equal(lifecycleStages.includes('purchase_recommendation_started'), true);
      assert.equal(lifecycleStages.includes('purchase_recommendation_completed'), true);
    });

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
        deepResearchRuntime: null,
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
          deepResearchEnabled: false
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
          deepResearchEnabled: false
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
        deepResearchRuntime: null,
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
        deepResearchRuntime: null,
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
        deepResearchRuntime: null,
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

    test('controller core routes Codex provider through the Codex-owned agent runtime', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let codexRunInput = null;
      let setModelValue = '';
      let setReasoningValue = '';
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
          resolveAgentLlmSource: () => ({
            provider: 'codex',
            endpoint: '',
            apiKey: '',
            model: 'gpt-5.4'
          }),
          resolveAgentProvider: () => 'codex',
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: true }),
          createAgentLlmTraceContext: () => ({
            enabled: true,
            requestId: 'req-codex-agent-controller',
            logPath: '',
            provider: 'codex',
            model: 'gpt-5.4',
            rows: [
              {
                stage: 'codex_agent_runtime',
                provider: 'codex',
                model: 'gpt-5.4',
                summary: 'Codex runtime ran.'
              }
            ],
            entries: []
          }),
          requestText: async () => {
            throw new Error('Selection insight text path should be skipped for Codex-owned lifecycle.');
          },
          requestWebSearch: async () => {
            throw new Error('Selection insight web-search path should be skipped for Codex-owned lifecycle.');
          },
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for Codex-owned lifecycle.');
          }
        },
        observability: {
          recordLifecycleEvent: (_recorder, event = {}) => {
            lifecycleStages.push(event.stage || '');
          }
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'codex-agent-controller',
          hasPendingSession: () => {
            throw new Error('Open context parser bypass should be skipped for Codex-owned lifecycle.');
          }
        },
        scienceReasoningLoopRuntime: {
          runGeneralScienceQuestion: async () => {
            throw new Error('Science runtime should be skipped for Codex-owned lifecycle.');
          },
          runProjectScienceQuestion: async () => {
            throw new Error('Project science runtime should be skipped for Codex-owned lifecycle.');
          },
          runResultAnalysis: async () => {
            throw new Error('Result-analysis runtime should be skipped for Codex-owned lifecycle.');
          }
        },
        deepResearchRuntime: null,
        codexAgentRuntime: {
          async run(input = {}) {
            codexRunInput = input;
            return {
              ok: true,
              provider: 'codex',
              model: input.model,
              parser: {
                primary_intent: 'codex_agent',
                needs_clarification: false,
                reasoning_summary: 'Codex handled the whole turn.',
                entities: {},
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: []
              },
              codex_agent: {
                status: 'completed',
                answer: 'Codex final answer.',
                follow_up_questions: [],
                citations: [],
                reasoning_summary: 'Codex handled the whole turn.'
              },
              thinking_trace: {
                final_synthesize: 'Codex synthesized the answer.'
              }
            };
          }
        },
        scienceMainUtils: {},
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          listSkills: () => [],
          parseSkillInvocation: () => ({
            type: 'none',
            active_skill_names: [],
            cleaned_message: 'Why was SUMO1 weak?'
          }),
          buildSkillsPromptPayload: () => ({
            active_skills_prompt: '',
            skills_catalog_prompt: ''
          })
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run before Codex agent runtime.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run before Codex agent runtime.');
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '',
        setCodexCliModel: (model) => {
          setModelValue = model;
        },
        setCodexCliReasoningEffort: (reasoningEffort) => {
          setReasoningValue = reasoningEffort;
        },
        lifecycleService: {
          normalizeJsonPayload: (payload, fallback = {}) => (
            payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback
          ),
          asArray: (value) => (Array.isArray(value) ? value : [])
        }
      });

      const result = await controller.runAgentControllerCore({
        message: 'Why was SUMO1 weak?',
        projectId: 'proj-1',
        projectName: 'Atlas',
        conversation: [
          { role: 'user', text: 'Open Atlas.' }
        ],
        attachments: [
          {
            name: 'atlas.pdf',
            kind: 'file',
            dataUrl: 'data:application/pdf;base64,abc'
          }
        ],
        llm: {
          provider: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high'
        },
        agent: {
          selectionInsight: {
            actionType: 'what_is_it',
            selectedText: 'SUMO1'
          }
        },
        stateSnapshot: {
          data_file_path: '/tmp/enana-data.json',
          settings: {
            agent: {
              developerMode: true
            }
          }
        }
      }, {
        requestId: 'req-codex-agent-controller',
        chatSessionId: 'hikari-chat-1',
        codexSessionId: 'codex-chat-session-1',
        lifecycleRecorder: {
          requestId: 'req-codex-agent-controller',
          events: []
        }
      });

      assert.equal(parserCallCount, 0);
      assert.equal(setModelValue, 'gpt-5.4');
      assert.equal(setReasoningValue, 'high');
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'codex_agent');
      assert.equal(result.codex_agent.answer, 'Codex final answer.');
      assert.equal(result.developer_trace.length, 1);
      assert.equal(codexRunInput.model, 'gpt-5.4');
      assert.equal(codexRunInput.reasoningEffort, 'high');
      assert.equal(codexRunInput.projectName, 'Atlas');
      assert.equal(codexRunInput.selectionInsight.selectedText, 'SUMO1');
      assert.equal(codexRunInput.attachments[0].name, 'atlas.pdf');
      assert.deepEqual(codexRunInput.conversation, []);
      assert.equal(codexRunInput.chatSessionId, 'hikari-chat-1');
      assert.equal(codexRunInput.codexSessionId, 'codex-chat-session-1');
      assert.equal(lifecycleStages.includes('controller_codex_agent'), true);
      assert.equal(lifecycleStages.includes('controller_intent_only'), false);
    });

    test('controller core bypasses the parser for selection insight explanations and uses direct text requests', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let requestTextCallCount = 0;
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
          resolveAgentLlmSource: () => ({
            provider: 'openai',
            endpoint: 'https://example.test',
            apiKey: 'key',
            model: 'gpt-test'
          }),
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-selection-insight-what',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          requestText: async (options = {}) => {
            requestTextCallCount += 1;
            assert.equal(options.stage, 'selection_insight_what_is_it');
            assert.match(String(options.userPrompt || ''), /Selected text: "AviTag"/);
            return {
              ok: true,
              text: 'AviTag is a short peptide tag that can be enzymatically biotinylated for capture and detection.'
            };
          },
          requestWebSearch: async () => {
            throw new Error('Web search should not run for the explanation path.');
          },
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for selection insights.');
          }
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'selection-insight',
          hasPendingSession: () => false
        },
        scienceReasoningLoopRuntime: {},
        deepResearchRuntime: null,
        scienceMainUtils: {},
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for selection insights.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for selection insights.');
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
        message: 'Internal selection insight prompt.',
        projectId: 'proj-1',
        projectName: 'Atlas',
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        agent: {
          selectionInsight: {
            actionType: 'what_is_it',
            selectedText: 'AviTag',
            contextText: 'Use AviTag protein biotinylation before purification.',
            recordName: 'Avi-Tag Protein Biotinylation',
            segmentLabel: 'Materials'
          }
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-selection-insight-what',
          events: []
        },
        requestId: 'req-selection-insight-what'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(requestTextCallCount, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'project_science_question');
      assert.equal(result.project_science_question.status, 'completed');
      assert.match(String(result.project_science_question.answer || ''), /AviTag is a short peptide tag/i);
    });

    test('controller core bypasses the parser for selection insight purchase recommendations and uses direct web search', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      let requestTextCallCount = 0;
      let requestWebSearchCallCount = 0;
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
          resolveAgentLlmSource: () => ({
            provider: 'openai',
            endpoint: 'https://example.test',
            apiKey: 'key',
            model: 'gpt-test'
          }),
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-selection-insight-buy',
            logPath: '',
            provider: 'openai',
            model: 'gpt-test',
            rows: [],
            entries: []
          }),
          requestText: async (options = {}) => {
            requestTextCallCount += 1;
            assert.equal(options.stage, 'selection_insight_where_to_buy_summary');
            return {
              ok: true,
              text: 'Sigma and Fisher look like the closest likely vendors here, but verify the exact product specification before ordering.'
            };
          },
          requestWebSearch: async (options = {}) => {
            requestWebSearchCallCount += 1;
            assert.equal(options.stage, 'selection_insight_where_to_buy');
            assert.match(String(options.query || ''), /AviTag/i);
            return {
              ok: true,
              results: [
                {
                  title: 'AviTag Biotinylation Reagent Kit',
                  url: 'https://www.sigmaaldrich.com/item/avitag-kit',
                  summary: 'Protein biotinylation kit for AviTag workflows.',
                  source_domain: 'www.sigmaaldrich.com'
                },
                {
                  title: 'AviTag Labeling Reagents',
                  url: 'https://www.fishersci.com/shop/products/avitag-labeling',
                  summary: 'Catalog listing for AviTag-compatible labeling reagents.',
                  source_domain: 'www.fishersci.com'
                }
              ]
            };
          },
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Intent parser should be skipped for selection insights.');
          }
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'selection-insight',
          hasPendingSession: () => false
        },
        scienceReasoningLoopRuntime: {},
        deepResearchRuntime: null,
        scienceMainUtils: {},
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          buildAgentSystemPrompt: () => 'system prompt'
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for selection insights.');
        },
        executeRecordLookup: async () => {
          throw new Error('Record lookup should not run for selection insights.');
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
        message: 'Internal selection insight prompt.',
        llm: {
          provider: 'openai',
          model: 'gpt-test'
        },
        agent: {
          selectionInsight: {
            actionType: 'where_to_buy',
            selectedText: 'AviTag reagent',
            contextText: 'Use AviTag protein biotinylation before purification.',
            recordName: 'Avi-Tag Protein Biotinylation',
            segmentLabel: 'Materials'
          }
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-selection-insight-buy',
          events: []
        },
        requestId: 'req-selection-insight-buy'
      });

      assert.equal(parserCallCount, 0);
      assert.equal(requestWebSearchCallCount, 1);
      assert.equal(requestTextCallCount, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'purchase_recommendation');
      assert.equal(result.purchase_recommendation.status, 'matched');
      assert.equal(result.purchase_recommendation.items.length, 2);
      assert.equal(result.purchase_recommendation.items[0].vendor, 'sigmaaldrich.com');
      assert.match(String(result.purchase_recommendation.summary || ''), /Sigma and Fisher/i);
    });

    test('intent parser prompt includes recent transcript and active project context', () => {
      const prompt = agentIntentParser.buildIntentParserPrompt({
        message: 'Do we have PEI in stock for Atlas lot 7?',
        conversation: [
          { role: 'user', text: 'Too old and should be dropped.' },
          { role: 'assistant', text: 'First retained assistant note.' },
          { role: 'user', text: 'We are in the Cancer Study workspace.' },
          { role: 'assistant', text: 'Last week we checked Tris.' },
          { role: 'user', text: 'Need the latest PEI stock and location.' },
          { role: 'assistant', text: 'I can look at recent inventory.' },
          { role: 'user', text: 'Focus on Atlas lot 7.' },
          { role: 'assistant', text: 'I will use the current project context.' },
          { role: 'user', text: 'Please include whether it is reserved.' }
        ],
        projectName: 'Cancer Study'
      });
      assert.equal(prompt.includes('Active project context: Cancer Study'), true);
      assert.equal(prompt.includes('Recent conversation:'), true);
      assert.equal(prompt.includes('1. assistant: First retained assistant note.'), true);
      assert.equal(prompt.includes('8. user: Please include whether it is reserved.'), true);
      assert.equal(prompt.includes('Too old and should be dropped.'), false);
      assert.equal(prompt.includes('User message:\nDo we have PEI in stock for Atlas lot 7?'), true);
    });

    test('intent parser catalog stays in sync with allowed intents and rendered prompt', () => {
      const catalog = agentIntentParser.INTENT_PARSER_CATALOG;
      assert.deepEqual(catalog.map((entry) => entry.name), agentIntentParser.PARSER_ALLOWED_INTENTS);
      assert.equal(typeof catalog[0].rules, 'string');
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Allowed intents:/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Science reasoning_effort: 0=stable direct answer/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /If unsure, choose 1\./);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Intent guide:/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /"primary_intent": "one allowed intent"/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Add only the extra fields listed for the chosen intent\./);
      assert.equal(/## Examples/.test(agentIntentParser.INTENT_PARSER_PROMPT), false);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Omit all other keys and empty placeholders\./);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Standalone instructional wet-lab protocol requests/i);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /how to express X/i);

      let previousHeadingIndex = -1;
      agentIntentParser.PARSER_ALLOWED_INTENTS.forEach((intentName) => {
        const heading = `- ${intentName}:`;
        const headingIndex = agentIntentParser.INTENT_PARSER_PROMPT.indexOf(heading);
        assert.notEqual(headingIndex, -1);
        assert.equal(headingIndex > previousHeadingIndex, true);
        previousHeadingIndex = headingIndex;
      });

      const customCatalog = catalog.map((entry) => ({
        ...entry,
        specific_output_append: Array.isArray(entry.specific_output_append)
          ? entry.specific_output_append.map((row) => ({ ...row }))
          : []
      }));
      const inventoryEntry = customCatalog.find((entry) => entry.name === 'inventory_lookup');
      inventoryEntry.description = 'Custom inventory description.';
      inventoryEntry.rules = 'Custom inventory rule.';
      inventoryEntry.example_input = 'Where is the custom PEI bottle?';
      inventoryEntry.specific_output_append = [
        {
          key: 'custom_inventory_field',
          description: 'Custom inventory append description.'
        }
      ];
      const renderedPrompt = agentIntentParser.buildIntentCatalogPrompt(customCatalog);
      assert.equal(renderedPrompt.includes('- inventory_lookup:'), true);
      assert.equal(renderedPrompt.includes('Custom inventory description.'), true);
      assert.equal(renderedPrompt.includes('Custom inventory rule.'), true);
      assert.equal(renderedPrompt.includes('Extras: custom_inventory_field.'), true);
      assert.equal(renderedPrompt.includes('Custom inventory append description.'), false);
      assert.equal(renderedPrompt.includes('User: "Where is the custom PEI bottle?"'), false);
    });

    test('intent parser catalog validation rejects malformed entries', () => {
      const catalogPath = path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'intent', 'agent-intent.json');
      const invalidCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      delete invalidCatalog.inventory_lookup.specific_output_append;
      assert.throws(
        () => agentIntentParser.validateIntentCatalog(invalidCatalog),
        /specific_output_append/
      );
    });

    test('protocol matching runtime selects exact match deterministically', async () => {
      const runtime = agentProtocolMatching.createProtocolMatchingRuntime();
      const selection = await runtime.selectProtocol({
        protocols: [
          {
            id: 'prot-1',
            name: 'HEK293 Transfection',
            purpose: 'Transfect HEK293 cells.',
            aliases: ['293 transfection'],
            steps: [
              { id: 'step-1', text: 'Seed HEK293 cells.' },
              { id: 'step-2', text: 'Add transfection reagent.' }
            ]
          },
          {
            id: 'prot-2',
            name: 'Protein Purification',
            purpose: 'Purify His-tagged protein.',
            steps: [
              { id: 'step-1', text: 'Bind lysate to resin.' }
            ]
          }
        ],
        protocolCandidates: ['HEK293 Transfection'],
        message: 'I did the HEK293 transfection today.',
        conversation: [],
        parserPayload: {
          entities: {
            activity_type: 'transfection',
            workflow_step: null,
            protocol_name: 'HEK293 Transfection'
          }
        }
      });
      assert.equal(selection.selection_method, 'deterministic');
      assert.equal(selection.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(selection.ranked_matches.length >= 1, true);
      assert.equal(selection.ranked_matches[0].score > 0, true);
    });

    test('protocol matching runtime falls back to highest rank when llm tie-break output is invalid', async () => {
      const runtime = agentProtocolMatching.createProtocolMatchingRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: false,
          error: 'not json'
        })
      });
      const result = await runtime.resolveProtocolWinner({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        matches: [
          { id: 'prot-1', name: 'Protocol A', purpose: 'first', steps: [], score: 57 },
          { id: 'prot-2', name: 'Protocol B', purpose: 'second', steps: [], score: 56 }
        ],
        message: 'Use the closer match.',
        conversation: [],
        parserPayload: { entities: {} }
      });
      assert.equal(result.selection_method, 'deterministic_fallback');
      assert.equal(result.selected.name, 'Protocol A');
    });

    test('protocol notebook context control closes completed action context', () => {
      const { createProtocolNotebookContextControl } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-protocol-notebook-context-control.js'
      ));
      let nowMs = Date.parse('2026-04-10T12:00:00.000Z');
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const control = createProtocolNotebookContextControl({
        cleanText,
        now: () => new Date(nowMs).toISOString(),
        nowMs: () => nowMs,
        store: new Map()
      });
      const sessionKey = control.buildSessionKey({
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      control.setPendingSession(sessionKey, {
        created_at: '2026-04-10T11:55:00.000Z',
        selected_protocol: {
          id: 'prot-1',
          name: 'Cell Prep'
        },
        follow_up_questions: ['Please provide sample name.']
      });
      assert.equal(control.hasPendingSession(sessionKey), true);

      const syncResult = control.syncActionContext(sessionKey, {
        status: 'completed'
      });
      assert.equal(syncResult.context_closed, true);
      assert.equal(control.hasPendingSession(sessionKey), false);
    });

    test('protocol notebook runtime closes pending context after completed action', async () => {
      const { createProtocolNotebookRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-protocol-notebook.js'
      ));
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const asArray = (value) => (Array.isArray(value) ? value : []);
      const uniqueStrings = (values, max = 50) => {
        const seen = new Set();
        const out = [];
        asArray(values).forEach((value) => {
          const normalized = cleanText(value, 220);
          if (!normalized) {
            return;
          }
          const key = normalized.toLowerCase();
          if (seen.has(key) || out.length >= max) {
            return;
          }
          seen.add(key);
          out.push(normalized);
        });
        return out;
      };
      let nowMs = Date.parse('2026-04-10T12:00:00.000Z');
      const runtime = createProtocolNotebookRuntime({
        asArray,
        cleanText,
        uniqueStrings,
        pickTopMatches: (items, _selector, _query, count = 1) => asArray(items).slice(0, count),
        now: () => new Date(nowMs).toISOString(),
        nowMs: () => nowMs,
        protocolNotebookPendingSessions: new Map(),
        getAgentRuntimeFactory: (runtimeName) => {
          if (runtimeName === 'protocol-matching') {
            return () => ({
              normalizeProtocolRecord(protocol = {}, index = 0) {
                return {
                  id: String(protocol.id || `protocol-${index + 1}`),
                  name: String(protocol.name || ''),
                  project_name: String(protocol.project_name || protocol.projectName || ''),
                  steps: Array.isArray(protocol.steps) ? protocol.steps : []
                };
              },
              async selectProtocol({ protocols = [] } = {}) {
                const selected = Array.isArray(protocols) ? protocols[0] : null;
                return {
                  selected_protocol: selected,
                  selection_method: 'deterministic',
                  rationale: 'Selected the only available protocol.',
                  ranked_matches: selected
                    ? [{ id: selected.id, name: selected.name, score: 120 }]
                    : []
                };
              },
              mapCandidateMatchesForOutput(matches = []) {
                return asArray(matches).map((match) => ({
                  id: cleanText(match.id, 120),
                  name: cleanText(match.name, 220),
                  score: Number.isFinite(Number(match.score)) ? Number(match.score) : 0
                }));
              }
            });
          }
          if (runtimeName === 'notebook-generation') {
            return () => ({
              async generateNotebook({ selectedProtocol, project } = {}) {
                return {
                  status: 'completed',
                  notebook: {
                    protocol: {
                      id: selectedProtocol?.id || '',
                      name: selectedProtocol?.name || ''
                    },
                    project: {
                      id: project?.id || '',
                      name: project?.name || ''
                    },
                    rendered_steps: ['Prepare Atlas-7 sample.'],
                    save: {
                      status: 'ready_for_save'
                    },
                    entry_template: {
                      result: 'Notebook draft completed for Cell Prep.'
                    }
                  },
                  known_values: {
                    sample_name: 'Atlas-7'
                  },
                  missing_placeholders: [],
                  follow_up_questions: []
                };
              }
            });
          }
          return null;
        }
      });
      const sessionKey = runtime.buildSessionKey({
        projectId: 'proj-1',
        projectName: 'Atlas'
      });
      runtime.setPendingSession(sessionKey, {
        created_at: '2026-04-10T11:55:00.000Z',
        selected_protocol: {
          id: 'prot-1',
          name: 'Cell Prep'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload_project_id'
        },
        follow_up_questions: ['Please provide sample name.']
      });
      assert.equal(runtime.hasPendingSession(sessionKey), true);

      const result = await runtime.runFlow({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'The sample name was Atlas-7.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Cell Prep',
              project_name: 'Atlas',
              steps: []
            }
          ]
        },
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          entities: {
            project_name: 'Atlas',
            protocol_name: 'Cell Prep'
          },
          protocol_candidates: ['Cell Prep']
        },
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.selected_protocol.name, 'Cell Prep');
      assert.equal(runtime.hasPendingSession(sessionKey), false);
    });

    test('protocol notebook runtime can route protocol and notebook work through the agent sub-app API layer', async () => {
      const { createProtocolNotebookRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-protocol-notebook.js'
      ));
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const asArray = (value) => (Array.isArray(value) ? value : []);
      const uniqueStrings = (values, max = 50) => {
        const seen = new Set();
        const out = [];
        asArray(values).forEach((value) => {
          const normalized = cleanText(value, 220);
          if (!normalized) {
            return;
          }
          const key = normalized.toLowerCase();
          if (seen.has(key) || out.length >= max) {
            return;
          }
          seen.add(key);
          out.push(normalized);
        });
        return out;
      };
      const calls = [];
      const runtime = createProtocolNotebookRuntime({
        asArray,
        cleanText,
        uniqueStrings,
        pickTopMatches: (items, _selector, _query, count = 1) => asArray(items).slice(0, count),
        protocolNotebookPendingSessions: new Map(),
        agentAppApi: {
          protocol: {
            listAgentProtocols() {
              calls.push('protocol.listAgentProtocols');
              return [
                {
                  id: 'prot-1',
                  name: 'Cell Prep',
                  project_id: 'proj-1',
                  project_name: 'Atlas',
                  steps: [{ id: 'step-1', text: 'Prepare cells.' }]
                }
              ];
            },
            normalizeAgentProtocol(protocol = {}) {
              return {
                id: String(protocol.id || ''),
                name: String(protocol.name || ''),
                project_id: String(protocol.project_id || ''),
                project_name: String(protocol.project_name || ''),
                steps: Array.isArray(protocol.steps) ? protocol.steps : []
              };
            },
            async matchForNotebook({ protocols = [] } = {}) {
              calls.push('protocol.matchForNotebook');
              return {
                selected_protocol: Array.isArray(protocols) ? protocols[0] : null,
                selection_method: 'agent_app_api',
                rationale: 'Matched through the agent sub-app API.',
                ranked_matches: [{ id: 'prot-1', name: 'Cell Prep', score: 130 }]
              };
            }
          },
          notebook: {
            async generateFromProtocol({ selectedProtocol, project } = {}) {
              calls.push('notebook.generateFromProtocol');
              return {
                status: 'completed',
                notebook: {
                  protocol: {
                    id: selectedProtocol?.id || '',
                    name: selectedProtocol?.name || ''
                  },
                  project: {
                    id: project?.id || '',
                    name: project?.name || ''
                  },
                  rendered_steps: ['Prepare cells.'],
                  save: {
                    status: 'ready_for_save'
                  }
                },
                missing_placeholders: [],
                follow_up_questions: []
              };
            }
          }
        }
      });

      const result = await runtime.runFlow({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Turn today\'s Atlas cell prep into a notebook page.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ]
        },
        parserPayload: {
          protocol_candidates: ['Cell Prep'],
          entities: {
            project_name: 'Atlas'
          }
        },
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      assert.deepEqual(calls, [
        'protocol.listAgentProtocols',
        'protocol.matchForNotebook',
        'notebook.generateFromProtocol'
      ]);
      assert.equal(result.status, 'completed');
      assert.equal(result.selected_protocol.name, 'Cell Prep');
      assert.equal(result.notebook.save.status, 'ready_for_save');
    });

    test('notebook generation runtime extracts token and inline placeholders', () => {
      const runtime = agentNotebookGeneration.createNotebookGenerationRuntime();
      const rows = runtime.buildProtocolPlaceholderRows({
        steps: [
          {
            id: 'step-1',
            text: 'Prepare {{ph:buffer_name}} and load [sample name].',
            placeholders: [
              { id: 'buffer_name', name: 'buffer name' }
            ]
          }
        ]
      });
      assert.equal(rows.length, 2);
      assert.equal(rows.some((row) => row.placeholder_key === 'step-1:buffer_name'), true);
      assert.equal(rows.some((row) => row.placeholder_key === 'step-1:inline-step-1-1'), true);
    });

    test('notebook generation runtime resolves deterministic placeholders and marks draft ready', async () => {
      const runtime = agentNotebookGeneration.createNotebookGenerationRuntime();
      const result = await runtime.generateNotebook({
        message: 'I ran the transfection on sample TUBE42.',
        conversation: [],
        snapshot: {},
        parserPayload: {
          entities: {
            activity_type: 'transfection',
            project_name: 'Atlas',
            protocol_name: 'HEK293 Transfection',
            protein_name: null,
            compound_name: null,
            inventory_item: null,
            cell_line: 'HEK293',
            paper_title: null,
            workflow_step: null,
            requested_output: 'notebook page'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          }
        },
        selectedProtocol: {
          id: 'prot-1',
          name: 'HEK293 Transfection',
          steps: [
            {
              id: 'step-1',
              text: 'Record {{ph:run_date}} for {{ph:project_name}}.',
              placeholders: [
                { id: 'run_date', name: 'date' },
                { id: 'project_name', name: 'project name' }
              ]
            },
            {
              id: 'step-2',
              text: 'Use {{ph:cell_line}} with {{ph:protocol_name}} on {{ph:sample_name}}.',
              placeholders: [
                { id: 'cell_line', name: 'cell line' },
                { id: 'protocol_name', name: 'protocol name' },
                { id: 'sample_name', name: 'sample name' }
              ]
            }
          ]
        },
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload_project_name'
        }
      });
      assert.equal(result.status, 'completed');
      assert.equal(result.notebook.save.status, 'ready_for_save');
      assert.equal(result.notebook.entry_template.notebookState, 'executed');
      assert.equal(Boolean(result.notebook.entry_template.executedAt), true);
      assert.equal(result.notebook.entry_template.agentDraftStatus, 'draft_ready');
      assert.equal(result.notebook.rendered_steps.some((step) => step.includes('HEK293')), true);
      assert.equal(result.notebook.rendered_steps.some((step) => step.includes('TUBE42')), true);
    });

    test('notebook generation runtime keeps unresolved placeholders visible and asks follow-up questions', async () => {
      const runtime = agentNotebookGeneration.createNotebookGenerationRuntime();
      const result = await runtime.generateNotebook({
        message: 'Please draft the notebook.',
        conversation: [],
        snapshot: {},
        parserPayload: {
          entities: {
            activity_type: 'documentation',
            project_name: 'Atlas',
            protocol_name: 'Gel Run',
            protein_name: null,
            compound_name: null,
            inventory_item: null,
            cell_line: null,
            paper_title: null,
            workflow_step: null,
            requested_output: 'notebook page'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          }
        },
        selectedProtocol: {
          id: 'prot-2',
          name: 'Gel Run',
          steps: [
            {
              id: 'step-1',
              text: 'Load [sample name] into the gel.',
              placeholders: []
            }
          ]
        },
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload_project_name'
        }
      });
      assert.equal(result.status, 'needs_more_info');
      assert.equal(result.notebook.save.status, 'needs_more_info');
      assert.equal(result.notebook.entry_template.notebookState, 'executed');
      assert.equal(result.notebook.entry_template.agentDraftStatus, 'needs_review');
      assert.equal(result.missing_placeholders.length, 1);
      assert.equal(result.follow_up_questions[0], 'Please provide sample name.');
    });

    test('notebook draft selection prompt includes optional evidence context', () => {
      const runtime = agentNotebookDraft.createNotebookDraftRuntime();
      const prompt = runtime.buildNotebookDraftSelectionPrompt({
        message: 'Draft the next Atlas experiment based on recent papers.',
        conversation: [],
        parserPayload: {
          primary_intent: 'notebook_draft'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        },
        notebookRuns: [],
        candidates: [
          {
            id: 'candidate-1',
            protocol_name: 'Low Temperature Expression'
          }
        ],
        evidenceContext: [
          {
            tool_name: 'literature-search',
            status: 'completed',
            summary: 'Recent papers support low-temperature induction before purification.',
            item_count: 2
          }
        ]
      });
      assert.match(prompt, /Evidence context JSON/);
      assert.match(prompt, /Recent papers support low-temperature induction/);
    });

    test('notebook draft runtime selects downstream workflow candidate and keeps unresolved placeholders visible', async () => {
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'wf-1::block-3::prot-2::Viability Assay',
                title: 'Viability Assay After Cell Prep',
                purpose: 'Measure viability after the completed cell prep run.',
                rationale: 'The workflow places the viability assay directly after cell prep.',
                planned_materials: ['Prepared cells', 'Assay plate'],
                checkpoints: ['Confirm cells are ready.', 'Record viability observations.']
              }
            };
          }
          if (options.stage === 'notebook_fill') {
            return {
              ok: true,
              payload: {
                filled_values: [],
                missing_placeholders: [
                  {
                    step_id: 'step-1',
                    placeholder_id: 'sample_name',
                    placeholder_key: 'step-1:sample_name',
                    display: 'sample name',
                    reason: 'Leave visible for planned draft.'
                  }
                ],
                follow_up_questions: ['Please provide sample name.'],
                result_summary: 'Notebook fill test completed.'
              }
            };
          }
          return {
            ok: false,
            error: `Unhandled stage ${String(options.stage || '')}`
          };
        }
      });
      const result = await runtime.generateNotebookDraft({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Draft tomorrow’s next experiment for Atlas.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Cell Prep',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                { id: 'step-0', text: 'Prepare cells.', placeholders: [] }
              ]
            },
            {
              id: 'prot-2',
              name: 'Viability Assay',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                {
                  id: 'step-1',
                  text: 'Measure viability for {{ph:sample_name}}.',
                  placeholders: [{ id: 'sample_name', name: 'sample name' }]
                }
              ]
            }
          ],
          workflows: [
            {
              id: 'wf-1',
              name: 'Atlas Workflow',
              projectId: 'proj-1',
              notebookEntryIds: ['note-1'],
              blocks: [
                { id: 'block-1', protocolId: 'prot-1' },
                { id: 'block-2', type: 'text', text: 'Then assess viability.' },
                { id: 'block-3', protocolId: 'prot-2' }
              ],
              links: [
                { id: 'link-1', fromBlockId: 'block-1', toBlockId: 'block-2' },
                { id: 'link-2', fromBlockId: 'block-2', toBlockId: 'block-3' }
              ]
            }
          ],
          experimentData: {
            notebook_runs: [
              {
                id: 'note-1',
                project_id: 'proj-1',
                protocol_id: 'prot-1',
                protocol_name: 'Cell Prep',
                workflow_id: 'wf-1',
                notebook_state: 'executed',
                executed_at: '2026-03-22T12:00:00.000Z',
                updated_at: '2026-03-22T12:00:00.000Z'
              }
            ]
          }
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          protocol_candidates: ['Viability Assay']
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'Viability Assay After Cell Prep');
      assert.equal(result.notebook.save.mode, 'confirm_before_save');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
      assert.equal(result.notebook.entry_template.notebookState, 'planned');
      assert.equal(result.notebook.entry_template.executedAt, '');
      assert.equal(result.notebook.entry_template.agentDraftMeta.source, 'agent_notebook_draft_v1');
      assert.equal(typeof result.notebook.entry_template.agentDraftMeta.proposalId, 'string');
      assert.equal(result.missing_placeholders.length, 1);
      assert.equal(result.notebook.unresolved_placeholders.length, 1);
    });

    test('notebook draft runtime can resolve helper runtimes from registry factories', async () => {
      const requestedFactories = [];
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        getAgentRuntimeFactory: (runtimeName) => {
          requestedFactories.push(runtimeName);
          if (runtimeName === 'protocol-matching') {
            return () => ({
              normalizeProtocolRecord(protocol = {}, index = 0) {
                return {
                  id: String(protocol.id || `protocol-${index + 1}`),
                  name: String(protocol.name || ''),
                  project_id: String(protocol.projectId || protocol.project_id || ''),
                  project_name: String(protocol.projectName || protocol.project_name || ''),
                  steps: Array.isArray(protocol.steps) ? protocol.steps : []
                };
              },
              rankProtocolMatches({ protocols = [] } = {}) {
                return Array.isArray(protocols)
                  ? protocols.map((protocol) => ({
                    id: protocol.id,
                    name: protocol.name
                  }))
                  : [];
              }
            });
          }
          if (runtimeName === 'notebook-generation') {
            return () => ({
              async generateNotebook() {
                return {
                  notebook: {
                    save: {
                      mode: 'confirm_before_save',
                      status: 'awaiting_user_confirmation'
                    },
                    entry_template: {
                      notebookState: 'planned',
                      executedAt: '',
                      agentDraftStatus: 'draft_ready',
                      agentDraftMeta: {}
                    },
                    unresolved_placeholders: []
                  },
                  missing_placeholders: [],
                  follow_up_questions: []
                };
              }
            });
          }
          return null;
        },
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'protocol-only::prot-1::Viability Assay',
                title: 'Registry Draft',
                purpose: 'Verify registry-selected notebook generation.',
                rationale: 'Exercise the runtime-factory registry path.',
                planned_materials: ['Assay plate'],
                checkpoints: ['Confirm project scope.']
              }
            };
          }
          return {
            ok: false,
            error: `Unhandled stage ${String(options.stage || '')}`
          };
        }
      });
      const result = await runtime.generateNotebookDraft({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Draft the next viability assay for Atlas.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Viability Assay',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                {
                  id: 'step-1',
                  text: 'Measure viability.',
                  placeholders: []
                }
              ]
            }
          ]
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          protocol_candidates: ['Viability Assay']
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.deepEqual(requestedFactories, ['protocol-matching', 'notebook-generation']);
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'Registry Draft');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
    });

    test('notebook draft runtime can use the agent sub-app API layer for protocol ranking and notebook generation', async () => {
      const calls = [];
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        agentAppApi: {
          protocol: {
            listAgentProtocols() {
              calls.push('protocol.listAgentProtocols');
              return [
                {
                  id: 'prot-1',
                  name: 'Viability Assay',
                  project_id: 'proj-1',
                  project_name: 'Atlas',
                  steps: [
                    {
                      id: 'step-1',
                      text: 'Measure viability.',
                      placeholders: []
                    }
                  ]
                }
              ];
            },
            normalizeAgentProtocol(protocol = {}) {
              return {
                id: String(protocol.id || ''),
                name: String(protocol.name || ''),
                project_id: String(protocol.project_id || ''),
                project_name: String(protocol.project_name || ''),
                steps: Array.isArray(protocol.steps) ? protocol.steps : []
              };
            },
            rankAgentProtocols({ protocols = [] } = {}) {
              calls.push('protocol.rankAgentProtocols');
              return Array.isArray(protocols)
                ? protocols.map((protocol) => ({
                  id: protocol.id,
                  name: protocol.name,
                  score: 120
                }))
                : [];
            }
          },
          notebook: {
            listAgentEntries() {
              calls.push('notebook.listAgentEntries');
              return [];
            },
            async generateFromProtocol() {
              calls.push('notebook.generateFromProtocol');
              return {
                notebook: {
                  save: {
                    mode: 'confirm_before_save',
                    status: 'awaiting_user_confirmation'
                  },
                  entry_template: {
                    notebookState: 'planned',
                    executedAt: '',
                    agentDraftStatus: 'draft_ready',
                    agentDraftMeta: {}
                  },
                  unresolved_placeholders: []
                },
                missing_placeholders: [],
                follow_up_questions: []
              };
            }
          }
        },
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'protocol-only::prot-1::Viability Assay',
                title: 'API Draft',
                purpose: 'Exercise the agent sub-app API path.',
                rationale: 'Use the new API layer instead of directly coupling to helper runtimes.',
                planned_materials: ['Assay plate'],
                checkpoints: ['Confirm project scope.']
              }
            };
          }
          return {
            ok: false,
            error: `Unhandled stage ${String(options.stage || '')}`
          };
        }
      });

      const result = await runtime.generateNotebookDraft({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Draft the next viability assay for Atlas.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ]
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          protocol_candidates: ['Viability Assay']
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });

      assert.equal(calls.filter((item) => item === 'protocol.listAgentProtocols').length >= 2, true);
      assert.equal(calls.includes('protocol.rankAgentProtocols'), true);
      assert.equal(calls.includes('notebook.listAgentEntries'), true);
      assert.equal(calls.includes('notebook.generateFromProtocol'), true);
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'API Draft');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
    });

  }
};
