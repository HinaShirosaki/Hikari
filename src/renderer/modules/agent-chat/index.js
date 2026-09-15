import { trimText } from './shared.js';
import { hydrateAgentChatIcons, renderAgentChatIcon } from './icons.js';
import { createAgentChatSessionManager } from './session-manager.js';
import { createAgentChatShellController } from './shell-controller.js';
import { createAgentPayloadBuilder } from './payload-builder.js';
import { createComposerAttachmentsController } from './composer-attachments.js';
import { createAssistantQuestionController } from './assistant-questions.js';
import { createHistoryActionController } from './history-actions.js';
import { createAgentReviewOverlayController } from './review-overlay.js';
import { createAgentRequestController } from './agent-request-controller.js';
import { bindAgentChatEvents } from './event-bindings.js';
import { collectAgentChatDom, hasRequiredAgentChatDom } from './dom-bindings.js';
import { buildSyncedStateSnapshot } from './state-sync.js';
import { createAgentChatRuntimeState } from './runtime-state.js';
import { renderAgentChat } from './render-cycle.js';
import { mapExperimentDataToLlmJson } from './state-snapshot.js';
import { createNotebookDraftAgentAdapter } from '../biology-notebook/agent/index.js';
import { createProtocolAgentAdapter } from '../protocol/agent/index.js';

export { mapExperimentDataToLlmJson };

export function initAgentChat({
  document: rootDocument = globalThis?.document || (typeof document !== 'undefined' ? document : null),
  windowObject = globalThis?.window || (typeof window !== 'undefined' ? window : null),
  idPrefix = 'agent',
  loadPersistentSessions = true,
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onOpenNotebookEntry = () => {},
  onAppendNotebookEntry = async () => ({ ok: false, error: 'Notebook append is unavailable.' }),
  onProtocolsChanged = () => {},
  notebookDraftAdapter: providedNotebookDraftAdapter = null,
  protocolReviewAdapter: providedProtocolReviewAdapter = null,
  captureImageAttachment = null,
  onPlotlyGraphArtifact = () => {}
}) {
  hydrateAgentChatIcons(rootDocument);
  const api = windowObject?.hikariApi || null;
  const dom = collectAgentChatDom(rootDocument, { idPrefix });
  if (!hasRequiredAgentChatDom(dom)) {
    return { render: () => {} };
  }
  if (dom.paperScreenshotBtn && typeof captureImageAttachment !== 'function') {
    dom.paperScreenshotBtn.hidden = true;
  }
  const notebookDraftAdapter = providedNotebookDraftAdapter || createNotebookDraftAgentAdapter({
    state,
    createId,
    onNotebookEntriesChanged
  });
  const protocolReviewAdapter = providedProtocolReviewAdapter || createProtocolAgentAdapter({
    state,
    createId,
    onProtocolsChanged
  });
  const runtime = createAgentChatRuntimeState();
  const shell = createAgentChatShellController({
    dom,
    state,
    persist,
    safeText,
    runtime,
    notebookDraftAdapter,
    protocolReviewAdapter,
    hasImageCapture: typeof captureImageAttachment === 'function'
  });
  let requestController = null;
  let reviewController = null;
  const attachmentsController = createComposerAttachmentsController({
    attachmentInput: dom.attachmentInput,
    attachmentList: dom.attachmentList,
    createId,
    safeText,
    setStatus: shell.setStatus
  });
  const payloadBuilder = createAgentPayloadBuilder({
    state,
    input: dom.input,
    getComposerAttachments: attachmentsController.getAttachments,
    ensureAgentState: shell.ensureAgentState,
    onHiddenDraftContextsChanged: (contexts) => {
      renderHiddenContextIndicator(contexts);
    }
  });

  function renderHiddenContextIndicator(contexts = payloadBuilder.getPrimedHiddenContexts?.()) {
    if (!dom.hiddenContextList) {
      return;
    }
    const hasInjectedText = Array.isArray(contexts)
      && contexts.some((context) => String(context?.text || '').trim());
    if (!hasInjectedText) {
      dom.hiddenContextList.innerHTML = '';
      dom.hiddenContextList.hidden = true;
      return;
    }
    dom.hiddenContextList.hidden = false;
    dom.hiddenContextList.innerHTML = `
      <span class="agent-attachment-pill agent-hidden-context-pill" title="Selected text will be included with the next message">
        ${renderAgentChatIcon('context', { className: 'agent-hidden-context-icon' })}
        <span>Text</span>
        <button type="button" data-agent-remove-hidden-context aria-label="Remove selected text context">${renderAgentChatIcon('close', { className: 'agent-attachment-remove-icon' })}</button>
      </span>
    `;
  }
  const syncStateSnapshot = (projectId) => buildSyncedStateSnapshot({ api, state, projectId });
  const sessionManager = createAgentChatSessionManager({
    api,
    state,
    persist,
    createId,
    safeText,
    isNewChatDisabled: () => runtime.sendPending === true
      || runtime.sessionTransitionPending === true
      || (runtime.inFlight && !trimText(state.agentChat?.currentSessionId, 120)),
    sessionRail: dom.sessionRail,
    sessionList: dom.sessionList,
    sessionContextMenu: dom.sessionContextMenu,
    contextNewFolderBtn: dom.contextNewFolderBtn,
    contextRenameFolderBtn: dom.contextRenameFolderBtn,
    contextDeleteFolderBtn: dom.contextDeleteFolderBtn,
    ensureAgentState: shell.ensureAgentState,
    getStoragePath: shell.getStoragePath,
    renderProjectOptions: shell.renderProjectOptions,
    renderContextSummary: shell.renderContextSummary,
    renderHistory: shell.renderHistoryView,
    setStatus: shell.setStatus,
    setSessionStatus: shell.setSessionStatus,
    getRunningSessionIds: () => new Set(
      [...(runtime.activeRequests instanceof Map ? runtime.activeRequests.values() : [])]
        .map((request) => String(request?.sessionId || '').trim())
        .filter(Boolean)
    ),
    onActiveSessionChanged: () => {
      shell.syncActiveRequestState();
    },
    onNewChatPendingChanged: (isPending) => {
      runtime.sessionTransitionPending = isPending === true;
      shell.syncActiveRequestState();
    },
    onProjectScopeChanged: () => {}
  });
  shell.setSessionManager(sessionManager);
  sessionManager.bindEvents();

  const questionController = createAssistantQuestionController({
    api,
    state,
    input: dom.input,
    setStatus: shell.setStatus,
    persist,
    renderHistoryView: shell.renderHistoryView,
    syncComposerHeight: shell.syncComposerHeight,
    isInFlight: () => runtime.inFlight,
    sendMessage: () => requestController?.sendMessage()
  });

  const historyController = createHistoryActionController({
    api,
    state,
    persist,
    setStatus: shell.setStatus,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    answerAssistantQuestion: questionController.answerAssistantQuestion,
    notebookDraftAdapter,
    onOpenNotebookEntry,
    openReviewForMessage: (message) => reviewController?.openForMessage?.(message),
    reviewInline: (messageId, itemId, decision) => reviewController?.reviewInline?.(messageId, itemId, decision),
    onAppendNotebookEntry
  });

  reviewController = createAgentReviewOverlayController({
    dom,
    state,
    persist,
    safeText,
    setStatus: shell.setStatus,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    notebookActions: historyController.notebookActions,
    notebookDraftAdapter,
    protocolReviewAdapter,
    onAppendNotebookEntry
  });

  requestController = createAgentRequestController({
    api,
    state,
    runtime,
    dom,
    input: dom.input,
    createId,
    persist,
    payloadBuilder,
    attachmentsController,
    sessionManager,
    buildSyncedStateSnapshot: syncStateSnapshot,
    ensureAgentState: shell.ensureAgentState,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    setStatus: shell.setStatus,
    syncComposerHeight: shell.syncComposerHeight,
    syncActiveRequestState: shell.syncActiveRequestState,
    notebookDraftAdapter
  });

  const render = () => {
    renderAgentChat({
      api,
      state,
      dom,
      runtime,
      shell,
      sessionManager,
      attachmentsController,
      loadPersistentSessions
    });
    renderHiddenContextIndicator();
  };

  function focusComposer() {
    dom.input?.focus?.();
    shell.syncComposerHeight();
  }

  function primeHiddenContext(context = {}) {
    const didPrime = payloadBuilder.primeHiddenContext?.(context);
    if (!didPrime) {
      return false;
    }
    focusComposer();
    return true;
  }

  async function submitExternalMessage(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) {
      return { ok: false, reason: 'empty' };
    }
    if (text.length > 3000) {
      return { ok: false, reason: 'too_long' };
    }
    if (!api?.agentChat || !requestController) {
      return { ok: false, reason: 'unavailable' };
    }
    shell.syncActiveRequestState();
    if (runtime.inFlight || runtime.sendPending || runtime.sessionTransitionPending) {
      return { ok: false, reason: 'busy' };
    }
    const hasComposerDraft = Boolean(String(dom.input?.value || '').trim());
    const hasAttachments = attachmentsController.getAttachments().length > 0;
    const hasHiddenContext = payloadBuilder.getPrimedHiddenContexts()
      .some((context) => String(context?.text || '').trim());
    if (hasComposerDraft || hasAttachments || hasHiddenContext) {
      return { ok: false, reason: 'composer_not_empty' };
    }

    dom.input.value = text;
    shell.syncComposerHeight();
    return new Promise((resolve) => {
      let accepted = false;
      const clearInjectedDraft = () => {
        if (String(dom.input?.value || '') !== text) {
          return;
        }
        dom.input.value = '';
        shell.syncComposerHeight();
      };
      const request = requestController.sendMessage({
        onAccepted: (details) => {
          accepted = true;
          if (!options.waitForCompletion) resolve({ ok: true, ...details });
        }
      });
      Promise.resolve(request)
        .then((result) => {
          if (!accepted || options.waitForCompletion) {
            clearInjectedDraft();
            resolve(result?.ok ? result : {
              ok: false,
              reason: result?.reason || 'session_error'
            });
          }
        })
        .catch((error) => {
          console.warn('External Agent message could not be submitted:', error);
          if (!accepted || options.waitForCompletion) {
            clearInjectedDraft();
            resolve({ ok: false, reason: 'session_error' });
          }
        });
    });
  }

  bindAgentChatEvents({
    dom,
    api,
    state,
    persist,
    runtime,
    render,
    sessionManager,
    shell,
    attachmentsController,
    payloadBuilder,
    requestController,
    historyController,
    captureImageAttachment,
    onPlotlyGraphArtifact
  });

  return {
    focusComposer,
    primeHiddenContext,
    submitExternalMessage,
    render
  };
}
