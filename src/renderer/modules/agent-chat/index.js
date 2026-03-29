import { normalizeAgentResponse } from './response.js';
import {
  asArray,
  toConversation,
  trimText
} from './shared.js';
import {
  applyNotebookDraftAutoSave,
  buildNotebookEntryFromDraft,
  findNotebookEntryByProposalId,
  normalizeNotebookDraft,
  resolveNotebookDraftProposalId,
  updateAssistantNotebookDraftMessage
} from './notebook-drafts.js';
import * as renderingModule from './rendering.js';
import { buildStateSnapshot, mapExperimentDataToLlmJson } from './state-snapshot.js';
import { createAgentChatSessionManager } from './session-manager.js';
import * as developerToolsModule from './developer-tools.js';

export { mapExperimentDataToLlmJson };

export function initAgentChat({
  document: rootDocument = globalThis?.document || (typeof document !== 'undefined' ? document : null),
  windowObject = globalThis?.window || (typeof window !== 'undefined' ? window : null),
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged
}) {
  const api = windowObject?.enanaApi || null;
  const projectSelect = rootDocument?.getElementById?.('agent-project-select') || null;
  const contextSummary = rootDocument?.getElementById?.('agent-context-summary') || null;
  const sessionStatus = rootDocument?.getElementById?.('agent-session-status') || null;
  const sessionList = rootDocument?.getElementById?.('agent-session-list') || null;
  const newChatBtn = rootDocument?.getElementById?.('agent-new-chat-btn') || null;
  const developerTools = rootDocument?.getElementById?.('agent-developer-tools') || null;
  const developerTestToolsBtn = rootDocument?.getElementById?.('agent-dev-test-tools-btn') || null;
  const developerToolSelect = rootDocument?.getElementById?.('agent-dev-tool-select') || null;
  const developerToolMessageInput = rootDocument?.getElementById?.('agent-dev-tool-message') || null;
  const developerRunToolBtn = rootDocument?.getElementById?.('agent-dev-run-tool-btn') || null;
  const developerToolHint = rootDocument?.getElementById?.('agent-dev-tool-hint') || null;
  const historyNode = rootDocument?.getElementById?.('agent-chat-history') || null;
  const input = rootDocument?.getElementById?.('agent-message-input') || null;
  const deepResearchToggleBtn = rootDocument?.getElementById?.('agent-deep-research-toggle-btn') || null;
  const sendBtn = rootDocument?.getElementById?.('agent-send-btn') || null;
  const clearBtn = rootDocument?.getElementById?.('agent-clear-btn') || null;
  const status = rootDocument?.getElementById?.('agent-status') || null;
  let inFlight = false;

  if (!projectSelect || !historyNode || !input || !sendBtn || !clearBtn || !status) {
    return { render: () => {} };
  }

  function ensureAgentState() {
    if (!state.agentChat || typeof state.agentChat !== 'object') {
      state.agentChat = { projectId: '', deepResearchEnabled: false, currentSessionId: '', sessions: [], messages: [] };
      return;
    }
    state.agentChat.projectId = String(state.agentChat.projectId || '');
    state.agentChat.deepResearchEnabled = state.agentChat.deepResearchEnabled === true;
    state.agentChat.currentSessionId = String(state.agentChat.currentSessionId || '');
    state.agentChat.sessions = asArray(state.agentChat.sessions);
    state.agentChat.messages = asArray(state.agentChat.messages);
  }

  function setStatus(text) {
    status.textContent = text;
  }

  function setSessionStatus(text) {
    if (!sessionStatus) {
      return;
    }
    sessionStatus.textContent = text;
  }

  function getStoragePath() {
    return trimText(state.settings?.storagePath, 1200);
  }

  function renderHistoryView() {
    ensureAgentState();
    renderingModule.renderHistory({
      historyNode,
      messages: state.agentChat.messages,
      state,
      safeText
    });
  }

  function renderProjectOptions() {
    ensureAgentState();
    const selected = state.agentChat.projectId;
    const options = ['<option value="">All projects</option>'];
    asArray(state.projects).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name || 'Untitled')}</option>`);
    });
    projectSelect.innerHTML = options.join('');
    if (selected && asArray(state.projects).some((project) => project.id === selected)) {
      projectSelect.value = selected;
    } else if (selected) {
      state.agentChat.projectId = '';
      persist();
    }
  }

  function renderDeepResearchToggle() {
    if (!deepResearchToggleBtn) {
      return;
    }
    ensureAgentState();
    deepResearchToggleBtn.textContent = state.agentChat.deepResearchEnabled === true
      ? 'Deep Research: On'
      : 'Deep Research: Off';
  }

  function renderDeveloperToolHint() {
    developerToolsModule.renderDeveloperToolHint({
      developerToolSelect,
      developerToolHint,
      developerToolMessageInput
    });
  }

  function renderDeveloperToolOptions() {
    developerToolsModule.renderDeveloperToolOptions({
      developerToolSelect,
      safeText,
      renderDeveloperToolHint
    });
  }

  function renderContextSummary() {
    const projectId = state.agentChat?.projectId || '';
    const snapshot = buildStateSnapshot(state, projectId);
    const counts = snapshot.context_counts && typeof snapshot.context_counts === 'object'
      ? snapshot.context_counts
      : {};
    const summary = [
      `${Number(counts.projects) || snapshot.projects.length} projects`,
      `${Number(counts.protocols) || snapshot.protocols.length} protocols`,
      `${Number(counts.workflows) || snapshot.workflows.length} workflows`,
      `${Number(counts.notebookEntries) || snapshot.notebookEntries.length} notebook entries`,
      `${Number(counts.assays) || snapshot.assays.length} assays`,
      `${Number(counts.gelAnalyses) || snapshot.gelAnalyses.length} gel analyses`,
      `${Number(counts.papers) || snapshot.papers.length} papers`,
      `${Number(counts.inventory_chemicals) || snapshot.inventory.chemicals.length} chemicals`
    ].join(' | ');
    if (contextSummary) {
      contextSummary.value = summary;
    }
  }

  const sessionManager = createAgentChatSessionManager({
    api,
    state,
    persist,
    safeText,
    sessionList,
    ensureAgentState,
    getStoragePath,
    renderProjectOptions,
    renderContextSummary,
    renderHistory: renderHistoryView,
    setStatus,
    setSessionStatus
  });

  function updateInFlightState(nextInFlight) {
    inFlight = nextInFlight;
    sendBtn.disabled = inFlight;
    if (developerTestToolsBtn) {
      developerTestToolsBtn.disabled = inFlight;
    }
    if (developerRunToolBtn) {
      developerRunToolBtn.disabled = inFlight;
    }
    if (developerToolSelect) {
      developerToolSelect.disabled = inFlight;
    }
    if (developerToolMessageInput) {
      developerToolMessageInput.disabled = inFlight;
    }
    if (deepResearchToggleBtn) {
      deepResearchToggleBtn.disabled = inFlight;
    }
    clearBtn.disabled = inFlight;
    projectSelect.disabled = inFlight;
    input.disabled = inFlight;
  }

  async function buildSyncedStateSnapshot(projectId) {
    let syncResult = null;
    if (api?.autoSaveDataFile) {
      syncResult = await api.autoSaveDataFile(state, state.settings?.enaFilePath || '');
      if (!syncResult?.ok) {
        throw new Error(syncResult?.error || 'Failed to sync data before agent request.');
      }
      if (syncResult?.filePath && state.settings?.enaFilePath !== syncResult.filePath) {
        state.settings.enaFilePath = syncResult.filePath;
      }
    }
    const stateSnapshot = buildStateSnapshot(state, projectId);
    if (!stateSnapshot.data_file_path) {
      stateSnapshot.data_file_path = trimText(syncResult?.filePath || state.settings?.enaFilePath, 1600);
    }
    return stateSnapshot;
  }

  async function onHistoryClick(event) {
    const createButton = event?.target?.closest?.('[data-agent-create-planned-page]')
      || (event?.target?.dataset?.agentCreatePlannedPage ? event.target : null);
    if (!createButton) {
      return;
    }
    const messageId = trimText(createButton.dataset.agentCreatePlannedPage, 120);
    if (!messageId) {
      return;
    }
    const message = asArray(state.agentChat.messages).find((item) => trimText(item?.id, 120) === messageId);
    const draft = normalizeNotebookDraft(message?.meta?.notebookDraft);
    if (!draft || draft.save.mode !== 'confirm_before_save') {
      setStatus('Planned notebook draft is unavailable for creation.');
      return;
    }
    const proposalId = resolveNotebookDraftProposalId(draft);
    const existingEntry = proposalId ? findNotebookEntryByProposalId(state.notebookEntries, proposalId) : null;
    if (existingEntry) {
      updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, (currentDraft) => ({
        ...currentDraft,
        save: {
          ...currentDraft.save,
          applied: true,
          status: 'already_created',
          reason: 'Planned page already exists for this proposal.'
        }
      }));
      persist();
      renderHistoryView();
      setStatus('Planned notebook page already exists.');
      return;
    }

    const entry = buildNotebookEntryFromDraft(draft, trimText(message?.meta?.requestText, 3000), { createId });
    if (!entry.projectId || !entry.protocolId) {
      setStatus('Planned notebook draft is missing a project or protocol binding.');
      return;
    }

    state.notebookEntries = asArray(state.notebookEntries);
    state.notebookEntries.push(entry);
    updateAssistantNotebookDraftMessage(state.agentChat.messages, messageId, (currentDraft) => ({
      ...currentDraft,
      save: {
        ...currentDraft.save,
        applied: true,
        status: 'planned_page_created',
        reason: 'Planned page created from assistant proposal.'
      },
      entry_template: {
        ...currentDraft.entry_template,
        ...entry
      }
    }));
    persist();
    renderContextSummary();
    renderHistoryView();
    try {
      onNotebookEntriesChanged?.();
    } catch {
      // Keep chat actions resilient even if downstream render hooks fail.
    }
    setStatus('Planned notebook page created.');
  }

  async function sendMessage() {
    if (inFlight) {
      return;
    }

    const messageText = trimText(input.value, 3000);
    if (!messageText) {
      return;
    }

    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    const currentSessionId = await sessionManager.ensureCurrentChatSession(messageText);
    const userMessage = {
      id: createId(),
      role: 'user',
      text: messageText,
      createdAt: new Date().toISOString()
    };

    state.agentChat.messages.push(userMessage);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    input.value = '';
    renderHistoryView();

    updateInFlightState(true);
    setStatus('Agent reasoning in progress...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);

      const result = await api.agentChat({
        message: messageText,
        chatSessionId: currentSessionId,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot,
        llm: {
          provider: String(state.settings?.llm?.provider || '').trim(),
          model: String(state.settings?.llm?.model || '').trim(),
          apiEndpoint: String(state.settings?.llm?.apiEndpoint || '').trim(),
          apiKey: String(state.settings?.llm?.apiKey || '').trim()
        },
        agent: {
          developerMode: state.settings?.agent?.developerMode === true,
          deepResearchEnabled: state.agentChat.deepResearchEnabled === true
        }
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Agent request failed.');
      }
      if (result.chat_session && typeof result.chat_session === 'object') {
        const sessionId = trimText(result.chat_session.id || result.chat_session.session_id, 120);
        if (sessionId) {
          state.agentChat.currentSessionId = sessionId;
          sessionManager.upsertSessionSummary(result.chat_session);
        }
      }
      const response = normalizeAgentResponse(result);
      const notebookDraft = applyNotebookDraftAutoSave(response.notebookPayload, messageText, {
        state,
        createId,
        onNotebookEntriesChanged
      });
      if (notebookDraft?.save?.applied === true) {
        renderContextSummary();
      }

      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: response.assistantText,
        createdAt: new Date().toISOString(),
        meta: {
          parser: response.parser,
          protocol_to_notebook: response.protocolWorkflow,
          notebook_draft: response.notebookDraftWorkflow,
          inventory_lookup: response.inventoryLookup,
          record_lookup: response.recordLookup,
          general_science_question: response.generalScienceQuestion,
          project_science_question: response.projectScienceQuestion,
          result_analysis: response.resultAnalysis,
          notebookDraft: notebookDraft || null,
          developer_trace: response.developerTrace,
          requestText: messageText
        }
      });

      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      sessionManager.renderSessionList();
      renderHistoryView();
      if (state.agentChat.currentSessionId) {
        void sessionManager.refreshPersistentSessions({ force: true });
      }
      setStatus('Complete.');
    } catch (error) {
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: `Agent failed: ${String(error?.message || error)}`,
        createdAt: new Date().toISOString(),
        meta: {
          parser: {
            primary_intent: 'unclear',
            needs_clarification: true,
            clarification_reason: 'agent_error',
            entities: {},
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: [],
            reasoning_summary: `Agent failed: ${String(error?.message || error)}`
          },
          protocol_to_notebook: null,
          notebook_draft: null,
          inventory_lookup: null,
          record_lookup: null,
          general_science_question: null,
          project_science_question: null,
          result_analysis: null,
          notebookDraft: null,
          developer_trace: [],
          requestText: messageText
        }
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      sessionManager.renderSessionList();
      renderHistoryView();
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function runDeveloperSingleToolTest() {
    if (inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool tests.');
      return;
    }
    if (!api?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const toolName = trimText(developerToolSelect?.value, 120);
    const requestMessage = trimText(developerToolMessageInput?.value, 3000);
    if (!toolName) {
      setStatus('Select a tool to test.');
      return;
    }
    if (!requestMessage) {
      setStatus('Add a manual test message for the selected tool.');
      return;
    }

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    state.agentChat.messages.push({
      id: createId(),
      role: 'user',
      text: `Tool test (${toolName})\n${requestMessage}`,
      createdAt: new Date().toISOString()
    });
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    renderHistoryView();

    updateInFlightState(true);
    setStatus(`Running manual test for ${toolName}...`);

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await api.agentDeveloperTestTools({
        toolName,
        message: requestMessage,
        projectId,
        projectName,
        stateSnapshot,
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || `Manual tool test failed for ${toolName}.`);
      }

      developerToolsModule.appendToolTestAssistantMessage(
        { state, createId, persist, renderHistory: renderHistoryView },
        result,
        `Manual tool test completed for ${toolName}.`,
        requestMessage
      );
      setStatus(result?.ok === true
        ? `Manual tool test complete for ${toolName}.`
        : `Manual tool test completed with failures for ${toolName}.`);
    } catch (error) {
      developerToolsModule.appendToolTestAssistantMessage(
        { state, createId, persist, renderHistory: renderHistoryView },
        {
          ok: false,
          run_mode: 'single',
          tool_name: toolName,
          request_message: requestMessage,
          status: 'error',
          tool_count: 1,
          passed_count: 0,
          failed_count: 1,
          summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
          items: [
            {
              tool_name: toolName,
              ok: false,
              status: 'error',
              request_message: requestMessage,
              result_message: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
              summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
              error: String(error?.message || error),
              preview: '',
              duration_ms: 0,
              raw_result: {}
            }
          ]
        },
        `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
        requestMessage
      );
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function runDeveloperToolSmokeTest() {
    if (inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool smoke tests.');
      return;
    }
    if (!api?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    updateInFlightState(true);
    setStatus('Running manual tool smoke tests...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await api.agentDeveloperTestTools({
        projectId,
        projectName,
        stateSnapshot,
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || 'Manual tool smoke test failed.');
      }

      developerToolsModule.appendToolTestAssistantMessage(
        { state, createId, persist, renderHistory: renderHistoryView },
        result,
        'Manual tool smoke test completed.'
      );
      setStatus(result?.ok === true ? 'Manual tool smoke test complete.' : 'Manual tool smoke test completed with failures.');
    } catch (error) {
      developerToolsModule.appendToolTestAssistantMessage(
        { state, createId, persist, renderHistory: renderHistoryView },
        {
          ok: false,
          run_mode: 'all',
          status: 'error',
          tool_count: 0,
          passed_count: 0,
          failed_count: 0,
          summary: `Manual tool smoke test failed: ${String(error?.message || error)}`,
          items: []
        },
        `Manual tool smoke test failed: ${String(error?.message || error)}`
      );
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  projectSelect.addEventListener('change', () => {
    ensureAgentState();
    state.agentChat.projectId = projectSelect.value || '';
    persist();
    render();
  });

  sendBtn.addEventListener('click', () => {
    void sendMessage();
  });

  developerTestToolsBtn?.addEventListener('click', () => {
    void runDeveloperToolSmokeTest();
  });

  developerRunToolBtn?.addEventListener('click', () => {
    void runDeveloperSingleToolTest();
  });

  developerToolSelect?.addEventListener('change', () => {
    renderDeveloperToolHint();
  });

  newChatBtn?.addEventListener('click', () => {
    void sessionManager.startNewChatSession();
  });

  deepResearchToggleBtn?.addEventListener('click', () => {
    ensureAgentState();
    state.agentChat.deepResearchEnabled = !(state.agentChat.deepResearchEnabled === true);
    persist();
    renderDeepResearchToggle();
    setStatus(state.agentChat.deepResearchEnabled === true
      ? 'Deep research enabled.'
      : 'Deep research disabled.');
  });

  clearBtn.addEventListener('click', () => {
    void sessionManager.startNewChatSession();
  });

  historyNode.addEventListener('click', (event) => {
    void onHistoryClick(event);
  });

  sessionList?.addEventListener('click', (event) => {
    const sessionCard = sessionManager.findSessionCard(event?.target);
    const sessionId = trimText(sessionCard?.dataset?.sessionId, 120);
    if (!sessionId || inFlight) {
      return;
    }
    void sessionManager.loadChatSession(sessionId);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void sendMessage();
  });

  function render() {
    ensureAgentState();
    renderProjectOptions();
    renderDeepResearchToggle();
    renderDeveloperToolOptions();
    renderContextSummary();
    sessionManager.renderSessionList();
    void sessionManager.refreshPersistentSessions();
    if (developerTools) {
      developerTools.hidden = !(state.settings?.agent?.developerMode === true && api?.agentDeveloperTestTools);
    }
    renderHistoryView();
    if (!inFlight) {
      setStatus('Ready.');
    }
  }

  return {
    render
  };
}
