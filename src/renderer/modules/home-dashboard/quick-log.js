import { ensureDashboardState, quickLogId } from './utils.js';

// Quick-log + dashboard quick actions widget. Persists a free-text bench
// note draft as the user types, lets them either save it locally or hand
// it off to the assistant agent, and wires the four "open X view" quick
// action buttons that live next to the log card.
export function initQuickLogWidget({
  state,
  persist,
  createId,
  safeText,
  render,
  onOpenSamples,
  onOpenNotebook,
  onOpenWorkflow,
  onOpenAssistant,
  onSendQuickLogToAgent,
  elements
}) {
  const {
    quickLogInput,
    quickLogStatus,
    quickLogSaveBtn,
    quickLogAgentBtn,
    quickLogRecentList,
    quickActionButtons
  } = elements;

  quickLogInput.addEventListener('input', onQuickLogInput);
  quickLogInput.addEventListener('keydown', onQuickLogKeydown);
  quickLogSaveBtn.addEventListener('click', onQuickLogSave);
  quickLogAgentBtn.addEventListener('click', onQuickLogSendToAgent);
  quickActionButtons.forEach((button) => {
    button.addEventListener('click', onQuickActionClick);
  });

  function syncQuickLogInput() {
    const draft = String(state.settings.dashboard.quickLogDraft || '');
    if (quickLogInput.value !== draft) {
      quickLogInput.value = draft;
    }
  }

  function setQuickLogStatus(message) {
    quickLogStatus.textContent = String(message || '').trim();
  }

  function formatQuickLogTimestamp(timestamp) {
    const parsed = new Date(String(timestamp || '').trim());
    if (Number.isNaN(parsed.getTime())) {
      return 'Recent';
    }
    return parsed.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function renderRecentQuickLogs() {
    const entries = Array.isArray(state.settings?.dashboard?.quickLogEntries)
      ? state.settings.dashboard.quickLogEntries
      : [];
    const recentEntries = entries.slice(-3).reverse();
    if (!recentEntries.length) {
      quickLogRecentList.innerHTML = '<p class="home-quick-log-empty">Recent quick logs will appear here.</p>';
      return;
    }
    quickLogRecentList.innerHTML = recentEntries.map((entry) => `
      <article class="home-quick-log-recent-row">
        <time class="home-quick-log-recent-time">${safeText(formatQuickLogTimestamp(entry?.createdAt || entry?.updatedAt))}</time>
        <p class="home-quick-log-recent-text">${safeText(entry?.text || '')}</p>
      </article>
    `).join('');
  }

  function renderQuickLogWidget() {
    syncQuickLogInput();
    renderRecentQuickLogs();
    const hasDraft = Boolean(String(state.settings.dashboard.quickLogDraft || '').trim());
    quickLogSaveBtn.disabled = !hasDraft;
    quickLogAgentBtn.disabled = !hasDraft;
    if (hasDraft) {
      setQuickLogStatus('Draft saved locally.');
      return;
    }
    setQuickLogStatus('');
  }

  function onQuickLogInput() {
    ensureDashboardState(state);
    state.settings.dashboard.quickLogDraft = quickLogInput.value;
    persist();
    const hasDraft = Boolean(quickLogInput.value.trim());
    quickLogSaveBtn.disabled = !hasDraft;
    quickLogAgentBtn.disabled = !hasDraft;
    if (hasDraft) {
      setQuickLogStatus('Draft saved locally.');
      return;
    }
    setQuickLogStatus('');
  }

  function onQuickLogKeydown(event) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    onQuickLogSendToAgent();
  }

  function commitQuickLog(value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) {
      return null;
    }
    ensureDashboardState(state);
    const nowIso = new Date().toISOString();
    const entry = {
      id: quickLogId(createId),
      text: cleanValue,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.settings.dashboard.quickLogEntries.push(entry);
    if (state.settings.dashboard.quickLogEntries.length > 500) {
      state.settings.dashboard.quickLogEntries = state.settings.dashboard.quickLogEntries.slice(-500);
    }
    state.settings.dashboard.quickLogDraft = '';
    quickLogInput.value = '';
    quickLogSaveBtn.disabled = true;
    quickLogAgentBtn.disabled = true;
    persist();
    return entry;
  }

  function onQuickLogSave() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setQuickLogStatus('Add a bench note before saving it.');
      return;
    }
    const entry = commitQuickLog(value);
    if (!entry) {
      return;
    }
    render();
    setQuickLogStatus('Logged.');
  }

  function onQuickLogSendToAgent() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setQuickLogStatus('Add a bench note before sending it to the Assistant.');
      return;
    }
    const entry = commitQuickLog(value);
    if (!entry) {
      return;
    }
    const sent = onSendQuickLogToAgent(value);
    render();
    if (sent === false) {
      setQuickLogStatus('Logged locally. Assistant handoff unavailable.');
      return;
    }
    setQuickLogStatus('Logged and sent to Assistant.');
  }

  function runDashboardAction(action) {
    const normalized = String(action || '').trim().toLowerCase();
    if (!normalized) {
      return;
    }
    if (normalized === 'samples') {
      onOpenSamples();
      return;
    }
    if (normalized === 'workflow') {
      onOpenWorkflow();
      return;
    }
    if (normalized === 'notebook') {
      onOpenNotebook();
      return;
    }
    if (normalized === 'assistant') {
      onOpenAssistant();
    }
  }

  function onQuickActionClick(event) {
    const button = event.currentTarget;
    runDashboardAction(button?.dataset?.dashboardAction);
  }

  return {
    render: renderQuickLogWidget,
    handleEscape: () => false
  };
}
