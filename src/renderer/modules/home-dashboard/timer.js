import {
  ensureDashboardState,
  formatTimerTemplateDuration,
  normalizeActiveTimerRecord,
  normalizeIncubationLocationValue,
  normalizeTimerTemplateRecord,
  parseTimerDuration
} from './utils.js';
import { renderActiveTimer, renderFinishedTimer, updateActiveTimer } from './timer-rendering.js';

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
    timerDialogCloseBtn,
    timerDialogForm,
    timerNameInput,
    timerMinutesInput,
    timerTemplateList
  } = elements;

  let timerTickHandle = 0;
  let localClockHandle = 0;
  let lastTimerStructure = '';

  timerOpenBtn.addEventListener('click', openTimerDialog);
  timerDialogCloseBtn.addEventListener('click', closeTimerDialog);
  timerDialogOverlay.addEventListener('click', onTimerDialogOverlayClick);
  timerDialogForm.addEventListener('submit', onTimerDialogSubmit);
  timerMinutesInput.addEventListener('input', () => timerMinutesInput.setCustomValidity(''));
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
    timerOpenBtn.focus();
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
    const durationMinutes = parseTimerDuration(timerMinutesInput.value);
    timerMinutesInput.setCustomValidity(durationMinutes
      ? ''
      : 'Enter a duration such as "90 min", "1.5 h", or "1 h 30 min".');
    if (!timerDialogForm.reportValidity()) {
      return;
    }
    const name = normalizeIncubationLocationValue(timerNameInput.value);
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
      timerTemplateList.innerHTML = '';
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
            title="Start timer"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
              <path d="M8 6.5 18 12 8 17.5Z" fill="currentColor"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderLocalClock() {
    const now = new Date();
    const weekday = now.toLocaleDateString([], { weekday: 'short' });
    const month = now.toLocaleDateString([], { month: 'short' });
    localTimeDisplay.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    localDateDisplay.textContent = `Local · ${weekday} ${now.getDate()} ${month}`;
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
          endAtMs: normalized.endAtMs
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.isAlert !== right.isAlert) {
          return left.isAlert ? -1 : 1;
        }
        if (left.isPaused !== right.isPaused) {
          return left.isPaused ? 1 : -1;
        }
        if (left.endAtMs !== right.endAtMs) {
          return left.endAtMs - right.endAtMs;
        }
        return left.name.localeCompare(right.name);
      });
  }

  function renderTimerWidget() {
    const activeTimers = collectActiveTimers();
    const running = activeTimers.filter((timer) => !timer.isAlert);
    const tickingCount = running.filter((timer) => !timer.isPaused).length;
    const finished = activeTimers.filter((timer) => timer.isAlert);
    timerStatus.textContent = activeTimers.length ? String(activeTimers.length) : '';
    timerStatus.hidden = !activeTimers.length;
    timerStatus.setAttribute('aria-label', `${tickingCount} running, ${running.length - tickingCount} paused, ${finished.length} finished`);

    const structure = JSON.stringify(activeTimers.map((timer) => [
      timer.sourceIndex, timer.name, timer.durationMinutes, timer.isPaused, timer.isAlert, timer.endAtMs
    ]));
    if (structure !== lastTimerStructure) {
      const focusedIndex = timerActiveList.ownerDocument?.activeElement?.dataset?.dashboardToggleActiveTimer;
      const finishedHtml = finished.length
        ? `<div class="home-timer-finished">${finished.map((timer) => renderFinishedTimer(timer, safeText)).join('')}</div>`
        : '';
      timerActiveList.innerHTML = finishedHtml + running.map((timer, index) => renderActiveTimer(timer, index, safeText)).join('');
      lastTimerStructure = structure;
      if (focusedIndex !== undefined) {
        timerActiveList.querySelector(`[data-dashboard-toggle-active-timer="${Number(focusedIndex)}"], [data-dashboard-remove-active-timer="${Number(focusedIndex)}"]`)?.focus();
      }
    }
    running.forEach((timer) => {
      const row = timerActiveList.querySelector(`[data-dashboard-timer-index="${timer.sourceIndex}"]`);
      if (row) {
        updateActiveTimer(row, timer);
      }
    });
    if (tickingCount) {
      startTimerTick();
    } else {
      stopTimerTick();
    }
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
