import {
  ensureDashboardState,
  formatTimerTemplateDuration,
  normalizeActiveTimerRecord,
  normalizeIncubationLocationValue,
  normalizeTimerTemplateRecord
} from './utils.js';

// Timer + clock widget. Owns a running local clock plus reusable named
// countdowns: a dialog manages a list of timer templates the bench user
// can launch with one click; running timers tick down in the active list
// and flip into an alert state when complete.
export function initTimerWidget({
  state,
  persist,
  safeText,
  render,
  elements
}) {
  const {
    localTimeDisplay,
    localDateDisplay,
    timerStatus,
    timerActiveList,
    timerOpenBtn,
    timerDialogOverlay,
    timerDialogForm,
    timerNameInput,
    timerMinutesInput,
    timerTemplateList
  } = elements;

  let timerTickHandle = 0;
  let localClockHandle = 0;

  timerOpenBtn.addEventListener('click', openTimerDialog);
  timerDialogOverlay.addEventListener('click', onTimerDialogOverlayClick);
  timerDialogForm.addEventListener('submit', onTimerDialogSubmit);
  timerTemplateList.addEventListener('click', onTimerTemplateListClick);
  timerActiveList.addEventListener('click', onTimerActiveListClick);

  renderLocalClock();
  localClockHandle = window.setInterval(renderLocalClock, 1000);

  function openTimerDialog() {
    renderTimerTemplateRows();
    timerDialogForm.reset();
    timerDialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      timerNameInput.focus();
    });
  }

  function closeTimerDialog() {
    timerDialogForm.reset();
    timerDialogOverlay.hidden = true;
  }

  function onTimerDialogOverlayClick(event) {
    if (event.target !== timerDialogOverlay) {
      return;
    }
    closeTimerDialog();
  }

  function onTimerDialogSubmit(event) {
    event.preventDefault();
    ensureDashboardState(state);
    if (!timerDialogForm.reportValidity()) {
      return;
    }
    const name = normalizeIncubationLocationValue(timerNameInput.value);
    const durationMinutes = Math.round(Number(timerMinutesInput.value));
    if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return;
    }
    const duplicate = state.settings.dashboard.timerTemplates.some((template) => (
      normalizeIncubationLocationValue(template?.name).toLowerCase() === name.toLowerCase()
      && Math.round(Number(template?.durationMinutes)) === durationMinutes
    ));
    if (duplicate) {
      timerNameInput.focus();
      timerNameInput.select();
      return;
    }
    state.settings.dashboard.timerTemplates.push({
      name,
      durationMinutes
    });
    persist();
    renderTimerTemplateRows();
    timerDialogForm.reset();
    timerNameInput.focus();
  }

  function startTimerFromTemplate(template) {
    const normalized = normalizeTimerTemplateRecord(template);
    if (!normalized) {
      return;
    }
    const now = Date.now();
    state.settings.dashboard.activeTimers.push({
      name: normalized.name,
      durationMinutes: normalized.durationMinutes,
      startedAtMs: now,
      endAtMs: now + (normalized.durationMinutes * 60 * 1000)
    });
    persist();
    closeTimerDialog();
    render();
  }

  function onTimerTemplateListClick(event) {
    const button = event.target.closest('[data-dashboard-start-timer-template]');
    if (!button) {
      return;
    }
    const index = Number(button.dataset.dashboardStartTimerTemplate);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    startTimerFromTemplate(state.settings.dashboard.timerTemplates[index]);
  }

  function onTimerActiveListClick(event) {
    const button = event.target.closest('[data-dashboard-remove-active-timer]');
    if (!button) {
      return;
    }
    const index = Number(button.dataset.dashboardRemoveActiveTimer);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    state.settings.dashboard.activeTimers.splice(index, 1);
    persist();
    render();
  }

  function renderTimerTemplateRows() {
    const templates = Array.isArray(state.settings?.dashboard?.timerTemplates)
      ? state.settings.dashboard.timerTemplates
      : [];
    if (!templates.length) {
      timerTemplateList.innerHTML = '<p class="small-note">Add a named timer to start it from this card.</p>';
      return;
    }
    timerTemplateList.innerHTML = templates.map((template, index) => `
      <div class="home-timer-template-row">
        <div class="home-timer-template-copy">
          <strong class="home-timer-template-name">${safeText(template.name)}</strong>
          <p class="home-timer-template-duration">${safeText(formatTimerTemplateDuration(template.durationMinutes))}</p>
        </div>
        <div class="home-timer-template-actions">
          <button
            type="button"
            class="home-timer-template-start-btn"
            data-dashboard-start-timer-template="${index}"
            aria-label="Start timer ${safeText(template.name)}"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
              <path d="M8 6.5 18 12 8 17.5Z" fill="currentColor"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  function formatTimer(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderLocalClock() {
    const now = new Date();
    localTimeDisplay.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    localDateDisplay.textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatTimerEndTime(timestampMs) {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function stopTimerTick() {
    if (!timerTickHandle) {
      return;
    }
    window.clearInterval(timerTickHandle);
    timerTickHandle = 0;
  }

  function startTimerTick() {
    if (timerTickHandle) {
      return;
    }
    timerTickHandle = window.setInterval(onTimerTick, 250);
  }

  function collectActiveTimers() {
    const now = Date.now();
    return (Array.isArray(state.settings?.dashboard?.activeTimers)
      ? state.settings.dashboard.activeTimers
      : [])
      .map((timer, index) => {
        const normalized = normalizeActiveTimerRecord(timer);
        if (!normalized) {
          return null;
        }
        const remainingMs = Math.max(0, normalized.endAtMs - now);
        const isAlert = remainingMs <= 0;
        return {
          sourceIndex: index,
          name: normalized.name,
          durationMinutes: normalized.durationMinutes,
          remainingMs,
          isAlert,
          detail: isAlert
            ? `${formatTimerTemplateDuration(normalized.durationMinutes)} timer complete`
            : `${formatTimerTemplateDuration(normalized.durationMinutes)} timer | ends ${formatTimerEndTime(normalized.endAtMs)}`,
          endAtMs: normalized.endAtMs
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.isAlert !== right.isAlert) {
          return left.isAlert ? -1 : 1;
        }
        if (left.endAtMs !== right.endAtMs) {
          return left.endAtMs - right.endAtMs;
        }
        return left.name.localeCompare(right.name);
      });
  }

  function renderTimerWidget() {
    const activeTimers = collectActiveTimers();
    const activeCount = activeTimers.filter((timer) => !timer.isAlert).length;
    const finishedCount = activeTimers.length - activeCount;
    if (finishedCount && activeCount) {
      timerStatus.textContent = `${finishedCount} finished | ${activeCount} running`;
    } else if (finishedCount) {
      timerStatus.textContent = `${finishedCount} finished`;
    } else if (activeCount) {
      timerStatus.textContent = `${activeCount} active timer(s)`;
    } else {
      timerStatus.textContent = '';
    }

    if (!activeTimers.length) {
      timerActiveList.innerHTML = '<p class="small-note">No countdown timers running.</p>';
      stopTimerTick();
      return;
    }

    timerActiveList.innerHTML = activeTimers.map((timer) => `
      <article class="dashboard-timer-active-row${timer.isAlert ? ' is-alert' : ''}">
        <div class="dashboard-timer-active-copy">
          <strong class="dashboard-timer-active-title">${safeText(timer.name)}</strong>
          <p class="dashboard-timer-active-detail">${safeText(timer.detail)}</p>
        </div>
        <div class="dashboard-timer-active-side">
          <span class="dashboard-timer-active-value">${safeText(formatTimer(timer.remainingMs))}</span>
          <button
            type="button"
            class="dashboard-timer-remove-btn"
            data-dashboard-remove-active-timer="${timer.sourceIndex}"
            aria-label="Remove timer ${safeText(timer.name)}"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </article>
    `).join('');

    if (activeCount) {
      startTimerTick();
      return;
    }
    stopTimerTick();
  }

  function onTimerTick() {
    renderTimerWidget();
  }

  function renderWidget() {
    if (!localClockHandle) {
      renderLocalClock();
      localClockHandle = window.setInterval(renderLocalClock, 1000);
    }
    renderTimerWidget();
    if (!timerDialogOverlay.hidden) {
      renderTimerTemplateRows();
    }
  }

  function handleEscape() {
    if (timerDialogOverlay.hidden) {
      return false;
    }
    closeTimerDialog();
    return true;
  }

  return {
    render: renderWidget,
    handleEscape
  };
}
