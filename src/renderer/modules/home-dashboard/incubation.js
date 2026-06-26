import {
  ensureDashboardState,
  formatDateLocal,
  normalizeIncubationLocationRecord,
  normalizeIncubationLocationValue,
  parseLocalDate
} from './utils.js';

// Overnight incubation locations widget — tracks named incubators with an
// optional reminder date. The dialog manages the saved location list, while
// the main row list lets the bench user mark a reminder for tomorrow.
export function initIncubationWidget({
  state,
  persist,
  safeText,
  render,
  elements
}) {
  const {
    summary,
    list,
    addBtn,
    dialogOverlay,
    locationList,
    locationForm,
    locationInput
  } = elements;

  addBtn.addEventListener('click', openIncubationDialog);
  list.addEventListener('click', onIncubationListClick);
  dialogOverlay.addEventListener('click', onIncubationDialogOverlayClick);
  locationForm.addEventListener('submit', onIncubationLocationSubmit);
  locationList.addEventListener('click', onIncubationLocationListClick);

  function openIncubationDialog() {
    renderIncubationLocationRows();
    locationForm.reset();
    dialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      locationInput.focus();
    });
  }

  function closeIncubationDialog() {
    locationForm.reset();
    dialogOverlay.hidden = true;
  }

  function onIncubationDialogOverlayClick(event) {
    if (event.target !== dialogOverlay) {
      return;
    }
    closeIncubationDialog();
  }

  function onIncubationLocationSubmit(event) {
    event.preventDefault();
    ensureDashboardState(state);
    const value = normalizeIncubationLocationValue(locationInput.value);
    if (!value) {
      return;
    }
    const existing = state.settings.dashboard.incubationLocations
      .some((item) => normalizeIncubationLocationValue(item?.name).toLowerCase() === value.toLowerCase());
    if (existing) {
      locationInput.focus();
      locationInput.select();
      return;
    }
    state.settings.dashboard.incubationLocations.push({
      name: value,
      reminderDate: ''
    });
    persist();
    render();
    locationForm.reset();
    locationInput.focus();
  }

  function onIncubationLocationListClick(event) {
    const button = event.target.closest('[data-dashboard-incubation-location-delete]');
    if (!button) {
      return;
    }
    const index = Number(button.dataset.dashboardIncubationLocationDelete);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    state.settings.dashboard.incubationLocations.splice(index, 1);
    persist();
    render();
  }

  function onIncubationListClick(event) {
    const button = event.target.closest('[data-dashboard-incubation-remind]');
    if (!button) {
      return;
    }
    const index = Number(button.dataset.dashboardIncubationRemind);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    const location = normalizeIncubationLocationRecord(state.settings.dashboard.incubationLocations[index]);
    if (!location) {
      return;
    }
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    location.reminderDate = formatDateLocal(tomorrow);
    state.settings.dashboard.incubationLocations[index] = location;
    persist();
    render();
  }

  function renderIncubationLocationRows() {
    const locations = Array.isArray(state.settings?.dashboard?.incubationLocations)
      ? state.settings.dashboard.incubationLocations
      : [];
    locationList.innerHTML = locations.map((location, index) => `
      <div class="home-incubation-location-row">
        <span class="home-incubation-location-name">${safeText(location.name)}</span>
        <button
          type="button"
          class="home-incubation-delete-btn"
          data-dashboard-incubation-location-delete="${index}"
          aria-label="Delete incubation location ${safeText(location.name)}"
        >
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="currentColor"></circle>
            <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
    `).join('');
  }

  function collectIncubationLocations() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (Array.isArray(state.settings?.dashboard?.incubationLocations)
      ? state.settings.dashboard.incubationLocations
      : [])
      .map((location, index) => {
        const normalized = normalizeIncubationLocationRecord(location);
        if (!normalized) {
          return null;
        }
        const reminder = parseLocalDate(normalized.reminderDate);
        const dayDelta = reminder
          ? Math.round((reminder.getTime() - today.getTime()) / 86400000)
          : null;
        let detail = 'No reminder set.';
        if (dayDelta === 0) {
          detail = 'Reminder today.';
        } else if (dayDelta === 1) {
          detail = 'Reminder tomorrow.';
        } else if (dayDelta !== null && dayDelta > 1) {
          detail = `Reminder in ${dayDelta} day(s).`;
        } else if (dayDelta !== null && dayDelta < 0) {
          detail = `Reminder overdue by ${Math.abs(dayDelta)} day(s).`;
        }
        return {
          sourceIndex: index,
          name: normalized.name,
          reminderDate: normalized.reminderDate,
          dayDelta,
          isDue: dayDelta !== null && dayDelta <= 0,
          detail
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = left.dayDelta === null ? 2 : left.dayDelta <= 0 ? 0 : 1;
        const rightRank = right.dayDelta === null ? 2 : right.dayDelta <= 0 ? 0 : 1;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        if (left.dayDelta !== right.dayDelta) {
          return (left.dayDelta ?? Number.MAX_SAFE_INTEGER) - (right.dayDelta ?? Number.MAX_SAFE_INTEGER);
        }
        return left.name.localeCompare(right.name);
      });
  }

  function renderIncubationWidget(locations) {
    if (!locations.length) {
      summary.textContent = 'No incubation locations yet.';
      list.innerHTML = '<p class="small-note">Add an incubation location to track overnight setups here.</p>';
      return;
    }
    const dueCount = locations.filter((location) => location.isDue).length;
    summary.textContent = `${dueCount} due · ${locations.length} location${locations.length === 1 ? '' : 's'}`;
    list.innerHTML = locations.map((location) => `
      <article class="home-row">
        <span class="home-dot${location.isDue ? ' is-warn' : ''}" aria-hidden="true"></span>
        <div class="home-row-copy">
          <div class="home-row-name">${safeText(location.name)}</div>
          <div class="home-row-meta">${safeText(location.detail)}</div>
        </div>
        <div class="home-row-end">
          <button
            type="button"
            class="home-row-action"
            data-dashboard-incubation-remind="${location.sourceIndex}"
            aria-label="Set reminder for tomorrow for ${safeText(location.name)}"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </article>
    `).join('');
  }

  function renderWidget() {
    renderIncubationWidget(collectIncubationLocations());
    if (!dialogOverlay.hidden) {
      renderIncubationLocationRows();
    }
  }

  function handleEscape() {
    if (dialogOverlay.hidden) {
      return false;
    }
    closeIncubationDialog();
    return true;
  }

  return {
    render: renderWidget,
    handleEscape
  };
}
