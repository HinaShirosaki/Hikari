import { normalizeCellPassage } from '../../lib/cell-passage.js';

export { normalizeCellPassage };

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
