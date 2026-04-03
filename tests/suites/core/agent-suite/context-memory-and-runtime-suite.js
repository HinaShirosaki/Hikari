module.exports = function registerAgentContextMemoryAndRuntimeSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('context management runtime builds layered envelopes with prompt blocks and memory candidates', () => {
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T10:00:00.000Z',
            '2026-03-22T10:00:01.000Z',
            '2026-03-22T10:00:02.000Z',
            '2026-03-22T10:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'task-fixed-1'
      });

      runtime.startTask({
        session_id: 'thread-1',
        task_type: 'protocol_notebook',
        intent: 'protocol_to_notebook',
        status: 'needs_more_info',
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload'
        },
        selected_protocol: {
          id: 'prot-1',
          name: 'HEK293 Transfection'
        },
        missing_fields: [
          {
            placeholder_key: 'sample_name',
            display: 'sample name',
            reason: 'The sample label was not provided.'
          }
        ],
        known_values: {
          cell_line: 'HEK293'
        },
        follow_up_questions: ['Which sample name did you use?'],
        goals: ['Finish the notebook draft'],
        constraints: ['Do not invent values']
      });

      runtime.recordToolRound({
        session_id: 'thread-1',
        tool_name: 'protocol-matching',
        summary: 'Selected HEK293 Transfection.',
        result: {
          selected_protocol: {
            id: 'prot-1',
            name: 'HEK293 Transfection'
          }
        }
      });

      const envelope = runtime.buildContextEnvelope({
        session_id: 'thread-1',
        message: 'The sample name was TUBE42.',
        conversation: [
          { role: 'user', text: 'Draft the transfection notebook.' },
          { role: 'assistant', text: 'Which sample name did you use?' },
          { role: 'user', text: 'The sample name was TUBE42.' }
        ],
        tool_outputs: [
          {
            tool_name: 'protocol-matching',
            summary: 'Selected HEK293 Transfection.',
            result: {
              selected_protocol: {
                id: 'prot-1',
                name: 'HEK293 Transfection'
              }
            }
          }
        ],
        long_term_memory: [
          {
            id: 'mem-1',
            category: 'preference',
            key: 'output_format',
            summary: 'Use concise bullet points.',
            value: 'concise bullets'
          }
        ]
      });

      assert.equal(envelope.session_id, 'thread-1');
      assert.equal(envelope.mode, agentContextManagement.CONTEXT_MODES.ACTIVE_TASK);
      assert.equal(envelope.active_task.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(envelope.layers.immediate.current_user_request, 'The sample name was TUBE42.');
      assert.equal(envelope.layers.immediate.recent_conversation.length, 3);
      assert.equal(envelope.layers.session_memory.current_project_state.name, 'Atlas');
      assert.equal(envelope.layers.long_term_memory.length, 1);
      assert.equal(envelope.memory_candidates.some((item) => item.category === 'project_name' && item.key === 'Atlas'), true);
      assert.match(String(envelope.prompt_blocks.immediate || ''), /Immediate working context:/);
      assert.match(String(envelope.prompt_blocks.session_memory || ''), /Session memory summary:/);
      assert.match(String(envelope.prompt_blocks.long_term_memory || ''), /Long-term memory:/);
    });

    test('context management runtime preserves follow-up answers and returns to ready mode after completion', () => {
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T11:00:00.000Z',
            '2026-03-22T11:00:01.000Z',
            '2026-03-22T11:00:02.000Z',
            '2026-03-22T11:00:03.000Z',
            '2026-03-22T11:00:04.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'task-fixed-2'
      });

      runtime.startTask({
        session_id: 'thread-2',
        task_type: 'protocol_notebook',
        intent: 'protocol_to_notebook',
        selected_protocol: {
          id: 'prot-2',
          name: 'Binder Purification'
        },
        missing_fields: [
          {
            key: 'sample_name',
            display: 'sample name',
            reason: 'Still needed.'
          }
        ],
        known_values: {
          operator: 'Shiyifan'
        }
      });
      runtime.recordFollowUpQuestion({
        session_id: 'thread-2',
        question: 'Which sample name did you purify?'
      });
      runtime.recordFollowUpAnswer({
        session_id: 'thread-2',
        answer: 'Sample was Atlas-7.',
        provided_values: {
          sample_name: 'Atlas-7'
        },
        resolved_fields: ['sample_name']
      });

      const activeEnvelope = runtime.buildContextEnvelope({
        session_id: 'thread-2',
        message: 'Sample was Atlas-7.'
      });
      assert.equal(activeEnvelope.mode, agentContextManagement.CONTEXT_MODES.ACTIVE_TASK);
      assert.equal(activeEnvelope.active_task.known_values.sample_name, 'Atlas-7');
      assert.equal(activeEnvelope.active_task.selected_protocol.name, 'Binder Purification');
      assert.equal(activeEnvelope.active_task.missing_fields.some((item) => item.key === 'sample_name'), false);
      assert.equal(activeEnvelope.active_task.follow_up_questions.includes('Which sample name did you purify?'), true);

      runtime.completeTask({
        session_id: 'thread-2',
        status: 'completed',
        completion_summary: 'Notebook draft completed for Atlas-7.'
      });

      const readyEnvelope = runtime.buildContextEnvelope({
        session_id: 'thread-2',
        message: 'Thanks.'
      });
      assert.equal(readyEnvelope.mode, agentContextManagement.CONTEXT_MODES.READY);
      assert.equal(readyEnvelope.active_task, null);
      assert.equal(readyEnvelope.layers.immediate.current_task_state, null);
      assert.equal(readyEnvelope.layers.session_memory.recent_completed_tasks[0].summary, 'Notebook draft completed for Atlas-7.');
    });

    test('context management runtime prunes expired sessions by idle time', () => {
      let currentTime = '2026-03-22T12:00:00.000Z';
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: () => currentTime,
        sessionTtlMs: 1000
      });

      runtime.startTask({
        session_id: 'thread-expire',
        task_type: 'science_loop',
        intent: 'general_science_question'
      });
      currentTime = '2026-03-22T12:00:02.500Z';

      const removed = runtime.pruneExpiredSessions();
      assert.deepEqual(removed, ['thread-expire']);
      assert.equal(runtime.getSession('thread-expire'), null);
    });

    test('memory runtime remembers, updates, recalls, lists, and forgets long-term memory', async () => {
      const runtime = agentMemory.createAgentMemoryRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T13:00:00.000Z',
            '2026-03-22T13:00:01.000Z',
            '2026-03-22T13:00:02.000Z',
            '2026-03-22T13:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'memory-fixed-1'
      });

      const stored = await runtime.execute({
        action: 'remember',
        category: 'preference',
        key: 'output_format',
        summary: 'User prefers concise summaries.',
        value: 'concise',
        tags: ['format']
      });
      assert.equal(stored.ok, true);
      assert.equal(stored.status, 'stored');
      assert.equal(stored.item.id, 'memory-fixed-1');

      const updated = await runtime.execute({
        action: 'remember',
        category: 'preference',
        key: 'output_format',
        summary: 'User prefers concise bullet summaries.',
        value: 'bullet list',
        tags: ['format', 'concise']
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.status, 'updated');
      assert.equal(updated.item.id, 'memory-fixed-1');

      const recalled = await runtime.execute({
        action: 'recall',
        query: 'bullet',
        limit: 5
      });
      assert.equal(recalled.ok, true);
      assert.equal(recalled.status, 'matched');
      assert.equal(recalled.items.length, 1);
      assert.equal(recalled.items[0].summary, 'User prefers concise bullet summaries.');

      const listed = await runtime.execute({
        action: 'list',
        limit: 5
      });
      assert.equal(listed.ok, true);
      assert.equal(listed.items.length, 1);

      const forgotten = await runtime.execute({
        action: 'forget',
        category: 'preference',
        key: 'output_format'
      });
      assert.equal(forgotten.ok, true);
      assert.equal(forgotten.removed_count, 1);

      const missing = await runtime.execute({
        action: 'recall',
        query: 'bullet'
      });
      assert.equal(missing.status, 'empty');
    });

    test('memory runtime persists JSON records when memoryFilePath is provided', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-memory-'));
      const memoryFilePath = path.join(tempDir, 'memory.json');
      try {
        const runtime = agentMemory.createAgentMemoryRuntime({
          memoryFilePath,
          now: (() => {
            let index = 0;
            const values = [
              '2026-03-22T14:00:00.000Z',
              '2026-03-22T14:00:01.000Z'
            ];
            return () => values[Math.min(index++, values.length - 1)];
          })(),
          createId: () => 'memory-file-1'
        });

        await runtime.remember({
          category: 'project_name',
          key: 'Atlas',
          summary: 'Atlas is the current binder optimization project.',
          value: {
            project_id: 'proj-1'
          }
        });

        const raw = JSON.parse(await fsPromises.readFile(memoryFilePath, 'utf8'));
        assert.equal(Array.isArray(raw.items), true);
        assert.equal(raw.items.length, 1);
        assert.equal(raw.items[0].id, 'memory-file-1');

        const secondRuntime = agentMemory.createAgentMemoryRuntime({
          memoryFilePath
        });
        const recalled = await secondRuntime.recall({
          query: 'binder optimization'
        });
        assert.equal(recalled.ok, true);
        assert.equal(recalled.items.length, 1);
        assert.equal(recalled.items[0].key, 'Atlas');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat log runtime creates session files, updates index summaries, and reconstructs renderer messages', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-log-'));
      try {
        const runtime = agentChatLog.createAgentChatLogRuntime({
          now: (() => {
            let index = 0;
            const values = [
              '2026-03-22T15:00:00.000Z',
              '2026-03-22T15:00:01.000Z',
              '2026-03-22T15:00:02.000Z',
              '2026-03-22T15:00:03.000Z'
            ];
            return () => values[Math.min(index++, values.length - 1)];
          })(),
          createId: (() => {
            let index = 0;
            return () => `chat-fixed-${index += 1}`;
          })()
        });

        const created = await runtime.createSession({
          storagePath: tempDir,
          projectId: 'proj-1',
          projectName: 'Atlas'
        });
        assert.equal(created.ok, true);
        assert.equal(created.session.id, 'chat-fixed-1');

        await runtime.appendUserMessage({
          storagePath: tempDir,
          sessionId: created.session.id,
          text: 'Where is the Atlas binder notebook?',
          projectId: 'proj-1',
          projectName: 'Atlas',
          timestamp: '2026-03-22T15:00:01.000Z'
        });

        const assistantMessage = runtime.buildAssistantMessageFromResult({
          result: {
            ok: true,
            parser: {
              primary_intent: 'record_lookup',
              needs_clarification: false,
              reasoning_summary: 'Matched record lookup.'
            },
            record_lookup: {
              status: 'matched',
              query: 'Atlas binder',
              items: [
                {
                  record_type: 'notebook',
                  id: 'note-1',
                  title: 'Atlas Binder Notebook'
                }
              ]
            },
            developer_trace: []
          },
          requestText: 'Where is the Atlas binder notebook?',
          messageId: 'assistant-fixed-1',
          timestamp: '2026-03-22T15:00:02.000Z'
        });

        await runtime.appendRows(tempDir, created.session.id, [
          {
            type: 'agent-chat-request',
            session_id: created.session.id,
            requestId: 'req-1',
            timestamp: '2026-03-22T15:00:01.500Z',
            projectId: 'proj-1',
            projectName: 'Atlas',
            message: 'Where is the Atlas binder notebook?'
          },
          {
            type: 'agent-lifecycle',
            session_id: created.session.id,
            requestId: 'req-1',
            stage: 'parser_completed',
            timestamp: '2026-03-22T15:00:01.700Z'
          },
          {
            type: 'agent-llm-trace',
            session_id: created.session.id,
            requestId: 'req-1',
            stage: 'intent_parser',
            provider: 'openai',
            model: 'gpt-5',
            timestamp: '2026-03-22T15:00:01.800Z',
            request_direction: 'app->llm',
            response_direction: 'llm->app',
            request_payload: { prompt: 'Where is the Atlas binder notebook?' },
            response_payload: { primary_intent: 'record_lookup' }
          },
          {
            type: 'agent-chat-result',
            session_id: created.session.id,
            requestId: 'req-1',
            timestamp: '2026-03-22T15:00:01.900Z',
            response_type: 'record_lookup',
            ok: true
          },
          {
            type: 'assistant-message',
            session_id: created.session.id,
            message_id: assistantMessage.id,
            timestamp: assistantMessage.createdAt,
            text: assistantMessage.text,
            meta: assistantMessage.meta
          }
        ]);

        const listed = await runtime.listSessions({
          storagePath: tempDir
        });
        assert.equal(listed.ok, true);
        assert.equal(listed.items.length, 1);
        assert.equal(listed.items[0].title, 'Where is the Atlas binder notebook?');
        assert.equal(listed.items[0].message_count, 2);
        assert.equal(listed.items[0].request_count, 1);
        assert.equal(listed.items[0].project_name, 'Atlas');

        const loaded = await runtime.getSession({
          storagePath: tempDir,
          sessionId: created.session.id,
          includeRows: true
        });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.messages.length, 2);
        assert.equal(loaded.messages[0].role, 'user');
        assert.equal(loaded.messages[1].role, 'assistant');
        assert.match(String(loaded.messages[1].text || ''), /Found 1 record match/);
        assert.equal(loaded.messages[1].meta.record_lookup.status, 'matched');
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-llm-trace'), true);

        const indexPath = path.join(tempDir, 'chat_log', 'index.json');
        const index = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
        assert.equal(Array.isArray(index.sessions), true);
        assert.equal(index.sessions[0].id, created.session.id);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat handler persists internal request, tool, trace, and response rows into the session log', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-handler-'));
      try {
        const { registerAgentIpc } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-agent-ipc.js'));
        const handlers = new Map();
        const ipcMain = {
          handle(channel, handler) {
            handlers.set(channel, handler);
          }
        };
        const agentLogPath = path.join(tempDir, 'agent-chat.log');
        const chatLogRuntime = agentChatLog.createAgentChatLogRuntime();
        const progressEvents = [];
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-fixed-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T16:00:00.000Z',
              ...entry
            });
          },
          summarizeLlmForAgentLog(llm) {
            return {
              provider: String(llm?.provider || 'openai'),
              model: String(llm?.model || 'gpt-5')
            };
          },
          extractConversation(conversation) {
            return Array.isArray(conversation) ? conversation : [];
          },
          resolveAgentExecutionFlags() {
            return { developerMode: true };
          },
          createAgentLlmTraceContext(input = {}) {
            return {
              enabled: input.enabled === true,
              requestId: String(input.requestId || ''),
              logPath: String(input.logPath || ''),
              provider: String(input.provider || ''),
              model: String(input.model || ''),
              rows: [],
              entries: []
            };
          },
          resolveAgentProvider() {
            return 'openai';
          },
          resolveAgentEndpoint() {
            return 'https://api.example.test';
          },
          resolveAgentModel() {
            return 'gpt-5';
          },
          resolveAgentApiKey() {
            return 'test-key';
          },
          async requestIntentParserPayload(input = {}) {
            input.traceContext?.rows.push({
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parser round completed.',
              timestamp: '2026-03-22T16:00:01.000Z'
            });
            input.traceContext?.entries.push({
              type: 'agent-llm-trace',
              requestId: 'req-fixed-1',
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parser round completed.',
              timestamp: '2026-03-22T16:00:01.000Z',
              request_direction: 'app->llm',
              response_direction: 'llm->app',
              request_payload: { prompt: input.message },
              response_payload: { primary_intent: 'notebook_draft' }
            });
            return {
              ok: true,
              payload: {
                primary_intent: 'notebook_draft',
                needs_clarification: false,
                entities: {},
                protocol_candidates: [],
                reasoning_summary: 'Plan the next notebook draft.'
              }
            };
          },
          summarizeAgentResultForLog(result) {
            return {
              ok: result?.ok === true,
              provider: 'openai',
              model: 'gpt-5',
              response_type: result?.notebook_draft ? 'notebook_draft' : 'intent_parser'
            };
          }
        };
        const protocolNotebookRuntime = {
          buildSessionKey() {
            return 'protocol-session-fixed';
          },
          hasPendingSession() {
            return false;
          },
          clearPendingSession() {},
          setPendingSession() {},
          async runFlow() {
            throw new Error('protocol flow should not run in this test');
          }
        };
        const agentToolRuntime = {
          normalizeAgentSnapshot(snapshot) {
            return snapshot && typeof snapshot === 'object' ? snapshot : {};
          },
          normalizeToolInvocationArgs(args) {
            return args;
          },
          async runAgentTool() {
            return {
              ok: true,
              summary: 'Notebook draft prepared.',
              result: {
                status: 'proposal_ready',
                selected_protocol: {
                  id: 'prot-1',
                  name: 'Atlas Protocol'
                },
                proposal: {
                  proposal_id: 'proposal-1',
                  title: 'Atlas next step',
                  purpose: 'Prepare the next notebook entry.'
                },
                notebook: null
              }
            };
          },
          buildAgentSystemPrompt() {
            return 'system prompt';
          }
        };

        registerAgentIpc({
          ipcMain,
          controllerUtils,
          observability: agentObservability,
          protocolNotebookRuntime,
          scienceReasoningLoopRuntime: {
            async runGeneralScienceQuestion() {
              throw new Error('science runtime should not run in this test');
            },
            async runProjectScienceQuestion() {
              throw new Error('science runtime should not run in this test');
            },
            async runResultAnalysis() {
              throw new Error('science runtime should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser() {
              return {};
            },
            retrieveProjectEvidence() {
              return null;
            }
          },
          agentToolRuntime,
          agentChatLogRuntime: chatLogRuntime,
          agentToolSmokeTestRuntime: {
            async runTool() {
              return { ok: true };
            }
          },
          executeInventoryLookup: async () => ({ status: 'matched', items: [] }),
          executeRecordLookup: async () => ({ status: 'matched', items: [] }),
          getAgentChatLogPath: () => agentLogPath,
          getAgentChatSessionStoragePath: () => tempDir,
          appendAgentChatLogEntry: async (logPath, entry) => {
            await agentObservability.appendLogWithRotation({ logPath, entry });
          },
          normalizeJsonPayload: (value) => value,
          cleanText: (value, maxLength = 2000) => {
            const text = String(value || '').trim();
            if (!text) {
              return '';
            }
            return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
          },
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          },
          getDefaultDataFilePath: () => ''
        });

        const handler = handlers.get('agent:chat');
        assert.equal(typeof handler, 'function');

        const result = await handler({
          sender: {
            send(channel, payload) {
              if (channel === 'agent-progress') {
                progressEvents.push(payload);
              }
            }
          }
        }, {
          clientRequestId: 'client-fixed-1',
          message: 'Plan the next Atlas notebook step.',
          projectId: 'proj-1',
          projectName: 'Atlas',
          chatSessionId: 'session-fixed-1',
          llm: {
            provider: 'openai',
            model: 'gpt-5'
          },
          agent: {
            developerMode: true
          },
          stateSnapshot: {
            settings: {
              agent: {
                developerMode: true
              }
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.chat_session.id, 'session-fixed-1');
        assert.equal(result.request_id, 'req-fixed-1');
        assert.equal(result.client_request_id, 'client-fixed-1');
        assert.equal(progressEvents.length > 0, true);
        assert.equal(progressEvents.every((item) => item.request_id === 'req-fixed-1'), true);
        assert.equal(progressEvents.every((item) => item.client_request_id === 'client-fixed-1'), true);
        assert.equal(progressEvents.every((item) => item.chat_session_id === 'session-fixed-1'), true);
        assert.equal(progressEvents.some((item) => item.stage === 'parser_completed'), true);
        assert.equal(progressEvents.some((item) => item.stage === 'tool_call_started' && item.tool_name === 'notebook-draft'), true);

        const loaded = await chatLogRuntime.getSession({
          storagePath: tempDir,
          sessionId: 'session-fixed-1',
          includeRows: true
        });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-chat-request'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle' && row.stage === 'tool_call_started'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-lifecycle' && row.stage === 'tool_call_completed'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-llm-trace'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'agent-chat-result'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'user-message' && row.direction === 'user->llm'), true);
        assert.equal(loaded.rows.some((row) => row.type === 'assistant-message' && row.direction === 'llm->user'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent observability lifecycle recorder invokes onEvent immediately with normalized events', () => {
      const seen = [];
      const recorder = agentObservability.createLifecycleRecorder({
        requestId: 'req-observe-1',
        onEvent: (event) => {
          seen.push(event);
        }
      });

      const recorded = agentObservability.recordLifecycleEvent(recorder, {
        stage: 'science_round_started',
        status: 'started',
        routing_intent: 'general_science_question',
        tool_name: 'literature-search',
        message: 'Science reasoning round 1 started with literature-search.',
        meta: {
          round: 1
        }
      });

      assert.equal(recorder.events.length, 1);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0], recorded);
      assert.equal(seen[0].requestId, 'req-observe-1');
      assert.equal(seen[0].stage, 'science_round_started');
      assert.equal(seen[0].meta.round, 1);
    });

    test('agent chat handler uses the parser-direct science answer for reasoning_effort 0', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-direct-science-'));
      try {
        const { registerAgentIpc } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-agent-ipc.js'));
        const handlers = new Map();
        const ipcMain = {
          handle(channel, handler) {
            handlers.set(channel, handler);
          }
        };
        const agentLogPath = path.join(tempDir, 'agent-chat.log');
        const chatLogRuntime = agentChatLog.createAgentChatLogRuntime();
        let retrieveProjectEvidenceCalls = 0;
        let scienceRuntimeCalls = 0;
        let buildAgentSystemPromptCalls = 0;
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-direct-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T17:00:00.000Z',
              ...entry
            });
          },
          summarizeLlmForAgentLog(llm) {
            return {
              provider: String(llm?.provider || 'openai'),
              model: String(llm?.model || 'gpt-5')
            };
          },
          extractConversation(conversation) {
            return Array.isArray(conversation) ? conversation : [];
          },
          resolveAgentExecutionFlags() {
            return { developerMode: false };
          },
          createAgentLlmTraceContext(input = {}) {
            return {
              enabled: input.enabled === true,
              requestId: String(input.requestId || ''),
              logPath: String(input.logPath || ''),
              provider: String(input.provider || ''),
              model: String(input.model || ''),
              rows: [],
              entries: []
            };
          },
          resolveAgentProvider() {
            return 'openai';
          },
          resolveAgentEndpoint() {
            return 'https://api.example.test';
          },
          resolveAgentModel() {
            return 'gpt-5';
          },
          resolveAgentApiKey() {
            return 'test-key';
          },
          async requestIntentParserPayload() {
            return {
              ok: true,
              payload: {
                primary_intent: 'project_science_question',
                reasoning_effort: 0,
                direct_answer: 'A likely cause is transient transfection stress combined with plasmid quality loss, so expression drops after delivery.',
                needs_clarification: false,
                clarification_reason: null,
                entities: {
                  project: 'Atlas'
                },
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: [],
                reasoning_summary: 'Direct project-science answer.'
              }
            };
          },
          summarizeAgentResultForLog(result) {
            return {
              ok: result?.ok === true,
              parser: result?.parser || {},
              response_type: result?.project_science_question ? 'project_science_question' : 'intent_parser'
            };
          }
        };
        const protocolNotebookRuntime = {
          buildSessionKey() {
            return 'protocol-session-direct';
          },
          hasPendingSession() {
            return false;
          },
          clearPendingSession() {},
          setPendingSession() {},
          async runFlow() {
            throw new Error('protocol flow should not run in this test');
          }
        };
        const agentToolRuntime = {
          normalizeAgentSnapshot(snapshot) {
            return snapshot && typeof snapshot === 'object' ? snapshot : {};
          },
          normalizeToolInvocationArgs(args) {
            return args;
          },
          async runAgentTool() {
            throw new Error('tools should not run for parser-direct science answers');
          },
          buildAgentSystemPrompt() {
            buildAgentSystemPromptCalls += 1;
            throw new Error('system prompt builder should not run for parser-direct science answers');
          }
        };

        registerAgentIpc({
          ipcMain,
          controllerUtils,
          observability: agentObservability,
          protocolNotebookRuntime,
          scienceReasoningLoopRuntime: {
            async runGeneralScienceQuestion() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            },
            async runProjectScienceQuestion() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            },
            async runResultAnalysis() {
              scienceRuntimeCalls += 1;
              throw new Error('science runtime should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser() {
              return {
                intent: 'project_science_question',
                confidence: 0.64,
                entities: {
                  project: 'Atlas'
                },
                plan: {
                  reasoning_effort: 0
                },
                classifier: {
                  reasoning_effort: 0
                }
              };
            },
            retrieveProjectEvidence() {
              retrieveProjectEvidenceCalls += 1;
              throw new Error('project evidence lookup should not run for parser-direct science answers');
            }
          },
          agentToolRuntime,
          agentChatLogRuntime: chatLogRuntime,
          agentToolSmokeTestRuntime: {
            async runTool() {
              return { ok: true };
            }
          },
          executeInventoryLookup: async () => ({ status: 'matched', items: [] }),
          executeRecordLookup: async () => ({ status: 'matched', items: [] }),
          getAgentChatLogPath: () => agentLogPath,
          getAgentChatSessionStoragePath: () => tempDir,
          appendAgentChatLogEntry: async (logPath, entry) => {
            await agentObservability.appendLogWithRotation({ logPath, entry });
          },
          cleanText: (value, maxLength = 2000) => {
            const text = String(value || '').trim();
            if (!text) {
              return '';
            }
            return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
          },
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          },
          getDefaultDataFilePath: () => ''
        });

        const handler = handlers.get('agent:chat');
        assert.equal(typeof handler, 'function');

        const result = await handler(null, {
          message: 'Why did the Atlas binder lose expression after transfection?',
          projectName: 'Atlas',
          llm: {
            provider: 'openai',
            model: 'gpt-5'
          },
          stateSnapshot: {
            settings: {
              agent: {
                developerMode: false
              }
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.project_science_question.execution_mode, 'intent_parser');
        assert.equal(result.project_science_question.rounds_executed, 0);
        assert.equal(result.project_science_question.reasoning_effort, 0);
        assert.match(String(result.project_science_question.answer || ''), /transfection stress/i);
        assert.equal(retrieveProjectEvidenceCalls, 0);
        assert.equal(scienceRuntimeCalls, 0);
        assert.equal(buildAgentSystemPromptCalls, 0);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat log runtime builds fallback assistant message for controller errors', () => {
      const runtime = agentChatLog.createAgentChatLogRuntime();
      const assistantMessage = runtime.buildAssistantMessageFromError({
        errorMessage: 'Provider timeout.',
        requestText: 'Analyze the latest assay.'
      });

      assert.equal(assistantMessage.role, 'assistant');
      assert.match(String(assistantMessage.text || ''), /Provider timeout/);
      assert.equal(assistantMessage.meta.parser.needs_clarification, true);
      assert.equal(assistantMessage.meta.parser.clarification_reason, 'agent_error');
      assert.equal(assistantMessage.meta.requestText, 'Analyze the latest assay.');
    });

    test('agent tool smoke-test runtime manually exercises every registered tool', async () => {
      const runtime = agentToolSmokeTest.createAgentToolSmokeTestRuntime();
      const result = await runtime.runAllTools();

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.tool_count, runtime.toolNames.length);
      assert.equal(result.failed_count, 0);
      assert.equal(result.passed_count, result.tool_count);
      assert.deepEqual(result.items.map((item) => item.tool_name), runtime.toolNames);
      assert.equal(result.items.every((item) => item.ok === true), true);
      assert.equal(result.items.every((item) => Number.isFinite(Number(item.duration_ms))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'notebook-draft' && /Viability Assay/i.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'python-sandbox' && /out\.json/.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'paper-download' && /\.pdf/i.test(String(item.preview || ''))), true);
      assert.match(String(result.summary || ''), /tools passed/i);
    });

    test('agent tool smoke-test runtime supports single-tool manual messages with inspectable raw output', async () => {
      const runtime = agentToolSmokeTest.createAgentToolSmokeTestRuntime();
      const result = await runtime.runTool({
        toolName: 'python-sandbox',
        message: 'Write a JSON file noting this manual tool test.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.run_mode, 'single');
      assert.equal(result.status, 'completed');
      assert.equal(result.tool_count, 1);
      assert.equal(result.passed_count, 1);
      assert.equal(result.failed_count, 0);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].tool_name, 'python-sandbox');
      assert.equal(result.items[0].request_message, 'Write a JSON file noting this manual tool test.');
      assert.equal(typeof result.items[0].raw_result, 'object');
      assert.match(JSON.stringify(result.items[0].raw_result || {}), /manual tool test/i);
      assert.match(String(result.summary || ''), /python-sandbox/i);
    });

    test('agent observability replays lifecycle and llm traces in order', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-observability-'));
      const logPath = path.join(tempDir, 'agent-chat.log');
      try {
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-request',
            requestId: 'req-1',
            timestamp: '2026-03-21T10:00:00.000Z',
            message: 'Do we have PEI?'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-lifecycle',
            requestId: 'req-1',
            stage: 'parser_completed',
            status: 'ok',
            timestamp: '2026-03-21T10:00:01.000Z'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-llm-trace',
            requestId: 'req-1',
            stage: 'intent_parser',
            provider: 'openai',
            model: 'gpt-5',
            summary: 'Intent parsed.',
            timestamp: '2026-03-21T10:00:02.000Z',
            request_payload: { prompt: '...' },
            response_payload: { primary_intent: 'inventory_lookup' }
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-result',
            requestId: 'req-1',
            ok: true,
            parser: { primary_intent: 'inventory_lookup' },
            timestamp: '2026-03-21T10:00:03.000Z'
          })
        });

        const replay = await agentObservability.replayRequestLifecycle({
          requestId: 'req-1',
          logPath
        });
        assert.equal(replay.ok, true);
        assert.equal(Array.isArray(replay.events), true);
        assert.equal(Array.isArray(replay.traces), true);
        assert.equal(replay.events.length, 1);
        assert.equal(replay.traces.length, 1);
        assert.equal(replay.traces[0].stage, 'intent_parser');
        assert.equal(Array.isArray(replay.summary.trace_stages), true);
        assert.equal(replay.summary.trace_stages.includes('intent_parser'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('python sandbox executes deterministic readback payload and emits lifecycle callbacks', async () => {
      const lifecycle = {
        started: 0,
        heartbeats: 0,
        completed: 0
      };
      const result = await agentPython.runPythonSandbox({
        code: [
          'import json',
          'import time',
          'open("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42}))',
          'print("sandbox-start")',
          'time.sleep(0.15)',
          'print("sandbox-end")'
        ].join('\n'),
        readback_paths: ['out.json'],
        timeout_ms: 4000
      }, {
        heartbeatIntervalMs: 25,
        onTaskStarted: async ({ process_id }) => {
          lifecycle.started += 1;
          assert.equal(Number(process_id) > 0, true);
        },
        onHeartbeat: async ({ elapsed_ms }) => {
          lifecycle.heartbeats += 1;
          assert.equal(Number.isFinite(Number(elapsed_ms)), true);
        },
        onTaskCompleted: async ({ process_id, exit_code }) => {
          lifecycle.completed += 1;
          assert.equal(Number(process_id) > 0, true);
          assert.equal(exit_code, 0);
        }
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, 'ok');
      assert.equal(Array.isArray(result.readback_files), true);
      assert.equal(result.readback_files.length, 1);
      assert.match(String(result.readback_files[0].content || ''), /"value": 42/);
      assert.equal(Number(result.process_id) > 0, true);
      assert.equal(lifecycle.started, 1);
      assert.equal(lifecycle.completed, 1);
      assert.equal(lifecycle.heartbeats >= 1, true);
    });

    test('managed python sandbox runtime supervises runs with sub-agents and sends failures for debugging', async () => {
      const runtime = agentPython.createManagedPythonSandboxRuntime();

      const success = await runtime.execute({
        code: 'print(42)',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        name: 'python-success'
      });
      assert.equal(success.ok, true);
      assert.equal(success.sandbox.ok, true);
      assert.equal(typeof success.sub_agent?.id, 'string');
      assert.equal(success.sub_agent?.task?.state, 'completed');
      assert.equal(success.sub_agent?.liveness?.state, 'idle');
      assert.equal(Number(success.sandbox.process_id) > 0, true);

      const failure = await runtime.execute({
        code: 'import module_that_does_not_exist_anywhere',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        name: 'python-failure'
      });
      assert.equal(failure.ok, false);
      assert.equal(failure.sandbox.ok, false);
      assert.equal(failure.sub_agent?.task?.state, 'failed');
      assert.equal(failure.sub_agent?.liveness?.state, 'idle');
      assert.match(String(failure.debug?.assistant_message || ''), /Suggested next step/i);
      assert.match(String(failure.debug?.assistant_message || ''), /standard library|vendor/i);
    });

  }
};
