module.exports = function registerAgentContractsBAgentRuntimeContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const agentDir = path.join(__dirname, 'src', 'main', 'agent');
    const agentPath = (...parts) => path.join(agentDir, ...parts);
    const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', ...parts);
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'core', 'main-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-mcp-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-agent-services.js')
    ].join('\n');
    test('renderer consumes science payloads through normalized agent responses', () => {
      const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'response.js'), 'utf8');
      const responseSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'response.js'), 'utf8');
      const responseSummariesSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'response', 'result-summaries.js'), 'utf8');
      assert.match(responseSummariesSource, /function summarizeScienceResult/);
      assert.match(responseSource, /export function normalizeAgentResponse/);
      assert.match(responseSource, /const scienceAnswerText = summarizeScienceResult\(generalScienceQuestion\)/);
      assert.match(rendererSource, /normalizeAgentResponse/);
      assert.match(rendererSource, /general_science_question/);
      assert.match(rendererSource, /project_science_question/);
      assert.match(rendererSource, /result_analysis/);
    });
    test('sub-agent helper exports reusable runtime and action contract', () => {
      const source = fs.readFileSync(agentPath('tools', 'agent-sub-agent.js'), 'utf8');
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));
      assert.match(source, /const SUB_AGENT_ACTIONS = Object\.freeze/);
      assert.match(source, /function createAgentSubAgentRuntime\(deps = \{\}\)/);
      assert.match(source, /async function createSubAgent\(input = \{\}\)/);
      assert.match(source, /async function sendSubAgentMessage\(input = \{\}\)/);
      assert.match(source, /function deleteSubAgent\(input = \{\}\)/);
      assert.deepEqual(toolCallCatalog['sub-agent']?.input_schema?.properties?.action?.enum, ['create', 'message', 'delete', 'get', 'list']);
    });
    test('memory helper exports a reusable runtime with an action-based contract', () => {
      const memorySource = fs.readFileSync(agentPath('context', 'agent-memory.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(memorySource, /const MEMORY_ACTIONS = Object\.freeze/);
      assert.match(memorySource, /function createAgentMemoryRuntime\(deps = \{\}\)/);
      assert.match(memorySource, /async function remember\(input = \{\}\)/);
      assert.match(memorySource, /async function recall\(input = \{\}\)/);
      assert.match(memorySource, /async function forget\(input = \{\}\)/);
      assert.match(memorySource, /async function list\(input = \{\}\)/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'memory'), true);
      assert.deepEqual(toolCallCatalog.memory?.input_schema?.properties?.action?.enum, ['recall', 'remember', 'forget', 'list']);
    });
    test('temporary container helper exports reusable runtime and short-id action contract', () => {
      const containerSource = fs.readFileSync(agentPath('tools', 'agent-container.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(containerSource, /const CONTAINER_ACTIONS = Object\.freeze/);
      assert.match(containerSource, /function createAgentContainerRuntime\(deps = \{\}\)/);
      assert.match(containerSource, /function allocateId\(\)/);
      assert.match(containerSource, /function replaceRange\(input = \{\}\)/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'container'), true);
      assert.match(
        toolsCatalog.find((entry) => entry?.name === 'container')?.description || '',
        /list, read,[^\n]+optional source provenance/
      );
      assert.deepEqual(toolCallCatalog.container?.input_schema?.properties?.action?.enum, ['create', 'read', 'list', 'update', 'replace_range', 'rename', 'delete', 'clear']);
      assert.deepEqual(toolCallCatalog.container?.input_schema?.properties?.source, {
        type: 'string',
        maxLength: 1200
      });
      assert.deepEqual(toolCallCatalog.container?.input_schema?.properties?.limit, {
        type: 'integer',
        minimum: 1,
        maximum: 50
      });
    });
    test('assay table and Plotly graph helpers expose reusable runtime action contracts', () => {
      const assayTableSource = fs.readFileSync(agentPath('tools', 'agent-assay-table.js'), 'utf8');
      const assayTableConstantsSource = fs.readFileSync(agentPath('tools', 'assay-table', 'constants.js'), 'utf8');
      const assayTableOperationsSource = fs.readFileSync(agentPath('tools', 'assay-table', 'column-operations.js'), 'utf8');
      const plotlyGraphSource = fs.readFileSync(agentPath('tools', 'agent-plotly-graph.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(assayTableConstantsSource, /const ASSAY_TABLE_ACTIONS = Object\.freeze/);
      assert.match(assayTableSource, /function createAgentAssayTableRuntime\(deps = \{\}\)/);
      assert.match(assayTableOperationsSource, /function applyOperation\(operation = '', values = \[\]\)/);
      assert.match(assayTableSource, /async function python\(input = \{\}\)/);
      assert.match(plotlyGraphSource, /const PLOTLY_GRAPH_ACTIONS = Object\.freeze/);
      assert.match(plotlyGraphSource, /function createAgentPlotlyGraphRuntime\(deps = \{\}\)/);
      assert.match(plotlyGraphSource, /function inspectFigure\(figure = \{\}\)/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'assay-table'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'plotly-graph'), true);
      assert.match(
        toolsCatalog.find((entry) => entry?.name === 'plotly-graph')?.description || '',
        /canonical data, layout, and optional config/
      );
      assert.deepEqual(toolCallCatalog['assay-table']?.input_schema?.properties?.action?.enum, ['create', 'read', 'list', 'derive', 'add_column', 'python', 'delete', 'clear']);
      assert.equal(toolCallCatalog['assay-table']?.input_schema?.properties?.source_table_id, undefined);
      assert.deepEqual(toolCallCatalog['plotly-graph']?.input_schema?.properties?.action?.enum, ['create', 'read', 'list', 'update', 'inspect', 'delete', 'clear']);
      assert.deepEqual(toolCallCatalog['plotly-graph']?.input_schema?.properties?.config, {
        type: 'object',
        additionalProperties: true
      });
      assert.equal(toolCallCatalog['plotly-graph']?.input_schema?.properties?.traces, undefined);
      assert.equal(toolCallCatalog['plotly-graph']?.input_schema?.properties?.frames, undefined);
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
    test('agent chat log helper exports reusable session log runtime and renderer consumes session UI ids', () => {
      const helperSource = fs.readFileSync(agentPath('context', 'agent-chat-log.js'), 'utf8');
      const chatLogConstantsSource = fs.readFileSync(agentPath('context', 'chat-log', 'constants.js'), 'utf8');
      const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'session-manager.js'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      assert.match(chatLogConstantsSource, /const CHAT_LOG_FOLDER_NAME = 'chat_log';/);
      assert.match(chatLogConstantsSource, /const CHAT_LOG_INDEX_FILE_NAME = 'index\.json';/);
      assert.match(chatLogConstantsSource, /const CHAT_LOG_EVENT_TYPES = Object\.freeze/);
      assert.match(helperSource, /function createAgentChatLogRuntime\(deps = \{\}\)/);
      assert.match(helperSource, /async function createSession\(input = \{\}\)/);
      assert.match(helperSource, /async function listSessions\(input = \{\}\)/);
      assert.match(helperSource, /async function getSession\(input = \{\}\)/);
      assert.match(rendererSource, /agentChatLogListSessions/);
      assert.match(rendererSource, /agentChatLogGetSession/);
      assert.match(rendererSource, /agentChatLogCreateSession/);
      assert.match(rendererSource, /function renderSessionList\(\)/);
      assert.match(html, /id="agent-session-list"/);
      assert.match(html, /id="agent-new-chat-btn"/);
    });
    test('literature, paper context, paper analysis, and protocol generation helpers expose reusable runtimes and registered tools', () => {
      const webSearchSource = fs.readFileSync(agentPath('tools', 'agent-web-search.js'), 'utf8');
      const literatureSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'search', 'agent-literature-search.js'), 'utf8');
      const literatureConstantsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'search', 'literature-search', 'constants.js'), 'utf8');
      const literatureQuerySource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'search', 'literature-search', 'query-and-results.js'), 'utf8');
      const paperContextSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'retrieve', 'agent-paper-context-loader.js'), 'utf8');
      const paperContextSchemasSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'retrieve', 'paper-context', 'schemas.js'), 'utf8');
      const paperDownloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'download', 'agent-paper-download.js'), 'utf8');
      const paperDownloadConstantsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'download', 'paper-download', 'constants.js'), 'utf8');
      const paperDownloadTargetsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'download', 'paper-download', 'url-targets.js'), 'utf8');
      const paperSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'papers', 'analysis', 'agent-paper-analysis.js'), 'utf8');
      const protocolSource = fs.readFileSync(agentPath('tools', 'agent-protocol-generation.js'), 'utf8');
      const llmUtilsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'llm', 'runtime-helpers.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      const codexAgentProviderSource = fs.readFileSync(agentPath('shared', 'llm-providers', 'codex-agent-provider.js'), 'utf8');
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'core', 'services', 'create-agent-services.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(webSearchSource, /function createWebSearchRuntime\(deps = \{\}\)/);
      assert.match(webSearchSource, /async function searchWebResults\(input = \{\}\)/);
      assert.match(webSearchSource, /requestWebSearch/);
      assert.match(literatureConstantsSource, /const LITERATURE_SOURCES = Object\.freeze/);
      assert.match(literatureQuerySource, /agent-search-source-preferences\.js/);
      assert.match(literatureSource, /function createLiteratureSearchRuntime\(deps = \{\}\)/);
      assert.match(literatureQuerySource, /function buildLiteratureQuery\(input = \{\}\)/);
      assert.match(literatureSource, /async function searchLiterature\(input = \{\}\)/);
      assert.match(paperContextSchemasSource, /const PAPER_CONTEXT_SOURCE_ORDER = Object\.freeze/);
      assert.match(paperContextSource, /function createPaperContextLoaderRuntime\(deps = \{\}\)/);
      assert.match(paperContextSource, /async function loadPaperContexts\(input = \{\}\)/);
      assert.equal(paperContextSource.includes('paper-download'), false);
      assert.equal(paperContextSource.includes('storage_path'), false);
      assert.equal(readSource('src/main/papers/search/agent-literature-search.js').includes("require('../../lib/llm/runtime-helpers.js')"), true);
      assert.match(paperDownloadConstantsSource, /const PAPER_DOWNLOAD_ACTIONS = Object\.freeze/);
      assert.match(paperDownloadSource, /function createPaperDownloadRuntime\(deps = \{\}\)/);
      assert.match(paperDownloadTargetsSource, /function extractPaperDownloadTargets\(input = \{\}\)/);
      assert.match(paperDownloadSource, /async function downloadPaper\(input = \{\}\)/);
      assert.match(paperDownloadSource, /browser-assisted download session/i);
      assert.match(paperSource, /function createPaperAnalysisRuntime\(deps = \{\}\)/);
      assert.match(paperSource, /protocolGenerationRuntime/);
      assert.doesNotMatch(paperSource, /agent\/tools\/agent-protocol-generation/);
      assert.match(paperSource, /async function analyzePaper\(input = \{\}\)/);
      assert.match(protocolSource, /function createProtocolGenerationRuntime\(deps = \{\}\)/);
      assert.match(protocolSource, /async function generateProtocol\(input = \{\}\)/);
      assert.match(protocolSource, /troubleshooting/);
      assert.match(protocolSource, /\{\{ph:/);
      assert.match(llmUtilsSource, /createScopedLlmApi/);
      assert.match(llmUtilsSource, /requestText/);
      assert.match(llmUtilsSource, /requestImageInput/);
      assert.match(llmUtilsSource, /requestFileInput/);
      assert.match(llmUtilsSource, /requestWebSearch/);
      assert.doesNotMatch(llmUtilsSource, /createAgentLlmProviderBridge/);
      assert.doesNotMatch(llmUtilsSource, /requestOpenAiResponsesWithBackoff/);
      assert.doesNotMatch(llmUtilsSource, /requestClaudeMessagesWithBackoff/);
      assert.doesNotMatch(llmUtilsSource, /requestGeminiGenerateContentWithBackoff/);
      assert.match(llmBridgeSource, /llm-providers\/codex-agent-provider/);
      assert.doesNotMatch(llmBridgeSource, /llm-providers\/(openai|claude|gemini|deepseek)-provider/);
      assert.match(codexAgentProviderSource, /enableWebSearch/);
      assert.match(mainAgentServicesSource, /createWebSearchRuntime/);
      assert.match(mainAgentServicesSource, /const webSearchRuntime = createWebSearchRuntime/);
      assert.match(mainAgentServicesSource, /webSearchRuntime,/);
      assert.match(mainAgentServicesSource, /createPaperContextLoaderRuntime/);
      assert.match(mainAgentServicesSource, /paperContextLoaderRuntime/);
      assert.equal(readSource('src/main/papers/analysis/agent-paper-analysis.js').includes("require('../../lib/llm/runtime-helpers.js')"), true);
      assert.equal(readSource('src/main/agent/tools/agent-protocol-generation.js').includes("require('../shared/agent-llm-utils.js')"), false);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'web-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-analysis'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
      assert.equal(Boolean(toolCallCatalog['web-search']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['literature-search']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['paper-download']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['paper-analysis']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['notebook-draft']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['protocol-generation']?.input_schema), true);
      assert.equal(toolCallCatalog['protocol-generation']?.input_schema?.properties?.save?.type, 'boolean');
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
    test('direct LLM module registry is wired through main IPC and preload', () => {
      const channelsSource = readLocalSource('src', 'shared', 'ipc', 'channels.js');
      const preloadSource = readLocalSource('src', 'main', 'preload', 'api', 'llm-api.js');
      const mainRuntimeSource = readLocalSource('src', 'main', 'core', 'main-services.js');
      const mainAgentServicesSource = readLocalSource('src', 'main', 'core', 'services', 'create-agent-services.js');
      const systemRegistrarSource = readLocalSource('src', 'main', 'ipc', 'register-system-ipc.js');
      const directLlmSource = readLocalSource('src', 'renderer', 'services', 'direct-llm.js');
      const papersLlmSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'llm.js');
      const protocolGenerationSource = readLocalSource('src', 'renderer', 'modules', 'protocol', 'generation.js');
      const chemicalImportMappingSource = readLocalSource('src', 'renderer', 'modules', 'lab-common-inventory', 'import-header-mapping.js');

      assert.match(channelsSource, /DIRECT_MODULES:\s*'llm:direct-modules'/);
      assert.match(channelsSource, /DIRECT_GENERATE:\s*'llm:direct-generate'/);
      assert.match(preloadSource, /getDirectLlmModules:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(LLM\.DIRECT_MODULES\)/);
      assert.match(preloadSource, /runDirectLlmPrompt:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(LLM\.DIRECT_GENERATE, payload\)/);
      assert.match(mainAgentServicesSource, /createDirectLlmModuleRegistry/);
      assert.match(mainAgentServicesSource, /registerDefaultDirectLlmModules/);
      assert.match(mainAgentServicesSource, /directLlmRegistry/);
      assert.match(mainRuntimeSource, /directLlmRegistry:\s*agents\.directLlmRegistry/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.DIRECT_MODULES/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.DIRECT_GENERATE/);
      assert.match(directLlmSource, /runDirectLlmPrompt/);
      assert.match(papersLlmSource, /requestDirectLlmText/);
      assert.doesNotMatch(papersLlmSource, /runDirectLlmPrompt/);
      assert.doesNotMatch(protocolGenerationSource, /requestDirectLlmText/);
      assert.match(protocolGenerationSource, /api\.agentGenerateProtocol/);
      assert.match(protocolGenerationSource, /Research online and search papers/);
      assert.match(chemicalImportMappingSource, /chemical-header-mapping/);
    });
    test('purchase recommendation helper exposes reusable runtime and tool contracts', () => {
      const purchaseSource = fs.readFileSync(agentPath('tools', 'agent-purchase-recommendation.js'), 'utf8');
      const purchaseQuerySource = fs.readFileSync(agentPath('tools', 'purchase-recommendation', 'search-queries.js'), 'utf8');
      const purchaseExtractionSource = fs.readFileSync(agentPath('tools', 'purchase-recommendation', 'product-extraction.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(purchaseSource, /function createPurchaseRecommendationRuntime\(deps = \{\}\)/);
      assert.match(purchaseQuerySource, /function buildSearchQuery\(input = \{\}\)/);
      assert.match(purchaseExtractionSource, /function extractProductFromHtml\(html = '', pageUrl = ''\)/);
      assert.match(purchaseExtractionSource, /const completeJsonLdProduct =/);
      assert.match(purchaseExtractionSource, /readMetaContent\(html, 'property', 'og:image'\)/);
      assert.match(purchaseSource, /follow_up_questions/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
      assert.equal(Boolean(toolCallCatalog['purchase-recommendation']?.input_schema), true);
      assert.equal(typeof toolCallCatalog['purchase-recommendation']?.description, 'string');
    });
    test('main wires provider-neutral LLM helpers and Agent observability', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'core', 'services', 'create-agent-services.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/\.\.\/agent\/shared\/agent-inventory-search-terms\.js'\)/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/\.\.\/agent\/shared\/agent-observability'\)/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/\.\.\/agent\/shared\/agent-controller-utils'\)/);
      assert.match(mainSource, /registerAgentIpc/);
      assert.match(llmBridgeSource, /function createAgentLlmProviderBridge\(deps = \{\}\)/);
      assert.match(llmBridgeSource, /function requestText\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestImageInput\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestFileInput\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestWebSearch\(options = \{\}\)/);
      assert.doesNotMatch(llmBridgeSource, /function startToolSession\(/);
      assert.doesNotMatch(llmBridgeSource, /function continueToolSessionWithToolOutputs\(/);
      assert.doesNotMatch(llmBridgeSource, /function continueToolSessionWithUserMessage\(/);
      assert.match(controllerUtilsSource, /resolveAgentLlmSource/);
      assert.match(controllerUtilsSource, /createAgentLlmRuntimeHelpers/);
      assert.match(mainAgentServicesSource, /createAgentLlmProviderBridge/);
      assert.match(controllerUtilsSource, /recordAgentLlmTrace/);
      assert.equal(/agent-sqlite-index/.test(mainSource), false);
      assert.equal(/agent-phase89-runtime/.test(mainSource), false);
    });
    test('inventory and notebook lookups use individual runtimes with shared storage support', () => {
      const supportSource = readSource('src/main/agent/tools/agent-lookup-support.js');
      const inventorySource = readSource('src/main/agent/tools/agent-inventory-lookup.js');
      const notebookSource = readSource('src/main/agent/tools/agent-notebook-lookup.js');
      const retiredLookupFile = ['agent', 'record', 'lookup'].join('-');
      assert.equal(supportSource.includes(retiredLookupFile), false);
      assert.match(supportSource, /createAgentLookupSupport/);
      assert.match(inventorySource, /createAgentInventoryLookupRuntime/);
      assert.match(notebookSource, /createAgentNotebookLookupRuntime/);
      assert.match(notebookSource, /searchNotebookEntries/);
      assert.match(notebookSource, /async function execute\(/);
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
    test('main registers shared agent runtime factories before composing higher-level runtimes', () => {
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'core', 'services', 'create-agent-services.js'), 'utf8');
      const retiredToolName = ['record', 'lookup'].join('-');
      const retiredFactoryName = ['createAgent', 'LookupRuntime'].join('Record');
      assert.match(mainAgentServicesSource, /createAgentRuntimeRegistry/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('inventory-lookup', createAgentInventoryLookupRuntime\)/);
      assert.equal(mainAgentServicesSource.includes(retiredToolName), false);
      assert.equal(mainAgentServicesSource.includes(retiredFactoryName), false);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('protocol-matching', createProtocolMatchingRuntime\)/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('notebook-generation', createNotebookGenerationRuntime\)/);
      assert.match(mainAgentServicesSource, /createAgentSubAppApi/);
      assert.match(mainAgentServicesSource, /agentAppApi/);
      assert.match(mainAgentServicesSource, /getAgentRuntimeFactory:\s*agentRuntimeRegistry\.getRuntimeFactory/);
      assert.match(mainAgentServicesSource, /createAgentLookupSupport/);
      assert.match(mainAgentServicesSource, /createAgentInventoryLookupRuntime/);
      assert.match(mainAgentServicesSource, /createAgentNotebookLookupRuntime/);
      assert.doesNotMatch(mainAgentServicesSource, /createAgentLookupRuntime/);
    });
  }
};
