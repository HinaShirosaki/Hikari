import { initPapersManagement } from '../modules/papers/index.js';

function openPaperAgentChatWithSelection({
  modules,
  rootDocument
}, selection = {}) {
  const selectedText = String(selection?.text || '').replace(/\s+/g, ' ').trim();
  if (!selectedText) {
    return false;
  }
  const paperTitle = String(selection?.paperTitle || '').trim();
  modules?.agentChatRail?.primeHiddenContext?.({
    kind: 'paper-selection',
    label: 'Selected paper text',
    text: selectedText,
    paperId: String(selection?.paperId || '').trim(),
    paperTitle,
    pageNumber: Number.isFinite(Number(selection?.pageNumber))
      ? Math.max(1, Math.round(Number(selection.pageNumber)))
      : 0
  });
  const EventCtor = rootDocument?.defaultView?.CustomEvent || globalThis?.CustomEvent;
  if (rootDocument && typeof EventCtor === 'function') {
    rootDocument.dispatchEvent(new EventCtor('hikari:open-agent-chat-rail'));
  }
  modules?.agentChatRail?.focusComposer?.();
  return true;
}

export const papersManifest = {
  key: 'papers',
  historyStateKeys: ['papers', 'paperExperimentLinks', 'journalClubs', 'projects'],
  init: initPapersManagement,
  viewKey: 'PAPERS',
  bootOrder: 110,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices,
    modules,
    rootDocument,
    windowObject
  }) => ({
    state,
    persist,
    createId,
    safeText,
    document: rootDocument,
    window: windowObject,
    onCreateProtocolDraft: rendererServices.protocol.createDraftFromPaper,
    contextActions: rendererServices.contextActions,
    onActivePaperChanged: () => {
      modules?.agentChatRail?.render?.();
    },
    onAskSelectedText: (selection) => openPaperAgentChatWithSelection({
      modules,
      rootDocument
    }, selection)
  }),
  render: ({ modules }) => modules.papers.render()
};
