import * as renderingModule from './rendering.js';
import { asArray, trimText } from './shared.js';

const QUICK_PROMPT_PRESETS = {
  workspace: {
    ariaLabel: 'Common chat prompts',
    placeholder: 'Ask Hikari about this workspace.',
    prompts: [
      {
        label: 'Summarize context',
        prompt: 'Summarize the current workspace context and call out useful next actions.'
      },
      {
        label: 'Plan next step',
        prompt: 'Suggest practical next steps from the current workspace context.'
      },
      {
        label: 'Find gaps',
        prompt: 'Flag missing details or follow-up questions from the current workspace context.'
      }
    ]
  },
  paper: {
    ariaLabel: 'Common paper prompts',
    placeholder: 'Ask Hikari about this paper.',
    prompts: [
      {
        label: 'Generate protocol',
        prompt: 'Generate a step-by-step experimental protocol from this paper. Include materials, timing, controls, and key caveats.'
      },
      {
        label: 'Summarize',
        prompt: 'Summarize the main finding, evidence, and limitations of this paper.'
      },
      {
        label: 'Extract methods',
        prompt: 'Extract the methods that are directly reusable for my experiment.'
      }
    ]
  },
  notebook: {
    ariaLabel: 'Common notebook prompts',
    placeholder: 'Ask Hikari about this notebook page.',
    prompts: [
      {
        label: 'Summarize page',
        prompt: 'Summarize this notebook page and flag any missing experimental details.'
      },
      {
        label: 'Next steps',
        prompt: 'Suggest the next experimental steps based on this notebook page.'
      },
      {
        label: 'Draft note',
        prompt: 'Draft a concise follow-up note for this notebook page.'
      }
    ]
  },
  assay: {
    ariaLabel: 'Common assay prompts',
    placeholder: 'Ask Hikari about this assay.',
    prompts: [
      {
        label: 'Analyze results',
        prompt: 'Analyze these assay results and identify patterns, outliers, and useful follow-up calculations.'
      },
      {
        label: 'Make graph',
        prompt: 'Create a clear Plotly graph for this assay result set and explain what should be adjusted.'
      },
      {
        label: 'Build table',
        prompt: 'Create a derived analysis table from this assay data with averages, standard deviations, and relevant ratios.'
      }
    ]
  }
};

export function createAgentChatShellController({
  dom,
  state,
  persist,
  safeText,
  runtime,
  hasImageCapture = false
}) {
  let sessionManager = null;

  function setSessionManager(nextSessionManager) {
    sessionManager = nextSessionManager;
  }

  function ensureAgentState() {
    if (!state.agentChat || typeof state.agentChat !== 'object') {
      state.agentChat = { projectId: '', currentSessionId: '', sessions: [], messages: [] };
      return;
    }
    state.agentChat.projectId = String(state.agentChat.projectId || '');
    state.agentChat.currentSessionId = String(state.agentChat.currentSessionId || '');
    state.agentChat.sessions = asArray(state.agentChat.sessions);
    state.agentChat.messages = asArray(state.agentChat.messages);
  }

  function setStatus(text) {
    if (!dom.status) {
      return;
    }
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
    const computedStyle = typeof dom.input.ownerDocument?.defaultView?.getComputedStyle === 'function'
      ? dom.input.ownerDocument.defaultView.getComputedStyle(dom.input)
      : null;
    const readHeight = (name, fallback) => {
      const value = Number.parseFloat(computedStyle?.getPropertyValue?.(name) || '');
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    const minHeight = readHeight('--agent-composer-min-height', 92);
    const maxHeight = readHeight('--agent-composer-max-height', 220);
    dom.input.style.height = 'auto';
    const nextHeight = Math.min(Math.max(dom.input.scrollHeight, minHeight), maxHeight);
    dom.input.style.height = `${nextHeight}px`;
    dom.input.style.overflowY = dom.input.scrollHeight > maxHeight ? 'auto' : 'hidden';
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
    if (!dom.projectSelect) {
      return;
    }
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

  function renderContextSummary() {
    // Context summary UI has been removed from the agent rail.
  }

  function getActiveScopeType() {
    const context = state.agentChatContext && typeof state.agentChatContext === 'object'
      ? state.agentChatContext
      : {};
    const scopeType = trimText(context.scopeType, 80);
    if (scopeType === 'notebook' || scopeType === 'paper' || scopeType === 'assay') {
      return scopeType;
    }
    return 'workspace';
  }

  function renderScopedComposer() {
    const scopeType = getActiveScopeType();
    const preset = QUICK_PROMPT_PRESETS[scopeType] || QUICK_PROMPT_PRESETS.workspace;
    if (dom.input) {
      dom.input.placeholder = preset.placeholder;
    }
    if (dom.paperScreenshotBtn) {
      dom.paperScreenshotBtn.hidden = !hasImageCapture || scopeType !== 'paper';
    }
    if (!dom.quickPrompts) {
      return;
    }
    dom.quickPrompts.setAttribute?.('aria-label', preset.ariaLabel);
    const doc = dom.quickPrompts.ownerDocument;
    const buttons = Array.from(dom.quickPrompts.querySelectorAll?.('[data-agent-suggest-prompt]') || []);
    while (buttons.length < preset.prompts.length && doc?.createElement) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ghost-btn agent-rail-quick-prompt';
      dom.quickPrompts.appendChild(button);
      buttons.push(button);
    }
    buttons.forEach((button, index) => {
      const prompt = preset.prompts[index];
      button.hidden = !prompt;
      if (!prompt) {
        return;
      }
      button.dataset.agentSuggestPrompt = prompt.prompt;
      button.textContent = prompt.label;
    });
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
      dom.developerMockResponseInput
    ].filter(Boolean).forEach((node) => {
      node.disabled = runtime.inFlight;
    });
    if (dom.clearBtn) {
      dom.clearBtn.disabled = runtime.inFlight;
    }
    if (dom.projectSelect) {
      dom.projectSelect.disabled = runtime.inFlight;
    }
    dom.input.disabled = runtime.inFlight;
    sessionManager?.renderSessionList();
  }

  return {
    ensureAgentState,
    getStoragePath,
    renderContextSummary,
    renderHistoryView,
    renderScopedComposer,
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
