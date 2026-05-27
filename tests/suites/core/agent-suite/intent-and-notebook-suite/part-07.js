module.exports = function registerAgentIntentAndNotebookSuitePart07(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('protocol notebook runtime can route protocol and notebook work through the agent sub-app API layer', async () => {
      const { createProtocolNotebookRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-protocol-notebook.js'
      ));
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const asArray = (value) => (Array.isArray(value) ? value : []);
      const uniqueStrings = (values, max = 50) => {
        const seen = new Set();
        const out = [];
        asArray(values).forEach((value) => {
          const normalized = cleanText(value, 220);
          if (!normalized) {
            return;
          }
          const key = normalized.toLowerCase();
          if (seen.has(key) || out.length >= max) {
            return;
          }
          seen.add(key);
          out.push(normalized);
        });
        return out;
      };
      const calls = [];
      const runtime = createProtocolNotebookRuntime({
        asArray,
        cleanText,
        uniqueStrings,
        pickTopMatches: (items, _selector, _query, count = 1) => asArray(items).slice(0, count),
        protocolNotebookPendingSessions: new Map(),
        agentAppApi: {
          protocol: {
            listAgentProtocols() {
              calls.push('protocol.listAgentProtocols');
              return [
                {
                  id: 'prot-1',
                  name: 'Cell Prep',
                  project_id: 'proj-1',
                  project_name: 'Atlas',
                  steps: [{ id: 'step-1', text: 'Prepare cells.' }]
                }
              ];
            },
            normalizeAgentProtocol(protocol = {}) {
              return {
                id: String(protocol.id || ''),
                name: String(protocol.name || ''),
                project_id: String(protocol.project_id || ''),
                project_name: String(protocol.project_name || ''),
                steps: Array.isArray(protocol.steps) ? protocol.steps : []
              };
            },
            async matchForNotebook({ protocols = [] } = {}) {
              calls.push('protocol.matchForNotebook');
              return {
                selected_protocol: Array.isArray(protocols) ? protocols[0] : null,
                selection_method: 'agent_app_api',
                rationale: 'Matched through the agent sub-app API.',
                ranked_matches: [{ id: 'prot-1', name: 'Cell Prep', score: 130 }]
              };
            }
          },
          notebook: {
            async generateFromProtocol({ selectedProtocol, project } = {}) {
              calls.push('notebook.generateFromProtocol');
              return {
                status: 'completed',
                notebook: {
                  protocol: {
                    id: selectedProtocol?.id || '',
                    name: selectedProtocol?.name || ''
                  },
                  project: {
                    id: project?.id || '',
                    name: project?.name || ''
                  },
                  rendered_steps: ['Prepare cells.'],
                  save: {
                    status: 'ready_for_save'
                  }
                },
                missing_placeholders: [],
                follow_up_questions: []
              };
            }
          }
        }
      });

      const result = await runtime.runFlow({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'Turn today\'s Atlas cell prep into a notebook page.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ]
        },
        parserPayload: {
          protocol_candidates: ['Cell Prep'],
          entities: {
            project_name: 'Atlas'
          }
        },
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      assert.deepEqual(calls, [
        'protocol.listAgentProtocols',
        'protocol.matchForNotebook',
        'notebook.generateFromProtocol'
      ]);
      assert.equal(result.status, 'completed');
      assert.equal(result.selected_protocol.name, 'Cell Prep');
      assert.equal(result.notebook.save.status, 'ready_for_save');
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
    test('notebook draft selection prompt includes optional evidence context', () => {
      const runtime = agentNotebookDraft.createNotebookDraftRuntime();
      const prompt = runtime.buildNotebookDraftSelectionPrompt({
        message: 'Draft the next Atlas experiment based on recent papers.',
        conversation: [],
        parserPayload: {
          primary_intent: 'notebook_draft'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        },
        notebookRuns: [],
        candidates: [
          {
            id: 'candidate-1',
            protocol_name: 'Low Temperature Expression'
          }
        ],
        evidenceContext: [
          {
            tool_name: 'literature-search',
            status: 'completed',
            summary: 'Recent papers support low-temperature induction before purification.',
            item_count: 2
          }
        ]
      });
      assert.match(prompt, /Evidence context JSON/);
      assert.match(prompt, /Recent papers support low-temperature induction/);
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
  }
};