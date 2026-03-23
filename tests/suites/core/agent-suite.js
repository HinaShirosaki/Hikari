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
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /## Allowed intents/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Intent-specific output append:/);
      assert.equal(/Output:\n\{/.test(agentIntentParser.INTENT_PARSER_PROMPT), false);

      let previousHeadingIndex = -1;
      agentIntentParser.PARSER_ALLOWED_INTENTS.forEach((intentName) => {
        const heading = `### ${intentName}`;
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
      assert.equal(renderedPrompt.includes('### inventory_lookup'), true);
      assert.equal(renderedPrompt.includes('Custom inventory description.'), true);
      assert.equal(renderedPrompt.includes('Intent-specific rule: Custom inventory rule.'), true);
      assert.equal(renderedPrompt.includes('- custom_inventory_field: Custom inventory append description.'), true);
      assert.equal(renderedPrompt.includes('User: "Where is the custom PEI bottle?"'), true);
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
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'python-sandbox', 'sub-agent', 'memory', 'literature-search', 'paper-download', 'paper-analysis', 'protocol-generation']);
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

    test('science reasoning loop enforces one tool per round and continues from evaluator feedback', async () => {
      const scriptedTurns = [
        {
          calls: [
            { callId: 'call-1', name: 'search_pubmed', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance', limit: 3 }) },
            { callId: 'call-2', name: 'search_web', argsText: JSON.stringify({ query: 'ignore this extra call', limit: 3 }) }
          ],
          text: 'I will start with PubMed.'
        },
        {
          calls: [],
          text: 'PubMed returned one paper, but I still need a broader review source.'
        },
        {
          calls: [
            { callId: 'call-3', name: 'search_web', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance review', limit: 3 }) }
          ],
          text: 'I will use a broader web-backed retrieval next.'
        },
        {
          calls: [],
          text: 'Now I have enough evidence to answer.'
        }
      ];
      const feedbackMessages = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          assert.deepEqual(toolDefinitions.map((tool) => tool.name), [
            'search_pubmed',
            'search_europe_pmc',
            'search_crossref',
            'search_uniprot',
            'search_web'
          ]);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session) => ({ step: session.step + 1 }),
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' },
              limit: { type: 'integer' }
            }
          }
        })),
        evaluateScienceRound: async ({ roundsExecuted }) => (
          roundsExecuted >= 2
            ? {
              satisfied: true,
              reason: 'Evidence is sufficient now.',
              missing_requirements: [],
              should_continue: false,
              next_tool_hint: null,
              can_answer_with_limitations: true
            }
            : {
              satisfied: false,
              reason: 'Need one broader review-style source.',
              missing_requirements: ['A broader source is still needed.'],
              should_continue: true,
              next_tool_hint: {
                tool_name: 'search_web',
                query: 'MAPK inhibitor resistance review',
                reason: 'Broaden beyond the first paper.'
              },
              can_answer_with_limitations: true
            }
        ),
        synthesizeScienceFinal: async () => ({
          answer: 'Resistance often involves pathway reactivation and compensatory signaling, supported by both the paper hit and broader review retrieval.',
          confidence: 0.77,
          decision_record: {
            assumptions: ['Only retrieved sources were used.'],
            open_questions: [],
            verification_notes: ['Two retrieval rounds completed.']
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'What causes MAPK inhibitor resistance?',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        runTool: async (toolName, args) => ({
          ok: true,
          tool_name: toolName,
          input: args,
          result: {
            items: [{ id: `${toolName}-1` }],
            citations: [
              {
                source: toolName === 'search_pubmed' ? 'pubmed' : 'web_source',
                pointer: `${toolName}-pointer`,
                reason: `Retrieved from ${toolName}.`
              }
            ],
            summary: `${toolName} completed.`
          },
          items: [{ id: `${toolName}-1` }],
          citations: [
            {
              source: toolName === 'search_pubmed' ? 'pubmed' : 'web_source',
              pointer: `${toolName}-pointer`,
              reason: `Retrieved from ${toolName}.`
            }
          ],
          summary: `${toolName} completed.`
        })
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 2);
      assert.equal(result.tool_trace.length, 2);
      assert.equal(result.tool_trace[0].tool_name, 'search_pubmed');
      assert.equal(result.tool_trace[0].truncated_multi_call, true);
      assert.equal(result.tool_trace[1].tool_name, 'search_web');
      assert.equal(feedbackMessages.length, 1);
      assert.match(feedbackMessages[0], /Need one broader review-style source/i);
      assert.match(result.answer, /pathway reactivation/i);
    });

    test('science reasoning loop returns partial answer when the tool budget is exhausted', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: false,
          error: 'LLM disabled for deterministic fallback testing.'
        }),
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: (session) => (
          session.step === 0
            ? [{ callId: 'call-1', name: 'run_python_sandbox', argsText: JSON.stringify({ code: 'print(1)' }) }]
            : []
        ),
        extractAgentSessionText: (session) => (
          session.step === 0
            ? 'I started a computation.'
            : 'Computation completed, but I still need historical context for the outliers.'
        ),
        continueAgentSessionWithToolOutputs: async () => ({ step: 1 }),
        continueAgentSessionWithUserMessage: async (session) => session,
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['code'],
            properties: {
              code: { type: 'string' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: false,
          reason: 'The computation finished, but interpretation is still incomplete.',
          missing_requirements: ['A clearer interpretation is still needed.'],
          should_continue: true,
          next_tool_hint: {
            tool_name: 'search_notebook_entries',
            query: 'previous similar assay',
            reason: 'Need contextual interpretation.'
          },
          can_answer_with_limitations: true
        })
      });

      const result = await runtime.runResultAnalysis({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Fit this assay and explain any outliers.',
        conversation: [],
        parserPayload: {
          primary_intent: 'result_analysis',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'result_analysis',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        maxRounds: 1,
        runTool: async () => ({
          ok: true,
          tool_name: 'run_python_sandbox',
          input: { code: 'print(1)' },
          result: {
            items: [{ run_id: 'py-1', status: 'ok' }],
            citations: [{ source: 'python_sandbox', pointer: 'py-1', reason: 'Computation completed.' }],
            summary: 'Python sandbox execution completed.'
          },
          items: [{ run_id: 'py-1', status: 'ok' }],
          citations: [{ source: 'python_sandbox', pointer: 'py-1', reason: 'Computation completed.' }],
          summary: 'Python sandbox execution completed.'
        })
      });

      assert.equal(result.status, 'partial');
      assert.equal(result.rounds_executed, 1);
      assert.match(result.answer, /Computation completed, but I still need historical context for the outliers\./);
      assert.match(result.answer, /Remaining gaps: A clearer interpretation is still needed\./);
      assert.match(result.answer, /Latest tool summary: Python sandbox execution completed\./);
      assert.equal(result.citations.length, 1);
      assert.equal(result.citations[0].source, 'python_sandbox');
      assert.equal(result.follow_up_questions.some((question) => /A clearer interpretation is still needed/.test(question)), true);
    });

    test('science reasoning loop turns invalid tool arguments into a failed tool result', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: () => [
          { callId: 'call-1', name: 'search_pubmed', argsText: JSON.stringify({ limit: 'five' }) }
        ],
        extractAgentSessionText: () => 'Trying PubMed.',
        continueAgentSessionWithToolOutputs: async () => ({ step: 1 }),
        continueAgentSessionWithUserMessage: async (session) => session,
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' },
              limit: { type: 'integer' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: false,
          reason: 'The tool call itself failed schema validation.',
          missing_requirements: ['A valid PubMed query is still required.'],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async ({ partial }) => ({
          answer: partial ? 'Partial answer after tool-validation failure.' : 'Complete answer.',
          confidence: 0.41,
          decision_record: {
            assumptions: ['The tool request failed validation before execution.'],
            open_questions: ['A valid query is still required.'],
            verification_notes: ['Returned a best-effort answer without executing the invalid tool call.']
          },
          follow_up_questions: ['What specific PubMed query should I use?']
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Find recent papers on CRISPR base editing.',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        maxRounds: 1,
        runTool: async () => {
          throw new Error('This executor should not run when args are invalid.');
        }
      });

      assert.equal(result.status, 'partial');
      assert.equal(result.tool_trace.length, 1);
      assert.equal(result.tool_trace[0].ok, false);
      assert.match(String(result.tool_trace[0].summary || ''), /required|type integer/i);
    });

    test('science reasoning loop requests clarification for project science when no project can be resolved', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async () => {
          throw new Error('Session should not start when project preflight fails.');
        }
      });

      const result = await runtime.runProjectScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Why did expression drop in this project?',
        conversation: [],
        parserPayload: {
          primary_intent: 'project_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'project_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        }
      });

      assert.equal(result.status, 'needs_more_info');
      assert.equal(result.rounds_executed, 0);
      assert.equal(result.follow_up_questions.length >= 1, true);
      assert.match(result.follow_up_questions[0], /Which project/i);
    });

    test('science reasoning loop exposes the expected result-analysis tool priority including python first', async () => {
      let capturedToolNames = [];
      const feedbackMessages = [];
      const executedTools = [];
      const scriptedTurns = [
        {
          calls: [],
          text: 'I can probably answer without running a computation.'
        },
        {
          calls: [
            { callId: 'call-1', name: 'run_python_sandbox', argsText: JSON.stringify({ code: 'print("trend")' }) }
          ],
          text: 'I should quantify the trend first.'
        },
        {
          calls: [],
          text: 'Now I have computation evidence.'
        }
      ];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          capturedToolNames = toolDefinitions.map((tool) => tool.name);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session) => ({ step: session.step + 1 }),
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: name === 'run_python_sandbox'
            ? {
              type: 'object',
              additionalProperties: false,
              required: ['code'],
              properties: {
                code: { type: 'string' }
              }
            }
            : {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
        })),
        evaluateScienceRound: async () => ({
          satisfied: true,
          reason: 'Harness evaluator thinks the current evidence is already sufficient.',
          missing_requirements: [],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async ({ toolTrace }) => ({
          answer: `Ready after ${toolTrace.length} computation step.`,
          confidence: 0.6,
          decision_record: {
            assumptions: [],
            open_questions: [],
            verification_notes: []
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runResultAnalysis({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Compute the assay trend.',
        conversation: [],
        parserPayload: {
          primary_intent: 'result_analysis',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'result_analysis',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        runTool: async (toolName, args) => {
          executedTools.push({ toolName, args });
          return {
            ok: true,
            tool_name: toolName,
            input: args,
            result: {
              items: [{ run_id: 'py-1' }],
              citations: [{ source: 'python_sandbox', pointer: 'py-1', reason: 'Computed the assay trend.' }],
              summary: 'Python sandbox execution completed.'
            },
            items: [{ run_id: 'py-1' }],
            citations: [{ source: 'python_sandbox', pointer: 'py-1', reason: 'Computed the assay trend.' }],
            summary: 'Python sandbox execution completed.'
          };
        }
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.tool_trace.length, 1);
      assert.equal(result.tool_trace[0].tool_name, 'run_python_sandbox');
      assert.equal(result.citations[0].source, 'python_sandbox');
      assert.equal(feedbackMessages.length, 1);
      assert.match(feedbackMessages[0], /Suggested next tool: run_python_sandbox\./i);
      assert.equal(executedTools.length, 1);
      assert.equal(executedTools[0].toolName, 'run_python_sandbox');
      assert.equal(executedTools[0].args.code, 'print("trend")');
      assert.match(result.answer, /Ready after 1 computation step/i);
      assert.equal(capturedToolNames[0], 'run_python_sandbox');
      assert.equal(capturedToolNames.includes('search_notebook_entries'), true);
      assert.equal(capturedToolNames.includes('search_web'), true);
    });

    test('protocol generation runtime emits import-ready protocol records with placeholders and troubleshooting', async () => {
      let createIdCounter = 0;
      const runtime = agentProtocolGeneration.createProtocolGenerationRuntime({
        now: () => '2026-03-22T12:00:00.000Z',
        createId: () => `generated-${++createIdCounter}`,
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            protocol: {
              name: 'PD-1 Nanobody Purification',
              purpose: 'Purify the expressed PD-1 nanobody from lysate.',
              materials: ['Ni-NTA resin', 'imidazole buffer'],
              steps: [
                'Clarify lysate.',
                'Bind clarified lysate to Ni-NTA resin for [time].',
                'Elute bound protein with imidazole.'
              ],
              troubleshooting: [
                {
                  problem: 'Low yield',
                  possible_cause: 'Insufficient binding time',
                  solution: 'Extend resin contact time.'
                }
              ]
            },
            result_summary: 'Generated a purification protocol.'
          }
        })
      });

      const result = await runtime.generateProtocol({
        title: 'PD-1 Nanobody Purification',
        method_text: 'Clarify lysate, bind it to Ni-NTA resin, then elute with imidazole.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'generated');
      assert.equal(result.protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(result.protocol.createdAt, '2026-03-22T12:00:00.000Z');
      assert.equal(result.protocol.updatedAt, '2026-03-22T12:00:00.000Z');
      assert.equal(Array.isArray(result.protocol.materials), true);
      assert.equal(result.protocol.materials[0], 'Ni-NTA resin');
      assert.equal(Array.isArray(result.protocol.steps), true);
      assert.equal(result.protocol.steps.length, 3);
      assert.match(String(result.protocol.steps[1].text || ''), /\{\{ph:/);
      assert.equal(result.protocol.steps[1].placeholders[0].name, 'time');
      assert.match(String(result.protocol.troubleshooting || ''), /Low yield/);
      assert.equal(result.summary, 'Generated a purification protocol.');
    });

    test('literature search runtime aggregates scholarly sources and builds query from parser payload', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        fetch: async (url) => {
          const normalizedUrl = String(url || '');
          if (normalizedUrl.includes('esearch.fcgi')) {
            return {
              ok: true,
              json: async () => ({
                esearchresult: {
                  idlist: ['12345']
                }
              })
            };
          }
          if (normalizedUrl.includes('esummary.fcgi')) {
            return {
              ok: true,
              json: async () => ({
                result: {
                  uids: ['12345'],
                  '12345': {
                    uid: '12345',
                    title: 'PD-1 stability study',
                    fulljournalname: 'Nature Biotechnology',
                    pubdate: '2024-01-15',
                    authors: [{ name: 'Lee A' }],
                    articleids: [{ idtype: 'doi', value: '10.1000/pd1' }]
                  }
                }
              })
            };
          }
          if (normalizedUrl.includes('api.crossref.org/works')) {
            return {
              ok: true,
              json: async () => ({
                message: {
                  items: [
                    {
                      DOI: '10.1000/cross',
                      title: ['Crossref PD-1 review'],
                      URL: 'https://doi.org/10.1000/cross',
                      author: [{ given: 'Mia', family: 'Chen' }],
                      issued: { 'date-parts': [[2023, 10, 1]] },
                      'container-title': ['Science']
                    }
                  ]
                }
              })
            };
          }
          if (normalizedUrl.includes('europepmc')) {
            return {
              ok: true,
              json: async () => ({
                resultList: {
                  result: [
                    {
                      id: 'PMC123',
                      pmid: '321',
                      pmcid: 'PMC123',
                      doi: '10.1000/eupmc',
                      title: 'Europe PMC PD-1 methods',
                      authorString: 'Pat Doe',
                      journalTitle: 'Cell',
                      pubYear: '2022'
                    }
                  ]
                }
              })
            };
          }
          if (normalizedUrl.includes('rest.uniprot.org')) {
            return {
              ok: true,
              json: async () => ({
                results: [
                  {
                    primaryAccession: 'Q99999',
                    uniProtkbId: 'PD1_HUMAN',
                    proteinDescription: {
                      recommendedName: {
                        fullName: {
                          value: 'Programmed cell death protein 1'
                        }
                      }
                    },
                    genes: [
                      {
                        geneName: {
                          value: 'PDCD1'
                        }
                      }
                    ],
                    organism: {
                      scientificName: 'Homo sapiens'
                    },
                    sequence: {
                      length: 288
                    },
                    entryType: 'Reviewed'
                  }
                ]
              })
            };
          }
          throw new Error(`Unexpected URL ${normalizedUrl}`);
        }
      });

      const result = await runtime.searchLiterature({
        parser_payload: {
          primary_intent: 'literature_search',
          entities: {
            protein_name: 'PD-1',
            requested_output: 'recent papers',
            paper_title: null,
            project_name: null,
            activity_type: null,
            protocol_name: null,
            compound_name: null,
            inventory_item: null,
            cell_line: null,
            workflow_step: null
          }
        },
        sources: ['pubmed', 'crossref', 'europe_pmc', 'uniprot'],
        limit: 6
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.match(String(result.query || ''), /PD-1/i);
      assert.deepEqual(result.sources, ['pubmed', 'crossref', 'europe_pmc', 'uniprot']);
      assert.equal(result.items.some((item) => item.source === 'pubmed' && item.pmid === '12345'), true);
      assert.equal(result.items.some((item) => item.source === 'crossref' && item.doi === '10.1000/cross'), true);
      assert.equal(result.items.some((item) => item.source === 'europe_pmc' && item.pmcid === 'PMC123'), true);
      assert.equal(result.items.some((item) => item.source === 'uniprot' && item.accession === 'Q99999'), true);
      assert.equal(result.citations.some((item) => item.source === 'pubmed' && item.pointer === '10.1000/pd1'), true);
      assert.equal(result.source_counts.pubmed, 1);
      assert.equal(result.source_counts.crossref, 1);
      assert.equal(result.source_counts.europe_pmc, 1);
      assert.equal(result.source_counts.uniprot, 1);
    });

    test('literature search runtime falls back to web search when scholarly sources are empty', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => [],
        searchCrossrefRecords: async () => [],
        searchEuropePmcRecords: async () => [],
        searchUniProtRecords: async () => [],
        searchWebResults: async () => ({
          items: [
            {
              title: 'Review of PD-1 binders',
              url: 'https://example.org/review',
              snippet: 'A recent external review of PD-1 binders.'
            }
          ]
        })
      });

      const result = await runtime.execute({
        query: 'PD-1 binder review',
        source: 'auto',
        limit: 5
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.sources.includes('web'), true);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].source, 'web');
      assert.equal(result.items[0].source_domain, 'example.org');
      assert.match(String(result.summary || ''), /web: 1/i);
    });

    test('paper download runtime extracts PDF candidates and streams direct download progress into paper storage', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-direct-'));
      const progressEvents = [];
      let releaseSecondChunk = null;
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-direct-1',
          onJobUpdate: (job) => {
            progressEvents.push({
              status: job.status,
              progress_ratio: job.progress_ratio,
              received_bytes: job.received_bytes,
              total_bytes: job.total_bytes
            });
          },
          fetch: async () => ({
            ok: true,
            status: 200,
            headers: {
              get(name) {
                const normalized = String(name || '').toLowerCase();
                if (normalized === 'content-type') {
                  return 'application/pdf';
                }
                if (normalized === 'content-length') {
                  return '21';
                }
                return '';
              }
            },
            body: {
              async *[Symbol.asyncIterator]() {
                yield Buffer.from('%PDF-1.7\n123');
                await new Promise((resolve) => {
                  releaseSecondChunk = resolve;
                });
                yield Buffer.from('4567890tail');
              }
            }
          })
        });

        const extraction = agentPaperDownload.extractPaperDownloadTargets({
          page_url: 'https://example.org/article',
          page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
          message: 'Mirror link: https://cdn.example.org/paper-copy.pdf'
        });
        assert.equal(extraction.selected_pdf_url, 'https://example.org/downloads/paper.pdf');
        assert.equal(extraction.candidate_pdf_urls.includes('https://cdn.example.org/paper-copy.pdf'), true);

        const started = await runtime.startDownload({
          action: 'start',
          page_url: 'https://example.org/article',
          page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
          linked_type: 'project',
          linked_name: 'Atlas',
          storage_path: storageRoot,
          paper_title: 'PD-1 paper'
        });

        assert.equal(started.ok, true);
        assert.equal(started.status, 'started');
        await new Promise((resolve) => setTimeout(resolve, 10));

        const inFlight = runtime.getDownloadStatus({
          download_id: 'paper-download-direct-1'
        });
        assert.equal(inFlight.status, 'downloading');
        assert.equal(inFlight.method, 'direct');
        assert.equal(inFlight.selected_pdf_url, 'https://example.org/downloads/paper.pdf');
        assert.equal(inFlight.progress_ratio > 0 && inFlight.progress_ratio < 1, true);

        releaseSecondChunk();
        const completed = await runtime.waitForDownload({
          download_id: 'paper-download-direct-1'
        });
        assert.equal(completed.ok, true);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.method, 'direct');
        assert.equal(completed.relative_path.includes('Project/Atlas/Papers/'), true);
        assert.equal(completed.file_name.endsWith('.pdf'), true);
        const saved = await fsPromises.readFile(completed.file_path);
        assert.equal(saved.subarray(0, 5).toString('utf8'), '%PDF-');
        assert.equal(progressEvents.some((entry) => entry.status === 'downloading' && entry.progress_ratio > 0 && entry.progress_ratio < 1), true);
      } finally {
        if (typeof releaseSecondChunk === 'function') {
          releaseSecondChunk();
        }
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('paper download runtime falls back to a browser session and terminates it after completion', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-browser-'));
      let terminatedSession = null;
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-browser-1',
          fetch: async () => ({
            ok: false,
            status: 403,
            headers: {
              get(name) {
                return String(name || '').toLowerCase() === 'content-type'
                  ? 'text/html'
                  : '';
              }
            },
            text: async () => '<html><body>Access denied. Verify you are human.</body></html>'
          }),
          startBrowserDownloadSession: async ({ targetFilePath, updateProgress }) => {
            updateProgress({
              status: 'browser_downloading',
              browser_session_active: true,
              browser_session_id: 'browser-session-1',
              received_bytes: 32,
              total_bytes: 64
            });
            await fsPromises.mkdir(path.dirname(targetFilePath), { recursive: true });
            await fsPromises.writeFile(targetFilePath, Buffer.from('%PDF-1.7 browser-session'));
            updateProgress({
              status: 'browser_downloading',
              browser_session_active: true,
              browser_session_id: 'browser-session-1',
              received_bytes: 64,
              total_bytes: 64
            });
            return {
              ok: true,
              session_id: 'browser-session-1',
              file_path: targetFilePath,
              file_name: path.basename(targetFilePath),
              relative_path: path.relative(storageRoot, targetFilePath).split(path.sep).join('/'),
              received_bytes: 64,
              total_bytes: 64,
              summary: 'Browser download completed.'
            };
          },
          terminateBrowserDownloadSession: async ({ session_id }) => {
            terminatedSession = session_id;
          }
        });

        const result = await runtime.downloadPaper({
          paper_pdf_url: 'https://blocked.example.org/paper.pdf',
          page_url: 'https://blocked.example.org/article',
          linked_type: 'project',
          linked_name: 'Atlas',
          storage_path: storageRoot
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(result.method, 'browser');
        assert.equal(result.browser_session_id, 'browser-session-1');
        assert.equal(result.browser_session_terminated, true);
        assert.equal(terminatedSession, 'browser-session-1');
        const saved = await fsPromises.readFile(result.file_path);
        assert.equal(saved.subarray(0, 5).toString('utf8'), '%PDF-');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('paper analysis runtime summarizes a paper and extracts a protocol candidate', async () => {
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'This paper describes engineered PD-1 nanobodies and reports improved expression after purification optimization.',
            key_findings: [
              'Engineered nanobodies retained target binding.',
              'Purification changes improved recovered material.'
            ],
            method_overview: 'The authors expressed the nanobody in E. coli and purified it by Ni-NTA affinity chromatography.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify engineered PD-1 nanobodies.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin, wash, and elute with imidazole.',
              materials: ['Ni-NTA resin', 'imidazole buffer'],
              steps: ['Clarify lysate', 'Bind to resin', 'Elute with imidazole'],
              notes: 'Exact buffer composition was not fully specified.'
            },
            result_summary: 'Summarized the paper and extracted one purification procedure.'
          }
        })
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Expression rescue and purification optimization for PD-1 nanobodies.',
          methods: [
            'Express nanobody in E. coli.',
            'Purify using Ni-NTA affinity chromatography.'
          ]
        },
        message: 'Summarize the paper and extract the protocol.',
        extract_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.paper_title, 'Engineered PD-1 Nanobodies');
      assert.match(String(result.brief_summary || ''), /engineered PD-1 nanobodies/i);
      assert.equal(Array.isArray(result.key_findings), true);
      assert.equal(result.protocol_extraction.title, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol, null);
      assert.match(String(result.summary || ''), /extracted one purification procedure/i);
    });

    test('paper analysis runtime can generate an import-ready protocol from extracted methods', async () => {
      let capturedProtocolInput = null;
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'The paper presents a practical purification workflow for a PD-1 nanobody construct.',
            key_findings: ['Affinity purification was central to the workflow.'],
            method_overview: 'Cells were lysed and the tagged nanobody was purified on Ni-NTA resin.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify a tagged PD-1 nanobody.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin for [time], wash, and elute.',
              materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
              steps: ['Clarify lysate', 'Bind to Ni-NTA resin for [time]', 'Elute bound protein'],
              notes: 'Binding duration was not explicitly stated.'
            },
            result_summary: 'Paper analysis completed and protocol candidate prepared.'
          }
        }),
        protocolGenerationRuntime: {
          generateProtocol: async (input) => {
            capturedProtocolInput = input;
            return {
              ok: true,
              status: 'generated',
              protocol: {
                id: 'protocol-generated-1',
                name: 'PD-1 Nanobody Purification',
                createdAt: '2026-03-22T12:05:00.000Z',
                updatedAt: '2026-03-22T12:05:00.000Z',
                purpose: 'Purify a tagged PD-1 nanobody.',
                materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
                steps: [
                  {
                    id: 'step-1',
                    text: 'Clarify lysate',
                    placeholders: []
                  }
                ],
                troubleshooting: 'Problem: Low binding; Possible cause: Short incubation; Solution: Increase contact time.'
              },
              summary: 'Generated protocol from paper analysis.'
            };
          }
        }
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Purification-focused workflow for PD-1 nanobody constructs.',
          methods: ['Clarify lysate', 'Bind to Ni-NTA resin', 'Elute protein']
        },
        message: 'Extract the protocol and generate an importable protocol JSON.',
        extract_protocol: true,
        generate_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.generated_protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol.troubleshooting.includes('Low binding'), true);
      assert.equal(capturedProtocolInput.source_paper_title, 'Engineered PD-1 Nanobodies');
      assert.equal(capturedProtocolInput.title, 'PD-1 Nanobody Purification');
      assert.match(String(capturedProtocolInput.method_text || ''), /Ni-NTA resin/i);
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

    test('sub-agent runtime tracks liveness from process state instead of timeout-only age checks', async () => {
      let createIndex = 0;
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:10:00.000Z',
        createId: () => {
          createIndex += 1;
          return `subagent-live-${createIndex}`;
        },
        isProcessAlive: (processId) => Number(processId) === 4312,
        runSubAgentTurn: async ({ phase }) => ({
          assistant_message: `${phase} ok`,
          summary: `${phase} ok`
        })
      });

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-1',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 4312,
        summary: 'Python still running.'
      });
      const processBacked = runtime.getSubAgent({
        agent_id: 'subagent-live-1'
      });
      assert.equal(processBacked.ok, true);
      assert.equal(processBacked.agent.liveness.live, true);
      assert.equal(processBacked.agent.liveness.state, 'running');
      assert.equal(processBacked.agent.liveness.reason, 'process_alive');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-2',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        summary: 'Long run with no OS pid exposed yet.'
      });
      const noPid = runtime.getSubAgent({
        agent_id: 'subagent-live-2'
      });
      assert.equal(noPid.ok, true);
      assert.equal(noPid.agent.liveness.live, true);
      assert.equal(noPid.agent.liveness.state, 'running');
      assert.equal(noPid.agent.liveness.reason, 'heartbeat_observed');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-3',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 9999,
        summary: 'This worker exited unexpectedly.'
      });
      const dead = runtime.getSubAgent({
        agent_id: 'subagent-live-3'
      });
      assert.equal(dead.ok, true);
      assert.equal(dead.agent.liveness.live, false);
      assert.equal(dead.agent.liveness.state, 'dead');
      assert.equal(dead.agent.liveness.reason, 'process_exited');
    });

    test('context management runtime builds layered envelopes with prompt blocks and memory candidates', () => {
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
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
        createId: () => 'task-fixed-1'
      });

      runtime.startTask({
        session_id: 'thread-1',
        task_type: 'protocol_notebook',
        intent: 'protocol_to_notebook',
        status: 'needs_more_info',
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload'
        },
        selected_protocol: {
          id: 'prot-1',
          name: 'HEK293 Transfection'
        },
        missing_fields: [
          {
            placeholder_key: 'sample_name',
            display: 'sample name',
            reason: 'The sample label was not provided.'
          }
        ],
        known_values: {
          cell_line: 'HEK293'
        },
        follow_up_questions: ['Which sample name did you use?'],
        goals: ['Finish the notebook draft'],
        constraints: ['Do not invent values']
      });

      runtime.recordToolRound({
        session_id: 'thread-1',
        tool_name: 'protocol-matching',
        summary: 'Selected HEK293 Transfection.',
        result: {
          selected_protocol: {
            id: 'prot-1',
            name: 'HEK293 Transfection'
          }
        }
      });

      const envelope = runtime.buildContextEnvelope({
        session_id: 'thread-1',
        message: 'The sample name was TUBE42.',
        conversation: [
          { role: 'user', text: 'Draft the transfection notebook.' },
          { role: 'assistant', text: 'Which sample name did you use?' },
          { role: 'user', text: 'The sample name was TUBE42.' }
        ],
        tool_outputs: [
          {
            tool_name: 'protocol-matching',
            summary: 'Selected HEK293 Transfection.',
            result: {
              selected_protocol: {
                id: 'prot-1',
                name: 'HEK293 Transfection'
              }
            }
          }
        ],
        long_term_memory: [
          {
            id: 'mem-1',
            category: 'preference',
            key: 'output_format',
            summary: 'Use concise bullet points.',
            value: 'concise bullets'
          }
        ]
      });

      assert.equal(envelope.session_id, 'thread-1');
      assert.equal(envelope.mode, agentContextManagement.CONTEXT_MODES.ACTIVE_TASK);
      assert.equal(envelope.active_task.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(envelope.layers.immediate.current_user_request, 'The sample name was TUBE42.');
      assert.equal(envelope.layers.immediate.recent_conversation.length, 3);
      assert.equal(envelope.layers.session_memory.current_project_state.name, 'Atlas');
      assert.equal(envelope.layers.long_term_memory.length, 1);
      assert.equal(envelope.memory_candidates.some((item) => item.category === 'project_name' && item.key === 'Atlas'), true);
      assert.match(String(envelope.prompt_blocks.immediate || ''), /Immediate working context:/);
      assert.match(String(envelope.prompt_blocks.session_memory || ''), /Session memory summary:/);
      assert.match(String(envelope.prompt_blocks.long_term_memory || ''), /Long-term memory:/);
    });

    test('context management runtime preserves follow-up answers and returns to ready mode after completion', () => {
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T11:00:00.000Z',
            '2026-03-22T11:00:01.000Z',
            '2026-03-22T11:00:02.000Z',
            '2026-03-22T11:00:03.000Z',
            '2026-03-22T11:00:04.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'task-fixed-2'
      });

      runtime.startTask({
        session_id: 'thread-2',
        task_type: 'protocol_notebook',
        intent: 'protocol_to_notebook',
        selected_protocol: {
          id: 'prot-2',
          name: 'Binder Purification'
        },
        missing_fields: [
          {
            key: 'sample_name',
            display: 'sample name',
            reason: 'Still needed.'
          }
        ],
        known_values: {
          operator: 'Shiyifan'
        }
      });
      runtime.recordFollowUpQuestion({
        session_id: 'thread-2',
        question: 'Which sample name did you purify?'
      });
      runtime.recordFollowUpAnswer({
        session_id: 'thread-2',
        answer: 'Sample was Atlas-7.',
        provided_values: {
          sample_name: 'Atlas-7'
        },
        resolved_fields: ['sample_name']
      });

      const activeEnvelope = runtime.buildContextEnvelope({
        session_id: 'thread-2',
        message: 'Sample was Atlas-7.'
      });
      assert.equal(activeEnvelope.mode, agentContextManagement.CONTEXT_MODES.ACTIVE_TASK);
      assert.equal(activeEnvelope.active_task.known_values.sample_name, 'Atlas-7');
      assert.equal(activeEnvelope.active_task.selected_protocol.name, 'Binder Purification');
      assert.equal(activeEnvelope.active_task.missing_fields.some((item) => item.key === 'sample_name'), false);
      assert.equal(activeEnvelope.active_task.follow_up_questions.includes('Which sample name did you purify?'), true);

      runtime.completeTask({
        session_id: 'thread-2',
        status: 'completed',
        completion_summary: 'Notebook draft completed for Atlas-7.'
      });

      const readyEnvelope = runtime.buildContextEnvelope({
        session_id: 'thread-2',
        message: 'Thanks.'
      });
      assert.equal(readyEnvelope.mode, agentContextManagement.CONTEXT_MODES.READY);
      assert.equal(readyEnvelope.active_task, null);
      assert.equal(readyEnvelope.layers.immediate.current_task_state, null);
      assert.equal(readyEnvelope.layers.session_memory.recent_completed_tasks[0].summary, 'Notebook draft completed for Atlas-7.');
    });

    test('context management runtime prunes expired sessions by idle time', () => {
      let currentTime = '2026-03-22T12:00:00.000Z';
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: () => currentTime,
        sessionTtlMs: 1000
      });

      runtime.startTask({
        session_id: 'thread-expire',
        task_type: 'science_loop',
        intent: 'general_science_question'
      });
      currentTime = '2026-03-22T12:00:02.500Z';

      const removed = runtime.pruneExpiredSessions();
      assert.deepEqual(removed, ['thread-expire']);
      assert.equal(runtime.getSession('thread-expire'), null);
    });

    test('memory runtime remembers, updates, recalls, lists, and forgets long-term memory', async () => {
      const runtime = agentMemory.createAgentMemoryRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T13:00:00.000Z',
            '2026-03-22T13:00:01.000Z',
            '2026-03-22T13:00:02.000Z',
            '2026-03-22T13:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'memory-fixed-1'
      });

      const stored = await runtime.execute({
        action: 'remember',
        category: 'preference',
        key: 'output_format',
        summary: 'User prefers concise summaries.',
        value: 'concise',
        tags: ['format']
      });
      assert.equal(stored.ok, true);
      assert.equal(stored.status, 'stored');
      assert.equal(stored.item.id, 'memory-fixed-1');

      const updated = await runtime.execute({
        action: 'remember',
        category: 'preference',
        key: 'output_format',
        summary: 'User prefers concise bullet summaries.',
        value: 'bullet list',
        tags: ['format', 'concise']
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.status, 'updated');
      assert.equal(updated.item.id, 'memory-fixed-1');

      const recalled = await runtime.execute({
        action: 'recall',
        query: 'bullet',
        limit: 5
      });
      assert.equal(recalled.ok, true);
      assert.equal(recalled.status, 'matched');
      assert.equal(recalled.items.length, 1);
      assert.equal(recalled.items[0].summary, 'User prefers concise bullet summaries.');

      const listed = await runtime.execute({
        action: 'list',
        limit: 5
      });
      assert.equal(listed.ok, true);
      assert.equal(listed.items.length, 1);

      const forgotten = await runtime.execute({
        action: 'forget',
        category: 'preference',
        key: 'output_format'
      });
      assert.equal(forgotten.ok, true);
      assert.equal(forgotten.removed_count, 1);

      const missing = await runtime.execute({
        action: 'recall',
        query: 'bullet'
      });
      assert.equal(missing.status, 'empty');
    });

    test('memory runtime persists JSON records when memoryFilePath is provided', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-memory-'));
      const memoryFilePath = path.join(tempDir, 'memory.json');
      try {
        const runtime = agentMemory.createAgentMemoryRuntime({
          memoryFilePath,
          now: (() => {
            let index = 0;
            const values = [
              '2026-03-22T14:00:00.000Z',
              '2026-03-22T14:00:01.000Z'
            ];
            return () => values[Math.min(index++, values.length - 1)];
          })(),
          createId: () => 'memory-file-1'
        });

        await runtime.remember({
          category: 'project_name',
          key: 'Atlas',
          summary: 'Atlas is the current binder optimization project.',
          value: {
            project_id: 'proj-1'
          }
        });

        const raw = JSON.parse(await fsPromises.readFile(memoryFilePath, 'utf8'));
        assert.equal(Array.isArray(raw.items), true);
        assert.equal(raw.items.length, 1);
        assert.equal(raw.items[0].id, 'memory-file-1');

        const secondRuntime = agentMemory.createAgentMemoryRuntime({
          memoryFilePath
        });
        const recalled = await secondRuntime.recall({
          query: 'binder optimization'
        });
        assert.equal(recalled.ok, true);
        assert.equal(recalled.items.length, 1);
        assert.equal(recalled.items[0].key, 'Atlas');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat log runtime creates session files, updates index summaries, and reconstructs renderer messages', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-log-'));
      try {
        const runtime = agentChatLog.createAgentChatLogRuntime({
          now: (() => {
            let index = 0;
            const values = [
              '2026-03-22T15:00:00.000Z',
              '2026-03-22T15:00:01.000Z',
              '2026-03-22T15:00:02.000Z',
              '2026-03-22T15:00:03.000Z'
            ];
            return () => values[Math.min(index++, values.length - 1)];
          })(),
          createId: (() => {
            let index = 0;
            return () => `chat-fixed-${index += 1}`;
          })()
        });

        const created = await runtime.createSession({
          storagePath: tempDir,
          projectId: 'proj-1',
          projectName: 'Atlas'
        });
        assert.equal(created.ok, true);
        assert.equal(created.session.id, 'chat-fixed-1');

        await runtime.appendUserMessage({
          storagePath: tempDir,
          sessionId: created.session.id,
          text: 'Where is the Atlas binder notebook?',
          projectId: 'proj-1',
          projectName: 'Atlas',
          timestamp: '2026-03-22T15:00:01.000Z'
        });

        const assistantMessage = runtime.buildAssistantMessageFromResult({
          result: {
            ok: true,
            parser: {
              primary_intent: 'record_lookup',
              needs_clarification: false,
              reasoning_summary: 'Matched record lookup.'
            },
            record_lookup: {
              status: 'matched',
              query: 'Atlas binder',
              items: [
                {
                  record_type: 'notebook',
                  id: 'note-1',
                  title: 'Atlas Binder Notebook'
                }
              ]
            },
            developer_trace: []
          },
          requestText: 'Where is the Atlas binder notebook?',
          messageId: 'assistant-fixed-1',
          timestamp: '2026-03-22T15:00:02.000Z'
        });

        await runtime.appendRows(tempDir, created.session.id, [
          {
            type: 'agent-chat-request',
            session_id: created.session.id,
            requestId: 'req-1',
            timestamp: '2026-03-22T15:00:01.500Z',
            projectId: 'proj-1',
            projectName: 'Atlas',
            message: 'Where is the Atlas binder notebook?'
          },
          {
            type: 'agent-lifecycle',
            session_id: created.session.id,
            requestId: 'req-1',
            stage: 'parser_completed',
            timestamp: '2026-03-22T15:00:01.700Z'
          },
          {
            type: 'agent-chat-result',
            session_id: created.session.id,
            requestId: 'req-1',
            timestamp: '2026-03-22T15:00:01.900Z',
            response_type: 'record_lookup',
            ok: true
          },
          {
            type: 'assistant-message',
            session_id: created.session.id,
            message_id: assistantMessage.id,
            timestamp: assistantMessage.createdAt,
            text: assistantMessage.text,
            meta: assistantMessage.meta
          }
        ]);

        const listed = await runtime.listSessions({
          storagePath: tempDir
        });
        assert.equal(listed.ok, true);
        assert.equal(listed.items.length, 1);
        assert.equal(listed.items[0].title, 'Where is the Atlas binder notebook?');
        assert.equal(listed.items[0].message_count, 2);
        assert.equal(listed.items[0].request_count, 1);
        assert.equal(listed.items[0].project_name, 'Atlas');

        const loaded = await runtime.getSession({
          storagePath: tempDir,
          sessionId: created.session.id,
          includeRows: true
        });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.messages.length, 2);
        assert.equal(loaded.messages[0].role, 'user');
        assert.equal(loaded.messages[1].role, 'assistant');
        assert.match(String(loaded.messages[1].text || ''), /Found 1 record match/);
        assert.equal(loaded.messages[1].meta.record_lookup.status, 'matched');
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle'), true);

        const indexPath = path.join(tempDir, 'chat_log', 'index.json');
        const index = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
        assert.equal(Array.isArray(index.sessions), true);
        assert.equal(index.sessions[0].id, created.session.id);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat log runtime builds fallback assistant message for controller errors', () => {
      const runtime = agentChatLog.createAgentChatLogRuntime();
      const assistantMessage = runtime.buildAssistantMessageFromError({
        errorMessage: 'Provider timeout.',
        requestText: 'Analyze the latest assay.'
      });

      assert.equal(assistantMessage.role, 'assistant');
      assert.match(String(assistantMessage.text || ''), /Provider timeout/);
      assert.equal(assistantMessage.meta.parser.needs_clarification, true);
      assert.equal(assistantMessage.meta.parser.clarification_reason, 'agent_error');
      assert.equal(assistantMessage.meta.requestText, 'Analyze the latest assay.');
    });

    test('agent tool smoke-test runtime manually exercises every registered tool', async () => {
      const runtime = agentToolSmokeTest.createAgentToolSmokeTestRuntime();
      const result = await runtime.runAllTools();

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.tool_count, runtime.toolNames.length);
      assert.equal(result.failed_count, 0);
      assert.equal(result.passed_count, result.tool_count);
      assert.deepEqual(result.items.map((item) => item.tool_name), runtime.toolNames);
      assert.equal(result.items.every((item) => item.ok === true), true);
      assert.equal(result.items.every((item) => Number.isFinite(Number(item.duration_ms))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'python-sandbox' && /out\.json/.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'paper-download' && /\.pdf/i.test(String(item.preview || ''))), true);
      assert.match(String(result.summary || ''), /tools passed/i);
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

    test('python sandbox executes deterministic readback payload and emits lifecycle callbacks', async () => {
      const lifecycle = {
        started: 0,
        heartbeats: 0,
        completed: 0
      };
      const result = await agentPython.runPythonSandbox({
        code: [
          'import json',
          'import time',
          'open("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42}))',
          'print("sandbox-start")',
          'time.sleep(0.15)',
          'print("sandbox-end")'
        ].join('\n'),
        readback_paths: ['out.json'],
        timeout_ms: 4000
      }, {
        heartbeatIntervalMs: 25,
        onTaskStarted: async ({ process_id }) => {
          lifecycle.started += 1;
          assert.equal(Number(process_id) > 0, true);
        },
        onHeartbeat: async ({ elapsed_ms }) => {
          lifecycle.heartbeats += 1;
          assert.equal(Number.isFinite(Number(elapsed_ms)), true);
        },
        onTaskCompleted: async ({ process_id, exit_code }) => {
          lifecycle.completed += 1;
          assert.equal(Number(process_id) > 0, true);
          assert.equal(exit_code, 0);
        }
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, 'ok');
      assert.equal(Array.isArray(result.readback_files), true);
      assert.equal(result.readback_files.length, 1);
      assert.match(String(result.readback_files[0].content || ''), /"value": 42/);
      assert.equal(Number(result.process_id) > 0, true);
      assert.equal(lifecycle.started, 1);
      assert.equal(lifecycle.completed, 1);
      assert.equal(lifecycle.heartbeats >= 1, true);
    });

    test('managed python sandbox runtime supervises runs with sub-agents and sends failures for debugging', async () => {
      const runtime = agentPython.createManagedPythonSandboxRuntime();

      const success = await runtime.execute({
        code: 'print(42)',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        name: 'python-success'
      });
      assert.equal(success.ok, true);
      assert.equal(success.sandbox.ok, true);
      assert.equal(typeof success.sub_agent?.id, 'string');
      assert.equal(success.sub_agent?.task?.state, 'completed');
      assert.equal(success.sub_agent?.liveness?.state, 'idle');
      assert.equal(Number(success.sandbox.process_id) > 0, true);

      const failure = await runtime.execute({
        code: 'import module_that_does_not_exist_anywhere',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        name: 'python-failure'
      });
      assert.equal(failure.ok, false);
      assert.equal(failure.sandbox.ok, false);
      assert.equal(failure.sub_agent?.task?.state, 'failed');
      assert.equal(failure.sub_agent?.liveness?.state, 'idle');
      assert.match(String(failure.debug?.assistant_message || ''), /Suggested next step/i);
      assert.match(String(failure.debug?.assistant_message || ''), /standard library|vendor/i);
    });
  }
};
