module.exports = function registerAgentContractsA(context = {}) {
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
      readLocalSource('src', 'main', 'core', 'main-service-catalog.js'),
      readLocalSource('src', 'main', 'core', 'catalog', 'app-services.js'),
      readLocalSource('src', 'main', 'core', 'catalog', 'agent-services.js'),
      readLocalSource('src', 'main', 'core', 'catalog', 'ipc-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-mcp-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js'),
      readLocalSource('src', 'main', 'helpers', 'main', 'create-main-agent-services.js'),
      readLocalSource('src', 'main', 'app', 'main-runtime.js'),
      readLocalSource('src', 'main', 'ipc', 'index.js')
    ].join('\n');
    const readPreloadSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'agent-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'llm-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'system-api.js')
    ].join('\n');

    test('agent registrar keeps intent-only lifecycle stages and replay IPC handlers', () => {
      const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
      const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
      const apiControllerSource = fs.readFileSync(agentRegistrarPath('api-agent-controller.js'), 'utf8');
      const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
      const combinedSource = `${agentChatHandlerSource}\n${controllerCoreSource}\n${apiControllerSource}\n${logHandlersSource}`;
      assert.match(agentChatHandlerSource, /createLifecycleRecorder/);
      assert.match(agentChatHandlerSource, /recordLifecycleEvent/);
      assert.match(agentChatHandlerSource, /appendAgentChatLogEntry/);
      assert.match(controllerCoreSource, /controller_intent_only_selected/);
      assert.match(controllerCoreSource, /require\('\.\/api-agent-controller'\)/);
      assert.match(apiControllerSource, /stage: 'controller_intent_only'/);
      assert.match(apiControllerSource, /stage: 'parser_completed'/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.LOGS_LIST_REQUESTS/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.LOGS_REPLAY/);
      assert.equal(/agent-validation-safety/.test(combinedSource), false);
    });

    test('agent no longer depends on a serialized io contract file', () => {
      const mainSource = readMainProcessSource();
      const preloadSource = readPreloadSource();
      const promptsSource = fs.readFileSync(path.join(__dirname, 'data', 'llm-prompts.json'), 'utf8');
      assert.equal(mainSource.includes('agent-io-contract.json'), false);
      assert.equal(mainSource.includes("agent:get-io-contract"), false);
      assert.equal(preloadSource.includes('getAgentIoContract'), false);
      assert.equal(promptsSource.includes('agent-io-contract.json'), false);
    });

    test('agent runtime support keeps snapshot normalization and synthesis helpers outside main', () => {
      const runtimeSupportSource = fs.readFileSync(agentPath('runtime', 'agent-runtime-support.js'), 'utf8');
      assert.match(runtimeSupportSource, /function normalizeAgentSnapshot\(rawSnapshot\)/);
      assert.match(runtimeSupportSource, /function buildAgentSystemPrompt\(projectName, prompts\)/);
      assert.match(runtimeSupportSource, /function buildAgentSynthesisPrompt\(_requiresApproval, prompts\)/);
      assert.match(runtimeSupportSource, /function normalizeAgentOutput\(raw, fallbackText\)/);
    });

    test('generic agent tool catalog keeps key retrieval and execution tools', () => {
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'inventory-lookup'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'record-lookup'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'python-sandbox'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'command-line'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'web-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'container'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'assay-table'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'plotly-graph'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
    });

    test('agent log replay and developer tool smoke-test IPC bridges remain wired without contract file', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
      const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /createAgentToolSmokeTestRuntime/);
      assert.match(mainSource, /registerAgentIpc/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.DEVELOPER_TEST_TOOLS/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.DEVELOPER_CONTEXT_PREVIEW/);
      assert.match(logHandlersSource, /agentToolSmokeTestRuntime\.runTool/);
      assert.match(logHandlersSource, /normalizedPayload\?\.toolName/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.LOGS_LIST_REQUESTS/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.LOGS_REPLAY/);
      assert.match(agentChatHandlerSource, /AGENT_PROGRESS_EVENT/);
      assert.match(agentChatHandlerSource, /clientRequestId/);
      assert.match(agentChatHandlerSource, /request_id:/);
      assert.match(preloadSource, /agentDeveloperTestTools:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.DEVELOPER_TEST_TOOLS, payload\)/);
      assert.match(preloadSource, /agentDeveloperContextPreview:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.DEVELOPER_CONTEXT_PREVIEW, payload\)/);
      assert.match(preloadSource, /agentLogsListRequests:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.LOGS_LIST_REQUESTS\)/);
      assert.match(preloadSource, /agentLogsReplay:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.LOGS_REPLAY, payload\)/);
      assert.match(preloadSource, /onAgentProgress:\s*\(handler\)\s*=>\s*\{/);
      assert.match(preloadSource, /ipcRenderer\.on\(AGENT_PROGRESS_EVENT, listener\)/);
    });

    test('agent chat session log IPC bridges are wired through agent registrar and preload', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /createAgentChatLogRuntime/);
      assert.match(mainSource, /registerAgentIpc/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.CHAT_LOG_CREATE_SESSION/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.CHAT_LOG_LIST_SESSIONS/);
      assert.match(logHandlersSource, /ipcMain\.handle\(AGENT\.CHAT_LOG_GET_SESSION/);
      assert.match(preloadSource, /agentChatLogCreateSession:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.CHAT_LOG_CREATE_SESSION, payload\)/);
      assert.match(preloadSource, /agentChatLogListSessions:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.CHAT_LOG_LIST_SESSIONS, payload\)/);
      assert.match(preloadSource, /agentChatLogGetSession:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(AGENT\.CHAT_LOG_GET_SESSION, payload\)/);
    });

    test('agent registrar controller output returns parser payload and optional developer trace', () => {
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
      const apiControllerSource = fs.readFileSync(agentRegistrarPath('api-agent-controller.js'), 'utf8');
      const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
      const openContextRuntimeSource = fs.readFileSync(agentRegistrarPath('agent-open-context-runtime.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
      assert.match(apiControllerSource, /const result = \{\s*ok: true,\s*parser: parserResult\.payload\s*\}/);
      assert.match(dispatcherSource, /createAgentOpenContextRuntime/);
      assert.match(dispatcherSource, /dispatchOpenContextIntent/);
      assert.match(openContextRuntimeSource, /if \(cleanText\(parserPayload\?\.primary_intent, 80\) === 'protocol_to_notebook'\)/);
      assert.match(openContextRuntimeSource, /result\.protocol_to_notebook = protocolNotebookResult/);
      assert.match(dispatcherSource, /if \(parserPayload\.primary_intent === 'notebook_draft'\)/);
      assert.match(dispatcherSource, /result\.notebook_draft =/);
      assert.match(dispatcherSource, /runTrackedTool\('notebook-draft'/);
      assert.match(openContextRuntimeSource, /if \(cleanText\(parserPayload\?\.primary_intent, 80\) === 'inventory_lookup'\)/);
      assert.match(openContextRuntimeSource, /result\.inventory_lookup = inventoryLookupResult/);
      assert.match(openContextRuntimeSource, /if \(cleanText\(parserPayload\?\.primary_intent, 80\) === 'record_lookup'\)/);
      assert.match(openContextRuntimeSource, /result\.record_lookup = recordLookupResult/);
      assert.match(openContextRuntimeSource, /protocolNotebookRuntime\.runFlow\(/);
      assert.match(openContextRuntimeSource, /protocolNotebookRuntime\.hasPendingSession\(/);
      assert.match(openContextRuntimeSource, /stage: 'protocol_to_notebook_followup'/);
      assert.match(openContextRuntimeSource, /stage: 'inventory_lookup_completed'/);
      assert.match(openContextRuntimeSource, /stage: 'record_lookup_completed'/);
      assert.match(mainAgentServicesSource, /createAgentLookupRuntime/);
      assert.match(mainAgentServicesSource, /buildInventorySearchTerms/);
      assert.match(mainAgentServicesSource, /createProtocolNotebookRuntime/);
      assert.match(mainAgentServicesSource, /createNotebookDraftRuntime/);
      assert.match(apiControllerSource, /if \(executionFlags\.developerMode === true\) \{\s*result\.developer_trace = asArray\(traceContext\?\.rows\);/);
      assert.match(apiControllerSource, /requestIntentParserPayload\(/);
      assert.match(mainAgentServicesSource, /createAgentControllerUtils/);
      assert.match(controllerUtilsSource, /normalizeIntentParserPayload/);
      assert.match(controllerCoreSource, /runAgentControllerCore\(/);
      assert.equal(/controller_intent_only_selected/.test(controllerCoreSource), true);
      assert.equal(/controller_intent_only/.test(apiControllerSource), true);
    });

    test('codex-owned lifecycle stays scoped to agent chat while utility calls use the CLI adapter', () => {
      const mainRuntimeSource = readLocalSource('src', 'main', 'core', 'catalog', 'ipc-services.js');
      const mainAgentServicesSource = readLocalSource('src', 'main', 'helpers', 'main', 'create-main-agent-services.js');
      const codexServiceSource = readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js');
      const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
      const systemRegistrarSource = readLocalSource('src', 'main', 'ipc', 'register-system-ipc.js');
      const protocolPolishSource = readLocalSource('src', 'renderer', 'modules', 'protocol', 'polish.js');
      const directLlmSource = readLocalSource('src', 'renderer', 'modules', 'direct-llm.js');
      const papersLlmSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'llm.js');

      assert.match(controllerCoreSource, /codexAgentRuntime\.run\(/);
      assert.match(codexServiceSource, /const codexAgentRuntime = createCodexAgentRuntime\(\{[\s\S]*requestCodexAgentText,/);
      assert.match(mainAgentServicesSource, /const sharedLlmTransportDeps = \{[\s\S]*requestCodexCliText,[\s\S]*getCodexCliWorkingDirectory/);
      assert.equal(/requestCodexCliText:\s*requestCodexAgentText/.test(mainAgentServicesSource), false);
      assert.match(mainRuntimeSource, /registerSystemIpc\(\{[\s\S]*requestCodexCliText,[\s\S]*getCodexCliWorkingDirectory/);
      assert.equal(mainRuntimeSource.includes('agentServices.requestCodexAgentText || requestCodexCliText'), false);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_GENERATE/);
      assert.match(protocolPolishSource, /requestLlmText/);
      assert.match(directLlmSource, /runDirectLlmPrompt/);
      assert.doesNotMatch(papersLlmSource, /runCodexLlmPrompt/);
    });

    test('main agent logs persist redacted llm traces and replay wiring', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
      const observabilitySource = fs.readFileSync(agentPath('shared', 'agent-observability.js'), 'utf8');
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /createAgentControllerUtils/);
      assert.match(controllerUtilsSource, /SENSITIVE_TRACE_KEYS/);
      assert.match(controllerUtilsSource, /redactTracePayload/);
      assert.match(controllerUtilsSource, /type: 'agent-llm-trace'/);
      assert.match(observabilitySource, /const traces = rows/);
      assert.match(observabilitySource, /trace_stages/);
      assert.match(observabilitySource, /trace_request_payload_count/);
      assert.match(observabilitySource, /trace_response_payload_count/);
    });

    test('protocol runtimes preserve placeholder-fill and tie-break prompt guidance after extraction', () => {
      const protocolNotebookSource = fs.readFileSync(agentPath('runtime', 'agent-protocol-notebook.js'), 'utf8');
      const protocolNotebookContextSource = fs.readFileSync(agentPath('runtime', 'agent-protocol-notebook-context-control.js'), 'utf8');
      const protocolMatchingSource = fs.readFileSync(agentPath('tools', 'agent-protocol-matching.js'), 'utf8');
      const notebookGenerationSource = fs.readFileSync(agentPath('tools', 'agent-notebook-generation.js'), 'utf8');
      assert.match(protocolNotebookSource, /createProtocolNotebookContextControl/);
      assert.match(protocolNotebookSource, /protocolNotebookContextControl\.syncActionContext\(/);
      assert.match(protocolNotebookSource, /createProtocolMatchingRuntime/);
      assert.match(protocolNotebookSource, /createNotebookGenerationRuntime/);
      assert.match(protocolNotebookContextSource, /function createProtocolNotebookContextControl\(deps = \{\}\)/);
      assert.match(protocolNotebookContextSource, /function syncActionContext\(sessionKey, input = \{\}\)/);
      assert.match(protocolNotebookContextSource, /function closeContext\(sessionKey\)/);
      assert.match(notebookGenerationSource, /Extract exact value spans from the latest user text/);
      assert.match(notebookGenerationSource, /latest user message is a direct answer/);
      assert.match(notebookGenerationSource, /filled_values\.placeholder_key must exactly match one of the provided placeholder_key values/);
      assert.match(notebookGenerationSource, /Ask follow_up_questions only when ambiguity remains/);
      assert.match(notebookGenerationSource, /Example single-turn:/);
      assert.match(notebookGenerationSource, /Example follow-up:/);
      assert.match(protocolMatchingSource, /do not be over-cautious/);
      assert.match(protocolNotebookSource, /resolveAgentRuntimeFactory/);
    });

    test('agent registrar hard-errors when intent parser output is invalid', () => {
      const apiControllerSource = fs.readFileSync(agentRegistrarPath('api-agent-controller.js'), 'utf8');
      assert.match(apiControllerSource, /if \(!rawParserResult\?\.ok \|\| !rawParserResult\?\.payload\)/);
      assert.match(apiControllerSource, /ok:\s*false/);
      assert.match(apiControllerSource, /Intent parser failed:/);
    });

    test('science controller path is wired through the agent registrar and shared reasoning loop', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainAgentServicesSource, /createScienceReasoningLoopRuntime/);
      assert.match(mainAgentServicesSource, /continueAgentSessionWithUserMessage/);
      assert.match(dispatcherSource, /buildScienceRoutingFromParser/);
      assert.match(dispatcherSource, /result\.general_science_question\s*=\s*await scienceReasoningLoopRuntime\.runGeneralScienceQuestion/);
      assert.match(dispatcherSource, /result\.project_science_question\s*=\s*await scienceReasoningLoopRuntime\.runProjectScienceQuestion/);
      assert.match(dispatcherSource, /result\.result_analysis\s*=\s*await scienceReasoningLoopRuntime\.runResultAnalysis/);
      assert.match(dispatcherSource, /stage:\s*'science_intent_start'/);
      assert.match(dispatcherSource, /stage:\s*'science_intent_completed'/);
    });

    test('purchase recommendation runtime and external-link bridge are wired across main and renderer contracts', () => {
      const purchaseSource = fs.readFileSync(agentPath('tools', 'agent-purchase-recommendation.js'), 'utf8');
      const executorsSource = fs.readFileSync(agentPath('tools', 'register-agent-tool-executors.js'), 'utf8');
      const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const preloadSource = readPreloadSource();
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');

      assert.match(purchaseSource, /function createPurchaseRecommendationRuntime\(deps = \{\}\)/);
      assert.match(purchaseSource, /createAgentLlmRuntimeHelpers/);
      assert.match(purchaseSource, /function extractProductFromHtml\(html = '', pageUrl = ''\)/);
      assert.match(purchaseSource, /async function execute\(input = \{\}\)/);
      assert.match(mainAgentServicesSource, /createPurchaseRecommendationRuntime/);
      assert.match(mainAgentServicesSource, /const purchaseRecommendationRuntime = createPurchaseRecommendationRuntime/);
      assert.match(mainAgentServicesSource, /purchaseRecommendationRuntime,/);
      assert.match(executorsSource, /registerToolExecutor\('purchase-recommendation'/);
      assert.match(dispatcherSource, /parserPayload\.primary_intent === 'purchase_recommendation'/);
      assert.match(dispatcherSource, /runTrackedTool\('purchase-recommendation', \{\s*query:/);
      assert.match(dispatcherSource, /required_terms:\s*parseCompactList\(parserPayload\?\.entities\?\.required_attributes/);
      assert.match(dispatcherSource, /stage:\s*'purchase_recommendation_started'/);
      assert.match(dispatcherSource, /stage:\s*'purchase_recommendation_completed'/);
      assert.match(preloadSource, /openExternalUrl:\s*\(url\)\s*=>\s*ipcRenderer\.invoke\(SYSTEM\.OPEN_EXTERNAL_URL, \{ url \}\)/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(SYSTEM\.OPEN_EXTERNAL_URL/);
      assert.match(systemRegistrarSource, /shell\.openExternal\(url\)/);
      assert.match(mainSource, /registerSystemIpc\(\{/);
      assert.match(mainSource, /registerSystemIpc\(\{[\s\S]*shell,/);
    });

    test('agent tool loading and execution helpers expose catalogs and generic executor registry', () => {
      const loadingSource = fs.readFileSync(agentPath('tools', 'agent-tool-loading.js'), 'utf8');
      const executionSource = fs.readFileSync(agentPath('tools', 'agent-tool-execution.js'), 'utf8');
      const wrapperSource = fs.readFileSync(agentPath('tools', 'agent-tool-call.js'), 'utf8');
      const toolsCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tools.json'), 'utf8'));
      const toolCallCatalog = JSON.parse(fs.readFileSync(agentPath('tools', 'Tool-call.json'), 'utf8'));
      assert.equal(Array.isArray(toolsCatalog), true);
      assert.equal(Boolean(toolCallCatalog.$defs), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'python-sandbox'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'command-line'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'web-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'sub-agent'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'memory'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'container'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-analysis'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'assay-table'), true);
      assert.equal(toolsCatalog.some((entry) => entry?.name === 'plotly-graph'), true);
      assert.equal(Boolean(toolCallCatalog['python-sandbox']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['command-line']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['web-search']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['sub-agent']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog.memory?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog.container?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['literature-search']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['purchase-recommendation']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['paper-download']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['paper-analysis']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['notebook-draft']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['protocol-generation']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['assay-table']?.input_schema), true);
      assert.equal(Boolean(toolCallCatalog['plotly-graph']?.input_schema), true);
      assert.equal(typeof toolCallCatalog['inventory-lookup']?.description, 'string');
      assert.equal(typeof toolCallCatalog['command-line']?.description, 'string');
      assert.equal(typeof toolCallCatalog.memory?.description, 'string');
      assert.equal(typeof toolCallCatalog.container?.description, 'string');
      assert.equal(typeof toolCallCatalog['literature-search']?.description, 'string');
      assert.equal(typeof toolCallCatalog['purchase-recommendation']?.description, 'string');
      assert.equal(typeof toolCallCatalog['paper-download']?.description, 'string');
      assert.equal(typeof toolCallCatalog['notebook-draft']?.description, 'string');
      assert.equal(typeof toolCallCatalog['protocol-generation']?.description, 'string');
      assert.equal(typeof toolCallCatalog['assay-table']?.description, 'string');
      assert.equal(typeof toolCallCatalog['plotly-graph']?.description, 'string');
      assert.match(executionSource, /const toolExecutors = new Map\(\);/);
      assert.match(executionSource, /function registerToolExecutor\(toolName, executor\)/);
      assert.match(executionSource, /function getToolExecutor\(toolName\)/);
      assert.match(loadingSource, /Short description:/);
      assert.doesNotMatch(loadingSource, /Usage: \$/m);
      assert.match(executionSource, /Object\.entries\(ensureObject\(deps\.toolExecutors\)\)/);
      assert.match(wrapperSource, /agent-tool-loading\.js/);
      assert.match(wrapperSource, /agent-tool-execution\.js/);
      assert.equal(executionSource.includes('createDefaultAgentToolBindingBundle'), false);
      assert.equal(/["']inventory-lookup["']/.test(executionSource), false);
      assert.equal(/["']record-lookup["']/.test(executionSource), false);
      assert.equal(/["']protocol-matching["']/.test(executionSource), false);
      assert.equal(/["']notebook-generation["']/.test(executionSource), false);
      assert.equal(/["']python-sandbox["']/.test(executionSource), false);
      assert.equal(/["']sub-agent["']/.test(executionSource), false);
      assert.equal(/["']memory["']/.test(executionSource), false);
      assert.equal(/["']container["']/.test(executionSource), false);
      assert.equal(/["']assay-table["']/.test(executionSource), false);
      assert.equal(/["']plotly-graph["']/.test(executionSource), false);
      assert.equal(/["']literature-search["']/.test(executionSource), false);
      assert.equal(/["']purchase-recommendation["']/.test(executionSource), false);
      assert.equal(/["']paper-download["']/.test(executionSource), false);
      assert.equal(/["']paper-analysis["']/.test(executionSource), false);
      assert.equal(/["']protocol-generation["']/.test(executionSource), false);
    });

    test('agent helper cleanup keeps the categorized folder structure and core modules', () => {
      const expectedFiles = [
        ['Readme.md'],
        ['intent', 'agent-intent-parser.js'],
        ['intent', 'agent-intent.json'],
        ['shared', 'agent-llm-provider-bridge.js'],
        ['shared', 'agent-llm-utils.js'],
        ['shared', 'agent-controller-utils.js'],
        ['shared', 'agent-observability.js'],
        ['runtime', 'agent-lookup-runtime.js'],
        ['runtime', 'agent-protocol-notebook.js'],
        ['runtime', 'agent-protocol-notebook-context-control.js'],
        ['runtime', 'science-reasoning-loop', 'index.js'],
        ['runtime', 'science-reasoning-loop', 'input-clarification.js'],
        ['runtime', 'science-reasoning-loop', 'final-synthesis.js'],
        ['runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'],
        ['runtime', 'science-reasoning-loop', 'loop-exit-judge.js'],
        ['runtime', 'science-reasoning-loop', 'support.js'],
        ['deep-research', 'index.js'],
        ['deep-research', 'step-1-clarify-question.js'],
        ['deep-research', 'step-2-ask-targeted-follow-up.js'],
        ['deep-research', 'step-3-draft-research-plan.js'],
        ['deep-research', 'step-4-execute-plan.js'],
        ['deep-research', 'step-5-assemble-final-answer.js'],
        ['deep-research', 'context-control.js'],
        ['deep-research', 'accuracy-preservation.js'],
        ['deep-research', 'sub-agent-usage.js'],
        ['deep-research', 'final-synthesis-quality.js'],
        ['tools', 'Tools.json'],
        ['tools', 'Tool-call.json'],
        ['tools', 'agent-tool-provide.js'],
        ['tools', 'agent-tool-loading.js'],
        ['tools', 'agent-tool-execution.js'],
        ['tools', 'agent-tool-call.js'],
        ['tools', 'agent-notebook-generation.js'],
        ['tools', 'agent-notebook-draft.js'],
        ['tools', 'agent-protocol-matching.js'],
        ['tools', 'agent-protocol-generation.js'],
        ['tools', 'agent-literature-search.js'],
        ['tools', 'agent-purchase-recommendation.js'],
        ['tools', 'agent-paper-context-loader.js'],
        ['tools', 'agent-paper-download.js'],
        ['tools', 'agent-paper-analysis.js'],
        ['tools', 'agent-python-sandbox.js'],
        ['tools', 'agent-sub-agent.js'],
        ['tools', 'agent-container.js'],
        ['tools', 'agent-assay-table.js'],
        ['tools', 'agent-plotly-graph.js'],
        ['context', 'agent-context-management.js'],
        ['context', 'agent-memory.js'],
        ['context', 'agent-chat-log.js']
      ];
      expectedFiles.forEach((parts) => {
        assert.equal(fs.existsSync(agentPath(...parts)), true, `Expected ${parts.join('/')} in agent helpers.`);
      });
      assert.equal(fs.existsSync(agentPath('agent-python.js')), false);

      const mainSource = readMainProcessSource();
      assert.equal(/agent-routing/.test(mainSource), false);
      assert.equal(/agent-response-layer/.test(mainSource), false);
      assert.equal(/agent-validation-safety/.test(mainSource), false);
      assert.equal(/agent-sqlite-index/.test(mainSource), false);
      assert.equal(/agent-phase89-runtime/.test(mainSource), false);
    });
  }
};
