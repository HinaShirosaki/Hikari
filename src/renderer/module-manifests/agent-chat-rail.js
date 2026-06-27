import { initAgentChat } from '../modules/agent-chat/index.js';
import { createScopedAgentChatState } from '../modules/agent-chat/scoped-state.js';

function createPaperContextGetter(state, modules) {
  return () => {
    const paperId = String(modules?.papers?.getActivePaperId?.() || '').trim();
    const paper = paperId
      ? (state.papers || []).find((item) => String(item?.id || '').trim() === paperId)
      : null;
    const projectId = paper?.linkedType === 'project'
      ? String(paper?.linkedId || '').trim()
      : '';
    return {
      paperId,
      paperTitle: String(paper?.title || paper?.fileName || '').trim(),
      projectId,
      knowledgeMarkdownRelativePath: String(paper?.knowledgeMarkdownRelativePath || paper?.knowledge_markdown_relative_path || '').trim(),
      knowledgeExtractedTextRelativePath: String(paper?.knowledgeExtractedTextRelativePath || paper?.knowledge_extracted_text_relative_path || '').trim(),
      knowledgeMetaRelativePath: String(paper?.knowledgeMetaRelativePath || paper?.knowledge_meta_relative_path || '').trim(),
      knowledgeStatus: String(paper?.knowledgeStatus || paper?.knowledge_status || '').trim()
    };
  };
}

function createAgentRailScopeContextGetter(state, modules, rootDocument, views = {}) {
  const getPaperContext = createPaperContextGetter(state, modules);
  return () => {
    const activeViewId = String(rootDocument?.body?.dataset?.activeView || '').trim();
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
    return {
      ...getPaperContext(),
      scopeType: 'paper'
    };
  };
}

export const agentChatRailManifest = {
  key: 'agentChatRail',
  init: initAgentChat,
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
      getScopeContext: createAgentRailScopeContextGetter(state, modules, rootDocument, views)
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
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    }
  })
};
