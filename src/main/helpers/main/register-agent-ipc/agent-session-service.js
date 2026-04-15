'use strict';

function createAgentSessionService({
  cleanText,
  agentChatLogRuntime,
  chatSessionStoragePath = '',
  requestedChatSessionId = '',
  payload = {}
} = {}) {
  let chatSession = null;

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function sortChatSessionRows(rows = []) {
    return asArray(rows)
      .filter((row) => row && typeof row === 'object')
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(cleanText(left?.timestamp || left?.createdAt, 80) || '') || 0;
        const rightTime = Date.parse(cleanText(right?.timestamp || right?.createdAt, 80) || '') || 0;
        return leftTime - rightTime;
      });
  }

  async function ensureSession() {
    if (!chatSessionStoragePath) {
      return null;
    }
    try {
      const ensured = await agentChatLogRuntime.ensureSession({
        storagePath: chatSessionStoragePath,
        sessionId: requestedChatSessionId,
        title: cleanText(payload?.title, 220) || 'New Chat',
        projectId: cleanText(payload?.projectId, 80),
        projectName: cleanText(payload?.projectName, 180)
      });
      chatSession = ensured?.session && typeof ensured.session === 'object'
        ? ensured.session
        : null;
      return chatSession;
    } catch (error) {
      console.error('Failed to ensure agent chat session:', error);
      return null;
    }
  }

  async function appendRows(rows = [], options = {}) {
    if (!chatSessionStoragePath || !chatSession?.id) {
      return;
    }
    try {
      const appended = await agentChatLogRuntime.appendRows(chatSessionStoragePath, chatSession.id, rows, {
        llm: options?.llm && typeof options.llm === 'object' ? options.llm : {},
        projectId: cleanText(options?.projectId || payload?.projectId, 80),
        projectName: cleanText(options?.projectName || payload?.projectName, 180)
      });
      if (appended?.session && typeof appended.session === 'object') {
        chatSession = appended.session;
      }
    } catch (error) {
      console.error('Failed to append agent chat session rows:', error);
    }
  }

  function getSession() {
    return chatSession;
  }

  return {
    appendRows,
    ensureSession,
    getSession,
    sortChatSessionRows
  };
}

module.exports = {
  createAgentSessionService
};
