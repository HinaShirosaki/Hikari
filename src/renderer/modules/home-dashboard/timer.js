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
      endAtMs: now + (normalized.durationMinutes * 60 * 1000),
      isPaused: false,
      remainingMs: 0
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
    const toggleButton = event.target.closest('[data-dashboard-toggle-active-timer]');
    if (toggleButton) {
      toggleActiveTimer(Number(toggleButton.dataset.dashboardToggleActiveTimer));
      return;
    }
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

  function toggleActiveTimer(index) {
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    const timer = state.settings.dashboard.activeTimers[index];
    const normalized = normalizeActiveTimerRecord(timer);
    if (!normalized) {
      return;
    }
    const now = Date.now();
    if (normalized.isPaused) {
      timer.isPaused = false;
      timer.endAtMs = now + normalized.remainingMs;
      timer.remainingMs = 0;
    } else {
      const remainingMs = Math.max(0, normalized.endAtMs - now);
      if (!remainingMs) {
        return;
      }
      timer.isPaused = true;
      timer.remainingMs = remainingMs;
    }
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
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderLocalClock() {
    const now = new Date();
    const weekday = now.toLocaleDateString([], { weekday: 'short' });
    const month = now.toLocaleDateString([], { month: 'short' });
    localTimeDisplay.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    localDateDisplay.textContent = `Local · ${weekday} ${now.getDate()} ${month}`;
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
    timerTickHandle = window.setInterval(onTimerTick, 1000);
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
        const remainingMs = normalized.isPaused
          ? normalized.remainingMs
          : Math.max(0, normalized.endAtMs - now);
        const isAlert = remainingMs <= 0;
        const totalMs = Math.max(1, normalized.durationMinutes * 60 * 1000);
        const pct = Math.min(100, Math.max(0, (1 - remainingMs / totalMs) * 100));
        const isWarn = !isAlert && remainingMs <= 5 * 60 * 1000; // ponytail: fixed 5-min amber threshold
        return {
          sourceIndex: index,
          name: normalized.name,
          durationMinutes: normalized.durationMinutes,
          remainingMs,
          pct,
          isWarn,
          isAlert,
          isPaused: normalized.isPaused,
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

  function renderTimerRow(timer) {
    const cls = timer.isWarn ? ' is-warn' : '';
    return `
      <div class="home-timer-row">
        <div class="home-timer-copy">
          <div class="home-timer-name">${safeText(timer.name)}</div>
          <div class="home-timer-meta">${timer.durationMinutes} min total${timer.isPaused ? ' · paused' : ''}</div>
          <div class="home-timer-track" aria-hidden="true"><div class="home-timer-fill${cls}" style="width: ${timer.pct.toFixed(1)}%"></div></div>
        </div>
        <button
          type="button"
          class="home-timer-btn"
          data-dashboard-toggle-active-timer="${timer.sourceIndex}"
          aria-label="${timer.isPaused ? 'Resume' : 'Pause'} timer ${safeText(timer.name)}"
        >
          ${timer.isPaused
            ? `<svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                <path d="M7 5l12 7-12 7z" fill="currentColor"></path>
              </svg>`
            : `<svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"></rect>
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"></rect>
              </svg>`}
        </button>
        <span class="home-timer-count${cls}">${safeText(formatTimer(timer.remainingMs))}</span>
      </div>
    `;
  }

  function renderFinishedRow(timer) {
    return `
      <div class="home-row">
        <span class="home-dot" aria-hidden="true"></span>
        <div class="home-row-copy">
          <div class="home-row-name">${safeText(timer.name)}</div>
          <div class="home-row-meta">${timer.durationMinutes} min · complete</div>
        </div>
        <div class="home-row-end">
          <span class="home-row-tag">done</span>
          <button
            type="button"
            class="home-row-action"
            data-dashboard-remove-active-timer="${timer.sourceIndex}"
            aria-label="Dismiss finished timer ${safeText(timer.name)}"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderTimerWidget() {
    const activeTimers = collectActiveTimers();
    const running = activeTimers.filter((timer) => !timer.isAlert);
    const pausedCount = running.filter((timer) => timer.isPaused).length;
    const tickingCount = running.length - pausedCount;
    const finished = activeTimers.filter((timer) => timer.isAlert);
    const soon = running.some((timer) => timer.isWarn);
    if (running.length) {
      const parts = [];
      if (tickingCount) {
        parts.push(`${tickingCount} running`);
      }
      if (pausedCount) {
        parts.push(`${pausedCount} paused`);
      }
      if (soon) {
        parts.push('1 due in < 5 min');
      }
      timerStatus.textContent = parts.join(' · ');
    } else if (finished.length) {
      timerStatus.textContent = `${finished.length} finished`;
    } else {
      timerStatus.textContent = '';
    }

    if (!activeTimers.length) {
      timerActiveList.innerHTML = '<p class="small-note">No countdown timers running.</p>';
      stopTimerTick();
      return;
    }

    const finishedHtml = finished.length
      ? `<div class="home-timer-finished">
          <div class="home-subhead"><span class="home-eyebrow">Finished today</span><span class="home-subhead-count">${finished.length}</span></div>
          ${finished.map(renderFinishedRow).join('')}
        </div>`
      : '';
    timerActiveList.innerHTML = running.map(renderTimerRow).join('') + finishedHtml;

    if (tickingCount) {
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
