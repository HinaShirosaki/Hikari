import { normalizeAgentResponse } from './response.js';
import {
  asArray,
  normalizeAgentUserQuestion,
  TOOL_ACTIVITY_LABELS,
  toConversation,
  trimText
} from './shared.js';
import {
  applyNotebookDraftAutoSave,
  buildNotebookEntryFromDraft,
  findNotebookEntryForDraft,
  normalizeNotebookDraft,
  normalizeNotebookState,
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
  onNotebookEntriesChanged,
  onOpenNotebookEntry = () => {}
}) {
  const api = windowObject?.enanaApi || null;
  const projectSelect = rootDocument?.getElementById?.('agent-project-select') || null;
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
  const conversationShell = historyNode?.closest?.('.agent-conversation-shell') || null;
  const scrollToBottomBtn = rootDocument?.getElementById?.('agent-scroll-to-bottom-btn') || null;
  const input = rootDocument?.getElementById?.('agent-message-input') || null;
  const attachmentInput = rootDocument?.getElementById?.('agent-attachment-input') || null;
  const attachmentList = rootDocument?.getElementById?.('agent-attachment-list') || null;
  const attachBtn = rootDocument?.getElementById?.('agent-attach-btn') || null;
  const deepResearchToggleBtn = rootDocument?.getElementById?.('agent-deep-research-toggle-btn') || null;
  const sendBtn = rootDocument?.getElementById?.('agent-send-btn') || null;
  const stopBtn = rootDocument?.getElementById?.('agent-stop-btn') || null;
  const clearBtn = rootDocument?.getElementById?.('agent-clear-btn') || null;
  const status = rootDocument?.getElementById?.('agent-status') || null;
  let inFlight = false;
  let liveAssistantMessage = null;
  let activeClientRequestId = '';
  let stopRequested = false;
  let stopInProgress = false;
  let composerAttachments = [];

  if (!projectSelect || !historyNode || !input || !sendBtn || !clearBtn || !status) {
    return { render: () => {} };
  }

  function progressBadgeStatus(statusText = '') {
    const normalized = trimText(statusText, 40).toLowerCase();
    if (normalized === 'ok' || normalized === 'completed' || normalized === 'done' || normalized === 'matched') {
      return 'done';
    }
    if (normalized === 'aborted' || normalized === 'stopped' || normalized === 'canceled' || normalized === 'cancelled') {
      return 'aborted';
    }
    if (normalized === 'failed' || normalized === 'error' || normalized === 'no_match') {
      return 'error';
    }
    return 'pending';
  }

  function progressStatusRank(statusText = '') {
    const normalized = progressBadgeStatus(statusText);
    if (normalized === 'error') {
      return 4;
    }
    if (normalized === 'aborted') {
      return 3;
    }
    if (normalized === 'done') {
      return 2;
    }
    return 1;
  }

  function humanizeToken(value) {
    const text = trimText(value, 120);
    if (!text) {
      return '';
    }
    return text
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getToolActivityLabel(toolName = '') {
    const normalized = trimText(toolName, 120);
    return TOOL_ACTIVITY_LABELS[normalized] || humanizeToken(normalized) || 'Running tool';
  }

  function sanitizeAttachmentName(fileName = '', fallback = 'attachment') {
    return trimText(String(fileName || '').replace(/\s+/g, ' ').trim(), 180) || fallback;
  }

  function formatAttachmentSize(size) {
    const numeric = Number(size);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return '';
    }
    if (numeric >= 1024 * 1024) {
      return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (numeric >= 1024) {
      return `${Math.round(numeric / 1024)} KB`;
    }
    return `${numeric} B`;
  }

  function buildAttachmentSummary(attachments = []) {
    const items = asArray(attachments).filter((attachment) => trimText(attachment?.name, 180));
    if (!items.length) {
      return '';
    }
    const label = items.length === 1 ? 'attachment' : 'attachments';
    return `Please consider the attached ${label}: ${items.map((attachment) => trimText(attachment.name, 120)).join(', ')}.`;
  }

  function buildMessagePayloadText(messageText, attachments = []) {
    const normalizedMessage = trimText(messageText, 3000);
    const attachmentSummary = buildAttachmentSummary(attachments);
    return trimText([normalizedMessage, attachmentSummary].filter(Boolean).join('\n\n'), 3000)
      || trimText(attachmentSummary, 3000);
  }

  function renderComposerAttachments() {
    if (!attachmentList) {
      return;
    }
    const items = asArray(composerAttachments).filter((attachment) => trimText(attachment?.name, 180));
    if (!items.length) {
      attachmentList.innerHTML = '';
      attachmentList.hidden = true;
      return;
    }
    attachmentList.hidden = false;
    attachmentList.innerHTML = items.map((attachment) => {
      const label = trimText(attachment?.kind, 20) === 'image' ? 'Image' : 'File';
      const size = formatAttachmentSize(attachment?.size);
      return `
        <span class="agent-attachment-pill${label === 'Image' ? ' is-image' : ''}">
          <span>${safeText(label)}</span>
          <span>${safeText(trimText(attachment?.name, 180))}</span>
          ${size ? `<span>${safeText(size)}</span>` : ''}
          <button type="button" data-agent-remove-attachment="${safeText(trimText(attachment?.id, 120))}" aria-label="${safeText(`Remove ${trimText(attachment?.name, 180)}`)}">&times;</button>
        </span>
      `;
    }).join('');
  }

  function resetComposerAttachments() {
    composerAttachments = [];
    if (attachmentInput) {
      attachmentInput.value = '';
    }
    renderComposerAttachments();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file?.name || 'attachment'}.`));
      reader.readAsDataURL(file);
    });
  }

  async function normalizeAttachmentFile(file) {
    const dataUrl = await fileToDataUrl(file);
    const mimeType = trimText(file?.type, 160) || trimText(String(dataUrl).match(/^data:([^;,]+)/i)?.[1], 160);
    return {
      id: createId(),
      name: sanitizeAttachmentName(file?.name, mimeType.startsWith('image/') ? 'image' : 'attachment'),
      mimeType,
      size: Number(file?.size) || 0,
      dataUrl,
      kind: mimeType.startsWith('image/') ? 'image' : 'file'
    };
  }

  async function handleAttachmentSelection(files = []) {
    const incomingFiles = asArray(Array.from(files)).filter(Boolean);
    if (!incomingFiles.length) {
      return;
    }
    try {
      const nextAttachments = await Promise.all(incomingFiles.map((file) => normalizeAttachmentFile(file)));
      composerAttachments = [...composerAttachments, ...nextAttachments].slice(-8);
      renderComposerAttachments();
      setStatus(`${composerAttachments.length} attachment${composerAttachments.length === 1 ? '' : 's'} ready.`);
    } catch (error) {
      setStatus(String(error?.message || error || 'Failed to load attachments.'));
    }
  }

  function getProgressRowKey(eventPayload = {}) {
    const stage = trimText(eventPayload?.stage, 80);
    const toolName = trimText(eventPayload?.tool_name, 120);
    const round = trimText(eventPayload?.meta?.round, 40);
    const step = trimText(eventPayload?.meta?.step, 40);
    if (stage === 'tool_call_started' || stage === 'tool_call_completed' || stage === 'tool_call_failed') {
      return `tool:${toolName}`;
    }
    if (stage === 'science_round_started') {
      return `science-round:${round || '0'}:${toolName}`;
    }
    if (stage === 'science_evaluator_continue' || stage === 'science_evaluator_satisfied') {
      return `science-evaluator:${round || '0'}`;
    }
    if (stage === 'deep_research_step_started' || stage === 'deep_research_step_completed') {
      return `deep-research-step:${step || '0'}`;
    }
    return stage;
  }

  function getProgressRowText(eventPayload = {}) {
    const stage = trimText(eventPayload?.stage, 80);
    const round = trimText(eventPayload?.meta?.round, 40);
    const step = trimText(eventPayload?.meta?.step, 40);
    const stepTitle = trimText(eventPayload?.meta?.title, 160);
    const toolLabel = getToolActivityLabel(eventPayload?.tool_name);
    const stageLabels = {
      request_received: 'Request received',
      request_aborted: 'Request stopped',
      controller_intent_only_selected: 'Preparing parser-first request',
      controller_intent_only: 'Running parser-first controller',
      controller_codex_agent_selected: 'Preparing Codex agent request',
      controller_codex_agent: 'Routing to Codex agent',
      codex_agent_started: 'Codex agent running',
      codex_agent_stream: 'Codex response streaming',
      codex_agent_completed: 'Codex agent completed',
      parser_completed: 'Intent parsed',
      protocol_to_notebook_followup: 'Continuing notebook follow-up',
      protocol_to_notebook_completed: 'Notebook draft status updated',
      purchase_recommendation_started: 'Finding products to buy',
      purchase_recommendation_completed: 'Purchase recommendations updated',
      inventory_lookup_started: 'Checking inventory records',
      inventory_lookup_completed: 'Inventory lookup updated',
      record_lookup_started: 'Checking lab records',
      record_lookup_completed: 'Record lookup updated',
      notebook_draft_started: getToolActivityLabel('notebook-draft'),
      notebook_draft_completed: 'Notebook draft updated',
      science_intent_start: 'Starting reasoning loop',
      science_intent_started: 'Reasoning loop ready',
      science_clarification_started: 'Clarifying the request',
      science_clarification_completed: 'Request clarified',
      science_route_planner_started: 'Drafting route plan',
      science_route_planner_completed: 'Route plan ready',
      science_exit_criteria_started: 'Defining stopping criteria',
      science_exit_criteria_completed: 'Stopping criteria ready',
      science_evaluator_continue: round ? `Round ${round}: More evidence needed` : 'More evidence needed',
      science_evaluator_satisfied: round ? `Round ${round}: Evidence is sufficient` : 'Evidence is sufficient',
      science_budget_exhausted: round ? `Round ${round}: Reasoning budget exhausted` : 'Reasoning budget exhausted',
      science_intent_completed: 'Reasoning completed',
      deep_research_started: 'Starting deep research',
      deep_research_completed: 'Deep research completed',
      response_emitted: 'Final answer ready',
      controller_error: 'Request failed'
    };
    if (stage === 'tool_call_started' || stage === 'tool_call_completed' || stage === 'tool_call_failed') {
      return toolLabel;
    }
    if (stage === 'science_round_started') {
      return round ? `Round ${round}: ${toolLabel}` : toolLabel;
    }
    if (stage === 'deep_research_step_started' || stage === 'deep_research_step_completed') {
      if (step && stepTitle) {
        return `Step ${step}: ${stepTitle}`;
      }
      if (step) {
        return `Step ${step}`;
      }
    }
    return stageLabels[stage] || trimText(eventPayload?.message, 240) || humanizeToken(stage) || 'Working on this';
  }

  function buildLiveProgressSummary(eventPayload = {}) {
    const streamText = extractLiveStreamText(eventPayload);
    if (streamText) {
      return streamText;
    }
    const thinkingTrace = extractLiveThinkingTrace(eventPayload);
    if (thinkingTrace) {
      return thinkingTrace;
    }
    const stage = trimText(eventPayload?.stage, 80);
    const toolName = trimText(eventPayload?.tool_name, 120);
    if (stage === 'tool_call_started') {
      return `${getToolActivityLabel(toolName)}...`;
    }
    if (stage === 'request_aborted') {
      return trimText(eventPayload?.message, 600) || 'Agent request stopped.';
    }
    if (stage === 'tool_call_completed') {
      return trimText(eventPayload?.message, 600) || `${getToolActivityLabel(toolName)} complete.`;
    }
    if (stage === 'tool_call_failed') {
      return trimText(eventPayload?.message, 600) || `${getToolActivityLabel(toolName)} failed.`;
    }
    if (stage === 'deep_research_step_started' || stage === 'deep_research_step_completed') {
      const step = trimText(eventPayload?.meta?.step, 40);
      const title = trimText(eventPayload?.meta?.title, 160);
      if (step && title) {
        return `Step ${step}: ${title}`;
      }
    }
    return trimText(eventPayload?.message, 600) || getProgressRowText(eventPayload) || 'Working on this...';
  }

  function extractLiveStreamText(eventPayload = {}) {
    const meta = eventPayload?.meta && typeof eventPayload.meta === 'object'
      ? eventPayload.meta
      : {};
    return trimText(
      eventPayload?.stream_text
      || eventPayload?.streamText
      || eventPayload?.accumulated_text
      || eventPayload?.accumulatedText
      || meta.stream_text
      || meta.streamText
      || meta.accumulated_text
      || meta.accumulatedText,
      120000
    );
  }

  function extractLiveThinkingTrace(eventPayload = {}) {
    const meta = eventPayload?.meta && typeof eventPayload.meta === 'object'
      ? eventPayload.meta
      : {};
    return trimText(
      eventPayload?.thinking_trace
      || eventPayload?.thinkingTrace
      || eventPayload?.trace_sentence
      || eventPayload?.traceSentence
      || meta.thinking_trace
      || meta.thinkingTrace
      || meta.trace_sentence
      || meta.traceSentence,
      420
    );
  }

  function upsertLiveProgressRows(rows = [], eventPayload = {}) {
    const nextRows = asArray(rows).map((row) => ({ ...row }));
    const key = getProgressRowKey(eventPayload);
    const nextStatus = progressBadgeStatus(eventPayload?.status);
    const nextText = getProgressRowText(eventPayload);
    if (!key || !nextText) {
      return nextRows;
    }
    const existingIndex = nextRows.findIndex((row) => trimText(row?.key, 160) === key);
    if (existingIndex === -1) {
      nextRows.push({
        key,
        status: nextStatus,
        text: nextText
      });
      return nextRows.slice(-12);
    }
    const existingRow = nextRows[existingIndex];
    nextRows[existingIndex] = {
      ...existingRow,
      status: progressStatusRank(nextStatus) >= progressStatusRank(existingRow?.status)
        ? nextStatus
        : existingRow?.status,
      text: nextText || existingRow?.text
    };
    return nextRows.slice(-12);
  }

  function upsertLiveThinkingRows(rows = [], eventPayload = {}) {
    const nextRows = asArray(rows).map((row) => ({ ...row }));
    const text = extractLiveThinkingTrace(eventPayload);
    if (!text) {
      return nextRows;
    }
    const stage = trimText(eventPayload?.stage, 80);
    const toolName = trimText(eventPayload?.tool_name, 120);
    const round = trimText(eventPayload?.meta?.round, 40);
    const key = [stage, round, toolName, text.toLowerCase()].filter(Boolean).join(':') || text.toLowerCase();
    if (nextRows.some((row) => trimText(row?.key, 620) === key)) {
      return nextRows.slice(-12);
    }
    nextRows.push({ key, text });
    return nextRows.slice(-12);
  }

  function buildLiveAssistantPlaceholder(clientRequestId, requestText) {
    return {
      id: `live-${trimText(clientRequestId, 120) || createId()}`,
      role: 'assistant',
      text: 'Working on this...',
      createdAt: new Date().toISOString(),
      meta: {
        live_progress: {
          client_request_id: trimText(clientRequestId, 120),
          request_text: trimText(requestText, 3000),
          activity_rows: [
            {
              key: 'request_received',
              status: 'pending',
              text: 'Request received'
            }
          ],
          thinking_rows: [],
          stage: 'request_received',
          status: 'started',
          message: 'Working on this...'
        }
      }
    };
  }

  function clearLiveAssistantState() {
    liveAssistantMessage = null;
    activeClientRequestId = '';
  }

  function createLocalStopError(message = 'Agent request stopped.') {
    const error = new Error(message);
    error.code = 'AGENT_STOP_REQUESTED';
    return error;
  }

  function isLocalStopError(error) {
    return error?.code === 'AGENT_STOP_REQUESTED';
  }

  function buildStoppedAssistantMessage(requestText, message = 'Agent request stopped.') {
    return {
      id: createId(),
      role: 'assistant',
      text: 'Agent stopped.',
      createdAt: new Date().toISOString(),
      meta: {
        cancellation: {
          stopped: true,
          message: trimText(message, 600) || 'Agent request stopped.'
        },
        requestText: trimText(requestText, 3000)
      }
    };
  }

  function appendStoppedAssistantMessage(requestText, message = 'Agent request stopped.') {
    clearLiveAssistantState();
    state.agentChat.messages.push(buildStoppedAssistantMessage(requestText, message));
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    sessionManager.renderSessionList();
    renderHistoryView({ forceScroll: true });
  }

  function applyLiveProgressEvent(eventPayload = {}) {
    if (!liveAssistantMessage) {
      return;
    }
    const currentMeta = liveAssistantMessage.meta?.live_progress || {};
    const activityRows = upsertLiveProgressRows(currentMeta.activity_rows, eventPayload);
    const thinkingRows = upsertLiveThinkingRows(currentMeta.thinking_rows, eventPayload);
    const streamText = extractLiveStreamText(eventPayload) || currentMeta.stream_text || '';
    const summaryText = streamText || buildLiveProgressSummary(eventPayload);
    liveAssistantMessage = {
      ...liveAssistantMessage,
      text: summaryText,
      meta: {
        ...liveAssistantMessage.meta,
        live_progress: {
          ...currentMeta,
          client_request_id: trimText(eventPayload?.client_request_id, 120) || currentMeta.client_request_id,
          request_id: trimText(eventPayload?.request_id, 120) || currentMeta.request_id,
          chat_session_id: trimText(eventPayload?.chat_session_id, 120) || currentMeta.chat_session_id,
          routing_intent: trimText(eventPayload?.routing_intent, 120) || currentMeta.routing_intent,
          stage: trimText(eventPayload?.stage, 80) || currentMeta.stage,
          status: trimText(eventPayload?.status, 40) || currentMeta.status,
          message: summaryText,
          stream_text: streamText,
          meta: eventPayload?.meta && typeof eventPayload.meta === 'object' ? eventPayload.meta : currentMeta.meta,
          activity_rows: activityRows,
          thinking_rows: thinkingRows,
          updated_at: trimText(eventPayload?.timestamp, 80) || new Date().toISOString()
        }
      }
    };
  }

  function cloneLiveThinkingRows(source) {
    return asArray(source).map((row) => ({
      key: trimText(row?.key, 620),
      text: trimText(row?.text || row, 420)
    })).filter((row) => row.text);
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
    const normalized = trimText(text, 160).toLowerCase();
    let tone = 'neutral';
    if (!normalized || normalized === 'ready.') {
      tone = 'ready';
    } else if (
      normalized.includes('error')
      || normalized.includes('failed')
      || normalized.includes('unavailable')
    ) {
      tone = 'error';
    } else if (
      normalized.includes('complete')
      || normalized.includes('opened')
      || normalized.includes('loaded')
      || normalized.includes('created')
      || normalized.includes('enabled')
      || normalized.includes('disabled')
    ) {
      tone = 'complete';
    } else if (
      normalized.includes('working')
      || normalized.includes('loading')
      || normalized.includes('running')
      || normalized.includes('stopping')
    ) {
      tone = 'working';
    }
    status.dataset.state = tone;
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

  function isHistoryNearBottom() {
    const remaining = historyNode.scrollHeight - historyNode.scrollTop - historyNode.clientHeight;
    return remaining < 96;
  }

  function updateScrollToBottomButton() {
    if (!scrollToBottomBtn) {
      return;
    }
    scrollToBottomBtn.hidden = isHistoryNearBottom();
  }

  function scrollHistoryToBottom(smooth = false) {
    if (typeof historyNode.scrollTo === 'function') {
      historyNode.scrollTo({
        top: historyNode.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    } else {
      historyNode.scrollTop = historyNode.scrollHeight;
    }
    updateScrollToBottomButton();
  }

  function syncComposerHeight() {
    input.style.height = 'auto';
    const nextHeight = Math.min(Math.max(input.scrollHeight, 92), 220);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > 220 ? 'auto' : 'hidden';
  }

  function renderHistoryView(options = {}) {
    ensureAgentState();
    const visibleMessages = liveAssistantMessage
      ? [...state.agentChat.messages, liveAssistantMessage]
      : state.agentChat.messages;
    const hasMessages = asArray(visibleMessages).length > 0;
    conversationShell?.classList?.toggle('is-empty-chat', !hasMessages);
    if (!hasMessages && scrollToBottomBtn) {
      scrollToBottomBtn.hidden = true;
    }
    const previousScrollTop = historyNode.scrollTop;
    const shouldStickToBottom = options.forceScroll === true
      || historyNode.childElementCount === 0
      || isHistoryNearBottom();
    renderingModule.renderHistory({
      historyNode,
      messages: visibleMessages,
      state,
      safeText
    });
    if (shouldStickToBottom) {
      scrollHistoryToBottom(options.smoothScroll === true);
      return;
    }
    historyNode.scrollTop = previousScrollTop;
    updateScrollToBottomButton();
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
    deepResearchToggleBtn.dataset.enabled = state.agentChat.deepResearchEnabled === true ? 'true' : 'false';
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
    // Context summary UI has been removed from the agent rail.
  }

  function findChatMessageById(messageId = '') {
    const targetId = trimText(messageId, 120);
    if (!targetId) {
      return null;
    }
    return asArray(state.agentChat.messages).find((item) => trimText(item?.id, 120) === targetId) || null;
  }

  function getAssistantUserQuestion(message) {
    const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
    return normalizeAgentUserQuestion(
      meta.user_question
        || meta.userQuestion
        || meta.codex_agent?.user_question
        || meta.codex_agent?.userQuestion,
      message?.text
    );
  }

  function markAssistantQuestionAnswered(messageId, answerText) {
    const message = findChatMessageById(messageId);
    const question = getAssistantUserQuestion(message);
    if (!message || !question) {
      return null;
    }
    const answeredQuestion = {
      ...question,
      status: 'answered',
      answered: {
        answer: trimText(answerText, 1000),
        answered_at: new Date().toISOString()
      }
    };
    message.meta = {
      ...(message.meta && typeof message.meta === 'object' ? message.meta : {}),
      user_question: answeredQuestion
    };
    if (message.meta.codex_agent && typeof message.meta.codex_agent === 'object') {
      message.meta.codex_agent = {
        ...message.meta.codex_agent,
        user_question: answeredQuestion
      };
    }
    return answeredQuestion;
  }

  async function answerAssistantQuestion(messageId, answerText) {
    if (inFlight) {
      return;
    }
    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }
    const answer = trimText(answerText, 3000);
    if (!answer) {
      setStatus('Add an answer first.');
      return;
    }
    const question = markAssistantQuestionAnswered(messageId, answer);
    if (!question) {
      setStatus('Question is unavailable.');
      return;
    }
    persist();
    renderHistoryView({ forceScroll: true });
    input.value = answer;
    syncComposerHeight();
    await sendMessage();
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
    setSessionStatus,
    isInteractionLocked: () => inFlight
  });

  function updateInFlightState(nextInFlight) {
    inFlight = nextInFlight;
    if (!inFlight) {
      stopRequested = false;
      stopInProgress = false;
    }
    sendBtn.disabled = inFlight;
    if (stopBtn) {
      stopBtn.hidden = !inFlight;
      stopBtn.disabled = !inFlight || stopInProgress;
      stopBtn.textContent = stopInProgress ? 'Stopping...' : 'Stop';
    }
    if (newChatBtn) {
      newChatBtn.disabled = inFlight;
    }
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
    sessionManager.renderSessionList();
  }

  async function buildSyncedStateSnapshot(projectId) {
    let syncResult = null;
    const storagePath = trimText(state.settings?.storagePath, 1200);
    if (api?.autoSaveDataFile && storagePath) {
      syncResult = await api.autoSaveDataFile(state, '');
      if (!syncResult?.ok) {
        throw new Error(syncResult?.error || 'Failed to sync data before agent request.');
      }
    }
    const stateSnapshot = buildStateSnapshot(state, projectId);
    if (!stateSnapshot.data_file_path) {
      stateSnapshot.data_file_path = trimText(syncResult?.filePath, 1600);
    }
    return stateSnapshot;
  }

  async function onHistoryClick(event) {
    const suggestedPromptButton = event?.target?.closest?.('[data-agent-suggest-prompt]')
      || (event?.target?.dataset?.agentSuggestPrompt ? event.target : null);
    if (suggestedPromptButton) {
      const prompt = trimText(suggestedPromptButton.dataset.agentSuggestPrompt, 3000);
      if (!prompt) {
        return;
      }
      input.value = prompt;
      syncComposerHeight();
      input.focus();
      setStatus('Prompt ready.');
      return;
    }

    const questionOptionButton = event?.target?.closest?.('[data-agent-question-option]')
      || (event?.target?.dataset?.agentQuestionOption ? event.target : null);
    if (questionOptionButton) {
      const messageId = trimText(questionOptionButton.dataset.agentQuestionOption, 120);
      const answer = trimText(questionOptionButton.dataset.agentQuestionAnswer, 3000)
        || trimText(questionOptionButton.textContent, 3000);
      await answerAssistantQuestion(messageId, answer);
      return;
    }

    const questionSubmitButton = event?.target?.closest?.('[data-agent-question-submit]')
      || (event?.target?.dataset?.agentQuestionSubmit ? event.target : null);
    if (questionSubmitButton) {
      const messageId = trimText(questionSubmitButton.dataset.agentQuestionSubmit, 120);
      const card = questionSubmitButton.closest?.('[data-agent-user-question-card]');
      const answerInput = card?.querySelector?.('[data-agent-question-custom-input]');
      const answer = trimText(answerInput?.value, 3000);
      await answerAssistantQuestion(messageId, answer);
      return;
    }

    const externalButton = event?.target?.closest?.('[data-agent-open-external-url]')
      || (event?.target?.dataset?.agentOpenExternalUrl ? event.target : null);
    if (externalButton) {
      const url = trimText(externalButton.dataset.agentOpenExternalUrl, 2000);
      if (!url) {
        return;
      }
      if (!api?.openExternalUrl) {
        setStatus('External link opening is unavailable in this build.');
        return;
      }
      const result = await api.openExternalUrl(url);
      setStatus(result?.ok === true ? 'Opened product page.' : (trimText(result?.error, 320) || 'Failed to open product page.'));
      return;
    }

    const openNotebookButton = event?.target?.closest?.('[data-agent-open-notebook-page]')
      || (event?.target?.dataset?.agentOpenNotebookPage ? event.target : null);
    if (openNotebookButton) {
      const messageId = trimText(openNotebookButton.dataset.agentOpenNotebookPage, 120);
      if (!messageId) {
        return;
      }
      const message = asArray(state.agentChat.messages).find((item) => trimText(item?.id, 120) === messageId);
      const draft = normalizeNotebookDraft(message?.meta?.notebookDraft);
      const existingEntry = findNotebookEntryForDraft(state.notebookEntries, draft);
      if (!draft || !existingEntry) {
        setStatus('Notebook page is unavailable for opening.');
        return;
      }
      try {
        onOpenNotebookEntry(existingEntry.id);
      } catch {
        // Preserve chat responsiveness even if notebook navigation fails.
      }
      setStatus(
        normalizeNotebookState(existingEntry?.notebookState) === 'planned'
          ? 'Opened planned notebook page.'
          : 'Opened notebook page.'
      );
      return;
    }

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
    const existingEntry = findNotebookEntryForDraft(state.notebookEntries, draft);
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
      renderHistoryView({ forceScroll: true });
      try {
        onOpenNotebookEntry(existingEntry.id);
      } catch {
        // Preserve chat responsiveness even if notebook navigation fails.
      }
      setStatus('Opened planned notebook page.');
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
    renderHistoryView({ forceScroll: true });
    try {
      onNotebookEntriesChanged?.();
    } catch {
      // Keep chat actions resilient even if downstream render hooks fail.
    }
    try {
      onOpenNotebookEntry(entry.id);
    } catch {
      // Keep chat actions resilient even if notebook navigation fails.
    }
    setStatus('Planned notebook page created.');
  }

  async function sendMessage() {
    if (inFlight) {
      return;
    }

    const rawMessageText = trimText(input.value, 3000);
    const attachments = asArray(composerAttachments).map((attachment) => ({ ...attachment }));
    const messageText = buildMessagePayloadText(rawMessageText, attachments);
    if (!messageText && !attachments.length) {
      return;
    }

    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }

    ensureAgentState();
    stopRequested = false;
    stopInProgress = false;

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    const currentSessionId = await sessionManager.ensureCurrentChatSession(messageText);
    const userMessage = {
      id: createId(),
      role: 'user',
      text: rawMessageText || buildAttachmentSummary(attachments),
      attachments,
      createdAt: new Date().toISOString()
    };

    state.agentChat.messages.push(userMessage);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    input.value = '';
    resetComposerAttachments();
    syncComposerHeight();
    renderHistoryView({ forceScroll: true });

    const clientRequestId = `agent-request-${trimText(createId(), 120) || Date.now().toString(36)}`;
    activeClientRequestId = clientRequestId;
    liveAssistantMessage = buildLiveAssistantPlaceholder(clientRequestId, messageText);
    renderHistoryView({ forceScroll: true });
    updateInFlightState(true);
    setStatus('Working on this...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      if (stopRequested) {
        throw createLocalStopError('Agent request stopped before thinking began.');
      }

      const result = await api.agentChat({
        clientRequestId,
        message: messageText,
        attachments,
        chatSessionId: currentSessionId,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot,
        llm: {
          provider: String(state.settings?.llm?.provider || '').trim(),
          model: String(state.settings?.llm?.model || '').trim(),
          reasoningEffort: String(state.settings?.llm?.reasoningEffort || '').trim().toLowerCase(),
          apiEndpoint: String(state.settings?.llm?.provider || '').trim() === 'codex'
            ? ''
            : String(state.settings?.llm?.apiEndpoint || '').trim(),
          apiKey: String(state.settings?.llm?.provider || '').trim() === 'codex'
            ? ''
            : String(state.settings?.llm?.apiKey || '').trim()
        },
        agent: {
          developerMode: state.settings?.agent?.developerMode === true,
          deepResearchEnabled: state.agentChat.deepResearchEnabled === true
        }
      });

      if (!result?.ok) {
        if (result?.canceled === true) {
          appendStoppedAssistantMessage(messageText, result?.error || 'Agent request stopped.');
          setStatus('Stopped.');
          return;
        }
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
      const persistedThinkingRows = cloneLiveThinkingRows(liveAssistantMessage?.meta?.live_progress?.thinking_rows);
      if (notebookDraft?.save?.applied === true) {
        renderContextSummary();
      }

      clearLiveAssistantState();
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: response.assistantText,
        createdAt: new Date().toISOString(),
        meta: {
          parser: response.parser,
          protocol_to_notebook: response.protocolWorkflow,
          notebook_draft: response.notebookDraftWorkflow,
          codex_agent: response.codexAgent,
          user_question: response.userQuestion,
          purchase_recommendation: response.purchaseRecommendation,
          inventory_lookup: response.inventoryLookup,
          record_lookup: response.recordLookup,
          general_science_question: response.generalScienceQuestion,
          project_science_question: response.projectScienceQuestion,
          result_analysis: response.resultAnalysis,
          thinking_trace: response.thinkingTrace,
          notebookDraft: notebookDraft || null,
          developer_trace: response.developerTrace,
          thinking_trace_rows: persistedThinkingRows,
          requestText: messageText
        }
      });

      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      sessionManager.renderSessionList();
      renderHistoryView({ forceScroll: true });
      if (state.agentChat.currentSessionId) {
        void sessionManager.refreshPersistentSessions({ force: true, loadCurrent: false });
      }
      setStatus('Complete.');
    } catch (error) {
      if (isLocalStopError(error)) {
        appendStoppedAssistantMessage(messageText, error?.message || 'Agent request stopped.');
        setStatus('Stopped.');
        return;
      }
      const persistedThinkingRows = cloneLiveThinkingRows(liveAssistantMessage?.meta?.live_progress?.thinking_rows);
      clearLiveAssistantState();
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: `Agent failed: ${String(error?.message || error)}`,
        createdAt: new Date().toISOString(),
        meta: {
          parser: {
            primary_intent: 'unclear',
            reasoning_effort: 0,
            direct_answer: null,
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
          purchase_recommendation: null,
          inventory_lookup: null,
          record_lookup: null,
          general_science_question: null,
          project_science_question: null,
          result_analysis: null,
          thinking_trace: null,
          notebookDraft: null,
          developer_trace: [],
          thinking_trace_rows: persistedThinkingRows,
          requestText: messageText
        }
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      sessionManager.renderSessionList();
      renderHistoryView({ forceScroll: true });
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function stopMessage() {
    if (!inFlight) {
      return;
    }
    stopRequested = true;
    stopInProgress = true;
    if (stopBtn) {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';
    }
    setStatus('Stopping...');
    if (!api?.agentChatCancel || !activeClientRequestId) {
      return;
    }
    try {
      await api.agentChatCancel({
        clientRequestId: activeClientRequestId
      });
    } catch {
      // The active request will still unwind locally once the current step completes.
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
    renderHistoryView({ forceScroll: true });

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

  stopBtn?.addEventListener('click', () => {
    void stopMessage();
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
    input.value = '';
    resetComposerAttachments();
    syncComposerHeight();
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
    input.value = '';
    resetComposerAttachments();
    syncComposerHeight();
    void sessionManager.startNewChatSession();
  });

  historyNode.addEventListener('click', (event) => {
    void onHistoryClick(event);
  });

  historyNode.addEventListener('scroll', () => {
    updateScrollToBottomButton();
  });

  scrollToBottomBtn?.addEventListener('click', () => {
    scrollHistoryToBottom(true);
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

  input.addEventListener('input', () => {
    syncComposerHeight();
  });

  attachBtn?.addEventListener('click', () => {
    attachmentInput?.click();
  });

  attachmentInput?.addEventListener('change', (event) => {
    void handleAttachmentSelection(event?.target?.files || []);
  });

  attachmentList?.addEventListener('click', (event) => {
    const removeButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-agent-remove-attachment]')
      : null;
    const attachmentId = trimText(removeButton?.getAttribute?.('data-agent-remove-attachment'), 120);
    if (!attachmentId) {
      return;
    }
    composerAttachments = composerAttachments.filter((attachment) => trimText(attachment?.id, 120) !== attachmentId);
    renderComposerAttachments();
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
    syncComposerHeight();
    renderComposerAttachments();
    renderHistoryView();
    if (!inFlight) {
      setStatus('Ready.');
    }
  }

  api?.onAgentProgress?.((payload) => {
    const clientRequestId = trimText(payload?.client_request_id, 120);
    if (!clientRequestId || clientRequestId !== activeClientRequestId || !liveAssistantMessage) {
      return;
    }
    applyLiveProgressEvent(payload);
    renderHistoryView();
    setStatus(trimText(liveAssistantMessage?.text, 320) || 'Working on this...');
  });

  return {
    render
  };
}
