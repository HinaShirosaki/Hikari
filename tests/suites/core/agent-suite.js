module.exports = function registerAgentSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent parser normalizes canonical parser payload', () => {
      const raw = {
        primary_intent: 'inventory_lookup',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: 'lookup',
          project_name: 'Atlas',
          protocol_name: null,
          protein_name: null,
          compound_name: 'Tris',
          inventory_item: 'Tris-HCl',
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: 'location'
        },
        inventory_search: {
          normalized_query: 'Tris-HCl',
          candidate_terms: ['Tris-HCl', 'tris', 'Tris-HCl'],
          aliases: ['tris(hydroxymethyl)aminomethane'],
          search_mode: 'exact_then_alias_then_fuzzy'
        },
        protocol_candidates: ['HEK293 Transfection'],
        reasoning_summary: 'Inventory lookup for Tris-HCl.'
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'inventory_lookup');
      assert.equal(result.payload.needs_clarification, false);
      assert.equal(result.payload.inventory_search.normalized_query, 'Tris-HCl');
      assert.equal(Array.isArray(result.payload.inventory_search.candidate_terms), true);
      assert.equal(result.payload.inventory_search.candidate_terms.length >= 2, true);
      assert.deepEqual(result.payload.protocol_candidates, []);
      assert.match(result.payload.reasoning_summary, /Inventory lookup/);
    });

    test('intent parser normalizes protocol candidates for protocol_to_notebook intent', () => {
      const raw = {
        primary_intent: 'protocol_to_notebook',
        needs_clarification: false,
        clarification_reason: null,
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
          requested_output: 'notebook'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: ['HEK293 Transfection', 'HEK293 transfection', 'Expi293 Transfection'],
        reasoning_summary: 'Protocol intent payload.'
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'protocol_to_notebook');
      assert.equal(Array.isArray(result.payload.protocol_candidates), true);
      assert.equal(result.payload.protocol_candidates.length <= 3, true);
      assert.equal(result.payload.protocol_candidates[0], 'HEK293 Transfection');
    });

    test('intent parser rejects legacy confidence and secondary_intents fields', () => {
      const withConfidence = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'General question.',
        confidence: 0.91
      });
      assert.equal(withConfidence.ok, false);
      assert.match(String(withConfidence.error || ''), /must not include confidence/i);

      const withSecondary = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'General question.',
        secondary_intents: ['inventory_lookup']
      });
      assert.equal(withSecondary.ok, false);
      assert.match(String(withSecondary.error || ''), /secondary_intents/i);
    });

    test('intent parser rejects protocol_candidates lists longer than 3', () => {
      const result = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'protocol_to_notebook',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: ['A', 'B', 'C', 'D'],
        reasoning_summary: 'Too many protocol candidates.'
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error || ''), /at most 3/i);
    });

    test('intent parser maps aliases and typo variants to canonical intents', () => {
      assert.equal(agentIntentParser.normalizeParserIntent('data_analysis_or_coding'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('coding-data-analysis'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('inventory_loopup'), 'inventory_lookup');
      assert.equal(agentIntentParser.normalizeParserIntent('record_loopup'), 'record_lookup');
    });

    test('intent parser prompt includes recent transcript and active project context', () => {
      const prompt = agentIntentParser.buildIntentParserPrompt({
        message: 'Do we have PEI in stock?',
        conversation: [
          { role: 'user', text: 'Hello' },
          { role: 'assistant', text: 'Hi there' }
        ],
        projectName: 'Cancer Study'
      });
      assert.match(prompt, /Active project context: Cancer Study/);
      assert.match(prompt, /Recent conversation:/);
      assert.match(prompt, /User message:/);
    });

    test('intent parser catalog stays in sync with allowed intents and rendered prompt', () => {
      const catalog = agentIntentParser.INTENT_PARSER_CATALOG;
      assert.deepEqual(catalog.map((entry) => entry.name), agentIntentParser.PARSER_ALLOWED_INTENTS);
      assert.equal(typeof catalog[0].rules, 'string');
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /## Allowed intents/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /### inventory_lookup/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Intent-specific output append:/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Do we have PEI in stock, and where is it\?/);
      assert.equal(/Output:\n\{/.test(agentIntentParser.INTENT_PARSER_PROMPT), false);
    });

    test('intent parser catalog validation rejects malformed entries', () => {
      const catalogPath = path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-intent.json');
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
        LLM_PROVIDERS: {
          OPENAI: 'openai'
        },
        requestOpenAiResponsesWithBackoff: async () => ({ raw: 'not json' }),
        extractResponseText: () => 'not json'
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
      assert.equal(result.notebook.entry_template.agentDraftStatus, 'needs_review');
      assert.equal(result.missing_placeholders.length, 1);
      assert.equal(result.follow_up_questions[0], 'Please provide sample name.');
    });

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
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'python-sandbox', 'sub-agent']);
      assert.deepEqual(schemaNames, toolNames);

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
      assert.match(selectionPrompt, /inventory-lookup/);
      assert.match(selectionPrompt, /protocol-matching/);
      assert.match(selectionPrompt, /python-sandbox/);
      assert.match(selectionPrompt, /sub-agent/);
      assert.match(selectionPrompt, /Active project context: Atlas/);

      const argumentsPrompt = agentToolCall.buildToolArgumentsPrompt({
        message: 'Use inventory lookup first, then run python if needed.',
        selectedToolNames: ['inventory-lookup', 'python-sandbox']
      });
      assert.match(argumentsPrompt, /Selected tools in order: inventory-lookup, python-sandbox/);
      assert.match(argumentsPrompt, /Input schema JSON:/);
      assert.match(argumentsPrompt, /readback_paths/);
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
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-matching': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-generation': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'python-sandbox': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'sub-agent': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'made-up-tool': {
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

    test('sub-agent runtime creates, messages, lists, and deletes managed sub-agents', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T10:00:00.000Z',
            '2026-03-22T10:00:01.000Z',
            '2026-03-22T10:00:02.000Z',
            '2026-03-22T10:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'subagent-fixed-1',
        runSubAgentTurn: async ({ phase, message }) => ({
          assistant_message: `${phase}: ${message}`,
          summary: `Handled ${phase}.`
        })
      });

      const created = await runtime.createSubAgent({
        name: 'paper-helper',
        system_prompt: 'You help summarize papers.',
        message: 'Read this abstract.',
        metadata: {
          task_type: 'paper-analysis'
        }
      });
      assert.equal(created.ok, true);
      assert.equal(created.status, 'created');
      assert.equal(created.agent.id, 'subagent-fixed-1');
      assert.equal(created.agent.messages.length, 2);
      assert.equal(created.agent.messages[1].role, 'assistant');

      const updated = await runtime.sendSubAgentMessage({
        agent_id: 'subagent-fixed-1',
        message: 'Now extract the main methods.'
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.status, 'updated');
      assert.equal(updated.agent.messages.length, 4);
      assert.match(String(updated.agent.last_response?.assistant_message || ''), /message: Now extract/i);

      const listed = runtime.listSubAgents();
      assert.equal(listed.ok, true);
      assert.equal(listed.items.length, 1);
      assert.equal(listed.items[0].id, 'subagent-fixed-1');

      const deleted = runtime.deleteSubAgent({
        agent_id: 'subagent-fixed-1',
        reason: 'Task finished'
      });
      assert.equal(deleted.ok, true);
      assert.equal(deleted.status, 'deleted');

      const missing = runtime.getSubAgent({
        agent_id: 'subagent-fixed-1'
      });
      assert.equal(missing.ok, false);
      assert.equal(missing.status, 'missing');
    });

    test('sub-agent runtime execute validates action-specific requirements', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime();

      const invalidCreate = await runtime.execute({
        action: 'create',
        system_prompt: '',
        message: 'hello'
      });
      assert.equal(invalidCreate.ok, false);
      assert.match(String(invalidCreate.error || ''), /system_prompt/i);

      const invalidAction = await runtime.execute({
        action: 'unknown'
      });
      assert.equal(invalidAction.ok, false);
      assert.match(String(invalidAction.error || ''), /must be one of create, message, delete, get, or list/i);
    });

    test('agent observability replays lifecycle and llm traces in order', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-observability-'));
      const logPath = path.join(tempDir, 'agent-chat.log');
      try {
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-request',
            requestId: 'req-1',
            timestamp: '2026-03-21T10:00:00.000Z',
            message: 'Do we have PEI?'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-lifecycle',
            requestId: 'req-1',
            stage: 'parser_completed',
            status: 'ok',
            timestamp: '2026-03-21T10:00:01.000Z'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-llm-trace',
            requestId: 'req-1',
            stage: 'intent_parser',
            provider: 'openai',
            model: 'gpt-5',
            summary: 'Intent parsed.',
            timestamp: '2026-03-21T10:00:02.000Z',
            request_payload: { prompt: '...' },
            response_payload: { primary_intent: 'inventory_lookup' }
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-result',
            requestId: 'req-1',
            ok: true,
            parser: { primary_intent: 'inventory_lookup' },
            timestamp: '2026-03-21T10:00:03.000Z'
          })
        });

        const replay = await agentObservability.replayRequestLifecycle({
          requestId: 'req-1',
          logPath
        });
        assert.equal(replay.ok, true);
        assert.equal(Array.isArray(replay.events), true);
        assert.equal(Array.isArray(replay.traces), true);
        assert.equal(replay.events.length, 1);
        assert.equal(replay.traces.length, 1);
        assert.equal(replay.traces[0].stage, 'intent_parser');
        assert.equal(Array.isArray(replay.summary.trace_stages), true);
        assert.equal(replay.summary.trace_stages.includes('intent_parser'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('python sandbox executes deterministic readback payload', async () => {
      const result = await agentPython.runPythonSandbox({
        code: 'import json\nopen("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42}))',
        readback_paths: ['out.json'],
        timeout_ms: 4000
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, 'ok');
      assert.equal(Array.isArray(result.readback_files), true);
      assert.equal(result.readback_files.length, 1);
      assert.match(String(result.readback_files[0].content || ''), /"value": 42/);
    });
  }
};
