module.exports = function registerAgentLiteraturePaperAndSubAgentSuite(context = {}) {
  const registerParts = [
    require('./literature-paper-and-sub-agent-suite/part-01.js'),
    require('./literature-paper-and-sub-agent-suite/part-02.js'),
    require('./literature-paper-and-sub-agent-suite/part-03.js'),
    require('./literature-paper-and-sub-agent-suite/part-04.js'),
    require('./literature-paper-and-sub-agent-suite/part-05.js'),
    require('./literature-paper-and-sub-agent-suite/part-06.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
