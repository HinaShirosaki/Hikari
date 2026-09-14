import {
  ensureDashboardState,
  formatDateLocal,
  parseLocalDate,
  passageReminderId,
  sampleLabel
} from './utils.js';

// Cell-passage reminder widget — surfaces overdue and upcoming sub-cultures,
// plus an "add reminder" dialog that stores dashboard-only reminder records.
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
    panelList,
    addBtn,
    closeBtn,
    dialogOverlay,
    dialogForm,
    strainInput,
    intervalInput,
    numberInput
  } = elements;

  list.addEventListener('click', onPassageListClick);
  panelList.addEventListener('click', onPassageListClick);
  addBtn.addEventListener('click', () => openPassageDialog(true));
  closeBtn.addEventListener('click', closePassageDialog);
  dialogForm.addEventListener('submit', onPassageDialogSubmit);
  dialogOverlay.addEventListener('click', onPassageDialogOverlayClick);

  function openPassageDialog(focusForm) {
    dialogForm.reset();
    dialogOverlay.hidden = false;
    if (!focusForm) {
      return;
    }
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
    ensureDashboardState(state);
    state.settings.dashboard.passageReminders.push({
      id: passageReminderId(createId),
      name: strain,
      cellPassage: {
        lastPassageDate: today,
        intervalDays,
        passageNumber
      },
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

  function passageTag(row) {
    if (row.status === 'unconfigured') {
      return { text: 'Needs setup', cls: ' is-soon' };
    }
    if (row.status === 'overdue') {
      const days = Math.abs(row.daysFromToday);
      return { text: `Overdue · ${days} ${days === 1 ? 'day' : 'days'}`, cls: ' is-due' };
    }
    if (row.status === 'due_today') {
      return { text: 'Due today', cls: ' is-soon' };
    }
    if (row.daysFromToday <= 1) {
      return { text: 'Tomorrow', cls: '' };
    }
    return { text: `In ${row.daysFromToday} days`, cls: '' };
  }

  function passageMeta(row) {
    if (row.status === 'unconfigured') {
      return 'Needs last passage date or interval';
    }
    return `Every ${row.intervalDays} d`;
  }

  function renderPassageActionIcon(action) {
    if (action === 'done') {
      return `
        <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
          <path d="m8.4 12.1 2.35 2.4 4.95-5.25" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
        <rect x="5" y="5.5" width="14" height="13" rx="2.25" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M8.25 3.75v3.5M15.75 3.75v3.5M5 9.5h14M12 12v4M10 14h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function renderPassageActionButtons(row) {
    if (!row.isActionable) {
      return '';
    }
    const passageId = safeText(String(row.sample?.id || ''));
    const passageSource = safeText(String(row.source || 'sample'));
    const label = safeText(sampleLabel(row.sample));
    return `
      <button
        type="button"
        class="home-row-action home-passage-action is-complete"
        data-dashboard-passage-action="done"
        data-dashboard-passage-id="${passageId}"
        data-dashboard-passage-source="${passageSource}"
        aria-label="Mark passage done for ${label}"
        title="Mark passaged"
      >${renderPassageActionIcon('done')}</button>
      <button
        type="button"
        class="home-row-action home-passage-action is-extend"
        data-dashboard-passage-action="extend"
        data-dashboard-passage-id="${passageId}"
        data-dashboard-passage-source="${passageSource}"
        aria-label="Extend passage reminder one day for ${label}"
        title="Extend one day"
      >${renderPassageActionIcon('extend')}</button>
    `;
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

  function findPassageRecord(source, recordId) {
    if (source === 'dashboard') {
      return (Array.isArray(state.settings?.dashboard?.passageReminders)
        ? state.settings.dashboard.passageReminders
        : []).find((item) => item.id === recordId) || null;
    }
    return (Array.isArray(state.samples) ? state.samples : []).find((item) => item.id === recordId) || null;
  }

  function completePassage(source, recordId) {
    const record = findPassageRecord(source, recordId);
    const current = clonePassageConfig(record);
    if (!record || !current) {
      return;
    }
    const now = new Date();
    record.cellPassage = {
      lastPassageDate: formatDateLocal(now),
      intervalDays: current.intervalDays,
      passageNumber: current.passageNumber > 0 ? current.passageNumber + 1 : undefined
    };
    record.updatedAt = now.toISOString();
    persist();
    render();
  }

  function extendPassageOneDay(source, recordId) {
    const record = findPassageRecord(source, recordId);
    const current = clonePassageConfig(record);
    if (!record || !current) {
      return;
    }
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    record.cellPassage = {
      ...current,
      deferredUntilDate: formatDateLocal(tomorrow)
    };
    record.updatedAt = now.toISOString();
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

    function collectRecord(sample, source) {
      if (String(sample?.type || '').trim().toLowerCase() !== 'cell_line') {
        if (source !== 'dashboard') {
          return;
        }
      }
      const dateValue = String(sample?.cellPassage?.lastPassageDate || '').trim();
      const interval = Math.round(Number(sample?.cellPassage?.intervalDays));
      const lastPassage = parseLocalDate(dateValue);
      const passageNumber = readPassageNumber(sample);
      if (!lastPassage || !Number.isFinite(interval) || interval <= 0) {
        const row = {
          sample,
          source,
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
        source,
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
    }

    (Array.isArray(state.samples) ? state.samples : []).forEach((sample) => {
      collectRecord(sample, 'sample');
    });
    (Array.isArray(state.settings?.dashboard?.passageReminders)
      ? state.settings.dashboard.passageReminders
      : []).forEach((reminder) => {
      collectRecord(reminder, 'dashboard');
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
    if (!passageRows.rows.length) {
      summary.textContent = '';
      summary.hidden = true;
      list.innerHTML = '';
      panelList.innerHTML = '';
      return;
    }
    const dueCount = passageRows.overdue.length + passageRows.dueToday.length;
    summary.textContent = String(passageRows.rows.length);
    summary.setAttribute('aria-label', `${dueCount} due · ${passageRows.rows.length} cell lines`);
    summary.title = `${dueCount} due`;
    summary.hidden = false;
    list.innerHTML = passageRows.rows.map((row) => {
      const tag = passageTag(row);
      return `
      <article class="home-row home-passage-row${row.status === 'unconfigured' ? ' is-muted' : ''}">
        <div class="home-row-copy">
          <div class="home-row-name">${safeText(sampleLabel(row.sample))}${row.passageNumber > 0 ? ` <span class="home-passage-number">P${row.passageNumber}</span>` : ''}</div>
          <div class="home-row-meta"><span class="home-row-tag${tag.cls}">${safeText(tag.text)}</span><span class="home-passage-interval"> · ${safeText(passageMeta(row))}</span></div>
        </div>
        <div class="home-row-end">
          ${renderPassageActionButtons(row)}
        </div>
      </article>
    `;
    }).join('');
    panelList.innerHTML = list.innerHTML;
  }

  function onPassageListClick(event) {
    const button = event.target.closest('[data-dashboard-passage-action]');
    if (!button) {
      return;
    }
    const recordId = String(button.dataset.dashboardPassageId || '').trim();
    const source = String(button.dataset.dashboardPassageSource || 'sample').trim().toLowerCase();
    const action = String(button.dataset.dashboardPassageAction || '').trim().toLowerCase();
    if (!recordId || !action) {
      return;
    }
    if (action === 'done') {
      completePassage(source, recordId);
      return;
    }
    if (action === 'extend') {
      extendPassageOneDay(source, recordId);
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
