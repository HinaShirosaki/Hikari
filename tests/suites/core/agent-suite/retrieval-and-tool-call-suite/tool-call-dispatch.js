module.exports = function registerAgentRetrievalAndToolCallSuiteToolCallDispatch(context = {}) {
  const scope = context.scope || {};
  const toolLoading = scope.agentToolLoading || {};
  const toolExecution = scope.agentToolExecution || {};
  const { assert, test } = scope;
    test('agent tool-call normalizes selection and arguments payloads and rejects invalid input', () => {
      const selection = toolLoading.normalizeToolSelectionPayload({
        tool_calls: [
          { tool_name: 'Inventory-Lookup', rationale: 'Need to find stock.' },
          { tool_name: 'protocol-matching', rationale: 'Need protocol choice.' }
        ],
        reasoning_summary: 'Two-step flow.'
      });
      assert.equal(selection.ok, true);
      assert.deepEqual(
        selection.payload.tool_calls.map((entry) => entry.tool_name),
        ['inventory-lookup', 'protocol-matching']
      );

      const invalidSelection = toolLoading.normalizeToolSelectionPayload({
        tool_calls: [
          { tool_name: 'inventory-lookup' },
          { tool_name: 'inventory-lookup' }
        ]
      });
      assert.equal(invalidSelection.ok, false);
      assert.match(String(invalidSelection.error || ''), /duplicate tool/i);

      const argsPayload = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'inventory-lookup',
            arguments: {
              query: 'PEI',
              limit: 5,
              inventory_search: {
                candidate_terms: ['PEI']
              }
            }
          }
        ]
      }, {
        selectedToolNames: ['inventory-lookup']
      });
      assert.equal(argsPayload.ok, true);
      assert.equal(argsPayload.payload.tool_calls[0].arguments.limit, 5);

      const notebookDraftArgs = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'notebook-draft',
            arguments: {
              project: { name: 'Atlas' },
              protocol_candidates: ['Flow Cytometric IC50'],
              pending_values: {
                'step-1:peptide-id': 'PDL1-peptide-7'
              },
              step_edits: [
                { step_number: 2, text: 'Acquire the prepared dose series.' }
              ]
            }
          }
        ]
      }, {
        selectedToolNames: ['notebook-draft']
      });
      assert.equal(notebookDraftArgs.ok, true);
      assert.equal(
        notebookDraftArgs.payload.tool_calls[0].arguments.pending_values['step-1:peptide-id'],
        'PDL1-peptide-7'
      );
      assert.equal(notebookDraftArgs.payload.tool_calls[0].arguments.step_edits[0].step_number, 2);
      assert.deepEqual(
        toolLoading.normalizeToolInvocationArgs({
          input_json: JSON.stringify({ query: 'PEI', limit: 5 })
        }),
        { query: 'PEI', limit: 5 }
      );

      const invalidArgs = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'inventory-lookup',
            arguments: {
              query: 'PEI',
              limit: 'five'
            }
          }
        ]
      }, {
        selectedToolNames: ['inventory-lookup']
      });
      assert.equal(invalidArgs.ok, false);
      assert.match(String(invalidArgs.error || ''), /must be of type integer/i);
    });
    test('agent tool-call runtime supports generic executor registration without changing core dispatch logic', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'inventory-lookup': async ({ toolName, args }) => ({
            status: 'custom',
            summary: `${toolName} handled ${args.query}.`,
            items: [
              { id: 'custom-1', name: 'custom result' }
            ]
          })
        }
      });
      assert.equal(typeof runtime.registerToolExecutor, 'function');
      assert.equal(typeof runtime.getToolExecutor, 'function');

      const result = await runtime.executeToolCall({
        tool_name: 'inventory-lookup',
        arguments: {
          query: 'override me'
        }
      }, {
        message: 'fallback',
        snapshot: {},
        parserPayload: {}
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.status, 'custom');
      assert.match(String(result.summary || ''), /inventory-lookup handled override me/i);
    });
    test('agent tool-call runtime reports missing executors for schema-valid tools', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime();
      const result = await runtime.executeToolCall({
        tool_name: 'inventory-lookup',
        arguments: {
          query: 'Atlas construct'
        }
      }, {
        message: 'Where is Atlas construct?',
        snapshot: {},
        parserPayload: {}
      });
      assert.equal(result.ok, false);
      assert.equal(result.tool_name, 'inventory-lookup');
      assert.match(String(result.error || ''), /No tool executor is registered/i);
    });
    test('agent tool-call runtime passes normalized context and helper services into injected executors', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'notebook-lookup': async ({ toolName, args, context, services }) => ({
            status: 'handled',
            summary: `${toolName} received ${args.query}.`,
            items: [
              {
                message: context.message,
                projectName: context.project.name,
                deduped: services.uniqueStrings(['Atlas', 'atlas', 'ATLAS'], 5)
              }
            ]
          })
        }
      });
      const result = await runtime.executeToolCall({
        tool_name: 'notebook-lookup',
        arguments: {
          query: 'Protein Purification'
        }
      }, {
        message: 'Find protein purification records for Atlas.',
        snapshot: {},
        parserPayload: {},
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.equal(result.ok, true);
      assert.equal(result.tool_name, 'notebook-lookup');
      assert.equal(result.result.status, 'handled');
      assert.equal(result.result.items[0].message, 'Find protein purification records for Atlas.');
      assert.equal(result.result.items[0].projectName, 'Atlas');
      assert.deepEqual(result.result.items[0].deduped, ['Atlas']);
    });
    test('agent tool-call runtime supports sequential batches through injected state hooks', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'protocol-matching': async () => ({
            status: 'selected',
            selected_protocol: {
              id: 'prot-1',
              name: 'HEK293 Transfection'
            }
          }),
          'notebook-generation': async ({ state }) => ({
            status: state.lastSelectedProtocol ? 'completed' : 'needs_more_info',
            notebook: {
              protocol: state.lastSelectedProtocol || null
            }
          })
        },
        applyToolResultState(state, envelope) {
          if (envelope.result?.selected_protocol) {
            state.lastSelectedProtocol = envelope.result.selected_protocol;
          }
          return state;
        },
        initialState: {
          lastSelectedProtocol: null
        }
      });
      const results = await runtime.executeToolCalls([
        {
          tool_name: 'protocol-matching',
          arguments: {
            protocol_candidates: ['HEK293 Transfection']
          }
        },
        {
          tool_name: 'notebook-generation',
          arguments: {
            project: {
              id: 'proj-1',
              name: 'Atlas',
              resolution_source: 'payload_project_name'
            }
          }
        }
      ], {});
      assert.equal(results.length, 2);
      assert.equal(results[0].result.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(results[1].ok, true);
      assert.equal(results[1].tool_name, 'notebook-generation');
      assert.equal(results[1].result.status, 'completed');
      assert.equal(results[1].result.notebook.protocol.name, 'HEK293 Transfection');
    });
    test('agent tool-call runtime surfaces executor failures without built-in fallback behavior', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'python-sandbox': async () => {
            throw new Error('sandbox exploded');
          }
        }
      });
      const result = await runtime.executeToolCall({
        tool_name: 'python-sandbox',
        arguments: {
          code: 'print("hello")'
        }
      });
      assert.equal(result.ok, false);
      assert.equal(result.tool_name, 'python-sandbox');
      assert.equal(result.error, 'sandbox exploded');

      // A stopped request is not a tool failure: it must escape the envelope.
      runtime.registerToolExecutor('python-sandbox', async () => {
        const abort = new Error('Agent request stopped.');
        abort.name = 'AbortError';
        throw abort;
      });
      await assert.rejects(
        runtime.executeToolCall({ tool_name: 'python-sandbox', arguments: { code: 'print("hello")' } }),
        /Agent request stopped/
      );
    });
};
