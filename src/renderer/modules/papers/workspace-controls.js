// Coordinate the existing outline and paper-scoped chat without moving their
// contents or creating a second chat session.
export function createPapersWorkspaceControls(context) {
  const { elements, document: doc, window: win, uiState } = context;

  function dispatch(name) {
    const EventCtor = doc?.defaultView?.CustomEvent;
    if (typeof EventCtor === 'function') doc.dispatchEvent(new EventCtor(name));
  }

  function renderLayout() {
    const hasContext = !uiState.commentsCollapsed
      || Boolean(doc?.body?.classList?.contains('has-agent-chat-rail-expanded'));
    elements.papersLayout?.classList?.toggle('has-active-context', hasContext);
    doc?.body?.classList?.toggle('has-papers-context', hasContext);
    if (elements.papersLibraryRail) {
      const compactContext = hasContext && Number(win?.innerWidth) <= 1280;
      elements.papersLibraryRail.inert = compactContext
        || Boolean(elements.papersLayout?.classList?.contains('is-left-rail-folded'));
    }
  }

  function togglePanel(panel) {
    const isOpen = !uiState.commentsCollapsed && (uiState.contextPanel || 'outline') === panel;
    if (!isOpen) dispatch('hikari:close-agent-chat-rail');
    uiState.contextPanel = panel;
    context.setCommentsCollapsed(isOpen);
    context.renderCommentPanelState?.();
  }

  function toggleOutline() { togglePanel('outline'); }
  function toggleBrief() { togglePanel('brief'); }
  function toggleDetails() { togglePanel('details'); }

  function onChatState(event) {
    if (event.detail?.viewId !== 'papers-view') return;
    if (event.detail?.expanded) {
      context.setCommentsCollapsed(true);
    }
    renderLayout();
  }

  elements.paperCommentToggleBtn?.addEventListener('click', toggleOutline);
  elements.paperBriefToggleBtn?.addEventListener('click', toggleBrief);
  elements.paperDetailsToggleBtn?.addEventListener('click', toggleDetails);
  doc?.addEventListener?.('hikari:agent-chat-rail-state', onChatState);
  win?.addEventListener?.('resize', renderLayout);
  context.syncWorkspaceControls = renderLayout;
  renderLayout();
  return { toggleOutline, toggleBrief, toggleDetails };
}
