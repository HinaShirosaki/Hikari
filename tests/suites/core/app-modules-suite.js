module.exports = function registerAppModulesSuite(context = {}) {
  const registerAppLabAndProjectSuite = require('./app-modules-suite/lab-and-project-suite.js');
  const registerAppCollaborationAndProtocolSuite = require('./app-modules-suite/collaboration-and-protocol-suite.js');
  const registerAppAgentChatCoreSuite = require('./app-modules-suite/agent-chat-core-suite.js');
  const registerAppAgentChatSessionsAndToolsSuite = require('./app-modules-suite/agent-chat-sessions-and-tools-suite.js');
  const registerAppPapersSuite = require('./app-modules-suite/papers-suite.js');
  const registerAppAssayAndObjectGraphSuite = require('./app-modules-suite/assay-and-object-graph-suite.js');
  const registerAppWorkflowSuite = require('./app-modules-suite/workflow-suite.js');

  registerAppLabAndProjectSuite(context);
  registerAppCollaborationAndProtocolSuite(context);
  registerAppAgentChatCoreSuite(context);
  registerAppAgentChatSessionsAndToolsSuite(context);
  registerAppPapersSuite(context);
  registerAppAssayAndObjectGraphSuite(context);
  registerAppWorkflowSuite(context);
};
