module.exports = function registerAgentRetrievalAndToolCallSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('inventory lookup runtime is reusable with fallback snapshot search', async () => {
      const runtime = agentInventoryLookup.createAgentInventoryLookupRuntime();
      const result = await runtime.executeInventoryLookup({
        message: 'Where is the Atlas construct sample?',
        parserPayload: {
          entities: {
            inventory_item: 'Atlas construct',
            compound_name: null,
            requested_output: 'location'
          },
          inventory_search: {
            normalized_query: 'Atlas construct',
            candidate_terms: ['Atlas construct', 'atlas'],
            aliases: ['construct'],
            search_mode: 'exact_then_alias_then_fuzzy'
          }
        },
        snapshot: {
          labInventory: {
            chemicals: []
          },
          inventory: {
            'Room Temp': [
              {
                id: 'box-1',
                name: 'Atlas Box',
                type: 'box81',
                location: 'Shelf 3'
              }
            ]
          },
          samples: [
            {
              id: 'sample-1',
              code: 'ATLAS-001',
              name: 'Atlas construct',
              type: 'plasmid',
              concentration: '100 ng/uL',
              notes: 'Ready for transfection',
              inventoryLink: {
                section: 'Room Temp',
                containerId: 'box-1',
                wellIndex: 7
              },
              location: {
                storageType: 'room-temp',
                shelf: 'Shelf 3',
                box: 'A7'
              }
            }
          ]
        }
      });
      assert.equal(result.status, 'matched');
      assert.equal(result.source, 'fallback_json');
      assert.equal(result.items.some((item) => item.kind === 'personal_sample'), true);
      assert.equal(result.items.some((item) => item.name === 'Atlas construct'), true);
      assert.equal(result.terms_used.includes('Atlas construct'), true);
    });

    test('record lookup runtime is reusable with fallback snapshot search', async () => {
      const runtime = agentRecordLookup.createAgentRecordLookupRuntime();
      const result = await runtime.executeRecordLookup({
        message: 'Find protein purification records for Atlas.',
        parserPayload: {
          entities: {
            project_name: 'Atlas',
            protocol_name: 'Protein Purification',
            workflow_step: null,
            requested_output: 'yield',
            activity_type: 'purification'
          }
        },
        snapshot: {
          notebookEntries: [
            {
              id: 'note-1',
              protocolId: 'prot-1',
              protocolName: 'Protein Purification',
              projectId: 'proj-1',
              projectName: 'Atlas',
              result: 'Yield improved by 20%.',
              updatedAt: '2026-03-20T10:00:00.000Z'
            }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Protein Purification',
              purpose: 'Affinity purification flow.',
              steps: ['Bind sample', 'Wash', 'Elute']
            }
          ],
          workflows: [
            {
              id: 'wf-1',
              name: 'Atlas purification workflow',
              description: 'Chromatography handoff',
              projectId: 'proj-1',
              projectName: 'Atlas',
              blocks: [
                { text: 'Bind lysate to resin' }
              ]
            }
          ]
        }
      });
      assert.equal(result.status, 'matched');
      assert.equal(result.source, 'fallback_json');
      assert.equal(result.items.some((item) => item.record_type === 'protocol'), true);
      assert.equal(result.items.some((item) => item.record_type === 'notebook'), true);
      assert.equal(result.items.some((item) => item.linked_protocol_name === 'Protein Purification'), true);
    });

    test('agent tool-call catalog stays in sync and prompt builders render tool metadata', () => {
      const toolNames = agentToolCall.AGENT_TOOL_CATALOG.map((entry) => entry.name);
      const schemaNames = Object.keys(agentToolCall.AGENT_TOOL_CALL_CATALOG).filter((name) => name !== '$defs');
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'notebook-draft', 'python-sandbox', 'sub-agent', 'memory', 'literature-search', 'paper-download', 'paper-analysis', 'protocol-generation']);
      assert.deepEqual(schemaNames, toolNames);
      const inventoryEntry = agentToolCall.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'inventory-lookup');
      const protocolEntry = agentToolCall.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'protocol-matching');
      const inventorySchema = agentToolCall.AGENT_TOOL_CALL_CATALOG['inventory-lookup'];
      const pythonSchema = agentToolCall.AGENT_TOOL_CALL_CATALOG['python-sandbox'];

      const selectionPrompt = agentToolCall.buildToolSelectionPrompt({
        message: 'Find the right protocol and draft the notebook.',
        conversation: [
          { role: 'user', text: 'I ran the HEK293 transfection.' }
        ],
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          protocol_candidates: ['HEK293 Transfection']
        },
        projectName: 'Atlas'
      });
      assert.equal(selectionPrompt.includes(`- ${inventoryEntry.name}: ${inventoryEntry.description}`), true);
      assert.equal(selectionPrompt.includes(`- ${protocolEntry.name}: ${protocolEntry.description}`), true);
      assert.equal(selectionPrompt.includes(`Usage: ${inventorySchema.description}`), true);
      assert.equal(selectionPrompt.includes('Active project context: Atlas'), true);
      assert.equal(selectionPrompt.includes('Recent conversation:\n1. user: I ran the HEK293 transfection.'), true);
      assert.equal(selectionPrompt.includes('User message: Find the right protocol and draft the notebook.'), true);
      assert.equal(selectionPrompt.includes('"primary_intent": "protocol_to_notebook"'), true);
      assert.equal(selectionPrompt.includes('"protocol_candidates": [\n    "HEK293 Transfection"\n  ]'), true);

      const argumentsPrompt = agentToolCall.buildToolArgumentsPrompt({
        message: 'Use inventory lookup first, then run python if needed.',
        conversation: [
          { role: 'assistant', text: 'Protocol was likely HEK293 Transfection.' }
        ],
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          protocol_candidates: ['HEK293 Transfection']
        },
        selectedToolNames: ['inventory-lookup', 'python-sandbox']
      });
      assert.equal(argumentsPrompt.includes('Selected tools in order: inventory-lookup, python-sandbox'), true);
      assert.equal(argumentsPrompt.includes('Tool: inventory-lookup'), true);
      assert.equal(argumentsPrompt.includes('Tool: python-sandbox'), true);
      assert.equal(argumentsPrompt.includes(`Detailed usage: ${inventorySchema.description}`), true);
      assert.equal(argumentsPrompt.includes(`Detailed usage: ${pythonSchema.description}`), true);
      assert.equal(argumentsPrompt.includes('Input schema JSON:'), true);
      assert.equal(argumentsPrompt.includes('"readback_paths"'), true);
      assert.equal(argumentsPrompt.includes('Recent conversation:\n1. assistant: Protocol was likely HEK293 Transfection.'), true);
      assert.equal(argumentsPrompt.includes('"primary_intent": "protocol_to_notebook"'), true);
      assert.equal(argumentsPrompt.includes('Tool: protocol-matching'), false);
    });

    test('agent tool-call catalog validators reject malformed catalog data', () => {
      assert.throws(
        () => agentToolCall.validateAgentToolCatalog([
          { name: 'inventory-lookup', description: 'first' },
          { name: 'inventory-lookup', description: 'second' }
        ]),
        /duplicate tool name/i
      );

      assert.throws(
        () => agentToolCall.validateAgentToolCatalog([
          { name: 'inventory-lookup' }
        ]),
        /missing description/i
      );

      assert.throws(
        () => agentToolCall.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            description: 'inventory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, agentToolCall.AGENT_TOOL_CATALOG),
        /missing schema for "record-lookup"/i
      );

      assert.throws(
        () => agentToolCall.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'record-lookup': {
            description: 'record usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-matching': {
            description: 'matching usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-generation': {
            description: 'notebook usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-draft': {
            description: 'notebook draft usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'python-sandbox': {
            description: 'python usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'sub-agent': {
            description: 'sub-agent usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          memory: {
            description: 'memory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'literature-search': {
            description: 'literature search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-download': {
            description: 'paper download usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-analysis': {
            description: 'paper usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-generation': {
            description: 'protocol generation usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, agentToolCall.AGENT_TOOL_CATALOG),
        /missing description/i
      );

      assert.throws(
        () => agentToolCall.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            description: 'inventory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'record-lookup': {
            description: 'record usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-matching': {
            description: 'matching usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-generation': {
            description: 'notebook usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-draft': {
            description: 'notebook draft usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'python-sandbox': {
            description: 'python usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'sub-agent': {
            description: 'sub-agent usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          memory: {
            description: 'memory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'literature-search': {
            description: 'literature search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-download': {
            description: 'paper download usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-analysis': {
            description: 'paper usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-generation': {
            description: 'protocol generation usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'made-up-tool': {
            description: 'made-up usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, agentToolCall.AGENT_TOOL_CATALOG),
        /unknown tool "made-up-tool"/i
      );
    });

    test('agent tool-call normalizes selection and arguments payloads and rejects invalid input', () => {
      const selection = agentToolCall.normalizeToolSelectionPayload({
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

      const invalidSelection = agentToolCall.normalizeToolSelectionPayload({
        tool_calls: [
          { tool_name: 'inventory-lookup' },
          { tool_name: 'inventory-lookup' }
        ]
      });
      assert.equal(invalidSelection.ok, false);
      assert.match(String(invalidSelection.error || ''), /duplicate tool/i);

      const argsPayload = agentToolCall.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'inventory-lookup',
            arguments: {
              query: 'PEI',
              limit: 5,
              inventory_search: {
                normalized_query: 'PEI',
                candidate_terms: ['PEI'],
                aliases: [],
                search_mode: 'exact_then_alias_then_fuzzy'
              }
            }
          }
        ]
      }, {
        selectedToolNames: ['inventory-lookup']
      });
      assert.equal(argsPayload.ok, true);
      assert.equal(argsPayload.payload.tool_calls[0].arguments.limit, 5);

      const invalidArgs = agentToolCall.normalizeToolArgumentsPayload({
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
      const runtime = agentToolCall.createAgentToolCallRuntime({
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
      const runtime = agentToolCall.createAgentToolCallRuntime();
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
      const runtime = agentToolCall.createAgentToolCallRuntime({
        toolExecutors: {
          'record-lookup': async ({ toolName, args, context, services }) => ({
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
        tool_name: 'record-lookup',
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
      assert.equal(result.tool_name, 'record-lookup');
      assert.equal(result.result.status, 'handled');
      assert.equal(result.result.items[0].message, 'Find protein purification records for Atlas.');
      assert.equal(result.result.items[0].projectName, 'Atlas');
      assert.deepEqual(result.result.items[0].deduped, ['Atlas']);
    });

    test('agent tool-call runtime supports sequential batches through injected state hooks', async () => {
      const runtime = agentToolCall.createAgentToolCallRuntime({
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
      const runtime = agentToolCall.createAgentToolCallRuntime();
      const result = await runtime.executeToolCall({
        tool_name: 'python-sandbox',
        arguments: {
          code: 'print("hello")'
        }
      });
      assert.equal(result.ok, false);
      assert.equal(result.tool_name, 'python-sandbox');
      assert.match(String(result.error || ''), /No tool executor is registered/i);
    });

  }
};
