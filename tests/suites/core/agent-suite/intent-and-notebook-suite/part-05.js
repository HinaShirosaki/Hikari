module.exports = function registerAgentIntentAndNotebookSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
          hiddenContexts: [{
            kind: 'paper-selection',
            label: 'Selected paper text',
            text: 'SUMO1 signal is weak in the selected paragraph.',
            paperId: 'paper-1',
            paperTitle: 'Atlas Uploaded Paper',
            pageNumber: 3
          }],
          selectionInsight: {
            actionType: 'what_is_it',
            selectedText: 'SUMO1'
          }
        },
        stateSnapshot: {
          data_file_path: '/tmp/hikari-data.json',
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
      assert.match(codexRunInput.message, /not visible in the user composer/);
      assert.match(codexRunInput.message, /SUMO1 signal is weak in the selected paragraph/);
      assert.match(codexRunInput.message, /User question:\nWhy was SUMO1 weak\?/);
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
    test('controller core refuses API agent routing when the release feature flag is disabled', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let parserCallCount = 0;
      const lifecycleStages = [];
      const controller = createAgentControllerCore({
        deps: {
          ALLOW_API_AGENT: false,
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          }
        },
        cleanText: (value, maxLength = 2000) => String(value || '').trim().slice(0, maxLength),
        controllerUtils: {
          resolveAgentLlmSource: () => ({
            provider: 'openai',
            endpoint: 'https://api.openai.com/v1/responses',
            apiKey: 'development-key',
            model: 'gpt-test'
          }),
          resolveAgentProvider: () => 'openai',
          extractConversation: () => [],
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            rows: [],
            entries: []
          }),
          async requestIntentParserPayload() {
            parserCallCount += 1;
            throw new Error('Disabled API agent must not start its parser.');
          }
        },
        observability: {
          recordLifecycleEvent: (_recorder, event = {}) => {
            lifecycleStages.push(event.stage || '');
          }
        },
        codexAgentRuntime: null,
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          listSkills: () => [],
          parseSkillInvocation: (message) => ({
            type: 'none',
            active_skill_names: [],
            cleaned_message: message
          }),
          buildSkillsPromptPayload: () => ({
            active_skills_prompt: '',
            skills_catalog_prompt: ''
          })
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

      const result = await controller.runAgentController({
        message: 'Try the API agent.',
        llm: {
          provider: 'openai',
          apiKey: 'development-key'
        },
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-api-disabled',
          events: []
        }
      });

      assert.equal(parserCallCount, 0);
      assert.equal(result.ok, false);
      assert.equal(result.provider, 'codex');
      assert.match(result.error, /Codex agent only/);
      assert.equal(lifecycleStages.includes('controller_api_agent_disabled'), true);
    });
  }
};
