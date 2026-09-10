export const NOTEBOOK_PDF_PAGE_SIZES = Object.freeze([
  'letter',
  'a4',
  'a5',
  'legal'
]);

export const NOTEBOOK_PDF_STAPLE_EDGES = Object.freeze([
  'none',
  'left',
  'top'
]);

export const NOTEBOOK_PDF_STAPLE_REGION_POINTS = 36;

export const DEFAULT_NOTEBOOK_PDF_SETTINGS = Object.freeze({
  pageSize: 'letter',
  stapleEdge: 'none'
});

export function normalizeNotebookPdfSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const pageSize = String(source.pageSize || '').trim().toLowerCase();
  const stapleEdge = String(source.stapleEdge || '').trim().toLowerCase();

  return {
    pageSize: NOTEBOOK_PDF_PAGE_SIZES.includes(pageSize)
      ? pageSize
      : DEFAULT_NOTEBOOK_PDF_SETTINGS.pageSize,
    stapleEdge: NOTEBOOK_PDF_STAPLE_EDGES.includes(stapleEdge)
      ? stapleEdge
      : DEFAULT_NOTEBOOK_PDF_SETTINGS.stapleEdge
  };
}

export function resolveNotebookPdfMargins(value = {}, baseMargin = 72) {
  const settings = normalizeNotebookPdfSettings(value);
  const margin = Number.isFinite(Number(baseMargin)) && Number(baseMargin) >= 0
    ? Number(baseMargin)
    : 72;

  return {
    top: margin + (settings.stapleEdge === 'top' ? NOTEBOOK_PDF_STAPLE_REGION_POINTS : 0),
    right: margin,
    bottom: margin,
    left: margin + (settings.stapleEdge === 'left' ? NOTEBOOK_PDF_STAPLE_REGION_POINTS : 0)
  };
}
