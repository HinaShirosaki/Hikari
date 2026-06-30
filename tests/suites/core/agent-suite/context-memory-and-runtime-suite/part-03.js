module.exports = function registerAgentContextMemoryAndRuntimeSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
      const { createAgentLifecycleService } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-lifecycle-service.js'));
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
        endpoint: '',
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
  }
};