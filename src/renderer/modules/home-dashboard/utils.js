// Shared helpers for the home-dashboard widgets.
//
// Date conversions, normalizers for persisted dashboard records, and the
// state ensures live here so each widget module can stay independent and
// import only what it needs.

export function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateString) {
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

export function formatRelativeDays(dayDelta) {
  if (dayDelta === 0) {
    return 'due today';
  }
  if (dayDelta > 0) {
    return `due in ${dayDelta} day(s)`;
  }
  return `overdue by ${Math.abs(dayDelta)} day(s)`;
}

export function formatTimerTemplateDuration(minutes) {
  const rounded = Math.max(1, Math.round(Number(minutes) || 0));
  return `${rounded} min`;
}

// Timer presets are persisted in whole minutes, while the dashboard form
// accepts common bench notation such as "90 min", "1.5 h", or "1 h 30 min".
// A bare number remains a minutes value so existing entries and habits work.
export function parseTimerDuration(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const minutes = Math.round(Number(raw));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  const segmentPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/gi;
  let totalMinutes = 0;
  let lastEnd = 0;
  let match;
  while ((match = segmentPattern.exec(raw))) {
    if (!/^\s*$/.test(raw.slice(lastEnd, match.index))) {
      return null;
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }
    totalMinutes += amount * (/^(hours?|hrs?|hr|h)$/.test(unit) ? 60 : 1);
    lastEnd = segmentPattern.lastIndex;
  }

  if (lastEnd === 0 || !/^\s*$/.test(raw.slice(lastEnd))) {
    return null;
  }
  const minutes = Math.round(totalMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function notebookPageLabel(entry) {
  return String(entry?.protocolName || entry?.workflowContext?.workflowBlockTitle || 'Untitled Page').trim()
    || 'Untitled Page';
}

export function formatNotebookTimestamp(timestamp) {
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

export function normalizeNotebookState(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['planned', 'suggested'].includes(status) ? status : 'executed';
}

export function normalizeIncubationLocationValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeIncubationLocationRecord(rawValue) {
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

export function normalizeTimerTemplateRecord(rawValue) {
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

export function normalizeActiveTimerRecord(rawValue) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? rawValue
    : null;
  const name = normalizeIncubationLocationValue(source?.name);
  const durationMinutes = Math.round(Number(source?.durationMinutes || source?.minutes));
  const startedAtMs = Number(source?.startedAtMs || source?.startedAt || 0);
  const endAtMs = Number(source?.endAtMs || source?.endAt || 0);
  const isPaused = source?.isPaused === true || source?.paused === true;
  const remainingMs = Math.max(0, Number(source?.remainingMs || source?.pausedRemainingMs || 0));
  if (
    !name
    || !Number.isFinite(durationMinutes)
    || durationMinutes <= 0
    || !Number.isFinite(startedAtMs)
    || startedAtMs <= 0
    || !Number.isFinite(endAtMs)
    || endAtMs <= startedAtMs
    || !Number.isFinite(remainingMs)
  ) {
    return null;
  }
  return {
    name,
    durationMinutes,
    startedAtMs,
    endAtMs,
    isPaused,
    remainingMs: isPaused ? remainingMs : 0
  };
}

export function normalizeQuickLogRecord(rawValue) {
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

export function passageReminderId(createId) {
  const generatedId = String((createId && createId()) || '').trim();
  if (generatedId) {
    return generatedId;
  }
  return `passage-reminder-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

export function quickLogId(createId) {
  const generatedId = String((createId && createId()) || '').trim();
  if (generatedId) {
    return generatedId;
  }
  return `quick-log-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

export function normalizeSampleCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

export function sampleLabel(sample) {
  const code = String(sample?.code || '').trim();
  const name = String(sample?.name || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(sample?.id || 'Unnamed sample');
}

export function ensureSamplesState(state) {
  if (!Array.isArray(state.samples)) {
    state.samples = [];
    return true;
  }
  return false;
}

function normalizePassageReminderRecord(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }
  const id = String(rawValue.id || '').trim();
  const name = String(rawValue.name || rawValue.strain || '').trim().replace(/\s+/g, ' ');
  const rawPassage = rawValue.cellPassage && typeof rawValue.cellPassage === 'object'
    ? rawValue.cellPassage
    : rawValue;
  const lastPassageDate = String(rawPassage.lastPassageDate || '').trim();
  const intervalDays = Math.round(Number(rawPassage.intervalDays));
  const passageNumber = Math.round(Number(rawPassage.passageNumber));
  if (
    !id
    || !name
    || !parseLocalDate(lastPassageDate)
    || !Number.isFinite(intervalDays)
    || intervalDays <= 0
    || !Number.isFinite(passageNumber)
    || passageNumber <= 0
  ) {
    return null;
  }
  const cellPassage = {
    lastPassageDate,
    intervalDays,
    passageNumber
  };
  const deferredUntilDate = String(rawPassage.deferredUntilDate || '').trim();
  if (parseLocalDate(deferredUntilDate)) {
    cellPassage.deferredUntilDate = deferredUntilDate;
  }
  return {
    id,
    name,
    cellPassage,
    updatedAt: String(rawValue.updatedAt || '').trim()
  };
}

function isEmptyLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return true;
  }
  return Object.values(location).every((value) => !String(value || '').trim());
}

function hasSampleReference(state, sample) {
  const ids = new Set([
    String(sample?.id || '').trim(),
    String(sample?.code || '').trim()
  ].filter(Boolean));
  return (Array.isArray(state.notebookEntries) ? state.notebookEntries : []).some((entry) => {
    const referenceIds = Array.isArray(entry?.references?.sampleIds) ? entry.references.sampleIds : [];
    const sampleLinks = Array.isArray(entry?.sampleLinks) ? entry.sampleLinks : [];
    return referenceIds.some((value) => ids.has(String(value || '').trim()))
      || sampleLinks.some((link) => ids.has(String(link?.sampleId || link?.sampleCode || '').trim()));
  });
}

function isLegacyDashboardPassageSample(state, sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return false;
  }
  if (String(sample.type || '').trim().toLowerCase() !== 'cell_line') {
    return false;
  }
  const reminder = normalizePassageReminderRecord(sample);
  if (!reminder || hasSampleReference(state, sample)) {
    return false;
  }
  const generatedBase = normalizeSampleCode(reminder.name).slice(0, 24) || 'CELL';
  const code = String(sample.code || '').trim();
  const generatedCodePattern = new RegExp(`^${generatedBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-\\d+)?$`, 'i');
  return generatedCodePattern.test(code)
    && !String(sample.lot || '').trim()
    && !String(sample.concentration || '').trim()
    && !String(sample.notes || '').trim()
    && isEmptyLocation(sample.location)
    && !sample.inventoryLink
    && (!Array.isArray(sample.chemicalLinks) || sample.chemicalLinks.length === 0)
    && !sample.compoundStructure;
}

export function ensureDashboardState(state) {
  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = {};
  }
  if (!state.settings.dashboard || typeof state.settings.dashboard !== 'object') {
    state.settings.dashboard = {
      currentWorkflowId: '',
      workflowProgress: {},
      quickLogDraft: '',
      quickLogEntries: [],
      passageReminders: [],
      legacyPassageSamplesMigrated: false,
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
      .filter(Boolean);
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
  if (!Array.isArray(state.settings.dashboard.passageReminders)) {
    state.settings.dashboard.passageReminders = [];
    changed = true;
  } else {
    const normalizedReminders = state.settings.dashboard.passageReminders
      .map(normalizePassageReminderRecord)
      .filter(Boolean);
    const rawReminders = state.settings.dashboard.passageReminders;
    const remindersChanged = normalizedReminders.length !== rawReminders.length
      || normalizedReminders.some((reminder, index) => (
        JSON.stringify(reminder) !== JSON.stringify(rawReminders[index])
      ));
    if (remindersChanged) {
      state.settings.dashboard.passageReminders = normalizedReminders;
      changed = true;
    }
  }
  if (typeof state.settings.dashboard.legacyPassageSamplesMigrated !== 'boolean') {
    state.settings.dashboard.legacyPassageSamplesMigrated = false;
    changed = true;
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
        || timer.isPaused !== (rawActiveTimers[index]?.isPaused === true)
        || timer.remainingMs !== Math.max(0, Number(rawActiveTimers[index]?.remainingMs || 0))
      ));
    if (activeTimersChanged) {
      state.settings.dashboard.activeTimers = normalizedActiveTimers;
      changed = true;
    }
  }
  return changed;
}

export function migrateLegacyPassageSamples(state) {
  ensureDashboardState(state);
  const dashboard = state.settings.dashboard;
  if (dashboard.legacyPassageSamplesMigrated) {
    return false;
  }

  const existingReminderIds = new Set(
    dashboard.passageReminders.map((reminder) => String(reminder.id || '').trim()).filter(Boolean)
  );
  const retainedSamples = [];
  (Array.isArray(state.samples) ? state.samples : []).forEach((sample) => {
    if (!isLegacyDashboardPassageSample(state, sample)) {
      retainedSamples.push(sample);
      return;
    }
    const reminder = normalizePassageReminderRecord(sample);
    if (reminder && !existingReminderIds.has(reminder.id)) {
      dashboard.passageReminders.push(reminder);
      existingReminderIds.add(reminder.id);
    }
  });

  state.samples = retainedSamples;
  dashboard.legacyPassageSamplesMigrated = true;
  return true;
}
