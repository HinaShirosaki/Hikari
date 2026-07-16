import { createAgentChatSessionManager } from './session-manager.js';
import { createAgentChatShellController } from './shell-controller.js';
import { createAgentPayloadBuilder } from './payload-builder.js';
import { createComposerAttachmentsController } from './composer-attachments.js';
import { createDeveloperContextController } from './developer-context.js';
import { createAssistantQuestionController } from './assistant-questions.js';
import { createHistoryActionController } from './history-actions.js';
import { createAgentReviewOverlayController } from './review-overlay.js';
import { createAgentRequestController } from './agent-request-controller.js';
import { createDeveloperMockResponseController } from './developer-mock-response.js';
import { createDeveloperToolTestController } from './developer-tool-tests.js';
import { bindAgentChatEvents } from './event-bindings.js';
import { collectAgentChatDom, hasRequiredAgentChatDom } from './dom-bindings.js';
import { buildSyncedStateSnapshot } from './state-sync.js';
import { createAgentChatRuntimeState } from './runtime-state.js';
import { createDeveloperToolUi } from './developer-tool-ui.js';
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
  onProtocolsChanged = () => {},
  notebookDraftAdapter: providedNotebookDraftAdapter = null,
  protocolReviewAdapter: providedProtocolReviewAdapter = null,
  captureImageAttachment = null,
  onPlotlyGraphArtifact = () => {}
}) {
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
    hasImageCapture: typeof captureImageAttachment === 'function'
  });
  let developerContextController = null;
  let requestController = null;
  const attachmentsController = createComposerAttachmentsController({
    attachmentInput: dom.attachmentInput,
    attachmentList: dom.attachmentList,
    createId,
    safeText,
    setStatus: shell.setStatus,
    invalidateDeveloperContextPreview: () => developerContextController?.invalidate(),
    renderDeveloperResponseSimulator: () => developerContextController?.render()
  });
  const payloadBuilder = createAgentPayloadBuilder({
    state,
    input: dom.input,
    getComposerAttachments: attachmentsController.getAttachments,
    ensureAgentState: shell.ensureAgentState,
    onHiddenDraftContextsChanged: (contexts) => {
      renderHiddenContextIndicator(contexts);
      developerContextController?.invalidate();
      developerContextController?.render();
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
        <svg class="agent-hidden-context-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
          <path d="M6 3h8l4 4v14H6z"></path>
          <path d="M14 3v5h5"></path>
          <path d="M9 12h6"></path>
          <path d="M9 16h6"></path>
        </svg>
        <span>Text</span>
        <button type="button" data-agent-remove-hidden-context aria-label="Remove selected text context">&times;</button>
      </span>
    `;
  }
  const syncStateSnapshot = (projectId) => buildSyncedStateSnapshot({ api, state, projectId });
  developerContextController = createDeveloperContextController({
    api,
    state,
    dom,
    runtime,
    setStatus: shell.setStatus,
    ensureAgentState: shell.ensureAgentState,
    buildSyncedStateSnapshot: syncStateSnapshot,
    payloadBuilder
  });
  const developerToolUi = createDeveloperToolUi({ dom, safeText });
  const sessionManager = createAgentChatSessionManager({
    api,
    state,
    persist,
    createId,
    safeText,
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
    onProjectScopeChanged: () => {
      developerContextController?.invalidate();
      developerContextController?.render();
    }
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
    input: dom.input,
    persist,
    setStatus: shell.setStatus,
    syncComposerHeight: shell.syncComposerHeight,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    answerAssistantQuestion: questionController.answerAssistantQuestion,
    notebookDraftAdapter,
    onOpenNotebookEntry
  });

  const reviewController = createAgentReviewOverlayController({
    dom,
    state,
    persist,
    safeText,
    setStatus: shell.setStatus,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    notebookActions: historyController.notebookActions,
    notebookDraftAdapter,
    protocolReviewAdapter
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
    notebookDraftAdapter,
    openReviewForMessage: reviewController.openForMessage
  });

  const developerMockController = createDeveloperMockResponseController({
    state,
    runtime,
    dom,
    createId,
    persist,
    payloadBuilder,
    attachmentsController,
    sessionManager,
    developerContextController,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    setStatus: shell.setStatus,
    syncComposerHeight: shell.syncComposerHeight,
    updateInFlightState: shell.updateInFlightState,
    ensureAgentState: shell.ensureAgentState,
    notebookDraftAdapter,
    openReviewForMessage: reviewController.openForMessage
  });

  const developerToolTestController = createDeveloperToolTestController({
    api,
    state,
    runtime,
    dom,
    createId,
    persist,
    payloadBuilder,
    buildSyncedStateSnapshot: syncStateSnapshot,
    ensureAgentState: shell.ensureAgentState,
    renderHistoryView: shell.renderHistoryView,
    setStatus: shell.setStatus,
    updateInFlightState: shell.updateInFlightState
  });

  const render = () => {
    renderAgentChat({
      api,
      state,
      dom,
      runtime,
      shell,
      sessionManager,
      developerToolUi,
      developerContextController,
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
    developerContextController,
    requestController,
    developerMockController,
    developerToolTestController,
    historyController,
    captureImageAttachment,
    onPlotlyGraphArtifact,
    renderDeveloperToolHint: developerToolUi.renderDeveloperToolHint
  });

  return {
    focusComposer,
    primeHiddenContext,
    render
  };
}
