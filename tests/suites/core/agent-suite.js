module.exports = function registerAgentSuite(context = {}) {
  const registerAgentIntentAndNotebookSuite = require('./agent-suite/intent-and-notebook-suite.js');
  const registerAgentRetrievalAndToolCallSuite = require('./agent-suite/retrieval-and-tool-call-suite.js');
  const registerAgentScienceAndProtocolSuite = require('./agent-suite/science-and-protocol-suite.js');
  const registerAgentLiteraturePaperAndSubAgentSuite = require('./agent-suite/literature-paper-and-sub-agent-suite.js');
  const registerAgentContextMemoryAndRuntimeSuite = require('./agent-suite/context-memory-and-runtime-suite.js');

  registerAgentIntentAndNotebookSuite(context);
  registerAgentRetrievalAndToolCallSuite(context);
  registerAgentScienceAndProtocolSuite(context);
  registerAgentLiteraturePaperAndSubAgentSuite(context);
  registerAgentContextMemoryAndRuntimeSuite(context);
};
