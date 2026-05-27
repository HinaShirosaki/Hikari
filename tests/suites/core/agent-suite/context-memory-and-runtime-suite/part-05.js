module.exports = function registerAgentContextMemoryAndRuntimeSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  }
};