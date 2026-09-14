import { createSavedNotebookAppend } from '../biology-notebook/agent/saved-append.js';
import { initAgentChat } from '../agent-chat/index.js';
import { createScopedAgentChatState } from '../agent-chat/scoped-state.js';

// Reuse the complete conversation/review workflow with independent Home history.
export function createHomeNotebookAgent({ state, persist, createId, safeText,
  rootDocument, windowObject, rendererServices, modules }) {
  const overlay = rootDocument.getElementById('home-agent-overlay');
  const closeButton = rootDocument.getElementById('home-agent-close-btn');
  let agent = null;
  let returnFocus = null;
  function close() {
    overlay.hidden = true;
    returnFocus?.focus?.();
  }
  closeButton?.addEventListener('click', close);
  overlay?.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button, input, textarea, select, [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && rootDocument.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && rootDocument.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  rootDocument.getElementById('home-agent-reopen-btn')?.addEventListener('click', () => {
    if (!agent) return;
    returnFocus = rootDocument.activeElement;
    overlay.hidden = false;
    closeButton?.focus();
  });
  return async (message) => {
    if (!overlay) return { ok: false, reason: 'unavailable' };
    if (!agent) {
      agent = initAgentChat({
        document: rootDocument, windowObject, idPrefix: 'home-agent',
        loadPersistentSessions: false,
        state: createScopedAgentChatState(state, { getScopeContext: () => ({ scopeType: 'home' }) }),
        persist, createId, safeText,
        onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
        onProtocolsChanged: () => {
          rendererServices.protocol.handleProtocolsChanged();
          modules.protocol?.renderList?.();
        },
        onAppendNotebookEntry: createSavedNotebookAppend({ state, persist,
          onChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged })
      });
    }
    returnFocus = rootDocument.activeElement;
    overlay.hidden = false;
    rootDocument.getElementById('home-agent-reopen-btn').hidden = false;
    agent.render();
    closeButton?.focus();
    return agent.submitExternalMessage?.(message, { waitForCompletion: true })
      || { ok: false, reason: 'unavailable' };
  };
}
