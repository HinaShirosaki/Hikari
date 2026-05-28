module.exports = function registerAppAgentChatCoreSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat sends settings API key to main process and stores assistant response', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
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
        knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md',
        knowledgeStatus: 'ready',
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
            protocolsPath: '/tmp/Protocol',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/Protocol/protocol.index.sqlite'
          },
          bundlePaths: {
            dataFilePath: '/tmp/enana-data.ena.json',
            protocolsPath: '/tmp/Protocol',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/Protocol/protocol.index.sqlite'
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

  projectSelect.value = 'p1';
  trigger(projectSelect, 'change');
  assert.equal(state.agentChat.projectId, 'p1');

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
  assert.equal(payloadSeen.stateSnapshot.papers[0].knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md');
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

test('paper-scoped agent chat snapshot includes the active transformed markdown prompt', () => {
  const snapshotModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'state-snapshot.js'
  ));
  const scopedStateModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'scoped-state.js'
  ));
  const rootState = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    workflows: [],
    assays: [],
    gelAnalyses: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: { storagePath: '/tmp/enana-storage' },
    papers: [{
      id: 'paper-1',
      title: 'Atlas Uploaded Paper',
      linkedType: 'project',
      linkedId: 'p1',
      linkedName: 'Cancer Study',
      summary: 'Paper summary text.',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md',
      knowledgeStatus: 'ready',
      deepReadReady: true,
      availabilityStatus: 'deep_ready'
    }]
  };
  const scopedState = scopedStateModule.createPaperScopedAgentChatState(rootState, {
    getPaperContext: () => ({
      paperId: 'paper-1',
      paperTitle: 'Atlas Uploaded Paper',
      projectId: 'p1',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md',
      knowledgeStatus: 'ready'
    })
  });

  assert.match(scopedState.agentChatContext.sessionPrompt, /transformed markdown paper\.md/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /Atlas Uploaded Paper/);

  const snapshot = snapshotModule.buildStateSnapshot(scopedState, 'p1');
  assert.equal(snapshot.activePaper.id, 'paper-1');
  assert.equal(snapshot.paper_agent.active_paper_id, 'paper-1');
  assert.equal(snapshot.paper_agent.transformed_markdown_relative_path, 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md');
  assert.equal(snapshot.paper_agent.has_transformed_markdown, true);
  assert.match(snapshot.paper_agent.session_prompt, /read the transformed markdown/i);
});

test('paper rail selected text is carried as hidden one-shot agent context', () => {
  const payloadModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'payload-builder.js'
  ));
  const state = {
    projects: [],
    settings: {
      llm: { provider: 'codex', model: 'gpt-5' },
      agent: { developerMode: false }
    },
    agentChat: { projectId: '', messages: [], deepResearchEnabled: false },
    agentChatContext: {
      sessionPrompt: 'You are reading the active paper markdown.',
      paperId: 'paper-1',
      paperTitle: 'Atlas Uploaded Paper',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md',
      knowledgeStatus: 'ready'
    }
  };
  const input = { value: 'What does this imply for follow-up experiments?' };
  const payloadBuilder = payloadModule.createAgentPayloadBuilder({
    state,
    input,
    getComposerAttachments: () => [],
    ensureAgentState: () => {}
  });

  const didPrime = payloadBuilder.primeHiddenContext({
    kind: 'paper-selection',
    label: 'Selected paper text',
    text: 'A hidden selected sentence from page 2.',
    paperId: 'paper-1',
    paperTitle: 'Atlas Uploaded Paper',
    pageNumber: 2
  });
  const draft = payloadBuilder.getDraftRequest();
  const agentFlags = payloadBuilder.buildAgentFlagsPayload({ hiddenContexts: draft.hiddenContexts });

  assert.equal(didPrime, true);
  assert.equal(draft.messageText, 'What does this imply for follow-up experiments?');
  assert.doesNotMatch(draft.messageText, /hidden selected sentence/);
  assert.equal(agentFlags.hiddenContexts.length, 1);
  assert.equal(agentFlags.hiddenContexts[0].text, 'A hidden selected sentence from page 2.');
  assert.equal(agentFlags.hiddenContexts[0].pageNumber, 2);
  assert.match(agentFlags.paperSessionPrompt, /active paper markdown/);

  payloadBuilder.consumeHiddenContexts();
  assert.equal(payloadBuilder.getDraftRequest().hiddenContexts.length, 0);
});

test('paper rail quick prompts load a common prompt into the composer', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-quick-prompts'
  ]);
  const prompt = 'Generate a step-by-step experimental protocol from this paper.';
  const quickPrompts = document.getElementById('agent-rail-quick-prompts');
  const messageInput = document.getElementById('agent-rail-message-input');
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [], deepResearchEnabled: false }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText
  });

  agent.render();
  trigger(quickPrompts, 'click', {
    target: {
      dataset: { agentSuggestPrompt: prompt },
      closest(selector) {
        return selector === '[data-agent-suggest-prompt]' ? this : null;
      }
    }
  });

  assert.equal(messageInput.value, prompt);
});
  }
};
