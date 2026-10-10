import { initAgentChat } from '../modules/agent-chat/index.js';
import { createScopedAgentChatState } from '../modules/agent-chat/scoped-state.js';

export function createAgentRailScopeContextGetter(modules, rootDocument, views = {}) {
  return () => {
    const activeViewId = String(rootDocument?.body?.dataset?.activeView || '').trim();
    const pluginView = rootDocument?.getElementById?.(activeViewId);
    if (pluginView?.dataset?.pluginId) return { scopeType: 'plugin', pluginId: pluginView.dataset.pluginId,
      pluginName: pluginView.dataset.pluginName, pluginContextId: pluginView.dataset.pluginChatContextId,
      pluginContextTitle: pluginView.dataset.pluginChatContextTitle, pluginCanvasIllustrationId: pluginView.dataset.pluginCanvasIllustrationId };
    if (activeViewId === views.BIOLOGY_NOTEBOOK) {
      return modules?.biologyNotebook?.getAgentChatContext?.() || {
        scopeType: 'notebook'
      };
    }
    if (activeViewId === views.ASSAY) {
      return modules?.assay?.getAgentChatContext?.() || {
        scopeType: 'assay'
      };
    }
    return modules?.papers?.getAgentChatContext?.() || { scopeType: 'paper' };
  };
}

export const agentChatRailManifest = {
  key: 'agentChatRail',
  historyStateKeys: ['paperAgentChatSessions'],
  init: initAgentChat,
  renderHistory: ({ modules }) => modules.agentChatRail.render(),
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    showView,
    views,
    modules,
    rootDocument,
    windowObject
  }) => ({
    idPrefix: 'agent-rail',
    loadPersistentSessions: false,
    state: createScopedAgentChatState(state, {
      getScopeContext: createAgentRailScopeContextGetter(modules, rootDocument, views)
    }),
    persist,
    createId,
    safeText,
    document: rootDocument,
    windowObject,
    onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
    onProtocolsChanged: () => {
      rendererServices.protocol.handleProtocolsChanged();
      modules.protocol?.renderList?.();
    },
    captureImageAttachment: () => (
      modules?.papers?.startPaperScreenshotSelection?.()
      || Promise.resolve({ ok: false, error: 'Open a paper before selecting a screenshot.' })
    ),
    onPlotlyGraphArtifact: (artifact, payload) => {
      const activeViewId = String(rootDocument?.body?.dataset?.activeView || '').trim();
      if (activeViewId !== views.ASSAY) {
        return false;
      }
      return modules?.assay?.renderAgentPlotlyGraph?.(artifact, payload) === true;
    },
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    },
    onAppendNotebookEntry: async (proposal = {}) => {
      showView(views.BIOLOGY_NOTEBOOK);
      return modules.biologyNotebook?.appendAgentNotebookContent?.(proposal)
        || { ok: false, error: 'Notebook is unavailable.' };
    }
  })
};
