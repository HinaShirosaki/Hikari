module.exports = function registerCoreSuite(context = {}) {
  const registerAgentSuite = require('./core/agent-suite.js');
  const registerAppModulesSuite = require('./core/app-modules-suite.js');
  const registerCodexCliProviderSuite = require('./core/codex-cli-provider-suite.js');
  const registerContractsSuite = require('./core/contracts-suite.js');
  const registerModuleServicesSuite = require('./core/module-services-suite.js');
  const registerNpmUpdaterSuite = require('./core/npm-updater-suite.js');
  const registerPluginSystemSuite = require('./core/plugin-system-suite/plugin-system.js');

  registerAgentSuite(context);
  registerAppModulesSuite(context);
  registerCodexCliProviderSuite(context);
  registerContractsSuite(context);
  registerModuleServicesSuite(context);
  registerNpmUpdaterSuite(context);
  registerPluginSystemSuite(context);
};
