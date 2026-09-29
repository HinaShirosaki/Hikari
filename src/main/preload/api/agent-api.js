'use strict';

const { AGENT, AGENT_PROGRESS_EVENT, FILE_ACCESS } = require('../../../shared/ipc/channels');

function createAgentApi(ipcRenderer) {
  return {
    agentFilesStatus: () => ipcRenderer.invoke(FILE_ACCESS.STATUS),
    agentFilesSettings: payload => ipcRenderer.invoke(FILE_ACCESS.SETTINGS, payload),
    agentFilesReview: payload => ipcRenderer.invoke(FILE_ACCESS.REVIEW, payload),
    agentFilesUndo: payload => ipcRenderer.invoke(FILE_ACCESS.UNDO, payload),
    agentFilesAddLocation: payload => ipcRenderer.invoke(FILE_ACCESS.ADD_LOCATION, payload),
    onAgentFilesChanged: handler => {
      if (typeof handler !== 'function') return () => {};
      const listener = () => handler();
      ipcRenderer.on(FILE_ACCESS.CHANGED, listener);
      return () => ipcRenderer.removeListener(FILE_ACCESS.CHANGED, listener);
    },
    suggestNextExperiment: (payload) => ipcRenderer.invoke(AGENT.SUGGEST_EXPERIMENT, payload),
    agentHtmlPreview: (payload) => ipcRenderer.invoke(AGENT.HTML_PREVIEW, payload),
    agentChat: (payload) => ipcRenderer.invoke(AGENT.CHAT, payload),
    agentChatCancel: (payload) => ipcRenderer.invoke(AGENT.CHAT_CANCEL, payload),
    listAgentSkills: (payload) => ipcRenderer.invoke(AGENT.LIST_SKILLS, payload),
    agentGenerateProtocol: (payload) => ipcRenderer.invoke(AGENT.GENERATE_PROTOCOL, payload),
    agentChatLogCreateSession: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_CREATE_SESSION, payload),
    agentChatLogListSessions: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_LIST_SESSIONS, payload),
    agentChatLogGetSession: (payload) => ipcRenderer.invoke(AGENT.CHAT_LOG_GET_SESSION, payload),
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
