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
      assert.equal(envelope.registry.user.latest_user_message, 'The sample name was TUBE42.');
      assert.equal(envelope.registry.user.follow_up_questions.includes('Which sample name did you use?'), true);
      assert.equal(envelope.registry.execution.tool_outputs[0].tool_name, 'protocol-matching');
      assert.equal(envelope.registry.memory.long_term_memory[0].key, 'output_format');
      assert.equal(envelope.registry.system.active_task.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(envelope.registry_selection.user.current_user_request, 'The sample name was TUBE42.');
      assert.equal(envelope.registry_selection.system.active_task.project.name, 'Atlas');
      assert.equal(envelope.memory_candidates.some((item) => item.category === 'project_name' && item.key === 'Atlas'), true);
      assert.match(String(envelope.prompt_blocks.immediate || ''), /Immediate working context:/);
      assert.match(String(envelope.prompt_blocks.immediate || ''), /Latest tool outputs:\n- protocol-matching \(ok\) \| summary: Selected HEK293 Transfection\./);
      assert.equal(/Current task state JSON:/.test(String(envelope.prompt_blocks.immediate || '')), false);
      assert.match(String(envelope.prompt_blocks.immediate || ''), /Task summary:/);
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
      assert.equal(readyEnvelope.registry.system.active_task, null);
      assert.equal(readyEnvelope.registry.memory.recent_completed_tasks[0].summary, 'Notebook draft completed for Atlas-7.');
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

    test('context management runtime assembles layers from registry-first clarified and verification state', () => {
      const runtime = agentContextManagement.createAgentContextManagementRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T12:30:00.000Z',
            '2026-03-22T12:30:01.000Z',
            '2026-03-22T12:30:02.000Z',
            '2026-03-22T12:30:03.000Z',
            '2026-03-22T12:30:04.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'task-fixed-3'
      });

      runtime.startTask({
        session_id: 'thread-3',
        task_type: 'science_loop',
        intent: 'project_science_question',
        project: {
          id: 'proj-3',
          name: 'Atlas'
        }
      });

      const registrySnapshot = runtime.buildContextRegistry({
        session_id: 'thread-3',
        message: 'Can you compare the two Atlas runs?',
        clarified_user_message: 'Compare Atlas run 7 versus Atlas run 8 and explain the largest difference.',
        conversation: [
          { role: 'user', text: 'Can you compare the two Atlas runs?' },
          { role: 'assistant', text: 'Which runs do you mean?' },
          { role: 'user', text: 'Runs 7 and 8.' }
        ],
        inference_feedback: [
          {
            kind: 'inference',
            summary: 'The comparison still needs one direct delta across both runs.'
          }
        ],
        evaluation_feedback: [
          {
            kind: 'judge',
            summary: 'Fetch both runs before answering.'
          }
        ],
        skills: ['record-lookup'],
        workflow_state: {
          stage: 'comparison'
        }
      });

      assert.equal(registrySnapshot.registry.user.clarified_user_message, 'Compare Atlas run 7 versus Atlas run 8 and explain the largest difference.');
      assert.equal(registrySnapshot.registry.reasoning.inference_feedback[0].summary, 'The comparison still needs one direct delta across both runs.');
      assert.equal(registrySnapshot.registry.system.workflow_state.stage, 'comparison');

      const envelope = runtime.buildContextEnvelope({
        session_id: 'thread-3'
      });

      assert.equal(envelope.layers.immediate.current_user_request, 'Compare Atlas run 7 versus Atlas run 8 and explain the largest difference.');
      assert.equal(envelope.registry_selection.reasoning.evaluation_feedback[0].summary, 'Fetch both runs before answering.');
      assert.equal(envelope.registry_selection.system.skills.includes('record-lookup'), true);
      assert.match(String(envelope.prompt_blocks.verification || ''), /Verification feedback:/);
      assert.match(String(envelope.prompt_blocks.verification || ''), /Fetch both runs before answering\./);
      assert.match(String(envelope.prompt_blocks.session_memory || ''), /Skills: record-lookup/);
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
          })(),
          requestAssistantText: async () => ({
            ok: true,
            text: 'Locate Atlas binder notebook'
          })
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
          llm: {
            provider: 'openai',
            endpoint: 'https://api.openai.com/v1/responses',
            apiKey: 'sk-local-key',
            model: 'gpt-5'
          },
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
                  title: 'Atlas Binder Notebook',
                  project_name: 'Atlas',
                  linked_protocol_name: 'Binder Purification'
                }
              ]
            },
            thinking_trace: {
              intent_parse_question: 'This is a record lookup request.',
              question_clarifier: 'I am narrowing the lookup to the Atlas binder notebook.',
              criteria_generate: 'I am checking whether one clear record match is enough.',
              tool_rounds: [
                {
                  round: 1,
                  tool_selection: 'I am choosing record lookup first.',
                  tool_call: 'I want to use record-lookup to investigate "Atlas binder".',
                  tool_results: 'Based on the tool result, it seems I found the notebook entry.'
                }
              ],
              pre_synthesize_answer: 'Based on the evidence so far, the Atlas Binder Notebook is the likely match.',
              judge: 'I have enough evidence to answer with one record match.',
              final_synthesize: 'I am summarizing the matched record for the user.',
              final_synthesized_question: 'Where is the Atlas binder notebook?'
            },
            developer_trace: []
          },
          requestText: 'Where is the Atlas binder notebook?',
          messageId: 'assistant-fixed-1',
          timestamp: '2026-03-22T15:00:02.000Z'
        });
        assert.match(assistantMessage.text, /Found 1 record match/);
        assert.match(assistantMessage.text, /notebook: Atlas Binder Notebook/i);
        assert.match(assistantMessage.text, /project Atlas/i);
        assert.match(assistantMessage.text, /protocol Binder Purification/i);
        assert.equal(assistantMessage.meta.thinking_trace.final_synthesized_question, 'Where is the Atlas binder notebook?');

        const inventoryAssistantMessage = runtime.buildAssistantMessageFromResult({
          result: {
            ok: true,
            parser: {
              primary_intent: 'inventory_lookup',
              needs_clarification: false,
              reasoning_summary: 'Matched inventory lookup.'
            },
            inventory_lookup: {
              status: 'matched',
              query: 'acetic acid',
              items: [
                {
                  kind: 'chemical',
                  id: 'chem-1',
                  name: 'Acetic acid',
                  location: 'Shelf 4',
                  amount: '500 mL',
                  supplier: 'Sigma'
                }
              ]
            },
            developer_trace: []
          },
          requestText: 'Do we have acetic acid?',
          messageId: 'assistant-fixed-2',
          timestamp: '2026-03-22T15:00:02.500Z'
        });
        assert.match(inventoryAssistantMessage.text, /Found 1 inventory match/);
        assert.match(inventoryAssistantMessage.text, /Acetic acid/i);
        assert.match(inventoryAssistantMessage.text, /location Shelf 4/i);
        assert.match(inventoryAssistantMessage.text, /amount 500 mL/i);

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
        assert.equal(listed.items[0].title, 'Locate Atlas binder notebook');
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

    test('shared agent cleanText keeps long strings intact', () => {
      const { defaultCleanText } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-utils.js'
      ));
      const longText = 'full-text-'.repeat(800);
      assert.equal(defaultCleanText(longText, 40), longText);
    });

    test('agent chat log runtime preserves long assistant text without truncation', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-log-long-text-'));
      try {
        const runtime = agentChatLog.createAgentChatLogRuntime({
          now: () => '2026-03-22T15:30:00.000Z',
          createId: (() => {
            let index = 0;
            return () => `chat-long-${index += 1}`;
          })()
        });

        const created = await runtime.createSession({
          storagePath: tempDir,
          projectId: 'proj-long',
          projectName: 'Longform'
        });
        const longAnswer = 'assistant-evidence-block-'.repeat(1600);

        await runtime.appendAssistantMessage({
          storagePath: tempDir,
          sessionId: created.session.id,
          text: longAnswer,
          timestamp: '2026-03-22T15:30:00.000Z'
        });

        const loaded = await runtime.getSession({
          storagePath: tempDir,
          sessionId: created.session.id,
          includeRows: true
        });
        assert.equal(loaded.ok, true);
        assert.equal(loaded.messages.length, 1);
        assert.equal(loaded.messages[0].text, longAnswer);
        const assistantRow = loaded.rows.find((row) => row.type === 'assistant-message');
        assert.ok(assistantRow);
        assert.equal(assistantRow.text, longAnswer);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('agent chat log runtime preserves transform status entries in chat_log/index.json', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-log-transform-index-'));
      try {
        const chatLogDir = path.join(tempDir, 'chat_log');
        await fsPromises.mkdir(chatLogDir, { recursive: true });
        await fsPromises.writeFile(path.join(chatLogDir, 'index.json'), JSON.stringify({
          version: 1,
          updated_at: '2026-03-22T15:40:00.000Z',
          sessions: [],
          transforms: {
            updated_at: '2026-03-22T15:39:59.000Z',
            output_folder: 'transformed',
            files: {
              'chat-existing.log': {
                source_file: 'chat-existing.log',
                output_file: 'transformed/chat-existing.json',
                status: 'complete',
                source_mtime_ms: 1234,
                source_size: 5678,
                source_line_count: 9,
                trace_count: 3,
                transformed_at: '2026-03-22T15:39:59.000Z',
                error: ''
              }
            }
          }
        }, null, 2), 'utf8');

        const runtime = agentChatLog.createAgentChatLogRuntime({
          now: () => '2026-03-22T15:40:01.000Z',
          createId: () => 'chat-transform-1'
        });

        await runtime.createSession({
          storagePath: tempDir,
          projectId: 'proj-transform',
          projectName: 'Transform Test'
        });

        const index = JSON.parse(await fsPromises.readFile(path.join(chatLogDir, 'index.json'), 'utf8'));
        assert.equal(index.sessions.length, 1);
        assert.equal(index.transforms.output_folder, 'transformed');
        assert.equal(index.transforms.files['chat-existing.log'].status, 'complete');
        assert.equal(index.transforms.files['chat-existing.log'].output_file, 'transformed/chat-existing.json');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('chat log transformer writes condensed system prompt, context, and response files', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'chat-log-transformer-'));
      try {
        const { createChatLogTransformRuntime } = require(path.join(
          __dirname,
          'src',
          'main',
          'helpers',
          'main',
          'chat-log-transformer.js'
        ));
        const runtime = createChatLogTransformRuntime({
          now: () => '2026-03-22T16:10:00.000Z'
        });
        const chatLogDir = path.join(tempDir, 'chat_log');
        await fsPromises.mkdir(chatLogDir, { recursive: true });
        const sampleLogName = 'chat-mnwm38jq-9i28kt9x.log';
        await fsPromises.copyFile(
          path.join(__dirname, 'Testdata', 'chat_log', sampleLogName),
          path.join(chatLogDir, sampleLogName)
        );

        const result = await runtime.scanStoragePath(tempDir);
        assert.equal(result.ok, true);
        assert.equal(result.transformed_count, 1);

        const transformedPath = path.join(chatLogDir, 'transformed', 'chat-mnwm38jq-9i28kt9x.json');
        const transformed = JSON.parse(await fsPromises.readFile(transformedPath, 'utf8'));
        assert.equal(transformed.source_log_file, sampleLogName);
        assert.equal(Array.isArray(transformed.entries), true);
        assert.equal(transformed.entries.length > 0, true);
        assert.equal(
          transformed.entries.some((entry) => /User message:/i.test(String(entry.context || ''))),
          true
        );
        assert.equal(
          transformed.entries.some((entry) => /Write a grounded final science answer/i.test(String(entry.system_prompt || ''))),
          true
        );
        assert.equal(
          transformed.entries.some((entry) => /genetic code expansion/i.test(String(entry.response || ''))),
          true
        );

        const index = JSON.parse(await fsPromises.readFile(path.join(chatLogDir, 'index.json'), 'utf8'));
        assert.equal(index.transforms.output_folder, 'transformed');
        assert.equal(index.transforms.files[sampleLogName].status, 'complete');
        assert.equal(index.transforms.files[sampleLogName].output_file, 'transformed/chat-mnwm38jq-9i28kt9x.json');
        assert.equal(index.transforms.files[sampleLogName].trace_count > 0, true);
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

    test('lifecycle tool runner forwards request context into tool execution', async () => {
      const { createAgentLifecycleService } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-agent-ipc', 'agent-lifecycle-service.js'));
      let receivedCall = null;
      const lifecycleService = createAgentLifecycleService({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          if (!text) {
            return '';
          }
          return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        controllerUtils: {},
        appendAgentChatLogEntry: async () => {},
        agentToolRuntime: {
          normalizeToolInvocationArgs(args) {
            return args;
          },
          async runAgentTool(toolName, args, snapshot, options) {
            receivedCall = {
              toolName,
              args,
              snapshot,
              options
            };
            return {
              ok: true,
              summary: 'Tracked tool executed.',
              result: {
                status: 'matched',
                items: []
              }
            };
          }
        }
      });

      const runTrackedTool = lifecycleService.createLifecycleToolRunner({
        snapshot: {
          data_file_path: '/tmp/agent-data.json'
        },
        allowWriteTools: false,
        lifecycleRecorder: {
          requestId: 'req-lifecycle-1'
        },
        provider: 'codex',
        endpoint: 'codex://cli',
        apiKey: '',
        model: 'gpt-5.4-mini',
        message: 'Find endotoxin-free pipette tips to buy.',
        conversation: [
          { role: 'user', text: 'Find endotoxin-free pipette tips to buy.' }
        ],
        parserPayload: {
          primary_intent: 'purchase_recommendation',
          entities: {
            product_query: 'pipette tips'
          }
        },
        traceContext: {
          trace_id: 'trace-1'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });

      await runTrackedTool('purchase-recommendation', {
        query: 'pipette tips'
      }, {
        allowWriteTools: false
      });

      assert.equal(receivedCall.toolName, 'purchase-recommendation');
      assert.equal(receivedCall.args.query, 'pipette tips');
      assert.equal(receivedCall.snapshot.data_file_path, '/tmp/agent-data.json');
      assert.equal(receivedCall.options.message, 'Find endotoxin-free pipette tips to buy.');
      assert.equal(receivedCall.options.conversation.length, 1);
      assert.equal(receivedCall.options.parserPayload.entities.product_query, 'pipette tips');
      assert.equal(receivedCall.options.project.name, 'Atlas');
      assert.equal(receivedCall.options.requestId, 'req-lifecycle-1');
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

    test('selected project upgrades general science parsing into project science execution', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-project-scope-'));
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
        let routedParserPayload = null;
        let receivedScienceInput = null;
        const controllerUtils = {
          buildAgentLogRequestId: () => 'req-project-scope-1',
          formatAgentChatLogEntry(entry) {
            return JSON.stringify({
              timestamp: entry?.timestamp || '2026-03-22T17:10:00.000Z',
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
                primary_intent: 'general_science_question',
                reasoning_effort: 1,
                direct_answer: null,
                needs_clarification: true,
                clarification_reason: 'Please tell me which project should I use for this analysis.',
                entities: {},
                inventory_search: {
                  normalized_query: null,
                  candidate_terms: [],
                  aliases: [],
                  search_mode: null
                },
                protocol_candidates: [],
                reasoning_summary: 'Parser classified this as a general science question.'
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
            return 'protocol-session-project-scope';
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
            throw new Error('tools should not run in this science routing test');
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
              throw new Error('general science runtime should not run when a project is selected');
            },
            async runProjectScienceQuestion(input) {
              receivedScienceInput = input;
              return {
                status: 'completed',
                answer: 'Atlas-specific science answer.',
                rounds_executed: 1,
                citations: []
              };
            },
            async runResultAnalysis() {
              throw new Error('result analysis should not run in this test');
            }
          },
          deepResearchRuntime: null,
          scienceMainUtils: {
            buildScienceRoutingFromParser(parserPayload = {}) {
              routedParserPayload = parserPayload;
              return {
                intent: String(parserPayload.primary_intent || ''),
                confidence: parserPayload.needs_clarification === true ? 0.35 : 0.64,
                entities: parserPayload.entities || {},
                plan: {
                  reasoning_effort: Number(parserPayload.reasoning_effort || 1),
                  needs_clarification: parserPayload.needs_clarification === true,
                  clarification_reason: String(parserPayload.clarification_reason || '')
                },
                classifier: {
                  reasoning_effort: Number(parserPayload.reasoning_effort || 1)
                }
              };
            },
            retrieveProjectEvidence(input = {}) {
              return {
                selected_project: {
                  id: String(input.selectedProjectId || ''),
                  name: String(input.selectedProjectName || ''),
                  resolution_source: 'selected_project'
                },
                clarification_question: 'Which project should I use?'
              };
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
          message: 'Why did the binder signal drop after transfection?',
          projectId: 'proj-1',
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
        assert.equal(result.parser.primary_intent, 'project_science_question');
        assert.equal(result.parser.needs_clarification, false);
        assert.equal(result.parser.entities.project_name, 'Atlas');
        assert.equal(routedParserPayload.primary_intent, 'project_science_question');
        assert.equal(routedParserPayload.needs_clarification, false);
        assert.equal(receivedScienceInput.parserPayload.primary_intent, 'project_science_question');
        assert.equal(receivedScienceInput.parserPayload.entities.project_name, 'Atlas');
        assert.equal(receivedScienceInput.project.id, 'proj-1');
        assert.equal(receivedScienceInput.project.name, 'Atlas');
        assert.equal(result.project_science_question.status, 'completed');
        assert.equal(Boolean(result.general_science_question), false);
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

    test('python sandbox exposes helper APIs for staged file reads and renderable outputs', async () => {
      const result = await agentPython.runPythonSandbox({
        code: [
          'import enana_sandbox as sandbox',
          'payload = sandbox.read_json("input.json")',
          'sandbox.emit_text("Loaded " + payload["name"], title="Summary")',
          'sandbox.emit_json({"value": payload["value"]}, title="Structured")',
          'sandbox.emit_image_bytes(b"fake-image", mime_type="image/png", title="Plot")',
          'print("helper-finished")'
        ].join('\n'),
        files: [
          {
            path: 'input.json',
            content: JSON.stringify({ name: 'Atlas', value: 42 })
          }
        ],
        timeout_ms: 4000
      });

      assert.equal(result.ok, true);
      assert.equal(Array.isArray(result.render_outputs), true);
      assert.equal(result.render_outputs.length, 3);
      assert.equal(result.render_outputs[0].type, 'text');
      assert.equal(result.render_outputs[0].title, 'Summary');
      assert.match(String(result.render_outputs[0].content || ''), /Loaded Atlas/);
      assert.equal(result.render_outputs[1].type, 'text');
      assert.equal(result.render_outputs[1].format, 'application/json');
      assert.match(String(result.render_outputs[1].content || ''), /"value": 42/);
      assert.equal(result.render_outputs[2].type, 'image');
      assert.equal(result.render_outputs[2].mime_type, 'image/png');
      assert.equal(result.render_outputs[2].data_base64, Buffer.from('fake-image').toString('base64'));
      assert.match(String(result.stdout || ''), /helper-finished/);
    });

    test('managed python sandbox runtime only forwards the task brief to the sandbox sub-agent', async () => {
      const createCalls = [];
      const noop = () => {};
      const subAgentRuntime = {
        createSubAgent: async (input = {}) => {
          const snapshot = JSON.parse(JSON.stringify(input));
          createCalls.push(snapshot);
          return {
            ok: true,
            status: 'created',
            agent: {
              id: 'python-sandbox-subagent-1',
              name: String(snapshot.name || ''),
              status: 'active',
              system_prompt: '',
              metadata: JSON.parse(JSON.stringify(snapshot.metadata || {})),
              created_at: '2026-03-22T10:00:00.000Z',
              updated_at: '2026-03-22T10:00:00.000Z',
              messages: [
                {
                  role: 'user',
                  text: String(snapshot.message || ''),
                  timestamp: '2026-03-22T10:00:00.000Z'
                }
              ],
              last_response: null,
              task: null
            },
            summary: 'created'
          };
        },
        sendSubAgentMessage: async () => ({ ok: true, status: 'updated' }),
        getSubAgent: ({ agent_id } = {}) => ({
          ok: true,
          status: 'found',
          agent: {
            id: String(agent_id || 'python-sandbox-subagent-1'),
            name: 'python-sandbox-helper',
            status: 'active',
            system_prompt: '',
            metadata: {
              task_type: 'python-sandbox'
            },
            created_at: '2026-03-22T10:00:00.000Z',
            updated_at: '2026-03-22T10:00:01.000Z',
            messages: [],
            last_response: null,
            task: {
              state: 'completed'
            },
            liveness: {
              live: true,
              state: 'idle',
              reason: 'task_completed'
            }
          }
        }),
        startSubAgentTask: noop,
        recordSubAgentHeartbeat: noop,
        completeSubAgentTask: noop,
        failSubAgentTask: noop,
        listSubAgents: () => ({ ok: true, status: 'listed', items: [] }),
        deleteSubAgent: () => ({ ok: true, status: 'deleted' })
      };

      const runtime = agentPython.createManagedPythonSandboxRuntime({
        subAgentRuntime,
        runPythonSandbox: async () => ({
          ok: true,
          run_id: 'py-test-1',
          status: 'ok',
          error: '',
          timeout_ms: 4000,
          python_executable: 'python3',
          process_id: 1234,
          exit_code: 0,
          signal: null,
          timed_out: false,
          stdout: 'done',
          stderr: '',
          files_written: [],
          readback_files: [],
          render_outputs: [],
          warnings: [],
          summary: 'Python sandbox execution completed.'
        })
      });

      const result = await runtime.execute({
        code: 'print(42)',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        name: 'python-sandbox-test'
      });

      assert.equal(result.ok, true);
      assert.equal(createCalls.length, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(createCalls[0], 'system_prompt'), false);
      assert.equal(createCalls[0].metadata.task_type, 'python-sandbox');
      assert.match(String(createCalls[0].message || ''), /Supervise this Python sandbox execution\./);
    });

    test('managed python sandbox runtime lets the sandbox sub-agent repair failed runs itself', async () => {
      const llmCalls = [];
      const runCalls = [];
      const runtime = agentPython.createManagedPythonSandboxRuntime({
        requestStructuredJsonPayload: async (options = {}) => {
          llmCalls.push(options);
          return {
            ok: true,
            payload: {
              action: 'rerun',
              assistant_message: 'I fixed the failing code and prepared a retry.',
              summary: 'Retry with corrected code.',
              code: 'print("repaired")'
            }
          };
        },
        runPythonSandbox: async (input = {}) => {
          runCalls.push(JSON.parse(JSON.stringify(input)));
          if (runCalls.length === 1) {
            return {
              ok: false,
              run_id: 'py-failed-1',
              status: 'error',
              error: 'NameError: missing_symbol',
              timeout_ms: 4000,
              python_executable: 'python3',
              process_id: 2111,
              exit_code: 1,
              signal: null,
              timed_out: false,
              stdout: '',
              stderr: 'Traceback\nNameError: missing_symbol',
              files_written: [],
              readback_files: [],
              render_outputs: [],
              warnings: [],
              summary: 'Python sandbox execution failed.'
            };
          }
          return {
            ok: true,
            run_id: 'py-repaired-2',
            status: 'ok',
            error: '',
            timeout_ms: 4000,
            python_executable: 'python3',
            process_id: 2112,
            exit_code: 0,
            signal: null,
            timed_out: false,
            stdout: 'repaired',
            stderr: '',
            files_written: [],
            readback_files: [],
            render_outputs: [],
            warnings: [],
            summary: 'Python sandbox execution completed.'
          };
        }
      });

      const result = await runtime.execute({
        code: 'print(missing_symbol)',
        timeout_ms: 4000,
        task_type: 'calculation'
      }, {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        message: 'Run the sandbox task and repair it if needed.'
      });

      assert.equal(result.ok, true);
      assert.equal(runCalls.length, 2);
      assert.equal(runCalls[1].code, 'print("repaired")');
      assert.equal(llmCalls.length, 1);
      assert.equal(llmCalls[0].stage, 'python_sandbox_sub_agent_repair');
      assert.equal(result.repair_rounds, 1);
      assert.equal(result.sub_agent?.task?.state, 'completed');
      assert.equal(result.sub_agent?.task?.metadata?.latest_sandbox_result?.run_id, 'py-repaired-2');
      assert.match(String(result.summary || ''), /Self-repaired after 1 round/i);
    });

    test('managed python sandbox runtime reuses the same sub-agent for stored results and follow-up feedback', async () => {
      const llmCalls = [];
      const runCalls = [];
      const runtime = agentPython.createManagedPythonSandboxRuntime({
        requestStructuredJsonPayload: async (options = {}) => {
          llmCalls.push(options);
          return {
            ok: true,
            payload: {
              action: 'rerun',
              assistant_message: 'I extended the sandbox work for the follow-up request.',
              summary: 'Run a second pass.',
              code: 'print("second-pass")'
            }
          };
        },
        runPythonSandbox: async (input = {}) => {
          runCalls.push(JSON.parse(JSON.stringify(input)));
          const index = runCalls.length;
          return {
            ok: true,
            run_id: `py-success-${index}`,
            status: 'ok',
            error: '',
            timeout_ms: 4000,
            python_executable: 'python3',
            process_id: 3100 + index,
            exit_code: 0,
            signal: null,
            timed_out: false,
            stdout: index === 1 ? 'first-pass' : 'second-pass',
            stderr: '',
            files_written: [],
            readback_files: [],
            render_outputs: [],
            warnings: [],
            summary: 'Python sandbox execution completed.'
          };
        }
      });

      const first = await runtime.execute({
        code: 'print("first-pass")',
        timeout_ms: 4000,
        task_type: 'analysis'
      }, {
        message: 'Analyze the dataset.'
      });

      assert.equal(first.ok, true);
      assert.equal(runCalls.length, 1);
      assert.equal(typeof first.sub_agent_id, 'string');

      const replayed = await runtime.execute({
        sub_agent_id: first.sub_agent_id
      });

      assert.equal(replayed.ok, true);
      assert.equal(runCalls.length, 1);
      assert.equal(replayed.sandbox.run_id, 'py-success-1');
      assert.equal(replayed.sub_agent_id, first.sub_agent_id);
      assert.equal(replayed.continued_from_sub_agent, true);

      const continued = await runtime.execute({
        sub_agent_id: first.sub_agent_id,
        feedback: 'Please do a second pass and expand the result.'
      }, {
        provider: 'openai',
        model: 'gpt-5.4-mini'
      });

      assert.equal(continued.ok, true);
      assert.equal(runCalls.length, 2);
      assert.equal(runCalls[1].code, 'print("second-pass")');
      assert.equal(llmCalls.length, 1);
      assert.equal(llmCalls[0].stage, 'python_sandbox_sub_agent_continue');
      assert.equal(continued.sub_agent_id, first.sub_agent_id);
      assert.equal(continued.continued_from_sub_agent, true);
      assert.equal(continued.repair_rounds, 0);
      assert.match(String(continued.summary || ''), /Continued from Python sandbox sub-agent/i);
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
      assert.match(String(failure.sandbox?.error || ''), /module_that_does_not_exist_anywhere/);
      assert.match(String(failure.debug?.assistant_message || ''), /Suggested next step/i);
      assert.match(String(failure.debug?.assistant_message || ''), /standard library|vendor/i);
    });

    test('python sandbox executor forwards continuation and llm context into the managed runtime', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));
      const executors = new Map();
      let captured = null;
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        pythonSandboxToolRuntime: {
          execute: async (args = {}, options = {}) => {
            captured = {
              args: JSON.parse(JSON.stringify(args)),
              options: JSON.parse(JSON.stringify(options))
            };
            return {
              ok: true,
              sub_agent_id: 'python-sandbox-subagent-1',
              summary: 'Python sandbox execution completed.',
              sandbox: {
                ok: true,
                run_id: 'py-tool-1',
                status: 'ok',
                error: '',
                stdout: 'done',
                stderr: '',
                readback_files: [],
                render_outputs: []
              }
            };
          }
        },
        getAgentPythonSandboxRoot: () => '/tmp/python-sandbox-root'
      });

      const result = await executors.get('python-sandbox')({
        args: {
          sub_agent_id: 'python-sandbox-subagent-1',
          feedback: 'Keep working on the same task.'
        },
        context: {
          lifecycleRecorder: {
            requestId: 'req-77'
          },
          preferredPythonBin: 'python3',
          pythonExecutable: '/usr/bin/python3',
          provider: 'openai',
          endpoint: 'https://api.openai.example/v1',
          apiKey: 'secret-key',
          model: 'gpt-5.4-mini',
          traceContext: {
            trace_id: 'trace-1'
          },
          message: 'Please continue the previous Python sandbox analysis.'
        }
      });

      assert.equal(captured.options.parent_request_id, 'req-77');
      assert.equal(captured.options.sandboxRoot, '/tmp/python-sandbox-root');
      assert.equal(captured.options.preferredPythonBin, 'python3');
      assert.equal(captured.options.pythonExecutable, '/usr/bin/python3');
      assert.equal(captured.options.provider, 'openai');
      assert.equal(captured.options.endpoint, 'https://api.openai.example/v1');
      assert.equal(captured.options.apiKey, 'secret-key');
      assert.equal(captured.options.model, 'gpt-5.4-mini');
      assert.equal(captured.options.traceContext.trace_id, 'trace-1');
      assert.equal(captured.options.message, 'Please continue the previous Python sandbox analysis.');
      assert.equal(result.sub_agent_id, 'python-sandbox-subagent-1');
      assert.equal(result.run_id, 'py-tool-1');
    });

    test('provider bridge routes codex multimodal file requests through the simple Codex bridge surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex',
          OPENAI: 'openai'
        },
        resolveCodexEndpoint: () => 'https://chatgpt.com/backend-api/codex/responses',
        resolveCodexApiKey: () => 'oauth-access-token',
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return '{"selected":true}';
        }
      });

      const result = await bridge.requestFileInput({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        stage: 'paper_context_selection',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'Pick the best excerpt.',
        pdfDataUrl: 'data:application/pdf;base64,QUJD',
        fileName: 'paper.pdf',
        expectJson: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.payload.selected, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].endpoint, 'https://chatgpt.com/backend-api/codex/responses');
      assert.equal(calls[0].apiKey, 'oauth-access-token');
      assert.equal(calls[0].fileName, 'paper.pdf');
      assert.equal(calls[0].pdfDataUrl, 'data:application/pdf;base64,QUJD');
      assert.match(calls[0].prompt, /Return valid JSON only\./);
      assert.match(calls[0].prompt, /Pick the best excerpt\./);
    });

    test('provider bridge forwards openai web search requests through Responses web_search tool', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          OPENAI: 'openai'
        },
        requestOpenAiResponsesWithBackoff: async ({ body } = {}) => {
          calls.push(body);
          return {
            output_text: JSON.stringify({
              results: [
                {
                  title: 'Vendor Product',
                  url: 'https://vendor.test/products/item-1',
                  summary: 'Direct product detail page.',
                  source_domain: 'vendor.test'
                }
              ],
              reasoning: 'Used web search.'
            })
          };
        }
      });

      const result = await bridge.requestWebSearch({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        stage: 'purchase_search',
        query: 'SS320 competent cells',
        maxResults: 3,
        allowedDomains: ['vendor.test']
      });

      assert.equal(result.ok, true);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].url, 'https://vendor.test/products/item-1');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].tools[0].type, 'web_search');
      assert.deepEqual(calls[0].tools[0].filters.allowed_domains, ['vendor.test']);
      assert.deepEqual(calls[0].include, ['web_search_call.action.sources']);
    });

    test('provider bridge routes codex web search through the simple Codex web-search bridge surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        resolveCodexEndpoint: () => 'https://chatgpt.com/backend-api/codex/responses',
        resolveCodexApiKey: () => 'oauth-access-token',
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return JSON.stringify({
            results: [
              {
                title: 'Vendor Product',
                url: 'https://vendor.test/products/item-1',
                summary: 'Direct product detail page.',
                source_domain: 'vendor.test'
              }
            ],
            reasoning: 'Internet search succeeded.'
          });
        }
      });

      const result = await bridge.requestWebSearch({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        query: 'SS320 competent cells',
        maxResults: 2
      });

      assert.equal(result.ok, true);
      assert.equal(result.results.length, 1);
      assert.equal(calls[0].endpoint, 'https://chatgpt.com/backend-api/codex/responses');
      assert.equal(calls[0].apiKey, 'oauth-access-token');
      assert.equal(calls[0].enableWebSearch, true);
      assert.match(calls[0].prompt, /Search query:/);
    });

    test('runtime helpers wire codex structured requests through the shared simple Codex provider API surface', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const { createAgentLlmRuntimeHelpers } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-utils.js'
      ));

      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          CODEX: 'codex'
        },
        resolveCodexEndpoint: () => 'https://chatgpt.com/backend-api/codex/responses',
        resolveCodexApiKey: () => 'oauth-access-token',
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return '{"primary_intent":"general_science_question","needs_clarification":false,"clarifying_question":"","clarification_options":[],"entities":{"projects":[],"samples":[],"proteins":[],"genes":[],"reagents":[],"vendors":[],"inventory_queries":[],"record_queries":[],"assays":[],"gels":[],"papers":[],"protocols":[],"notebooks":[],"purchase_requirements":[]},"reasoning_summary":"Parsed intent.","confidence":"high","reasoning_effort":1}';
        }
      });
      const helpers = createAgentLlmRuntimeHelpers({
        llmProviderBridge: bridge
      });

      const result = await helpers.requestStructuredJsonPayload({
        provider: 'codex',
        endpoint: 'codex://cli',
        model: 'gpt-5.4-mini',
        stage: 'intent_parser',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'User asks a science question.',
        enableWebSearch: true,
        schema: {
          type: 'object',
          additionalProperties: true
        },
        defaultError: 'Intent parser provider is not configured.'
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].endpoint, 'https://chatgpt.com/backend-api/codex/responses');
      assert.equal(calls[0].apiKey, 'oauth-access-token');
      assert.equal(calls[0].enableWebSearch, true);
      assert.match(calls[0].prompt, /Return valid JSON only\./);
      assert.match(calls[0].prompt, /User asks a science question\./);
    });

    test('runtime helpers can carry web search through openai structured requests', async () => {
      const { createAgentLlmProviderBridge } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-provider-bridge.js'
      ));
      const { createAgentLlmRuntimeHelpers } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'shared',
        'agent-llm-utils.js'
      ));

      const calls = [];
      const bridge = createAgentLlmProviderBridge({
        LLM_PROVIDERS: {
          OPENAI: 'openai'
        },
        requestOpenAiResponsesWithBackoff: async ({ body } = {}) => {
          calls.push(body);
          return {
            output_text: '{"protocol":{"name":"Test","purpose":"Test","materials":[],"steps":["Do it."],"troubleshooting":""},"result_summary":"done"}'
          };
        }
      });
      const helpers = createAgentLlmRuntimeHelpers({
        llmProviderBridge: bridge
      });

      const result = await helpers.requestStructuredJsonPayload({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        stage: 'protocol_generation',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: 'Generate a protocol.',
        enableWebSearch: true,
        schema: {
          type: 'object',
          additionalProperties: true
        }
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].tools[0].type, 'web_search');
      assert.equal(calls[0].tool_choice, 'auto');
      assert.deepEqual(calls[0].include, ['web_search_call.action.sources']);
    });

    test('web search runtime exposes provider-backed web search to agent tools', async () => {
      const { createWebSearchRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'tools',
        'agent-web-search.js'
      ));

      const calls = [];
      const runtime = createWebSearchRuntime({
        requestWebSearch: async (input = {}) => {
          calls.push(input);
          return {
            ok: true,
            results: [
              {
                title: 'OpenAI result',
                url: 'https://example.org/openai-result',
                summary: 'External source.',
                source_domain: 'example.org'
              }
            ],
            reasoning: 'Provider-backed search.'
          };
        }
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'recent protein folding benchmark',
        limit: 4
      });

      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].provider, 'openai');
      assert.equal(calls[0].maxResults, 4);
      assert.equal(result.citations[0].source, 'web_source');
    });

    test('registerAgentToolExecutors wires the web-search tool through the shared runtime', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));

      const executors = new Map();
      const calls = [];
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        webSearchRuntime: {
          execute: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              ok: true,
              status: 'completed',
              query: input.query,
              items: [
                {
                  title: 'Shared web result',
                  url: 'https://example.org/result',
                  summary: 'External source.',
                  source_domain: 'example.org'
                }
              ],
              citations: [
                {
                  source: 'web_source',
                  pointer: 'https://example.org/result',
                  reason: 'Matched external web search result.'
                }
              ],
              summary: 'Found 1 web result.'
            };
          }
        }
      });

      const result = await executors.get('web-search')({
        args: {
          query: 'recent protein folding benchmark',
          limit: 3
        },
        context: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          message: 'Find recent protein folding benchmark results.'
        }
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].limit, 3);
      assert.equal(calls[0].query, 'recent protein folding benchmark');
      assert.equal(calls[0].message, 'Find recent protein folding benchmark results.');
      assert.equal(result.summary, 'Found 1 web result.');
    });

    test('registerAgentToolExecutors forwards snapshot storage and project context into literature-search', async () => {
      const { registerAgentToolExecutors } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'tools',
        'register-agent-tool-executors.js'
      ));

      const executors = new Map();
      const calls = [];
      registerAgentToolExecutors({
        genericAgentToolRuntime: {
          registerToolExecutor(name, handler) {
            executors.set(name, handler);
          }
        },
        literatureSearchRuntime: {
          execute: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              ok: true,
              status: 'completed',
              items: [],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              summary: 'Found 0 literature results.'
            };
          }
        }
      });

      const result = await executors.get('literature-search')({
        args: {
          query: 'ncAA incorporation',
          limit: 5
        },
        context: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          message: 'Find ncAA papers.',
          project: {
            id: 'project-1',
            name: 'Atlas'
          },
          snapshot: {
            settings: {
              storagePath: '/tmp/enana-storage'
            },
            projects: [
              {
                id: 'project-1',
                name: 'Atlas'
              }
            ]
          },
          parserPayload: {
            primary_intent: 'literature_search'
          }
        }
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].project.name, 'Atlas');
      assert.equal(calls[0].storage_path, '/tmp/enana-storage');
      assert.equal(calls[0].storagePath, '/tmp/enana-storage');
      assert.equal(calls[0].snapshot.settings.storagePath, '/tmp/enana-storage');
      assert.equal(calls[0].parser_payload.primary_intent, 'literature_search');
    });

    test('session runtime runs the tool loop through the unified requestText API', async () => {
      const { createAgentSessionRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-session-runtime.js'
      ));
      const callLog = [];
      let turnCount = 0;
      const runtime = createAgentSessionRuntime({
        requestText: async (input = {}) => {
          callLog.push(input);
          turnCount += 1;
          if (turnCount === 1) {
            return {
              ok: true,
              text: JSON.stringify({
                assistant_text: 'starting turn',
                tool_call: {
                  call_id: 'codex-call-1',
                  name: 'literature-search',
                  arguments: {
                    query: 'ncAA incorporation'
                  }
                }
              })
            };
          }
          if (turnCount === 2) {
            return {
              ok: true,
              text: JSON.stringify({
                assistant_text: 'after tool output',
                tool_calls: []
              })
            };
          }
          return {
            ok: true,
            text: JSON.stringify({
              assistant_text: 'feedback: Please be more specific.',
              tool_calls: []
            })
          };
        }
      });

      const started = await runtime.startAgentSession({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        systemPrompt: 'Be grounded.',
        message: 'Search for ncAA incorporation papers.',
        toolDefinitions: [
          {
            type: 'function',
            name: 'literature-search',
            description: 'Search papers.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query'],
              additionalProperties: false
            }
          }
        ]
      });
      assert.equal(callLog.length, 1);
      assert.equal(callLog[0].provider, 'codex');
      assert.match(callLog[0].userPrompt, /Search for ncAA incorporation papers\./);
      assert.match(callLog[0].userPrompt, /literature-search/);
      assert.match(callLog[0].userPrompt, /tool_schema_requests/);
      assert.doesNotMatch(callLog[0].userPrompt, /Input schema JSON:/);
      assert.equal(runtime.extractAgentSessionText(started), 'starting turn');
      assert.equal(runtime.extractAgentSessionFunctionCalls(started).length, 1);
      assert.equal(runtime.extractFunctionCalls('{"tool_call":{"name":"literature-search","arguments":{}}}').length, 1);
      assert.deepEqual(
        runtime.extractSchemaRequests('{"tool_schema_requests":["literature-search"]}').map((entry) => entry.name),
        ['literature-search']
      );

      const afterTool = await runtime.continueAgentSessionWithToolOutputs(
        started,
        [{ callId: 'codex-call-1', name: 'literature-search', output: '{"ok":true}' }],
        { trace_id: 'trace-1' }
      );
      assert.equal(callLog[1].traceContext.trace_id, 'trace-1');
      assert.match(callLog[1].userPrompt, /"ok":true/);
      assert.equal(runtime.extractAgentSessionText(afterTool), 'after tool output');

      const afterUser = await runtime.continueAgentSessionWithUserMessage(
        afterTool,
        'Please be more specific.',
        { trace_id: 'trace-2' }
      );
      assert.equal(callLog[2].traceContext.trace_id, 'trace-2');
      assert.match(callLog[2].userPrompt, /Please be more specific\./);
      assert.equal(runtime.extractAgentSessionText(afterUser), 'feedback: Please be more specific.');
    });

  }
};
