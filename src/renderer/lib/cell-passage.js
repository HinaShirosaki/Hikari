// A passage schedule needs a YYYY-MM-DD last date and a positive interval;
// otherwise null (no schedule). passageNumber and deferredUntilDate are optional.
export function normalizeCellPassage(rawValue) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const lastPassageDate = String(rawValue.lastPassageDate || '').trim();
  const intervalDays = Math.round(Number(rawValue.intervalDays));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastPassageDate) || !Number.isFinite(intervalDays) || intervalDays <= 0) {
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
