function normalizeCellPassage(rawValue) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const lastPassageDate = String(rawValue.lastPassageDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastPassageDate)) {
    return null;
  }
  const intervalDays = Math.round(Number(rawValue.intervalDays));
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    return null;
  }
  const normalized = { lastPassageDate, intervalDays };
  const passageNumber = Math.round(Number(rawValue.passageNumber));
  if (Number.isFinite(passageNumber) && passageNumber > 0) {
    normalized.passageNumber = passageNumber;
  }
  const deferredUntilDate = String(rawValue.deferredUntilDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(deferredUntilDate)) {
    normalized.deferredUntilDate = deferredUntilDate;
  }
  return normalized;
}

export function normalizeSampleRecord(rawSample) {
  if (!rawSample || typeof rawSample !== 'object') {
    return rawSample;
  }
  const type = String(rawSample.type || '').trim().toLowerCase();
  if (type === 'cell_line') {
    return {
      ...rawSample,
      cellPassage: normalizeCellPassage(rawSample.cellPassage)
    };
  }
  if (Object.prototype.hasOwnProperty.call(rawSample, 'cellPassage')) {
    const { cellPassage, ...rest } = rawSample;
    return rest;
  }
  return rawSample;
}
