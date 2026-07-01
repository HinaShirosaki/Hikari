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
