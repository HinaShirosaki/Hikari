'use strict';

const { createAgentSessionService } = require('./agent-session-service');

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
  const {
    normalizeJsonPayload,
    buildAgentProgressPayload,
    flushLifecycleRecorderEvents,
    asArray
  } = lifecycleService;

  ipcMain.handle('agent:chat', async (event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(
      normalizedPayload,
      normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})
    );
    const requestId = controllerUtils.buildAgentLogRequestId();
    const clientRequestId = cleanText(
      normalizedPayload?.clientRequestId || normalizedPayload?.client_request_id,
      120
    );
    const logPath = getAgentChatLogPath();
    const sessionService = createAgentSessionService({
      cleanText,
      agentChatLogRuntime,
      chatSessionStoragePath: getAgentChatSessionStoragePath(normalizedPayload),
      requestedChatSessionId: cleanText(normalizedPayload?.chatSessionId || normalizedPayload?.sessionId, 120),
      payload: normalizedPayload
    });
    const requestTimestamp = new Date().toISOString();
    const progressSender = event?.sender && typeof event.sender.send === 'function'
      ? event.sender.send.bind(event.sender)
      : null;
    const lifecycleRecorder = observability.createLifecycleRecorder({
      requestId,
      onEvent: (lifecycleEvent) => {
        if (!progressSender) {
          return;
        }
        const progressPayload = buildAgentProgressPayload({
          lifecycleEvent,
          requestId,
          clientRequestId,
          chatSessionId: cleanText(sessionService.getSession()?.id, 120)
        });
        if (!progressPayload) {
          return;
        }
        progressSender('agent-progress', progressPayload);
      }
    });
    const controllerRuntime = {
      requestId,
      clientRequestId,
      lifecycleRecorder
    };

    await sessionService.ensureSession();
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'request_received',
      status: 'ok',
      message: cleanText(normalizedPayload?.message, 320),
      meta: {
        project_id: cleanText(normalizedPayload?.projectId, 80),
        project_name: cleanText(normalizedPayload?.projectName, 180),
        allow_write_tools: normalizedPayload?.allowWriteTools === true,
        provider: cleanText(normalizedPayload?.llm?.provider, 80),
        developer_mode: executionFlags.developerMode === true,
        deep_research_enabled: normalizedPayload?.agent?.deepResearchEnabled === true
      }
    });
    const requestLogEntry = {
      type: 'agent-chat-request',
      requestId,
      timestamp: requestTimestamp,
      direction: 'user->llm',
      projectId: cleanText(normalizedPayload?.projectId, 80),
      projectName: cleanText(normalizedPayload?.projectName, 180),
      dataFilePath: cleanText(
        normalizedPayload?.stateSnapshot?.data_file_path || normalizedPayload?.stateSnapshot?.dataFilePath,
        1600
      ),
      allowWriteTools: normalizedPayload?.allowWriteTools === true,
      message: cleanText(normalizedPayload?.message, 3000),
      conversation: controllerUtils.extractConversation(normalizedPayload?.conversation),
      llm: controllerUtils.summarizeLlmForAgentLog(normalizedPayload?.llm),
      agent: {
        developerMode: executionFlags.developerMode === true,
        deepResearchEnabled: normalizedPayload?.agent?.deepResearchEnabled === true
      }
    };
    await appendAgentChatLogEntry(logPath, controllerUtils.formatAgentChatLogEntry(requestLogEntry));
    if (sessionService.getSession()?.id) {
      await sessionService.appendRows([
        {
          type: 'user-message',
          session_id: sessionService.getSession().id,
          message_id: `user-${requestId}`,
          timestamp: requestTimestamp,
          direction: 'user->llm',
          text: cleanText(normalizedPayload?.message, 24000),
          project_id: cleanText(normalizedPayload?.projectId, 80),
          project_name: cleanText(normalizedPayload?.projectName, 180)
        },
        {
          ...requestLogEntry,
          session_id: sessionService.getSession().id
        }
      ]);
    }

    try {
      const result = await runAgentController(normalizedPayload, controllerRuntime);
      const failureReasons = observability.classifyFailureReasons({
        result,
        lifecycleEvents: lifecycleRecorder.events
      });
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'response_emitted',
        status: result?.ok === true ? 'ok' : 'error',
        response_type: result?.notebook_draft
          ? 'notebook_draft'
          : (result?.protocol_to_notebook
            ? 'protocol_to_notebook'
            : (result?.inventory_lookup
              ? 'inventory_lookup'
              : (result?.record_lookup
                ? 'record_lookup'
                : (result?.general_science_question
                  ? 'general_science_question'
                  : (result?.project_science_question
                    ? 'project_science_question'
                    : (result?.result_analysis ? 'result_analysis' : 'intent_parser')))))),
        routing_intent: cleanText(result?.parser?.primary_intent, 80) || 'unclear',
        failure_reasons: failureReasons,
        message: result?.ok === true
          ? 'Agent response emitted to renderer.'
          : cleanText(result?.error, 320) || 'Agent response emitted with error.'
      });
      const responseTimestamp = new Date().toISOString();
      const resultLogEntry = {
        type: 'agent-chat-result',
        requestId,
        timestamp: responseTimestamp,
        direction: 'llm->user',
        failure_reasons: failureReasons,
        ...controllerUtils.summarizeAgentResultForLog(result)
      };
      await flushLifecycleRecorderEvents(logPath, lifecycleRecorder);
      await appendAgentChatLogEntry(logPath, controllerUtils.formatAgentChatLogEntry(resultLogEntry));
      if (sessionService.getSession()?.id) {
        const assistantMessage = agentChatLogRuntime.buildAssistantMessageFromResult({
          result,
          requestText: cleanText(normalizedPayload?.message, 3000),
          messageId: `assistant-${requestId}`,
          timestamp: responseTimestamp
        });
        const traceEntries = asArray(controllerRuntime?.traceContext?.entries);
        await sessionService.appendRows(sessionService.sortChatSessionRows([
          ...asArray(lifecycleRecorder.events).map((entry) => ({
            ...entry,
            session_id: sessionService.getSession().id
          })),
          ...traceEntries.map((entry) => ({
            ...entry,
            session_id: sessionService.getSession().id
          })),
          {
            ...resultLogEntry,
            session_id: sessionService.getSession().id
          },
          {
            type: 'assistant-message',
            session_id: sessionService.getSession().id,
            message_id: cleanText(assistantMessage.id, 120),
            timestamp: cleanText(assistantMessage.createdAt, 80) || responseTimestamp,
            direction: 'llm->user',
            text: cleanText(assistantMessage.text, 24000),
            meta: assistantMessage.meta
          }
        ]));
      }
      return sessionService.getSession()
        ? {
          ...result,
          request_id: requestId,
          client_request_id: clientRequestId,
          chat_session: sessionService.getSession()
        }
        : {
          ...result,
          request_id: requestId,
          client_request_id: clientRequestId
        };
    } catch (error) {
      const errorMessage = String(error?.message || error);
      const failureReasons = observability.classifyFailureReasons({
        error: errorMessage,
        lifecycleEvents: lifecycleRecorder.events
      });
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'controller_error',
        status: 'failed',
        failure_reasons: failureReasons,
        message: cleanText(errorMessage, 320)
      });
      const errorTimestamp = new Date().toISOString();
      const errorLogEntry = {
        type: 'agent-chat-error',
        requestId,
        timestamp: errorTimestamp,
        direction: 'llm->user',
        ok: false,
        failure_reasons: failureReasons,
        error: cleanText(errorMessage, 2000)
      };
      await flushLifecycleRecorderEvents(logPath, lifecycleRecorder);
      await appendAgentChatLogEntry(logPath, controllerUtils.formatAgentChatLogEntry(errorLogEntry));
      if (sessionService.getSession()?.id) {
        const assistantMessage = agentChatLogRuntime.buildAssistantMessageFromError({
          errorMessage,
          requestText: cleanText(normalizedPayload?.message, 3000),
          messageId: `assistant-${requestId}`,
          timestamp: errorTimestamp
        });
        const traceEntries = asArray(controllerRuntime?.traceContext?.entries);
        await sessionService.appendRows(sessionService.sortChatSessionRows([
          ...asArray(lifecycleRecorder.events).map((entry) => ({
            ...entry,
            session_id: sessionService.getSession().id
          })),
          ...traceEntries.map((entry) => ({
            ...entry,
            session_id: sessionService.getSession().id
          })),
          {
            ...errorLogEntry,
            session_id: sessionService.getSession().id
          },
          {
            type: 'assistant-message',
            session_id: sessionService.getSession().id,
            message_id: cleanText(assistantMessage.id, 120),
            timestamp: cleanText(assistantMessage.createdAt, 80) || errorTimestamp,
            direction: 'llm->user',
            text: cleanText(assistantMessage.text, 24000),
            meta: assistantMessage.meta
          }
        ]));
      }
      return sessionService.getSession()
        ? {
          ok: false,
          error: errorMessage,
          request_id: requestId,
          client_request_id: clientRequestId,
          chat_session: sessionService.getSession()
        }
        : {
          ok: false,
          error: errorMessage,
          request_id: requestId,
          client_request_id: clientRequestId
        };
    }
  });
}

module.exports = {
  registerAgentChatHandler
};
