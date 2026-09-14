import { normalizeAgentResponse } from './response.js';
import { buildAttachmentSummary } from './composer-attachments.js';
import { toConversation, trimText } from './shared.js';
import {
  buildLiveAssistantPlaceholder,
  buildStoppedAssistantMessage,
  createLocalStopError,
  isLocalStopError
} from './live-progress-state.js';
import {
  cloneLiveActivityRows,
  cloneLiveCodexCliDisplayRows,
  cloneLiveThinkingRows
} from './live-progress-clone.js';
import {
  buildAssistantErrorMessage,
  buildAssistantResponseMessage
} from './assistant-message-meta.js';
import { showTransientNotice } from '../../lib/notify.js';

export function createAgentRequestController(deps) {
  const {
    api,
    state,
    runtime,
    input,
    createId,
    persist,
    payloadBuilder,
    attachmentsController,
    sessionManager,
    buildSyncedStateSnapshot,
    ensureAgentState,
    renderContextSummary,
    renderHistoryView,
    setStatus,
    syncComposerHeight,
    syncActiveRequestState,
    updateInFlightState,
    notebookDraftAdapter,
    openReviewForMessage = () => {}
  } = deps;

  function getActiveRequests() {
    if (!(runtime.activeRequests instanceof Map)) {
      runtime.activeRequests = new Map();
    }
    return runtime.activeRequests;
  }

  function syncRequestUiState() {
    if (typeof syncActiveRequestState === 'function') {
      return syncActiveRequestState();
    }
    const currentSessionId = trimText(state.agentChat.currentSessionId, 120);
    const request = [...getActiveRequests().values()]
      .find((item) => trimText(item?.sessionId, 120) === currentSessionId) || null;
    runtime.liveAssistantMessage = request?.liveAssistantMessage || null;
    runtime.activeClientRequestId = trimText(request?.clientRequestId, 120);
    runtime.inFlightClientRequestId = runtime.activeClientRequestId;
    runtime.stopRequested = request?.stopRequested === true;
    runtime.stopInProgress = request?.stopInProgress === true;
    const nextInFlight = Boolean(request);
    if (typeof updateInFlightState === 'function' && runtime.inFlight !== nextInFlight) {
      updateInFlightState(nextInFlight);
    } else {
      runtime.inFlight = nextInFlight;
    }
    return request;
  }

  function isRequestVisible(request) {
    return trimText(request?.sessionId, 120) === trimText(state.agentChat.currentSessionId, 120);
  }

  function setRequestStatus(request, text) {
    if (isRequestVisible(request)) {
      setStatus(text);
    }
  }

  function clearLiveAssistantState(request) {
    if (request) {
      request.liveAssistantMessage = null;
    }
    if (trimText(runtime.activeClientRequestId, 120) === trimText(request?.clientRequestId, 120)) {
      runtime.liveAssistantMessage = null;
    }
  }

  function getCanceledRequestIds() {
    if (!(runtime.canceledClientRequestIds instanceof Set)) {
      runtime.canceledClientRequestIds = new Set();
    }
    return runtime.canceledClientRequestIds;
  }

  function wasRequestCanceled(clientRequestId) {
    return getCanceledRequestIds().has(clientRequestId);
  }

  function collectTraceRows(request) {
    const progress = request?.liveAssistantMessage?.meta?.live_progress || {};
    return {
      htmlArtifacts: request?.liveAssistantMessage?.meta?.html_artifacts || [],
      imageArtifacts: request?.liveAssistantMessage?.meta?.image_artifacts || [],
      sequenceActions: request?.liveAssistantMessage?.meta?.sequence_actions || [],
      thinking: cloneLiveThinkingRows(progress.thinking_rows),
      activity: cloneLiveActivityRows(progress.activity_rows),
      codexCliDisplay: cloneLiveCodexCliDisplayRows(progress.codex_cli_display_rows)
    };
  }

  function appendStoppedAssistantMessage(request, requestText, message = 'Agent request stopped.') {
    const htmlArtifacts = request?.liveAssistantMessage?.meta?.html_artifacts || [];
    const imageArtifacts = request?.liveAssistantMessage?.meta?.image_artifacts || [];
    clearLiveAssistantState(request);
    if (!isRequestVisible(request)) {
      return false;
    }
    const stoppedMessage = buildStoppedAssistantMessage(requestText, message, createId);
    stoppedMessage.meta.html_artifacts = htmlArtifacts;
    stoppedMessage.meta.image_artifacts = imageArtifacts;
    state.agentChat.messages.push(stoppedMessage);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    sessionManager.renderSessionList();
    renderHistoryView({ forceScroll: true });
    return true;
  }
  function persistAssistantMessage(request, message) {
    if (!isRequestVisible(request)) {
      return false;
    }
    state.agentChat.messages.push(message);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    sessionManager.renderSessionList();
    renderHistoryView({ forceScroll: true });
    return true;
  }

  async function sendMessage(options = {}) {
    const onAccepted = typeof options?.onAccepted === 'function'
      ? options.onAccepted
      : null;
    if (runtime.inFlight || runtime.sendPending === true) {
      return { ok: false, reason: 'busy' };
    }
    const { rawMessageText, attachments, messageText, hiddenContexts } = payloadBuilder.getDraftRequest();
    if (!rawMessageText && !attachments.length) {
      return { ok: false, reason: 'empty' };
    }
    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return { ok: false, reason: 'unavailable' };
    }

    ensureAgentState();
    runtime.stopRequested = false;
    runtime.stopInProgress = false;
    runtime.sendPending = true;
    syncRequestUiState();

    // Ensure the session first: on the first message from a selected project folder it
    // syncs the active project scope from that folder, so the project details captured
    // below (and sent with this request) reflect the folder, not the previous/empty scope.
    let currentSessionId = '';
    let requestSessionId = '';
    let projectId = '';
    let projectName = '';
    let conversation = [];
    let clientRequestId = '';
    let request = null;
    try {
      currentSessionId = await sessionManager.ensureCurrentChatSession(messageText);
      requestSessionId = trimText(currentSessionId || state.agentChat.currentSessionId, 120);
      if (requestSessionId && !trimText(state.agentChat.currentSessionId, 120)) {
        state.agentChat.currentSessionId = requestSessionId;
      }
      ({ projectId, projectName } = payloadBuilder.getCurrentProjectDetails());
      state.agentChat.messages.push({
        id: createId(),
        role: 'user',
        text: rawMessageText || buildAttachmentSummary(attachments),
        attachments,
        createdAt: new Date().toISOString()
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      conversation = toConversation(state.agentChat.messages);
      persist();
      input.value = '';
      attachmentsController.reset();
      payloadBuilder.consumeHiddenContexts?.();
      syncComposerHeight();
      renderHistoryView({ forceScroll: true });

      clientRequestId = `agent-request-${trimText(createId(), 120) || Date.now().toString(36)}`;
      getCanceledRequestIds().delete(clientRequestId);
      request = {
        clientRequestId,
        sessionId: requestSessionId,
        requestText: messageText,
        liveAssistantMessage: buildLiveAssistantPlaceholder(clientRequestId, messageText, createId),
        stopRequested: false,
        stopInProgress: false
      };
      getActiveRequests().set(clientRequestId, request);
    } catch (error) {
      runtime.sendPending = false;
      syncRequestUiState();
      setStatus('Error.');
      showTransientNotice(String(error?.message || error || 'Failed to create chat session.'), { type: 'error' });
      return { ok: false, reason: 'session_error' };
    }
    onAccepted?.({ clientRequestId, sessionId: requestSessionId });
    runtime.sendPending = false;
    syncRequestUiState();
    renderHistoryView({ forceScroll: true });
    setStatus('Working on this...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      if (request.stopRequested) {
        throw createLocalStopError('Agent request stopped before thinking began.');
      }
      const result = await api.agentChat({
        clientRequestId,
        message: messageText,
        attachments,
        chatSessionId: currentSessionId,
        projectId,
        projectName,
        conversation,
        stateSnapshot,
        llm: payloadBuilder.buildAgentLlmPayload(),
        agent: payloadBuilder.buildAgentFlagsPayload({ hiddenContexts })
      });
      if (wasRequestCanceled(clientRequestId)) {
        return;
      }
      if (!result?.ok) {
        if (result?.canceled === true) {
          appendStoppedAssistantMessage(request, messageText, result?.error || 'Agent request stopped.');
          setRequestStatus(request, 'Stopped.');
          return;
        }
        throw new Error(result?.error || 'Agent request failed.');
      }
      if (result.chat_session && typeof result.chat_session === 'object') {
        const sessionId = trimText(result.chat_session.id || result.chat_session.session_id, 120);
        if (sessionId) {
          request.sessionId = sessionId;
          sessionManager.upsertSessionSummary(result.chat_session);
        }
      }
      const response = normalizeAgentResponse(result);
      const notebookDraft = notebookDraftAdapter?.applyAutoSave?.(response.notebookPayload, messageText)
        ?? notebookDraftAdapter?.normalizeDraft?.(response.notebookPayload)
        ?? null;
      if (notebookDraft?.save?.applied === true) {
        renderContextSummary();
      }
      const traceRows = collectTraceRows(request);
      clearLiveAssistantState(request);
      const assistantMessage = buildAssistantResponseMessage({ createId, response, notebookDraft, traceRows, messageText });
      if (persistAssistantMessage(request, assistantMessage)) {
        openReviewForMessage(assistantMessage);
      }
      if (request.sessionId) {
        void sessionManager.refreshPersistentSessions({ force: true, loadCurrent: false });
      }
      setRequestStatus(request, response.userQuestion?.question ? 'Waiting for your answer.' : 'Complete.');
    } catch (error) {
      if (wasRequestCanceled(clientRequestId)) {
        return;
      }
      if (isLocalStopError(error)) {
        appendStoppedAssistantMessage(request, messageText, error?.message || 'Agent request stopped.');
        setRequestStatus(request, 'Stopped.');
        return;
      }
      const traceRows = collectTraceRows(request);
      clearLiveAssistantState(request);
      persistAssistantMessage(request, buildAssistantErrorMessage({ createId, error, traceRows, messageText }));
      setRequestStatus(request, 'Error.');
      showTransientNotice(String(error?.message || error || 'Agent request failed.'), { type: 'error' });
      return { ok: false, reason: 'request_error' };
    } finally {
      const requestWasVisible = isRequestVisible(request);
      runtime.sendPending = false;
      getCanceledRequestIds().delete(clientRequestId);
      getActiveRequests().delete(clientRequestId);
      syncRequestUiState();
      sessionManager.renderSessionList();
      if (requestWasVisible) {
        // The response render above occurs while the live request still exists.
        // Render once more after removal so the completed answer cannot retain a
        // stale Working placeholder or Stop control until the next view switch.
        renderHistoryView();
      }
    }
    return { ok: true, clientRequestId, sessionId: requestSessionId };
  }

  async function stopMessage() {
    if (!runtime.inFlight) {
      return;
    }
    const clientRequestId = runtime.activeClientRequestId;
    const request = getActiveRequests().get(clientRequestId);
    if (!request) {
      syncRequestUiState();
      return;
    }
    const requestText = trimText(
      request.liveAssistantMessage?.meta?.live_progress?.request_text || request.requestText,
      3000
    );
    request.stopRequested = true;
    request.stopInProgress = true;
    runtime.stopRequested = true;
    runtime.stopInProgress = true;
    if (deps.dom?.stopBtn) {
      deps.dom.stopBtn.disabled = true;
      deps.dom.stopBtn.textContent = 'Stopping...';
    }
    setStatus('Stopping...');
    if (!api?.agentChatCancel || !clientRequestId) {
      return;
    }
    try {
      const canceled = await api.agentChatCancel({ clientRequestId });
      if (canceled?.ok === true && canceled?.canceled === true
        && runtime.activeClientRequestId === clientRequestId) {
        getCanceledRequestIds().add(clientRequestId);
        appendStoppedAssistantMessage(request, requestText, 'Agent request stopped by user.');
        getActiveRequests().delete(clientRequestId);
        syncRequestUiState();
        setStatus('Stopped.');
      }
    } catch {
      // The active request will still unwind locally once the current step completes.
    }
  }

  return {
    sendMessage,
    stopMessage
  };
}
