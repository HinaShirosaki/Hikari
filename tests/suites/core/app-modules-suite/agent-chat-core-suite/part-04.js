module.exports = function registerAppAgentChatCoreSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat shows live progress ephemerally in the chat history and locks session switching until success', async () => {
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
    routing_intent: 'codex_agent',
    stage: 'codex_agent_stream',
    status: 'streaming',
    message: 'Partial Codex answer',
    meta: {
      stream_text: 'Partial Codex answer'
    }
  });
  assert.match(history.innerHTML, /Partial Codex answer/);
  assert.match(status.textContent, /Partial Codex answer/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'codex_agent',
    stage: 'codex_agent_thinking',
    status: 'streaming',
    message: 'Checking project context.',
    meta: {
      thinking_trace: 'Checking project context.'
    }
  });
  assert.match(history.innerHTML, /Checking project context/);
  assert.match(history.innerHTML, /<div class="agent-thinking-trace agent-generated-trace-live" aria-label="Agent Trace">/);
  assert.doesNotMatch(history.innerHTML, /Thinking Trace/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'codex_agent',
    stage: 'tool_call_started',
    status: 'started',
    tool_name: 'inventory_lookup',
    message: 'inventory_lookup: {"query":"yield"}',
    meta: {
      tool_call_text: 'inventory_lookup: {"query":"yield"}'
    }
  });
  assert.match(history.innerHTML, /inventory_lookup: \{&quot;query&quot;:&quot;yield&quot;\}/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'codex_agent',
    stage: 'codex_cli_display',
    status: 'streaming',
    message: 'Reading paper.md...',
    meta: {
      codex_display_text: 'Reading paper.md...',
      codex_display_kind: 'tool'
    }
  });
  assert.doesNotMatch(history.innerHTML, /Codex CLI/);
  assert.match(history.innerHTML, /Reading paper\.md/);
  assert.match(history.innerHTML, /<div class="agent-thinking-trace agent-generated-trace-live" aria-label="Agent Trace">/);
  assert.doesNotMatch(history.innerHTML, /\{&quot;cmd&quot;:/);

  progressHandler({
    client_request_id: payloadSeen.clientRequestId,
    request_id: 'req-live-1',
    chat_session_id: 'chat-2',
    routing_intent: 'codex_agent',
    stage: 'codex_cli_display',
    status: 'streaming',
    message: '# Hikari Codex Chat Turn\n\nInternal prompt text should stay hidden.',
    meta: {
      codex_display_text: '# Hikari Codex Chat Turn\n\nInternal prompt text should stay hidden.',
      codex_display_kind: 'assistant',
      codex_event_type: 'user_message'
    }
  });
  assert.doesNotMatch(history.innerHTML, /Hikari Codex Chat Turn/);
  assert.doesNotMatch(history.innerHTML, /Internal prompt text should stay hidden/);

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
  assert.doesNotMatch(history.innerHTML, /Thinking Trace/);
  assert.match(history.innerHTML, /<div class="agent-thinking-trace agent-generated-trace-live" aria-label="Agent Trace">/);

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
    thinking_trace: {
      intent_parse_question: 'This is a general science question.',
      question_clarifier: 'I am clarifying the exact question before I search for evidence.',
      criteria_generate: 'I am defining what evidence would be enough to answer safely.',
      tool_rounds: [
        {
          round: 1,
          tool_selection: 'I am choosing the most targeted literature step first.',
          tool_call: 'I want to use literature-search to investigate "yield drop causes".',
          tool_results: 'Based on the tool result, it seems I have enough evidence to answer.'
        }
      ],
      pre_synthesize_answer: 'Based on the evidence so far, low expression or purification loss are likely causes.',
      judge: 'I am checking whether the current evidence is sufficient.',
      final_synthesize: 'I am synthesizing the final grounded answer from the evidence collected so far.',
      final_synthesized_question: 'Why did the yield drop?'
    },
    developer_trace: []
  });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.match(history.innerHTML, /Literature-backed answer/);
  assert.match(history.innerHTML, /I want to use literature-search to investigate &quot;yield drop causes&quot;/);
  assert.match(history.innerHTML, /<details[\s\S]*class="agent-thinking-trace"[\s\S]*aria-label="Agent Trace"/);
  assert.match(history.innerHTML, /data-agent-generated-trace="true"/);
  assert.match(history.innerHTML, /data-agent-trace-open="false"/);
  assert.doesNotMatch(history.innerHTML, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(history.innerHTML, /Codex CLI/);
  assert.doesNotMatch(history.innerHTML, /Reading paper\.md/);
  assert.doesNotMatch(history.innerHTML, /<details class="agent-thinking-trace" aria-label="Codex CLI">/);
  assert.equal(
    history.innerHTML.indexOf('Literature-backed answer.')
      < history.innerHTML.indexOf('Agent Trace'),
    true
  );
  assert.equal(/Working on this/.test(history.innerHTML), false);
  assert.equal(sendBtn.disabled, false);
  assert.equal(newChatBtn.disabled, false);
  assert.equal(status.textContent, 'Complete.');
});
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
  }
};