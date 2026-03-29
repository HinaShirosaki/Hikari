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

        const indexPath = path.join(tempDir, 'chat_log', 'index.json');
        const index = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
        assert.equal(Array.isArray(index.sessions), true);
        assert.equal(index.sessions[0].id, created.session.id);
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
