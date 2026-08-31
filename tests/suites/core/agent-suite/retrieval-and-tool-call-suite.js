module.exports = function registerAgentRetrievalAndToolCallSuite(context = {}) {
  const registerParts = [
    require('./retrieval-and-tool-call-suite/inventory-and-notebook-lookup.js'),
    require('./retrieval-and-tool-call-suite/purchase-recommendation-extraction.js'),
    require('./retrieval-and-tool-call-suite/purchase-search-planning.js'),
    require('./retrieval-and-tool-call-suite/tool-call-dispatch.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
