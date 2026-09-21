module.exports = function registerAgentContextMemoryAndRuntimeSuiteProviderBridgeAndWebSearch(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, path, test } = scope;
    test('python sandbox executor forwards continuation and llm context into the managed runtime', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));
      const executors = new Map();
      let captured = null;
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        pythonSandboxToolRuntime: {
          execute: async (args = {}, options = {}) => {
            captured = {
              args: JSON.parse(JSON.stringify(args)),
              options: JSON.parse(JSON.stringify(options))
            };
            return {
              ok: true,
              sub_agent_id: 'python-sandbox-subagent-1',
              summary: 'Python sandbox execution completed.',
              sandbox: {
                ok: true,
                run_id: 'py-tool-1',
                status: 'ok',
                error: '',
                stdout: 'done',
                stderr: '',
                readback_files: [],
                render_outputs: []
              }
            };
          }
        },
        getAgentPythonSandboxRoot: () => '/tmp/python-sandbox-root'
      });

      const result = await executors.get('python-sandbox')({
        args: {
          sub_agent_id: 'python-sandbox-subagent-1',
          feedback: 'Keep working on the same task.'
        },
        context: {
          lifecycleRecorder: {
            requestId: 'req-77'
          },
          preferredPythonBin: 'python3',
          pythonExecutable: '/usr/bin/python3',
          provider: 'openai',
          endpoint: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
          model: 'gpt-5.4-mini',
          traceContext: {
            trace_id: 'trace-1'
          },
          message: 'Please continue the previous Python sandbox analysis.'
        }
      });

      assert.equal(captured.options.parent_request_id, 'req-77');
      assert.equal(captured.options.sandboxRoot, '/tmp/python-sandbox-root');
      assert.equal(captured.options.preferredPythonBin, 'python3');
      assert.equal(captured.options.pythonExecutable, '/usr/bin/python3');
      assert.equal(captured.options.provider, 'openai');
      assert.equal(captured.options.endpoint, 'https://api.openai.example/v1');
      assert.equal(captured.options.apiKey, 'secret-key');
      assert.equal(captured.options.model, 'gpt-5.4-mini');
      assert.equal(captured.options.traceContext.trace_id, 'trace-1');
      assert.equal(captured.options.message, 'Please continue the previous Python sandbox analysis.');
      assert.equal(result.sub_agent_id, 'python-sandbox-subagent-1');
      assert.equal(result.run_id, 'py-tool-1');
    });
    test('provider bridge routes codex multimodal file requests through the Codex agent surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex',
          OPENAI: 'openai'
        },
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return '{"selected":true}';
        }
      });

      const result = await bridge.requestFileInput({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        stage: 'paper_context_selection',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'Pick the best excerpt.',
        pdfDataUrl: 'data:application/pdf;base64,QUJD',
        fileName: 'paper.pdf',
        expectJson: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.payload.selected, true);
      assert.equal(calls.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'endpoint'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'apiKey'), false);
      assert.equal(calls[0].fileName, 'paper.pdf');
      assert.equal(calls[0].pdfDataUrl, 'data:application/pdf;base64,QUJD');
      assert.match(calls[0].prompt, /Return valid JSON only\./);
      assert.match(calls[0].prompt, /Pick the best excerpt\./);
    });
    test('provider bridge rejects retired API-provider web search requests', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        requestCodexCliText: async () => {
          calls.push('called');
          return '{}';
        }
      });

      const result = await bridge.requestWebSearch({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        stage: 'purchase_search',
        query: 'SS320 competent cells',
        maxResults: 3,
        allowedDomains: ['vendor.test']
      });

      assert.equal(result.ok, false);
      assert.equal(calls.length, 0);
    });
    test('provider bridge routes codex web search through the Codex agent web-search surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return JSON.stringify({
            results: [
              {
                title: 'Vendor Product',
                url: 'https://vendor.test/products/item-1',
                summary: 'Direct product detail page.',
                source_domain: 'vendor.test'
              }
            ],
            reasoning: 'Internet search succeeded.'
          });
        }
      });

      const result = await bridge.requestWebSearch({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        query: 'SS320 competent cells',
        maxResults: 2
      });

      assert.equal(result.ok, true);
      assert.equal(result.results.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'endpoint'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'apiKey'), false);
      assert.equal(calls[0].enableWebSearch, true);
      assert.match(calls[0].prompt, /Search query:/);
    });
    test('runtime helpers wire codex structured requests through the shared Codex agent provider surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const { createAgentLlmRuntimeHelpers } = require(path.join(
        __dirname,
        'src',
        'main',
        'lib',
        'llm',
        'runtime-helpers.js'
      ));

      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return '{"primary_intent":"general_science_question","needs_clarification":false,"clarifying_question":"","clarification_options":[],"entities":{"projects":[],"samples":[],"proteins":[],"genes":[],"reagents":[],"vendors":[],"inventory_queries":[],"record_queries":[],"assays":[],"gels":[],"papers":[],"protocols":[],"notebooks":[],"purchase_requirements":[]},"reasoning_summary":"Parsed intent.","confidence":"high","reasoning_effort":1}';
        }
      });
      const helpers = createAgentLlmRuntimeHelpers({
        llmProviderBridge: bridge
      });

      const result = await helpers.requestStructuredJsonPayload({
        provider: 'codex',
        endpoint: '',
        model: 'gpt-5.4-mini',
        stage: 'structured_payload',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'User asks a science question.',
        enableWebSearch: true,
        schema: {
          type: 'object',
          additionalProperties: true
        },
        defaultError: 'Structured payload provider is not configured.'
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'endpoint'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'apiKey'), false);
      assert.equal(calls[0].enableWebSearch, true);
      assert.match(calls[0].prompt, /Return valid JSON only\./);
      assert.match(calls[0].prompt, /User asks a science question\./);
    });
    test('runtime helpers reject retired API-provider structured requests', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const { createAgentLlmRuntimeHelpers } = require(path.join(
        __dirname,
        'src',
        'main',
        'lib',
        'llm',
        'runtime-helpers.js'
      ));

      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        requestCodexCliText: async () => {
          calls.push('called');
          return '{}';
        }
      });
      const helpers = createAgentLlmRuntimeHelpers({
        llmProviderBridge: bridge
      });

      const result = await helpers.requestStructuredJsonPayload({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        stage: 'protocol_generation',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'Generate a protocol.',
        enableWebSearch: true,
        schema: {
          type: 'object',
          additionalProperties: true
        }
      });

      assert.equal(result.ok, false);
      assert.equal(calls.length, 0);
    });
    test('web search runtime exposes provider-backed web search to agent tools', async () => {
      const { createWebSearchRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-web-search.js'
      ));

      const calls = [];
      const runtime = createWebSearchRuntime({
        requestWebSearch: async (input = {}) => {
          calls.push(input);
          return {
            ok: true,
            results: [
              {
                title: 'OpenAI result',
                url: 'https://example.org/openai-result',
                summary: 'External source.',
                source_domain: 'example.org'
              }
            ],
            reasoning: 'Provider-backed search.'
          };
        }
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'recent protein folding benchmark',
        limit: 4
      });

      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].provider, 'openai');
      assert.equal(calls[0].maxResults, 4);
      assert.equal(result.citations[0].source, 'web_source');
    });
    test('registerAgentToolExecutors wires the web-search tool through the shared runtime', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));

      const executors = new Map();
      const calls = [];
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        webSearchRuntime: {
          execute: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              ok: true,
              status: 'completed',
              query: input.query,
              items: [
                {
                  title: 'Shared web result',
                  url: 'https://example.org/result',
                  summary: 'External source.',
                  source_domain: 'example.org'
                }
              ],
              citations: [
                {
                  source: 'web_source',
                  pointer: 'https://example.org/result',
                  reason: 'Matched external web search result.'
                }
              ],
              summary: 'Found 1 web result.'
            };
          }
        }
      });

      const result = await executors.get('web-search')({
        args: {
          query: 'recent protein folding benchmark',
          limit: 3
        },
        context: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          message: 'Find recent protein folding benchmark results.'
        }
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].limit, 3);
      assert.equal(calls[0].query, 'recent protein folding benchmark');
      assert.equal(calls[0].message, 'Find recent protein folding benchmark results.');
      assert.equal(result.summary, 'Found 1 web result.');
    });
};
