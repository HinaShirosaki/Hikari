export function collectAgentChatDom(rootDocument, options = {}) {
  const rawPrefix = String(options.idPrefix || 'agent').trim();
  const idPrefix = rawPrefix ? rawPrefix.replace(/-+$/, '') : 'agent';
  const byId = (id) => rootDocument?.getElementById?.(id) || null;
  const id = (suffix) => `${idPrefix}-${suffix}`;
  const historyNode = byId(id('chat-history'));
  return {
    projectSelect: byId(id('project-select')),
    sessionRail: byId(id('session-rail')),
    sessionStatus: byId(id('session-status')),
    sessionList: byId(id('session-list')),
    newChatBtn: byId(id('new-chat-btn')),
    sessionContextMenu: byId(id('session-context-menu')),
    contextNewFolderBtn: byId(id('context-new-folder')),
    contextRenameFolderBtn: byId(id('context-rename-folder')),
    contextDeleteFolderBtn: byId(id('context-delete-folder')),
    developerTools: byId(id('developer-tools')),
    developerTestToolsBtn: byId(id('dev-test-tools-btn')),
    developerToolSelect: byId(id('dev-tool-select')),
    developerToolMessageInput: byId(id('dev-tool-message')),
    developerRunToolBtn: byId(id('dev-run-tool-btn')),
    developerToolHint: byId(id('dev-tool-hint')),
    developerResponseSimulator: byId(id('dev-response-simulator')),
    developerResponseSummary: byId(id('dev-response-summary')),
    developerResponseFoldBtn: byId(id('dev-response-fold-btn')),
    developerResponseBody: byId(id('dev-response-body')),
    developerVisibleContext: byId(id('dev-visible-context')),
    developerMockResponseInput: byId(id('dev-mock-response')),
    developerRefreshContextBtn: byId(id('dev-refresh-context-btn')),
    developerUseMockResponseBtn: byId(id('dev-use-mock-response-btn')),
    developerResponseHint: byId(id('dev-response-hint')),
    historyNode,
    conversationShell: historyNode?.closest?.('.agent-conversation-shell') || null,
    scrollToBottomBtn: byId(id('scroll-to-bottom-btn')),
    reviewOverlay: byId(id('review-overlay')),
    reviewTrack: byId(id('review-track')),
    reviewCloseBtn: byId(id('review-close-btn')),
    reviewPrevBtn: byId(id('review-prev-btn')),
    reviewNextBtn: byId(id('review-next-btn')),
    reviewPageLabel: byId(id('review-page-label')),
    input: byId(id('message-input')),
    quickPrompts: byId(id('quick-prompts')),
    attachmentInput: byId(id('attachment-input')),
    hiddenContextList: byId(id('hidden-context-list')),
    attachmentList: byId(id('attachment-list')),
    attachBtn: byId(id('attach-btn')),
    paperScreenshotBtn: byId(id('paper-screenshot-btn')),
    sendBtn: byId(id('send-btn')),
    stopBtn: byId(id('stop-btn')),
    status: byId(id('status'))
  };
}

export function hasRequiredAgentChatDom(dom = {}) {
  return Boolean(
    dom.historyNode
    && dom.input
    && dom.sendBtn
  );
}
