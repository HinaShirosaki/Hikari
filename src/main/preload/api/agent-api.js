'use strict';

const { AGENT, AGENT_PROGRESS_EVENT, SEQUENCE_AGENT } = require('../../../shared/ipc/channels');

function createAgentApi(ipcRenderer) {
  return {
    agentChat: (payload) => ipcRenderer.invoke(AGENT.CHAT, payload),
    agentChatCancel: (payload) => ipcRenderer.invoke(AGENT.CHAT_CANCEL, payload),
    listAgentSkills: (payload) => ipcRenderer.invoke(AGENT.LIST_SKILLS, payload),
    agentGenerateProtocol: (payload) => ipcRenderer.invoke(AGENT.GENERATE_PROTOCOL, payload),
    agentChatLogCreateSession: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_CREATE_SESSION, payload),
    agentChatLogListSessions: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_LIST_SESSIONS, payload),
    agentChatLogGetSession: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_GET_SESSION, payload),
    agentDeveloperTestTools: (payload) => ipcRenderer.invoke(AGENT.DEVELOPER_TEST_TOOLS, payload),
    agentDeveloperContextPreview: (payload) => ipcRenderer.invoke(AGENT.DEVELOPER_CONTEXT_PREVIEW, payload),
    agentLogsListRequests: () => ipcRenderer.invoke(AGENT.LOGS_LIST_REQUESTS),
    agentLogsReplay: (payload) => ipcRenderer.invoke(AGENT.LOGS_REPLAY, payload),
    onAgentProgress: (handler) => {
      if (typeof handler !== 'function') {
        return () => {};
      }
      const listener = (_event, payload) => {
        handler(payload);
      };
      ipcRenderer.on(AGENT_PROGRESS_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(AGENT_PROGRESS_EVENT, listener);
      };
    },
    // Main asks the renderer to run a sequence-viewer agent action against live
    // state, then awaits the reply on SEQUENCE_AGENT.RESPONSE keyed by requestId.
    onSequenceAgentRequest: (handler) => {
      if (typeof handler !== 'function') {
        return () => {};
      }
      const listener = async (_event, payload = {}) => {
        const requestId = payload?.requestId;
        let result;
        try {
          result = await handler(payload);
        } catch (error) {
          result = { error: { code: 'HANDLER_FAILED', message: String(error?.message || error) } };
        }
        ipcRenderer.send(SEQUENCE_AGENT.RESPONSE, { requestId, result });
      };
      ipcRenderer.on(SEQUENCE_AGENT.REQUEST, listener);
      return () => {
        ipcRenderer.removeListener(SEQUENCE_AGENT.REQUEST, listener);
      };
    }
  };
}

module.exports = {
  createAgentApi
};
