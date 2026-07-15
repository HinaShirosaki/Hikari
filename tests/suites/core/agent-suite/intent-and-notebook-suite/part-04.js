module.exports = function registerAgentIntentAndNotebookSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('controller core dispatches direct skill commands before LLM setup', async () => {
      const { createAgentControllerCore } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', 'agent-controller-core.js'));
      let toolCallCount = 0;
      const controller = createAgentControllerCore({
        deps: {
          LLM_PROVIDERS: {
            OPENAI: 'openai',
            CODEX: 'codex'
          }
        },
        cleanText: (value, _maxLength = 2000) => {
          const text = String(value || '').trim();
          return text || '';
        },
        controllerUtils: {
          resolveAgentProvider: () => {
            throw new Error('Provider resolution should not run for direct skill commands.');
          },
          resolveAgentEndpoint: () => '',
          resolveAgentModel: () => '',
          resolveAgentApiKey: () => '',
          extractConversation: (conversation) => (Array.isArray(conversation) ? conversation : []),
          resolveAgentExecutionFlags: () => ({ developerMode: false }),
          createAgentLlmTraceContext: () => ({
            enabled: false,
            requestId: 'req-skill-command',
            logPath: '',
            provider: '',
            model: '',
            rows: [],
            entries: []
          })
        },
        observability: {
          recordLifecycleEvent: () => {}
        },
        protocolNotebookRuntime: {
          buildSessionKey: () => 'skill-command-session',
          hasPendingSession: () => false
        },
        scienceReasoningLoopRuntime: {},
        scienceMainUtils: {},
        agentToolRuntime: {
          normalizeAgentSnapshot: (snapshot) => (snapshot && typeof snapshot === 'object' ? snapshot : {}),
          listSkills: () => ([
            {
              name: 'command-line',
              description: 'Run shell commands.',
              command_name: 'command_line',
              path: '/skills/command-line/SKILL.md'
            }
          ]),
          parseSkillInvocation: () => ({
            type: 'direct_tool',
            skill: {
              name: 'command-line'
            },
            tool_name: 'command-line',
            command_name: 'skill',
            raw_args: 'pwd',
            active_skill_names: ['command-line'],
            cleaned_message: 'pwd'
          }),
          async runAgentTool(toolName, args) {
            toolCallCount += 1;
            assert.equal(toolName, 'command-line');
            assert.equal(args.command, 'pwd');
            return {
              ok: true,
              summary: 'Command completed successfully.',
              result: {
                status: 'completed',
                summary: 'Command completed successfully.',
                stdout: '/tmp/workspace'
              }
            };
          }
        },
        executeInventoryLookup: async () => {
          throw new Error('Inventory lookup should not run for direct skill commands.');
        },
        executeNotebookLookup: async () => {
          throw new Error('Notebook lookup should not run for direct skill commands.');
        },
        getAgentChatLogPath: () => '',
        getDefaultDataFilePath: () => '',
        setCodexCliModel: () => {},
        setCodexCliReasoningEffort: () => {},
        lifecycleService: {
          normalizeJsonPayload: (payload, fallback = {}) => (
            payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : fallback
          ),
          asArray: (value) => (Array.isArray(value) ? value : [])
        }
      });

      const result = await controller.runAgentControllerCore({
        message: '/skill command-line pwd',
        stateSnapshot: {}
      }, {
        lifecycleRecorder: {
          requestId: 'req-skill-command',
          events: []
        },
        requestId: 'req-skill-command'
      });

      assert.equal(toolCallCount, 1);
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'skill_command');
      assert.equal(result.skill_command.status, 'completed');
      assert.equal(result.skill_command.skill_name, 'command-line');
      assert.equal(result.skill_command.tool_name, 'command-line');
      assert.match(String(result.skill_command.summary || ''), /completed successfully/i);
    });
  }
};
