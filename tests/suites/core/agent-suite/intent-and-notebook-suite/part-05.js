module.exports = function registerAgentIntentAndNotebookSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('controller core routes Codex provider through the Codex-owned agent runtime', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      const { createAgentRuntimeSupport } = require(path.join(__dirname, 'src', 'main', 'agent', 'runtime', 'agent-runtime-support.js'));
      const runtimeSupport = createAgentRuntimeSupport({});
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
          createAgentLlmTraceContext: () => ({
            requestId: 'req-codex-agent-controller',
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
          normalizeAgentSnapshot: runtimeSupport.normalizeAgentSnapshot,
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
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run before Codex agent runtime.');
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '/tmp/hikari-data.json',
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
          settings: {
            storagePath: '/tmp/hikari-storage',
            preferredJournals: ['Nature Biotechnology', 'Cell']
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

      assert.equal(setModelValue, 'gpt-5.4');
      assert.equal(setReasoningValue, 'high');
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'codex_agent');
      assert.equal(result.codex_agent.answer, 'Codex final answer.');
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
      assert.deepEqual(codexRunInput.snapshot.settings.preferredJournals, ['Nature Biotechnology', 'Cell']);
      assert.equal(codexRunInput.snapshot.settings.preferredJournal, 'Nature Biotechnology; Cell');
      assert.equal(codexRunInput.snapshot.settings.storagePath, '/tmp/hikari-storage');
      assert.equal(codexRunInput.snapshot.data_file_path, '');
      assert.equal(Object.prototype.hasOwnProperty.call(codexRunInput, 'dataFilePath'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(codexRunInput, 'fallbackDataFilePath'), false);
      assert.equal(lifecycleStages.includes('controller_codex_agent'), true);
      assert.equal(lifecycleStages.includes('controller_intent_only'), false);
    });
    test('Codex-only controller refuses API agent routing', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      const lifecycleStages = [];
      const controller = createAgentControllerCore({
        deps: {
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
          createAgentLlmTraceContext: () => ({
            rows: [],
            entries: []
          })
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

      assert.equal(result.ok, false);
      assert.equal(result.provider, 'codex');
      assert.match(result.error, /Codex agent only/);
      assert.equal(lifecycleStages.includes('controller_api_agent_disabled'), true);
    });
  }
};
