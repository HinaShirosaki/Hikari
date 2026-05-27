export function normalizeCellPassage(rawValue) {
  const dateValue = String(rawValue?.lastPassageDate || '').trim();
  const interval = Math.round(Number(rawValue?.intervalDays));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !Number.isFinite(interval) || interval <= 0) {
    return null;
  }
  const normalized = {
    lastPassageDate: dateValue,
    intervalDays: interval
  };
  const passageNumber = Math.round(Number(rawValue?.passageNumber));
  if (Number.isFinite(passageNumber) && passageNumber > 0) {
    normalized.passageNumber = passageNumber;
  }
  const deferredUntilDate = String(rawValue?.deferredUntilDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(deferredUntilDate)) {
    normalized.deferredUntilDate = deferredUntilDate;
  }
  return normalized;
}

export function readCellPassage(ctx, existingValue = null) {
  const existing = normalizeCellPassage(existingValue);
  return normalizeCellPassage({
    lastPassageDate: ctx.dom.samplePassageLastDateInput?.value,
    intervalDays: ctx.dom.samplePassageIntervalDaysInput?.value,
    passageNumber: existing?.passageNumber,
    deferredUntilDate: existing?.deferredUntilDate
  });
}

export function fillCellPassage(ctx, cellPassage) {
  const normalized = normalizeCellPassage(cellPassage);
  if (ctx.dom.samplePassageLastDateInput) {
    ctx.dom.samplePassageLastDateInput.value = normalized?.lastPassageDate || '';
  }
  if (ctx.dom.samplePassageIntervalDaysInput) {
    ctx.dom.samplePassageIntervalDaysInput.value = normalized?.intervalDays ? String(normalized.intervalDays) : '';
  }
}

export function formatCellPassage(cellPassage) {
  const normalized = normalizeCellPassage(cellPassage);
  if (!normalized) {
    return 'Unconfigured';
  }
  const detail = [`Last: ${normalized.lastPassageDate}`, `Every ${normalized.intervalDays} day(s)`];
  if (normalized.passageNumber) {
    detail.push(`P${normalized.passageNumber}`);
  }
  if (normalized.deferredUntilDate) {
    detail.push(`Deferred to ${normalized.deferredUntilDate}`);
  }
  return detail.join(' | ');
}

export function renderCellPassageFields(ctx) {
  const { sampleCellPassageFields, sampleTypeInput } = ctx.dom;
  if (!sampleCellPassageFields) {
    return;
  }
  const isCellLine = sampleTypeInput?.value === 'cell_line';
  sampleCellPassageFields.hidden = !isCellLine;
  if (!isCellLine) {
    fillCellPassage(ctx, null);
  }
}
