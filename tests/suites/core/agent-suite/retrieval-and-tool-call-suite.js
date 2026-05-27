module.exports = function registerAgentRetrievalAndToolCallSuite(context = {}) {
  const registerParts = [
    require('./retrieval-and-tool-call-suite/part-01.js'),
    require('./retrieval-and-tool-call-suite/part-02.js'),
    require('./retrieval-and-tool-call-suite/part-03.js'),
    require('./retrieval-and-tool-call-suite/part-04.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
