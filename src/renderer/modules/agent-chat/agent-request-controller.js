import { normalizeAgentResponse } from './response.js';
import { applyNotebookDraftAutoSave } from './notebook-drafts.js';
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
    updateInFlightState,
    onNotebookEntriesChanged,
    openReviewForMessage = () => {}
  } = deps;

  function clearLiveAssistantState() {
    runtime.liveAssistantMessage = null;
    runtime.activeClientRequestId = '';
  }

  function collectTraceRows() {
    const progress = runtime.liveAssistantMessage?.meta?.live_progress || {};
    return {
      thinking: cloneLiveThinkingRows(progress.thinking_rows),
      activity: cloneLiveActivityRows(progress.activity_rows),
      codexCliDisplay: cloneLiveCodexCliDisplayRows(progress.codex_cli_display_rows)
    };
  }

  function appendStoppedAssistantMessage(requestText, message = 'Agent request stopped.') {
    clearLiveAssistantState();
    state.agentChat.messages.push(buildStoppedAssistantMessage(requestText, message, createId));
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    sessionManager.renderSessionList();
    renderHistoryView({ forceScroll: true });
  }
  function persistAssistantMessage(message) {
    state.agentChat.messages.push(message);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    sessionManager.renderSessionList();
    renderHistoryView({ forceScroll: true });
  }

  async function sendMessage() {
    if (runtime.inFlight) {
      return;
    }
    const { rawMessageText, attachments, messageText, hiddenContexts } = payloadBuilder.getDraftRequest();
    if (!rawMessageText && !attachments.length) {
      return;
    }
    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }

    ensureAgentState();
    runtime.stopRequested = false;
    runtime.stopInProgress = false;

    const { projectId, projectName } = payloadBuilder.getCurrentProjectDetails();
    const currentSessionId = await sessionManager.ensureCurrentChatSession(messageText);
    state.agentChat.messages.push({
      id: createId(),
      role: 'user',
      text: rawMessageText || buildAttachmentSummary(attachments),
      attachments,
      createdAt: new Date().toISOString()
    });
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    input.value = '';
    attachmentsController.reset();
    payloadBuilder.consumeHiddenContexts?.();
    syncComposerHeight();
    renderHistoryView({ forceScroll: true });

    const clientRequestId = `agent-request-${trimText(createId(), 120) || Date.now().toString(36)}`;
    runtime.activeClientRequestId = clientRequestId;
    runtime.liveAssistantMessage = buildLiveAssistantPlaceholder(clientRequestId, messageText, createId);
    renderHistoryView({ forceScroll: true });
    updateInFlightState(true);
    setStatus('Working on this...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      if (runtime.stopRequested) {
        throw createLocalStopError('Agent request stopped before thinking began.');
      }
      const result = await api.agentChat({
        clientRequestId,
        message: messageText,
        attachments,
        chatSessionId: currentSessionId,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot,
        llm: payloadBuilder.buildAgentLlmPayload(),
        agent: payloadBuilder.buildAgentFlagsPayload({ hiddenContexts })
      });
      if (!result?.ok) {
        if (result?.canceled === true) {
          appendStoppedAssistantMessage(messageText, result?.error || 'Agent request stopped.');
          setStatus('Stopped.');
          return;
        }
        throw new Error(result?.error || 'Agent request failed.');
      }
      if (result.chat_session && typeof result.chat_session === 'object') {
        const sessionId = trimText(result.chat_session.id || result.chat_session.session_id, 120);
        if (sessionId) {
          state.agentChat.currentSessionId = sessionId;
          sessionManager.upsertSessionSummary(result.chat_session);
        }
      }
      const response = normalizeAgentResponse(result);
      const notebookDraft = applyNotebookDraftAutoSave(response.notebookPayload, messageText, {
        state,
        createId,
        onNotebookEntriesChanged
      });
      if (notebookDraft?.save?.applied === true) {
        renderContextSummary();
      }
      const traceRows = collectTraceRows();
      clearLiveAssistantState();
      const assistantMessage = buildAssistantResponseMessage({ createId, response, notebookDraft, traceRows, messageText });
      persistAssistantMessage(assistantMessage);
      openReviewForMessage(assistantMessage);
      if (state.agentChat.currentSessionId) {
        void sessionManager.refreshPersistentSessions({ force: true, loadCurrent: false });
      }
      setStatus('Complete.');
    } catch (error) {
      if (isLocalStopError(error)) {
        appendStoppedAssistantMessage(messageText, error?.message || 'Agent request stopped.');
        setStatus('Stopped.');
        return;
      }
      const traceRows = collectTraceRows();
      clearLiveAssistantState();
      persistAssistantMessage(buildAssistantErrorMessage({ createId, error, traceRows, messageText }));
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function stopMessage() {
    if (!runtime.inFlight) {
      return;
    }
    runtime.stopRequested = true;
    runtime.stopInProgress = true;
    if (deps.dom?.stopBtn) {
      deps.dom.stopBtn.disabled = true;
      deps.dom.stopBtn.textContent = 'Stopping...';
    }
    setStatus('Stopping...');
    if (!api?.agentChatCancel || !runtime.activeClientRequestId) {
      return;
    }
    try {
      await api.agentChatCancel({ clientRequestId: runtime.activeClientRequestId });
    } catch {
      // The active request will still unwind locally once the current step completes.
    }
  }

  return {
    sendMessage,
    stopMessage
  };
}
