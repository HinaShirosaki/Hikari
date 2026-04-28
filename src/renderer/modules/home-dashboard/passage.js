import {
  buildPassageReminderCode,
  ensureSamplesState,
  formatDateLocal,
  formatRelativeDays,
  nextSampleId,
  parseLocalDate,
  sampleLabel
} from './utils.js';

// Cell-passage reminder widget — surfaces overdue and upcoming sub-cultures,
// plus an "add reminder" dialog that registers a cell-line sample on submit.
export function initPassageWidget({
  state,
  persist,
  safeText,
  createId,
  render,
  elements
}) {
  const {
    summary,
    list,
    addBtn,
    dialogOverlay,
    dialogForm,
    strainInput,
    intervalInput,
    numberInput
  } = elements;

  list.addEventListener('click', onPassageListClick);
  addBtn.addEventListener('click', openPassageDialog);
  dialogForm.addEventListener('submit', onPassageDialogSubmit);
  dialogOverlay.addEventListener('click', onPassageDialogOverlayClick);

  function openPassageDialog() {
    dialogForm.reset();
    dialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      strainInput.focus();
    });
  }

  function closePassageDialog() {
    dialogForm.reset();
    dialogOverlay.hidden = true;
  }

  function onPassageDialogOverlayClick(event) {
    if (event.target !== dialogOverlay) {
      return;
    }
    closePassageDialog();
  }

  function onPassageDialogSubmit(event) {
    event.preventDefault();
    if (!dialogForm.reportValidity()) {
      return;
    }

    const strain = String(strainInput.value || '').trim();
    const intervalDays = Math.round(Number(intervalInput.value));
    const passageNumber = Math.round(Number(numberInput.value));
    if (
      !strain
      || !Number.isFinite(intervalDays)
      || intervalDays <= 0
      || !Number.isFinite(passageNumber)
      || passageNumber <= 0
    ) {
      return;
    }

    const now = new Date();
    const today = formatDateLocal(now);
    ensureSamplesState(state);
    state.samples.push({
      id: nextSampleId(createId),
      code: buildPassageReminderCode(state, strain),
      name: strain,
      type: 'cell_line',
      lot: '',
      concentration: '',
      notes: '',
      cellPassage: {
        lastPassageDate: today,
        intervalDays,
        passageNumber
      },
      location: null,
      inventoryLink: null,
      chemicalLinks: [],
      compoundStructure: null,
      updatedAt: now.toISOString()
    });

    persist();
    closePassageDialog();
    render();
  }

  function readPassageNumber(sample) {
    const direct = Math.round(Number(sample?.cellPassage?.passageNumber));
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    const notes = String(sample?.notes || '').trim();
    const match = notes.match(/passage number:\s*p?(\d+)/i) || notes.match(/\bP(\d+)\b/);
    const fallback = Math.round(Number(match?.[1]));
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }

  function renderPassageStatusIcon(status) {
    if (status === 'overdue') {
      return `
        <span class="dashboard-passage-status" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <path d="M12 3 22 20H2Z" fill="#d9544d"></path>
            <path d="M11.1 8.2h1.8l-.2 6.4h-1.4zM12 18a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3Z" fill="#ffffff"></path>
          </svg>
        </span>
      `;
    }
    if (status === 'due_today') {
      return `
        <span class="dashboard-passage-status" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <path d="M11.1 4.2h1.8l-.2 10.1h-1.4zM12 19.1a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z" fill="#c77b00"></path>
          </svg>
        </span>
      `;
    }
    if (status === 'unconfigured') {
      return `
        <span class="dashboard-passage-status" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <circle cx="12" cy="12" r="9" fill="#c2beb7"></circle>
            <rect x="7" y="11" width="10" height="2" rx="1" fill="#ffffff"></rect>
          </svg>
        </span>
      `;
    }
    return `
      <span class="dashboard-passage-status" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="#7a8670" stroke-width="1.8"></circle>
          <path d="M12 7.6v4.8l3 1.8" fill="none" stroke="#7a8670" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>
    `;
  }

  function renderPassageActionIcon(action) {
    if (action === 'done') {
      return `
        <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#3a9f5b"></circle>
          <path d="m7.2 12.4 3.1 3.1 6.5-7.1" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#d4ab2d"></circle>
        <path d="M5.7 14.2V9.6h4.8c1.2 0 2 .8 2 1.8v2.8M5.7 13h12.6M18.3 13v3.2M8 13v1.8M6.4 16.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm11.2 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  function renderPassageActionButtons(row) {
    if (!row.isActionable) {
      return '';
    }
    const sampleId = safeText(String(row.sample?.id || ''));
    const label = safeText(sampleLabel(row.sample));
    return `
      <div class="dashboard-passage-actions">
        <button
          type="button"
          class="dashboard-passage-action"
          data-dashboard-passage-action="done"
          data-dashboard-passage-sample="${sampleId}"
          aria-label="Mark passage done for ${label}"
        >${renderPassageActionIcon('done')}</button>
        <button
          type="button"
          class="dashboard-passage-action"
          data-dashboard-passage-action="extend"
          data-dashboard-passage-sample="${sampleId}"
          aria-label="Extend passage reminder one day for ${label}"
        >${renderPassageActionIcon('extend')}</button>
      </div>
    `;
  }

  function formatPassageRowDetail(row) {
    if (row.status === 'unconfigured') {
      return 'Missing last passage date or interval.';
    }
    const detail = [];
    if (row.passageNumber > 0) {
      detail.push(`P${row.passageNumber}`);
    }
    detail.push(`Every ${row.intervalDays} day(s)`);
    if (row.status === 'overdue') {
      detail.push(formatRelativeDays(row.daysFromToday));
      detail.push(`due ${formatDateLocal(row.effectiveDueDate)}`);
      return detail.join(' | ');
    }
    if (row.status === 'due_today') {
      detail.push('needs passage today');
      return detail.join(' | ');
    }
    if (row.deferredUntilDate) {
      detail.push(`extended to ${row.deferredUntilDate}`);
      return detail.join(' | ');
    }
    detail.push(`${formatDateLocal(row.effectiveDueDate)} (${formatRelativeDays(row.daysFromToday)})`);
    return detail.join(' | ');
  }

  function clonePassageConfig(sample) {
    const lastPassageDate = String(sample?.cellPassage?.lastPassageDate || '').trim();
    const intervalDays = Math.round(Number(sample?.cellPassage?.intervalDays));
    if (!parseLocalDate(lastPassageDate) || !Number.isFinite(intervalDays) || intervalDays <= 0) {
      return null;
    }
    const nextConfig = {
      lastPassageDate,
      intervalDays
    };
    const passageNumber = readPassageNumber(sample);
    if (passageNumber > 0) {
      nextConfig.passageNumber = passageNumber;
    }
    const deferredUntilDate = String(sample?.cellPassage?.deferredUntilDate || '').trim();
    if (parseLocalDate(deferredUntilDate)) {
      nextConfig.deferredUntilDate = deferredUntilDate;
    }
    return nextConfig;
  }

  function completePassage(sampleId) {
    const sample = (Array.isArray(state.samples) ? state.samples : []).find((item) => item.id === sampleId);
    const current = clonePassageConfig(sample);
    if (!sample || !current) {
      return;
    }
    const now = new Date();
    sample.cellPassage = {
      lastPassageDate: formatDateLocal(now),
      intervalDays: current.intervalDays,
      passageNumber: current.passageNumber > 0 ? current.passageNumber + 1 : undefined
    };
    sample.updatedAt = now.toISOString();
    persist();
    render();
  }

  function extendPassageOneDay(sampleId) {
    const sample = (Array.isArray(state.samples) ? state.samples : []).find((item) => item.id === sampleId);
    const current = clonePassageConfig(sample);
    if (!sample || !current) {
      return;
    }
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    sample.cellPassage = {
      ...current,
      deferredUntilDate: formatDateLocal(tomorrow)
    };
    sample.updatedAt = now.toISOString();
    persist();
    render();
  }

  function collectPassageRows() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = [];
    const dueToday = [];
    const incubating = [];
    const unconfigured = [];
    const rows = [];

    (Array.isArray(state.samples) ? state.samples : []).forEach((sample) => {
      if (String(sample?.type || '').trim().toLowerCase() !== 'cell_line') {
        return;
      }
      const dateValue = String(sample?.cellPassage?.lastPassageDate || '').trim();
      const interval = Math.round(Number(sample?.cellPassage?.intervalDays));
      const lastPassage = parseLocalDate(dateValue);
      const passageNumber = readPassageNumber(sample);
      if (!lastPassage || !Number.isFinite(interval) || interval <= 0) {
        const row = {
          sample,
          status: 'unconfigured',
          intervalDays: 0,
          passageNumber,
          dueDate: null,
          effectiveDueDate: null,
          deferredUntilDate: '',
          daysFromToday: 0,
          isActionable: false
        };
        unconfigured.push(row);
        rows.push(row);
        return;
      }
      const dueDate = new Date(lastPassage);
      dueDate.setDate(dueDate.getDate() + interval);
      dueDate.setHours(0, 0, 0, 0);
      const deferredUntil = parseLocalDate(sample?.cellPassage?.deferredUntilDate);
      const effectiveDueDate = deferredUntil && deferredUntil.getTime() > dueDate.getTime()
        ? deferredUntil
        : dueDate;
      const daysFromToday = Math.round((effectiveDueDate.getTime() - today.getTime()) / 86400000);
      const status = effectiveDueDate.getTime() < today.getTime()
        ? 'overdue'
        : (effectiveDueDate.getTime() === today.getTime() ? 'due_today' : 'incubating');
      const row = {
        sample,
        status,
        intervalDays: interval,
        passageNumber,
        dueDate,
        effectiveDueDate,
        deferredUntilDate: deferredUntil ? formatDateLocal(deferredUntil) : '',
        daysFromToday,
        isActionable: status === 'overdue' || status === 'due_today'
      };
      if (status === 'overdue') {
        overdue.push(row);
      } else if (status === 'due_today') {
        dueToday.push(row);
      } else {
        incubating.push(row);
      }
      rows.push(row);
    });

    const statusRank = {
      overdue: 0,
      due_today: 1,
      incubating: 2,
      unconfigured: 3
    };
    rows.sort((a, b) => {
      const rankDelta = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
      if (rankDelta) {
        return rankDelta;
      }
      const leftTime = a.effectiveDueDate?.getTime?.() || Number.MAX_SAFE_INTEGER;
      const rightTime = b.effectiveDueDate?.getTime?.() || Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return sampleLabel(a.sample).localeCompare(sampleLabel(b.sample));
    });

    return {
      rows,
      overdue,
      dueToday,
      incubating,
      unconfigured
    };
  }

  function renderPassageWidget(passageRows) {
    summary.textContent = `Overdue: ${passageRows.overdue.length} | Need today: ${passageRows.dueToday.length} | Incubating: ${passageRows.incubating.length}${passageRows.unconfigured.length ? ` | Needs setup: ${passageRows.unconfigured.length}` : ''}`;
    if (!passageRows.rows.length) {
      list.innerHTML = '<p class="small-note">No cell line reminders yet.</p>';
      return;
    }
    list.innerHTML = passageRows.rows.map((row) => `
      <article class="dashboard-passage-row${row.status === 'unconfigured' ? ' is-unconfigured' : ''}">
        ${renderPassageStatusIcon(row.status)}
        <div class="dashboard-passage-copy">
          <strong class="dashboard-passage-title">${safeText(sampleLabel(row.sample))}</strong>
          <p class="dashboard-passage-detail">${safeText(formatPassageRowDetail(row))}</p>
        </div>
        ${renderPassageActionButtons(row)}
      </article>
    `).join('');
  }

  function onPassageListClick(event) {
    const button = event.target.closest('[data-dashboard-passage-action]');
    if (!button) {
      return;
    }
    const sampleId = String(button.dataset.dashboardPassageSample || '').trim();
    const action = String(button.dataset.dashboardPassageAction || '').trim().toLowerCase();
    if (!sampleId || !action) {
      return;
    }
    if (action === 'done') {
      completePassage(sampleId);
      return;
    }
    if (action === 'extend') {
      extendPassageOneDay(sampleId);
    }
  }

  function renderWidget() {
    renderPassageWidget(collectPassageRows());
  }

  function handleEscape() {
    if (dialogOverlay.hidden) {
      return false;
    }
    closePassageDialog();
    return true;
  }

  return {
    render: renderWidget,
    handleEscape
  };
}
