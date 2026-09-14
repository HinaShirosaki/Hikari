module.exports = function registerAppAgentChatCoreSuiteRequestFailureHandling(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat replaces the live placeholder with a persisted error response on failure', async () => {
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
      agent: {}
    },
    agentChat: {
      projectId: '',
      messages: []
    }
  };

  const window = {
    hikariApi: {
      onAgentProgress: (handler) => {
        progressHandler = handler;
        return () => {};
      },
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/hikari-data.json'
      }),
      agentChat: async (payload) => {
        payloadSeen = payload;
        return await new Promise((_resolve, reject) => {
          rejectAgentRequest = reject;
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
    stage: 'controller_codex_agent',
    status: 'ok',
    message: 'Routing request to Codex.',
    meta: {}
  });
  assert.match(history.innerHTML, /Routing request to Codex/);

  rejectAgentRequest(new Error('Network timeout'));
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.match(history.innerHTML, /Agent failed: Network timeout/);
  assert.equal(/Working on this/.test(history.innerHTML), false);
  assert.equal(sendBtn.disabled, false);
  assert.equal(status.textContent, 'Error.');
  // The pill ships hidden in the markup, so a status that never unhides it is
  // a status the user never sees.
  assert.equal(status.hidden, false, 'a status message must make the pill visible');
});
  }
};
