import * as renderingModule from './rendering.js';
import { asArray, trimText } from './shared.js';

export function createAgentChatShellController({
  dom,
  state,
  persist,
  safeText,
  runtime
}) {
  let sessionManager = null;

  function setSessionManager(nextSessionManager) {
    sessionManager = nextSessionManager;
  }

  function ensureAgentState() {
    if (!state.agentChat || typeof state.agentChat !== 'object') {
      state.agentChat = { projectId: '', deepResearchEnabled: false, currentSessionId: '', sessions: [], messages: [] };
      return;
    }
    state.agentChat.projectId = String(state.agentChat.projectId || '');
    state.agentChat.deepResearchEnabled = state.agentChat.deepResearchEnabled === true;
    state.agentChat.currentSessionId = String(state.agentChat.currentSessionId || '');
    state.agentChat.sessions = asArray(state.agentChat.sessions);
    state.agentChat.messages = asArray(state.agentChat.messages);
  }

  function setStatus(text) {
    dom.status.textContent = text;
    const normalized = trimText(text, 160).toLowerCase();
    let tone = 'neutral';
    if (!normalized || normalized === 'ready.') {
      tone = 'ready';
    } else if (normalized.includes('error') || normalized.includes('failed') || normalized.includes('unavailable')) {
      tone = 'error';
    } else if (
      normalized.includes('complete')
      || normalized.includes('opened')
      || normalized.includes('loaded')
      || normalized.includes('created')
      || normalized.includes('enabled')
      || normalized.includes('disabled')
    ) {
      tone = 'complete';
    } else if (normalized.includes('working') || normalized.includes('loading') || normalized.includes('running') || normalized.includes('stopping')) {
      tone = 'working';
    }
    dom.status.dataset.state = tone;
  }

  function setSessionStatus(text) {
    if (dom.sessionStatus) {
      dom.sessionStatus.textContent = text;
    }
  }

  function getStoragePath() {
    return trimText(state.settings?.storagePath, 1200);
  }

  function isHistoryNearBottom() {
    const remaining = dom.historyNode.scrollHeight - dom.historyNode.scrollTop - dom.historyNode.clientHeight;
    return remaining < 96;
  }

  function updateScrollToBottomButton() {
    if (dom.scrollToBottomBtn) {
      dom.scrollToBottomBtn.hidden = isHistoryNearBottom();
    }
  }

  function scrollHistoryToBottom(smooth = false) {
    if (typeof dom.historyNode.scrollTo === 'function') {
      dom.historyNode.scrollTo({ top: dom.historyNode.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      dom.historyNode.scrollTop = dom.historyNode.scrollHeight;
    }
    updateScrollToBottomButton();
  }

  function syncComposerHeight() {
    dom.input.style.height = 'auto';
    const nextHeight = Math.min(Math.max(dom.input.scrollHeight, 92), 220);
    dom.input.style.height = `${nextHeight}px`;
    dom.input.style.overflowY = dom.input.scrollHeight > 220 ? 'auto' : 'hidden';
  }

  function renderHistoryView(options = {}) {
    ensureAgentState();
    const visibleMessages = runtime.liveAssistantMessage
      ? [...state.agentChat.messages, runtime.liveAssistantMessage]
      : state.agentChat.messages;
    const hasMessages = asArray(visibleMessages).length > 0;
    dom.conversationShell?.classList?.toggle('is-empty-chat', !hasMessages);
    if (!hasMessages && dom.scrollToBottomBtn) {
      dom.scrollToBottomBtn.hidden = true;
    }
    const previousScrollTop = dom.historyNode.scrollTop;
    const shouldStickToBottom = options.forceScroll === true
      || dom.historyNode.childElementCount === 0
      || isHistoryNearBottom();
    renderingModule.renderHistory({ historyNode: dom.historyNode, messages: visibleMessages, state, safeText });
    if (shouldStickToBottom) {
      scrollHistoryToBottom(options.smoothScroll === true);
      return;
    }
    dom.historyNode.scrollTop = previousScrollTop;
    updateScrollToBottomButton();
  }

  function renderProjectOptions() {
    ensureAgentState();
    const selected = state.agentChat.projectId;
    const options = ['<option value="">All projects</option>'];
    asArray(state.projects).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name || 'Untitled')}</option>`);
    });
    dom.projectSelect.innerHTML = options.join('');
    if (selected && asArray(state.projects).some((project) => project.id === selected)) {
      dom.projectSelect.value = selected;
    } else if (selected) {
      state.agentChat.projectId = '';
      persist();
    }
  }

  function renderDeepResearchToggle() {
    if (!dom.deepResearchToggleBtn) {
      return;
    }
    ensureAgentState();
    dom.deepResearchToggleBtn.dataset.enabled = state.agentChat.deepResearchEnabled === true ? 'true' : 'false';
    dom.deepResearchToggleBtn.textContent = state.agentChat.deepResearchEnabled === true
      ? 'Deep Research: On'
      : 'Deep Research: Off';
  }

  function renderContextSummary() {
    // Context summary UI has been removed from the agent rail.
  }

  function updateInFlightState(nextInFlight) {
    runtime.inFlight = nextInFlight;
    if (!runtime.inFlight) {
      runtime.stopRequested = false;
      runtime.stopInProgress = false;
    }
    dom.sendBtn.disabled = runtime.inFlight;
    if (dom.stopBtn) {
      dom.stopBtn.hidden = !runtime.inFlight;
      dom.stopBtn.disabled = !runtime.inFlight || runtime.stopInProgress;
      dom.stopBtn.textContent = runtime.stopInProgress ? 'Stopping...' : 'Stop';
    }
    [
      dom.newChatBtn,
      dom.developerTestToolsBtn,
      dom.developerRunToolBtn,
      dom.developerToolSelect,
      dom.developerToolMessageInput,
      dom.developerRefreshContextBtn,
      dom.developerUseMockResponseBtn,
      dom.developerMockResponseInput,
      dom.deepResearchToggleBtn
    ].filter(Boolean).forEach((node) => {
      node.disabled = runtime.inFlight;
    });
    dom.clearBtn.disabled = runtime.inFlight;
    dom.projectSelect.disabled = runtime.inFlight;
    dom.input.disabled = runtime.inFlight;
    sessionManager?.renderSessionList();
  }

  return {
    ensureAgentState,
    getStoragePath,
    renderContextSummary,
    renderDeepResearchToggle,
    renderHistoryView,
    renderProjectOptions,
    scrollHistoryToBottom,
    setSessionManager,
    setSessionStatus,
    setStatus,
    syncComposerHeight,
    updateInFlightState,
    updateScrollToBottomButton
  };
}
