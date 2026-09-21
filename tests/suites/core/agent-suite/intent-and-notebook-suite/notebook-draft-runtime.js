module.exports = function registerAgentIntentAndNotebookSuiteNotebookDraftRuntime(context = {}) {
  const scope = context.scope || {};
  const { assert, test, agentNotebookDraft } = scope;
    test('notebook draft runtime accepts explicit project names without a hydrated project record', async () => {
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'protocol-only::prot-starter::Small-Scale Overnight Starter Culture',
                title: 'Starter Culture Draft',
                purpose: 'Plan starter culture setup.',
                rationale: 'The caller named the starter culture protocol.',
                planned_materials: ['Starter media'],
                checkpoints: ['Confirm antibiotic.']
              }
            };
          }
          if (options.stage === 'notebook_fill') {
            return {
              ok: true,
              payload: {
                filled_values: [],
                missing_placeholders: [],
                follow_up_questions: [],
                result_summary: 'Starter culture draft prepared.'
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
        message: 'Plan the next notebook draft using starter culture.',
        conversation: [],
        snapshot: {
          projects: [],
          protocols: [
            {
              id: 'prot-starter',
              name: 'Small-Scale Overnight Starter Culture',
              purpose: 'Prepare an overnight starter culture.',
              steps: [
                { id: 'step-1', text: 'Inoculate starter media.', placeholders: [] }
              ]
            }
          ],
          workflows: []
        },
        parserPayload: {
          primary_intent: 'notebook_draft',
          entities: {
            project_name: 'PD-1 Nanobody Binder Discovery'
          },
          protocol_candidates: ['Small-Scale Overnight Starter Culture']
        },
        project: {
          name: 'PD-1 Nanobody Binder Discovery'
        },
        protocolCandidates: ['Small-Scale Overnight Starter Culture']
      });

      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.project_name, 'PD-1 Nanobody Binder Discovery');
      assert.equal(result.selected_protocol.name, 'Small-Scale Overnight Starter Culture');
      assert.equal(result.notebook.entry_template.projectName, 'PD-1 Nanobody Binder Discovery');
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
    test('notebook draft runtime can use the agent sub-app API layer for protocol ranking and notebook generation', async () => {
      const calls = [];
      const runtime = agentNotebookDraft.createNotebookDraftRuntime({
        agentAppApi: {
          protocol: {
            listAgentProtocols() {
              calls.push('protocol.listAgentProtocols');
              return [
                {
                  id: 'prot-1',
                  name: 'Viability Assay',
                  project_id: 'proj-1',
                  project_name: 'Atlas',
                  steps: [
                    {
                      id: 'step-1',
                      text: 'Measure viability.',
                      placeholders: []
                    }
                  ]
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
            rankAgentProtocols({ protocols = [] } = {}) {
              calls.push('protocol.rankAgentProtocols');
              return Array.isArray(protocols)
                ? protocols.map((protocol) => ({
                  id: protocol.id,
                  name: protocol.name,
                  score: 120
                }))
                : [];
            }
          },
          notebook: {
            listAgentEntries() {
              calls.push('notebook.listAgentEntries');
              return [];
            },
            async generateFromProtocol() {
              calls.push('notebook.generateFromProtocol');
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
          }
        },
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'notebook_draft_selection') {
            return {
              ok: true,
              payload: {
                selected_candidate_id: 'protocol-only::prot-1::Viability Assay',
                title: 'API Draft',
                purpose: 'Exercise the agent sub-app API path.',
                rationale: 'Use the new API layer instead of directly coupling to helper runtimes.',
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

      assert.equal(calls.filter((item) => item === 'protocol.listAgentProtocols').length >= 2, true);
      assert.equal(calls.includes('protocol.rankAgentProtocols'), true);
      assert.equal(calls.includes('notebook.listAgentEntries'), true);
      assert.equal(calls.includes('notebook.generateFromProtocol'), true);
      assert.equal(result.status, 'proposal_ready');
      assert.equal(result.selected_protocol.name, 'Viability Assay');
      assert.equal(result.proposal.title, 'API Draft');
      assert.equal(result.notebook.save.status, 'awaiting_user_confirmation');
    });
};
