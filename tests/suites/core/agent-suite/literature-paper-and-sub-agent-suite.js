module.exports = function registerAgentLiteraturePaperAndSubAgentSuite(context = {}) {
  const registerParts = [
    require('./literature-paper-and-sub-agent-suite/literature-search-runtime.js'),
    require('./literature-paper-and-sub-agent-suite/paper-context-loading.js'),
    require('./literature-paper-and-sub-agent-suite/literature-search-workflow.js'),
    require('./literature-paper-and-sub-agent-suite/paper-download-and-knowledge-database.js'),
    require('./literature-paper-and-sub-agent-suite/pdf-to-markdown-extraction.js'),
    require('./literature-paper-and-sub-agent-suite/paper-analysis-and-sub-agents.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
