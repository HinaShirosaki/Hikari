import { renderAgentChatIcon } from '../../modules/agent-chat/icons.js';
import { isAgentAvailable } from '../../lib/agent-availability.js';

export function isAgentChatRailAvailable(app, view) {
  return app?.agentChatRail === true && view?.dataset?.agentChatRail !== 'disabled';
}

export function createAgentChatRail({
  VIEWS,
  documentObject,
  getActiveViewId,
  getAppForView,
  resolveNavigationViewId,
  moduleRuntime,
  sharedLeftRailRuntime
} = {}) {
  const rail = documentObject.getElementById('universal-agent-chat-rail');
  const toggleButton = documentObject.getElementById('agent-chat-rail-toggle-btn');
  const paperDetailsToggle = documentObject.getElementById('paper-details-toggle-btn');
  const paperBriefToggle = documentObject.getElementById('paper-brief-toggle-btn');
  const paperOutlineToggle = documentObject.getElementById('paper-comment-toggle-btn');
  let expanded = false;

  function isEnabledForView(viewId) {
    const app = getAppForView(viewId);
    const navViewId = resolveNavigationViewId(viewId);
    const view = documentObject.getElementById(navViewId);
    // Without Codex only Papers keeps the rail, for its PDF toolbar and paper panels.
    return isAgentChatRailAvailable(app, view)
      && (isAgentAvailable(documentObject) || navViewId === VIEWS.PAPERS);
  }

  function toggleIcon(isExpanded) {
    return renderAgentChatIcon(isExpanded ? 'rail-collapse' : 'chat', {
      className: 'universal-agent-chat-rail__toggle-icon'
    });
  }

  function syncExpansion(enabled) {
    const visibleExpanded = enabled && expanded && isAgentAvailable(documentObject);
    const viewId = getActiveViewId();
    const isPapers = viewId === VIEWS.PAPERS;
    documentObject.body.classList.toggle('has-agent-chat-rail-expanded', visibleExpanded);
    if (rail) {
      rail.classList.toggle('is-expanded', visibleExpanded);
      rail.classList.toggle('is-collapsed', enabled && !visibleExpanded);
      rail.dataset.state = visibleExpanded ? 'expanded' : 'collapsed';
    }
    if (toggleButton) {
      toggleButton.innerHTML = toggleIcon(visibleExpanded);
      toggleButton.setAttribute('aria-expanded', String(visibleExpanded));
      const label = isPapers
        ? (visibleExpanded ? 'Close Hikari' : 'Ask Hikari')
        : (visibleExpanded ? 'Fold agent chat rail' : 'Open agent chat rail');
      toggleButton.setAttribute('aria-label', label);
      toggleButton.title = isPapers ? label : (visibleExpanded ? 'Fold chat' : 'Open chat');
    }
    if (paperOutlineToggle) paperOutlineToggle.hidden = !isPapers || !enabled;
    if (paperBriefToggle) paperBriefToggle.hidden = !isPapers || !enabled;
    if (paperDetailsToggle) paperDetailsToggle.hidden = !isPapers || !enabled;
    const EventCtor = documentObject.defaultView?.CustomEvent;
    if (typeof EventCtor === 'function') {
      documentObject.dispatchEvent(new EventCtor('hikari:agent-chat-rail-state', {
        detail: { expanded: visibleExpanded, viewId }
      }));
    }
    return visibleExpanded;
  }

  function setExpanded(nextExpanded) {
    expanded = Boolean(nextExpanded);
    const enabled = documentObject.body.classList.contains('has-agent-chat-rail');
    const visibleExpanded = syncExpansion(enabled);
    if (visibleExpanded) {
      moduleRuntime.renderAgentChatRail?.();
    }
    sharedLeftRailRuntime.syncWidth();
  }

  function open() {
    setExpanded(true);
  }

  function syncState(activeViewId) {
    const enabled = isEnabledForView(activeViewId);
    documentObject.body.classList.toggle('has-agent-chat-rail', enabled);
    if (rail) {
      rail.hidden = !enabled;
      rail.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    return syncExpansion(enabled);
  }

  function init() {
    toggleButton?.addEventListener('click', () => setExpanded(!expanded));
    documentObject.addEventListener('hikari:open-agent-chat-rail', open);
    documentObject.addEventListener('hikari:close-agent-chat-rail', () => setExpanded(false));
    documentObject.addEventListener('hikari:agent-chat-rail-availability-changed', () => {
      syncState(getActiveViewId());
      sharedLeftRailRuntime.syncWidth();
    });
  }

  return {
    init,
    open,
    setExpanded,
    syncState
  };
}
