// Home dashboard controller.
//
// Responsibilities:
// - summarize urgent bench work for the home screen
// - surface cell-passage reminders, overnight incubation locations, and workflow progress
// - provide a lightweight dashboard timer with presets, pause, and reset support
// - bridge quick-log notes into the assistant or notebook workspace
export function initHomeDashboard({
  state,
  persist,
  createId = () => '',
  safeText,
  onOpenSampleSearch = () => {},
  onOpenSamples = () => onOpenSampleSearch(''),
  onOpenNotebook = () => {},
  onOpenWorkflow = () => {},
  onOpenAssistant = () => {},
  onSendQuickLogToAgent = () => false
}) {
  const todaySummary = document.getElementById('dashboard-today-summary');
  const todayOverdueCount = document.getElementById('dashboard-today-overdue-count');
  const todayWorkflowCount = document.getElementById('dashboard-today-workflow-count');
  const todayIncubationCount = document.getElementById('dashboard-today-incubation-count');
  const todayList = document.getElementById('dashboard-today-list');

  const passageSummary = document.getElementById('dashboard-passage-summary');
  const passageList = document.getElementById('dashboard-passage-list');
  const passageAddBtn = document.getElementById('dashboard-passage-add-btn');
  const passageDialogOverlay = document.getElementById('dashboard-passage-dialog-overlay');
  const passageDialogForm = document.getElementById('dashboard-passage-dialog-form');
  const passageStrainInput = document.getElementById('dashboard-passage-strain-input');
  const passageIntervalInput = document.getElementById('dashboard-passage-interval-input');
  const passageNumberInput = document.getElementById('dashboard-passage-number-input');

  const workflowSelect = document.getElementById('dashboard-workflow-select');
  const workflowNextStep = document.getElementById('dashboard-workflow-next-step');
  const workflowProgressList = document.getElementById('dashboard-workflow-progress-list');

  const incubationSummary = document.getElementById('dashboard-incubation-summary');
  const incubationList = document.getElementById('dashboard-incubation-list');
  const incubationAddBtn = document.getElementById('dashboard-incubation-add-btn');
  const incubationDialogOverlay = document.getElementById('dashboard-incubation-dialog-overlay');
  const incubationLocationList = document.getElementById('dashboard-incubation-location-list');
  const incubationLocationForm = document.getElementById('dashboard-incubation-location-form');
  const incubationLocationInput = document.getElementById('dashboard-incubation-location-input');

  const quickLogInput = document.getElementById('dashboard-quick-log-input');
  const quickLogStatus = document.getElementById('dashboard-quick-log-status');
  const quickLogAgentBtn = document.getElementById('dashboard-quick-log-agent-btn');
  const quickLogNotebookBtn = document.getElementById('dashboard-quick-log-notebook-btn');
  const quickLogClearBtn = document.getElementById('dashboard-quick-log-clear-btn');

  const localTimeDisplay = document.getElementById('dashboard-local-time');
  const localDateDisplay = document.getElementById('dashboard-local-date');
  const timerDisplay = document.getElementById('dashboard-timer-display');
  const timerStatus = document.getElementById('dashboard-timer-status');
  const timerSavedList = document.getElementById('dashboard-timer-saved-list');
  const timerCustomMinutesInput = document.getElementById('dashboard-timer-custom-minutes');
  const timerSetBtn = document.getElementById('dashboard-timer-set-btn');
  const timerStartBtn = document.getElementById('dashboard-timer-start-btn');
  const timerPauseBtn = document.getElementById('dashboard-timer-pause-btn');
  const timerResetBtn = document.getElementById('dashboard-timer-reset-btn');
  const presetButtons = [...document.querySelectorAll('[data-dashboard-preset-minutes]')];
  const quickActionButtons = [...document.querySelectorAll('[data-dashboard-action]')];

  if (
    !todaySummary
    || !todayOverdueCount
    || !todayWorkflowCount
    || !todayIncubationCount
    || !todayList
    || !passageSummary
    || !passageList
    || !passageAddBtn
    || !passageDialogOverlay
    || !passageDialogForm
    || !passageStrainInput
    || !passageIntervalInput
    || !passageNumberInput
    || !workflowSelect
    || !workflowNextStep
    || !workflowProgressList
    || !incubationSummary
    || !incubationList
    || !incubationAddBtn
    || !incubationDialogOverlay
    || !incubationLocationList
    || !incubationLocationForm
    || !incubationLocationInput
    || !quickLogInput
    || !quickLogStatus
    || !quickLogAgentBtn
    || !quickLogNotebookBtn
    || !quickLogClearBtn
    || !localTimeDisplay
    || !localDateDisplay
    || !timerDisplay
    || !timerStatus
    || !timerSavedList
    || !timerCustomMinutesInput
    || !timerSetBtn
    || !timerStartBtn
    || !timerPauseBtn
    || !timerResetBtn
  ) {
    return {
      render: () => {}
    };
  }

  const timerState = {
    durationMs: 15 * 60 * 1000,
    remainingMs: 15 * 60 * 1000,
    running: false,
    endAtMs: 0,
    alert: false,
    savedDurations: [15, 10, 30, 5]
  };
  let timerTickHandle = 0;
  let localClockHandle = 0;
  let timerHint = '';

  passageList.addEventListener('click', onPassageListClick);
  passageAddBtn.addEventListener('click', openPassageDialog);
  passageDialogForm.addEventListener('submit', onPassageDialogSubmit);
  passageDialogOverlay.addEventListener('click', onPassageDialogOverlayClick);
  todayList.addEventListener('click', onDashboardActionClick);
  workflowSelect.addEventListener('change', onWorkflowSelected);
  workflowProgressList.addEventListener('click', onWorkflowProgressClick);
  incubationAddBtn.addEventListener('click', openIncubationDialog);
  incubationDialogOverlay.addEventListener('click', onIncubationDialogOverlayClick);
  incubationLocationForm.addEventListener('submit', onIncubationLocationSubmit);
  incubationLocationList.addEventListener('click', onIncubationLocationListClick);
  quickActionButtons.forEach((button) => {
    button.addEventListener('click', onQuickActionClick);
  });
  quickLogInput.addEventListener('input', onQuickLogInput);
  quickLogInput.addEventListener('keydown', onQuickLogKeydown);
  quickLogAgentBtn.addEventListener('click', onQuickLogSendToAgent);
  quickLogNotebookBtn.addEventListener('click', () => {
    onOpenNotebook();
    setQuickLogStatus('Notebook opened.');
  });
  quickLogClearBtn.addEventListener('click', onQuickLogClear);
  timerSavedList.addEventListener('click', onSavedTimerClick);
  timerSetBtn.addEventListener('click', onTimerSet);
  timerStartBtn.addEventListener('click', onTimerStart);
  timerPauseBtn.addEventListener('click', onTimerPause);
  timerResetBtn.addEventListener('click', onTimerReset);
  timerCustomMinutesInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    onTimerSet();
  });
  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.dashboardPresetMinutes);
      setTimerDuration(minutes);
    });
  });
  document.addEventListener('keydown', onDashboardKeydown);

  renderLocalClock();
  localClockHandle = window.setInterval(renderLocalClock, 1000);

  function ensureDashboardState() {
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = {};
    }
    if (!state.settings.dashboard || typeof state.settings.dashboard !== 'object') {
      state.settings.dashboard = {
        currentWorkflowId: '',
        workflowProgress: {},
        quickLogDraft: '',
        incubationLocations: []
      };
      return true;
    }
    let changed = false;
    if (typeof state.settings.dashboard.currentWorkflowId !== 'string') {
      state.settings.dashboard.currentWorkflowId = '';
      changed = true;
    }
    if (
      !state.settings.dashboard.workflowProgress
      || typeof state.settings.dashboard.workflowProgress !== 'object'
      || Array.isArray(state.settings.dashboard.workflowProgress)
    ) {
      state.settings.dashboard.workflowProgress = {};
      changed = true;
    }
    if (typeof state.settings.dashboard.quickLogDraft !== 'string') {
      state.settings.dashboard.quickLogDraft = '';
      changed = true;
    }
    if (!Array.isArray(state.settings.dashboard.incubationLocations)) {
      state.settings.dashboard.incubationLocations = [];
      changed = true;
    }
    return changed;
  }

  function ensureSamplesState() {
    if (!Array.isArray(state.samples)) {
      state.samples = [];
      return true;
    }
    return false;
  }

  function nextSampleId() {
    const generatedId = String(createId() || '').trim();
    if (generatedId) {
      return generatedId;
    }
    return `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  }

  function normalizeSampleCode(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  function buildPassageReminderCode(strain) {
    const base = normalizeSampleCode(strain).slice(0, 24) || 'CELL';
    const existingCodes = new Set(
      (Array.isArray(state.samples) ? state.samples : [])
        .map((sample) => String(sample?.code || '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (!existingCodes.has(base.toLowerCase())) {
      return base;
    }
    let suffix = 2;
    while (existingCodes.has(`${base}-${suffix}`.toLowerCase())) {
      suffix += 1;
    }
    return `${base}-${suffix}`;
  }

  function normalizeIncubationLocationValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function renderIncubationLocationRows() {
    const locations = Array.isArray(state.settings?.dashboard?.incubationLocations)
      ? state.settings.dashboard.incubationLocations
      : [];
    incubationLocationList.innerHTML = locations.map((location, index) => `
      <div class="home-incubation-location-row">
        <span class="home-incubation-location-name">${safeText(location)}</span>
        <button
          type="button"
          class="home-incubation-delete-btn"
          data-dashboard-incubation-location-delete="${index}"
          aria-label="Delete incubation location ${safeText(location)}"
        >
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="currentColor"></circle>
            <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
    `).join('');
  }

  function openPassageDialog() {
    passageDialogForm.reset();
    passageDialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      passageStrainInput.focus();
    });
  }

  function closePassageDialog() {
    passageDialogForm.reset();
    passageDialogOverlay.hidden = true;
  }

  function openIncubationDialog() {
    renderIncubationLocationRows();
    incubationLocationForm.reset();
    incubationDialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      incubationLocationInput.focus();
    });
  }

  function closeIncubationDialog() {
    incubationLocationForm.reset();
    incubationDialogOverlay.hidden = true;
  }

  function onPassageDialogOverlayClick(event) {
    if (event.target !== passageDialogOverlay) {
      return;
    }
    closePassageDialog();
  }

  function onIncubationDialogOverlayClick(event) {
    if (event.target !== incubationDialogOverlay) {
      return;
    }
    closeIncubationDialog();
  }

  function onDashboardKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }
    if (!passageDialogOverlay.hidden) {
      event.preventDefault();
      closePassageDialog();
      return;
    }
    if (incubationDialogOverlay.hidden) {
      return;
    }
    event.preventDefault();
    closeIncubationDialog();
  }

  function onPassageDialogSubmit(event) {
    event.preventDefault();
    if (!passageDialogForm.reportValidity()) {
      return;
    }

    const strain = String(passageStrainInput.value || '').trim();
    const intervalDays = Math.round(Number(passageIntervalInput.value));
    const passageNumber = Math.round(Number(passageNumberInput.value));
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
    ensureSamplesState();
    state.samples.push({
      id: nextSampleId(),
      code: buildPassageReminderCode(strain),
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

  function onIncubationLocationSubmit(event) {
    event.preventDefault();
    ensureDashboardState();
    const value = normalizeIncubationLocationValue(incubationLocationInput.value);
    if (!value) {
      return;
    }
    const existing = state.settings.dashboard.incubationLocations
      .some((item) => normalizeIncubationLocationValue(item).toLowerCase() === value.toLowerCase());
    if (existing) {
      incubationLocationInput.focus();
      incubationLocationInput.select();
      return;
    }
    state.settings.dashboard.incubationLocations.push(value);
    persist();
    renderIncubationLocationRows();
    incubationLocationForm.reset();
    incubationLocationInput.focus();
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
    renderIncubationLocationRows();
  }

  function sampleLabel(sample) {
    const code = String(sample?.code || '').trim();
    const name = String(sample?.name || '').trim();
    if (code && name) {
      return `${code} - ${name}`;
    }
    return code || name || String(sample?.id || 'Unnamed sample');
  }

  function parseWorkflowTimestamp(workflow) {
    const parsed = Date.parse(String(workflow?.updatedAt || workflow?.createdAt || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function workflowsSortedByRecent() {
    return [...(Array.isArray(state.workflows) ? state.workflows : [])]
      .sort((a, b) => parseWorkflowTimestamp(b) - parseWorkflowTimestamp(a));
  }

  function normalizeWorkflowProgress(workflow) {
    const dashboard = state.settings.dashboard;
    const map = dashboard.workflowProgress;
    const workflowId = String(workflow?.id || '');
    const raw = Array.isArray(map[workflowId]) ? map[workflowId] : [];
    const validBlockIds = new Set((workflow?.blocks || []).map((block) => String(block?.id || '')));
    const seen = new Set();
    const normalized = [];
    raw.forEach((blockId) => {
      const id = String(blockId || '').trim();
      if (!id || seen.has(id) || !validBlockIds.has(id)) {
        return;
      }
      seen.add(id);
      normalized.push(id);
    });
    if (normalized.length !== raw.length || !Array.isArray(map[workflowId])) {
      map[workflowId] = normalized;
      return true;
    }
    return false;
  }

  function pruneWorkflowProgress(workflows) {
    const known = new Set(workflows.map((workflow) => String(workflow?.id || '')).filter(Boolean));
    const progressMap = state.settings.dashboard.workflowProgress;
    let changed = false;
    Object.keys(progressMap).forEach((workflowId) => {
      if (known.has(workflowId)) {
        return;
      }
      delete progressMap[workflowId];
      changed = true;
    });
    return changed;
  }

  function normalizeCurrentWorkflowId(workflows) {
    const dashboard = state.settings.dashboard;
    const currentId = String(dashboard.currentWorkflowId || '');
    const hasCurrent = currentId && workflows.some((workflow) => workflow.id === currentId);
    if (hasCurrent) {
      return false;
    }
    const nextId = workflows[0]?.id || '';
    if (nextId === currentId) {
      return false;
    }
    dashboard.currentWorkflowId = nextId;
    return true;
  }

  function parseLocalDate(dateString) {
    const raw = String(dateString || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);
    if (
      date.getFullYear() !== year
      || date.getMonth() !== monthIndex
      || date.getDate() !== day
    ) {
      return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatRelativeDays(dayDelta) {
    if (dayDelta === 0) {
      return 'due today';
    }
    if (dayDelta > 0) {
      return `due in ${dayDelta} day(s)`;
    }
    return `overdue by ${Math.abs(dayDelta)} day(s)`;
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
    passageSummary.textContent = `Overdue: ${passageRows.overdue.length} | Need today: ${passageRows.dueToday.length} | Incubating: ${passageRows.incubating.length}${passageRows.unconfigured.length ? ` | Needs setup: ${passageRows.unconfigured.length}` : ''}`;
    if (!passageRows.rows.length) {
      passageList.innerHTML = '<p class="small-note">No cell line reminders yet.</p>';
      return;
    }
    passageList.innerHTML = passageRows.rows.map((row) => `
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

  function protocolNameById(protocolId) {
    const protocol = (Array.isArray(state.protocols) ? state.protocols : [])
      .find((item) => item.id === protocolId);
    return protocol?.name || 'Missing protocol';
  }

  function memberNameById(memberId) {
    if (!memberId) {
      return 'Unassigned';
    }
    const member = (Array.isArray(state.members) ? state.members : [])
      .find((item) => item.id === memberId);
    return member?.name || memberId;
  }

  function blockLabel(block, index) {
    const type = String(block?.type || '').trim().toLowerCase();
    if (type === 'protocol') {
      return `Block ${index + 1}: ${protocolNameById(String(block?.protocolId || ''))}`;
    }
    const text = String(block?.text || '').trim();
    return `Block ${index + 1}: ${text || 'Text block'}`;
  }

  function buildUpstreamMap(workflow) {
    const map = new Map();
    (workflow?.blocks || []).forEach((block) => {
      map.set(block.id, []);
    });
    (workflow?.links || []).forEach((link) => {
      const toId = String(link?.toBlockId || '').trim();
      const fromId = String(link?.fromBlockId || '').trim();
      if (!toId || !fromId || !map.has(toId)) {
        return;
      }
      map.get(toId).push(fromId);
    });
    return map;
  }

  function computeNextStep(workflow, finishedSet) {
    const blocks = Array.isArray(workflow?.blocks) ? workflow.blocks : [];
    const unfinished = blocks.filter((block) => !finishedSet.has(block.id));
    if (!unfinished.length) {
      return { block: null, complete: true, fallback: false };
    }
    const upstreamMap = buildUpstreamMap(workflow);
    for (const block of unfinished) {
      const upstream = upstreamMap.get(block.id) || [];
      if (upstream.every((upstreamId) => finishedSet.has(upstreamId))) {
        return { block, complete: false, fallback: false };
      }
    }
    return { block: unfinished[0], complete: false, fallback: true };
  }

  function buildWorkflowContext() {
    const workflows = workflowsSortedByRecent();
    let changed = false;
    changed = pruneWorkflowProgress(workflows) || changed;
    changed = normalizeCurrentWorkflowId(workflows) || changed;

    const currentWorkflowId = String(state.settings.dashboard.currentWorkflowId || '');
    const workflow = workflows.find((item) => item.id === currentWorkflowId) || null;
    let finished = new Set();
    let next = { block: null, complete: false, fallback: false };

    if (workflow) {
      changed = normalizeWorkflowProgress(workflow) || changed;
      finished = new Set(state.settings.dashboard.workflowProgress[workflow.id] || []);
      next = computeNextStep(workflow, finished);
    }

    return {
      workflows,
      currentWorkflowId,
      workflow,
      finished,
      next,
      changed
    };
  }

  function renderWorkflowWidget(context) {
    const { workflows, currentWorkflowId, workflow, finished, next } = context;
    workflowSelect.innerHTML = workflows.length
      ? workflows.map((item) => (
        `<option value="${safeText(item.id)}">${safeText(item.name || 'Untitled workflow')}</option>`
      )).join('')
      : '<option value="">No workflows available</option>';
    workflowSelect.disabled = !workflows.length;
    workflowSelect.value = workflows.length ? currentWorkflowId : '';

    if (!workflow) {
      workflowNextStep.textContent = 'No workflow selected. Create a workflow to track next steps.';
      workflowProgressList.innerHTML = '<p class="small-note">No workflow progress to display.</p>';
      return;
    }

    const total = workflow.blocks.length;
    const doneCount = finished.size;
    if (next.complete) {
      workflowNextStep.textContent = `Workflow complete (${doneCount}/${total} blocks).`;
    } else {
      const index = workflow.blocks.findIndex((block) => block.id === next.block.id);
      const title = blockLabel(next.block, index);
      workflowNextStep.textContent = `${title} (${doneCount}/${total} done)`;
    }

    workflowProgressList.innerHTML = workflow.blocks.length
      ? workflow.blocks.map((block, index) => {
        const isDone = finished.has(block.id);
        const assignee = memberNameById(String(block.assigneeId || ''));
        return `
          <article class="dashboard-item${isDone ? ' is-done' : ''}">
            <div>
              <strong>${safeText(blockLabel(block, index))}</strong>
              <p class="small-note">Assignee: ${safeText(assignee)}</p>
            </div>
            <button
              type="button"
              class="ghost-btn"
              data-dashboard-workflow-toggle="${safeText(block.id)}"
            >${isDone ? 'Undo' : 'Done'}</button>
          </article>
        `;
      }).join('')
      : '<p class="small-note">This workflow has no blocks yet.</p>';
  }

  function collectIncubationLocations() {
    return [...(Array.isArray(state.settings?.dashboard?.incubationLocations)
      ? state.settings.dashboard.incubationLocations
      : [])];
  }

  function renderIncubationWidget(locations) {
    incubationSummary.textContent = locations.length
      ? ''
      : 'No incubation locations yet.';
    if (!locations.length) {
      incubationList.innerHTML = '<p class="small-note">Add an incubation location to track overnight setups here.</p>';
      return;
    }
    incubationList.innerHTML = locations.map((location) => `
      <article class="dashboard-item">
        <div>
          <strong>${safeText(location)}</strong>
        </div>
      </article>
    `).join('');
  }

  function buildTodayItems({ passageRows, workflowContext }) {
    const items = [];
    const workflow = workflowContext.workflow;
    const workflowOpenCount = workflow
      ? Math.max(0, workflow.blocks.length - workflowContext.finished.size)
      : 0;

    if (workflow && !workflowContext.next.complete && workflowContext.next.block) {
      const nextIndex = workflow.blocks.findIndex((block) => block.id === workflowContext.next.block.id);
      items.push({
        title: blockLabel(workflowContext.next.block, nextIndex),
        detail: `${workflowContext.finished.size}/${workflow.blocks.length} blocks complete`,
        action: 'workflow',
        actionLabel: 'Workflow'
      });
    }

    passageRows.overdue.slice(0, 2).forEach((row) => {
      items.push({
        title: sampleLabel(row.sample),
        detail: `Cell passage ${formatRelativeDays(row.daysFromToday)}`,
        action: 'samples',
        actionLabel: 'Samples'
      });
    });

    passageRows.dueToday.slice(0, Math.max(0, 2 - passageRows.overdue.length)).forEach((row) => {
      items.push({
        title: sampleLabel(row.sample),
        detail: 'Cell passage due today',
        action: 'samples',
        actionLabel: 'Samples'
      });
    });

    return {
      items: items.slice(0, 4),
      counts: {
        overdue: passageRows.overdue.length,
        workflowOpen: workflowOpenCount,
        incubation: 0
      }
    };
  }

  function renderTodayWidget(todayData) {
    todayOverdueCount.textContent = String(todayData.counts.overdue);
    todayWorkflowCount.textContent = String(todayData.counts.workflowOpen);
    todayIncubationCount.textContent = String(todayData.counts.incubation);

    if (!todayData.items.length) {
      todaySummary.textContent = 'Nothing urgent is waiting on the bench right now.';
      todayList.innerHTML = '<p class="small-note">The dashboard is clear. Use Quick Actions to jump into a workspace.</p>';
      return;
    }

    todaySummary.textContent = '';
    todayList.innerHTML = todayData.items.map((item) => `
      <article class="dashboard-item">
        <div>
          <strong>${safeText(item.title)}</strong>
          <p class="small-note">${safeText(item.detail)}</p>
        </div>
        <button
          type="button"
          class="ghost-btn"
          data-dashboard-action="${safeText(item.action)}"
        >${safeText(item.actionLabel)}</button>
      </article>
    `).join('');
  }

  function syncQuickLogInput() {
    const draft = String(state.settings.dashboard.quickLogDraft || '');
    if (quickLogInput.value !== draft) {
      quickLogInput.value = draft;
    }
  }

  function setQuickLogStatus(message) {
    quickLogStatus.textContent = String(message || '').trim();
  }

  function renderQuickLogWidget() {
    syncQuickLogInput();
    if (String(state.settings.dashboard.quickLogDraft || '').trim()) {
      setQuickLogStatus('Draft saved locally. Press Command/Ctrl+Enter to send it to the Assistant.');
      return;
    }
    setQuickLogStatus('');
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

  function formatTimerSummary(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }
    return `${minutes}m ${String(seconds).padStart(2, '0')}s left`;
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

  function syncRemainingFromNow() {
    if (!timerState.running) {
      return;
    }
    timerState.remainingMs = Math.max(0, timerState.endAtMs - Date.now());
  }

  function setTimerDuration(minutes) {
    const rounded = Math.round(Number(minutes));
    if (!Number.isFinite(rounded) || rounded <= 0) {
      timerHint = 'Enter a valid minute value.';
      renderTimerWidget();
      return;
    }
    timerState.savedDurations = [
      rounded,
      ...timerState.savedDurations.filter((value) => value !== rounded)
    ].slice(0, 4);
    const durationMs = rounded * 60 * 1000;
    timerState.durationMs = durationMs;
    timerState.remainingMs = durationMs;
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.alert = false;
    timerHint = '';
    stopTimerTick();
    timerCustomMinutesInput.value = String(rounded);
    renderTimerWidget();
  }

  function renderSavedTimers() {
    const currentMinutes = Math.max(1, Math.round(timerState.durationMs / 60000));
    const rows = [
      {
        minutes: currentMinutes,
        title: timerState.running
          ? 'Current countdown'
          : (timerState.remainingMs < timerState.durationMs ? 'Paused timer' : 'Loaded timer'),
        value: timerState.running
          ? formatTimerSummary(timerState.remainingMs)
          : `${currentMinutes}m ready`,
        active: true
      },
      ...timerState.savedDurations
        .filter((minutes) => minutes !== currentMinutes)
        .map((minutes) => ({
          minutes,
          title: `${minutes} minute timer`,
          value: 'Tap to load',
          active: false
        }))
    ];

    timerSavedList.innerHTML = rows.map((row) => `
      <button
        type="button"
        class="dashboard-timer-row${row.active ? ' is-active' : ''}"
        data-dashboard-saved-minutes="${row.minutes}"
      >
        <span class="dashboard-timer-row-title">${safeText(row.title)}</span>
        <span class="dashboard-timer-row-value">${safeText(row.value)}</span>
      </button>
    `).join('');
  }

  function renderTimerWidget() {
    syncRemainingFromNow();
    timerDisplay.textContent = formatTimer(timerState.remainingMs);
    timerDisplay.classList.toggle('is-alert', timerState.alert);

    if (timerHint) {
      timerStatus.textContent = timerHint;
    } else if (timerState.alert) {
      timerStatus.textContent = "Time's up.";
    } else if (timerState.running) {
      timerStatus.textContent = 'Running';
    } else if (timerState.remainingMs < timerState.durationMs) {
      timerStatus.textContent = 'Paused';
    } else {
      timerStatus.textContent = '';
    }

    timerStartBtn.disabled = timerState.running;
    timerPauseBtn.disabled = !timerState.running;
    renderSavedTimers();
  }

  function onTimerTick() {
    syncRemainingFromNow();
    if (timerState.remainingMs > 0) {
      renderTimerWidget();
      return;
    }
    timerState.remainingMs = 0;
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.alert = true;
    stopTimerTick();
    timerHint = '';
    renderTimerWidget();
  }

  function onTimerSet() {
    setTimerDuration(timerCustomMinutesInput.value);
  }

  function onTimerStart() {
    if (timerState.running) {
      return;
    }
    if (timerState.remainingMs <= 0 || timerState.alert) {
      timerState.remainingMs = timerState.durationMs;
    }
    timerState.running = true;
    timerState.alert = false;
    timerHint = '';
    timerState.endAtMs = Date.now() + timerState.remainingMs;
    startTimerTick();
    renderTimerWidget();
  }

  function onTimerPause() {
    if (!timerState.running) {
      return;
    }
    syncRemainingFromNow();
    timerState.running = false;
    timerState.endAtMs = 0;
    stopTimerTick();
    timerHint = '';
    renderTimerWidget();
  }

  function onTimerReset() {
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.remainingMs = timerState.durationMs;
    timerState.alert = false;
    timerHint = '';
    stopTimerTick();
    renderTimerWidget();
  }

  function onSavedTimerClick(event) {
    const button = event.target.closest('[data-dashboard-saved-minutes]');
    if (!button) {
      return;
    }
    const minutes = Number(button.dataset.dashboardSavedMinutes);
    setTimerDuration(minutes);
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

  function onDashboardActionClick(event) {
    const button = event.target.closest('[data-dashboard-action]');
    if (!button) {
      return;
    }
    runDashboardAction(button.dataset.dashboardAction);
  }

  function onQuickActionClick(event) {
    const button = event.currentTarget;
    runDashboardAction(button?.dataset?.dashboardAction);
  }

  function onQuickLogInput() {
    ensureDashboardState();
    state.settings.dashboard.quickLogDraft = quickLogInput.value;
    persist();
    if (quickLogInput.value.trim()) {
      setQuickLogStatus('Draft saved locally. Press Command/Ctrl+Enter to send it to the Assistant.');
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

  function onQuickLogSendToAgent() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setQuickLogStatus('Add a bench note before sending it to the Assistant.');
      return;
    }
    const sent = onSendQuickLogToAgent(value);
    if (sent === false) {
      setQuickLogStatus('Unable to hand the note to the Assistant from this screen.');
      return;
    }
    state.settings.dashboard.quickLogDraft = '';
    quickLogInput.value = '';
    persist();
    setQuickLogStatus('Sent to Assistant.');
  }

  function onQuickLogClear() {
    state.settings.dashboard.quickLogDraft = '';
    quickLogInput.value = '';
    persist();
    setQuickLogStatus('');
  }

  function onWorkflowSelected() {
    ensureDashboardState();
    state.settings.dashboard.currentWorkflowId = String(workflowSelect.value || '');
    persist();
    render();
  }

  function onWorkflowProgressClick(event) {
    const button = event.target.closest('[data-dashboard-workflow-toggle]');
    if (!button) {
      return;
    }
    const blockId = String(button.dataset.dashboardWorkflowToggle || '').trim();
    if (!blockId) {
      return;
    }

    const workflowId = String(state.settings.dashboard.currentWorkflowId || '');
    const workflow = (Array.isArray(state.workflows) ? state.workflows : [])
      .find((item) => item.id === workflowId);
    if (!workflow) {
      return;
    }
    const progressMap = state.settings.dashboard.workflowProgress;
    const current = new Set(Array.isArray(progressMap[workflowId]) ? progressMap[workflowId] : []);
    if (current.has(blockId)) {
      current.delete(blockId);
    } else {
      current.add(blockId);
    }
    progressMap[workflowId] = workflow.blocks
      .map((block) => block.id)
      .filter((id) => current.has(id));
    persist();
    render();
  }

  function render() {
    let changed = ensureDashboardState();
    changed = ensureSamplesState() || changed;
    if (!localClockHandle) {
      renderLocalClock();
      localClockHandle = window.setInterval(renderLocalClock, 1000);
    }

    const passageRows = collectPassageRows();
    const workflowContext = buildWorkflowContext();
    const incubationLocations = collectIncubationLocations();
    const todayData = buildTodayItems({
      passageRows,
      workflowContext
    });

    changed = workflowContext.changed || changed;
    if (changed) {
      persist();
    }

    renderTodayWidget(todayData);
    renderPassageWidget(passageRows);
    renderWorkflowWidget(workflowContext);
    renderIncubationWidget(incubationLocations);
    if (!incubationDialogOverlay.hidden) {
      renderIncubationLocationRows();
    }
    renderQuickLogWidget();
    renderTimerWidget();
  }

  return {
    render
  };
}
