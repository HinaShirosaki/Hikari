module.exports = function registerAgentContractsBPart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
    const agentPath = (...parts) => path.join(agentDir, ...parts);
    const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', ...parts);
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'main.js'),
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'core', 'start-hikari-main-core.js'),
      readLocalSource('src', 'main', 'app', 'main-runtime.js'),
      readLocalSource('src', 'main', 'ipc', 'index.js')
    ].join('\n');
    test('science reasoning helper exports shared loop runtime and renderer consumes science payloads', () => {
      const helperSource = fs.readFileSync(agentPath('runtime', 'science-reasoning-loop', 'index.js'), 'utf8');
      const policySource = fs.readFileSync(agentPath('runtime', 'science-reasoning-loop', 'policies.js'), 'utf8');
      const runtimeSource = fs.readFileSync(agentPath('runtime', 'science-reasoning-loop', 'runtime.js'), 'utf8');
      const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), 'utf8');
      const responseSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat-response.js'), 'utf8');
      assert.match(helperSource, /require\('\.\/policies\.js'\)/);
      assert.match(helperSource, /require\('\.\/schemas\.js'\)/);
      assert.match(helperSource, /require\('\.\/runtime\.js'\)/);
      assert.match(policySource, /const SCIENCE_REASONING_INTENTS = Object\.freeze/);
      assert.doesNotMatch(policySource, /const SCIENCE_REASONING_POLICIES = Object\.freeze/);
      assert.match(policySource, /function getScienceReasoningPolicy\(intent\)/);
      assert.match(runtimeSource, /function createScienceReasoningLoopRuntime\(deps = \{\}\)/);
      assert.match(runtimeSource, /async function runIntentLoop\(input = \{\}\)/);
      assert.match(runtimeSource, /async function runGeneralScienceQuestion\(input = \{\}\)/);
      assert.match(runtimeSource, /async function runProjectScienceQuestion\(input = \{\}\)/);
      assert.match(runtimeSource, /async function runResultAnalysis\(input = \{\}\)/);
      assert.match(responseSource, /export function summarizeScienceResult/);
      assert.match(responseSource, /export function normalizeAgentResponse/);
      assert.match(responseSource, /const scienceAnswerText = summarizeScienceResult\(generalScienceQuestion\)/);
      assert.match(rendererSource, /normalizeAgentResponse/);
      assert.match(rendererSource, /general_science_question/);
      assert.match(rendererSource, /project_science_question/);
      assert.match(rendererSource, /result_analysis/);
    });
    test('deep research helper exports stepwise runtime and the app wires the toggle and routing', () => {
      const helperSource = fs.readFileSync(agentPath('deep-research', 'index.js'), 'utf8');
      const step4Source = fs.readFileSync(agentPath('deep-research', 'step-4-execute-plan.js'), 'utf8');
      const step5Source = fs.readFileSync(agentPath('deep-research', 'step-5-assemble-final-answer.js'), 'utf8');
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const agentRegistrarSource = fs.readFileSync(agentRegistrarPath('index.js'), 'utf8');
      const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
      const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), 'utf8');
      const sharedSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'app-state.js'), 'utf8');
      const agentViewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'agent-view.html'), 'utf8');

      assert.match(helperSource, /const DEEP_RESEARCH_INTENTS = Object\.freeze/);
      assert.match(helperSource, /function createDeepResearchRuntime\(deps = \{\}\)/);
      assert.match(helperSource, /runStep1ClarifyQuestion/);
      assert.match(helperSource, /runStep5AssembleFinalAnswer/);
      assert.match(step4Source, /async function runStep4ExecutePlan\(input = \{\}, deps = \{\}\)/);
      assert.match(step5Source, /async function runStep5AssembleFinalAnswer\(input = \{\}, deps = \{\}\)/);
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /createDeepResearchRuntime/);
      assert.match(mainAgentServicesSource, /const deepResearchRuntime = createDeepResearchRuntime/);
      assert.match(agentRegistrarSource, /deepResearchRuntime: deps\.deepResearchRuntime/);
      assert.match(controllerCoreSource, /payload\?\.agent\?\.deepResearchEnabled === true/);
      assert.match(rendererSource, /agent-deep-research-toggle-btn/);
      assert.match(rendererSource, /deepResearchEnabled: state\.agentChat\.deepResearchEnabled === true/);
      assert.match(sharedSource, /deepResearchEnabled: false/);
      assert.match(sharedSource, /deepResearchEnabled: source\.agentChat\?\.deepResearchEnabled === true/);
      assert.match(agentViewSource, /id="agent-deep-research-toggle-btn"/);
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
    test('context management and memory helpers export reusable runtimes with layered and action-based contracts', () => {
      const contextSource = fs.readFileSync(agentPath('context', 'agent-context-management.js'), 'utf8');
      const registrySource = fs.readFileSync(agentPath('context', 'agent-context-registry.js'), 'utf8');
      const memorySource = fs.readFileSync(agentPath('context', 'agent-memory.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(contextSource, /const CONTEXT_LAYER_IDS = Object\.freeze/);
      assert.match(contextSource, /const CONTEXT_MODES = Object\.freeze/);
      assert.match(contextSource, /const CONTEXT_REGISTRY_SECTIONS = Object\.freeze/);
      assert.match(contextSource, /function createAgentContextManagementRuntime\(deps = \{\}\)/);
      assert.match(contextSource, /function startTask\(input = \{\}\)/);
      assert.match(contextSource, /function completeTask\(input = \{\}\)/);
      assert.match(contextSource, /function buildContextRegistry\(input = \{\}\)/);
      assert.match(contextSource, /function buildContextEnvelope\(input = \{\}\)/);
      assert.match(contextSource, /function getContextRegistry\(sessionId\)/);
      assert.match(registrySource, /function createAgentContextRegistryRuntime\(deps = \{\}\)/);
      assert.match(memorySource, /const MEMORY_ACTIONS = Object\.freeze/);
      assert.match(memorySource, /function createAgentMemoryRuntime\(deps = \{\}\)/);
      assert.match(memorySource, /async function remember\(input = \{\}\)/);
      assert.match(memorySource, /async function recall\(input = \{\}\)/);
      assert.match(memorySource, /async function forget\(input = \{\}\)/);
      assert.match(memorySource, /async function list\(input = \{\}\)/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'memory'), true);
      assert.deepEqual(toolCallCatalog.memory?.input_schema?.properties?.action?.enum, ['recall', 'remember', 'forget', 'list']);
    });
    test('agent chat log helper exports reusable session log runtime and renderer consumes session UI ids', () => {
      const helperSource = fs.readFileSync(agentPath('context', 'agent-chat-log.js'), 'utf8');
      const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), 'utf8');
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      assert.match(helperSource, /const CHAT_LOG_FOLDER_NAME = 'chat_log';/);
      assert.match(helperSource, /const CHAT_LOG_INDEX_FILE_NAME = 'index\.json';/);
      assert.match(helperSource, /const CHAT_LOG_EVENT_TYPES = Object\.freeze/);
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
      const literatureSource = fs.readFileSync(agentPath('tools', 'agent-literature-search.js'), 'utf8');
      const paperContextSource = fs.readFileSync(agentPath('tools', 'agent-paper-context-loader.js'), 'utf8');
      const paperDownloadSource = fs.readFileSync(agentPath('tools', 'agent-paper-download.js'), 'utf8');
      const paperSource = fs.readFileSync(agentPath('tools', 'agent-paper-analysis.js'), 'utf8');
      const protocolSource = fs.readFileSync(agentPath('tools', 'agent-protocol-generation.js'), 'utf8');
      const llmUtilsSource = fs.readFileSync(agentPath('shared', 'agent-llm-utils.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      const codexAgentProviderSource = fs.readFileSync(agentPath('shared', 'llm-providers', 'codex-agent-provider.js'), 'utf8');
      const openAiProviderSource = fs.readFileSync(agentPath('shared', 'llm-providers', 'openai-provider.js'), 'utf8');
      const claudeProviderSource = fs.readFileSync(agentPath('shared', 'llm-providers', 'claude-provider.js'), 'utf8');
      const geminiProviderSource = fs.readFileSync(agentPath('shared', 'llm-providers', 'gemini-provider.js'), 'utf8');
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(webSearchSource, /function createWebSearchRuntime\(deps = \{\}\)/);
      assert.match(webSearchSource, /async function searchWebResults\(input = \{\}\)/);
      assert.match(webSearchSource, /requestWebSearch/);
      assert.match(literatureSource, /const LITERATURE_SOURCES = Object\.freeze/);
      assert.match(literatureSource, /agent-search-source-preferences\.js/);
      assert.match(literatureSource, /function createLiteratureSearchRuntime\(deps = \{\}\)/);
      assert.match(literatureSource, /function buildLiteratureQuery\(input = \{\}\)/);
      assert.match(literatureSource, /async function searchLiterature\(input = \{\}\)/);
      assert.match(paperContextSource, /const PAPER_CONTEXT_SOURCE_ORDER = Object\.freeze/);
      assert.match(paperContextSource, /function createPaperContextLoaderRuntime\(deps = \{\}\)/);
      assert.match(paperContextSource, /async function loadPaperContexts\(input = \{\}\)/);
      assert.equal(paperContextSource.includes('paper-download'), false);
      assert.equal(paperContextSource.includes('storage_path'), false);
      assert.equal(readSource('src/main/helpers/agent/tools/agent-literature-search.js').includes("require('../shared/agent-llm-utils.js')"), true);
      assert.match(paperDownloadSource, /const PAPER_DOWNLOAD_ACTIONS = Object\.freeze/);
      assert.match(paperDownloadSource, /function createPaperDownloadRuntime\(deps = \{\}\)/);
      assert.match(paperDownloadSource, /function extractPaperDownloadTargets\(input = \{\}\)/);
      assert.match(paperDownloadSource, /async function downloadPaper\(input = \{\}\)/);
      assert.match(paperDownloadSource, /browser-assisted download session/i);
      assert.match(paperSource, /function createPaperAnalysisRuntime\(deps = \{\}\)/);
      assert.match(paperSource, /createProtocolGenerationRuntime/);
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
      assert.match(llmBridgeSource, /llm-providers\/openai-provider/);
      assert.match(llmBridgeSource, /llm-providers\/claude-provider/);
      assert.match(llmBridgeSource, /llm-providers\/gemini-provider/);
      assert.match(openAiProviderSource, /input_file/);
      assert.match(geminiProviderSource, /inlineData/);
      assert.match(claudeProviderSource, /document/);
      assert.match(codexAgentProviderSource, /enableWebSearch/);
      assert.match(mainAgentServicesSource, /createWebSearchRuntime/);
      assert.match(mainAgentServicesSource, /const webSearchRuntime = createWebSearchRuntime/);
      assert.match(mainAgentServicesSource, /webSearchRuntime,/);
      assert.match(mainAgentServicesSource, /createPaperContextLoaderRuntime/);
      assert.match(mainAgentServicesSource, /paperContextLoaderRuntime/);
      assert.equal(readSource('src/main/helpers/agent/tools/agent-paper-analysis.js').includes("require('../shared/agent-llm-utils.js')"), true);
      assert.equal(readSource('src/main/helpers/agent/tools/agent-protocol-generation.js').includes("require('../shared/agent-llm-utils.js')"), false);
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
      } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'llm', 'direct-llm-module-registry.js'));
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
    test('direct LLM module registry is wired through main IPC and preload', () => {
      const channelsSource = readLocalSource('src', 'shared', 'ipc', 'channels.js');
      const preloadSource = readLocalSource('src', 'main', 'preload', 'api', 'llm-api.js');
      const mainRuntimeSource = readLocalSource('src', 'main', 'core', 'start-hikari-main-core.js');
      const mainAgentServicesSource = readLocalSource('src', 'main', 'helpers', 'main', 'create-main-agent-services.js');
      const systemRegistrarSource = readLocalSource('src', 'main', 'ipc', 'register-system-ipc.js');
      const directLlmSource = readLocalSource('src', 'renderer', 'modules', 'direct-llm.js');
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
      assert.match(mainRuntimeSource, /directLlmRegistry:\s*agentServices\.directLlmRegistry/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.DIRECT_MODULES/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.DIRECT_GENERATE/);
      assert.match(directLlmSource, /runDirectLlmPrompt/);
      assert.match(papersLlmSource, /requestDirectLlmText/);
      assert.doesNotMatch(papersLlmSource, /runDirectLlmPrompt/);
      assert.match(protocolGenerationSource, /task:\s*'protocol-generation'/);
      assert.match(chemicalImportMappingSource, /chemical-header-mapping/);
    });
    test('purchase recommendation helper exposes reusable runtime and tool contracts', () => {
      const purchaseSource = fs.readFileSync(agentPath('tools', 'agent-purchase-recommendation.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));

      assert.match(purchaseSource, /function createPurchaseRecommendationRuntime\(deps = \{\}\)/);
      assert.match(purchaseSource, /function buildSearchQuery\(input = \{\}\)/);
      assert.match(purchaseSource, /function extractProductFromHtml\(html = '', pageUrl = ''\)/);
      assert.match(purchaseSource, /const completeJsonLdProduct =/);
      assert.match(purchaseSource, /readMetaContent\(html, 'property', 'og:image'\)/);
      assert.match(purchaseSource, /follow_up_questions/);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
      assert.equal(Boolean(toolCallCatalog['purchase-recommendation']?.input_schema), true);
      assert.equal(typeof toolCallCatalog['purchase-recommendation']?.description, 'string');
    });
    test('main wires intent parser + observability paths for parser-only controller', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      const sessionRuntimeSource = fs.readFileSync(agentPath('runtime', 'agent-session-runtime.js'), 'utf8');
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/intent\/agent-intent-parser'\)/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/shared\/agent-observability'\)/);
      assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/shared\/agent-controller-utils'\)/);
      assert.match(mainSource, /registerAgentIpc/);
      assert.match(controllerCoreSource, /requestIntentParserPayload\(/);
      assert.match(llmBridgeSource, /function createAgentLlmProviderBridge\(deps = \{\}\)/);
      assert.match(llmBridgeSource, /function requestText\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestImageInput\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestFileInput\(options = \{\}\)/);
      assert.match(llmBridgeSource, /function requestWebSearch\(options = \{\}\)/);
      assert.doesNotMatch(llmBridgeSource, /function startToolSession\(/);
      assert.doesNotMatch(llmBridgeSource, /function continueToolSessionWithToolOutputs\(/);
      assert.doesNotMatch(llmBridgeSource, /function continueToolSessionWithUserMessage\(/);
      assert.match(controllerUtilsSource, /requestStructuredJsonPayload\(/);
      assert.match(controllerUtilsSource, /resolveAgentLlmSource/);
      assert.match(controllerUtilsSource, /createAgentLlmRuntimeHelpers/);
      assert.match(mainAgentServicesSource, /createAgentLlmProviderBridge/);
      assert.doesNotMatch(sessionRuntimeSource, /agent-llm-provider-bridge\.js/);
      assert.match(controllerUtilsSource, /recordAgentLlmTrace/);
      assert.match(sessionRuntimeSource, /recordAgentLlmTrace\(/);
      assert.equal(/agent-sqlite-index/.test(mainSource), false);
      assert.equal(/agent-phase89-runtime/.test(mainSource), false);
    });
    test('agent lookup runtime composes reusable inventory and record helpers', () => {
      const source = readSource('src/main/helpers/agent/runtime/agent-lookup-runtime.js');
      assert.match(source, /resolveAgentRuntimeFactory/);
      assert.match(source, /require\('\.\.\/tools\/agent-inventory-lookup'\)/);
      assert.match(source, /require\('\.\.\/tools\/agent-record-lookup\.js'\)/);
      assert.match(source, /createAgentInventoryLookupRuntime\(\{/);
      assert.match(source, /createAgentRecordLookupRuntime\(sharedLookupDeps\)/);
      assert.match(source, /searchInventoryIndex:\s*inventoryLookupRuntime\.searchInventoryIndex/);
      assert.match(source, /searchRecordIndex:\s*recordLookupRuntime\.searchRecordIndex/);
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
    test('agent lookup runtime can use registry-provided helper factories', async () => {
      const { createAgentLookupRuntime } = require(agentPath('runtime', 'agent-lookup-runtime.js'));
      const requestedFactories = [];
      const lookupRuntime = createAgentLookupRuntime({
        getAgentRuntimeFactory: (runtimeName) => {
          requestedFactories.push(runtimeName);
          if (runtimeName === 'inventory-lookup') {
            return () => ({
              async searchInventoryIndex({ query } = {}) {
                return { status: 'matched', source: 'registry_inventory', items: [{ id: 'inv-1', name: String(query || '') }] };
              },
              async executeInventoryLookup() {
                return { status: 'matched', items: [] };
              }
            });
          }
          if (runtimeName === 'record-lookup') {
            return () => ({
              async searchRecordIndex({ query } = {}) {
                return { status: 'matched', source: 'registry_record', items: [{ id: 'rec-1', name: String(query || '') }] };
              },
              async executeRecordLookup() {
                return { status: 'matched', items: [] };
              }
            });
          }
          return null;
        }
      });

      const inventorySearch = await lookupRuntime.searchInventoryIndex({ query: 'Atlas construct' });
      const recordSearch = await lookupRuntime.searchRecordIndex({ query: 'Protein Purification' });

      assert.deepEqual(requestedFactories, ['inventory-lookup', 'record-lookup']);
      assert.equal(inventorySearch.source, 'registry_inventory');
      assert.equal(recordSearch.source, 'registry_record');
    });
    test('main registers shared agent runtime factories before composing higher-level runtimes', () => {
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      assert.match(mainAgentServicesSource, /createAgentRuntimeRegistry/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('inventory-lookup', createAgentInventoryLookupRuntime\)/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('record-lookup', createAgentRecordLookupRuntime\)/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('protocol-matching', createProtocolMatchingRuntime\)/);
      assert.match(mainAgentServicesSource, /registerRuntimeFactory\('notebook-generation', createNotebookGenerationRuntime\)/);
      assert.match(mainAgentServicesSource, /createAgentSubAppApi/);
      assert.match(mainAgentServicesSource, /agentAppApi/);
      assert.match(mainAgentServicesSource, /getAgentRuntimeFactory:\s*agentRuntimeRegistry\.getRuntimeFactory/);
    });
  }
};
