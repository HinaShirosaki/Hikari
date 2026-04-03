module.exports = function registerAgentIntentAndNotebookSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent parser normalizes canonical parser payload', () => {
      const raw = {
        primary_intent: 'inventory_lookup',
        reasoning_effort: 2,
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
      assert.equal(result.payload.reasoning_effort, 0);
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

    test('intent parser preserves science reasoning effort and defaults missing science effort to level 1', () => {
      const explicit = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        reasoning_effort: 2,
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
          requested_output: 'mechanistic explanation'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'Needs deeper multi-step science reasoning.'
      });
      assert.equal(explicit.ok, true);
      assert.equal(explicit.payload.reasoning_effort, 2);

      const defaulted = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'project_science_question',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: 'Atlas',
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
        reasoning_summary: 'Project science question.'
      });
      assert.equal(defaulted.ok, true);
      assert.equal(defaulted.payload.reasoning_effort, 1);
    });

    test('intent parser keeps direct_answer only for reasoning-effort 0 science intents', () => {
      const direct = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        reasoning_effort: 0,
        direct_answer: 'Imidazole competes with histidines for nickel binding sites on the resin.',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          output: 'mechanistic explanation'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'Direct science answer.'
      });
      assert.equal(direct.ok, true);
      assert.match(String(direct.payload.direct_answer || ''), /nickel binding sites/i);

      const routed = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'project_science_question',
        reasoning_effort: 1,
        direct_answer: 'This should be ignored because the request should enter the loop.',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          project: 'Atlas'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'Needs project evidence.'
      });
      assert.equal(routed.ok, true);
      assert.equal(routed.payload.direct_answer, null);
    });

    test('intent parser keeps protocol candidates for notebook_draft intent', () => {
      const raw = {
        primary_intent: 'notebook_draft',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: 'planning',
          project_name: 'Atlas',
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: 'next experiment',
          requested_output: 'planned notebook page'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: ['Viability Assay', 'cell viability assay'],
        reasoning_summary: 'Propose the next notebook page from the workflow.'
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'notebook_draft');
      assert.deepEqual(result.payload.protocol_candidates, ['Viability Assay', 'cell viability assay']);
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
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /"reasoning_effort": 0/);
      assert.equal(/entities\.project_name/.test(agentIntentParser.INTENT_PARSER_PROMPT), false);
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
      const catalogPath = path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'intent', 'agent-intent.json');
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
      assert.equal(result.notebook.entry_template.notebookState, 'executed');
      assert.equal(Boolean(result.notebook.entry_template.executedAt), true);
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
      assert.equal(result.notebook.entry_template.notebookState, 'executed');
      assert.equal(result.notebook.entry_template.agentDraftStatus, 'needs_review');
      assert.equal(result.missing_placeholders.length, 1);
      assert.equal(result.follow_up_questions[0], 'Please provide sample name.');
    });

    test('notebook draft runtime selects downstream workflow candidate and keeps unresolved placeholders visible', async () => {
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'wf-1::block-3::prot-2::Viability Assay',
                title: 'Viability Assay After Cell Prep',
                purpose: 'Measure viability after the completed cell prep run.',
                rationale: 'The workflow places the viability assay directly after cell prep.',
                planned_materials: ['Prepared cells', 'Assay plate'],
                checkpoints: ['Confirm cells are ready.', 'Record viability observations.']
              }
            };
          }
          if (options.stage === 'notebook_fill') {
            return {
              ok: true,
              payload: {
                filled_values: [],
                missing_placeholders: [
                  {
                    step_id: 'step-1',
                    placeholder_id: 'sample_name',
                    placeholder_key: 'step-1:sample_name',
                    display: 'sample name',
                    reason: 'Leave visible for planned draft.'
                  }
                ],
                follow_up_questions: ['Please provide sample name.'],
                result_summary: 'Notebook fill test completed.'
              }
            };
          }
          return {
            ok: false,
            error: `Unhandled stage ${String(options.stage || '')}`
          };
        }
      });
      const result = await runtime.generateNotebookDraft({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Draft tomorrow’s next experiment for Atlas.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Cell Prep',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                { id: 'step-0', text: 'Prepare cells.', placeholders: [] }
              ]
            },
            {
              id: 'prot-2',
              name: 'Viability Assay',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                {
                  id: 'step-1',
                  text: 'Measure viability for {{ph:sample_name}}.',
                  placeholders: [{ id: 'sample_name', name: 'sample name' }]
                }
              ]
            }
          ],
          workflows: [
            {
              id: 'wf-1',
              name: 'Atlas Workflow',
              projectId: 'proj-1',
              notebookEntryIds: ['note-1'],
              blocks: [
                { id: 'block-1', protocolId: 'prot-1' },
                { id: 'block-2', type: 'text', text: 'Then assess viability.' },
                { id: 'block-3', protocolId: 'prot-2' }
              ],
              links: [
                { id: 'link-1', fromBlockId: 'block-1', toBlockId: 'block-2' },
                { id: 'link-2', fromBlockId: 'block-2', toBlockId: 'block-3' }
              ]
            }
          ],
          experimentData: {
            notebook_runs: [
              {
                id: 'note-1',
                project_id: 'proj-1',
                protocol_id: 'prot-1',
                protocol_name: 'Cell Prep',
                workflow_id: 'wf-1',
                notebook_state: 'executed',
                executed_at: '2026-03-22T12:00:00.000Z',
                updated_at: '2026-03-22T12:00:00.000Z'
              }
            ]
          }
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          protocol_candidates: ['Viability Assay']
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'Viability Assay After Cell Prep');
      assert.equal(result.notebook.save.mode, 'confirm_before_save');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
      assert.equal(result.notebook.entry_template.notebookState, 'planned');
      assert.equal(result.notebook.entry_template.executedAt, '');
      assert.equal(result.notebook.entry_template.agentDraftMeta.source, 'agent_notebook_draft_v1');
      assert.equal(typeof result.notebook.entry_template.agentDraftMeta.proposalId, 'string');
      assert.equal(result.missing_placeholders.length, 1);
      assert.equal(result.notebook.unresolved_placeholders.length, 1);
    });

    test('notebook draft runtime can resolve helper runtimes from registry factories', async () => {
      const requestedFactories = [];
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        getAgentRuntimeFactory: (runtimeName) => {
          requestedFactories.push(runtimeName);
          if (runtimeName === 'protocol-matching') {
            return () => ({
              normalizeProtocolRecord(protocol = {}, index = 0) {
                return {
                  id: String(protocol.id || `protocol-${index + 1}`),
                  name: String(protocol.name || ''),
                  project_id: String(protocol.projectId || protocol.project_id || ''),
                  project_name: String(protocol.projectName || protocol.project_name || ''),
                  steps: Array.isArray(protocol.steps) ? protocol.steps : []
                };
              },
              rankProtocolMatches({ protocols = [] } = {}) {
                return Array.isArray(protocols)
                  ? protocols.map((protocol) => ({
                    id: protocol.id,
                    name: protocol.name
                  }))
                  : [];
              }
            });
          }
          if (runtimeName === 'notebook-generation') {
            return () => ({
              async generateNotebook() {
                return {
                  notebook: {
                    save: {
                      mode: 'confirm_before_save',
                      status: 'awaiting_user_confirmation'
                    },
                    entry_template: {
                      notebookState: 'planned',
                      executedAt: '',
                      agentDraftStatus: 'draft_ready',
                      agentDraftMeta: {}
                    },
                    unresolved_placeholders: []
                  },
                  missing_placeholders: [],
                  follow_up_questions: []
                };
              }
            });
          }
          return null;
        },
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'protocol-only::prot-1::Viability Assay',
                title: 'Registry Draft',
                purpose: 'Verify registry-selected notebook generation.',
                rationale: 'Exercise the runtime-factory registry path.',
                planned_materials: ['Assay plate'],
                checkpoints: ['Confirm project scope.']
              }
            };
          }
          return {
            ok: false,
            error: `Unhandled stage ${String(options.stage || '')}`
          };
        }
      });
      const result = await runtime.generateNotebookDraft({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Draft the next viability assay for Atlas.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Viability Assay',
              projectId: 'proj-1',
              projectName: 'Atlas',
              steps: [
                {
                  id: 'step-1',
                  text: 'Measure viability.',
                  placeholders: []
                }
              ]
            }
          ]
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          protocol_candidates: ['Viability Assay']
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.deepEqual(requestedFactories, ['protocol-matching', 'notebook-generation']);
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'Registry Draft');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
    });

  }
};
