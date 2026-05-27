export function collectAgentChatDom(rootDocument) {
  const byId = (id) => rootDocument?.getElementById?.(id) || null;
  const historyNode = byId('agent-chat-history');
  return {
    projectSelect: byId('agent-project-select'),
    sessionStatus: byId('agent-session-status'),
    sessionList: byId('agent-session-list'),
    newChatBtn: byId('agent-new-chat-btn'),
    developerTools: byId('agent-developer-tools'),
    developerTestToolsBtn: byId('agent-dev-test-tools-btn'),
    developerToolSelect: byId('agent-dev-tool-select'),
    developerToolMessageInput: byId('agent-dev-tool-message'),
    developerRunToolBtn: byId('agent-dev-run-tool-btn'),
    developerToolHint: byId('agent-dev-tool-hint'),
    developerResponseSimulator: byId('agent-dev-response-simulator'),
    developerResponseSummary: byId('agent-dev-response-summary'),
    developerResponseFoldBtn: byId('agent-dev-response-fold-btn'),
    developerResponseBody: byId('agent-dev-response-body'),
    developerVisibleContext: byId('agent-dev-visible-context'),
    developerMockResponseInput: byId('agent-dev-mock-response'),
    developerRefreshContextBtn: byId('agent-dev-refresh-context-btn'),
    developerUseMockResponseBtn: byId('agent-dev-use-mock-response-btn'),
    developerResponseHint: byId('agent-dev-response-hint'),
    historyNode,
    conversationShell: historyNode?.closest?.('.agent-conversation-shell') || null,
    scrollToBottomBtn: byId('agent-scroll-to-bottom-btn'),
    reviewOverlay: byId('agent-review-overlay'),
    reviewTrack: byId('agent-review-track'),
    reviewCloseBtn: byId('agent-review-close-btn'),
    reviewPrevBtn: byId('agent-review-prev-btn'),
    reviewNextBtn: byId('agent-review-next-btn'),
    reviewPageLabel: byId('agent-review-page-label'),
    input: byId('agent-message-input'),
    attachmentInput: byId('agent-attachment-input'),
    attachmentList: byId('agent-attachment-list'),
    attachBtn: byId('agent-attach-btn'),
    deepResearchToggleBtn: byId('agent-deep-research-toggle-btn'),
    sendBtn: byId('agent-send-btn'),
    stopBtn: byId('agent-stop-btn'),
    clearBtn: byId('agent-clear-btn'),
    status: byId('agent-status')
  };
}

export function hasRequiredAgentChatDom(dom = {}) {
  return Boolean(
    dom.projectSelect
    && dom.historyNode
    && dom.input
    && dom.sendBtn
    && dom.clearBtn
    && dom.status
  );
}
