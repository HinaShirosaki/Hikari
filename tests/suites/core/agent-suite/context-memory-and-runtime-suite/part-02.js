module.exports = function registerAgentContextMemoryAndRuntimeSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
              primary_intent: 'notebook_lookup',
              needs_clarification: false,
              reasoning_summary: 'Matched notebook lookup.'
            },
            notebook_lookup: {
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
              intent_parse_question: 'This is a notebook lookup request.',
              question_clarifier: 'I am narrowing the lookup to the Atlas binder notebook.',
              criteria_generate: 'I am checking whether one clear notebook match is enough.',
              tool_rounds: [
                {
                  round: 1,
                  tool_selection: 'I am choosing notebook lookup first.',
                  tool_call: 'I want to use notebook-lookup to investigate "Atlas binder".',
                  tool_results: 'Based on the tool result, it seems I found the notebook entry.'
                }
              ],
              pre_synthesize_answer: 'Based on the evidence so far, the Atlas Binder Notebook is the likely match.',
              judge: 'I have enough evidence to answer with one notebook match.',
              final_synthesize: 'I am summarizing the matched notebook for the user.',
              final_synthesized_question: 'Where is the Atlas binder notebook?'
            },
            developer_trace: []
          },
          requestText: 'Where is the Atlas binder notebook?',
          messageId: 'assistant-fixed-1',
          timestamp: '2026-03-22T15:00:02.000Z'
        });
        assert.match(assistantMessage.text, /Found 1 notebook match/);
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

        const codexAssistantMessage = runtime.buildAssistantMessageFromResult({
          result: {
            ok: true,
            parser: {
              primary_intent: 'codex_agent',
              needs_clarification: false,
              reasoning_summary: 'Codex handled this turn.'
            },
            codex_agent: {
              status: 'completed',
              answer: 'mRNA display links a peptide to its encoding mRNA.',
              follow_up_questions: [],
              user_question: {
                question: 'mRNA display links a peptide to its encoding mRNA.',
                options: [],
                allow_custom: true
              },
              citations: []
            },
            developer_trace: []
          },
          requestText: 'What is mRNA display?',
          messageId: 'assistant-codex-no-question',
          timestamp: '2026-03-22T15:00:02.750Z'
        });
        assert.equal(codexAssistantMessage.text, 'mRNA display links a peptide to its encoding mRNA.');
        assert.equal(codexAssistantMessage.meta.user_question, null);

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
            response_payload: { primary_intent: 'notebook_lookup' }
          },
          {
            type: 'agent-chat-result',
            session_id: created.session.id,
            requestId: 'req-1',
            timestamp: '2026-03-22T15:00:01.900Z',
            response_type: 'notebook_lookup',
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
        assert.match(String(loaded.messages[1].text || ''), /Found 1 notebook match/);
        assert.equal(loaded.messages[1].meta.notebook_lookup.status, 'matched');
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
    test('agent chat log runtime persists Codex session ids on chat summaries', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-chat-log-codex-session-'));
      try {
        const runtime = agentChatLog.createAgentChatLogRuntime({
          now: () => '2026-03-22T15:35:00.000Z',
          createId: () => 'chat-codex-session-1'
        });
        const created = await runtime.createSession({
          storagePath: tempDir,
          projectId: 'proj-codex',
          projectName: 'Codex Project'
        });

        await runtime.appendRows(tempDir, created.session.id, [
          {
            type: 'agent-chat-result',
            session_id: created.session.id,
            requestId: 'req-codex-1',
            timestamp: '2026-03-22T15:35:01.000Z',
            response_type: 'codex_agent',
            codex_session_id: 'codex-chat-session-1',
            codex_agent: {
              status: 'completed',
              codex_session_id: 'codex-chat-session-1',
              answer: 'Codex handled this turn.'
            },
            ok: true
          },
          {
            type: 'assistant-message',
            session_id: created.session.id,
            message_id: 'assistant-codex-1',
            timestamp: '2026-03-22T15:35:02.000Z',
            text: 'Codex handled this turn.',
            meta: {
              codex_session_id: 'codex-chat-session-1',
              codex_agent: {
                status: 'completed',
                codex_session_id: 'codex-chat-session-1'
              }
            }
          }
        ]);

        const listed = await runtime.listSessions({ storagePath: tempDir });
        assert.equal(listed.items[0].codex_session_id, 'codex-chat-session-1');
        const loaded = await runtime.getSession({
          storagePath: tempDir,
          sessionId: created.session.id
        });
        assert.equal(loaded.session.codex_session_id, 'codex-chat-session-1');
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
          'llm',
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
  }
};
