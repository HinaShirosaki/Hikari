import * as papersModule from './papers/index.js';
import * as papersNormalizers from './papers/normalizers.js';

export function initPapersManagement(options) {
  return papersModule.initPapersManagement({
    ...options,
    document: typeof document !== 'undefined' ? document : null,
    window: typeof window !== 'undefined' ? window : null
  });
}

export function normalizePaperSummary(rawSummary) {
  return papersNormalizers.normalizePaperSummary(rawSummary);
}
