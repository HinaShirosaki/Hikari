import { buildStateSnapshot } from './state-snapshot.js';
import { asArray, toConversation, trimText } from './shared.js';
import { buildMessagePayloadText } from './composer-attachments.js';

export function createAgentPayloadBuilder({
  state,
  input,
  getComposerAttachments,
  ensureAgentState
}) {
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

  function buildAgentFlagsPayload() {
    return {
      developerMode: state.settings?.agent?.developerMode === true,
      deepResearchEnabled: state.agentChat.deepResearchEnabled === true
    };
  }

  function getDraftRequest() {
    const rawMessageText = trimText(input.value, 3000);
    const attachments = getComposerAttachments();
    const messageText = buildMessagePayloadText(rawMessageText, attachments);
    return { rawMessageText, attachments, messageText };
  }

  function buildDeveloperContextPreviewPayload(stateSnapshot) {
    ensureAgentState();
    const { attachments, messageText } = getDraftRequest();
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
      agent: buildAgentFlagsPayload()
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
    getCurrentProjectDetails,
    getDraftRequest,
    summarizeAgentLlmPayload
  };
}
