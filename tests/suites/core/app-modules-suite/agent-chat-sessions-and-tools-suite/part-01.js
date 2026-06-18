module.exports = function registerAppAgentChatSessionsAndToolsSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat loads saved sessions from chat logs and switches sessions from the sidebar', async () => {
  const document = createMockDocument([
    'agent-project-select',
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
      storagePath: '/tmp/hikari-storage',
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
    hikariApi: {
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
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-2');
  assert.equal(state.agentChat.messages.length, 2);
  assert.match(sessionList.innerHTML, /Recent literature search/);
  assert.match(sessionList.innerHTML, /Atlas notebook question/);
  assert.doesNotMatch(sessionList.innerHTML, /Found 3 recent papers/);
  assert.doesNotMatch(sessionList.innerHTML, /Saved chat/);
  assert.doesNotMatch(sessionList.innerHTML, /msgs/);
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
      storagePath: '/tmp/hikari-storage',
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
    hikariApi: {
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
  }
};
