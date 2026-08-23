module.exports = function registerAppAgentChatCoreSuite(context = {}) {
  const registerParts = [
    require('./agent-chat-core-suite/assistant-message-rendering.js'),
    require('./agent-chat-core-suite/sandbox-and-purchase-rendering.js'),
    require('./agent-chat-core-suite/scoped-chat-context.js'),
    require('./agent-chat-core-suite/request-failure-handling.js'),
    require('./agent-chat-core-suite/notebook-proposal-approval.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
