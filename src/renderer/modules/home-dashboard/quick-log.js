import { ensureDashboardState, formatDateLocal, quickLogId } from './utils.js';
import { showTransientNotice } from '../../lib/notify.js';
import { isAgentAvailable } from '../../lib/agent-availability.js';

const DRAFT_SAVE_DELAY_MS = 400;

function handoffErrorMessage(result) {
  const reason = String(result?.reason || '').trim();
  if (reason === 'request_error') return 'Notebook preparation failed. Your experiment draft was kept.';
  if (reason === 'busy') {
    return 'Assistant is busy in this chat. Your experiment draft was kept.';
  }
  if (reason === 'composer_not_empty') {
    return 'Assistant already has an unsent draft. Your experiment draft was kept.';
  }
  if (reason === 'too_long') {
    return 'Assistant messages are limited to 3,000 characters. Your experiment draft was kept.';
  }
  if (reason === 'session_error') {
    return 'Assistant could not start a chat. Your experiment draft was kept.';
  }
  return 'Assistant handoff is unavailable. Your experiment draft was kept.';
}

export function initQuickLogWidget({
  state,
  persist,
  createId,
  safeText,
  render,
  onSendQuickLogToAgent,
  scheduleDraftPersist = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancelDraftPersist = (timerId) => globalThis.clearTimeout(timerId),
  elements
}) {
  const {
    quickLogInput,
    quickLogStatus,
    quickLogSaveBtn,
    quickLogAgentBtn,
    quickLogRecent
  } = elements;
  let draftPersistTimer = null;
  let handoffPending = false;

  function setStatus(message, isError = false) {
    const text = String(message || '').trim();
    quickLogStatus.textContent = text;
    quickLogStatus.classList.toggle('is-error', Boolean(isError && text));
  }

  function getEntries() {
    ensureDashboardState(state);
    return state.settings.dashboard.quickLogEntries;
  }

  function entryTime(entry) {
    const stamp = new Date(String(entry?.createdAt || entry?.updatedAt || ''));
    return Number.isNaN(stamp.getTime()) ? null : stamp;
  }

  // Today's last two entries confirm where a save went; older ones stay in storage.
  function renderRecentEntries() {
    const today = formatDateLocal(new Date());
    const recent = getEntries()
      .filter((entry) => {
        const stamp = entryTime(entry);
        return stamp && formatDateLocal(stamp) === today && String(entry?.text || '').trim();
      })
      .slice(-2)
      .reverse();
    quickLogRecent.hidden = !recent.length;
    quickLogRecent.innerHTML = recent.length
      ? `<p class="home-quicklog-recent-label">Saved today</p>${recent.map((entry) => {
        const stamp = entryTime(entry);
        const time = stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        return `<p class="home-quicklog-recent-row"><time datetime="${safeText(stamp.toISOString())}">${safeText(time)}</time><span>${safeText(entry.text)}</span></p>`;
      }).join('')}`
      : '';
  }

  function syncControls() {
    const hasDraft = Boolean(String(state.settings.dashboard.quickLogDraft || '').trim());
    quickLogInput.disabled = handoffPending;
    quickLogSaveBtn.disabled = handoffPending || !hasDraft;
    quickLogAgentBtn.disabled = handoffPending || !hasDraft;
  }

  function persistDraft({ announce = true } = {}) {
    if (draftPersistTimer !== null) {
      cancelDraftPersist(draftPersistTimer);
      draftPersistTimer = null;
    }
    try {
      persist();
      if (announce) {
        setStatus(String(state.settings.dashboard.quickLogDraft || '').trim()
          ? 'Draft saved locally.'
          : '');
      }
      return true;
    } catch (error) {
      console.warn('Experiment log draft could not be saved:', error);
      setStatus('Experiment draft could not be saved.', true);
      return false;
    }
  }

  function scheduleDraftSave() {
    if (draftPersistTimer !== null) {
      cancelDraftPersist(draftPersistTimer);
    }
    draftPersistTimer = scheduleDraftPersist(() => {
      draftPersistTimer = null;
      persistDraft();
    }, DRAFT_SAVE_DELAY_MS);
  }

  function flushPendingDraft(options = {}) {
    return draftPersistTimer === null ? true : persistDraft(options);
  }

  function renderWidget() {
    ensureDashboardState(state);
    const draft = String(state.settings.dashboard.quickLogDraft || '');
    if (quickLogInput.value !== draft) {
      quickLogInput.value = draft;
    }
    syncControls();
    renderRecentEntries();
    if (!handoffPending) {
      setStatus(draftPersistTimer !== null
        ? 'Saving draft…'
        : (draft.trim() ? 'Draft saved locally.' : ''));
    }
  }

  function onInput() {
    ensureDashboardState(state);
    state.settings.dashboard.quickLogDraft = quickLogInput.value;
    syncControls();
    setStatus(quickLogInput.value.trim() ? 'Saving draft…' : '');
    scheduleDraftSave();
  }

  function commit(value) {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) {
      return null;
    }
    const entries = getEntries();
    const previousEntries = [...entries];
    const previousDraft = state.settings.dashboard.quickLogDraft;
    const nowIso = new Date().toISOString();
    const entry = {
      id: quickLogId(createId),
      text: cleanValue,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    if (draftPersistTimer !== null) {
      cancelDraftPersist(draftPersistTimer);
      draftPersistTimer = null;
    }
    entries.push(entry);
    state.settings.dashboard.quickLogDraft = '';
    try {
      persist();
    } catch (error) {
      console.warn('Experiment log could not be saved:', error);
      state.settings.dashboard.quickLogEntries = previousEntries;
      state.settings.dashboard.quickLogDraft = previousDraft;
      quickLogInput.value = previousDraft;
      syncControls();
      setStatus('Experiment could not be saved.', true);
      return null;
    }
    quickLogInput.value = '';
    syncControls();
    return entry;
  }

  function onSave() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setStatus('Add an experiment or observation before saving it.', true);
      return;
    }
    if (!commit(value)) {
      return;
    }
    render();
    setStatus('Logged.');
  }

  async function onSendToAgent() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setStatus('Add an experiment or observation before sending it.', true);
      return;
    }
    if (handoffPending) {
      return;
    }
    handoffPending = true;
    syncControls();
    setStatus('Preparing notebook page…');
    let result;
    try {
      result = await onSendQuickLogToAgent(value);
    } catch (error) {
      console.warn('Experiment log Assistant handoff failed:', error);
      result = { ok: false, reason: 'unavailable' };
    }
    handoffPending = false;
    if (!result?.ok) {
      flushPendingDraft({ announce: false });
      syncControls();
      setStatus(handoffErrorMessage(result), true);
      return;
    }
    if (!commit(value)) {
      showTransientNotice('Sent to Assistant, but the experiment could not be saved locally.', { type: 'error' });
      return;
    }
    render();
    setStatus('Experiment logged. Continue notebook review in the Home conversation.');
  }

  function onKeydown(event) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    // Without Codex the shortcut saves locally, the only action left on screen.
    if (isAgentAvailable(quickLogInput.ownerDocument)) {
      void onSendToAgent();
    } else {
      onSave();
    }
  }

  function onBlur(event) {
    if (event.relatedTarget === quickLogSaveBtn || event.relatedTarget === quickLogAgentBtn) {
      return;
    }
    flushPendingDraft();
  }

  quickLogInput.addEventListener('input', onInput);
  quickLogInput.addEventListener('blur', onBlur);
  quickLogInput.addEventListener('keydown', onKeydown);
  quickLogSaveBtn.addEventListener('click', onSave);
  quickLogAgentBtn.addEventListener('click', () => {
    void onSendToAgent();
  });

  return {
    flushDraft: () => flushPendingDraft({ announce: false }),
    handleEscape: () => false,
    render: renderWidget
  };
}
