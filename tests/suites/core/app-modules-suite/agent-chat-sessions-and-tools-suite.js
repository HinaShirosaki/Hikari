module.exports = function registerAppAgentChatSessionsAndToolsSuite(context = {}) {
  const registerParts = [
    require('./agent-chat-sessions-and-tools-suite/session-switching.js'),
    require('./agent-chat-sessions-and-tools-suite/lookup-result-rendering.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
