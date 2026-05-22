import { normalizeAgentResponse } from './response.js';
import { applyNotebookDraftAutoSave } from './notebook-drafts.js';
import * as developerToolsModule from './developer-tools.js';
import { buildAttachmentSummary } from './composer-attachments.js';
import { buildAssistantResponseMessage } from './assistant-message-meta.js';
import { trimText } from './shared.js';

export function createDeveloperMockResponseController({
  state,
  runtime,
  dom,
  createId,
  persist,
  payloadBuilder,
  attachmentsController,
  sessionManager,
  developerContextController,
  renderContextSummary,
  renderHistoryView,
  setStatus,
  syncComposerHeight,
  updateInFlightState,
  ensureAgentState,
  onNotebookEntriesChanged
}) {
  async function useDeveloperMockResponse() {
    if (runtime.inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to inject a mock LLM response.');
      return;
    }
    const rawResponse = trimText(dom.developerMockResponseInput?.value, 120000);
    if (!rawResponse) {
      setStatus('Type a mock LLM response first.');
      return;
    }

    ensureAgentState();
    updateInFlightState(true);
    setStatus('Injecting developer mock response...');
    const { rawMessageText, attachments, messageText } = payloadBuilder.getDraftRequest();
    const context = runtime.developerContextPreview || payloadBuilder.buildLocalDeveloperContextPreview();
    const contextSummary = developerToolsModule.summarizeDeveloperVisibleContext(context);

    try {
      if (messageText || attachments.length) {
        await sessionManager.ensureCurrentChatSession(messageText);
        state.agentChat.messages.push({
          id: createId(),
          role: 'user',
          text: rawMessageText || buildAttachmentSummary(attachments),
          attachments,
          createdAt: new Date().toISOString()
        });
        state.agentChat.messages = state.agentChat.messages.slice(-40);
        dom.input.value = '';
        attachmentsController.reset();
        developerContextController.invalidate();
        syncComposerHeight();
      }

      const llm = payloadBuilder.buildAgentLlmPayload();
      const mockResult = developerToolsModule.buildDeveloperMockAgentResult({
        rawResponse,
        provider: llm.provider,
        model: llm.model
      });
      const response = normalizeAgentResponse(mockResult);
      const notebookDraft = applyNotebookDraftAutoSave(response.notebookPayload, messageText, {
        state,
        createId,
        onNotebookEntriesChanged
      });
      if (notebookDraft?.save?.applied === true) {
        renderContextSummary();
      }
      const assistantMessage = buildAssistantResponseMessage({
        createId,
        response,
        notebookDraft,
        traceRows: { thinking: [], activity: [], codexCliDisplay: [] },
        messageText
      });
      assistantMessage.meta.developer_mock_response = {
        injected: true,
        parsed_json: mockResult?.developer_mock_meta?.parsed_json === true,
        response_shape: trimText(mockResult?.developer_mock_meta?.response_shape, 80),
        context_summary: contextSummary,
        injected_at: new Date().toISOString()
      };
      state.agentChat.messages.push(assistantMessage);
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      sessionManager.renderSessionList();
      renderHistoryView({ forceScroll: true });
      developerContextController.render();
      setStatus('Developer mock response injected.');
    } catch (error) {
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: `Developer mock response failed: ${String(error?.message || error)}`,
        createdAt: new Date().toISOString(),
        meta: {
          parser: {
            primary_intent: 'developer_mock_response',
            reasoning_effort: 0,
            direct_answer: null,
            needs_clarification: true,
            clarification_reason: 'developer_mock_error',
            entities: {},
            inventory_search: { normalized_query: null, candidate_terms: [], aliases: [], search_mode: null },
            protocol_candidates: [],
            reasoning_summary: `Developer mock response failed: ${String(error?.message || error)}`
          },
          developer_mock_response: {
            injected: false,
            error: String(error?.message || error),
            context_summary: contextSummary,
            injected_at: new Date().toISOString()
          },
          requestText: messageText
        }
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      renderHistoryView({ forceScroll: true });
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  return { useDeveloperMockResponse };
}
