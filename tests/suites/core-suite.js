module.exports = function registerCoreSuite(context = {}) {
  const registerAgentSuite = require('./core/agent-suite.js');
  const registerAppModulesSuite = require('./core/app-modules-suite.js');
  const registerCodexCliProviderSuite = require('./core/codex-cli-provider-suite.js');
  const registerContractsSuite = require('./core/contracts-suite.js');

  registerAgentSuite(context);
  registerAppModulesSuite(context);
  registerCodexCliProviderSuite(context);
  registerContractsSuite(context);
};
