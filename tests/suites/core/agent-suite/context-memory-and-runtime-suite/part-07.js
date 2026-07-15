module.exports = function registerAgentContextMemoryAndRuntimeSuitePart07(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('registerAgentToolExecutors wires every catalog tool through the shared runtime', async () => {
      const { AGENT_TOOL_CATALOG } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-tool-loading.js'
      ));
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
      const selectedProtocol = {
        id: 'protocol-1',
        name: 'HEK293 Transfection',
        steps: []
      };
      const registeredNames = registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        agentAppApi: {
          protocol: {
            matchForNotebook: async (input = {}) => {
              calls.push({ tool: 'protocol-matching', input: JSON.parse(JSON.stringify(input)) });
              return {
                ranked_matches: [{ ...selectedProtocol, score: 1 }],
                selected_protocol: selectedProtocol,
                selection_method: 'stub',
                rationale: 'Matched protocol.'
              };
            }
          },
          notebook: {
            generateFromProtocol: async (input = {}) => {
              calls.push({ tool: 'notebook-generation', input: JSON.parse(JSON.stringify(input)) });
              return {
                status: 'completed',
                notebook: {
                  id: 'notebook-1',
                  protocol_id: input.selectedProtocol?.id || ''
                },
                summary: 'Generated notebook.'
              };
            }
          }
        },
        subAgentRuntime: {
          execute: async (input = {}) => {
            calls.push({ tool: 'sub-agent', input: JSON.parse(JSON.stringify(input)) });
            return {
              ok: true,
              status: 'listed',
              items: [{ id: 'sub-agent-1' }],
              summary: 'Listed sub-agents.'
            };
          }
        },
        memoryRuntime: {
          execute: async (input = {}) => {
            calls.push({ tool: 'memory', input: JSON.parse(JSON.stringify(input)) });
            return {
              ok: true,
              status: 'matched',
              items: [{ id: 'memory-1', key: input.key || 'preference', summary: 'Memory row.' }],
              summary: 'Recalled memory.'
            };
          }
        },
        paperAnalysisRuntime: {
          analyzePaper: async (input = {}) => {
            calls.push({ tool: 'paper-analysis', input: JSON.parse(JSON.stringify(input)) });
            return {
              ok: true,
              status: 'completed',
              summary: 'Analyzed paper.'
            };
          }
        },
        protocolGenerationRuntime: {
          generateProtocol: async (input = {}) => {
            calls.push({ tool: 'protocol-generation', input: JSON.parse(JSON.stringify(input)) });
            return {
              ok: true,
              status: 'generated',
              protocol: { name: 'Generated protocol', steps: [] },
              summary: 'Generated protocol.'
            };
          }
        }
      });

      const catalogNames = AGENT_TOOL_CATALOG.map((entry) => entry.name);
      assert.deepEqual(registeredNames, catalogNames);
      assert.deepEqual([...executors.keys()].sort(), catalogNames.slice().sort());

      const state = {};
      const context = {
        provider: 'openai',
        endpoint: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'gpt-test',
        message: 'Generate a notebook from the HEK293 transfection protocol.',
        snapshot: {},
        project: {
          id: 'project-1',
          name: 'KRAS screen'
        },
        lifecycleRecorder: {
          requestId: 'request-1'
        }
      };
      const protocolResult = await executors.get('protocol-matching')({
        args: {
          protocol_candidates: ['HEK293 Transfection']
        },
        context,
        state
      });
      assert.equal(protocolResult.status, 'selected');
      assert.equal(state.lastSelectedProtocol.id, 'protocol-1');

      const notebookResult = await executors.get('notebook-generation')({
        args: {
          pending_values: {
            cell_line: 'HEK293'
          }
        },
        context,
        state
      });
      assert.equal(notebookResult.notebook.protocol_id, 'protocol-1');
      assert.equal(calls.find((call) => call.tool === 'notebook-generation').input.selectedProtocol.id, 'protocol-1');

      await executors.get('sub-agent')({
        args: {
          action: 'list'
        },
        context,
        state
      });
      assert.equal(calls.find((call) => call.tool === 'sub-agent').input.metadata.parent_request_id, 'request-1');

      await executors.get('memory')({
        args: {
          action: 'recall',
          key: 'preference'
        },
        context,
        state
      });
      assert.equal(calls.find((call) => call.tool === 'memory').input.project_name, 'KRAS screen');

      await executors.get('paper-analysis')({
        args: {
          paper_title: 'A paper',
          paper_summary: 'Summary text.'
        },
        context,
        state
      });
      assert.equal(calls.find((call) => call.tool === 'paper-analysis').input.provider, 'openai');

      await executors.get('protocol-generation')({
        args: {
          protocol: {
            name: 'Mixing protocol',
            steps: ['Mix and incubate.']
          }
        },
        context,
        state
      });
      assert.equal(calls.find((call) => call.tool === 'protocol-generation').input.model, undefined);
      assert.equal(calls.find((call) => call.tool === 'protocol-generation').input.protocol.name, 'Mixing protocol');
    });
    test('registerAgentToolExecutors forwards snapshot storage and project context into literature-search', async () => {
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
        literatureSearchRuntime: {
          execute: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              ok: true,
              status: 'completed',
              items: [],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              summary: 'Found 0 literature results.'
            };
          }
        }
      });

      const result = await executors.get('literature-search')({
        args: {
          query: 'ncAA incorporation',
          limit: 5
        },
        context: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          cwd: '/Users/shiyifan/Projects/Hikari',
          message: 'Find ncAA papers.',
          project: {
            id: 'project-1',
            name: 'Atlas'
          },
          snapshot: {
            settings: {
              storagePath: '/tmp/hikari-storage'
            },
            projects: [
              {
                id: 'project-1',
                name: 'Atlas'
              }
            ]
          },
          parserPayload: {
            primary_intent: 'literature_search'
          }
        }
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].provider, 'codex');
      assert.equal(calls[0].model, 'gpt-5.4-mini');
      assert.equal(calls[0].cwd, '/Users/shiyifan/Projects/Hikari');
      assert.equal(calls[0].project.name, 'Atlas');
      assert.equal(calls[0].storage_path, '/tmp/hikari-storage');
      assert.equal(calls[0].storagePath, '/tmp/hikari-storage');
      assert.equal(calls[0].snapshot.settings.storagePath, '/tmp/hikari-storage');
      assert.equal(calls[0].parser_payload.primary_intent, 'literature_search');
    });
    test('registerAgentToolExecutors does not add literature-search caps when omitted', async () => {
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
        literatureSearchRuntime: {
          execute: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              ok: true,
              status: 'completed',
              items: [],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              summary: 'Found 0 literature results.'
            };
          }
        }
      });

      await executors.get('literature-search')({
        args: {
          query: 'EGFR inhibitor resistance'
        },
        context: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          message: 'Find EGFR papers.',
          snapshot: {
            settings: {
              storagePath: '/tmp/hikari-storage'
            }
          }
        }
      });

      assert.equal(calls.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'limit'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'max_per_source'), false);
    });
    // The session-runtime tool-loop test moved out with /self-agent when it was isolated.
  }
};
