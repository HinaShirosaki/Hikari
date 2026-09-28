'use strict';

const {
  createAgentRequestAbortError
} = require('../../lib/llm/request-context.js');
const { AGENT } = require('../../../shared/ipc/channels');
const {
  createAgentChatRequestHandler
} = require('../../agent/runtime/agent-chat-request.js');

function registerAgentChatHandler({
  ipcMain,
  cleanText,
  controllerUtils,
  observability,
  agentChatLogRuntime,
  getAgentChatLogPath,
  getAgentChatSessionStoragePath,
  appendAgentChatLogEntry,
  lifecycleService,
  runAgentController
} = {}) {
  const { normalizeJsonPayload } = lifecycleService;
  const activeRequests = new Map();
  const handleAgentChat = createAgentChatRequestHandler({
    activeRequests,
    cleanText,
    controllerUtils,
    observability,
    agentChatLogRuntime,
    getAgentChatLogPath,
    getAgentChatSessionStoragePath,
    appendAgentChatLogEntry,
    lifecycleService,
    runAgentController
  });

  ipcMain.handle(AGENT.CHAT_CANCEL, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const clientRequestId = cleanText(
      normalizedPayload?.clientRequestId || normalizedPayload?.client_request_id,
      120
    );
    if (!clientRequestId) {
      return {
        ok: false,
        error: 'clientRequestId is required to stop an agent request.'
      };
    }
    const activeRequest = activeRequests.get(clientRequestId);
    if (!activeRequest) {
      return {
        ok: false,
        not_found: true,
        client_request_id: clientRequestId,
        error: 'No active agent request matched that id.'
      };
    }
    activeRequest.abortController.abort(
      createAgentRequestAbortError('Agent request stopped by user.')
    );
    return {
      ok: true,
      canceled: true,
      request_id: activeRequest.requestId,
      client_request_id: clientRequestId
    };
  });

  ipcMain.handle(AGENT.CHAT, handleAgentChat);
}

module.exports = {
  registerAgentChatHandler
};
