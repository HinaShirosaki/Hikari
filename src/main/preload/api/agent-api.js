'use strict';

const { AGENT, AGENT_PROGRESS_EVENT } = require('../../../shared/ipc/channels');

function createAgentApi(ipcRenderer) {
  return {
    agentChat: (payload) => ipcRenderer.invoke(AGENT.CHAT, payload),
    agentChatCancel: (payload) => ipcRenderer.invoke(AGENT.CHAT_CANCEL, payload),
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
    }
  };
}

module.exports = {
  createAgentApi
};
