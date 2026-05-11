module.exports = function registerAppAgentChatSessionsAndToolsSuite(context = {}) {
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
  assert.match(history.innerHTML, /Manual tool smoke test completed: 2\/2 tools passed\./);
  assert.doesNotMatch(history.innerHTML, /Tool Smoke Test/);
  assert.doesNotMatch(history.innerHTML, /inventory-lookup/);
  assert.doesNotMatch(history.innerHTML, /python-sandbox/);
  assert.equal(status.textContent, 'Manual tool smoke test complete.');
});

test('agent-chat lets developers run one tool with a manual message and inspect the raw result', async () => {
  const document = createMockDocument([
    'agent-project-select',
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
  assert.match(history.innerHTML, /Manual tool test completed for python-sandbox/);
  assert.doesNotMatch(history.innerHTML, /Manual Tool Test/);
  assert.doesNotMatch(history.innerHTML, /Input Message/);
  assert.doesNotMatch(history.innerHTML, /Raw Result/);
  assert.doesNotMatch(history.innerHTML, /request_message/);
  assert.match(history.innerHTML, /Manual sandbox output is visible in chat\./);
  assert.match(history.innerHTML, /data:image\/png;base64,bWFudWFsLWltYWdl/);
  assert.equal(status.textContent, 'Manual tool test complete for python-sandbox.');
});

test('agent-chat developer response simulator previews context and injects typed LLM output', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-developer-tools',
    'agent-dev-response-simulator',
    'agent-dev-response-summary',
    'agent-dev-response-fold-btn',
    'agent-dev-response-body',
    'agent-dev-visible-context',
    'agent-dev-mock-response',
    'agent-dev-refresh-context-btn',
    'agent-dev-use-mock-response-btn',
    'agent-dev-response-hint',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const simulator = document.getElementById('agent-dev-response-simulator');
  const visibleContext = document.getElementById('agent-dev-visible-context');
  const mockResponse = document.getElementById('agent-dev-mock-response');
  const refreshContextBtn = document.getElementById('agent-dev-refresh-context-btn');
  const useMockResponseBtn = document.getElementById('agent-dev-use-mock-response-btn');
  const messageInput = document.getElementById('agent-message-input');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  let previewPayloadSeen = null;
  let agentChatCalled = false;
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [{ id: 'pr1', name: 'Cell Prep', steps: [] }],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        apiEndpoint: '',
        apiKey: ''
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
      agentDeveloperContextPreview: async (payload) => {
        previewPayloadSeen = payload;
        return {
          ok: true,
          updated_at: '2026-05-08T12:00:00.000Z',
          provider: 'codex',
          model: 'gpt-5.4',
          project: { id: payload.projectId, name: payload.projectName },
          request: {
            message: payload.message,
            conversation: payload.conversation,
            attachments: []
          },
          prompt: {
            kind: 'codex_agent_prompt',
            system_prompt: 'Backend rendered Codex system prompt with MCP instructions.'
          },
          llm: { provider: 'codex', model: 'gpt-5.4' },
          agent: payload.agent,
          state_snapshot: payload.stateSnapshot
        };
      },
      agentChat: async () => {
        agentChatCalled = true;
        return { ok: false, error: 'should not call real agent chat' };
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
  assert.equal(Boolean(simulator.hidden), true);

  state.settings.agent.developerMode = true;
  agent.render();
  assert.equal(Boolean(simulator.hidden), false);
  assert.match(visibleContext.value, /Agent-visible context/);
  assert.match(visibleContext.value, /Refresh Context to render the backend prompt/);

  messageInput.value = 'Pretend the agent found the answer.';
  trigger(messageInput, 'input');
  trigger(refreshContextBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(previewPayloadSeen.message, 'Pretend the agent found the answer.');
  assert.equal(previewPayloadSeen.projectId, 'p1');
  assert.equal(previewPayloadSeen.agent.developerMode, true);
  assert.match(visibleContext.value, /Backend rendered Codex system prompt/);
  assert.match(visibleContext.value, /Pretend the agent found the answer\./);

  mockResponse.value = JSON.stringify({
    status: 'completed',
    assistant_text: 'Injected answer from the typed mock response.',
    reasoning_summary: 'Developer supplied a mock response.'
  });
  trigger(useMockResponseBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(agentChatCalled, false);
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.equal(state.agentChat.messages[0].text, 'Pretend the agent found the answer.');
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.equal(state.agentChat.messages[1].text, 'Injected answer from the typed mock response.');
  assert.equal(state.agentChat.messages[1].meta.developer_mock_response.injected, true);
  assert.equal(state.agentChat.messages[1].meta.developer_mock_response.parsed_json, true);
  assert.equal(state.agentChat.messages[1].meta.developer_mock_response.context_summary.provider, 'codex');
  assert.match(history.innerHTML, /Injected answer from the typed mock response\./);
  assert.equal(status.textContent, 'Developer mock response injected.');
});

test('agent-chat prioritizes inventory lookup summary text and renders lookup metadata panels', async () => {
  const document = createMockDocument([
    'agent-project-select',
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
  assert.doesNotMatch(history.innerHTML, /Inventory Lookup/);
  assert.doesNotMatch(history.innerHTML, /Inventory Items/);
  assert.doesNotMatch(history.innerHTML, /Record Lookup/);
});

test('agent-chat uses record lookup summary when inventory lookup payload is absent', async () => {
  const document = createMockDocument([
    'agent-project-select',
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
  assert.doesNotMatch(history.innerHTML, /Record Lookup/);
  assert.equal(/Inventory Lookup/.test(history.innerHTML), false);
});

test('agent-chat prioritizes purchase recommendation summary, renders shopping tiles, and opens vendor pages', async () => {
  const document = createMockDocument([
    'agent-project-select',
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

  const openedUrls = [];
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
      openExternalUrl: async (url) => {
        openedUrls.push(url);
        return { ok: true, url };
      },
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'purchase_recommendation',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            product_query: 'pipette tips',
            required_attributes: 'endotoxin-free, metal-free',
            excluded_attributes: 'latex',
            budget_preference: 'cheap'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: [],
          reasoning_summary: 'Find products the user can buy that meet explicit constraints.'
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
              product_url: 'https://vendor.example/item-1',
              source_domain: 'vendor.example',
              matched_requirements: ['endotoxin-free', 'metal-free']
            },
            {
              id: 'item-2',
              title: 'Metal-Free Filter Tips',
              vendor: 'Science Supply',
              price_text: '$19.49',
              price_value: 19.49,
              currency: 'USD',
              image_url: 'https://vendor.example/item-2.png',
              product_url: 'https://vendor.example/item-2',
              source_domain: 'vendor.example',
              matched_requirements: ['metal-free']
            }
          ],
          follow_up_questions: [],
          summary: 'Found 2 purchase recommendations for cheap endotoxin-free metal-free pipette tips.'
        },
        inventory_lookup: {
          status: 'matched',
          query: 'pipette tips',
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              kind: 'personal_sample',
              id: 'sample-1',
              name: 'Legacy tips',
              location: 'Drawer 4'
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
  messageInput.value = 'Find cheap endotoxin-free metal-free pipette tips.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.purchase_recommendation.status, 'matched');
  assert.equal(state.agentChat.messages[1].meta.inventory_lookup.status, 'matched');
  assert.match(state.agentChat.messages[1].text, /Found 2 purchase recommendations/);
  assert.equal(/Found 1 inventory match/i.test(state.agentChat.messages[1].text), false);
  assert.match(history.innerHTML, /agent-purchase-grid/);
  assert.match(history.innerHTML, /agent-purchase-image-wrap/);
  assert.match(history.innerHTML, /agent-purchase-title">Endotoxin-Free Metal-Free Pipette Tips/);
  assert.match(history.innerHTML, /agent-purchase-price">\$14\.99/);
  assert.match(history.innerHTML, /agent-purchase-vendor">Lab Vendor/);
  assert.doesNotMatch(history.innerHTML, /Purchase Recommendation/);
  assert.doesNotMatch(history.innerHTML, /Purchase Filters/);

  const productButtons = history.querySelectorAll('[data-agent-open-external-url]');
  assert.equal(productButtons.length, 2);
  trigger(history, 'click', { target: productButtons[0] });
  await flushAsync();

  assert.deepEqual(openedUrls, ['https://vendor.example/item-1']);
  assert.equal(status.textContent, 'Opened product page.');
});

  }
};
