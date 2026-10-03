module.exports = function registerCodexCliProviderSuiteMcpGatewayToolSurface(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, fs, path, test } = scope;

    test('direct MCP tool load and handler failures stay isolated', async () => {
      const directToolDir = path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'direct-tools'
      );
      const {
        createDirectMcpToolRouter,
        loadDirectMcpTools
      } = require(path.join(directToolDir, 'index.js'));
      const loadErrors = [];
      const toolsWithoutSequence = loadDirectMcpTools({
        loadModule(modulePath) {
          if (modulePath === './sequence-tools.js') {
            throw new Error('simulated missing sequence dependency');
          }
          return require(path.resolve(directToolDir, modulePath));
        },
        onLoadError: (failure) => loadErrors.push(failure)
      });

      assert.equal(loadErrors.length, 1);
      assert.equal(loadErrors[0].modulePath, './sequence-tools.js');
      assert.equal(toolsWithoutSequence.some((tool) => tool.definition.name === 'sequence_search'), false);
      assert.equal(toolsWithoutSequence.some((tool) => tool.definition.name === 'inventory_lookup'), true);
      assert.equal(toolsWithoutSequence.some((tool) => tool.definition.name === 'ask_user'), true);

      const malformedErrors = [];
      const toolsWithoutMalformedDefinition = loadDirectMcpTools({
        loadModule(modulePath) {
          const loaded = require(path.resolve(directToolDir, modulePath));
          if (modulePath !== './sequence-tools.js') return loaded;
          return {
            ...loaded,
            SEQUENCE_MCP_TOOLS: [
              { definition: { name: '' }, handler() {} },
              ...loaded.SEQUENCE_MCP_TOOLS.slice(1)
            ]
          };
        },
        onLoadError: (failure) => malformedErrors.push(failure)
      });
      assert.equal(malformedErrors.length, 1);
      assert.equal(toolsWithoutMalformedDefinition.some((tool) => tool.definition.name === 'sequence_get'), true);

      const isolatedTools = [
        {
          definition: { name: 'inventory_lookup', inputSchema: { type: 'object' } },
          async handler() { throw new Error('simulated tool failure'); }
        },
        {
          definition: { name: 'chemical_lookup', inputSchema: { type: 'object' } },
          async handler() { return { ok: true, status: 'ok' }; }
        }
      ];
      const router = createDirectMcpToolRouter({ directMcpTools: isolatedTools });
      const broken = await router.callTool('inventory_lookup');
      assert.equal(broken.ok, false);
      assert.equal(broken.status, 'tool_error');
      assert.match(broken.error, /simulated tool failure/);
      assert.deepEqual(await router.callTool('chemical_lookup'), { ok: true, status: 'ok' });

      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      const { createAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const server = createAgentMcpStdioServer({
        env: {},
        gateway: {
          callGatewayTool: (...args) => router.callTool(...args)
        }
      });
      const client = new Client({ name: 'tool-isolation-test', version: '1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const failedResponse = await client.callTool({ name: 'inventory_lookup', arguments: {} });
        assert.equal(failedResponse.isError, true);
        assert.equal(failedResponse.structuredContent.status, 'tool_error');
        const healthyResponse = await client.callTool({ name: 'chemical_lookup', arguments: {} });
        assert.equal(healthyResponse.isError, false);
        assert.equal(healthyResponse.structuredContent.status, 'ok');
      } finally {
        await client.close();
        await server.close();
      }
    });
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
      const { buildHikariAgentMcpInstructions } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'instructions.js'
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
      const mcpInstructions = buildHikariAgentMcpInstructions();
      assert.match(mcpInstructions, /reference preparation/i);
      assert.match(mcpInstructions, /Do not stop at diluting an unverified stock/i);
      assert.match(mcpInstructions, /Prefer one complete formulation/i);
      assert.match(mcpInstructions, /at most three short subsections and six bullets/i);
      assert.match(mcpInstructions, /failed-lookup transcripts/i);
      assert.match(mcpInstructions, /one to three unique useful records/i);
      assert.match(mcpInstructions, /without proposing an append/i);
      assert.doesNotMatch(mcpInstructions, /PBS|ampicillin/i);
      const directToolDir = path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'mcp-contract',
        'direct-tools'
      );
      const helperDirectToolFiles = new Set(['index.js', 'shared.js', 'generic-app-tool.js', 'sequence-tools.js', 'notebook-suggest.js']);
      const directToolFileNames = fs.readdirSync(directToolDir)
        .filter((name) => name.endsWith('.js') && !helperDirectToolFiles.has(name))
        .map((name) => name.replace(/\.js$/u, '').replace(/-/g, '_'))
        .sort();
      const {
        PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES
      } = require(path.join(
        __dirname,
        'tests',
        'support',
        'paper-intake-mcp-tools.js'
      ));
      assert.deepEqual(
        [...mcpToolNames].sort(),
        [...directToolFileNames, ...PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES, ...require(path.join(directToolDir, 'sequence-tools.js')).SEQUENCE_MCP_TOOLS.map(t => t.definition.name)].sort()
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
      assert.equal(mcpToolNames.includes('memory'), true);
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
      const paperAnalysisDefinition = mcpTools.find((tool) => tool.name === 'paper_analysis');
      assert.equal(askUserDefinition.annotations.readOnlyHint, true);
      assert.equal(askUserDefinition.annotations.destructiveHint, false);
      assert.equal(askUserDefinition.annotations.idempotentHint, false);
      assert.equal(askUserDefinition.annotations.openWorldHint, false);
      assert.equal(paperAnalysisDefinition.inputSchema.properties.query.type, 'string');
      assert.equal(paperAnalysisDefinition.inputSchema.properties.limit, undefined);
      assert.match(paperAnalysisDefinition.description, /preserve the earlier request/i);
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
      assert.deepEqual(notebookLookupDefinition.inputSchema.properties.notebook_state.enum, ['planned', 'executed', 'suggested']);
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
        'allow_unfiltered_fallback', 'journals', 'message', 'prefer_recent', 'query', 'research_id', 'sources'
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
      assert.deepEqual(checkedContract.mcp.tools.find((tool) => tool.name === 'memory'), mcpTools.find((tool) => tool.name === 'memory'));
      const checkedPlotlyGraph = checkedContract.mcp.tools.find((tool) => tool.name === 'plotly_graph');
      assert.equal(checkedLiteratureSearch.description, literatureSearchDefinition.description);
      assert.deepEqual(
        Object.keys(checkedLiteratureSearch.inputSchema.properties).sort(),
        Object.keys(literatureSearchDefinition.inputSchema.properties).sort()
      );
      assert.deepEqual(checkedContainer, containerDefinition);
      assert.deepEqual(checkedPlotlyGraph, plotlyGraphDefinition);
      assert.deepEqual(checkedContract.mcp.tools.find((tool) => tool.name === 'plugin_canvas'), mcpTools.find((tool) => tool.name === 'plugin_canvas'));
      assert.match(checkedContract.agent_mcp_instructions, /`plugin_canvas`: read, edit, and render installed local plugins with agent:canvas permission\./);
      assert.match(
        checkedContract.agent_mcp_instructions,
        /`container`: store, name, list, read, update,[^\n]+optional source provenance/
      );
      assert.match(
        checkedContract.agent_mcp_instructions,
        /`plotly_graph`:[^\n]+canonical `data`, `layout`, and optional `config`/
      );
      assert.equal(paperDownloadDefinition.annotations.readOnlyHint, false);
      assert.equal(checkedContract.mcp.tools.find((tool) => tool.name === 'paper_download').description,
        paperDownloadDefinition.description);
      assert.match(paperDownloadDefinition.description, /Matching active jobs and verified saved PDFs are reused/);
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
      assert.match(hiddenSearchResult.error, /Unknown Hikari direct MCP tool/);

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
      // The question is carried once, inside the payload the agent returns verbatim.
      assert.equal(askUserResult.user_question, undefined);
      assert.equal(askUserResult.final_response.user_question.question, 'Which project should I use?');
      assert.equal(askUserResult.final_response.user_question.options.length, 2);
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

      // Regression: ok is allowlisted on success statuses, so an app-tool error status
      // that no blocklist happened to name still surfaces as a failure to the model.
      const scratchToolFailureStatuses = [
        ['container', 'invalid_value_type'],
        ['container', 'value_too_large'],
        ['assay_table', 'executor_unavailable'],
        ['plotly_graph', 'unrecognized_future_status']
      ];
      for (const [scratchToolName, failureStatus] of scratchToolFailureStatuses) {
        const statusGateway = createAgentMcpGateway({
          runTool: async () => ({ status: failureStatus })
        });
        const statusResult = await statusGateway.callGatewayTool(scratchToolName, { action: 'list' }, {});
        assert.equal(statusResult.ok, false, `${scratchToolName}/${failureStatus} must not report ok`);
        assert.equal(statusResult.status, failureStatus);
      }

      // Regression: a missing or empty executor response is not a successful
      // synthetic "completed" result.
      const malformedScratchResults = [undefined, null, {}, { output: {} }];
      for (const malformedResult of malformedScratchResults) {
        for (const scratchToolName of ['container', 'assay_table', 'plotly_graph']) {
          const malformedGateway = createAgentMcpGateway({
            runTool: async () => malformedResult
          });
          const malformedResponse = await malformedGateway.callGatewayTool(
            scratchToolName,
            { action: 'list' },
            {}
          );
          assert.equal(malformedResponse.ok, false, `${scratchToolName} must reject an empty response`);
          assert.equal(malformedResponse.status, 'invalid_response');
        }
      }

      const scratchToolSuccessStatuses = [
        ['container', 'renamed'],
        ['assay_table', 'python_completed'],
        ['plotly_graph', 'inspected']
      ];
      for (const [scratchToolName, successStatus] of scratchToolSuccessStatuses) {
        const statusGateway = createAgentMcpGateway({
          runTool: async () => ({ status: successStatus })
        });
        const statusResult = await statusGateway.callGatewayTool(scratchToolName, { action: 'list' }, {});
        assert.equal(statusResult.ok, true, `${scratchToolName}/${successStatus} must report ok`);
      }

      // Regression: a lookup keeps items and citations even when it matched nothing,
      // so "searched, found nothing" stays distinguishable from "no results field".
      const emptyLookupGateway = createAgentMcpGateway({
        runTool: async () => ({ ok: true, items: [] })
      });
      const emptyLookupResult = await emptyLookupGateway.callGatewayTool('inventory_lookup', {
        query: 'nothing matches this'
      }, {});
      assert.equal(emptyLookupResult.status, 'no_match');
      assert.deepEqual(emptyLookupResult.items, []);
      assert.deepEqual(emptyLookupResult.citations, []);

      const brokenLookupGateway = createAgentMcpGateway({});
      const brokenLookupResult = await brokenLookupGateway.callGatewayTool('inventory_lookup', {
        query: 'PEI'
      }, {});
      assert.equal(brokenLookupResult.ok, false);
      assert.deepEqual(brokenLookupResult.items, []);

      // Regression: natively implemented tools carry app_tool like every proxy tool.
      const nativeToolGateway = createAgentMcpGateway({});
      const nativeAskUserResult = await nativeToolGateway.callGatewayTool('ask_user', {
        question: 'Which buffer?',
        options: ['PBS', 'TBS']
      }, {});
      assert.equal(nativeAskUserResult.app_tool, 'ask_user');
      const nativeNotebookAppendResult = await nativeToolGateway.callGatewayTool('notebook_append', {
        notebook_entry_id: 'unsaved draft',
        page_title: 'Mini prep',
        project_name: 'Project',
        protocol_name: 'Miniprep',
        content_markdown: '## Result'
      }, {});
      assert.equal(nativeNotebookAppendResult.app_tool, 'notebook_append');

      const removedLegacyLookupResult = await gateway.callGatewayTool(retiredDirectToolName, {
        query: 'PEI',
        limit: 3
      });
      assert.equal(removedLegacyLookupResult.ok, false);
      assert.match(removedLegacyLookupResult.error, /Unknown Hikari direct MCP tool/);
      // One unknown-tool shape, carrying the same spine as every other response.
      assert.equal(removedLegacyLookupResult.status, 'unknown_tool');
      assert.equal(removedLegacyLookupResult.mcp_tool, retiredDirectToolName);
    });
};
