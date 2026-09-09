import { asArray, trimText } from './shared.js';
import { buildMessagePayloadText } from './composer-attachments.js';

export function createAgentPayloadBuilder({
  state,
  input,
  getComposerAttachments,
  ensureAgentState,
  onHiddenDraftContextsChanged = () => {}
}) {
  let hiddenDraftContexts = [];

  function getPrimedHiddenContexts() {
    return hiddenDraftContexts.map((context) => ({ ...context }));
  }

  function notifyHiddenDraftContextsChanged() {
    onHiddenDraftContextsChanged(getPrimedHiddenContexts());
  }

  function getHiddenContextTextLimit(source = {}) {
    const kind = trimText(source.kind || 'selection', 80);
    return kind === 'assay-page' || kind === 'assay' || kind === 'notebook-page' || trimText(source.assayId, 220)
      ? 40000
      : 4000;
  }

  function normalizeHiddenContext(context = {}) {
    const source = context && typeof context === 'object' ? context : {};
    const text = trimText(source.text, getHiddenContextTextLimit(source));
    if (!text) {
      return null;
    }
    return {
      kind: trimText(source.kind || 'selection', 80),
      label: trimText(source.label || 'Hidden context', 120),
      text,
      paperId: trimText(source.paperId, 220),
      paperTitle: trimText(source.paperTitle, 320),
      pageNumber: Number.isFinite(Number(source.pageNumber))
        ? Math.max(1, Math.round(Number(source.pageNumber)))
        : 0,
      notebookEntryId: trimText(source.notebookEntryId, 220),
      notebookUpdatedAt: trimText(source.notebookUpdatedAt, 80),
      projectName: trimText(source.projectName, 220),
      protocolName: trimText(source.protocolName, 220),
      assayId: trimText(source.assayId, 220),
      assayName: trimText(source.assayName, 320)
    };
  }

  function getScopedAutomaticHiddenContexts() {
    const context = state.agentChatContext && typeof state.agentChatContext === 'object'
      ? state.agentChatContext
      : {};
    const hiddenContexts = asArray(context.hiddenContexts || context.hidden_contexts)
      .map(normalizeHiddenContext)
      .filter(Boolean);
    const singleHiddenContext = normalizeHiddenContext(context.hiddenContext || context.hidden_context);
    if (singleHiddenContext) {
      hiddenContexts.unshift(singleHiddenContext);
    }
    return hiddenContexts.slice(0, 3);
  }

  function getHiddenDraftContexts() {
    return [
      ...getScopedAutomaticHiddenContexts(),
      ...hiddenDraftContexts.map((context) => ({ ...context }))
    ].slice(0, 3);
  }

  function primeHiddenContext(context = {}) {
    const normalized = normalizeHiddenContext(context);
    if (!normalized) {
      return false;
    }
    hiddenDraftContexts = [normalized];
    notifyHiddenDraftContextsChanged();
    return true;
  }

  function consumeHiddenContexts() {
    if (!hiddenDraftContexts.length) {
      return;
    }
    hiddenDraftContexts = [];
    notifyHiddenDraftContextsChanged();
  }

  function getCurrentProjectDetails() {
    ensureAgentState();
    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    return { projectId, projectName };
  }

  function buildAgentLlmPayload() {
    const provider = String(state.settings?.llm?.provider || '').trim();
    return {
      provider,
      model: String(state.settings?.llm?.model || '').trim(),
      reasoningEffort: String(state.settings?.llm?.reasoningEffort || '').trim().toLowerCase(),
      apiEndpoint: provider === 'codex'
        ? ''
        : String(state.settings?.llm?.apiEndpoint || '').trim(),
      apiKey: provider === 'codex'
        ? ''
        : String(state.settings?.llm?.apiKey || '').trim()
    };
  }

  function buildAgentFlagsPayload(options = {}) {
    const agentContext = state.agentChatContext && typeof state.agentChatContext === 'object'
      ? state.agentChatContext
      : {};
    const sessionPrompt = trimText(agentContext.sessionPrompt, 6000);
    const hiddenContexts = asArray(options.hiddenContexts).map(normalizeHiddenContext).filter(Boolean);
    const isPaperSession = trimText(agentContext.scopeType, 80) === 'paper';
    return {
      externalSkillsEnabled: state.settings?.agent?.externalSkillsEnabled !== false,
      disabledExternalSkillNames: asArray(state.settings?.agent?.disabledExternalSkillNames)
        .map((item) => trimText(item, 160))
        .filter(Boolean),
      disabledMcpToolNames: asArray(state.settings?.agent?.disabledMcpToolNames)
        .map((item) => trimText(item, 160))
        .filter(Boolean),
      ...(hiddenContexts.length ? { hiddenContexts } : {}),
      ...(sessionPrompt ? { sessionPrompt } : {}),
      ...(sessionPrompt && isPaperSession ? {
        paperSessionPrompt: sessionPrompt,
        paperSession: {
          paperId: trimText(agentContext.paperId, 220),
          paperTitle: trimText(agentContext.paperTitle, 320),
          transformedMarkdownRelativePath: trimText(agentContext.knowledgeMarkdownRelativePath, 2400),
          knowledgeStatus: trimText(agentContext.knowledgeStatus, 80)
        }
      } : {})
    };
  }

  function getDraftRequest() {
    const rawMessageText = trimText(input.value, 3000);
    const attachments = getComposerAttachments();
    const messageText = buildMessagePayloadText(rawMessageText, attachments);
    return {
      rawMessageText,
      attachments,
      messageText,
      hiddenContexts: getHiddenDraftContexts()
    };
  }

  return {
    buildAgentFlagsPayload,
    buildAgentLlmPayload,
    consumeHiddenContexts,
    getCurrentProjectDetails,
    getDraftRequest,
    getPrimedHiddenContexts,
    primeHiddenContext
  };
}
