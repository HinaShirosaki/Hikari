module.exports = function registerAppAgentChatCoreSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat keeps notebook-draft proposals confirm-first and creates one planned page on click', async () => {
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
  const status = document.getElementById('agent-status');
  let openedNotebookEntryId = '';

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
    hikariApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/hikari-data.ena.json'
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

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
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
    onNotebookEntriesChanged: () => {},
    onOpenNotebookEntry: (entryId) => {
      openedNotebookEntryId = String(entryId || '');
    }
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
  assert.equal(openedNotebookEntryId, state.notebookEntries[0].id);
  assert.match(history.innerHTML, /Open Planned Page/);
  assert.equal(status.textContent, 'Planned notebook page created.');

  openedNotebookEntryId = '';
  const openButtons = history.querySelectorAll('[data-agent-open-notebook-page]');
  assert.equal(openButtons.length, 1);
  trigger(history, 'click', { target: openButtons[0] });
  assert.equal(state.notebookEntries.length, 1);
  assert.equal(openedNotebookEntryId, state.notebookEntries[0].id);
  assert.equal(status.textContent, 'Opened planned notebook page.');
});
test('agent-chat releases the composer immediately when cancellation is acknowledged', async () => {
  const requestControllerModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'agent-request-controller.js'
  ));
  let resolveAgentChat = null;
  const state = { agentChat: { messages: [] } };
  const runtime = {
    inFlight: false,
    liveAssistantMessage: null,
    activeClientRequestId: '',
    inFlightClientRequestId: '',
    stopRequested: false,
    stopInProgress: false
  };
  const inFlightUpdates = [];
  const statuses = [];
  const controller = requestControllerModule.createAgentRequestController({
    api: {
      agentChat: () => new Promise((resolve) => {
        resolveAgentChat = resolve;
      }),
      agentChatCancel: async () => ({ ok: true, canceled: true })
    },
    state,
    runtime,
    input: { value: 'Find papers on molecular glue degraders.' },
    createId: (() => {
      let index = 0;
      return () => `request-message-${index += 1}`;
    })(),
    persist: () => {},
    payloadBuilder: {
      getDraftRequest: () => ({
        rawMessageText: 'Find papers on molecular glue degraders.',
        attachments: [],
        messageText: 'Find papers on molecular glue degraders.',
        hiddenContexts: []
      }),
      getCurrentProjectDetails: () => ({ projectId: '', projectName: '' }),
      buildAgentLlmPayload: () => ({}),
      buildAgentFlagsPayload: () => ({})
    },
    attachmentsController: { reset: () => {} },
    sessionManager: {
      ensureCurrentChatSession: async () => 'chat-1',
      renderSessionList: () => {},
      upsertSessionSummary: () => {},
      refreshPersistentSessions: async () => {}
    },
    buildSyncedStateSnapshot: async () => ({}),
    ensureAgentState: () => {},
    renderContextSummary: () => {},
    renderHistoryView: () => {},
    setStatus: (value) => statuses.push(value),
    syncComposerHeight: () => {},
    updateInFlightState: (value) => {
      runtime.inFlight = value;
      inFlightUpdates.push(value);
    },
    onNotebookEntriesChanged: () => {}
  });

  const pendingSend = controller.sendMessage();
  await flushAsync();
  await flushAsync();
  assert.equal(typeof resolveAgentChat, 'function');
  assert.equal(runtime.inFlight, true);

  await controller.stopMessage();

  assert.deepEqual(inFlightUpdates, [true, false]);
  assert.equal(runtime.inFlight, false);
  assert.equal(runtime.activeClientRequestId, '');
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].text, 'Agent stopped.');
  assert.equal(statuses.at(-1), 'Stopped.');

  resolveAgentChat({ ok: false, canceled: true, error: 'Agent request stopped by user.' });
  await pendingSend;
  assert.equal(state.agentChat.messages.length, 2);
  assert.deepEqual(inFlightUpdates, [true, false]);
});
test('agent-chat delegates notebook and protocol domain records to owner adapters', () => {
  const agentChatRoot = path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat');
  const reviewSource = fs.readFileSync(path.join(agentChatRoot, 'review-overlay.js'), 'utf8');
  const historySource = fs.readFileSync(path.join(agentChatRoot, 'history-notebook-actions.js'), 'utf8');
  const agentIndexSource = fs.readFileSync(path.join(agentChatRoot, 'index.js'), 'utf8');
  const selectionContextSource = fs.readFileSync(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'selection-insights',
    'controller-context.js'
  ), 'utf8');

  assert.equal(fs.existsSync(path.join(agentChatRoot, 'notebook-drafts.js')), false);
  assert.doesNotMatch(reviewSource, /function normalizeGeneratedProtocol|state\.protocols\s*=|state\.protocols\.push/);
  assert.doesNotMatch(historySource, /state\.notebookEntries\s*=|state\.notebookEntries\.push/);
  assert.match(agentIndexSource, /biology-notebook\/agent\/index\.js/);
  assert.match(agentIndexSource, /protocol\/agent\/index\.js/);
  assert.match(selectionContextSource, /from '\.\.\/agent-chat\/public-api\.js'/);
  assert.doesNotMatch(selectionContextSource, /agent-chat\/state-snapshot\.js/);
});
  }
};
