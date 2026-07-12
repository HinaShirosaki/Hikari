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
  const runtime = createAgentChatRuntimeState();
  const shell = createAgentChatShellController({
    dom,
    state,
    persist,
    safeText,
    runtime,
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
    ensureAgentState: shell.ensureAgentState
  });
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
    safeText,
    sessionList: dom.sessionList,
    ensureAgentState: shell.ensureAgentState,
    getStoragePath: shell.getStoragePath,
    renderProjectOptions: shell.renderProjectOptions,
    renderContextSummary: shell.renderContextSummary,
    renderHistory: shell.renderHistoryView,
    setStatus: shell.setStatus,
    setSessionStatus: shell.setSessionStatus,
    isInteractionLocked: () => runtime.inFlight
  });
  shell.setSessionManager(sessionManager);

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
    createId,
    persist,
    setStatus: shell.setStatus,
    syncComposerHeight: shell.syncComposerHeight,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    answerAssistantQuestion: questionController.answerAssistantQuestion,
    onNotebookEntriesChanged,
    onOpenNotebookEntry
  });

  const reviewController = createAgentReviewOverlayController({
    dom,
    state,
    persist,
    createId,
    safeText,
    setStatus: shell.setStatus,
    renderContextSummary: shell.renderContextSummary,
    renderHistoryView: shell.renderHistoryView,
    notebookActions: historyController.notebookActions,
    onProtocolsChanged
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
    updateInFlightState: shell.updateInFlightState,
    onNotebookEntriesChanged,
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
    onNotebookEntriesChanged,
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

  const render = () => renderAgentChat({
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
