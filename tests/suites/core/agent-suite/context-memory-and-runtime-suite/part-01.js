module.exports = function registerAgentContextMemoryAndRuntimeSuitePart01(context = {}) {
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
        skills: ['notebook-lookup'],
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
      assert.equal(envelope.registry_selection.system.skills.includes('notebook-lookup'), true);
      assert.match(String(envelope.prompt_blocks.verification || ''), /Verification feedback:/);
      assert.match(String(envelope.prompt_blocks.verification || ''), /Fetch both runs before answering\./);
      assert.match(String(envelope.prompt_blocks.session_memory || ''), /Skills: notebook-lookup/);
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
  }
};