module.exports = function registerCodexCliProviderSuitePart04(context = {}) {
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
    test('codex cli provider carries Plotly graph artifacts from MCP tool output', () => {
      const provider = loadProvider();
      const progressEvents = provider.extractCodexJsonEventProgress({
        type: 'response_item',
        payload: {
          type: 'item.completed',
          item: {
            type: 'mcp_tool_call',
            server: 'hikari',
            tool: 'plotly_graph',
            result: {
              structured_content: {
                ok: true,
                status: 'created',
                summary: 'Created dose response plot.',
                graph: {
                  id: '1',
                  name: 'Dose response',
                  figure: {
                    data: [
                      { type: 'scatter', mode: 'markers', x: [1, 2], y: [3, 4], name: 'Std' }
                    ],
                    layout: { title: { text: 'Dose response' } },
                    config: { responsive: true }
                  }
                }
              }
            }
          }
        }
      });

      const graphEvent = progressEvents.find((event) => event.tool_name === 'plotly_graph');
      assert.equal(graphEvent?.status, 'completed');
      assert.equal(graphEvent?.plotly_graph_artifact?.id, '1');
      assert.equal(graphEvent?.plotly_graph_artifact?.figure?.data?.[0]?.name, 'Std');
      assert.equal(graphEvent?.plotly_graph_artifact?.figure?.layout?.title?.text, 'Dose response');
    });
    test('codex agent runtime recovers ask_user clarification from tool stream when final text is prose', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const askUserResult = {
        ok: true,
        status: 'needs_user_answer',
        mcp_tool: 'ask_user',
        user_question: {
          question: 'Which project should I use?',
          options: [
            { label: 'Atlas', value: 'Use Atlas.' },
            { label: 'All projects', value: 'Search all projects.' }
          ],
          allow_custom: true
        },
        final_response: {
          status: 'needs_more_info',
          assistant_text: 'Which project should I use?',
          follow_up_questions: ['Which project should I use?'],
          user_question: {
            question: 'Which project should I use?',
            options: [
              { label: 'Atlas', value: 'Use Atlas.' },
              { label: 'All projects', value: 'Search all projects.' }
            ],
            allow_custom: true
          },
          reasoning_summary: 'Waiting for one project-scope clarification.',
          citations: []
        }
      };
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'completed',
            tool_name: 'ask_user',
            tool_call_text: `ask_user: ${JSON.stringify(askUserResult)}`,
            tool_output_text: JSON.stringify(askUserResult),
            event_type: 'tool_call_completed'
          });
          return {
            text: 'I need one detail before I can answer well.',
            metadata: {
              session_id: 'codex-clarify-stream-session'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Summarize the latest notes.',
        model: 'gpt-5.4',
        cwd: '/tmp/hikari-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.parser.clarification_reason, 'Which project should I use?');
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.answer, 'Which project should I use?');
      assert.equal(result.codex_agent.codex_session_id, 'codex-clarify-stream-session');
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Use Atlas.', 'Search all projects.']
      );
    });
    test('codex agent runtime recovers ask_user clarification from tool arguments', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'started',
            tool_name: 'ask_user',
            tool_call_text: 'ask_user: {"question":"Which project scope should I use?","options":[{"label":"All projects","value":"Search all projects"},{"label":"PD-1 Nanobody Binder Discovery","value":"Use the PD-1 project"}],"allow_custom":false}',
            event_type: 'function_call'
          });
          return {
            text: 'Which project scope should I use?',
            metadata: {
              session_id: 'codex-clarify-args-session'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Ask for project scope first.',
        model: 'gpt-5.4',
        cwd: '/tmp/hikari-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.user_question.allow_custom, false);
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Search all projects', 'Use the PD-1 project']
      );
    });
    test('codex agent runtime treats non-json output as normal assistant text', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const traceRows = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async () => ({
          text: 'Plain answer from Codex.',
          metadata: {
            session_id: 'codex-plain-session'
          }
        }),
        recordAgentLlmTrace: async (_traceContext, event = {}) => {
          traceRows.push(event);
        }
      });

      const result = await runtime.run({
        message: 'Answer plainly.',
        model: 'gpt-5.4',
        traceContext: { requestId: 'req-codex-raw', rows: [], entries: [] }
      });

      assert.equal(result.ok, true);
      assert.equal(result.codex_agent.answer, 'Plain answer from Codex.');
      assert.equal(result.codex_session_id, 'codex-plain-session');
      assert.equal(result.warnings, undefined);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_completed'), true);
    });
    test('codex agent runtime normalizes authored protocol prose through protocol generation fallback', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const toolCalls = [];
      const lifecycleEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async () => ({
          text: [
            'I generated this as a standard paper-derived protocol. The Hikari protocol-generation MCP tool is not exposed in this Codex session, so I could not queue it inside Hikari for approval/save.',
            '',
            '**Protocol: TEVp-ZF5.3 Fusion Protein Expression and Validation**',
            '',
            'This is reconstructed from the transformed paper methods.',
            '',
            '**Materials**',
            '- pET28a-TEVp-ZF5.3 plasmid',
            '- E. coli BL21(DE3)',
            '- IPTG',
            '',
            '**Step-by-Step**',
            '1. Clone ZF5.3 onto the C terminus of TEVp and confirm by sequencing.',
            '2. Transform the plasmid into BL21(DE3) cells and select colonies.',
            '3. Induce expression with IPTG and purify the fusion protein.',
            '',
            '**Controls**',
            '- Uninduced culture control',
            '',
            '**Key Caveats**',
            '- Convert rpm to g for the local rotor.'
          ].join('\n'),
          metadata: {
            session_id: 'codex-protocol-prose-session'
          }
        }),
        runTool: async (toolId, args, snapshot, context) => {
          toolCalls.push({ toolId, args, snapshot, context });
          return {
            ok: true,
            result: {
              ok: true,
              status: 'normalized',
              protocol: {
                name: args.protocol.name,
                purpose: args.protocol.purpose,
                materials: args.protocol.materials,
                steps: args.protocol.steps.map((step, index) => ({
                  id: `step-${index + 1}`,
                  text: step.text,
                  placeholders: []
                })),
                troubleshooting: args.protocol.troubleshooting
              },
              summary: 'Prepared protocol JSON.'
            }
          };
        },
        recordLifecycleEvent: (_recorder, event = {}) => {
          lifecycleEvents.push(event);
        }
      });

      const result = await runtime.run({
        message: 'Generate a step-by-step experimental protocol from this paper. Include materials, timing, controls, and key caveats.',
        model: 'gpt-5.4',
        cwd: '/tmp/hikari-workspace',
        snapshot: {
          activePaper: {
            id: 'paper-1',
            title: 'Protease specificity paper'
          }
        }
      });

      assert.equal(result.ok, true);
      assert.equal(toolCalls.length, 1);
      assert.equal(toolCalls[0].toolId, 'protocol-generation');
      assert.equal(toolCalls[0].args.protocol.name, 'TEVp-ZF5.3 Fusion Protein Expression and Validation');
      assert.doesNotMatch(toolCalls[0].args.protocol.purpose, /protocol_generation/i);
      assert.doesNotMatch(toolCalls[0].args.protocol.purpose, /protocol-generation/i);
      assert.doesNotMatch(toolCalls[0].args.protocol.purpose, /not exposed/i);
      assert.doesNotMatch(toolCalls[0].args.protocol.purpose, /not visible/i);
      assert.deepEqual(toolCalls[0].args.protocol.materials, [
        'pET28a-TEVp-ZF5.3 plasmid',
        'E. coli BL21(DE3)',
        'IPTG'
      ]);
      assert.equal(toolCalls[0].args.protocol.steps.length, 3);
      assert.match(toolCalls[0].args.protocol.troubleshooting, /Controls:/);
      assert.match(toolCalls[0].args.protocol.troubleshooting, /Key caveats:/);
      assert.equal(result.protocol_generation.status, 'awaiting_user_approval');
      assert.equal(result.protocol_generation.save_requested, true);
      assert.equal(result.protocol_generation.protocol.name, 'TEVp-ZF5.3 Fusion Protein Expression and Validation');
      assert.equal(result.codex_agent.answer, 'The protocol is ready for review.');
      assert.equal(
        lifecycleEvents.some((event) => (
          event.stage === 'codex_agent_direct_tool_fallback'
          && event.status === 'started'
          && /protocol prose/.test(event.message)
        )),
        true
      );
    });
    test('codex agent runtime resumes the Codex session stored on a Hikari chat', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const calls = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          return {
            text: 'Continuing the same Codex chat.',
            metadata: {
              session_id: 'codex-chat-session-1',
              resumed_session_id: 'codex-chat-session-1',
              command: 'exec resume'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Continue from there.',
        model: 'gpt-5.4',
        cwd: '/tmp/hikari-workspace',
        chatSessionId: 'hikari-chat-1',
        codexSessionId: 'codex-chat-session-1'
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].resumeSessionId, 'codex-chat-session-1');
      assert.equal(calls[0].returnMetadata, true);
      const mcpContext = JSON.parse(calls[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT);
      assert.equal(mcpContext.chatSessionId, 'hikari-chat-1');
      assert.equal(mcpContext.codexSessionId, 'codex-chat-session-1');
      assert.equal(result.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.resumed_codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_agent.answer, 'Continuing the same Codex chat.');
    });
    test('agent MCP stdio server forwards request context from the provider environment', async () => {
      const { createAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

      let capturedContext = null;
      const { server, connect } = createAgentMcpStdioServer({
        env: {
          HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({
            provider: 'codex',
            model: 'gpt-5.4',
            project: {
              id: 'proj-1',
              name: 'Atlas'
            },
            traceRequestId: 'req-ctx'
          })
        },
        gateway: {
          async callGatewayTool(_name, _args, context = {}) {
            capturedContext = context;
            return {
              ok: true,
              results: []
            };
          }
        }
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await connect(serverTransport);
      const client = new Client(
        { name: 'hikari-test-client', version: '0.0.1' },
        { capabilities: {} }
      );
      await client.connect(clientTransport);

      try {
        const response = await client.callTool({
          name: 'notebook_lookup',
          arguments: { query: 'paper' }
        });

        assert.equal(capturedContext.provider, 'codex');
        assert.equal(capturedContext.model, 'gpt-5.4');
        assert.equal(capturedContext.project.name, 'Atlas');
        assert.equal(capturedContext.traceRequestId, 'req-ctx');
        assert.equal(capturedContext.mcpRequest.method, 'tools/call');
        assert.equal(capturedContext.mcpRequest.params.name, 'notebook_lookup');
        assert.equal(response.isError, false);
        assert.equal(Array.isArray(response.content), true);
        assert.equal(response.content[0].type, 'text');
        assert.equal(response.content[0].text.includes('"ok": true'), true);
      } finally {
        await client.close();
        await server.close();
      }
    });
    test('agent MCP stdio server front-loads literature-search paper workflow fields', async () => {
      const { createAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      const bulkyItems = Array.from({ length: 20 }, (_unused, index) => ({
        title: `Raw candidate ${index + 1}`,
        source: 'crossref',
        summary: 'x'.repeat(1600)
      }));
      const gatewayResult = {
        ok: true,
        status: 'completed',
        mcp_tool: 'literature_search',
        app_tool: 'literature-search',
        output: {
          ok: true,
          tool_name: 'literature_search',
          result: {
            ok: true,
            status: 'completed',
            query: 'EGFR kinase inhibitor resistance',
            summary: 'Found 20 candidates and selected 1 paper.',
            items: bulkyItems,
            source_counts: { crossref: 20 },
            source_errors: {},
            selected_papers: [{
              paper_id: 'paper-1',
              paper_title: 'EGFR resistance mechanisms',
              source: 'pubmed',
              doi: '10.1000/egfr',
              url: 'https://example.org/egfr',
              summary: 'A focused paper on EGFR inhibitor resistance.'
            }],
            downloaded_papers: [{
              paper_id: 'paper-1',
              paper_title: 'EGFR resistance mechanisms',
              ok: true,
              status: 'downloaded',
              relative_path: 'KnowledgeBase/papers.md/paper-1/paper.pdf',
              knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/paper-1/paper.md'
            }],
            loaded_context_blocks: [{
              paper_id: 'paper-1',
              paper_title: 'EGFR resistance mechanisms',
              section_label: 'Results',
              source: 'llm_pdf_text_read',
              excerpt: 'EGFR secondary mutations and bypass signaling were associated with acquired resistance.',
              relevance_reason: 'Directly supports the requested resistance mechanism.'
            }],
            papers_read_count: 1
          }
        }
      };

      let literatureGatewayCalls = 0;
      const { server, connect } = createAgentMcpStdioServer({
        gateway: {
          async callGatewayTool() {
            literatureGatewayCalls += 1;
            return gatewayResult;
          }
        }
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await connect(serverTransport);
      const client = new Client(
        { name: 'hikari-test-client', version: '0.0.1' },
        { capabilities: {} }
      );
      await client.connect(clientTransport);

      try {
        const response = await client.callTool({
          name: 'literature_search',
          arguments: { query: 'EGFR kinase inhibitor resistance', limit: 4 }
        });
        const textPayload = JSON.parse(response.content[0].text);

        assert.equal(response.isError, false);
        assert.equal(textPayload.app_tool, 'literature-search');
        assert.equal(textPayload.counts.candidate_count, 20);
        assert.equal(textPayload.counts.selected_count, 1);
        assert.equal(textPayload.counts.context_block_count, 1);
        assert.equal(textPayload.source_counts.crossref, 20);
        assert.equal(textPayload.selected_papers[0].paper_title, 'EGFR resistance mechanisms');
        assert.equal(textPayload.downloaded_papers[0].knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/paper-1/paper.md');
        assert.equal(textPayload.loaded_context_blocks[0].section_label, 'Results');
        assert.equal(Object.prototype.hasOwnProperty.call(textPayload, 'items'), false);
        assert.equal(response.structuredContent.output.result.items.length, 20);
        assert.ok(response.content[0].text.length < JSON.stringify(gatewayResult, null, 2).length / 2);

        const repeatedResponse = await client.callTool({
          name: 'literature_search',
          arguments: { query: 'EGFR resistance title lookup' }
        });
        const repeatedPayload = JSON.parse(repeatedResponse.content[0].text);
        assert.equal(repeatedResponse.isError, true);
        assert.equal(repeatedPayload.status, 'rejected');
        assert.match(repeatedPayload.error, /already completed one literature_search request/i);
        assert.equal(literatureGatewayCalls, 1);
      } finally {
        await client.close();
        await server.close();
      }
    });
    test('agent MCP stdio server registers paper-intake direct tools', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-paper-intake-'));
      const paperId = 'continuous_evolution_glue_tags';
      const paperDir = path.join(workspaceDir, 'KnowledgeBase', 'papers.md', paperId);
      fs.mkdirSync(paperDir, { recursive: true });
      fs.writeFileSync(path.join(paperDir, 'intake.json'), JSON.stringify({
        schema_version: 1,
        paper_id: paperId,
        doc_type: 'research_paper',
        title: 'Continuous evolution of compact protein degradation tags',
        doi: '10.0000/test',
        one_sentence_summary: 'MG-PACE selected compact degron tags regulated by selective molecular glues.',
        project_ids: ['project-1'],
        experiments: [{
          id: 'e1',
          title: 'Phage-assisted continuous evolution selects SD40 variants',
          technique: 'phage-assisted continuous evolution',
          variables: 'SD40 peptide library and molecular glue concentration',
          figure_ref: 'Fig. 2',
          outcome: 'Compact degron tags were enriched.'
        }]
      }, null, 2), 'utf8');

      const { createAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

      const { server, connect } = createAgentMcpStdioServer({
        env: {
          HIKARI_AGENT_MCP_WORKSPACE: workspaceDir,
          HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({ project: { id: 'project-1' } })
        }
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await connect(serverTransport);
      const client = new Client(
        { name: 'hikari-test-client', version: '0.0.1' },
        { capabilities: {} }
      );
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const toolNames = listed.tools.map((tool) => tool.name);
        assert.equal(toolNames.includes('paper_intake_search_summaries'), true);
        assert.equal(toolNames.includes('paper_intake_search_experiments'), true);
        assert.equal(toolNames.includes('paper_intake_list_project_summaries'), true);

        const summaryResponse = await client.callTool({
          name: 'paper_intake_search_summaries',
          arguments: { query: 'MG-PACE molecular glue', limit: 3 }
        });
        const summaryResult = JSON.parse(summaryResponse.content[0].text);
        assert.equal(summaryResponse.isError, false);
        assert.equal(summaryResult.ok, true);
        assert.equal(summaryResult.status, 'matched');
        assert.equal(summaryResult.items[0].paper_id, paperId);

        const experimentResponse = await client.callTool({
          name: 'paper_intake_search_experiments',
          arguments: { query: 'phage assisted continuous evolution SD40', limit: 3 }
        });
        const experimentResult = JSON.parse(experimentResponse.content[0].text);
        assert.equal(experimentResponse.isError, false);
        assert.equal(experimentResult.ok, true);
        assert.equal(experimentResult.status, 'matched');
        assert.equal(experimentResult.items[0].experiment.technique, 'phage-assisted continuous evolution');

        const projectResponse = await client.callTool({
          name: 'paper_intake_list_project_summaries',
          arguments: { limit: 3 }
        });
        const projectResult = JSON.parse(projectResponse.content[0].text);
        assert.equal(projectResponse.isError, false);
        assert.equal(projectResult.ok, true);
        assert.equal(projectResult.status, 'matched');
        assert.equal(projectResult.items[0].paper_id, paperId);
      } finally {
        await client.close();
        await server.close();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
    test('agent MCP app host executes app tools through the SDK streamable HTTP bridge', async () => {
      const env = {};
      const calls = [];
      const { createAgentMcpHost } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'host.js'
      ));
      const {
        createAgentMcpHostToolRunner,
        resolveAgentMcpEndpointUrl
      } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'host-client.js'
      ));
      const {
        HIKARI_MCP_TOOL_TIMEOUT_MS
      } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'constants.js'
      ));
      const host = createAgentMcpHost({
        env,
        token: 'test-sdk-token',
        getSnapshot: () => ({
          source: 'default-snapshot'
        }),
        getContextDefaults: () => ({
          cwd: '/workspace',
          dataFilePath: '/workspace/hikari-data.json',
          fallbackDataFilePath: '/workspace/hikari-data.json'
        }),
        runTool: async (toolId, args, snapshot, context) => {
          calls.push({
            toolId,
            args,
            snapshot,
            context
          });
          return {
            ok: true,
            status: 'completed',
            echo: args.query
          };
        }
      });

      try {
        const started = await host.ensureStarted();
        assert.match(started.url, /\/mcp$/);
        assert.equal(env.HIKARI_AGENT_MCP_HOST, started.url);
        assert.equal(String(resolveAgentMcpEndpointUrl('http://127.0.0.1:43123')), 'http://127.0.0.1:43123/mcp');

        const runTool = createAgentMcpHostToolRunner({ env });
        assert.equal(HIKARI_MCP_TOOL_TIMEOUT_MS, 300000);
        const output = await runTool(
          'literature-search',
          { query: 'MG-PACE' },
          {},
          { traceRequestId: 'req-sdk-bridge' }
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].toolId, 'literature-search');
        assert.deepEqual(calls[0].args, { query: 'MG-PACE' });
        assert.deepEqual(calls[0].snapshot, { source: 'default-snapshot' });
        assert.equal(calls[0].context.cwd, '/workspace');
        assert.equal(calls[0].context.traceRequestId, 'req-sdk-bridge');
        assert.equal(calls[0].context.agentMcp, true);
        assert.equal(output.ok, true);
        assert.equal(output.echo, 'MG-PACE');
      } finally {
        await host.close();
      }
    });
    test('agent MCP app host rejects a duplicate literature search across client reconnects', async () => {
      const { createAgentMcpHost } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'host.js'
      ));
      const { createAgentMcpHostToolRunner } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'host-client.js'
      ));
      const env = {};
      let literatureSearchCalls = 0;
      const host = createAgentMcpHost({
        env,
        runTool: async (toolId) => {
          assert.equal(toolId, 'literature-search');
          literatureSearchCalls += 1;
          return { ok: true, status: 'completed', summary: 'Found papers.' };
        }
      });
      const { url, token } = await host.ensureStarted();
      const runTool = createAgentMcpHostToolRunner({ hostUrl: url, token });

      try {
        const first = await runTool('literature-search', { query: 'molecular glue degraders' }, {}, {
          traceRequestId: 'literature-turn-1'
        });
        const repeated = await runTool('literature-search', { query: 'exact title lookup' }, {}, {
          traceRequestId: 'literature-turn-1'
        });

        assert.equal(first.ok, true);
        assert.equal(repeated.ok, false);
        assert.equal(repeated.status, 'rejected');
        assert.match(repeated.error, /already completed one literature_search request/i);
        assert.equal(literatureSearchCalls, 1);
      } finally {
        await host.close();
      }
    });
    test('packaged MCP runtime unpacks paper modules required by direct paper tools', () => {
      const forgeConfigSource = fs.readFileSync(path.join(__dirname, 'forge.config.js'), 'utf8');
      assert.match(forgeConfigSource, /src\/main\/helpers\/agent/);
      assert.match(forgeConfigSource, /src\/main\/papers/);
      assert.match(forgeConfigSource, /node_modules\/@modelcontextprotocol\/sdk/);
    });
    test('codex agent MCP config includes the app host callback when available', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-mcp-config-'));
      const previousAgentHost = process.env.HIKARI_AGENT_MCP_HOST;
      const previousAgentToken = process.env.HIKARI_AGENT_MCP_TOKEN;
      const previousHikariHost = process.env.HIKARI_CODEX_MCP_HOST;
      const previousHikariToken = process.env.HIKARI_CODEX_MCP_TOKEN;
      process.env.HIKARI_AGENT_MCP_HOST = 'http://127.0.0.1:43123';
      process.env.HIKARI_AGENT_MCP_TOKEN = 'test-token';
      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        const configText = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(configText, /\[mcp_servers\.hikari\]/);
        assert.match(configText, /HIKARI_AGENT_MCP_HOST/);
        assert.match(configText, /HIKARI_AGENT_MCP_HOST/);
        assert.match(configText, /HIKARI_CODEX_MCP_HOST/);
        assert.match(configText, /HIKARI_CODEX_MCP_HOST/);
        assert.match(configText, /http:\/\/127\.0\.0\.1:43123/);
        assert.match(configText, /HIKARI_AGENT_MCP_TOKEN/);
        assert.match(configText, /HIKARI_AGENT_MCP_TOKEN/);
        assert.match(configText, /HIKARI_CODEX_MCP_TOKEN/);
        assert.match(configText, /HIKARI_CODEX_MCP_TOKEN/);
      } finally {
        if (typeof previousAgentHost === 'string') {
          process.env.HIKARI_AGENT_MCP_HOST = previousAgentHost;
        } else {
          delete process.env.HIKARI_AGENT_MCP_HOST;
        }
        if (typeof previousAgentToken === 'string') {
          process.env.HIKARI_AGENT_MCP_TOKEN = previousAgentToken;
        } else {
          delete process.env.HIKARI_AGENT_MCP_TOKEN;
        }
        if (typeof previousHikariHost === 'string') {
          process.env.HIKARI_CODEX_MCP_HOST = previousHikariHost;
        } else {
          delete process.env.HIKARI_CODEX_MCP_HOST;
        }
        if (typeof previousHikariToken === 'string') {
          process.env.HIKARI_CODEX_MCP_TOKEN = previousHikariToken;
        } else {
          delete process.env.HIKARI_CODEX_MCP_TOKEN;
        }
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
    test('codex agent MCP config carries per-request context into the stdio server env', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-mcp-request-env-'));
      try {
        const provider = loadProvider();
        const requestContext = JSON.stringify({
          provider: 'codex',
          model: 'gpt-5.5',
          cwd: workspaceDir,
          chatSessionId: 'chat-mq0exc0j-palwrhxm',
          traceRequestId: '1780633035654-8d479f65'
        });
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir, {
          envOverrides: {
            HIKARI_AGENT_MCP_REQUEST_CONTEXT: requestContext,
            HIKARI_AGENT_MCP_REQUEST_CONTEXT: requestContext,
            HIKARI_CODEX_REQUEST_CONTEXT: requestContext,
            HIKARI_CODEX_REQUEST_CONTEXT: requestContext
          }
        });
        const configText = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(configText, /\[mcp_servers\.hikari\]/);
        assert.match(configText, /required = true/);
        assert.match(configText, /enabled_tools = \["inventory_lookup", "chemical_lookup", "notebook_lookup", "protocol_lookup", "protocol_generation"/);
        assert.match(configText, /"container"/);
        assert.match(configText, /"assay_table"/);
        assert.match(configText, /"plotly_graph"/);
        assert.match(configText, /default_tools_approval_mode = "approve"/);
        assert.match(configText, /tool_timeout_sec = 300/);
        assert.match(configText, /\[mcp_servers\.hikari\.tools\.protocol_generation\]/);
        assert.match(configText, /HIKARI_AGENT_MCP_REQUEST_CONTEXT/);
        assert.match(configText, /HIKARI_AGENT_MCP_REQUEST_CONTEXT/);
        assert.match(configText, /HIKARI_CODEX_REQUEST_CONTEXT/);
        assert.match(configText, /HIKARI_CODEX_REQUEST_CONTEXT/);
        assert.match(configText, /chat-mq0exc0j-palwrhxm/);
        assert.match(configText, /1780633035654-8d479f65/);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
    test('agent MCP initializer starts host, writes runtime config options, and releases official skills', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-init-workspace-'));
      const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-init-storage-'));
      const dataFilePath = path.join(workspaceDir, 'hikari-data.json');
      const runtimeHome = path.join(workspaceDir, 'Config', 'codex-cli-home');
      let hostStartCount = 0;
      let runtimeWrite = null;
      fs.writeFileSync(dataFilePath, JSON.stringify({
        settings: {
          storagePath: storageRoot
        },
        projects: [{
          id: 'project-1',
          name: 'Atlas Project'
        }]
      }, null, 2), 'utf8');

      try {
        const { createAgentMcpInitializer } = require(path.join(
          __dirname,
          'src',
          'main',
          'helpers',
          'main',
          'agent-mcp-initializer.js'
        ));
        const initializer = createAgentMcpInitializer({
          cleanText: (value, maxLength = 2000) => {
            const text = String(value || '').trim();
            return maxLength > 0 ? text.slice(0, maxLength) : text;
          },
          mcpHost: {
            ensureStarted: async () => {
              hostStartCount += 1;
              return {
                url: 'http://127.0.0.1:49876',
                token: 'initializer-token'
              };
            }
          },
          getCodexCliWorkingDirectory: () => workspaceDir,
          getDefaultDataFilePath: () => dataFilePath,
          getBundlePaths: ({ dataFilePath: bundleDataFilePath, storagePath }) => ({
            dataFilePath: bundleDataFilePath,
            storageRootPath: storagePath || path.dirname(bundleDataFilePath)
          }),
          ensureCodexCliRuntimeHome: async (cwd, options = {}) => {
            runtimeWrite = {
              cwd,
              options
            };
            fs.mkdirSync(runtimeHome, { recursive: true });
            return runtimeHome;
          }
        });

        const result = await initializer.initialize({
          dataFilePath,
          fallbackDataFilePath: dataFilePath,
          envOverrides: {
            HIKARI_AGENT_MCP_REQUEST_CONTEXT: '{"traceRequestId":"req-init"}'
          }
        });
        const rootSkillPath = path.join(workspaceDir, '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const storageSkillPath = path.join(storageRoot, '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const projectSkillPath = path.join(storageRoot, 'Project', 'Atlas_Project', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const projectContainerSkillPath = path.join(storageRoot, 'Project', 'Atlas_Project', '.agents', 'skills', 'hikari-container', 'SKILL.md');
        const projectAssayPlotlySkillPath = path.join(storageRoot, 'Project', 'Atlas_Project', '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md');

        assert.equal(result.ok, true);
        assert.equal(hostStartCount, 1);
        assert.equal(result.host_url, 'http://127.0.0.1:49876');
        assert.equal(result.has_token, true);
        assert.equal(result.runtime_home, runtimeHome);
        assert.equal(runtimeWrite.cwd, workspaceDir);
        assert.equal(runtimeWrite.options.mcpHostUrl, 'http://127.0.0.1:49876');
        assert.equal(runtimeWrite.options.mcpToken, 'initializer-token');
        assert.equal(runtimeWrite.options.dataFilePath, dataFilePath);
        assert.equal(runtimeWrite.options.storagePath, storageRoot);
        assert.equal(runtimeWrite.options.envOverrides.HIKARI_AGENT_MCP_HOST, 'http://127.0.0.1:49876');
        assert.equal(runtimeWrite.options.envOverrides.HIKARI_CODEX_MCP_TOKEN, 'initializer-token');
        assert.equal(runtimeWrite.options.envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT, '{"traceRequestId":"req-init"}');
        assert.equal(fs.existsSync(rootSkillPath), true);
        assert.equal(fs.existsSync(storageSkillPath), true);
        assert.equal(fs.existsSync(projectSkillPath), true);
        assert.equal(fs.existsSync(projectContainerSkillPath), true);
        assert.equal(fs.existsSync(projectAssayPlotlySkillPath), true);
        assert.equal(result.workspace_paths.includes(workspaceDir), true);
        assert.equal(result.workspace_paths.includes(storageRoot), true);
        assert.equal(result.workspace_paths.includes(path.join(storageRoot, 'Project', 'Atlas_Project')), true);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        fs.rmSync(storageRoot, { recursive: true, force: true });
      }
    });
    test('agent MCP initializer does not inject default hikari data path without request context', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-init-no-default-'));
      let runtimeWrite = null;
      try {
        const { createAgentMcpInitializer } = require(path.join(
          __dirname,
          'src',
          'main',
          'helpers',
          'main',
          'agent-mcp-initializer.js'
        ));
        const initializer = createAgentMcpInitializer({
          cleanText: (value, maxLength = 2000) => {
            const text = String(value || '').trim();
            return maxLength > 0 ? text.slice(0, maxLength) : text;
          },
          mcpHost: {
            ensureStarted: async () => ({
              url: 'http://127.0.0.1:49877',
              token: 'initializer-token'
            })
          },
          getCodexCliWorkingDirectory: () => workspaceDir,
          getDefaultDataFilePath: () => path.join(workspaceDir, 'hikari-data.json'),
          getBundlePaths: () => ({}),
          ensureCodexCliRuntimeHome: async (cwd, options = {}) => {
            runtimeWrite = { cwd, options };
            return path.join(workspaceDir, 'Config', 'codex-cli-home');
          },
          releaseOfficialMcpSkillsForWorkspace: async () => []
        });

        const result = await initializer.initialize({
          envOverrides: {
            HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({
              provider: 'codex',
              snapshot: {}
            })
          }
        });

        assert.equal(result.data_file_path, '');
        assert.equal(result.storage_path, '');
        assert.equal(runtimeWrite.options.dataFilePath, '');
        assert.equal(runtimeWrite.options.envOverrides.HIKARI_AGENT_DATA_FILE, undefined);
        assert.doesNotMatch(JSON.stringify(runtimeWrite), /hikari-data\.json/);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
  }
};
