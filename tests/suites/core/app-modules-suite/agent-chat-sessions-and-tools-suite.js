module.exports = function registerAppAgentChatSessionsAndToolsSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat loads saved sessions from chat logs and switches sessions from the sidebar', async () => {
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
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
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
      currentSessionId: '',
      sessions: [],
      messages: []
    }
  };

  const window = {
    enanaApi: {
      agentChatLogListSessions: async () => ({
        ok: true,
        items: [
          {
            id: 'chat-2',
            title: 'Recent literature search',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T18:00:00.000Z',
            created_at: '2026-03-22T18:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Found 3 recent papers.'
          },
          {
            id: 'chat-1',
            title: 'Atlas notebook question',
            project_id: 'p1',
            project_name: 'Cancer Study',
            updated_at: '2026-03-22T17:00:00.000Z',
            created_at: '2026-03-22T17:00:00.000Z',
            message_count: 2,
            last_message_preview: 'I found the notebook entry.'
          }
        ]
      }),
      agentChatLogGetSession: async ({ sessionId }) => ({
        ok: true,
        session: {
          id: sessionId,
          project_id: sessionId === 'chat-1' ? 'p1' : '',
          project_name: sessionId === 'chat-1' ? 'Cancer Study' : '',
          title: sessionId === 'chat-1' ? 'Atlas notebook question' : 'Recent literature search'
        },
        messages: sessionId === 'chat-1'
          ? [
            {
              id: 'u1',
              role: 'user',
              text: 'Where is the Atlas notebook entry?',
              createdAt: '2026-03-22T17:00:00.000Z'
            },
            {
              id: 'a1',
              role: 'assistant',
              text: 'I found the notebook entry.',
              createdAt: '2026-03-22T17:00:05.000Z',
              meta: {
                parser: {
                  primary_intent: 'record_lookup',
                  needs_clarification: false,
                  entities: {},
                  inventory_search: {
                    normalized_query: null,
                    candidate_terms: [],
                    aliases: [],
                    search_mode: null
                  },
                  protocol_candidates: [],
                  reasoning_summary: 'Loaded from disk.'
                },
                record_lookup: {
                  status: 'matched',
                  query: 'Atlas notebook'
                }
              }
            }
          ]
          : [
            {
              id: 'u2',
              role: 'user',
              text: 'Find recent kinase papers.',
              createdAt: '2026-03-22T18:00:00.000Z'
            },
            {
              id: 'a2',
              role: 'assistant',
              text: 'Found 3 recent papers.',
              createdAt: '2026-03-22T18:00:05.000Z',
              meta: {
                parser: {
                  primary_intent: 'general_science_question',
                  needs_clarification: false,
                  entities: {},
                  inventory_search: {
                    normalized_query: null,
                    candidate_terms: [],
                    aliases: [],
                    search_mode: null
                  },
                  protocol_candidates: [],
                  reasoning_summary: 'Loaded from disk.'
                },
                general_science_question: {
                  status: 'answered',
                  answer: 'Found 3 recent papers.'
                }
              }
            }
          ]
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
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-2');
  assert.equal(state.agentChat.messages.length, 2);
  assert.match(sessionList.innerHTML, /Recent literature search/);
  assert.match(sessionList.innerHTML, /Atlas notebook question/);
  assert.match(history.innerHTML, /Found 3 recent papers/);

  const sessionButtons = sessionList.querySelectorAll('[data-session-id]');
  const atlasSessionButton = sessionButtons.find((item) => item.dataset.sessionId === 'chat-1');
  trigger(sessionList, 'click', { target: atlasSessionButton });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-1');
  assert.equal(state.agentChat.projectId, 'p1');
  assert.match(history.innerHTML, /Atlas notebook entry/);
  assert.equal(status.textContent, 'Ready.');
});

test('agent-chat session switching honors nested click targets and replays the latest click after an in-flight load', async () => {
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
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
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
      currentSessionId: '',
      sessions: [],
      messages: []
    }
  };

  let releaseChat2Load = null;
  const window = {
    enanaApi: {
      agentChatLogListSessions: async () => ({
        ok: true,
        items: [
          {
            id: 'chat-2',
            title: 'Initially loaded',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T19:00:00.000Z',
            created_at: '2026-03-22T19:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Second session preview.'
          },
          {
            id: 'chat-1',
            title: 'Nested click target',
            project_id: 'p1',
            project_name: 'Cancer Study',
            updated_at: '2026-03-22T18:00:00.000Z',
            created_at: '2026-03-22T18:00:00.000Z',
            message_count: 2,
            last_message_preview: 'First session preview.'
          },
          {
            id: 'chat-3',
            title: 'Queued target',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T17:00:00.000Z',
            created_at: '2026-03-22T17:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Third session preview.'
          }
        ]
      }),
      agentChatLogGetSession: ({ sessionId }) => {
        if (sessionId === 'chat-2') {
          return new Promise((resolve) => {
            releaseChat2Load = () => resolve({
              ok: true,
              session: {
                id: 'chat-2',
                project_id: '',
                project_name: '',
                title: 'Initially loaded'
              },
              messages: [
                {
                  id: 'u2',
                  role: 'user',
                  text: 'Load the second session.',
                  createdAt: '2026-03-22T18:00:00.000Z'
                },
                {
                  id: 'a2',
                  role: 'assistant',
                  text: 'Second session loaded.',
                  createdAt: '2026-03-22T18:00:05.000Z'
                }
              ]
            });
          });
        }
        return Promise.resolve({
          ok: true,
          session: {
            id: sessionId,
            project_id: sessionId === 'chat-1' ? 'p1' : '',
            project_name: sessionId === 'chat-1' ? 'Cancer Study' : '',
            title: sessionId === 'chat-1' ? 'Nested click target' : 'Queued target'
          },
          messages: sessionId === 'chat-1'
            ? [
              {
                id: 'u1',
                role: 'user',
                text: 'Open the first session.',
                createdAt: '2026-03-22T17:00:00.000Z'
              },
              {
                id: 'a1',
                role: 'assistant',
                text: 'First session opened.',
                createdAt: '2026-03-22T17:00:05.000Z'
              }
            ]
            : [
              {
                id: 'u3',
                role: 'user',
                text: 'Open the queued third session.',
                createdAt: '2026-03-22T19:00:00.000Z'
              },
              {
                id: 'a3',
                role: 'assistant',
                text: 'Third session opened.',
                createdAt: '2026-03-22T19:00:05.000Z'
              }
            ]
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
  assert.equal(typeof releaseChat2Load, 'function');

  const sessionButtons = sessionList.querySelectorAll('[data-session-id]');
  const nestedTargetSession = sessionButtons.find((item) => item.dataset.sessionId === 'chat-1');
  const queuedTargetSession = sessionButtons.find((item) => item.dataset.sessionId === 'chat-3');
  const nestedTitle = nestedTargetSession.querySelector('strong');

  trigger(sessionList, 'click', { target: nestedTitle });
  trigger(sessionList, 'click', { target: queuedTargetSession });

  await flushAsync();
  assert.equal(state.agentChat.currentSessionId, '');

  releaseChat2Load();
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-3');
  assert.match(history.innerHTML, /Third session opened/);
  assert.equal(status.textContent, 'Ready.');
});

test('agent-chat exposes developer-only manual tool smoke test action and renders results', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-developer-tools',
    'agent-dev-test-tools-btn',
    'agent-dev-tool-select',
    'agent-dev-tool-message',
    'agent-dev-run-tool-btn',
    'agent-dev-tool-hint',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const developerTools = document.getElementById('agent-developer-tools');
  const developerTestBtn = document.getElementById('agent-dev-test-tools-btn');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: 'p1', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentDeveloperTestTools: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          status: 'completed',
          tool_count: 2,
          passed_count: 2,
          failed_count: 0,
          summary: 'Manual tool smoke test completed: 2/2 tools passed.',
          items: [
            {
              tool_name: 'inventory-lookup',
              ok: true,
              status: 'matched',
              summary: 'Inventory lookup smoke test passed.',
              preview: 'Atlas construct sample',
              duration_ms: 8
            },
            {
              tool_name: 'python-sandbox',
              ok: true,
              status: 'ok',
              summary: 'Python sandbox smoke test passed.',
              preview: 'out.json',
              duration_ms: 12
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
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.equal(Boolean(developerTools.hidden), true);

  state.settings.agent.developerMode = true;
  agent.render();
  assert.equal(Boolean(developerTools.hidden), false);

  trigger(developerTestBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.projectName, 'Cancer Study');
  assert.equal(payloadSeen.agent.developerMode, true);
  assert.equal(payloadSeen.stateSnapshot.snapshot_mode, 'thin');
  assert.equal(state.agentChat.messages.length, 1);
  assert.equal(state.agentChat.messages[0].role, 'assistant');
  assert.equal(state.agentChat.messages[0].meta.tool_test.tool_count, 2);
  assert.match(history.innerHTML, /Tool Smoke Test/);
  assert.match(history.innerHTML, /inventory-lookup/);
  assert.match(history.innerHTML, /python-sandbox/);
  assert.match(history.innerHTML, /Passed=2/);
  assert.equal(status.textContent, 'Manual tool smoke test complete.');
});

test('agent-chat lets developers run one tool with a manual message and inspect the raw result', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-developer-tools',
    'agent-dev-test-tools-btn',
    'agent-dev-tool-select',
    'agent-dev-tool-message',
    'agent-dev-run-tool-btn',
    'agent-dev-tool-hint',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const developerToolSelect = document.getElementById('agent-dev-tool-select');
  const developerToolMessage = document.getElementById('agent-dev-tool-message');
  const developerRunToolBtn = document.getElementById('agent-dev-run-tool-btn');
  const developerToolHint = document.getElementById('agent-dev-tool-hint');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: true
      }
    },
    agentChat: { projectId: 'p1', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentDeveloperTestTools: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          run_mode: 'single',
          status: 'completed',
          tool_name: payload.toolName,
          request_message: payload.message,
          tool_count: 1,
          passed_count: 1,
          failed_count: 0,
          summary: `Manual tool test completed for ${payload.toolName}: Python sandbox completed and wrote out.json.`,
          items: [
            {
              tool_name: payload.toolName,
              ok: true,
              status: 'ok',
              request_message: payload.message,
              result_message: 'Python sandbox completed and wrote out.json.',
              summary: 'Python sandbox completed and wrote out.json.',
              preview: 'out.json',
              duration_ms: 9,
              raw_result: {
                ok: true,
                status: 'ok',
                run_id: 'py-manual-1',
                render_outputs: [
                  {
                    type: 'text',
                    title: 'Summary',
                    format: 'text/plain',
                    content: 'Manual sandbox output is visible in chat.'
                  },
                  {
                    type: 'image',
                    title: 'Preview',
                    mime_type: 'image/png',
                    data_base64: Buffer.from('manual-image').toString('base64')
                  }
                ],
                readback_files: [
                  {
                    path: 'out.json',
                    content: JSON.stringify({ request_message: payload.message })
                  }
                ]
              }
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
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.match(developerToolHint.textContent, /inventory lookup output/i);

  developerToolSelect.value = 'python-sandbox';
  trigger(developerToolSelect, 'change');
  developerToolMessage.value = 'Write a JSON file noting this manual tool test.';
  trigger(developerRunToolBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.toolName, 'python-sandbox');
  assert.equal(payloadSeen.message, 'Write a JSON file noting this manual tool test.');
  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.projectName, 'Cancer Study');
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.match(state.agentChat.messages[0].text, /Tool test \(python-sandbox\)/);
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.equal(state.agentChat.messages[1].meta.tool_test.run_mode, 'single');
  assert.equal(state.agentChat.messages[1].meta.tool_test.request_message, 'Write a JSON file noting this manual tool test.');
  assert.match(history.innerHTML, /Manual Tool Test/);
  assert.match(history.innerHTML, /Input Message/);
  assert.match(history.innerHTML, /Raw Result/);
  assert.match(history.innerHTML, /request_message/);
  assert.match(history.innerHTML, /Manual sandbox output is visible in chat\./);
  assert.match(history.innerHTML, /data:image\/png;base64,bWFudWFsLWltYWdl/);
  assert.equal(status.textContent, 'Manual tool test complete for python-sandbox.');
});

test('agent-chat prioritizes inventory lookup summary text and renders lookup metadata panels', async () => {
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

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
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
          primary_intent: 'inventory_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            inventory_item: 'pET28a-SUMO1'
          },
          inventory_search: {
            normalized_query: 'pet28a-sumo1',
            candidate_terms: ['pet28a-sumo1'],
            aliases: [],
            search_mode: 'mixed'
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        inventory_lookup: {
          status: 'matched',
          query: 'pet28a-sumo1',
          terms_used: ['pet28a-sumo1'],
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              kind: 'personal_sample',
              zone: '-20 Degree',
              id: 'sample-1',
              name: 'pET28a-SUMO1',
              location: 'Box A1'
            },
            {
              kind: 'chemical',
              zone: 'Lab Inventory',
              id: 'chem-2',
              name: 'IPTG',
              location: 'Shelf 4'
            }
          ]
        },
        record_lookup: {
          status: 'matched',
          query: 'transformation',
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              record_type: 'notebook',
              id: 'note-1',
              title: 'Transformation Run'
            }
          ]
        },
        developer_trace: []
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
  messageInput.value = 'Where is pET28a-SUMO1?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.inventory_lookup.status, 'matched');
  assert.equal(state.agentChat.messages[1].meta.record_lookup.status, 'matched');
  assert.match(state.agentChat.messages[1].text, /Found 2 inventory matches/);
  assert.match(state.agentChat.messages[1].text, /location Box A1/i);
  assert.match(state.agentChat.messages[1].text, /location Shelf 4/i);
  assert.equal(/record match/i.test(state.agentChat.messages[1].text), false);
  assert.match(history.innerHTML, /Inventory Lookup/);
  assert.match(history.innerHTML, /Inventory Items/);
  assert.match(history.innerHTML, /Record Lookup/);
});

test('agent-chat uses record lookup summary when inventory lookup payload is absent', async () => {
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

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
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
        provider: 'openai',
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
          primary_intent: 'record_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            requested_output: 'transformation record'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        record_lookup: {
          status: 'no_match',
          query: 'transformation record',
          source: 'sqlite',
          backfilled_sql: false,
          items: []
        },
        developer_trace: []
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
  messageInput.value = 'Find my transformation record.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.record_lookup.status, 'no_match');
  assert.match(state.agentChat.messages[1].text, /No record matches found/);
  assert.match(history.innerHTML, /Record Lookup/);
  assert.equal(/Inventory Lookup/.test(history.innerHTML), false);
});

  }
};
