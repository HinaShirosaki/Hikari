module.exports = function registerCodexCliProviderSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const os = require('node:os');
    const providerPath = path.join(__dirname, 'src', 'main', 'lib', 'codex-cli-provider.js');
    const loadProvider = () => {
      delete require.cache[require.resolve(providerPath)];
      return require(providerPath);
    };
    const defaultModelsCache = {
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'gpt-5.4',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
            { effort: 'xhigh' }
          ]
        },
        {
          slug: 'gpt-5.1-codex-mini',
          display_name: 'gpt-5.1-codex-mini',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'medium' },
            { effort: 'high' }
          ]
        }
      ]
    };

    function buildJwt(payload = {}) {
      const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
    }

    function withCodexHome({
      modelsCache = defaultModelsCache,
      configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
      authFile = null
    } = {}, callback) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-home-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(modelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), configToml, 'utf8');
      if (authFile && typeof authFile === 'object') {
        fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify(authFile, null, 2), 'utf8');
      }
      process.env.CODEX_HOME = tmpDir;
      delete process.env.HIKARI_CODEX_HOME;
      const cleanup = () => {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousHikariCodexHome === 'string') {
          process.env.HIKARI_CODEX_HOME = previousHikariCodexHome;
        } else {
          delete process.env.HIKARI_CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      };
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          return result.finally(cleanup);
        }
        cleanup();
        return result;
      } catch (error) {
        cleanup();
        throw error;
      } finally {
        // Async callbacks clean up in the promise finalizer above.
      }
    }

    function createFakeCodexBinary(workspaceDir) {
      const fakePath = path.join(workspaceDir, 'fake-codex.js');
      const capturePath = path.join(workspaceDir, 'fake-codex-call.json');
      fs.writeFileSync(fakePath, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        'let stdin = "";',
        "process.stdin.on('data', (chunk) => { stdin += String(chunk || ''); });",
        "process.stdin.on('end', () => {",
        "  const outputIndex = args.indexOf('--output-last-message');",
        "  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : '';",
        '  fs.writeFileSync(process.env.HIKARI_FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }, null, 2));',
        "  if (process.env.HIKARI_FAKE_CODEX_STDOUT) { process.stdout.write(process.env.HIKARI_FAKE_CODEX_STDOUT); }",
        "  if (process.env.HIKARI_FAKE_CODEX_STDERR) { process.stderr.write(process.env.HIKARI_FAKE_CODEX_STDERR); }",
        "  const exitCode = Number(process.env.HIKARI_FAKE_CODEX_EXIT_CODE || 0);",
        "  if (exitCode) { process.exit(exitCode); }",
        "  if (outputFile) { fs.writeFileSync(outputFile, 'OK from fake codex'); }",
        '});'
      ].join('\n'), 'utf8');
      fs.chmodSync(fakePath, 0o755);
      return {
        fakePath,
        capturePath
      };
    }

    function createFakeCodexTranscriptWriterBinary(workspaceDir, sessionId, transcriptPath) {
      const fakePath = path.join(workspaceDir, 'fake-codex-transcript-writer.js');
      const capturePath = path.join(workspaceDir, 'fake-codex-transcript-writer-call.json');
      fs.writeFileSync(fakePath, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        'let stdin = "";',
        "process.stdin.on('data', (chunk) => { stdin += String(chunk || ''); });",
        "process.stdin.on('end', () => {",
        "  const outputIndex = args.indexOf('--output-last-message');",
        "  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : '';",
        '  fs.writeFileSync(process.env.HIKARI_FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }, null, 2));',
        `  process.stdout.write(${JSON.stringify(`${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`)});`,
        '  setTimeout(() => {',
        `    fs.mkdirSync(${JSON.stringify(path.dirname(transcriptPath))}, { recursive: true });`,
        `    fs.appendFileSync(${JSON.stringify(transcriptPath)}, JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'Transcript-only commentary is live.' } }) + '\\n');`,
        '  }, 50);',
        '  setTimeout(() => {',
        "    if (outputFile) { fs.writeFileSync(outputFile, 'OK from fake codex'); }",
        '    process.exit(0);',
        '  }, 350);',
        '});'
      ].join('\n'), 'utf8');
      fs.chmodSync(fakePath, 0o755);
      return {
        fakePath,
        capturePath
      };
    }
    test('codex cli provider runs codex exec with Hikari AGENTS.md and MCP config', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-456'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-request-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;

        try {
          const requestContext = JSON.stringify({
            provider: 'codex',
            chatSessionId: 'chat-request-env',
            traceRequestId: 'req-request-env'
          });
          const result = await provider.requestCodexCliText({
            prompt: 'Return OK only.',
            cwd: workspaceDir,
            enableWebSearch: true,
            envOverrides: {
              HIKARI_AGENT_MCP_REQUEST_CONTEXT: requestContext,
              HIKARI_AGENT_MCP_REQUEST_CONTEXT: requestContext,
              HIKARI_CODEX_REQUEST_CONTEXT: requestContext,
              HIKARI_CODEX_REQUEST_CONTEXT: requestContext
            }
          });
          const captured = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          const runtimeConfig = fs.readFileSync(path.join(captured.codexHome, 'config.toml'), 'utf8');
          assert.equal(result, 'OK from fake codex');
          assert.equal(fs.realpathSync(captured.cwd), fs.realpathSync(workspaceDir));
          assert.equal(captured.args.includes('exec'), true);
          assert.equal(captured.args.includes('--search'), true);
          assert.equal(captured.args.includes('non_prefixed_mcp_tool_names'), false);
          assert.equal(captured.args.includes('--output-last-message'), true);
          assert.match(captured.stdin, /Return OK only\./);
          assert.equal(fs.existsSync(path.join(workspaceDir, 'AGENTS.md')), true);
          assert.match(runtimeConfig, /\[mcp_servers\.hikari\]/);
          assert.match(runtimeConfig, /mcp-contract\/stdio-server\.js/);
          assert.match(runtimeConfig, /required = true/);
          assert.match(runtimeConfig, /enabled_tools = \["inventory_lookup", "chemical_lookup", "record_lookup", "protocol_lookup", "protocol_generation"/);
          assert.match(runtimeConfig, /"container"/);
          assert.match(runtimeConfig, /default_tools_approval_mode = "approve"/);
          assert.match(runtimeConfig, /HIKARI_AGENT_MCP_REQUEST_CONTEXT/);
          assert.match(runtimeConfig, /chat-request-env/);
          assert.match(runtimeConfig, /req-request-env/);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider lets project MEMORY.md provide project-scoped guidance', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-456'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-memory-storage-'));
        const projectDir = path.join(storageRoot, 'Project', 'Atlas');
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'MEMORY.md'), '# Project Memory\n\nName: Atlas\n', 'utf8');
        await provider.ensureCodexCliAgentsFile(projectDir);
        assert.equal(fs.existsSync(path.join(projectDir, 'AGENTS.md')), true);

        const fakeCodex = createFakeCodexBinary(storageRoot);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;

        try {
          const result = await provider.requestCodexCliText({
            prompt: 'Return OK only.',
            cwd: projectDir
          });
          const captured = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          assert.equal(result, 'OK from fake codex');
          assert.equal(fs.realpathSync(captured.cwd), fs.realpathSync(projectDir));
          assert.equal(fs.existsSync(path.join(projectDir, 'MEMORY.md')), true);
          assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills')), true);
          const protocolSkillPath = path.join(projectDir, '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md');
          assert.equal(fs.existsSync(protocolSkillPath), true);
          assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md')), true);
          const paperRetrievalSkillPath = path.join(projectDir, '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md');
          assert.equal(fs.existsSync(paperRetrievalSkillPath), true);
          const containerSkillPath = path.join(projectDir, '.agents', 'skills', 'hikari-container', 'SKILL.md');
          assert.equal(fs.existsSync(containerSkillPath), true);
          const protocolSkillText = fs.readFileSync(protocolSkillPath, 'utf8');
          assert.match(protocolSkillText, /Placeholder usage:/);
          assert.match(protocolSkillText, /Use bracket placeholders/);
          assert.match(protocolSkillText, /\[volume\]/);
          const paperRetrievalSkillText = fs.readFileSync(paperRetrievalSkillPath, 'utf8');
          assert.match(paperRetrievalSkillText, /mcp__hikari__paper_intake_search_experiments/);
          assert.match(paperRetrievalSkillText, /source_paths\.paper_md/);
          const containerSkillText = fs.readFileSync(containerSkillPath, 'utf8');
          assert.match(containerSkillText, /mcp__hikari__container/);
          assert.match(containerSkillText, /short `id` such as `1`, `2`, or `3`/);
          assert.match(containerSkillText, /Direct literals are feasible/);
          assert.equal(fs.existsSync(path.join(projectDir, 'AGENTS.md')), false);
          assert.equal(fs.existsSync(path.join(captured.codexHome, 'AGENTS.md')), true);
          assert.equal(captured.args.includes('project_doc_fallback_filenames=["MEMORY.md"]'), true);
          assert.equal(captured.args.includes('project_doc_max_bytes=65536'), true);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          fs.rmSync(storageRoot, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider streams assistant text from codex json events', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-stream'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-stream-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.HIKARI_FAKE_CODEX_STDOUT;
        const previousStderr = process.env.HIKARI_FAKE_CODEX_STDERR;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.HIKARI_FAKE_CODEX_STDOUT = [
          'Plain Codex status line',
          JSON.stringify({ type: 'event_msg', payload: { type: 'agent_reasoning', text: 'Checking project context.' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'I am checking inventory.' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'inventory_lookup', arguments: { query: 'SUMO1' } } }),
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'mcp_tool_call_end',
              invocation: {
                server: 'hikari',
                tool: 'inventory_lookup',
                arguments: { query: 'SUMO1' }
              },
              result: {
                Ok: {
                  content: [
                    { type: 'text', text: 'Found 2 matching records.' }
                  ],
                  isError: false
                }
              }
            }
          }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Final response from Codex.' }], phase: 'final_answer' } }),
          ''
        ].join('\n');
        process.env.HIKARI_FAKE_CODEX_STDERR = [
          'Codex stderr warning',
          '2026-06-04T14:45:32.625950Z ERROR codex_memories_write::phase2: Phase 2 no changes',
          ''
        ].join('\n');

        try {
          const streamEvents = [];
          const result = await provider.requestCodexCliText({
            prompt: 'Stream please.',
            cwd: workspaceDir,
            stream: true,
            onStream: (event) => {
              streamEvents.push(event);
            }
          });
          const captured = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          const assistantStreamEvents = streamEvents.filter((event) => event.type === 'codex_stream');
          assert.equal(result, 'OK from fake codex');
          assert.equal(captured.args.includes('--json'), true);
          assert.deepEqual(
            assistantStreamEvents.map((event) => event.text_delta),
            ['I am checking inventory.', 'Final response from Codex.']
          );
          assert.equal(assistantStreamEvents[assistantStreamEvents.length - 1].accumulated_text, 'Final response from Codex.');
          assert.equal(streamEvents.some((event) => event.type === 'codex_thinking' && event.thinking_text === 'Checking project context.'), true);
          assert.equal(streamEvents.some((event) => event.type === 'codex_thinking' && event.thinking_text === 'I am checking inventory.'), false);
          assert.equal(streamEvents.some((event) => event.type === 'codex_tool_call' && event.tool_name === 'inventory_lookup' && event.status === 'started'), true);
          assert.equal(streamEvents.some((event) => event.type === 'codex_tool_call' && event.status === 'completed' && /Found 2/.test(event.tool_call_text)), true);
          const displayEvents = streamEvents.filter((event) => event.type === 'codex_cli_display');
          assert.equal(displayEvents.some((event) => event.display_text === 'Plain Codex status line' && event.display_kind === 'stdout'), true);
          assert.equal(displayEvents.some((event) => event.display_text === 'Codex stderr warning' && event.display_kind === 'stderr'), true);
          assert.equal(displayEvents.some((event) => /codex_memories_write/u.test(event.display_text || '')), false);
          assert.equal(displayEvents.some((event) => event.display_text === 'Checking project context.' && event.display_kind === 'thinking'), true);
          assert.equal(displayEvents.some((event) => event.display_text === 'I am checking inventory.' && event.display_kind === 'assistant'), true);
          assert.equal(displayEvents.some((event) => event.display_text === 'I am checking inventory.' && event.display_kind === 'thinking'), false);
          assert.equal(displayEvents.some((event) => event.display_kind === 'tool' && /inventory_lookup/.test(event.display_text) && /SUMO1/.test(event.display_text)), true);
          assert.equal(displayEvents.some((event) => event.display_kind === 'assistant' && event.display_text === 'Final response from Codex.'), true);
          assert.equal(displayEvents.some((event) => /^\s*\{/.test(event.display_text || '')), false);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDOUT;
          }
          if (typeof previousStderr === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDERR = previousStderr;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDERR;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider streams assistant messages appended only to the live transcript', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-transcript-live'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-live-transcript-'));
        const sessionId = 'codex-live-transcript-session-1';
        const transcriptPath = path.join(
          process.env.CODEX_HOME,
          'sessions',
          '2026',
          '06',
          '04',
          `rollout-${sessionId}.jsonl`
        );
        const fakeCodex = createFakeCodexTranscriptWriterBinary(workspaceDir, sessionId, transcriptPath);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousFollowInterval = process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS = '50';

        try {
          let requestResolved = false;
          const streamEvents = [];
          const result = await provider.requestCodexCliText({
            prompt: 'Stream transcript please.',
            cwd: workspaceDir,
            stream: true,
            onStream: (event) => {
              streamEvents.push({
                ...event,
                requestResolved
              });
            }
          });
          requestResolved = true;
          const transcriptStreamEvent = streamEvents.find((event) => (
            event.type === 'codex_stream'
              && event.text_delta === 'Transcript-only commentary is live.'
          ));
          assert.equal(result, 'OK from fake codex');
          assert.equal(Boolean(transcriptStreamEvent), true);
          assert.equal(transcriptStreamEvent.requestResolved, false);
          assert.equal(streamEvents.some((event) => (
            event.type === 'codex_cli_display'
              && event.display_kind === 'assistant'
              && event.display_text === 'Transcript-only commentary is live.'
          )), true);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousFollowInterval === 'string') {
            process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS = previousFollowInterval;
          } else {
            delete process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider replays assistant transcript text into display rows', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-replay'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-replay-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const sessionId = 'codex-replay-session-1';
        const transcriptDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '21');
        fs.mkdirSync(transcriptDir, { recursive: true });
        fs.writeFileSync(path.join(transcriptDir, `rollout-${sessionId}.jsonl`), [
          JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '# Hikari Codex Chat Turn\nCurrent user request: do not render this envelope.' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I found the package file.' }], phase: 'commentary' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Replay final answer.' }], phase: 'final_answer' } }),
          ''
        ].join('\n'), 'utf8');
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.HIKARI_FAKE_CODEX_STDOUT;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.HIKARI_FAKE_CODEX_STDOUT = `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`;

        try {
          const streamEvents = [];
          const result = await provider.requestCodexCliText({
            prompt: 'Replay transcript please.',
            cwd: workspaceDir,
            stream: true,
            onStream: (event) => {
              streamEvents.push(event);
            }
          });
          const displayEvents = streamEvents.filter((event) => event.type === 'codex_cli_display');
          assert.equal(result, 'OK from fake codex');
          assert.equal(displayEvents.some((event) => event.display_kind === 'assistant' && event.display_text === 'I found the package file.'), true);
          assert.equal(displayEvents.some((event) => event.display_kind === 'assistant' && event.display_text === 'Replay final answer.'), true);
          assert.equal(displayEvents.some((event) => /Hikari Codex Chat Turn/.test(event.display_text || '')), false);
          assert.equal(displayEvents.some((event) => /^\s*\{/.test(event.display_text || '')), false);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDOUT;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider reports no-credit json failures before plugin warnings', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-no-credits'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-no-credits-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.HIKARI_FAKE_CODEX_STDOUT;
        const previousStderr = process.env.HIKARI_FAKE_CODEX_STDERR;
        const previousExitCode = process.env.HIKARI_FAKE_CODEX_EXIT_CODE;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.HIKARI_FAKE_CODEX_STDOUT = [
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'token_count',
              rate_limits: {
                credits: {
                  has_credits: false,
                  unlimited: false,
                  balance: '0'
                }
              }
            }
          }),
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              last_agent_message: null
            }
          }),
          ''
        ].join('\n');
        process.env.HIKARI_FAKE_CODEX_STDERR = [
          '2026-05-15T00:26:05Z  WARN codex_core_plugins::loader: failed to load plugin: plugin is not installed',
          ''
        ].join('\n');
        process.env.HIKARI_FAKE_CODEX_EXIT_CODE = '1';

        try {
          let caughtError = null;
          try {
            await provider.requestCodexCliText({
              prompt: 'Return OK only.',
              cwd: workspaceDir,
              stream: true,
              onStream: () => {}
            });
          } catch (error) {
            caughtError = error;
          }

          assert.equal(Boolean(caughtError), true);
          assert.match(caughtError.message, /no available credits/);
          assert.doesNotMatch(caughtError.message, /codex_core_plugins/);
          assert.match(caughtError.stderr, /codex_core_plugins/);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDOUT;
          }
          if (typeof previousStderr === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDERR = previousStderr;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDERR;
          }
          if (typeof previousExitCode === 'string') {
            process.env.HIKARI_FAKE_CODEX_EXIT_CODE = previousExitCode;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_EXIT_CODE;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
  }
};
