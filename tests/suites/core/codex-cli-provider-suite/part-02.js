module.exports = function registerCodexCliProviderSuitePart02(context = {}) {
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
    test('agent MCP gateway exposes direct Hikari tools only', async () => {
      const { createAgentMcpGateway } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'gateway.js'
      ));
      const { createMcpToolDefinitions } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const { createAgentContainerRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-container.js'
      ));
      const { createAgentAssayTableRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-assay-table.js'
      ));
      const { createAgentPlotlyGraphRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'tools',
        'agent-plotly-graph.js'
      ));
      const containerRuntime = createAgentContainerRuntime({
        now: () => '2026-06-25T12:00:00.000Z'
      });
      const assayTableRuntime = createAgentAssayTableRuntime({
        now: () => '2026-06-25T12:00:00.000Z'
      });
      const plotlyGraphRuntime = createAgentPlotlyGraphRuntime({
        now: () => '2026-06-25T12:00:00.000Z'
      });
      const calls = [];
      const gateway = createAgentMcpGateway({
        runTool: async (toolId, args, snapshot, context) => {
          calls.push({ toolId, args, snapshot, context });
          if (toolId === 'container') {
            const result = await containerRuntime.execute(args);
            return {
              ok: result.ok !== false,
              result,
              items: Array.isArray(result.items) ? result.items : (result.container ? [result.container] : []),
              summary: result.summary
            };
          }
          if (toolId === 'assay-table') {
            const result = await assayTableRuntime.execute(args);
            return {
              ok: result.ok !== false,
              result,
              items: Array.isArray(result.items) ? result.items : (result.table ? [result.table] : []),
              summary: result.summary
            };
          }
          if (toolId === 'plotly-graph') {
            const result = await plotlyGraphRuntime.execute(args);
            return {
              ok: result.ok !== false,
              result,
              items: Array.isArray(result.items) ? result.items : (result.graph ? [result.graph] : []),
              summary: result.summary
            };
          }
          if (toolId === 'protocol-matching') {
            const selectedProtocol = {
              id: 'prot-1',
              name: 'Protein purification',
              purpose: 'Purify His-tagged protein.',
              score: 120
            };
            return {
              ok: true,
              result: {
                ranked_matches: [selectedProtocol],
                selected_protocol: selectedProtocol,
                selection_method: 'deterministic',
                rationale: 'Exact protocol candidate match.',
                items: [selectedProtocol]
              },
              items: [selectedProtocol],
              summary: 'Selected protocol Protein purification.'
            };
          }
          if (toolId === 'protocol-generation') {
            const savedProtocolId = args.save === true ? (args.protocol.id || 'protocol-saved-1') : '';
            return {
              ok: true,
              result: {
                ok: true,
                status: args.save === true ? 'saved' : 'normalized',
                protocol: {
                  ...(savedProtocolId ? { id: savedProtocolId } : {}),
                  name: args.protocol.name,
                  purpose: args.protocol.purpose || '',
                  materials: args.protocol.materials || [],
                  steps: args.protocol.steps.map((step, index) => ({
                    id: `step-${index + 1}`,
                    text: typeof step === 'string' ? step : step.text,
                    placeholders: []
                  })),
                  troubleshooting: args.protocol.troubleshooting || ''
                },
                summary: args.save === true ? 'Saved protocol JSON.' : 'Prepared protocol JSON.'
              },
              summary: args.save === true ? 'Saved protocol JSON.' : 'Prepared protocol JSON.'
            };
          }
          if (toolId === 'notebook-draft') {
            return {
              ok: true,
              result: {
                status: 'proposal_ready',
                project_name: args.project?.name || 'Atlas',
                selected_protocol: {
                  id: 'prot-1',
                  name: args.protocol_candidates?.[0] || 'Protein purification',
                  selection_method: 'direct',
                  rationale: 'Requested as a direct MCP notebook draft.'
                },
                source_workflow: args.workflow_id ? { id: args.workflow_id } : null,
                missing_placeholders: [],
                follow_up_questions: [],
                proposal_summary: 'Protein purification: prepare the next planned notebook page.',
                proposal: {
                  proposal_id: 'proposal-1',
                  title: 'Protein purification'
                },
                notebook: {
                  id: 'draft-1',
                  title: 'Protein purification'
                },
                summary: 'Planned notebook draft ready.'
              },
              summary: 'Planned notebook draft ready.'
            };
          }
          if (toolId === 'notebook-lookup') {
            const items = [
              {
                record_type: 'notebook',
                id: 'nb-1',
                title: 'Protein purification run 1',
                project_id: 'proj-1',
                project_name: 'Atlas',
                summary: 'Yield was low.',
                ...(args.detail === 'full' ? {
                  content: { result: 'Yield was low.', values: { batch: 'A1' } }
                } : {})
              }
            ];
            return {
              ok: true,
              result: {
                status: 'matched',
                action: args.action || 'search',
                detail: args.detail || 'summary',
                source: 'fallback_json',
                query: args.query,
                items
              },
              items,
              summary: 'Notebook lookup completed.'
            };
          }
          const items = [
            {
              kind: 'chemical',
              id: 'chem-1',
              name: 'PEI',
              amount: '25 g',
              location: 'Shelf A'
            },
            {
              kind: 'personal_sample',
              id: 'sample-1',
              name: 'PEI transfection sample'
            }
          ];
          return {
            ok: true,
            result: {
              status: 'matched',
              source: 'sqlite',
              query: args.query,
              items
            },
            items,
            summary: 'Inventory lookup completed.'
          };
        }
      });

      const mcpTools = createMcpToolDefinitions();
      const mcpToolNames = mcpTools.map((tool) => tool.name);
      const directToolDir = path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'direct-tools'
      );
      const helperDirectToolFiles = new Set(['index.js', 'shared.js', 'generic-app-tool.js']);
      const directToolFileNames = fs.readdirSync(directToolDir)
        .filter((name) => name.endsWith('.js') && !helperDirectToolFiles.has(name))
        .map((name) => name.replace(/\.js$/u, '').replace(/-/g, '_'))
        .sort();
      const {
        PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES
      } = require(path.join(
        __dirname,
        'src',
        'main',
        'papers',
        'store',
        'intake',
        'mcp-tools.js'
      ));
      assert.deepEqual(
        [...mcpToolNames].sort(),
        [...directToolFileNames, ...PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES].sort()
      );
      assert.deepEqual(mcpToolNames.slice(0, 6), [
        'inventory_lookup',
        'chemical_lookup',
        'notebook_lookup',
        'protocol_lookup',
        'protocol_generation',
        'notebook_draft'
      ]);
      assert.equal(mcpToolNames.includes('inventory_lookup'), true);
      assert.equal(mcpToolNames.includes('chemical_lookup'), true);
      assert.equal(mcpToolNames.includes('protocol_lookup'), true);
      assert.equal(mcpToolNames.includes('protocol_generation'), true);
      assert.equal(mcpToolNames.includes('protocol_save'), false);
      assert.equal(mcpToolNames.includes('notebook_draft'), true);
      assert.equal(mcpToolNames.includes('notebook_append'), true);
      assert.equal(mcpToolNames.includes('notebook_lookup'), true);
      const retiredDirectToolName = ['record', 'lookup'].join('_');
      assert.equal(mcpToolNames.includes(retiredDirectToolName), false);
      assert.equal(mcpToolNames.includes('literature_search'), true);
      assert.equal(mcpToolNames.includes('paper_download'), true);
      assert.equal(mcpToolNames.includes('paper_analysis'), true);
      assert.equal(mcpToolNames.includes('paper_intake_search_summaries'), true);
      assert.equal(mcpToolNames.includes('paper_intake_search_experiments'), true);
      assert.equal(mcpToolNames.includes('paper_intake_list_project_summaries'), true);
      assert.equal(mcpToolNames.includes('protocol_matching'), false);
      assert.equal(mcpToolNames.includes('web_search'), false);
      assert.equal(mcpToolNames.includes('python_sandbox'), false);
      assert.equal(mcpToolNames.includes('command_line'), false);
      assert.equal(mcpToolNames.includes('sub_agent'), false);
      assert.equal(mcpToolNames.includes('memory'), false);
      assert.equal(mcpToolNames.includes('container'), true);
      assert.equal(mcpToolNames.includes('assay_table'), true);
      assert.equal(mcpToolNames.includes('plotly_graph'), true);
      assert.equal(mcpToolNames.includes('ask_user'), true);
      assert.equal(mcpToolNames.includes('unknown_direct_tool'), false);
      assert.equal(mcpToolNames.includes('tool_info'), false);
      assert.equal(mcpToolNames.includes('tool_call'), false);
      assert.equal(mcpToolNames.includes('resource_search'), false);
      assert.equal(mcpToolNames.includes('resource_read'), false);
      const askUserDefinition = mcpTools.find((tool) => tool.name === 'ask_user');
      const protocolGenerationDefinition = mcpTools.find((tool) => tool.name === 'protocol_generation');
      const notebookDraftDefinition = mcpTools.find((tool) => tool.name === 'notebook_draft');
      const notebookAppendDefinition = mcpTools.find((tool) => tool.name === 'notebook_append');
      const notebookLookupDefinition = mcpTools.find((tool) => tool.name === 'notebook_lookup');
      const containerDefinition = mcpTools.find((tool) => tool.name === 'container');
      const assayTableDefinition = mcpTools.find((tool) => tool.name === 'assay_table');
      const plotlyGraphDefinition = mcpTools.find((tool) => tool.name === 'plotly_graph');
      const literatureSearchDefinition = mcpTools.find((tool) => tool.name === 'literature_search');
      const paperDownloadDefinition = mcpTools.find((tool) => tool.name === 'paper_download');
      assert.equal(askUserDefinition.annotations.readOnlyHint, true);
      assert.equal(askUserDefinition.annotations.destructiveHint, false);
      assert.equal(askUserDefinition.annotations.idempotentHint, false);
      assert.equal(askUserDefinition.annotations.openWorldHint, false);
      assert.equal(protocolGenerationDefinition.annotations.readOnlyHint, false);
      assert.equal(protocolGenerationDefinition.annotations.destructiveHint, false);
      assert.equal(notebookDraftDefinition.annotations.readOnlyHint, true);
      assert.equal(notebookDraftDefinition.annotations.idempotentHint, false);
      assert.equal(notebookAppendDefinition.annotations.readOnlyHint, true);
      assert.equal(notebookAppendDefinition.annotations.destructiveHint, false);
      assert.equal(notebookAppendDefinition.annotations.idempotentHint, false);
      assert.deepEqual(notebookAppendDefinition.inputSchema.required, [
        'notebook_entry_id',
        'page_title',
        'project_name',
        'protocol_name',
        'content_markdown'
      ]);
      assert.equal(notebookLookupDefinition.annotations.readOnlyHint, true);
      assert.equal(notebookLookupDefinition.inputSchema.properties.action, undefined);
      assert.equal(notebookLookupDefinition.inputSchema.properties.entry_id, undefined);
      assert.deepEqual(notebookLookupDefinition.inputSchema.properties.notebook_state.enum, ['planned', 'executed']);
      assert.deepEqual(notebookLookupDefinition.inputSchema.properties.detail.enum, ['summary', 'full']);
      assert.deepEqual(notebookLookupDefinition.inputSchema.required, []);
      assert.equal(containerDefinition.annotations.readOnlyHint, false);
      assert.equal(containerDefinition.inputSchema.properties.action.enum.includes('replace_range'), true);
      assert.equal(assayTableDefinition.annotations.readOnlyHint, false);
      assert.equal(assayTableDefinition.inputSchema.properties.action.enum.includes('python'), true);
      assert.equal(plotlyGraphDefinition.annotations.readOnlyHint, false);
      assert.equal(plotlyGraphDefinition.inputSchema.properties.action.enum.includes('inspect'), true);
      assert.equal(literatureSearchDefinition.annotations.openWorldHint, true);
      assert.equal(literatureSearchDefinition.inputSchema.type, 'object');
      assert.deepEqual(Object.keys(literatureSearchDefinition.inputSchema.properties).sort(), [
        'allow_unfiltered_fallback', 'journals', 'prefer_recent', 'query', 'sources'
      ]);
      assert.equal(literatureSearchDefinition.inputSchema.properties.source, undefined);
      assert.equal(literatureSearchDefinition.inputSchema.properties.limit, undefined);
      assert.equal(literatureSearchDefinition.inputSchema.properties.codex_paper_context, undefined);
      assert.equal(literatureSearchDefinition.inputSchema.properties.storage_path, undefined);
      assert.equal(literatureSearchDefinition.inputSchema.properties.parser_payload, undefined);
      assert.equal(literatureSearchDefinition.inputSchema.properties.preferred_literature_source, undefined);
      const checkedContract = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'docs', 'agent', 'mcp-contract', 'mcp-contract.json'),
        'utf8'
      ));
      const checkedLiteratureSearch = checkedContract.mcp.tools.find((tool) => tool.name === 'literature_search');
      const checkedContainer = checkedContract.mcp.tools.find((tool) => tool.name === 'container');
      const checkedPlotlyGraph = checkedContract.mcp.tools.find((tool) => tool.name === 'plotly_graph');
      assert.equal(checkedLiteratureSearch.description, literatureSearchDefinition.description);
      assert.deepEqual(
        Object.keys(checkedLiteratureSearch.inputSchema.properties).sort(),
        Object.keys(literatureSearchDefinition.inputSchema.properties).sort()
      );
      assert.deepEqual(checkedContainer, containerDefinition);
      assert.deepEqual(checkedPlotlyGraph, plotlyGraphDefinition);
      assert.match(
        checkedContract.agent_mcp_instructions,
        /`container`: store, name, list, read, update,[^\n]+optional source provenance/
      );
      assert.match(
        checkedContract.agent_mcp_instructions,
        /`plotly_graph`:[^\n]+canonical `data`, `layout`, and optional `config`/
      );
      assert.equal(paperDownloadDefinition.annotations.readOnlyHint, false);
      assert.equal(paperDownloadDefinition.annotations.openWorldHint, true);
      assert.deepEqual(Object.keys(paperDownloadDefinition.inputSchema.properties).sort(), [
        'candidate_urls',
        'collection_name',
        'doi',
        'linked_name',
        'paper_title'
      ]);
      assert.equal(paperDownloadDefinition.inputSchema.properties.linked_name.deprecated, true);
      const checkedPaperDownload = checkedContract.mcp.tools.find((tool) => tool.name === 'paper_download');
      assert.deepEqual(checkedPaperDownload, paperDownloadDefinition);

      const hiddenSearchResult = await gateway.callGatewayTool('unknown_direct_tool', {
        query: 'download paper pdf'
      });
      assert.equal(hiddenSearchResult.ok, false);
      assert.match(hiddenSearchResult.error, /Unknown Hikari MCP gateway tool/);

      const callResult = await gateway.callGatewayTool('notebook_lookup', {
        query: 'Protein purification',
        limit: 3
      }, {
        snapshot: { inventory: [] },
        requestId: 'req-1'
      });
      assert.equal(callResult.ok, true);
      assert.equal(callResult.status, 'matched');
      assert.equal(callResult.mcp_tool, 'notebook_lookup');
      assert.equal(callResult.app_tool, 'notebook-lookup');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].toolId, 'notebook-lookup');
      assert.equal(calls[0].args.query, 'Protein purification');
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0].args, 'action'), false);
      assert.equal(calls[0].snapshot.inventory.length, 0);
      assert.equal(calls[0].context.requestId, 'req-1');

      const chemicalResult = await gateway.callGatewayTool('chemical_lookup', {
        query: 'PEI',
        limit: 2
      }, {
        requestId: 'req-chemical'
      });
      assert.equal(chemicalResult.ok, true);
      assert.equal(chemicalResult.status, 'matched');
      assert.deepEqual(chemicalResult.items.map((item) => item.kind), ['chemical']);
      assert.equal(calls[calls.length - 1].toolId, 'inventory-lookup');
      assert.equal(calls[calls.length - 1].args.limit, 2);
      assert.deepEqual(calls[calls.length - 1].args.kinds, ['chemical']);

      const protocolResult = await gateway.callGatewayTool('protocol_lookup', {
        query: 'protein purification',
        limit: 2
      }, {
        requestId: 'req-protocol'
      });
      assert.equal(protocolResult.ok, true);
      assert.equal(protocolResult.status, 'matched');
      assert.deepEqual(protocolResult.items.map((item) => item.name), ['Protein purification']);
      assert.equal(protocolResult.app_tool, 'protocol-matching');
      assert.equal(protocolResult.selection_method, 'deterministic');
      assert.equal(calls[calls.length - 1].toolId, 'protocol-matching');
      assert.deepEqual(calls[calls.length - 1].args.protocol_candidates, ['protein purification']);
      assert.equal(calls[calls.length - 1].context.parserPayload.primary_intent, 'protocol_to_notebook');

      const protocolGenerationResult = await gateway.callGatewayTool('protocol_generation', {
        protocol: {
          title: 'Protein purification',
          purpose: 'Purify His-tagged protein.',
          materials: ['Ni-NTA resin'],
          steps: ['Bind lysate to resin for [time].']
        },
        result_summary: 'Normalize the protocol.'
      }, {
        requestId: 'req-protocol-generation'
      });
      assert.equal(protocolGenerationResult.ok, true);
      assert.equal(protocolGenerationResult.status, 'normalized');
      assert.equal(protocolGenerationResult.protocol.name, 'Protein purification');
      assert.equal(Object.prototype.hasOwnProperty.call(protocolGenerationResult.protocol, 'id'), false);
      assert.equal(calls[calls.length - 1].toolId, 'protocol-generation');
      assert.equal(calls[calls.length - 1].args.protocol.name, 'Protein purification');
      assert.equal(Object.prototype.hasOwnProperty.call(calls[calls.length - 1].args.protocol, 'id'), false);

      const protocolSaveResult = await gateway.callGatewayTool('protocol_generation', {
        protocol: {
          name: 'Protein purification',
          purpose: 'Purify His-tagged protein.',
          materials: ['Ni-NTA resin'],
          steps: ['Bind lysate to resin for [time].']
        },
        result_summary: 'Save the generated protocol.',
        save: true
      }, {
        requestId: 'req-protocol-save'
      });
      assert.equal(protocolSaveResult.ok, true);
      assert.equal(protocolSaveResult.status, 'awaiting_user_approval');
      assert.equal(protocolSaveResult.save_requested, true);
      assert.equal(protocolSaveResult.requires_user_approval, true);
      assert.equal(Object.prototype.hasOwnProperty.call(protocolSaveResult.protocol, 'id'), false);
      assert.equal(calls[calls.length - 1].toolId, 'protocol-generation');
      assert.equal(Object.prototype.hasOwnProperty.call(calls[calls.length - 1].args, 'save'), false);

      const notebookDraftResult = await gateway.callGatewayTool('notebook_draft', {
        project_name: 'Atlas',
        protocol_candidates: ['Protein purification']
      }, {
        requestId: 'req-notebook-draft',
        provider: 'codex'
      });
      assert.equal(notebookDraftResult.ok, true);
      assert.equal(notebookDraftResult.status, 'proposal_ready');
      assert.equal(notebookDraftResult.app_tool, 'notebook-draft');
      assert.equal(notebookDraftResult.selected_protocol.name, 'Protein purification');
      assert.equal(notebookDraftResult.notebook.title, 'Protein purification');
      assert.equal(calls[calls.length - 1].toolId, 'notebook-draft');
      assert.equal(calls[calls.length - 1].args.project.name, 'Atlas');
      assert.equal(Object.prototype.hasOwnProperty.call(calls[calls.length - 1].args.project, 'project_name'), false);
      assert.deepEqual(calls[calls.length - 1].args.protocol_candidates, ['Protein purification']);
      assert.equal(calls[calls.length - 1].context.parserPayload.primary_intent, 'notebook_draft');

      const notebookAppendResult = await gateway.callGatewayTool('notebook_append', {
        notebook_entry_id: 'entry-1',
        page_title: 'Protein purification',
        project_name: 'Atlas',
        protocol_name: 'Protein purification',
        expected_updated_at: '2026-07-21T12:00:00.000Z',
        section_title: 'PBS recipe and protein record',
        content_markdown: 'PBS recipe: prepare 1 L at pH 7.4.\n\nProtein concentration: 2.1 mg/mL.',
        sources: [
          { kind: 'inventory', record_id: 'protein-1', label: 'His-tagged protein' }
        ]
      }, {
        requestId: 'req-notebook-append'
      });
      assert.equal(notebookAppendResult.ok, true);
      assert.equal(notebookAppendResult.status, 'proposal_ready');
      assert.equal(notebookAppendResult.mcp_tool, 'notebook_append');
      assert.equal(notebookAppendResult.proposal.notebook_entry_id, 'entry-1');
      assert.match(notebookAppendResult.proposal.proposal_id, /^notebook-append-/);
      assert.equal(notebookAppendResult.save.mode, 'confirm_before_append');
      assert.equal(calls[calls.length - 1].toolId, 'notebook-draft');

      const staleUnsafeNotebookAppend = await gateway.callGatewayTool('notebook_append', {
        notebook_entry_id: 'entry-1',
        page_title: 'Protein purification',
        project_name: 'Atlas',
        protocol_name: 'Protein purification',
        content_markdown: 'Append without a page version.'
      });
      assert.equal(staleUnsafeNotebookAppend.ok, false);
      assert.equal(staleUnsafeNotebookAppend.status, 'needs_more_info');
      assert.match(staleUnsafeNotebookAppend.error, /expected_updated_at/);

      const askUserResult = await gateway.callGatewayTool('ask_user', {
        question: 'Which project should I use?',
        options: [
          { label: 'Atlas', description: 'Continue in the current project.' },
          'All projects'
        ],
        allow_custom: true
      }, {
        requestId: 'req-ask-user'
      });
      assert.equal(askUserResult.ok, true);
      assert.equal(askUserResult.status, 'needs_user_answer');
      assert.equal(askUserResult.user_question.question, 'Which project should I use?');
      assert.equal(askUserResult.user_question.options.length, 2);
      assert.equal(askUserResult.final_response.status, 'needs_more_info');
      assert.match(askUserResult.summary, /end the current turn/);
      assert.match(askUserResult.summary, /without asking the same question again/);
      assert.equal(calls[calls.length - 1].toolId, 'notebook-draft');

      const containerCreateResult = await gateway.callGatewayTool('container', {
        action: 'create',
        name: 'copied phrase',
        value: 'alpha beta',
        source: 'copied:test-fixture'
      }, {
        requestId: 'req-container-create'
      });
      assert.equal(containerCreateResult.ok, true);
      assert.equal(containerCreateResult.status, 'created');
      assert.equal(containerCreateResult.container.id, '1');
      assert.equal(containerCreateResult.container.name, 'copied phrase');
      assert.equal(containerCreateResult.container.value, 'alpha beta');
      assert.equal(containerCreateResult.container.source, 'copied:test-fixture');
      assert.equal(calls[calls.length - 1].toolId, 'container');

      const containerEditResult = await gateway.callGatewayTool('container', {
        action: 'replace_range',
        id: '1',
        start: 6,
        end: 10,
        replacement: 'gamma'
      }, {
        requestId: 'req-container-edit'
      });
      assert.equal(containerEditResult.ok, true);
      assert.equal(containerEditResult.status, 'replaced');
      assert.equal(containerEditResult.container.id, '1');
      assert.equal(containerEditResult.container.value, 'alpha gamma');
      assert.deepEqual(containerEditResult.range, {
        start: 6,
        end: 10,
        inserted_length: 5
      });

      const containerListResult = await gateway.callGatewayTool('container', {
        action: 'list',
        limit: 1
      }, {
        requestId: 'req-container-list'
      });
      assert.equal(containerListResult.ok, true);
      assert.equal(containerListResult.status, 'listed');
      assert.equal(containerListResult.count, 1);
      assert.equal(containerListResult.total_count, 1);
      assert.equal(calls[calls.length - 1].toolId, 'container');

      const assayTableResult = await gateway.callGatewayTool('assay_table', {
        action: 'create',
        name: 'replicate readings',
        rows: [
          { condition: 'control', rep1: 1, rep2: 3 },
          { condition: 'treated', rep1: 4, rep2: 6 }
        ]
      }, {
        requestId: 'req-assay-table'
      });
      assert.equal(assayTableResult.ok, true);
      assert.equal(assayTableResult.status, 'created');
      assert.equal(assayTableResult.table.id, '1');
      assert.equal(assayTableResult.table.row_count, 2);
      assert.equal(calls[calls.length - 1].toolId, 'assay-table');

      const assayDerivedResult = await gateway.callGatewayTool('assay_table', {
        action: 'derive',
        table_id: '1',
        include_source_columns: true,
        columns: [{ name: 'mean', op: 'avg', operands: ['rep1', 'rep2'] }]
      }, {
        requestId: 'req-assay-table-derived'
      });
      assert.equal(assayDerivedResult.ok, true);
      assert.equal(assayDerivedResult.status, 'derived');
      assert.equal(assayDerivedResult.table.rows[0].mean, 2);
      assert.equal(calls[calls.length - 1].toolId, 'assay-table');

      const plotlyCreateResult = await gateway.callGatewayTool('plotly_graph', {
        action: 'create',
        name: 'assay bar',
        data: [{ type: 'bar', x: ['control', 'treated'], y: [2, 5] }],
        layout: {
          title: { text: 'Assay response' },
          xaxis: { title: { text: 'Condition' } },
          yaxis: { title: { text: 'Response' } }
        },
        config: {
          responsive: true,
          displaylogo: false
        }
      }, {
        requestId: 'req-plotly-create'
      });
      assert.equal(plotlyCreateResult.ok, true);
      assert.equal(plotlyCreateResult.status, 'created');
      assert.equal(plotlyCreateResult.graph.id, '1');
      assert.equal(plotlyCreateResult.graph.inspection.trace_count, 1);
      assert.deepEqual(plotlyCreateResult.graph.figure.config, {
        responsive: true,
        displaylogo: false
      });
      assert.equal(calls[calls.length - 1].toolId, 'plotly-graph');

      const plotlyInspectResult = await gateway.callGatewayTool('plotly_graph', {
        action: 'inspect',
        graph_id: '1'
      }, {
        requestId: 'req-plotly-inspect'
      });
      assert.equal(plotlyInspectResult.ok, true);
      assert.equal(plotlyInspectResult.status, 'inspected');
      assert.equal(plotlyInspectResult.inspection.issues.length, 0);
      assert.equal(calls[calls.length - 1].toolId, 'plotly-graph');

      const removedLegacyLookupResult = await gateway.callGatewayTool(retiredDirectToolName, {
        query: 'PEI',
        limit: 3
      });
      assert.equal(removedLegacyLookupResult.ok, false);
      assert.match(removedLegacyLookupResult.error, /Unknown Hikari MCP gateway tool/);
    });
  }
};
