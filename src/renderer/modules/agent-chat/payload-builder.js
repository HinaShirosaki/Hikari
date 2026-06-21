import { buildStateSnapshot } from './state-snapshot.js';
import { asArray, toConversation, trimText } from './shared.js';
import { buildMessagePayloadText } from './composer-attachments.js';

export function createAgentPayloadBuilder({
  state,
  input,
  getComposerAttachments,
  ensureAgentState
}) {
  let hiddenDraftContexts = [];

  function normalizeHiddenContext(context = {}) {
    const source = context && typeof context === 'object' ? context : {};
    const text = trimText(source.text, 4000);
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
        : 0
    };
  }

  function getHiddenDraftContexts() {
    return hiddenDraftContexts.map((context) => ({ ...context }));
  }

  function primeHiddenContext(context = {}) {
    const normalized = normalizeHiddenContext(context);
    if (!normalized) {
      return false;
    }
    hiddenDraftContexts = [normalized];
    return true;
  }

  function consumeHiddenContexts() {
    hiddenDraftContexts = [];
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

  function summarizeAgentLlmPayload(llmPayload = {}) {
    return {
      provider: trimText(llmPayload.provider, 80),
      model: trimText(llmPayload.model, 120),
      reasoningEffort: trimText(llmPayload.reasoningEffort, 40),
      apiEndpoint: trimText(llmPayload.apiEndpoint, 2000),
      apiKey: trimText(llmPayload.apiKey, 400) ? '[set]' : ''
    };
  }

  function buildAgentFlagsPayload(options = {}) {
    const paperContext = state.agentChatContext && typeof state.agentChatContext === 'object'
      ? state.agentChatContext
      : {};
    const paperSessionPrompt = trimText(paperContext.sessionPrompt, 2400);
    const hiddenContexts = asArray(options.hiddenContexts).map(normalizeHiddenContext).filter(Boolean);
    return {
      developerMode: state.settings?.agent?.developerMode === true,
      externalSkillsEnabled: state.settings?.agent?.externalSkillsEnabled !== false,
      disabledExternalSkillNames: asArray(state.settings?.agent?.disabledExternalSkillNames)
        .map((item) => trimText(item, 160))
        .filter(Boolean),
      ...(hiddenContexts.length ? { hiddenContexts } : {}),
      ...(paperSessionPrompt ? {
        paperSessionPrompt,
        paperSession: {
          paperId: trimText(paperContext.paperId, 220),
          paperTitle: trimText(paperContext.paperTitle, 320),
          transformedMarkdownRelativePath: trimText(paperContext.knowledgeMarkdownRelativePath, 2400),
          knowledgeStatus: trimText(paperContext.knowledgeStatus, 80)
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

  function buildDeveloperContextPreviewPayload(stateSnapshot) {
    ensureAgentState();
    const { attachments, messageText, hiddenContexts } = getDraftRequest();
    const { projectId, projectName } = getCurrentProjectDetails();
    const llm = buildAgentLlmPayload();
    return {
      message: messageText,
      attachments,
      projectId,
      projectName,
      conversation: toConversation(state.agentChat.messages),
      stateSnapshot,
      llm,
      agent: buildAgentFlagsPayload({ hiddenContexts })
    };
  }

  function buildLocalDeveloperContextPreview() {
    const { projectId } = getCurrentProjectDetails();
    const stateSnapshot = buildStateSnapshot(state, projectId);
    const payload = buildDeveloperContextPreviewPayload(stateSnapshot);
    return {
      ok: true,
      local: true,
      updated_at: new Date().toISOString(),
      preview: {
        provider: trimText(payload.llm.provider, 80),
        model: trimText(payload.llm.model, 120),
        project: {
          id: trimText(payload.projectId, 120),
          name: trimText(payload.projectName, 220)
        },
        request: {
          message: payload.message,
          conversation: payload.conversation,
          attachments: asArray(payload.attachments).map((attachment) => ({
            id: trimText(attachment?.id, 120),
            name: trimText(attachment?.name, 240),
            mime_type: trimText(attachment?.mimeType || attachment?.mime_type, 160),
            kind: trimText(attachment?.kind, 40),
            size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : 0
          }))
        },
        prompt: {
          kind: 'renderer_request_envelope',
          system_prompt: 'Refresh Context to render the backend prompt for the selected provider.'
        },
        llm: summarizeAgentLlmPayload(payload.llm),
        agent: payload.agent,
        state_snapshot: payload.stateSnapshot
      }
    };
  }

  return {
    buildAgentFlagsPayload,
    buildAgentLlmPayload,
    buildDeveloperContextPreviewPayload,
    buildLocalDeveloperContextPreview,
    consumeHiddenContexts,
    getCurrentProjectDetails,
    getDraftRequest,
    primeHiddenContext,
    summarizeAgentLlmPayload
  };
}
