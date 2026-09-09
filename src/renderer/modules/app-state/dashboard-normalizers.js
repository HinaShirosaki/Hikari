function normalizeDashboardDateString(rawValue) {
  const value = String(rawValue || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export function normalizeDashboardPassageReminders(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const id = String(item.id || '').trim();
    const name = String(item.name || item.strain || '').trim().replace(/\s+/g, ' ');
    const rawPassage = item.cellPassage && typeof item.cellPassage === 'object'
      ? item.cellPassage
      : item;
    const lastPassageDate = normalizeDashboardDateString(rawPassage.lastPassageDate);
    const intervalDays = Math.round(Number(rawPassage.intervalDays));
    const passageNumber = Math.round(Number(rawPassage.passageNumber));
    if (
      !id
      || !name
      || !lastPassageDate
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
    const deferredUntilDate = normalizeDashboardDateString(rawPassage.deferredUntilDate);
    if (deferredUntilDate) {
      cellPassage.deferredUntilDate = deferredUntilDate;
    }
    return {
      id,
      name,
      cellPassage,
      updatedAt: String(item.updatedAt || '').trim()
    };
  }).filter(Boolean);
}

export function normalizeDashboardIncubationLocations(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  const seen = new Set();
  const locations = [];
  rawValue.forEach((item) => {
    const rawName = item && typeof item === 'object' && !Array.isArray(item) ? item.name : item;
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      return;
    }
    seen.add(key);
    locations.push({
      name,
      reminderDate: item && typeof item === 'object' && !Array.isArray(item)
        ? normalizeDashboardDateString(item.reminderDate || item.remindOnDate)
        : ''
    });
  });
  return locations;
}

export function normalizeDashboardTimerTemplates(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    const durationMinutes = Math.round(Number(item.durationMinutes || item.minutes));
    return name && Number.isFinite(durationMinutes) && durationMinutes > 0
      ? { name, durationMinutes }
      : null;
  }).filter(Boolean);
}

export function normalizeDashboardActiveTimers(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const name = String(item.name || '').trim().replace(/\s+/g, ' ');
    const durationMinutes = Math.round(Number(item.durationMinutes || item.minutes));
    const startedAtMs = Number(item.startedAtMs || item.startedAt || 0);
    const endAtMs = Number(item.endAtMs || item.endAt || 0);
    const isPaused = item.isPaused === true || item.paused === true;
    const remainingMs = Math.max(0, Number(item.remainingMs || item.pausedRemainingMs || 0));
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
  }).filter(Boolean);
}

export function normalizeDashboardQuickLogEntries(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const id = String(item.id || '').trim();
    const text = String(item.text || item.note || '').trim();
    const createdAt = String(item.createdAt || item.updatedAt || '').trim();
    const updatedAt = String(item.updatedAt || item.createdAt || '').trim() || createdAt;
    return id && text && !Number.isNaN(Date.parse(createdAt))
      ? { id, text, createdAt, updatedAt }
      : null;
  }).filter(Boolean);
}

export function normalizeWorkflowProgressMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }
  const normalized = {};
  Object.entries(rawValue).forEach(([workflowId, rawBlockIds]) => {
    const key = String(workflowId || '').trim();
    if (!key) {
      return;
    }
    const seen = new Set();
    normalized[key] = (Array.isArray(rawBlockIds) ? rawBlockIds : []).reduce((blockIds, blockId) => {
      const normalizedId = String(blockId || '').trim();
      if (normalizedId && !seen.has(normalizedId)) {
        seen.add(normalizedId);
        blockIds.push(normalizedId);
      }
      return blockIds;
    }, []);
  });
  return normalized;
}
