function clampUnitInterval(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : Number.NaN;
}

export function normalizePaperComment(rawComment) {
  if (!rawComment || typeof rawComment !== 'object' || Array.isArray(rawComment)) {
    return null;
  }
  const id = String(rawComment.id || '').trim();
  const pageNumber = Math.round(Number(rawComment.pageNumber));
  const anchorX = clampUnitInterval(rawComment.anchorX);
  const anchorY = clampUnitInterval(rawComment.anchorY);
  const highlightId = String(rawComment.highlightId || '').trim();
  const text = String(rawComment.text || '').trim();
  const hasAnchor = Number.isFinite(anchorX) && Number.isFinite(anchorY);
  if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || (!hasAnchor && !highlightId) || !text) {
    return null;
  }
  return {
    ...rawComment,
    id,
    pageNumber,
    ...(hasAnchor ? { anchorX, anchorY } : {}),
    ...(highlightId ? { highlightId } : {}),
    text,
    author: String(rawComment.author || 'Local user').trim() || 'Local user',
    createdAt: String(rawComment.createdAt || rawComment.updatedAt || '').trim(),
    updatedAt: String(rawComment.updatedAt || rawComment.createdAt || '').trim()
  };
}

export function normalizePaperHighlight(rawHighlight) {
  if (!rawHighlight || typeof rawHighlight !== 'object' || Array.isArray(rawHighlight)) {
    return null;
  }
  const id = String(rawHighlight.id || '').trim();
  const pageNumber = Math.round(Number(rawHighlight.pageNumber));
  const text = String(rawHighlight.text || '').trim();
  const kind = String(rawHighlight.kind || rawHighlight.type || '').trim().toLowerCase() === 'underline'
    ? 'underline'
    : 'highlight';
  const boxes = (Array.isArray(rawHighlight.boxes) ? rawHighlight.boxes : []).map((box) => {
    if (!box || typeof box !== 'object' || Array.isArray(box)) {
      return null;
    }
    const x = clampUnitInterval(box.x);
    const y = clampUnitInterval(box.y);
    const width = clampUnitInterval(box.width);
    const height = clampUnitInterval(box.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      return null;
    }
    const normalizedWidth = Math.max(Math.min(width, 1 - x), 0);
    const normalizedHeight = Math.max(Math.min(height, 1 - y), 0);
    return normalizedWidth > 0 && normalizedHeight > 0
      ? { x, y, width: normalizedWidth, height: normalizedHeight }
      : null;
  }).filter(Boolean);
  if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !text || !boxes.length) {
    return null;
  }
  return {
    ...rawHighlight,
    id,
    pageNumber,
    text,
    kind,
    boxes,
    createdAt: String(rawHighlight.createdAt || rawHighlight.updatedAt || '').trim(),
    updatedAt: String(rawHighlight.updatedAt || rawHighlight.createdAt || '').trim()
  };
}

export function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object' || Array.isArray(rawPaper)) {
    return rawPaper;
  }
  const hasStoredPdfReference = Boolean(String(rawPaper.storedFilePath || '').trim())
    || Boolean(String(rawPaper.storedRelativePath || '').trim());
  return {
    ...rawPaper,
    pdfDataUrl: hasStoredPdfReference ? '' : String(rawPaper.pdfDataUrl || ''),
    highlights: Array.isArray(rawPaper.highlights)
      ? rawPaper.highlights.map((highlight) => normalizePaperHighlight(highlight)).filter(Boolean)
      : [],
    comments: Array.isArray(rawPaper.comments)
      ? rawPaper.comments.map((comment) => normalizePaperComment(comment)).filter(Boolean)
      : []
  };
}
