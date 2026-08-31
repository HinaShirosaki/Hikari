module.exports = function registerAgentContractsBAgentRuntimeContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const agentDir = path.join(__dirname, 'src', 'main', 'agent');
    const agentPath = (...parts) => path.join(agentDir, ...parts);

    test('agent tool catalogs pin each action-based tool contract', () => {
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));
      const actionEnum = (name) => toolCallCatalog[name]?.input_schema?.properties?.action?.enum;

      assert.deepEqual(actionEnum('sub-agent'), ['create', 'message', 'delete', 'get', 'list']);
      assert.deepEqual(actionEnum('memory'), ['recall', 'remember', 'forget', 'list']);
      assert.deepEqual(actionEnum('container'), ['create', 'read', 'list', 'update', 'replace_range', 'rename', 'delete', 'clear']);
      assert.deepEqual(actionEnum('assay-table'), ['create', 'read', 'list', 'derive', 'add_column', 'python', 'delete', 'clear']);
      assert.deepEqual(actionEnum('plotly-graph'), ['create', 'read', 'list', 'update', 'inspect', 'delete', 'clear']);

      assert.deepEqual(toolCallCatalog.container?.input_schema?.properties?.source, {
        type: 'string',
        maxLength: 1200
      });
      assert.deepEqual(toolCallCatalog.container?.input_schema?.properties?.limit, {
        type: 'integer',
        minimum: 1,
        maximum: 50
      });
      assert.deepEqual(toolCallCatalog['plotly-graph']?.input_schema?.properties?.config, {
        type: 'object',
        additionalProperties: true
      });
      assert.equal(toolCallCatalog['assay-table']?.input_schema?.properties?.source_table_id, undefined);
      assert.equal(toolCallCatalog['plotly-graph']?.input_schema?.properties?.traces, undefined);
      assert.equal(toolCallCatalog['plotly-graph']?.input_schema?.properties?.frames, undefined);
      assert.equal(toolCallCatalog['protocol-generation']?.input_schema?.properties?.save?.type, 'boolean');
      assert.match(
        toolsCatalog.find((entry) => entry?.name === 'plotly-graph')?.description || '',
        /canonical data, layout, and optional config/
      );
      assert.match(
        toolsCatalog.find((entry) => entry?.name === 'container')?.description || '',
        /list, read,[^\n]+optional source provenance/
      );
    });

    test('official MCP skill metadata matches Codex frontmatter constraints', () => {
      const { OFFICIAL_MCP_SKILLS } = require(agentPath(
        'codex-agent',
        'official-mcp-skills.js'
      ));

      for (const skill of OFFICIAL_MCP_SKILLS) {
        const frontmatter = skill.content.match(
          /^---\nname: (.+)\ndescription: (.+)\n---/u
        );
        assert.ok(frontmatter, `${skill.id} has malformed frontmatter`);
        const name = JSON.parse(frontmatter[1]);
        const description = JSON.parse(frontmatter[2]);
        assert.match(name, /^[a-z0-9-]+$/u);
        assert.equal(name.length <= 64, true);
        assert.equal(description.length <= 1024, true);
        assert.doesNotMatch(description, /[<>]/u);
      }
    });
    test('official MCP skill direct-call JSON examples pass production validation', async () => {
      const { OFFICIAL_MCP_SKILLS } = require(agentPath(
        'codex-agent',
        'official-mcp-skills.js'
      ));
      const { createDirectMcpToolRouter } = require(agentPath(
        'mcp-contract',
        'direct-tools',
        'index.js'
      ));
      const executedCalls = [];
      const router = createDirectMcpToolRouter({
        runTool: async (toolId, args) => {
          executedCalls.push({ toolId, args });
          return {
            ok: true,
            status: 'completed'
          };
        }
      });
      const extractActionExamples = (markdown = '') => Array.from(
        String(markdown || '').matchAll(/`(\{[^\n`]*"action"[^\n`]*\})`/gu),
        (match) => JSON.parse(match[1])
      );
      const containerSkill = OFFICIAL_MCP_SKILLS.find((skill) => skill.id === 'container');
      const assayPlotlySkill = OFFICIAL_MCP_SKILLS.find((skill) => skill.id === 'assay-plotly');
      const plotlySectionIndex = assayPlotlySkill?.content?.indexOf('Plotly workflow:') ?? -1;

      assert.ok(containerSkill);
      assert.ok(assayPlotlySkill);
      assert.notEqual(plotlySectionIndex, -1);

      const groups = [
        {
          directTool: 'container',
          appTool: 'container',
          examples: extractActionExamples(containerSkill.content),
          expectedCount: 7
        },
        {
          directTool: 'assay_table',
          appTool: 'assay-table',
          examples: extractActionExamples(assayPlotlySkill.content.slice(0, plotlySectionIndex)),
          expectedCount: 2
        },
        {
          directTool: 'plotly_graph',
          appTool: 'plotly-graph',
          examples: extractActionExamples(assayPlotlySkill.content.slice(plotlySectionIndex)),
          expectedCount: 1
        }
      ];

      for (const group of groups) {
        assert.equal(group.examples.length, group.expectedCount);
        for (const args of group.examples) {
          const callCount = executedCalls.length;
          const result = await router.callTool(group.directTool, args, {});
          assert.notEqual(
            result.status,
            'invalid_arguments',
            `${group.directTool} rejected ${JSON.stringify(args)}: ${result.error || 'unknown validation error'}`
          );
          assert.equal(executedCalls.length, callCount + 1);
          assert.equal(executedCalls.at(-1).toolId, group.appTool);
        }
      }

      assert.equal(
        groups[1].examples.some((example) => Object.prototype.hasOwnProperty.call(example, 'source_table_id')),
        false
      );
      assert.equal(
        groups[2].examples.some((example) => Object.prototype.hasOwnProperty.call(example, 'traces')),
        false
      );
      assert.equal(groups[2].examples[0].config?.responsive, true);

      const validCallCount = executedCalls.length;
      const deprecatedAssayAlias = await router.callTool('assay_table', {
        action: 'derive',
        source_table_id: '1',
        columns: []
      }, {});
      const deprecatedPlotlyAlias = await router.callTool('plotly_graph', {
        action: 'create',
        traces: [{ type: 'scatter', x: [1], y: [2] }]
      }, {});
      assert.equal(deprecatedAssayAlias.status, 'invalid_arguments');
      assert.equal(deprecatedPlotlyAlias.status, 'invalid_arguments');
      assert.equal(executedCalls.length, validCallCount);
    });
    test('direct LLM module registry exposes owned module calls outside the agent chat runtime', async () => {
      const {
        createDirectLlmModuleRegistry,
        registerDefaultDirectLlmModules
      } = require(path.join(__dirname, 'src', 'main', 'lib', 'llm', 'direct-llm-module-registry.js'));
      const calls = [];
      const registry = registerDefaultDirectLlmModules(createDirectLlmModuleRegistry({
        cleanText: (value) => String(value || '').trim(),
        LLM_PROVIDERS: {
          CODEX: 'codex',
          OPENAI: 'openai'
        },
        DEFAULT_LLM_PROVIDER: 'openai',
        normalizeLlmProvider: (provider) => String(provider || 'openai').trim(),
        defaultLlmEndpointForProvider: () => 'https://api.openai.com/v1/responses',
        defaultAgentModelForProvider: () => 'gpt-5',
        requestFileInput: async (input = {}) => {
          calls.push({ kind: 'file', input });
          return { ok: true, text: 'Paper summary.' };
        },
        requestStructuredJsonPayload: async (input = {}) => {
          calls.push({ kind: 'json', input });
          return { ok: true, payload: { mapped: true }, text: '{"mapped":true}' };
        },
        requestText: async (input = {}) => {
          calls.push({ kind: 'text', input });
          return { ok: true, text: 'Clarified.' };
        }
      }));

      assert.equal(registry.listModules().some((entry) => entry.id === 'papers'), true);
      assert.equal(registry.listModules().some((entry) => entry.id === 'inventory'), true);
      assert.equal(
        registry.listModules().some((entry) => (
          entry.id === 'notebook'
          && entry.tasks.some((task) => task.id === 'page-name')
        )),
        true
      );
      assert.equal(
        registry.listModules().some((entry) => (
          entry.id === 'protocol'
          && entry.tasks.some((task) => task.id === 'protocol-generation')
        )),
        true
      );

      const summary = await registry.requestModuleLlm({
        moduleId: 'papers',
        task: 'paper-summary',
        prompt: 'Summarize this paper.',
        pdfDataUrl: 'data:application/pdf;base64,QUJD',
        fileName: 'paper.pdf',
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-5'
        }
      });

      assert.equal(summary.ok, true);
      assert.equal(summary.text, 'Paper summary.');
      assert.equal(calls[0].kind, 'file');
      assert.equal(calls[0].input.stage, 'direct_llm_papers_paper_summary');
      assert.equal(calls[0].input.userPrompt, 'Summarize this paper.');
      assert.equal(calls[0].input.pdfDataUrl, 'data:application/pdf;base64,QUJD');

      const mapped = await registry.requestModuleLlm({
        moduleId: 'inventory',
        task: 'chemical-header-mapping',
        prompt: 'Map these headers.',
        llm: {
          provider: 'codex',
          model: 'gpt-5.4-mini',
          reasoningEffort: 'high'
        }
      });

      assert.equal(mapped.ok, true);
      assert.deepEqual(mapped.payload, { mapped: true });
      assert.equal(calls[1].kind, 'json');
      assert.equal(calls[1].input.provider, 'codex');
      assert.equal(calls[1].input.reasoningEffort, 'high');

      const missing = await registry.requestModuleLlm({
        moduleId: 'papers',
        task: 'not-a-real-task',
        prompt: 'Nope',
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-5'
        }
      });
      assert.equal(missing.ok, false);
      assert.match(missing.error, /not registered/);
    });
    test('Codex structured requests forward their declared output schema', async () => {
      const { createCodexAgentLlmProvider } = require(agentPath(
        'shared',
        'llm-providers',
        'codex-agent-provider.js'
      ));
      const calls = [];
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['conclusion', 'quotes'],
        properties: {
          conclusion: { type: 'string' },
          quotes: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      };
      const provider = createCodexAgentLlmProvider({
        cleanText: (value) => String(value || '').trim(),
        requestCodexCliText: async (input = {}) => {
          calls.push(input);
          return '{"conclusion":"Recorded result.","quotes":["Recorded result."]}';
        },
        getWorkingDirectory: () => '/tmp/hikari',
        parseJsonObjectFromText: (raw) => JSON.parse(raw)
      });

      const result = await provider.requestText({
        userPrompt: 'Summarize the saved result.',
        expectJson: true,
        schema
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls[0].outputSchema, schema);
    });
    test('agent runtime registry registers and resolves named runtime factories', () => {
      const { createAgentRuntimeRegistry, resolveAgentRuntimeFactory } = require(agentPath('shared', 'agent-runtime-registry.js'));
      const registry = createAgentRuntimeRegistry();
      const sentinel = () => ({ ok: true });

      assert.equal(registry.registerRuntimeFactory('Notebook-Generation', sentinel), true);
      assert.equal(registry.hasRuntimeFactory('notebook-generation'), true);
      assert.equal(registry.getRuntimeFactory('notebook-generation'), sentinel);
      assert.equal(resolveAgentRuntimeFactory({ runtimeRegistry: registry }, 'NOTEBOOK-GENERATION'), sentinel);
      assert.equal(registry.unregisterRuntimeFactory('notebook-generation'), true);
      assert.equal(registry.hasRuntimeFactory('notebook-generation'), false);
    });
    test('notebook lookup runtime executes independently from inventory lookup', async () => {
      const { createAgentNotebookLookupRuntime } = require(agentPath('tools', 'agent-notebook-lookup.js'));
      const notebookRuntime = createAgentNotebookLookupRuntime();
      const notebookSearch = await notebookRuntime.searchNotebookEntries({
        query: 'Protein Purification',
        snapshot: {
          notebookEntries: [
            {
              id: 'note-1',
              protocolName: 'Protein Purification',
              projectName: 'Atlas',
              result: 'Yield improved.'
            }
          ]
        }
      });

      assert.equal(notebookSearch.source, 'fallback_json');
      assert.equal(notebookSearch.items[0]?.record_type, 'notebook');
    });
  }
};
