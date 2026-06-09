module.exports = function registerAppAgentChatSessionsAndToolsSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
    hikariApi: {
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
    hikariApi: {
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
    hikariApi: {
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
  }
};