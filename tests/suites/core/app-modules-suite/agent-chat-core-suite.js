module.exports = function registerAppAgentChatCoreSuite(context = {}) {
  const registerParts = [
    require('./agent-chat-core-suite/part-01.js'),
    require('./agent-chat-core-suite/part-02.js'),
    require('./agent-chat-core-suite/part-03.js'),
    require('./agent-chat-core-suite/part-04.js'),
    require('./agent-chat-core-suite/part-05.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
