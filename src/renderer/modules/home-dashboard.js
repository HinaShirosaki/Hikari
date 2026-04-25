import { buildClarifiedNotebookNote, clarifyNotebookNote, showTransientNotice } from './notebook-note-tools.js';

// Home dashboard controller.
//
// Responsibilities:
// - summarize urgent bench work for the home screen
// - surface contribution activity, cell-passage reminders, and overnight incubation locations
// - provide lightweight lab timers with reusable named countdowns
// - save quick-log notes and optionally bridge them into the assistant workspace
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
  const passageSummary = document.getElementById('dashboard-passage-summary');
  const passageList = document.getElementById('dashboard-passage-list');
  const passageAddBtn = document.getElementById('dashboard-passage-add-btn');
  const passageDialogOverlay = document.getElementById('dashboard-passage-dialog-overlay');
  const passageDialogForm = document.getElementById('dashboard-passage-dialog-form');
  const passageStrainInput = document.getElementById('dashboard-passage-strain-input');
  const passageIntervalInput = document.getElementById('dashboard-passage-interval-input');
  const passageNumberInput = document.getElementById('dashboard-passage-number-input');

  const contributionSummary = document.getElementById('dashboard-contribution-summary');
  const contributionMonthLabels = document.getElementById('dashboard-contribution-months');
  const contributionGrid = document.getElementById('dashboard-contribution-grid');

  const incubationSummary = document.getElementById('dashboard-incubation-summary');
  const incubationList = document.getElementById('dashboard-incubation-list');
  const incubationAddBtn = document.getElementById('dashboard-incubation-add-btn');
  const incubationDialogOverlay = document.getElementById('dashboard-incubation-dialog-overlay');
  const incubationLocationList = document.getElementById('dashboard-incubation-location-list');
  const incubationLocationForm = document.getElementById('dashboard-incubation-location-form');
  const incubationLocationInput = document.getElementById('dashboard-incubation-location-input');

  const quickLogInput = document.getElementById('dashboard-quick-log-input');
  const quickLogStatus = document.getElementById('dashboard-quick-log-status');
  const quickLogSaveBtn = document.getElementById('dashboard-quick-log-save-btn');
  const quickLogAgentBtn = document.getElementById('dashboard-quick-log-agent-btn');

  const notebookPagesStatus = document.getElementById('dashboard-notebook-pages-status');
  const notebookPageList = document.getElementById('dashboard-notebook-page-list');
  const notebookNoteDialogOverlay = document.getElementById('dashboard-notebook-note-dialog-overlay');
  const notebookNoteDialogForm = document.getElementById('dashboard-notebook-note-dialog-form');
  const notebookNoteDialogPage = document.getElementById('dashboard-notebook-note-dialog-page');
  const notebookNoteInput = document.getElementById('dashboard-notebook-note-input');
  const notebookNoteClarifyBtn = document.getElementById('dashboard-notebook-note-clarify-btn');

  const localTimeDisplay = document.getElementById('dashboard-local-time');
  const localDateDisplay = document.getElementById('dashboard-local-date');
  const timerStatus = document.getElementById('dashboard-timer-status');
  const timerActiveList = document.getElementById('dashboard-timer-active-list');
  const timerOpenBtn = document.getElementById('dashboard-timer-open-btn');
  const timerDialogOverlay = document.getElementById('dashboard-timer-dialog-overlay');
  const timerDialogForm = document.getElementById('dashboard-timer-dialog-form');
  const timerNameInput = document.getElementById('dashboard-timer-name-input');
  const timerMinutesInput = document.getElementById('dashboard-timer-minutes-input');
  const timerTemplateList = document.getElementById('dashboard-timer-template-list');
  const quickActionButtons = [...document.querySelectorAll('[data-dashboard-action]')];

  if (
    !passageSummary
    || !passageList
    || !passageAddBtn
    || !passageDialogOverlay
    || !passageDialogForm
    || !passageStrainInput
    || !passageIntervalInput
    || !passageNumberInput
    || !contributionSummary
    || !contributionMonthLabels
    || !contributionGrid
    || !incubationSummary
    || !incubationList
    || !incubationAddBtn
    || !incubationDialogOverlay
    || !incubationLocationList
    || !incubationLocationForm
    || !incubationLocationInput
    || !quickLogInput
    || !quickLogStatus
    || !quickLogSaveBtn
    || !quickLogAgentBtn
    || !notebookPagesStatus
    || !notebookPageList
    || !notebookNoteDialogOverlay
    || !notebookNoteDialogForm
    || !notebookNoteDialogPage
    || !notebookNoteInput
    || !notebookNoteClarifyBtn
    || !localTimeDisplay
    || !localDateDisplay
    || !timerStatus
    || !timerActiveList
    || !timerOpenBtn
    || !timerDialogOverlay
    || !timerDialogForm
    || !timerNameInput
    || !timerMinutesInput
    || !timerTemplateList
  ) {
    return {
      render: () => {}
    };
  }

  let timerTickHandle = 0;
  let localClockHandle = 0;
  let notebookNoteEntryId = '';

  passageList.addEventListener('click', onPassageListClick);
  passageAddBtn.addEventListener('click', openPassageDialog);
  passageDialogForm.addEventListener('submit', onPassageDialogSubmit);
  passageDialogOverlay.addEventListener('click', onPassageDialogOverlayClick);
  incubationAddBtn.addEventListener('click', openIncubationDialog);
  incubationList.addEventListener('click', onIncubationListClick);
  incubationDialogOverlay.addEventListener('click', onIncubationDialogOverlayClick);
  incubationLocationForm.addEventListener('submit', onIncubationLocationSubmit);
  incubationLocationList.addEventListener('click', onIncubationLocationListClick);
  quickActionButtons.forEach((button) => {
    button.addEventListener('click', onQuickActionClick);
  });
  quickLogInput.addEventListener('input', onQuickLogInput);
  quickLogInput.addEventListener('keydown', onQuickLogKeydown);
  quickLogSaveBtn.addEventListener('click', onQuickLogSave);
  quickLogAgentBtn.addEventListener('click', onQuickLogSendToAgent);
  notebookPageList.addEventListener('click', onNotebookPageListClick);
  notebookNoteDialogOverlay.addEventListener('click', onNotebookNoteDialogOverlayClick);
  notebookNoteDialogForm.addEventListener('submit', onNotebookNoteDialogSubmit);
  notebookNoteClarifyBtn.addEventListener('click', onNotebookNoteClarifyAndSave);
  timerOpenBtn.addEventListener('click', openTimerDialog);
  timerDialogOverlay.addEventListener('click', onTimerDialogOverlayClick);
  timerDialogForm.addEventListener('submit', onTimerDialogSubmit);
  timerTemplateList.addEventListener('click', onTimerTemplateListClick);
  timerActiveList.addEventListener('click', onTimerActiveListClick);
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
        quickLogEntries: [],
        incubationLocations: [],
        timerTemplates: [],
        activeTimers: []
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
    if (!Array.isArray(state.settings.dashboard.quickLogEntries)) {
      state.settings.dashboard.quickLogEntries = [];
      changed = true;
    } else {
      const normalizedQuickLogs = state.settings.dashboard.quickLogEntries
        .map(normalizeQuickLogRecord)
        .filter(Boolean)
        .slice(-500);
      const rawQuickLogs = state.settings.dashboard.quickLogEntries;
      const quickLogsChanged = normalizedQuickLogs.length !== rawQuickLogs.length
        || normalizedQuickLogs.some((entry, index) => (
          entry.id !== rawQuickLogs[index]?.id
          || entry.text !== rawQuickLogs[index]?.text
          || entry.createdAt !== rawQuickLogs[index]?.createdAt
          || entry.updatedAt !== rawQuickLogs[index]?.updatedAt
        ));
      if (quickLogsChanged) {
        state.settings.dashboard.quickLogEntries = normalizedQuickLogs;
        changed = true;
      }
    }
    if (!Array.isArray(state.settings.dashboard.incubationLocations)) {
      state.settings.dashboard.incubationLocations = [];
      changed = true;
    } else {
      const normalizedLocations = state.settings.dashboard.incubationLocations
        .map(normalizeIncubationLocationRecord)
        .filter(Boolean);
      const rawLocations = state.settings.dashboard.incubationLocations;
      const locationsChanged = normalizedLocations.length !== rawLocations.length
        || normalizedLocations.some((location, index) => (
          location.name !== rawLocations[index]?.name
          || location.reminderDate !== rawLocations[index]?.reminderDate
        ));
      if (locationsChanged) {
        state.settings.dashboard.incubationLocations = normalizedLocations;
        changed = true;
      }
    }
    if (!Array.isArray(state.settings.dashboard.timerTemplates)) {
      state.settings.dashboard.timerTemplates = [];
      changed = true;
    } else {
      const normalizedTemplates = state.settings.dashboard.timerTemplates
        .map(normalizeTimerTemplateRecord)
        .filter(Boolean);
      const rawTemplates = state.settings.dashboard.timerTemplates;
      const templatesChanged = normalizedTemplates.length !== rawTemplates.length
        || normalizedTemplates.some((template, index) => (
          template.name !== rawTemplates[index]?.name
          || template.durationMinutes !== rawTemplates[index]?.durationMinutes
        ));
      if (templatesChanged) {
        state.settings.dashboard.timerTemplates = normalizedTemplates;
        changed = true;
      }
    }
    if (!Array.isArray(state.settings.dashboard.activeTimers)) {
      state.settings.dashboard.activeTimers = [];
      changed = true;
    } else {
      const normalizedActiveTimers = state.settings.dashboard.activeTimers
        .map(normalizeActiveTimerRecord)
        .filter(Boolean);
      const rawActiveTimers = state.settings.dashboard.activeTimers;
      const activeTimersChanged = normalizedActiveTimers.length !== rawActiveTimers.length
        || normalizedActiveTimers.some((timer, index) => (
          timer.name !== rawActiveTimers[index]?.name
          || timer.durationMinutes !== rawActiveTimers[index]?.durationMinutes
          || timer.startedAtMs !== rawActiveTimers[index]?.startedAtMs
          || timer.endAtMs !== rawActiveTimers[index]?.endAtMs
        ));
      if (activeTimersChanged) {
        state.settings.dashboard.activeTimers = normalizedActiveTimers;
        changed = true;
      }
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

  function normalizeIncubationLocationRecord(rawValue) {
    const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? rawValue
      : { name: rawValue };
    const name = normalizeIncubationLocationValue(source.name);
    if (!name) {
      return null;
    }
    const reminderDate = /^\d{4}-\d{2}-\d{2}$/.test(String(source.reminderDate || source.remindOnDate || '').trim())
      ? String(source.reminderDate || source.remindOnDate || '').trim()
      : '';
    return {
      name,
      reminderDate
    };
  }

  function normalizeTimerTemplateRecord(rawValue) {
    const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? rawValue
      : null;
    const name = normalizeIncubationLocationValue(source?.name);
    const durationMinutes = Math.round(Number(source?.durationMinutes || source?.minutes));
    if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }
    return {
      name,
      durationMinutes
    };
  }

  function normalizeActiveTimerRecord(rawValue) {
    const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? rawValue
      : null;
    const name = normalizeIncubationLocationValue(source?.name);
    const durationMinutes = Math.round(Number(source?.durationMinutes || source?.minutes));
    const startedAtMs = Number(source?.startedAtMs || source?.startedAt || 0);
    const endAtMs = Number(source?.endAtMs || source?.endAt || 0);
    if (
      !name
      || !Number.isFinite(durationMinutes)
      || durationMinutes <= 0
      || !Number.isFinite(startedAtMs)
      || startedAtMs <= 0
      || !Number.isFinite(endAtMs)
      || endAtMs <= startedAtMs
    ) {
      return null;
    }
    return {
      name,
      durationMinutes,
      startedAtMs,
      endAtMs
    };
  }

  function normalizeQuickLogRecord(rawValue) {
    const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? rawValue
      : null;
    const id = String(source?.id || '').trim();
    const text = String(source?.text || source?.note || '').trim();
    const createdAt = String(source?.createdAt || source?.updatedAt || '').trim();
    const updatedAt = String(source?.updatedAt || source?.createdAt || '').trim() || createdAt;
    if (!id || !text || Number.isNaN(Date.parse(createdAt))) {
      return null;
    }
    return {
      id,
      text,
      createdAt,
      updatedAt
    };
  }

  function formatTimerTemplateDuration(minutes) {
    const rounded = Math.max(1, Math.round(Number(minutes) || 0));
    return `${rounded} min`;
  }

  function notebookPageLabel(entry) {
    return String(entry?.protocolName || entry?.workflowContext?.workflowBlockTitle || 'Untitled Page').trim()
      || 'Untitled Page';
  }

  function formatNotebookTimestamp(timestamp) {
    const parsed = new Date(String(timestamp || '').trim());
    if (Number.isNaN(parsed.getTime())) {
      return 'Unknown update';
    }
    return parsed.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function quickLogId() {
    const generatedId = String(createId() || '').trim();
    if (generatedId) {
      return generatedId;
    }
    return `quick-log-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  }

  function normalizeNotebookState(value) {
    return String(value || '').trim().toLowerCase() === 'planned' ? 'planned' : 'executed';
  }

  function dayKeyFromTimestamp(timestamp) {
    const parsed = new Date(String(timestamp || '').trim());
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return formatDateLocal(parsed);
  }

  function createContributionBucket() {
    return {
      notebookEntries: 0,
      completedProtocols: 0,
      dataUploads: 0,
      analysisNotes: 0,
      quickLogs: 0,
      total: 0
    };
  }

  function addContributionActivity(dayMap, timestamp, kind, weight = 1) {
    const dayKey = dayKeyFromTimestamp(timestamp);
    if (!dayKey) {
      return;
    }
    const amount = Math.max(1, Math.round(Number(weight) || 1));
    const bucket = dayMap.get(dayKey) || createContributionBucket();
    if (!Object.prototype.hasOwnProperty.call(bucket, kind)) {
      return;
    }
    bucket[kind] += amount;
    bucket.total += amount;
    dayMap.set(dayKey, bucket);
  }

  function resultTableHasContent(table) {
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    return rows.some((row) => Object.entries(row || {}).some(([key, value]) => (
      key !== 'id' && String(value || '').trim()
    )));
  }

  function collectFileRecordActivity(dayMap, records, fallbackTimestamp) {
    const fileRecords = Array.isArray(records) ? records : [];
    fileRecords.forEach((record) => {
      addContributionActivity(
        dayMap,
        record?.importedAt || record?.updatedAt || fallbackTimestamp,
        'dataUploads'
      );
    });
  }

  function collectNotebookContribution(dayMap) {
    (Array.isArray(state.notebookEntries) ? state.notebookEntries : []).forEach((entry) => {
      const entryTimestamp = entry?.updatedAt || entry?.executedAt || entry?.createdAt;
      addContributionActivity(dayMap, entryTimestamp, 'notebookEntries');

      const isExecuted = normalizeNotebookState(entry?.notebookState) !== 'planned';
      if (isExecuted && (entry?.protocolId || entry?.protocolName || entry?.executedAt)) {
        addContributionActivity(dayMap, entry?.executedAt || entryTimestamp, 'completedProtocols');
      }

      const resultFileRecords = Array.isArray(entry?.resultFileRecords) ? entry.resultFileRecords : [];
      collectFileRecordActivity(dayMap, resultFileRecords, entryTimestamp);
      if (!resultFileRecords.length && Array.isArray(entry?.resultFiles) && entry.resultFiles.length) {
        addContributionActivity(dayMap, entryTimestamp, 'dataUploads', entry.resultFiles.length);
      }

      if (String(entry?.result || '').trim()) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
      if (resultTableHasContent(entry?.resultTable)) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
      if (Array.isArray(entry?.selectionInsights) && entry.selectionInsights.length) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
    });
  }

  function collectWorkflowContribution(dayMap) {
    (Array.isArray(state.workflows) ? state.workflows : []).forEach((workflow) => {
      (Array.isArray(workflow?.entries) ? workflow.entries : []).forEach((entry) => {
        const stepStates = entry?.stepStates && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
          ? entry.stepStates
          : {};
        Object.values(stepStates).forEach((stepState) => {
          const stepTimestamp = stepState?.updatedAt || stepState?.completedAt || workflow?.updatedAt || workflow?.createdAt;
          if (String(stepState?.status || '').trim().toLowerCase() === 'completed' || stepState?.completedAt) {
            addContributionActivity(dayMap, stepState?.completedAt || stepTimestamp, 'completedProtocols');
          }
          collectFileRecordActivity(dayMap, stepState?.resultFileRecords, stepTimestamp);
          if (
            (!Array.isArray(stepState?.resultFileRecords) || !stepState.resultFileRecords.length)
            && Array.isArray(stepState?.resultFiles)
            && stepState.resultFiles.length
          ) {
            addContributionActivity(dayMap, stepTimestamp, 'dataUploads', stepState.resultFiles.length);
          }
          if (String(stepState?.result || '').trim()) {
            addContributionActivity(dayMap, stepTimestamp, 'analysisNotes');
          }
        });
      });
    });
  }

  function collectAnalysisContribution(dayMap) {
    (Array.isArray(state.assays) ? state.assays : []).forEach((assay) => {
      const timestamp = assay?.updatedAt || assay?.createdAt;
      if (assay?.resultValues && typeof assay.resultValues === 'object' && Object.keys(assay.resultValues).length) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      if (assay?.latestAnalysis && typeof assay.latestAnalysis === 'object') {
        addContributionActivity(dayMap, assay.latestAnalysis.updatedAt || timestamp, 'analysisNotes');
      }
    });

    (Array.isArray(state.gelAnalyses) ? state.gelAnalyses : []).forEach((analysis) => {
      const timestamp = analysis?.updatedAt || analysis?.createdAt;
      if (analysis?.imageName || analysis?.report || analysis?.previewImagePath || analysis?.previewImageDataUrl) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      addContributionActivity(dayMap, timestamp, 'analysisNotes');
    });
  }

  function collectQuickLogContribution(dayMap) {
    (Array.isArray(state.settings?.dashboard?.quickLogEntries) ? state.settings.dashboard.quickLogEntries : [])
      .forEach((entry) => {
        addContributionActivity(dayMap, entry?.createdAt || entry?.updatedAt, 'quickLogs');
      });
  }

  function collectContributionActivity() {
    const dayMap = new Map();
    collectNotebookContribution(dayMap);
    collectWorkflowContribution(dayMap);
    collectAnalysisContribution(dayMap);
    collectQuickLogContribution(dayMap);
    return dayMap;
  }

  function startOfWeek(date) {
    const clone = new Date(date);
    clone.setHours(0, 0, 0, 0);
    clone.setDate(clone.getDate() - clone.getDay());
    return clone;
  }

  function addDays(date, days) {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  function contributionLevel(total) {
    const count = Number(total) || 0;
    if (count <= 0) {
      return 0;
    }
    if (count === 1) {
      return 1;
    }
    if (count <= 3) {
      return 2;
    }
    if (count <= 6) {
      return 3;
    }
    return 4;
  }

  function buildContributionDays(dayMap) {
    const weekCount = 22;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = startOfWeek(today);
    start.setDate(start.getDate() - ((weekCount - 1) * 7));
    return Array.from({ length: weekCount * 7 }, (_item, index) => {
      const date = addDays(start, index);
      const dayKey = formatDateLocal(date);
      const bucket = dayMap.get(dayKey) || createContributionBucket();
      return {
        date,
        dayKey,
        bucket,
        level: contributionLevel(bucket.total),
        isFuture: date.getTime() > today.getTime()
      };
    });
  }

  function formatContributionDate(date) {
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatContributionPart(count, label) {
    const value = Number(count) || 0;
    if (!value) {
      return '';
    }
    return `${value} ${label}${value === 1 ? '' : 's'}`;
  }

  function contributionCellLabel(day) {
    const total = Number(day.bucket.total) || 0;
    const dateLabel = formatContributionDate(day.date);
    if (!total) {
      return `No logged activity on ${dateLabel}`;
    }
    const parts = [
      formatContributionPart(day.bucket.notebookEntries, 'notebook entry'),
      formatContributionPart(day.bucket.completedProtocols, 'completed protocol'),
      formatContributionPart(day.bucket.dataUploads, 'data upload'),
      formatContributionPart(day.bucket.analysisNotes, 'analysis note'),
      formatContributionPart(day.bucket.quickLogs, 'quick log')
    ].filter(Boolean);
    return `${total} logged activit${total === 1 ? 'y' : 'ies'} on ${dateLabel}: ${parts.join(', ')}`;
  }

  function renderContributionMonthLabels(days) {
    const seenMonths = new Set();
    const labels = [];
    days.forEach((day, index) => {
      const monthKey = `${day.date.getFullYear()}-${day.date.getMonth()}`;
      if (seenMonths.has(monthKey)) {
        return;
      }
      if (index > 0 && day.date.getDate() > 7) {
        return;
      }
      seenMonths.add(monthKey);
      labels.push({
        column: Math.floor(index / 7) + 1,
        label: day.date.toLocaleDateString([], { month: 'short' })
      });
    });
    const weekCount = Math.ceil(days.length / 7);
    contributionMonthLabels.style.gridTemplateColumns = `repeat(${weekCount}, var(--contribution-cell-size))`;
    contributionMonthLabels.innerHTML = labels.map((label) => `
      <span class="home-contribution-month-label" style="grid-column: ${label.column} / span 3;">${safeText(label.label)}</span>
    `).join('');
  }

  function renderContributionWidget(dayMap) {
    const days = buildContributionDays(dayMap);
    const visibleDays = days.filter((day) => !day.isFuture);
    const activeDays = visibleDays.filter((day) => day.bucket.total > 0).length;
    const totalActivity = visibleDays.reduce((sum, day) => sum + day.bucket.total, 0);
    const todayKey = formatDateLocal(new Date());
    const todayTotal = dayMap.get(todayKey)?.total || 0;
    contributionSummary.textContent = totalActivity
      ? `${totalActivity} logged activit${totalActivity === 1 ? 'y' : 'ies'} across ${activeDays} active day${activeDays === 1 ? '' : 's'} | Today: ${todayTotal}`
      : 'No activity logged in the last 18 weeks.';

    renderContributionMonthLabels(days);
    contributionGrid.innerHTML = days.map((day) => `
      <span
        class="home-contribution-cell"
        data-level="${day.isFuture ? 0 : day.level}"
        role="gridcell"
        tabindex="0"
        title="${safeText(contributionCellLabel(day))}"
        aria-label="${safeText(contributionCellLabel(day))}"
      ></span>
    `).join('');
  }

  function renderIncubationLocationRows() {
    const locations = Array.isArray(state.settings?.dashboard?.incubationLocations)
      ? state.settings.dashboard.incubationLocations
      : [];
    incubationLocationList.innerHTML = locations.map((location, index) => `
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

  function openNotebookNoteDialog(entry, initialNote = '') {
    notebookNoteEntryId = String(entry?.id || '').trim();
    notebookNoteDialogPage.textContent = `${notebookPageLabel(entry)} | ${String(entry?.projectName || 'No project').trim() || 'No project'}`;
    notebookNoteDialogForm.reset();
    notebookNoteInput.value = String(initialNote || '').trim();
    notebookNoteDialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      notebookNoteInput.focus();
    });
  }

  function closeNotebookNoteDialog() {
    notebookNoteEntryId = '';
    notebookNoteDialogForm.reset();
    notebookNoteDialogOverlay.hidden = true;
    notebookNoteDialogPage.textContent = '';
  }

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

  function onTimerDialogOverlayClick(event) {
    if (event.target !== timerDialogOverlay) {
      return;
    }
    closeTimerDialog();
  }

  function onNotebookNoteDialogOverlayClick(event) {
    if (event.target !== notebookNoteDialogOverlay) {
      return;
    }
    closeNotebookNoteDialog();
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
    if (!timerDialogOverlay.hidden) {
      event.preventDefault();
      closeTimerDialog();
      return;
    }
    if (!notebookNoteDialogOverlay.hidden) {
      event.preventDefault();
      closeNotebookNoteDialog();
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
      .some((item) => normalizeIncubationLocationValue(item?.name).toLowerCase() === value.toLowerCase());
    if (existing) {
      incubationLocationInput.focus();
      incubationLocationInput.select();
      return;
    }
    state.settings.dashboard.incubationLocations.push({
      name: value,
      reminderDate: ''
    });
    persist();
    render();
    incubationLocationForm.reset();
    incubationLocationInput.focus();
  }

  function onTimerDialogSubmit(event) {
    event.preventDefault();
    ensureDashboardState();
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

  function onNotebookPageListClick(event) {
    const button = event.target.closest('[data-dashboard-notebook-entry]');
    if (!button) {
      return;
    }
    const entryId = String(button.dataset.dashboardNotebookEntry || '').trim();
    const entry = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .find((item) => String(item?.id || '').trim() === entryId);
    if (!entry) {
      return;
    }
    openNotebookNoteDialog(entry);
  }

  function onNotebookNoteDialogSubmit(event) {
    event.preventDefault();
    const note = String(notebookNoteInput.value || '').trim();
    if (!note) {
      return;
    }
    if (!appendNoteToNotebookEntry(notebookNoteEntryId, note)) {
      return;
    }
    closeNotebookNoteDialog();
    render();
  }

  function appendNoteToNotebookEntry(entryId, note) {
    const cleanEntryId = String(entryId || '').trim();
    const cleanNote = String(note || '').trim();
    if (!cleanEntryId || !cleanNote) {
      return false;
    }
    const index = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .findIndex((item) => String(item?.id || '').trim() === cleanEntryId);
    if (index < 0) {
      return false;
    }
    const currentEntry = state.notebookEntries[index];
    const timestamp = new Date();
    const noteLine = `[${timestamp.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })}] ${note}`;
    const existingResult = String(currentEntry?.result || '').trim();
    state.notebookEntries[index] = {
      ...currentEntry,
      result: existingResult ? `${existingResult}\n\n${noteLine}` : noteLine,
      updatedAt: timestamp.toISOString()
    };
    persist();
    return true;
  }

  async function onNotebookNoteClarifyAndSave() {
    const entryId = String(notebookNoteEntryId || '').trim();
    const originalNote = String(notebookNoteInput.value || '').trim();
    if (!entryId || !originalNote) {
      showTransientNotice('Add a note before clarifying it.', { type: 'error' });
      return;
    }
    const entry = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .find((item) => String(item?.id || '').trim() === entryId);
    closeNotebookNoteDialog();
    try {
      const clarifiedNote = await clarifyNotebookNote({
        llm: state.settings?.llm,
        text: originalNote
      });
      const noteToSave = buildClarifiedNotebookNote(originalNote, clarifiedNote);
      if (!appendNoteToNotebookEntry(entryId, noteToSave)) {
        throw new Error('Unable to save the clarified note.');
      }
      render();
      showTransientNotice('Clarified note saved.');
    } catch (error) {
      if (entry) {
        openNotebookNoteDialog(entry, originalNote);
      }
      showTransientNotice(String(error?.message || error || 'Failed to clarify the note.'), {
        type: 'error'
      });
    }
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

  function sampleLabel(sample) {
    const code = String(sample?.code || '').trim();
    const name = String(sample?.name || '').trim();
    if (code && name) {
      return `${code} - ${name}`;
    }
    return code || name || String(sample?.id || 'Unnamed sample');
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
    const dueCount = locations.filter((location) => location.isDue).length;
    const scheduledCount = locations.filter((location) => location.dayDelta !== null && location.dayDelta > 0).length;
    incubationSummary.textContent = locations.length
      ? `Due today: ${dueCount} | Scheduled: ${scheduledCount}`
      : 'No incubation locations yet.';
    if (!locations.length) {
      incubationList.innerHTML = '<p class="small-note">Add an incubation location to track overnight setups here.</p>';
      return;
    }
    incubationList.innerHTML = locations.map((location) => `
      <article class="dashboard-incubation-row${location.isDue ? ' is-due' : ''}">
        <div class="dashboard-incubation-copy">
          <strong class="dashboard-incubation-title">${safeText(location.name)}</strong>
          <p class="dashboard-incubation-detail">${safeText(location.detail)}</p>
        </div>
        <button
          type="button"
          class="dashboard-incubation-action"
          data-dashboard-incubation-remind="${location.sourceIndex}"
          aria-label="Set reminder for tomorrow for ${safeText(location.name)}"
        >
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
            <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"></path>
          </svg>
        </button>
      </article>
    `).join('');
  }

  function collectRecentNotebookPages() {
    return (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .slice()
      .sort((left, right) => (
        new Date(String(right?.updatedAt || right?.createdAt || 0)).getTime()
        - new Date(String(left?.updatedAt || left?.createdAt || 0)).getTime()
      ))
      .slice(0, 6);
  }

  function renderRecentNotebookPages(entries) {
    notebookPagesStatus.textContent = entries.length
      ? 'Tap a page to add a note.'
      : 'No notebook pages yet.';
    if (!entries.length) {
      notebookPageList.innerHTML = '<p class="small-note">Save a notebook page to show it here.</p>';
      return;
    }
    notebookPageList.innerHTML = entries.map((entry) => `
      <button
        type="button"
        class="dashboard-notebook-page-row"
        data-dashboard-notebook-entry="${safeText(entry.id)}"
      >
        <strong class="dashboard-notebook-page-title">${safeText(notebookPageLabel(entry))}</strong>
        <p class="dashboard-notebook-page-meta">${safeText(`${String(entry?.projectName || 'No project').trim() || 'No project'} | Updated ${formatNotebookTimestamp(entry?.updatedAt || entry?.createdAt)}`)}</p>
      </button>
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
    const hasDraft = Boolean(String(state.settings.dashboard.quickLogDraft || '').trim());
    quickLogSaveBtn.disabled = !hasDraft;
    quickLogAgentBtn.disabled = !hasDraft;
    if (hasDraft) {
      setQuickLogStatus('Draft saved locally.');
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
    ensureDashboardState();
    const nowIso = new Date().toISOString();
    const entry = {
      id: quickLogId(),
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

  function render() {
    let changed = ensureDashboardState();
    changed = ensureSamplesState() || changed;
    if (!localClockHandle) {
      renderLocalClock();
      localClockHandle = window.setInterval(renderLocalClock, 1000);
    }

    const passageRows = collectPassageRows();
    const contributionActivity = collectContributionActivity();
    const incubationLocations = collectIncubationLocations();
    const recentNotebookPages = collectRecentNotebookPages();

    if (changed) {
      persist();
    }

    renderContributionWidget(contributionActivity);
    renderPassageWidget(passageRows);
    renderIncubationWidget(incubationLocations);
    renderRecentNotebookPages(recentNotebookPages);
    if (!incubationDialogOverlay.hidden) {
      renderIncubationLocationRows();
    }
    renderQuickLogWidget();
    renderTimerWidget();
    if (!timerDialogOverlay.hidden) {
      renderTimerTemplateRows();
    }
  }

  return {
    render
  };
}
