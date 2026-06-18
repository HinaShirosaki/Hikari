module.exports = function registerAgentContractsBPart02(context = {}) {
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
    test('science runtimes use canonical catalog tools and main wires their schemas and executors', () => {
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const { SCIENCE_REASONING_INTENTS, getScienceReasoningPolicy } = require(agentPath('runtime', 'science-reasoning-loop', 'index.js'));
      const { DEEP_RESEARCH_POLICIES } = require(agentPath('deep-research', 'index.js'));
      const { getToolInputSchemas } = require(agentPath('tools', 'agent-tool-loading.js'));
      const { REASONING_ENTRY_TOOL_SCOPES } = require(agentPath('tools', 'agent-tool-provide.js'));
      const catalogToolCount = getToolInputSchemas().length;

      SCIENCE_REASONING_INTENTS.map((intent) => getScienceReasoningPolicy(intent)).forEach((policy) => {
        assert.equal(Array.isArray(policy.tool_scope), true);
        assert.equal(policy.tool_scope.length > 0, true);
        assert.equal(policy.tool_scope.length < catalogToolCount, true);
        const resolved = getToolInputSchemas(policy.tool_scope);
        assert.equal(resolved.length > 0, true);
      });
      Object.values(DEEP_RESEARCH_POLICIES).forEach((policy) => {
        assert.equal(Array.isArray(policy.tool_scope), true);
        assert.equal(policy.tool_scope.length > 0, true);
        assert.equal(policy.tool_scope.length < catalogToolCount, true);
        const resolved = getToolInputSchemas(policy.tool_scope);
        assert.equal(resolved.length > 0, true);
      });
      assert.deepEqual(
        getScienceReasoningPolicy('general_science_question').tool_scope,
        REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.general_science_question
      );
      assert.deepEqual(
        DEEP_RESEARCH_POLICIES.result_analysis.tool_scope,
        REASONING_ENTRY_TOOL_SCOPES.deep_research_entry.result_analysis
      );

      assert.equal(mainSource.includes('createMainAgentServices'), true);
      assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('inventory-lookup'"), false);
      assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('record-lookup'"), false);
      assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('literature-search'"), false);
      assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('purchase-recommendation'"), false);
      assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('python-sandbox'"), false);
      assert.equal(mainAgentServicesSource.includes('registerAgentToolExecutors({'), true);
      assert.equal(mainAgentServicesSource.includes('const agentToolProviderRuntime = createAgentToolProviderRuntime'), true);
      assert.equal(mainAgentServicesSource.includes('toolProvider: agentToolProviderRuntime'), true);
      assert.equal(mainAgentServicesSource.includes('runTool: agentToolRuntime.runAgentTool'), true);
    });
    test('main no longer wires legacy routing and phase orchestration helpers', () => {
      const mainSource = readMainProcessSource();
      assert.equal(/require\('\.\/helpers\/agent\/agent-routing'/.test(mainSource), false);
      assert.equal(/require\('\.\/helpers\/agent\/agent-paper-analysis'/.test(mainSource), false);
      assert.equal(/require\('\.\/helpers\/agent\/agent-project-retrieval'/.test(mainSource), false);
      assert.equal(/require\('\.\/helpers\/agent\/agent-response-layer'/.test(mainSource), false);
      assert.equal(/require\('\.\/helpers\/agent\/agent-validation-safety'/.test(mainSource), false);
      assert.equal(/require\('\.\/helpers\/agent\/agent-phase89-runtime'/.test(mainSource), false);
      assert.equal(/requestIntentParserPayload\(/.test(mainSource), false);
      assert.equal(/runAgentToolDispatchLegacy\(/.test(mainSource), false);
    });
  }
};
