import { normalizeCellPassage } from '../../lib/cell-passage.js';

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
