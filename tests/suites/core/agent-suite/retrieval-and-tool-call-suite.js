module.exports = function registerAgentRetrievalAndToolCallSuite(context = {}) {
  const scope = context.scope || {};
  const toolLoading = scope.agentToolLoading && Object.keys(scope.agentToolLoading).length
    ? scope.agentToolLoading
    : (scope.agentToolCall || {});
  const toolExecution = scope.agentToolExecution && Object.keys(scope.agentToolExecution).length
    ? scope.agentToolExecution
    : (scope.agentToolCall || {});
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
      assert.equal(result.items.find((item) => item.name === 'Atlas construct')?.location, 'Shelf 3 / A7');
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

    test('lookup query derivation prefers the searched entity over requested output hints', () => {
      const inventoryRuntime = agentInventoryLookup.createAgentInventoryLookupRuntime();
      const recordRuntime = agentRecordLookup.createAgentRecordLookupRuntime();

      assert.equal(
        inventoryRuntime.deriveInventoryLookupQuery({
          message: 'Do we have acetic acid?',
          parserPayload: {
            entities: {
              requested_output: 'location'
            },
            inventory_search: {}
          }
        }),
        'Do we have acetic acid?'
      );

      assert.equal(
        recordRuntime.deriveRecordLookupQuery({
          message: 'Find protein purification records for Atlas.',
          parserPayload: {
            entities: {
              protocol_name: 'Protein Purification',
              project_name: 'Atlas',
              requested_output: 'yield'
            }
          }
        }),
        'Protein Purification'
      );
    });

    test('agent tool-call catalog stays in sync and prompt builders render tool metadata', () => {
      const toolNames = toolLoading.AGENT_TOOL_CATALOG.map((entry) => entry.name);
      const schemaNames = Object.keys(toolLoading.AGENT_TOOL_CALL_CATALOG).filter((name) => name !== '$defs');
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'notebook-draft', 'python-sandbox', 'sub-agent', 'memory', 'literature-search', 'purchase-recommendation', 'paper-download', 'paper-analysis', 'protocol-generation']);
      assert.deepEqual(schemaNames, toolNames);
      const inventoryEntry = toolLoading.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'inventory-lookup');
      const protocolEntry = toolLoading.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'protocol-matching');
      const inventorySchema = toolLoading.AGENT_TOOL_CALL_CATALOG['inventory-lookup'];
      const pythonSchema = toolLoading.AGENT_TOOL_CALL_CATALOG['python-sandbox'];

      const selectionPrompt = toolLoading.buildToolSelectionPrompt({
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
      assert.equal(selectionPrompt.includes(`Usage: ${inventorySchema.description}`), false);
      assert.equal(selectionPrompt.includes('Active project context: Atlas'), true);
      assert.equal(selectionPrompt.includes('Recent conversation:\n1. user: I ran the HEK293 transfection.'), true);
      assert.equal(selectionPrompt.includes('User message: Find the right protocol and draft the notebook.'), true);
      assert.equal(selectionPrompt.includes('"primary_intent": "protocol_to_notebook"'), true);
      assert.equal(selectionPrompt.includes('"protocol_candidates": [\n    "HEK293 Transfection"\n  ]'), true);

      const argumentsPrompt = toolLoading.buildToolArgumentsPrompt({
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

    test('agent tool provider resolves reasoning entry tools from the catalog schemas', () => {
      const toolProvider = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-provide.js'));
      const runtime = toolProvider.createAgentToolProviderRuntime();

      const scienceTools = runtime.provideTools({
        entryPoint: 'science_reasoning_entry',
        intent: 'general_science_question'
      });
      assert.equal(scienceTools.tool_names.includes('literature-search'), true);
      assert.equal(scienceTools.tool_names.includes('record-lookup'), true);
      assert.equal(scienceTools.tool_names.includes('python-sandbox'), true);
      assert.equal(scienceTools.tool_definitions.some((tool) => tool.name === 'literature-search'), true);
      assert.equal(
        scienceTools.tool_definitions.find((tool) => tool.name === 'literature-search').parameters.properties.source.$ref,
        '#/$defs/literature_source'
      );

      const deepResearchTools = runtime.provideTools({
        entryPoint: 'deep_research_entry',
        intent: 'result_analysis'
      });
      assert.equal(deepResearchTools.tool_names.includes('python-sandbox'), true);
      assert.equal(deepResearchTools.tool_names.includes('record-lookup'), true);
      assert.equal(deepResearchTools.tool_names.includes('literature-search'), true);
      assert.equal(deepResearchTools.tool_names.includes('sub-agent'), true);
      assert.deepEqual(deepResearchTools.tool_definitions.map((tool) => tool.name), deepResearchTools.tool_names);

      const catalogTools = runtime.provideTools();
      assert.equal(catalogTools.tool_names.includes('inventory-lookup'), true);
      assert.equal(catalogTools.tool_names.includes('literature-search'), true);
      assert.equal(catalogTools.tool_names.includes('purchase-recommendation'), true);
      assert.equal(catalogTools.tool_names.includes('protocol-generation'), true);
    });

    test('purchase recommendation runtime extracts JSON-LD products and ranks cheaper matches first', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const pages = {
        'https://vendor-a.test/filter': `
          <html>
            <head>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Vendor A Syringe Filter",
                  "image": "https://vendor-a.test/filter.png",
                  "brand": { "@type": "Brand", "name": "Vendor A" },
                  "offers": {
                    "@type": "Offer",
                    "priceCurrency": "USD",
                    "price": "12.50",
                    "url": "https://vendor-a.test/filter"
                  }
                }
              </script>
            </head>
            <body>metal-free endotoxin-free disposable syringe filter</body>
          </html>
        `,
        'https://vendor-b.test/filter': `
          <html>
            <head>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Vendor B Syringe Filter",
                  "image": "https://vendor-b.test/filter.png",
                  "brand": { "@type": "Brand", "name": "Vendor B" },
                  "offers": {
                    "@type": "Offer",
                    "priceCurrency": "USD",
                    "price": "19.99",
                    "url": "https://vendor-b.test/filter"
                  }
                }
              </script>
            </head>
            <body>metal-free endotoxin-free sterile syringe filter</body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor B result', url: 'https://vendor-b.test/filter' },
          { title: 'Vendor A result', url: 'https://vendor-a.test/filter' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        query: 'syringe filter',
        required_terms: ['metal-free', 'endotoxin-free'],
        budget_preference: 'cheap'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].title, 'Vendor A Syringe Filter');
      assert.equal(result.items[0].price_text, '$12.50');
      assert.equal(result.items[0].vendor, 'Vendor A');
      assert.equal(result.items[0].matched_requirements.includes('metal-free'), true);
      assert.equal(result.items[0].matched_requirements.includes('endotoxin-free'), true);
    });

    test('purchase recommendation runtime falls back to Open Graph metadata and rejects incomplete results', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const pages = {
        'https://vendor-a.test/filter': `
          <html>
            <head>
              <meta property="og:title" content="Fallback Syringe Filter" />
              <meta property="og:image" content="https://vendor-a.test/filter.png" />
              <meta property="og:site_name" content="Vendor A" />
              <meta property="product:price:amount" content="14.25" />
              <meta property="product:price:currency" content="USD" />
              <link rel="canonical" href="https://vendor-a.test/filter" />
            </head>
            <body>metal-free endotoxin-free ready to buy</body>
          </html>
        `,
        'https://vendor-b.test/filter': `
          <html>
            <head>
              <meta property="og:title" content="Incomplete Filter" />
              <meta property="og:image" content="https://vendor-b.test/filter.png" />
            </head>
            <body>metal-free endotoxin-free</body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor A result', url: 'https://vendor-a.test/filter' },
          { title: 'Vendor B result', url: 'https://vendor-b.test/filter' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        message: 'Find a cheap metal-free endotoxin-free syringe filter I can buy.'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'Fallback Syringe Filter');
      assert.equal(result.items[0].vendor, 'Vendor A');
      assert.equal(result.items[0].price_text, '$14.25');
      assert.equal(result.items[0].product_url, 'https://vendor-a.test/filter');
    });

    test('agent tool-call catalog validators reject malformed catalog data', () => {
      const missingDescriptionCatalog = toolLoading.AGENT_TOOL_CATALOG.filter((entry) => [
        'inventory-lookup',
        'record-lookup',
        'protocol-matching',
        'notebook-generation',
        'notebook-draft',
        'python-sandbox',
        'sub-agent',
        'memory',
        'literature-search',
        'paper-download',
        'paper-analysis',
        'protocol-generation'
      ].includes(entry?.name));

      assert.throws(
        () => toolLoading.validateAgentToolCatalog([
          { name: 'inventory-lookup', description: 'first' },
          { name: 'inventory-lookup', description: 'second' }
        ]),
        /duplicate tool name/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCatalog([
          { name: 'inventory-lookup' }
        ]),
        /missing description/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            description: 'inventory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, toolLoading.AGENT_TOOL_CATALOG),
        /missing schema for "record-lookup"/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
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
        }, missingDescriptionCatalog),
        /missing description/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
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
        }, missingDescriptionCatalog),
        /unknown tool "made-up-tool"/i
      );
    });

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
      const runtime = toolExecution.createAgentToolCallRuntime();
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
