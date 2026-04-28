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
  return String(value || '').trim().toLowerCase() === 'planned' ? 'planned' : 'executed';
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

export function nextSampleId(createId) {
  const generatedId = String((createId && createId()) || '').trim();
  if (generatedId) {
    return generatedId;
  }
  return `sample-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
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

export function buildPassageReminderCode(state, strain) {
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
