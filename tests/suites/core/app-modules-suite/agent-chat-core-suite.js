module.exports = function registerAppAgentChatCoreSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat maps assay experiment data with numeric summaries and preview caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Done', updatedAt: '2026-01-01T00:00:00.000Z' }
    ],
    assays: [
      {
        id: 'a1',
        assayNumber: 'ASSAY-1',
        name: 'Viability Plate',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        plateType: '96',
        plateLabel: '96-well plate',
        plateRows: 8,
        plateColumns: 12,
        wellCount: 96,
        sampleAxis: 'row',
        concentrationAxis: 'column',
        sampleAxisValues: Array.from({ length: 14 }, (_value, index) => `sample-${index + 1}`),
        concentrationAxisValues: Array.from({ length: 14 }, (_value, index) => `${index + 1}`),
        wellLayout: Array.from({ length: 14 }, (_value, index) => ({
          well: `A${index + 1}`,
          sampleId: index % 2 === 0 ? 'sample-a' : 'sample-b',
          concentration: `${index + 1}`
        })),
        resultValues: {
          A1: '1',
          A2: '2.5',
          A3: 'not_numeric',
          A4: 4,
          A5: '',
          A6: '6',
          A7: '7',
          A8: '8',
          A9: '9',
          A10: '10',
          A11: '11',
          A12: '12',
          A13: '13'
        },
        notes: 'plate notes',
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'a2',
        name: 'Other Project Assay',
        projectId: 'p2',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    gelAnalyses: []
  }, 'p1');

  assert.equal(mapped.schema_name, 'enana_experiment_json');
  assert.equal(mapped.schema_version, '1.0');
  assert.equal(mapped.notebook_runs.length, 1);
  assert.equal(mapped.assay_runs.length, 1);
  assert.equal(mapped.gel_runs.length, 0);

  const assayRun = mapped.assay_runs[0];
  assert.equal(assayRun.project_id, 'p1');
  assert.equal(assayRun.layout_summary.mapped_well_count, 14);
  assert.equal(assayRun.layout_summary.unique_sample_count, 2);
  assert.equal(assayRun.layout_summary.preview.length, 12);
  assert.equal(assayRun.axis.sample_values.length, 12);
  assert.equal(assayRun.axis.concentration_values.length, 12);
  assert.equal(assayRun.result_summary.result_well_count, 13);
  assert.equal(assayRun.result_summary.numeric_count, 11);
  assert.equal(assayRun.result_summary.min, 1);
  assert.equal(assayRun.result_summary.max, 13);
  assertClose(assayRun.result_summary.mean, 7.590909090909091, 1e-12);
  assert.equal(assayRun.result_summary.preview.length, 12);
});

test('agent-chat maps gel experiment data with confidence, calibration, and warning caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [],
    assays: [],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel Run 1',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        analysisType: 'western',
        imageName: 'gel-1.tiff',
        updatedAt: '2026-02-02T00:00:00.000Z',
        report: {
          confidence: { score: 0.91, label: 'high' },
          calibration: { ok: true, r2: 0.88, ladderLane: 2 },
          lanes: [{ bands: [{}, {}] }, { bands: [{}] }],
          bandGroups: [{ id: 'bg1' }, { id: 'bg2' }],
          warnings: Array.from({ length: 12 }, (_value, index) => `warning-${index + 1}`),
          preprocessing: {
            manualOverridesSummary: {
              laneSegmentationLeft: 10,
              laneSegmentationRight: 210,
              laneSegmentationDividers: 7,
              laneSegmentationBandTop: 20,
              laneSegmentationBandBottom: 44,
              addedBands: 2,
              ladderLaneOverride: 2,
              ladderBands: 3,
              ladderBandsDone: true
            }
          }
        }
      },
      {
        id: 'g2',
        name: 'Gel Run Other Project',
        projectId: 'p2',
        updatedAt: '2026-02-03T00:00:00.000Z'
      }
    ]
  }, 'p1');

  assert.equal(mapped.gel_runs.length, 1);
  const gelRun = mapped.gel_runs[0];
  assert.equal(gelRun.project_id, 'p1');
  assert.equal(gelRun.analysis_type, 'western');
  assert.equal(gelRun.lane_count, 2);
  assert.equal(gelRun.band_count, 3);
  assert.equal(gelRun.band_group_count, 2);
  assert.equal(gelRun.confidence.label, 'high');
  assert.equal(gelRun.confidence.score, 0.91);
  assert.equal(gelRun.calibration.ok, true);
  assert.equal(gelRun.calibration.r2, 0.88);
  assert.equal(gelRun.calibration.ladder_lane, 2);
  assert.equal(gelRun.warnings.length, 10);
  assert.equal(gelRun.manual_override_summary.lane_segmentation_dividers, 7);
  assert.equal(gelRun.manual_override_summary.ladder_bands_done, true);
});

test('agent-chat renders assistant markdown with emphasis, tables, and escaped HTML', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: [
          '## Summary',
          '',
          'Use **bold** and *italic* safely.',
          '',
          '| Sample | Value |',
          '| --- | ---: |',
          '| A1 | 42 |',
          '',
          '<script>alert("xss")</script>'
        ].join('\n'),
        createdAt: '2026-03-22T17:00:05.000Z'
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /<h2>Summary<\/h2>/);
  assert.match(history.innerHTML, /<strong>bold<\/strong>/);
  assert.match(history.innerHTML, /<em>italic<\/em>/);
  assert.match(history.innerHTML, /<table class="agent-chat-table">/);
  assert.match(history.innerHTML, /data-align="right">42<\/td>/);
  assert.match(history.innerHTML, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(history.innerHTML, /<script>/);
});

test('agent-chat renders completed science thinking trace details in assistant metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-thinking-1',
        role: 'assistant',
        text: 'MAPK resistance commonly involves pathway reactivation.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'general_science_question',
            needs_clarification: false,
            reasoning_summary: 'This is a general science question.'
          },
          general_science_question: {
            status: 'completed',
            confidence: 0.77,
            confidence_label: 'medium',
            rounds_executed: 1,
            citations: [],
            follow_up_questions: [],
            thinking_trace: {
              intent_parse_question: 'This is a general science question.',
              question_clarifier: 'I am clarifying which resistance mechanism the user wants explained.',
              criteria_generate: 'I am defining what evidence would be enough to answer safely.',
              tool_rounds: [
                {
                  round: 1,
                  tool_selection: 'I am choosing the most targeted literature step first.',
                  tool_call: 'I want to use literature-search to investigate "MAPK inhibitor resistance".',
                  tool_results: 'Based on the tool result, it seems pathway reactivation is a common explanation.'
                }
              ],
              pre_synthesize_answer: 'Based on the evidence so far, pathway reactivation is the leading answer.',
              judge: 'I am checking whether the current evidence is sufficient.',
              final_synthesize: 'I am synthesizing the final grounded answer from the evidence collected so far.',
              final_synthesized_question: 'What causes MAPK inhibitor resistance?'
            }
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /Thinking Trace/);
  assert.match(history.innerHTML, /Intent parse: This is a general science question/);
  assert.match(history.innerHTML, /Round 1 call: I want to use literature-search to investigate/);
  assert.match(history.innerHTML, /Final synthesis: I am synthesizing the final grounded answer/);
});

test('agent-chat renders python sandbox text and image outputs inline from result analysis metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-python-1',
        role: 'assistant',
        text: 'I plotted the assay trend and summarized the result.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'result_analysis',
            needs_clarification: false,
            reasoning_summary: 'This request needed a computation step.'
          },
          result_analysis: {
            status: 'completed',
            confidence: 0.88,
            confidence_label: 'high',
            rounds_executed: 1,
            citations: [],
            follow_up_questions: [],
            tool_trace: [
              {
                round: 1,
                tool_name: 'python-sandbox',
                status: 'ok',
                run_id: 'py-123',
                render_outputs: [
                  {
                    type: 'text',
                    title: 'Summary',
                    format: 'text/plain',
                    content: 'Best-fit trend increased 2.3x over baseline.'
                  },
                  {
                    type: 'image',
                    title: 'Trend Plot',
                    mime_type: 'image/png',
                    data_base64: Buffer.from('fake-image').toString('base64')
                  }
                ]
              }
            ]
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /Python Sandbox Output/);
  assert.match(history.innerHTML, /Best-fit trend increased 2\.3x over baseline\./);
  assert.match(history.innerHTML, /Trend Plot/);
  assert.match(history.innerHTML, /data:image\/png;base64,ZmFrZS1pbWFnZQ==/);
});

test('agent-chat renders purchase recommendation tiles with unified image stage and ordered product metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-purchase-1',
        role: 'assistant',
        text: 'Found 1 purchase recommendation for your request.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'purchase_recommendation',
            needs_clarification: false,
            reasoning_summary: 'Find a purchasable product with explicit lab constraints.'
          },
          purchase_recommendation: {
            status: 'matched',
            query: 'cheap endotoxin-free metal-free pipette tips',
            source: 'web',
            filters: {
              required_terms: ['endotoxin-free', 'metal-free'],
              excluded_terms: ['latex'],
              budget_preference: 'cheap'
            },
            items: [
              {
                id: 'item-1',
                title: 'Endotoxin-Free Metal-Free Pipette Tips',
                vendor: 'Lab Vendor',
                price_text: '$14.99',
                price_value: 14.99,
                currency: 'USD',
                image_url: 'https://vendor.example/item-1.png',
                product_url: 'https://vendor.example/item-1'
              }
            ],
            follow_up_questions: []
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /agent-purchase-grid/);
  assert.match(history.innerHTML, /agent-purchase-image-wrap/);
  assert.match(history.innerHTML, /agent-purchase-image/);
  assert.match(history.innerHTML, /data-agent-open-external-url="https:\/\/vendor\.example\/item-1"/);
  assert.match(history.innerHTML, /agent-purchase-title">Endotoxin-Free Metal-Free Pipette Tips/);
  assert.match(history.innerHTML, /agent-purchase-price">\$14\.99/);
  assert.match(history.innerHTML, /agent-purchase-vendor">Lab Vendor/);
  assert.doesNotMatch(history.innerHTML, /Purchase Recommendation/);
  assert.doesNotMatch(history.innerHTML, /Purchase Filters/);
  const titleIndex = history.innerHTML.indexOf('agent-purchase-title');
  const priceIndex = history.innerHTML.indexOf('agent-purchase-price');
  const vendorIndex = history.innerHTML.indexOf('agent-purchase-vendor');
  assert.equal(titleIndex >= 0, true);
  assert.equal(titleIndex < priceIndex, true);
  assert.equal(priceIndex < vendorIndex, true);
});

test('agent-chat sends settings API key to main process and stores assistant response', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
  const contextSummary = document.getElementById('agent-context-summary');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const clearBtn = document.getElementById('agent-clear-btn');
  const status = document.getElementById('agent-status');

  let persistCalls = 0;
  let notebookChangedCalls = 0;
  let payloadSeen = null;
  const autoSaveCalls = [];
  const state = {
    projects: [
      { id: 'p1', name: 'Cancer Study' },
      { id: 'p2', name: 'Protein Screen' }
    ],
    protocols: [{
      id: 'pr1',
      name: 'Cell Prep',
      steps: [
        { id: 's1', text: 'Harvest [cell line] cells', placeholders: [{ id: 'p1', name: 'cell_line' }] },
        'Legacy mix step'
      ]
    }],
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Done' },
      { id: 'n2', projectId: 'p2', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Deferred' }
    ],
    assays: [
      {
        id: 'a1',
        assayNumber: 'ASSAY-1',
        name: 'Viability Plate',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        plateType: '96',
        plateLabel: '96-well plate',
        plateRows: 8,
        plateColumns: 12,
        wellCount: 96,
        sampleAxis: 'row',
        concentrationAxis: 'column',
        sampleAxisValues: ['sample-a'],
        concentrationAxisValues: ['1'],
        wellLayout: [{ well: 'A1', sampleId: 'sample-a', concentration: '1' }],
        resultValues: { A1: '100' },
        notes: 'note',
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'a2',
        name: 'Other Project Assay',
        projectId: 'p2',
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel 1',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        analysisType: 'western',
        imageName: 'gel-1.tiff',
        updatedAt: '2026-02-01T00:00:00.000Z',
        report: {
          confidence: { score: 0.91, label: 'high' },
          calibration: { ok: true, r2: 0.88, ladderLane: 2 },
          lanes: [{ bands: [{}, {}] }],
          bandGroups: [{ id: 'bg1' }],
          warnings: ['warning-1']
        }
      },
      {
        id: 'g2',
        name: 'Other Project Gel',
        projectId: 'p2',
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    workflows: [
      {
        id: 'w1',
        name: 'Cancer Workflow',
        description: 'Recovery workflow after transfection.',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [
          { id: 'b1', protocolId: 'pr1' },
          { id: 'b2', type: 'text', text: 'Verify viability next day' }
        ],
        links: [{ fromBlockId: 'b1', toBlockId: 'b2' }],
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'w2',
        name: 'Other Workflow',
        description: 'Other project flow.',
        projectId: 'p2',
        notebookEntryIds: ['n2'],
        blocks: [{ id: 'b3', protocolId: 'pr1' }],
        links: [],
        updatedAt: '2026-02-02T00:00:00.000Z'
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Cancer Study',
        summary: 'Paper summary text.',
        summaryStructured: {
          important_figures_or_tables: [
            { item: 'Figure 2', summary: 'Expression rescue trend.' }
          ]
        },
        methodsExtract: [
          {
            title: 'Method A',
            steps: [{ action: 'Prepare cells' }]
          }
        ],
        keyReagents: [
          { name: 'Reagent Z', type: 'compound', identifier: 'RZ-1', notes: 'demo' }
        ],
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        deepReadReady: true,
        availabilityStatus: 'deep_ready',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: '2026-02-01T00:00:00.000Z',
        ingestionErrors: [],
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async (data, filePath) => {
        autoSaveCalls.push({ data, filePath });
        return {
          ok: true,
          filePath: '/tmp/enana-data.ena.json',
          sidecarPaths: {
            protocolsPath: '/tmp/enana-data.protocols.json',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/enana-data.index.sqlite'
          },
          bundlePaths: {
            dataFilePath: '/tmp/enana-data.ena.json',
            protocolsPath: '/tmp/enana-data.protocols.json',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/enana-data.index.sqlite'
          }
        };
      },
      agentChat: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          parser: {
            primary_intent: 'protocol_to_notebook',
            needs_clarification: false,
            clarification_reason: null,
            entities: {
              activity_type: 'cell prep',
              project_name: 'Cancer Study',
              protocol_name: 'Cell Prep',
              protein_name: null,
              compound_name: null,
              inventory_item: null,
              cell_line: 'HEK293',
              paper_title: null,
              workflow_step: null,
              requested_output: 'next steps'
            },
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: ['Cell Prep'],
            reasoning_summary: 'Use protocol Cell Prep and verify culture viability.'
          },
          protocol_to_notebook: {
            status: 'completed',
            candidate_matches: [
              { id: 'pr1', name: 'Cell Prep', score: 120 }
            ],
            selected_protocol: {
              id: 'pr1',
              name: 'Cell Prep',
              selection_method: 'deterministic',
              rationale: 'Exact name match.'
            },
            missing_placeholders: [],
            follow_up_questions: [],
            project_name: 'Cancer Study',
            notebook: {
              protocol: { id: 'pr1', name: 'Cell Prep' },
              project: { id: 'p1', name: 'Cancer Study', resolution_source: 'payload_project_id' },
              notebook_type: 'biology',
              rendered_steps: ['Harvest HEK293 cells'],
              placeholder_values: [
                {
                  step_id: 's1',
                  placeholder_id: 'p1',
                  placeholder_key: 's1:p1',
                  display: 'cell_line',
                  value: 'HEK293',
                  source: 'resolved',
                  source_type: 'agent_protocol_v2'
                }
              ],
              unresolved_placeholders: [],
              save: {
                mode: 'auto_save_draft',
                applied: false,
                status: 'ready_for_save',
                reason: 'Draft is ready for notebook auto-save.'
              },
              entry_template: {
                notebookType: 'biology',
                projectId: 'p1',
                projectName: 'Cancer Study',
                protocolId: 'pr1',
                protocolName: 'Cell Prep',
                values: { 's1:p1': 'HEK293' },
                result: 'Notebook draft completed for Cell Prep.',
                updatedAt: '2026-03-11T12:00:00.000Z',
                resultFiles: [],
                resultFileRecords: [],
                agentDraftStatus: 'draft_ready',
                agentDraftMeta: { source: 'agent_protocol_v2', unresolvedCount: 0 }
              }
            }
          },
          developer_trace: [
            {
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parsed.',
              timestamp: '2026-03-11T12:00:00.000Z'
            }
          ]
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
  });

  agent.render();
  assert.match(contextSummary.value, /projects/);

  projectSelect.value = 'p1';
  trigger(projectSelect, 'change');
  assert.equal(state.agentChat.projectId, 'p1');
  assert.match(contextSummary.value, /1 assays/);
  assert.match(contextSummary.value, /1 gel analyses/);

  messageInput.value = 'Give me next steps for p1.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.llm.model, 'gpt-5');
  assert.equal(payloadSeen.llm.apiEndpoint, 'https://api.openai.com/v1/responses');
  assert.equal(payloadSeen.llm.apiKey, 'sk-local-key');
  assert.equal(payloadSeen.agent.developerMode, false);
  assert.equal(payloadSeen.agent.deepResearchEnabled, false);
  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.stateSnapshot.snapshot_mode, 'thin');
  assert.equal(payloadSeen.stateSnapshot.data_file_path, '/tmp/enana-data.ena.json');
  assert.equal(payloadSeen.stateSnapshot.protocols.length, 1);
  assert.equal(payloadSeen.stateSnapshot.protocols[0].name, 'Cell Prep');
  assert.equal(payloadSeen.stateSnapshot.protocols[0].steps.length, 2);
  assert.equal(payloadSeen.stateSnapshot.notebookEntries.length, 0);
  assert.equal(payloadSeen.stateSnapshot.context_counts.protocols, 1);
  assert.equal(payloadSeen.stateSnapshot.context_counts.notebookEntries, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows.length, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].projectId, 'p1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].notebookEntryIds[0], 'n1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].blocks.length, 2);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].blocks[0].protocolId, 'pr1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].links.length, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].links[0].toBlockId, 'b2');
  assert.equal(payloadSeen.stateSnapshot.papers.length, 1);
  assert.equal(payloadSeen.stateSnapshot.papers[0].availability_status, 'deep_ready');
  assert.equal(payloadSeen.stateSnapshot.papers[0].deep_read_ready, true);
  assert.equal(Array.isArray(payloadSeen.stateSnapshot.papers[0].key_figures), true);
  assert.equal(payloadSeen.stateSnapshot.papers[0].key_figures.length > 0, true);
  assert.equal(payloadSeen.stateSnapshot.assays.length, 1);
  assert.equal(payloadSeen.stateSnapshot.assays[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses.length, 1);
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.experimentData.schema_name, 'enana_experiment_json');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].notebook_state, 'executed');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].executed_at, '');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].agent_draft_status, '');
  assert.equal(payloadSeen.stateSnapshot.experimentData.assay_runs.length, 1);
  assert.equal(payloadSeen.stateSnapshot.experimentData.gel_runs.length, 1);
  assert.equal(autoSaveCalls.length, 1);
  assert.equal(autoSaveCalls[0].filePath, '');
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.equal(state.agentChat.messages[1].meta.parser.primary_intent, 'protocol_to_notebook');
  assert.equal(state.agentChat.messages[1].meta.parser.needs_clarification, false);
  assert.equal(state.agentChat.messages[1].meta.parser.protocol_candidates[0], 'Cell Prep');
  assert.equal(state.agentChat.messages[1].meta.protocol_to_notebook.status, 'completed');
  assert.match(state.agentChat.messages[1].text, /Notebook draft completed for Cell Prep\./);
  assert.equal(state.notebookEntries.length, 3);
  assert.equal(notebookChangedCalls, 1);
  assert.match(history.innerHTML, /Assistant/);
  assert.match(history.innerHTML, /Notebook draft completed for Cell Prep\./);
  assert.doesNotMatch(history.innerHTML, /Intent Parser/);
  assert.doesNotMatch(history.innerHTML, /Protocol Workflow/);
  assert.doesNotMatch(history.innerHTML, /Entities/);
  assert.doesNotMatch(history.innerHTML, /Reasoning Summary/);
  assert.doesNotMatch(history.innerHTML, /LLM Activity/);
  assert.equal(/Developer Trace/.test(history.innerHTML), false);

  state.settings.agent.developerMode = true;
  agent.render();
  assert.equal(/Developer Trace/.test(history.innerHTML), false);
  assert.equal(sendBtn.disabled, false);
  assert.equal(clearBtn.disabled, false);
  assert.equal(projectSelect.disabled, false);
  assert.equal(messageInput.disabled, false);
  assert.equal(status.textContent, 'Ready.');
  assert.ok(persistCalls >= 3);

  trigger(clearBtn, 'click');
  assert.equal(state.agentChat.messages.length, 0);
  assert.equal(status.textContent, 'New chat ready.');
});

test('agent-chat shows live progress ephemerally in the chat history and locks session switching until success', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-session-status',
    'agent-session-list',
    'agent-new-chat-btn',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const sessionList = document.getElementById('agent-session-list');
  const newChatBtn = document.getElementById('agent-new-chat-btn');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  let progressHandler = null;
  let resolveAgentRequest = null;
  const sessionLoads = [];
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      storagePath: '/tmp/enana-storage',
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      currentSessionId: 'chat-2',
      sessions: [],
      messages: []
    }
  };

  const window = {
    enanaApi: {
      onAgentProgress: (handler) => {
        progressHandler = handler;
        return () => {};
      },
      agentChatLogListSessions: async () => ({
        ok: true,
        items: [
          {
            id: 'chat-2',
            title: 'Current chat',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-23T09:00:00.000Z',
            created_at: '2026-03-23T09:00:00.000Z',
            message_count: 0,
            last_message_preview: ''
          },
          {
            id: 'chat-1',
            title: 'Other chat',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-23T08:00:00.000Z',
            created_at: '2026-03-23T08:00:00.000Z',
            message_count: 0,
            last_message_preview: ''
          }
        ]
      }),
      agentChatLogGetSession: async ({ sessionId }) => {
        sessionLoads.push(sessionId);
        return {
          ok: true,
          session: {
            id: sessionId,
            project_id: '',
            project_name: '',
            title: sessionId === 'chat-2' ? 'Current chat' : 'Other chat'
          },
          messages: []
        };
      },
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async (payload) => {
        payloadSeen = payload;
        return await new Promise((resolve) => {
          resolveAgentRequest = resolve;
        });
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-2');
  assert.equal(sessionLoads.includes('chat-2'), true);

  messageInput.value = 'Why did the yield drop?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(typeof payloadSeen?.clientRequestId, 'string');
  assert.equal(state.agentChat.messages.length, 1);
  assert.match(history.innerHTML, /Working on this/);
  assert.doesNotMatch(history.innerHTML, /Request received/);
  assert.equal(sendBtn.disabled, true);
  assert.equal(newChatBtn.disabled, true);
  assert.match(sessionList.innerHTML, /disabled/);

  const sessionButtons = sessionList.querySelectorAll('[data-session-id]');
  const otherChatButton = sessionButtons.find((item) => item.dataset.sessionId === 'chat-1');
  trigger(sessionList, 'click', { target: otherChatButton });
  await flushAsync();
  assert.equal(state.agentChat.currentSessionId, 'chat-2');

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'general_science_question',
    stage: 'parser_completed',
    status: 'ok',
    message: 'Intent parsed.',
    meta: {}
  });
  assert.match(history.innerHTML, /Intent parsed/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'general_science_question',
    stage: 'science_clarification_completed',
    status: 'ok',
    message: 'Science input was clarified and is ready for reasoning.',
    meta: {
      thinking_trace: 'I am clarifying the exact question before I search for evidence.'
    }
  });
  assert.match(history.innerHTML, /I am clarifying the exact question before I search for evidence/);
  assert.match(history.innerHTML, /Thinking Trace/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'general_science_question',
    stage: 'tool_call_started',
    status: 'started',
    tool_name: 'literature-search',
    message: 'Started tool call for literature-search.',
    meta: {
      round: 1,
      thinking_trace: 'I want to use literature-search to investigate "yield drop causes".'
    }
  });
  assert.match(history.innerHTML, /I want to use literature-search to investigate &quot;yield drop causes&quot;/);
  assert.doesNotMatch(history.innerHTML, /Searching literature sources/);

  resolveAgentRequest({
    ok: true,
    request_id: 'req-live-1',
    client_request_id: payloadSeen.clientRequestId,
    chat_session: {
      id: 'chat-2',
      title: 'Current chat'
    },
    parser: {
      primary_intent: 'general_science_question',
      needs_clarification: false,
      clarification_reason: null,
      entities: {},
      inventory_search: {
        normalized_query: null,
        candidate_terms: [],
        aliases: [],
        search_mode: null
      },
      protocol_candidates: [],
      reasoning_summary: 'Working through the literature.'
    },
    general_science_question: {
      status: 'completed',
      answer: 'Literature-backed answer.',
      execution_mode: 'science_loop',
      citations: [],
      decision_record: {
        assumptions: [],
        open_questions: [],
        verification_notes: []
      },
      rounds_executed: 1,
      follow_up_questions: []
    },
    developer_trace: []
  });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.match(history.innerHTML, /Literature-backed answer/);
  assert.equal(/Working on this/.test(history.innerHTML), false);
  assert.equal(sendBtn.disabled, false);
  assert.equal(newChatBtn.disabled, false);
  assert.equal(status.textContent, 'Complete.');
});

test('agent-chat replaces the live placeholder with a persisted error response on failure', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  let progressHandler = null;
  let rejectAgentRequest = null;
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      messages: []
    }
  };

  const window = {
    enanaApi: {
      onAgentProgress: (handler) => {
        progressHandler = handler;
        return () => {};
      },
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async (payload) => {
        payloadSeen = payload;
        return await new Promise((_resolve, reject) => {
          rejectAgentRequest = reject;
        });
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Analyze the failed run.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 1);
  assert.match(history.innerHTML, /Working on this/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-error',
    chat_session_id: '',
    routing_intent: 'general_science_question',
    stage: 'parser_completed',
    status: 'ok',
    message: 'Intent parsed.',
    meta: {}
  });
  assert.match(history.innerHTML, /Intent parsed/);

  rejectAgentRequest(new Error('Network timeout'));
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.match(history.innerHTML, /Agent failed: Network timeout/);
  assert.equal(/Working on this/.test(history.innerHTML), false);
  assert.equal(sendBtn.disabled, false);
  assert.equal(status.textContent, 'Error.');
});

test('agent-chat keeps notebook-draft proposals confirm-first and creates one planned page on click', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-deep-research-toggle-btn',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas', description: 'Planning project' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Viability Assay',
        projectId: 'p1',
        projectName: 'Atlas',
        steps: [
          {
            id: 's1',
            text: 'Measure viability for {{ph:sample_name}}.',
            placeholders: [{ id: 'sample_name', name: 'sample name' }]
          }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [
      {
        id: 'w1',
        name: 'Atlas Workflow',
        description: 'Next step planning',
        projectId: 'p1',
        notebookEntryIds: [],
        blocks: [{ id: 'b1', protocolId: 'pr1' }],
        links: [],
        updatedAt: '2026-03-20T00:00:00.000Z'
      }
    ],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'notebook_draft',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: ['Viability Assay'],
          reasoning_summary: 'Plan the next notebook page.'
        },
        notebook_draft: {
          status: 'proposal_ready',
          project_name: 'Atlas',
          selected_protocol: {
            id: 'pr1',
            name: 'Viability Assay',
            selection_method: 'workflow'
          },
          source_workflow: {
            id: 'w1',
            name: 'Atlas Workflow',
            block_id: 'b1',
            block_title: 'Viability Assay'
          },
          missing_placeholders: [
            {
              placeholder_key: 's1:sample_name',
              display: 'sample name',
              reason: 'Leave visible for the planned draft.'
            }
          ],
          follow_up_questions: ['Please provide sample name.'],
          proposal_summary: 'Viability Assay After Cell Prep',
          proposal: {
            proposal_id: 'proposal-1',
            title: 'Viability Assay After Cell Prep',
            purpose: 'Measure whether the prepared cells remain viable.',
            rationale: 'This is the next workflow step.',
            planned_materials: ['Prepared cells', 'Viability plate'],
            checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
            workflow: {
              id: 'w1',
              name: 'Atlas Workflow',
              block_id: 'b1',
              block_title: 'Viability Assay'
            }
          },
          notebook: {
            protocol: { id: 'pr1', name: 'Viability Assay' },
            project: { id: 'p1', name: 'Atlas', resolution_source: 'tool_project_id' },
            notebook_type: 'biology',
            rendered_steps: ['Measure viability for [sample name].'],
            unresolved_placeholders: [
              {
                step_id: 's1',
                placeholder_id: 'sample_name',
                placeholder_key: 's1:sample_name',
                display: 'sample name',
                reason: 'Leave visible for the planned draft.'
              }
            ],
            save: {
              mode: 'confirm_before_save',
              applied: false,
              status: 'awaiting_user_confirmation',
              reason: 'Planned notebook draft is ready to create after confirmation.'
            },
            proposal: {
              proposal_id: 'proposal-1',
              title: 'Viability Assay After Cell Prep',
              purpose: 'Measure whether the prepared cells remain viable.',
              rationale: 'This is the next workflow step.',
              planned_materials: ['Prepared cells', 'Viability plate'],
              checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
              workflow: {
                id: 'w1',
                name: 'Atlas Workflow',
                block_id: 'b1',
                block_title: 'Viability Assay'
              }
            },
            entry_template: {
              notebookType: 'biology',
              projectId: 'p1',
              projectName: 'Atlas',
              protocolId: 'pr1',
              protocolName: 'Viability Assay',
              values: {},
              result: 'Planned Experiment: Viability Assay After Cell Prep',
              updatedAt: '2026-03-21T12:00:00.000Z',
              notebookState: 'planned',
              executedAt: '',
              resultFiles: [],
              resultFileRecords: [],
              agentDraftStatus: 'needs_review',
              agentDraftMeta: {
                source: 'agent_notebook_draft_v1',
                proposalId: 'proposal-1',
                workflowId: 'w1'
              }
            }
          }
        },
        notebookDraft: {
          protocol: { id: 'pr1', name: 'Viability Assay' },
          project: { id: 'p1', name: 'Atlas', resolution_source: 'tool_project_id' },
          notebook_type: 'biology',
          rendered_steps: ['Measure viability for [sample name].'],
          unresolved_placeholders: [
            {
              step_id: 's1',
              placeholder_id: 'sample_name',
              placeholder_key: 's1:sample_name',
              display: 'sample name',
              reason: 'Leave visible for the planned draft.'
            }
          ],
          save: {
            mode: 'confirm_before_save',
            applied: false,
            status: 'awaiting_user_confirmation',
            reason: 'Planned notebook draft is ready to create after confirmation.'
          },
          proposal: {
            proposal_id: 'proposal-1',
            title: 'Viability Assay After Cell Prep',
            purpose: 'Measure whether the prepared cells remain viable.',
            rationale: 'This is the next workflow step.',
            planned_materials: ['Prepared cells', 'Viability plate'],
            checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
            workflow: {
              id: 'w1',
              name: 'Atlas Workflow',
              block_id: 'b1',
              block_title: 'Viability Assay'
            }
          },
          entry_template: {
            notebookType: 'biology',
            projectId: 'p1',
            projectName: 'Atlas',
            protocolId: 'pr1',
            protocolName: 'Viability Assay',
            values: {},
            result: 'Planned Experiment: Viability Assay After Cell Prep',
            updatedAt: '2026-03-21T12:00:00.000Z',
            notebookState: 'planned',
            executedAt: '',
            resultFiles: [],
            resultFileRecords: [],
            agentDraftStatus: 'needs_review',
            agentDraftMeta: {
              source: 'agent_notebook_draft_v1',
              proposalId: 'proposal-1',
              workflowId: 'w1'
            }
          }
        }
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  projectSelect.value = 'p1';
  trigger(projectSelect, 'change');
  messageInput.value = 'Draft tomorrow’s next experiment.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.parser.primary_intent, 'notebook_draft');
  assert.equal(state.agentChat.messages[1].meta.notebook_draft.status, 'proposal_ready');
  assert.equal(state.notebookEntries.length, 0);
  assert.match(history.innerHTML, /Create Planned Page/);
  assert.match(history.innerHTML, /Planned notebook draft ready: Viability Assay After Cell Prep/);

  const createButtons = history.querySelectorAll('[data-agent-create-planned-page]');
  assert.equal(createButtons.length, 1);
  trigger(history, 'click', { target: createButtons[0] });

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].notebookState, 'planned');
  assert.equal(state.notebookEntries[0].executedAt, '');
  assert.equal(state.notebookEntries[0].agentDraftMeta.proposalId, 'proposal-1');
  assert.match(history.innerHTML, /Planned Page Created/);
  assert.equal(status.textContent, 'Planned notebook page created.');

  trigger(history, 'click', { target: createButtons[0] });
  assert.equal(state.notebookEntries.length, 1);
});

test('agent-chat toggles deep research mode and sends it in the chat payload', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-deep-research-toggle-btn',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const messageInput = document.getElementById('agent-message-input');
  const toggleBtn = document.getElementById('agent-deep-research-toggle-btn');
  const sendBtn = document.getElementById('agent-send-btn');

  let payloadSeen = null;
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      deepResearchEnabled: false,
      messages: []
    }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          parser: {
            primary_intent: 'general_science_question',
            needs_clarification: false,
            clarification_reason: null,
            entities: {},
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: [],
            reasoning_summary: 'Use deep research.'
          },
          general_science_question: {
            status: 'completed',
            answer: 'Deep research answer.',
            execution_mode: 'deep_research',
            citations: [],
            decision_record: {
              assumptions: [],
              open_questions: [],
              verification_notes: []
            },
            rounds_executed: 1,
            follow_up_questions: []
          },
          developer_trace: []
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.equal(toggleBtn.textContent, 'Deep Research: Off');

  trigger(toggleBtn, 'click');
  assert.equal(state.agentChat.deepResearchEnabled, true);
  assert.equal(toggleBtn.textContent, 'Deep Research: On');

  messageInput.value = 'Why did the yield drop?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.agent.developerMode, false);
  assert.equal(payloadSeen.agent.deepResearchEnabled, true);
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.general_science_question.execution_mode, 'deep_research');
});
  }
};
