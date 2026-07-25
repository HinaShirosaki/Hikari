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
    'agent-new-chat-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const newChatBtn = document.getElementById('agent-new-chat-btn');
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
      storagePath: '/tmp/hikari-storage',
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {}
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    hikariApi: {
      autoSaveDataFile: async (data, filePath) => {
        autoSaveCalls.push({ data, filePath });
        return {
          ok: true,
          filePath: '/tmp/hikari-data.ena.json',
          sidecarPaths: {
            protocolsPath: '/tmp/Protocol',
            notebookPagesPath: '/tmp/hikari-data.notebook-pages.json',
            sqlitePath: '/tmp/Protocol/protocol.index.sqlite'
          },
          bundlePaths: {
            dataFilePath: '/tmp/hikari-data.ena.json',
            protocolsPath: '/tmp/Protocol',
            notebookPagesPath: '/tmp/hikari-data.notebook-pages.json',
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
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
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
  assert.equal(Object.hasOwn(payloadSeen.agent, 'deepResearchEnabled'), false);
  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.stateSnapshot.snapshot_mode, 'thin');
  assert.equal(payloadSeen.stateSnapshot.data_file_path, '/tmp/hikari-data.ena.json');
  assert.equal(payloadSeen.stateSnapshot.protocols.length, 1);
  assert.equal(payloadSeen.stateSnapshot.protocols[0].name, 'Cell Prep');
  assert.equal(payloadSeen.stateSnapshot.protocols[0].steps.length, 2);
  assert.equal(payloadSeen.stateSnapshot.notebookEntries.length, 0);
  assert.equal(payloadSeen.stateSnapshot.notebook_lookup_bridge.version, 1);
  assert.equal(payloadSeen.stateSnapshot.notebook_lookup_bridge.complete, true);
  assert.equal(payloadSeen.stateSnapshot.notebook_lookup_bridge.entries.length, 1);
  assert.equal(payloadSeen.stateSnapshot.notebook_lookup_bridge.entries[0].id, 'n1');
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
  assert.equal(payloadSeen.stateSnapshot.experimentData.schema_name, 'hikari_experiment_json');
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

  agent.render();
  assert.equal(sendBtn.disabled, false);
  assert.equal(newChatBtn.disabled, false);
  assert.equal(projectSelect.disabled, false);
  assert.equal(messageInput.disabled, false);
  assert.equal(status.textContent, 'Ready.');
  assert.ok(persistCalls >= 3);

  trigger(newChatBtn, 'click');
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
    settings: {
      storagePath: '/tmp/hikari-storage',
      preferredJournal: 'Nature Biotechnology; Cell'
    },
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
  const scopedState = scopedStateModule.createScopedAgentChatState(rootState, {
    getScopeContext: () => ({
      scopeType: 'paper',
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
  assert.deepEqual(snapshot.settings.preferredJournals, ['Nature Biotechnology', 'Cell']);
  assert.equal(snapshot.settings.preferredJournal, 'Nature Biotechnology; Cell');
});

test('notebook-scoped agent chat stores page sessions and exposes hidden page context', () => {
  const scopedStateModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'scoped-state.js'
  ));
  const rootState = {
    paperAgentChatSessions: {}
  };
  const scopedState = scopedStateModule.createScopedAgentChatState(rootState, {
    getScopeContext: () => ({
      scopeType: 'notebook',
      notebookEntryId: 'note-1',
      pageTitle: 'Atlas transfection',
      projectId: 'p1',
      projectName: 'Atlas',
      protocolId: 'prot-1',
      protocolName: 'HEK293 Transfection',
      hiddenContext: {
        kind: 'notebook-page',
        label: 'Active notebook page: Atlas transfection',
        text: `Active biology notebook page:\nStep 1: Seed cells.\n${'x'.repeat(5000)}`,
        notebookEntryId: 'note-1',
        projectName: 'Atlas',
        protocolName: 'HEK293 Transfection'
      }
    })
  });

  assert.equal(scopedState.agentChat.projectId, 'p1');
  assert.equal(Object.keys(rootState.paperAgentChatSessions).join(','), 'notebook:note-1');
  assert.match(scopedState.agentChatContext.sessionPrompt, /Biology Notebook right-rail/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /notebook_append/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /inventory_lookup/);
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].kind, 'notebook-page');
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].notebookEntryId, 'note-1');
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].text.length > 4000, true);

  const normalized = scopedStateModule.normalizePaperAgentChatSessions({
    'notebook:note-1': {
      projectId: 'p1',
      messages: [{ id: 'm1', role: 'user', text: 'Summarize this page.' }]
    }
  });
  assert.equal(normalized['notebook:note-1'].projectId, 'p1');
  assert.equal(normalized['notebook:note-1'].messages.length, 1);
});

test('assay-scoped agent chat stores assay sessions and exposes hidden assay context', () => {
  const scopedStateModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'scoped-state.js'
  ));
  const rootState = {
    paperAgentChatSessions: {}
  };
  const longAssayRows = Array.from({ length: 260 }, (_item, index) => (
    `A${index + 1}\tA\t${index + 1}\tA\t${10000 - index}\t0.${String(index).padStart(3, '0')}`
  )).join('\n');
  const assayTableContext = [
    'Active assay context:',
    'Mapped wells: 32',
    'Latest summary: treatment increased signal.',
    'Assay plate data (TSV; complete active mapped wells/results for assay_table create) (261 rows):',
    'well\trow\tcolumn\tsample\tconcentration\tresult',
    longAssayRows,
    'D8\tD\t8\tD\t3000\t0.320'
  ].join('\n');
  const scopedState = scopedStateModule.createScopedAgentChatState(rootState, {
    getScopeContext: () => ({
      scopeType: 'assay',
      assayId: 'assay-1',
      assayName: 'Atlas ELISA',
      assayMode: 'results',
      projectId: 'p1',
      projectName: 'Atlas',
      hiddenContext: {
        kind: 'assay-page',
        label: 'Active assay: Atlas ELISA',
        text: assayTableContext,
        assayId: 'assay-1',
        assayName: 'Atlas ELISA'
      }
    })
  });

  assert.equal(scopedState.agentChat.projectId, 'p1');
  assert.equal(Object.keys(rootState.paperAgentChatSessions).join(','), 'assay:assay-1');
  assert.match(scopedState.agentChatContext.sessionPrompt, /Assay right-rail/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /parse the TSV rows in that hidden context after the header/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /Do not use local lookup tools for active assay plate\/result data/);
  assert.match(scopedState.agentChatContext.sessionPrompt, /Hikari assay table and Plotly graph MCP tools/);
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].kind, 'assay-page');
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].assayId, 'assay-1');
  assert.match(scopedState.agentChatContext.hiddenContexts[0].text, /D8\tD\t8\tD\t3000\t0\.320/);
  assert.equal(scopedState.agentChatContext.hiddenContexts[0].text.length > 4000, true);

  const normalized = scopedStateModule.normalizePaperAgentChatSessions({
    'assay:assay-1': {
      projectId: 'p1',
      messages: [{ id: 'm1', role: 'user', text: 'Graph this assay.' }]
    }
  });
  assert.equal(normalized['assay:assay-1'].projectId, 'p1');
  assert.equal(normalized['assay:assay-1'].messages.length, 1);
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
      agent: {}
    },
    agentChat: { projectId: '', messages: [] },
    agentChatContext: {
      scopeType: 'paper',
      sessionPrompt: 'You are reading the active paper markdown.',
      paperId: 'paper-1',
      paperTitle: 'Atlas Uploaded Paper',
      knowledgeMarkdownRelativePath: 'KnowledgeBase/papers.md/atlas-uploaded-paper/paper.md',
      knowledgeStatus: 'ready'
    }
  };
  const input = { value: 'What does this imply for follow-up experiments?' };
  const hiddenContextUpdates = [];
  const payloadBuilder = payloadModule.createAgentPayloadBuilder({
    state,
    input,
    getComposerAttachments: () => [],
    ensureAgentState: () => {},
    onHiddenDraftContextsChanged: (contexts) => hiddenContextUpdates.push(contexts)
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
  assert.equal(payloadBuilder.getPrimedHiddenContexts().length, 1);
  assert.equal(hiddenContextUpdates.length, 1);

  payloadBuilder.consumeHiddenContexts();
  assert.equal(payloadBuilder.getDraftRequest().hiddenContexts.length, 0);
  assert.equal(payloadBuilder.getPrimedHiddenContexts().length, 0);
  assert.equal(hiddenContextUpdates.length, 2);
});

test('paper rail shows and removes the selected-text context indicator', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-hidden-context-list'
  ]);
  const hiddenContextList = document.getElementById('agent-rail-hidden-context-list');
  hiddenContextList.hidden = true;
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [] },
      agentChatContext: { scopeType: 'paper' }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText
  });

  agent.render();
  assert.equal(hiddenContextList.hidden, true);

  const didPrime = agent.primeHiddenContext({
    kind: 'paper-selection',
    label: 'Selected paper text',
    text: 'Selected sentence from the paper.'
  });

  assert.equal(didPrime, true);
  assert.equal(hiddenContextList.hidden, false);
  assert.match(hiddenContextList.innerHTML, /agent-hidden-context-icon/);
  assert.match(hiddenContextList.innerHTML, />Text</);

  trigger(hiddenContextList, 'click', {
    target: {
      dataset: { agentRemoveHiddenContext: '' },
      closest(selector) {
        return selector === '[data-agent-remove-hidden-context]' ? this : null;
      }
    }
  });

  assert.equal(hiddenContextList.hidden, true);
  assert.equal(hiddenContextList.innerHTML, '');
});

test('notebook rail automatically carries active page content as hidden agent context', () => {
  const payloadModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'payload-builder.js'
  ));
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    settings: {
      llm: { provider: 'codex', model: 'gpt-5' },
      agent: {}
    },
    agentChat: { projectId: 'p1', messages: [] },
    agentChatContext: {
      scopeType: 'notebook',
      sessionPrompt: 'You are reading the active notebook page.',
      hiddenContext: {
        kind: 'notebook-page',
        label: 'Active notebook page: Atlas transfection',
        text: 'Active biology notebook page:\nStep 1: Seed cells.\nPage notes/results: Cells looked healthy.',
        notebookEntryId: 'note-1',
        projectName: 'Atlas',
        protocolName: 'HEK293 Transfection'
      }
    }
  };
  const input = { value: 'What should I do next?' };
  const payloadBuilder = payloadModule.createAgentPayloadBuilder({
    state,
    input,
    getComposerAttachments: () => [],
    ensureAgentState: () => {}
  });

  const draft = payloadBuilder.getDraftRequest();
  const agentFlags = payloadBuilder.buildAgentFlagsPayload({ hiddenContexts: draft.hiddenContexts });

  assert.equal(draft.messageText, 'What should I do next?');
  assert.doesNotMatch(draft.messageText, /Cells looked healthy/);
  assert.equal(agentFlags.hiddenContexts.length, 1);
  assert.equal(agentFlags.hiddenContexts[0].kind, 'notebook-page');
  assert.equal(agentFlags.hiddenContexts[0].notebookEntryId, 'note-1');
  assert.match(agentFlags.hiddenContexts[0].text, /Cells looked healthy/);
  assert.equal(agentFlags.sessionPrompt, 'You are reading the active notebook page.');
  assert.equal(agentFlags.paperSessionPrompt, undefined);

  payloadBuilder.consumeHiddenContexts();
  assert.equal(payloadBuilder.getDraftRequest().hiddenContexts.length, 1);
});

test('assay rail automatically carries active assay content as hidden agent context', () => {
  const payloadModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'payload-builder.js'
  ));
  const longAssayRows = Array.from({ length: 260 }, (_item, index) => (
    `A${index + 1}\tA\t${index + 1}\tA\t${10000 - index}\t0.${String(index).padStart(3, '0')}`
  )).join('\n');
  const assayTableContext = [
    'Active assay context:',
    'Mapped wells: 32',
    'Latest summary: treatment increased signal.',
    'Assay plate data (TSV; complete active mapped wells/results for assay_table create) (261 rows):',
    'well\trow\tcolumn\tsample\tconcentration\tresult',
    longAssayRows,
    'D8\tD\t8\tD\t3000\t0.320'
  ].join('\n');
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    settings: {
      llm: { provider: 'codex', model: 'gpt-5' },
      agent: {}
    },
    agentChat: { projectId: 'p1', messages: [] },
    agentChatContext: {
      scopeType: 'assay',
      sessionPrompt: 'You are reading the active assay context.',
      hiddenContext: {
        kind: 'assay-page',
        label: 'Active assay: Atlas ELISA',
        text: assayTableContext,
        assayId: 'assay-1',
        assayName: 'Atlas ELISA'
      }
    }
  };
  const input = { value: 'Make a graph.' };
  const payloadBuilder = payloadModule.createAgentPayloadBuilder({
    state,
    input,
    getComposerAttachments: () => [],
    ensureAgentState: () => {}
  });

  const draft = payloadBuilder.getDraftRequest();
  const agentFlags = payloadBuilder.buildAgentFlagsPayload({ hiddenContexts: draft.hiddenContexts });

  assert.equal(draft.messageText, 'Make a graph.');
  assert.doesNotMatch(draft.messageText, /treatment increased signal/);
  assert.equal(agentFlags.hiddenContexts.length, 1);
  assert.equal(agentFlags.hiddenContexts[0].kind, 'assay-page');
  assert.equal(agentFlags.hiddenContexts[0].assayId, 'assay-1');
  assert.match(agentFlags.hiddenContexts[0].text, /treatment increased signal/);
  assert.match(agentFlags.hiddenContexts[0].text, /D8\tD\t8\tD\t3000\t0\.320/);
  assert.equal(agentFlags.hiddenContexts[0].text.length > 4000, true);
  assert.equal(agentFlags.sessionPrompt, 'You are reading the active assay context.');
  assert.equal(agentFlags.paperSessionPrompt, undefined);

  payloadBuilder.consumeHiddenContexts();
  assert.equal(payloadBuilder.getDraftRequest().hiddenContexts.length, 1);
});

test('unscoped shared agent chat initializes with neutral composer prompts', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-quick-prompts',
    'agent-rail-paper-screenshot-btn'
  ]);
  const quickPrompts = document.getElementById('agent-rail-quick-prompts');
  quickPrompts.innerHTML = `
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
  `;
  const messageInput = document.getElementById('agent-rail-message-input');
  const paperScreenshotBtn = document.getElementById('agent-rail-paper-screenshot-btn');
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [] }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText
  });

  agent.render();
  const buttons = quickPrompts.querySelectorAll('[data-agent-suggest-prompt]');

  assert.equal(messageInput.placeholder, 'Ask Hikari about this workspace.');
  assert.equal(quickPrompts.getAttribute('aria-label'), 'Common chat prompts');
  assert.equal(buttons[0].textContent, 'Summarize context');
  assert.match(buttons[0].dataset.agentSuggestPrompt, /workspace context/);
  assert.doesNotMatch(buttons[0].dataset.agentSuggestPrompt, /this paper/i);
  assert.equal(paperScreenshotBtn.hidden, true);
});

test('paper rail quick prompts initialize paper composer and load a common prompt', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-quick-prompts',
    'agent-rail-paper-screenshot-btn'
  ]);
  const quickPrompts = document.getElementById('agent-rail-quick-prompts');
  quickPrompts.innerHTML = `
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
  `;
  const messageInput = document.getElementById('agent-rail-message-input');
  const paperScreenshotBtn = document.getElementById('agent-rail-paper-screenshot-btn');
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [] },
      agentChatContext: { scopeType: 'paper' }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText,
    captureImageAttachment: () => Promise.resolve({ ok: true })
  });

  agent.render();
  const buttons = quickPrompts.querySelectorAll('[data-agent-suggest-prompt]');
  const prompt = buttons[0].dataset.agentSuggestPrompt;

  assert.equal(messageInput.placeholder, 'Ask Hikari about this paper.');
  assert.equal(quickPrompts.getAttribute('aria-label'), 'Common paper prompts');
  assert.equal(buttons[0].textContent, 'Generate protocol');
  assert.match(prompt, /from this paper/);
  assert.equal(paperScreenshotBtn.hidden, false);

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

test('notebook rail quick prompts initialize notebook composer and load page prompts', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-status',
    'agent-rail-quick-prompts',
    'agent-rail-paper-screenshot-btn'
  ]);
  const quickPrompts = document.getElementById('agent-rail-quick-prompts');
  quickPrompts.innerHTML = `
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
  `;
  const messageInput = document.getElementById('agent-rail-message-input');
  const status = document.getElementById('agent-rail-status');
  const paperScreenshotBtn = document.getElementById('agent-rail-paper-screenshot-btn');
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [] },
      agentChatContext: {
        scopeType: 'notebook',
        hiddenContext: {
          kind: 'notebook-page',
          text: 'Active biology notebook page:\nStep 1: Seed cells.'
        }
      }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText,
    captureImageAttachment: () => Promise.resolve({ ok: true })
  });

  agent.render();
  const buttons = quickPrompts.querySelectorAll('[data-agent-suggest-prompt]');
  const prompt = buttons[0].dataset.agentSuggestPrompt;

  assert.equal(messageInput.placeholder, 'Ask Hikari about this notebook page.');
  assert.equal(quickPrompts.getAttribute('aria-label'), 'Common notebook prompts');
  assert.equal(buttons[0].textContent, 'Research & append');
  assert.match(prompt, /complete hidden context/);
  assert.match(prompt, /notebook_append/);
  assert.match(prompt, /inventory_lookup/);
  assert.doesNotMatch(prompt, /this paper/i);
  assert.equal(paperScreenshotBtn.hidden, true);

  trigger(quickPrompts, 'click', {
    target: {
      dataset: { agentSuggestPrompt: prompt },
      closest(selector) {
        return selector === '[data-agent-suggest-prompt]' ? this : null;
      }
    }
  });

  assert.equal(messageInput.value, prompt);
  assert.equal(status.textContent, 'Prompt ready.');
});

test('assay rail quick prompts initialize assay composer and load graph prompt', () => {
  const document = createMockDocument([
    'agent-rail-chat-history',
    'agent-rail-message-input',
    'agent-rail-send-btn',
    'agent-rail-status',
    'agent-rail-quick-prompts',
    'agent-rail-paper-screenshot-btn'
  ]);
  const quickPrompts = document.getElementById('agent-rail-quick-prompts');
  quickPrompts.innerHTML = `
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
    <button type="button" data-agent-suggest-prompt="old">Old</button>
  `;
  const messageInput = document.getElementById('agent-rail-message-input');
  const status = document.getElementById('agent-rail-status');
  const paperScreenshotBtn = document.getElementById('agent-rail-paper-screenshot-btn');
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window: {}
  });
  const agent = agentModule.initAgentChat({
    idPrefix: 'agent-rail',
    state: {
      projects: [],
      settings: {},
      agentChat: { projectId: '', messages: [], sessions: [] },
      agentChatContext: {
        scopeType: 'assay',
        hiddenContext: {
          kind: 'assay-page',
          text: 'Active assay context:\nMapped wells: 2.'
        }
      }
    },
    persist: () => {},
    createId: () => 'agent-msg-1',
    safeText: shared.safeText,
    captureImageAttachment: () => Promise.resolve({ ok: true })
  });

  agent.render();
  const buttons = quickPrompts.querySelectorAll('[data-agent-suggest-prompt]');
  const prompt = buttons[1].dataset.agentSuggestPrompt;

  assert.equal(messageInput.placeholder, 'Ask Hikari about this assay.');
  assert.equal(quickPrompts.getAttribute('aria-label'), 'Common assay prompts');
  assert.equal(buttons[1].textContent, 'Make graph');
  assert.match(prompt, /Plotly graph/);
  assert.doesNotMatch(prompt, /this paper/i);
  assert.equal(paperScreenshotBtn.hidden, true);

  trigger(quickPrompts, 'click', {
    target: {
      dataset: { agentSuggestPrompt: prompt },
      closest(selector) {
        return selector === '[data-agent-suggest-prompt]' ? this : null;
      }
    }
  });

  assert.equal(messageInput.value, prompt);
  assert.equal(status.textContent, 'Prompt ready.');
});

test('unscoped session prompts do not masquerade as paper sessions', () => {
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
    settings: { agent: {} },
    agentChat: { projectId: '', messages: [] },
    agentChatContext: {
      sessionPrompt: 'You are reading shared workspace context.'
    }
  };
  const payloadBuilder = payloadModule.createAgentPayloadBuilder({
    state,
    input: { value: 'What is relevant here?' },
    getComposerAttachments: () => [],
    ensureAgentState: () => {}
  });

  const agentFlags = payloadBuilder.buildAgentFlagsPayload({ hiddenContexts: [] });

  assert.equal(agentFlags.sessionPrompt, 'You are reading shared workspace context.');
  assert.equal(agentFlags.paperSessionPrompt, undefined);
  assert.equal(agentFlags.paperSession, undefined);
});
  }
};
