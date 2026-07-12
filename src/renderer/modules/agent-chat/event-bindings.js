import { trimText } from './shared.js';
import { applyLiveProgressEvent } from './live-progress-state.js';
import { extractPlotlyGraphArtifactFromProgressEvent } from './plotly-artifacts.js';

export function bindAgentChatEvents({
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
  onPlotlyGraphArtifact = () => {},
  renderDeveloperToolHint
}) {
  function applySuggestedPrompt(event) {
    const suggestedPromptButton = event?.target?.closest?.('[data-agent-suggest-prompt]')
      || (event?.target?.dataset?.agentSuggestPrompt ? event.target : null);
    if (!suggestedPromptButton) {
      return false;
    }
    const prompt = trimText(suggestedPromptButton.dataset.agentSuggestPrompt, 3000);
    if (!prompt) {
      return true;
    }
    dom.input.value = prompt;
    shell.syncComposerHeight();
    dom.input.focus();
    shell.setStatus('Prompt ready.');
    return true;
  }

  dom.projectSelect?.addEventListener('change', () => {
    shell.ensureAgentState();
    state.agentChat.projectId = dom.projectSelect.value || '';
    developerContextController.invalidate();
    persist();
    render();
  });

  dom.sendBtn.addEventListener('click', () => {
    void requestController.sendMessage();
  });

  dom.stopBtn?.addEventListener('click', () => {
    void requestController.stopMessage();
  });

  dom.developerTestToolsBtn?.addEventListener('click', () => {
    void developerToolTestController.runDeveloperToolSmokeTest();
  });

  dom.developerRunToolBtn?.addEventListener('click', () => {
    void developerToolTestController.runDeveloperSingleToolTest();
  });

  dom.developerToolSelect?.addEventListener('change', () => {
    renderDeveloperToolHint();
  });

  dom.developerResponseFoldBtn?.addEventListener('click', () => {
    runtime.developerResponseSimulatorFolded = !runtime.developerResponseSimulatorFolded;
    developerContextController.render();
  });

  dom.developerRefreshContextBtn?.addEventListener('click', () => {
    void developerContextController.refresh();
  });

  dom.developerUseMockResponseBtn?.addEventListener('click', () => {
    void developerMockController.useDeveloperMockResponse();
  });

  dom.newChatBtn?.addEventListener('click', () => {
    dom.input.value = '';
    attachmentsController.reset();
    shell.syncComposerHeight();
    void sessionManager.startNewChatSession();
  });

  dom.clearBtn?.addEventListener('click', () => {
    dom.input.value = '';
    attachmentsController.reset();
    shell.syncComposerHeight();
    void sessionManager.startNewChatSession();
  });

  dom.historyNode.addEventListener('click', (event) => {
    void historyController.onHistoryClick(event);
  });

  dom.quickPrompts?.addEventListener('click', (event) => {
    applySuggestedPrompt(event);
  });

  dom.historyNode.addEventListener('scroll', () => {
    shell.updateScrollToBottomButton();
  });

  dom.scrollToBottomBtn?.addEventListener('click', () => {
    shell.scrollHistoryToBottom(true);
  });

  dom.sessionList?.addEventListener('click', (event) => {
    const sessionCard = sessionManager.findSessionCard(event?.target);
    const sessionId = trimText(sessionCard?.dataset?.sessionId, 120);
    if (!sessionId || runtime.inFlight) {
      return;
    }
    void sessionManager.loadChatSession(sessionId);
  });

  dom.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void requestController.sendMessage();
  });

  dom.input.addEventListener('input', () => {
    shell.syncComposerHeight();
    developerContextController.invalidate();
    developerContextController.render();
  });

  dom.attachBtn?.addEventListener('click', () => {
    dom.attachmentInput?.click();
  });

  dom.paperScreenshotBtn?.addEventListener('click', async () => {
    if (typeof captureImageAttachment !== 'function') {
      shell.setStatus('Paper screenshot capture is unavailable.');
      return;
    }
    dom.paperScreenshotBtn.disabled = true;
    dom.paperScreenshotBtn.classList.add('is-active');
    dom.paperScreenshotBtn.setAttribute('aria-pressed', 'true');
    shell.setStatus('Drag over the paper to capture a screenshot.');
    try {
      const result = await captureImageAttachment();
      if (!result?.ok) {
        if (!result?.cancelled) {
          shell.setStatus(trimText(result?.error, 240) || 'Paper screenshot was not captured.');
        }
        return;
      }
      const attachment = attachmentsController.addAttachment(result.attachment, { announce: false });
      if (!attachment) {
        shell.setStatus('Paper screenshot was not attached.');
        return;
      }
      dom.input.focus();
      shell.syncComposerHeight();
      shell.setStatus('Paper screenshot attached.');
    } catch (error) {
      shell.setStatus(String(error?.message || error || 'Failed to capture paper screenshot.'));
    } finally {
      dom.paperScreenshotBtn.disabled = false;
      dom.paperScreenshotBtn.classList.remove('is-active');
      dom.paperScreenshotBtn.setAttribute('aria-pressed', 'false');
    }
  });

  dom.attachmentInput?.addEventListener('change', (event) => {
    void attachmentsController.handleSelection(event?.target?.files || []);
  });

  dom.attachmentList?.addEventListener('click', (event) => {
    const removeButton = event?.target?.closest?.('[data-agent-remove-attachment]')
      || (event?.target?.dataset?.agentRemoveAttachment ? event.target : null);
    const attachmentId = trimText(
      removeButton?.getAttribute?.('data-agent-remove-attachment')
        || removeButton?.dataset?.agentRemoveAttachment,
      120
    );
    attachmentsController.removeById(attachmentId);
  });

  api?.onAgentProgress?.((payload) => {
    const clientRequestId = trimText(payload?.client_request_id, 120);
    if (!clientRequestId || clientRequestId !== runtime.activeClientRequestId || !runtime.liveAssistantMessage) {
      return;
    }
    runtime.liveAssistantMessage = applyLiveProgressEvent(runtime.liveAssistantMessage, payload);
    const plotlyGraphArtifact = extractPlotlyGraphArtifactFromProgressEvent(payload);
    if (plotlyGraphArtifact?.figure?.data?.length) {
      onPlotlyGraphArtifact(plotlyGraphArtifact, payload);
    }
    shell.renderHistoryView();
    shell.setStatus(trimText(runtime.liveAssistantMessage?.text, 320) || 'Working on this...');
  });
}
