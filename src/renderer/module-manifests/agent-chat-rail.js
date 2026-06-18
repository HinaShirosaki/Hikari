import { initAgentChat } from '../modules/agent-chat/index.js';
import { createPaperScopedAgentChatState } from '../modules/agent-chat/scoped-state.js';

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
    state: createPaperScopedAgentChatState(state, {
      getPaperContext: createPaperContextGetter(state, modules)
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
    onOpenNotebookEntry: (entryId = '') => {
      showView(views.BIOLOGY_NOTEBOOK);
      modules.biologyNotebook?.openEntry?.(entryId);
    }
  })
};
