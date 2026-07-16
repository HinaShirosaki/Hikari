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
                  primary_intent: 'notebook_lookup',
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
                notebook_lookup: {
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
test('agent-chat keeps running requests isolated to their own sessions', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-session-rail',
    'agent-session-status',
    'agent-session-list',
    'agent-new-chat-btn',
    'agent-session-context-menu',
    'agent-context-new-folder',
    'agent-context-rename-folder',
    'agent-context-delete-folder',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-stop-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const sessionRail = document.getElementById('agent-session-rail');
  const sessionList = document.getElementById('agent-session-list');
  const messageInput = document.getElementById('agent-message-input');
  const requestResolvers = new Map();
  let sessionLoadCalls = 0;
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
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
      agent: { developerMode: false }
    },
    agentChat: {
      projectId: '',
      currentSessionId: 'chat-active',
      selectedFolderId: 'general',
      sessions: [
        { id: 'chat-active', title: 'Active request', project_id: '' },
        { id: 'chat-other', title: 'Other chat', project_id: 'p1' }
      ],
      messages: []
    }
  };
  const window = {
    hikariApi: {
      agentChat: (payload) => new Promise((resolve) => {
        requestResolvers.set(payload.chatSessionId, resolve);
      }),
      agentChatLogGetSession: async ({ sessionId }) => {
        sessionLoadCalls += 1;
        return {
          ok: true,
          session: {
            id: sessionId,
            title: sessionId === 'chat-other' ? 'Other chat' : 'Active request',
            project_id: sessionId === 'chat-other' ? 'p1' : ''
          },
          messages: sessionId === 'chat-other'
            ? [{ id: 'other-message', role: 'assistant', text: 'Other chat history.' }]
            : []
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
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `rail-lock-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    loadPersistentSessions: false,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Continue working in this chat.';
  trigger(document.getElementById('agent-send-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(typeof requestResolvers.get('chat-active'), 'function');
  assert.equal(sessionRail.classList.contains('is-agent-running'), false);
  assert.notEqual(sessionRail.inert, true);
  assert.equal(sessionRail.getAttribute('aria-disabled'), null);
  assert.doesNotMatch(sessionList.innerHTML, /data-session-id="chat-other"[\s\S]*?disabled/);
  assert.match(sessionList.innerHTML, /agent-session-card[^\"]*is-agent-running[^\"]*"[\s\S]*data-session-id="chat-active"/);

  const otherChat = sessionList.querySelectorAll('[data-session-id]')
    .find((item) => item.dataset.sessionId === 'chat-other');
  trigger(sessionList, 'click', { target: otherChat });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-other');
  assert.equal(sessionLoadCalls, 1);
  assert.equal(messageInput.disabled, false);
  assert.equal(document.getElementById('agent-send-btn').disabled, false);
  assert.match(document.getElementById('agent-chat-history').innerHTML, /Other chat history/);

  messageInput.value = 'Work independently in the other chat.';
  trigger(document.getElementById('agent-send-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(typeof requestResolvers.get('chat-other'), 'function');
  assert.equal(messageInput.disabled, true);
  assert.equal((sessionList.innerHTML.match(/is-agent-running/g) || []).length, 2);

  requestResolvers.get('chat-active')({ ok: false, canceled: true, error: 'First request finished.' });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-other');
  assert.equal(messageInput.disabled, true);
  assert.doesNotMatch(document.getElementById('agent-chat-history').innerHTML, /First request finished/);
  assert.equal((sessionList.innerHTML.match(/is-agent-running/g) || []).length, 1);

  requestResolvers.get('chat-other')({ ok: false, canceled: true, error: 'Second request finished.' });
  await flushAsync();
  await flushAsync();

  assert.equal(messageInput.disabled, false);
  assert.equal((sessionList.innerHTML.match(/is-agent-running/g) || []).length, 0);

  const agentViewCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'agent-view.css'), 'utf8');
  assert.doesNotMatch(agentViewCss, /\.agent-session-rail\.is-agent-running/);
  assert.match(agentViewCss, /\.agent-session-card\.is-agent-running::after/);
});
test('agent-chat creates project folders, custom folders, and project-scoped chats', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-session-rail',
    'agent-session-status',
    'agent-session-list',
    'agent-new-chat-btn',
    'agent-session-context-menu',
    'agent-context-new-folder',
    'agent-context-rename-folder',
    'agent-context-delete-folder',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const sessionList = document.getElementById('agent-session-list');
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
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
      agent: { developerMode: false }
    },
    agentChat: {
      projectId: '',
      currentSessionId: '',
      sessions: [],
      messages: []
    }
  };
  let createPayload = null;
  const window = {
    hikariApi: {
      agentChatLogListSessions: async () => ({ ok: true, items: [] }),
      agentChatLogGetSession: async () => ({ ok: false, error: 'not used' }),
      agentChatLogCreateSession: async (payload) => {
        createPayload = payload;
        return {
          ok: true,
          session: {
            id: 'chat-project',
            title: 'New Chat',
            project_id: payload.projectId,
            project_name: payload.projectName,
            created_at: '2026-07-11T12:00:00.000Z',
            updated_at: '2026-07-11T12:00:00.000Z'
          }
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
    persist: () => {},
    createId: () => 'folder-1',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  await flushAsync();
  assert.match(sessionList.innerHTML, /data-agent-folder-id="project:p1"/);
  assert.match(sessionList.innerHTML, />Atlas</);

  const projectFolder = sessionList.querySelectorAll('[data-agent-folder-id]')
    .find((item) => item.dataset.agentFolderId === 'project:p1');
  projectFolder.closest = (selector) => selector === '[data-agent-folder-id]' ? projectFolder : null;
  trigger(sessionList, 'click', { target: projectFolder });

  trigger(document.getElementById('agent-new-chat-btn'), 'click');
  await flushAsync();
  await flushAsync();
  assert.equal(createPayload.projectId, 'p1');
  assert.equal(createPayload.projectName, 'Atlas');
  assert.equal(state.agentChat.sessionFolderIds['chat-project'], 'project:p1');

  trigger(document.getElementById('agent-context-new-folder'), 'click');
  assert.equal(state.agentChat.folders.length, 1);
  assert.equal(state.agentChat.folders[0].name, 'New Folder');
  assert.match(sessionList.innerHTML, /data-agent-folder-rename-input="custom:folder-1"/);

  state.projects.push({ id: 'p2', name: 'Second Study' });
  agent.render();
  assert.match(sessionList.innerHTML, /data-agent-folder-id="project:p2"/);
  assert.match(sessionList.innerHTML, />Second Study</);
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
