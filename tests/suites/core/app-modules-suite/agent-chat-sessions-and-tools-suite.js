module.exports = function registerAppAgentChatSessionsAndToolsSuite(context = {}) {
  const registerParts = [
    require('./agent-chat-sessions-and-tools-suite/part-01.js'),
    require('./agent-chat-sessions-and-tools-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
