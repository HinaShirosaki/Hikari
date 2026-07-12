module.exports = function registerAgentIntentAndNotebookSuitePart01(context = {}) {
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
      assert.equal(agentIntentParser.normalizeParserIntent('notebook_loopup'), 'notebook_lookup');
      assert.equal(agentIntentParser.normalizeParserIntent('product_recommendation'), 'purchase_recommendation');
      assert.equal(agentIntentParser.normalizeParserIntent('shopping-search'), 'purchase_recommendation');
    });
    test('science routing promotes unclear parser intent into deep general science reasoning', () => {
      const { createAgentScienceMainUtils } = require(path.join(__dirname, 'self-agent', 'runtime', 'agent-science-main-utils.js'));
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
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'self-agent', 'ipc', 'agent-intent-dispatcher.js'));
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
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run for unclear fallback.');
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
        },
        result
      });

      assert.equal(receivedScienceInput !== null, true);
      assert.equal(receivedScienceInput.routing.intent, 'general_science_question');
      assert.equal(receivedScienceInput.routing.plan.reasoning_effort, 2);
      assert.equal(result.general_science_question.status, 'completed');
    });
    test('intent dispatcher routes purchase recommendations through the tracked tool executor', async () => {
      const { createAgentIntentDispatcher } = require(path.join(__dirname, 'self-agent', 'ipc', 'agent-intent-dispatcher.js'));
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
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run for purchase recommendations.');
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
  }
};
