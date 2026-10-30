import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("home");
import { homeMessage, homeAttributes, setHomeText, setHomeAttribute } from './localization.js';
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
    panelList,
    addBtn,
    closeBtn,
    dialogOverlay,
    locationList,
    locationForm,
    locationInput
  } = elements;

  addBtn.addEventListener('click', () => openIncubationDialog(true));
  closeBtn.addEventListener('click', closeIncubationDialog);
  list.addEventListener('click', onIncubationListClick);
  panelList.addEventListener('click', onIncubationListClick);
  dialogOverlay.addEventListener('click', onIncubationDialogOverlayClick);
  locationForm.addEventListener('submit', onIncubationLocationSubmit);
  locationList.addEventListener('click', onIncubationLocationListClick);

  function openIncubationDialog(focusForm) {
    renderIncubationLocationRows();
    locationForm.reset();
    dialogOverlay.hidden = false;
    if (!focusForm) {
      return;
    }
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
    i18nUi.setHtml(locationList, locations.map((location, index) => `
      <div class="home-incubation-location-row">
        <span class="home-incubation-location-name">${safeText(location.name)}</span>
        <button
          type="button"
          class="home-incubation-delete-btn"
          data-dashboard-incubation-location-delete="${index}"
          ${homeAttributes({ 'aria-label': 'incubation.deleteLabel', title: 'incubation.delete' }, { name: location.name })}
        >
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>
    `).join(''));
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
        let status = { key: 'incubation.none', tone: 'plain' };
        if (dayDelta === 0) {
          status = { key: 'incubation.today', tone: 'warn' };
        } else if (dayDelta === 1) {
          status = { key: 'reminder.tomorrow', tone: 'neutral' };
        } else if (dayDelta !== null && dayDelta > 1) {
          status = { key: 'reminder.inDays', params: { days: dayDelta }, tone: 'plain' };
        } else if (dayDelta !== null && dayDelta < 0) {
          status = { key: 'reminder.overdue', params: { days: Math.abs(dayDelta) }, tone: 'danger' };
        }
        return {
          sourceIndex: index,
          name: normalized.name,
          reminderDate: normalized.reminderDate,
          dayDelta,
          isDue: dayDelta !== null && dayDelta <= 0,
          status
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
      setHomeText(summary, 'empty');
      summary.hidden = true;
      i18nUi.setHtml(list, '');
      i18nUi.setHtml(panelList, '');
      return;
    }
    const dueCount = locations.filter((location) => location.isDue).length;
    setHomeText(summary, dueCount ? 'reminder.due' : 'reminder.count', { due: dueCount, count: locations.length });
    summary.classList.toggle('is-soon', dueCount > 0);
    setHomeAttribute(summary, 'aria-label', 'incubation.summary', { due: dueCount, count: locations.length });
    summary.hidden = false;
    i18nUi.setHtml(list, locations.map((location) => {
      const isSet = location.dayDelta === 1;
      const name = safeText(location.name);
      return `
      <article class="home-row home-incubation-row">
        <svg class="home-incubation-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        <span class="home-row-name">${name}</span>
        <span class="home-status-pill" data-tone="${location.status.tone}">${homeMessage(location.status.key, location.status.params)}</span>
        <button
          type="button"
          class="home-row-action home-incubation-remind${isSet ? ' is-set' : ''}"
          data-dashboard-incubation-remind="${location.sourceIndex}"
          ${homeAttributes({ 'aria-label': isSet ? 'incubation.setLabel' : 'incubation.remindLabel', title: isSet ? 'incubation.set' : 'reminder.remind' }, { name: location.name })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </button>
      </article>
    `;
    }).join(''));
    i18nUi.setHtml(panelList, list.innerHTML);
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
