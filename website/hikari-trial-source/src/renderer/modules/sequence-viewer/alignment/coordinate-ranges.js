function normalizeCircularRange(start, end, referenceLength) {
  let safeStart = Math.max(0, Math.floor(Number(start) || 0));
  let safeEnd = Math.max(safeStart, Math.floor(Number(end) || 0));

  while (safeStart >= referenceLength && safeEnd > referenceLength) {
    safeStart -= referenceLength;
    safeEnd -= referenceLength;
  }

  const spanLength = safeEnd - safeStart;
  if (spanLength > referenceLength) {
    return null;
  }

  if (safeEnd <= referenceLength) {
    return {
      start: safeStart,
      end: safeEnd,
      wraps: false
    };
  }

  return {
    start: safeStart % referenceLength,
    end: safeEnd % referenceLength,
    wraps: true
  };
}

function normalizeReferenceCoordinate(value, referenceLength) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  const safeLength = Math.max(1, Number(referenceLength) || 1);
  let normalized = Math.floor(Number(value) || 0);
  while (normalized >= safeLength) {
    normalized -= safeLength;
  }
  while (normalized < 0) {
    normalized += safeLength;
  }
  return normalized;
}

function normalizeCircularDifferenceRange(start, end, referenceLength) {
  let safeStart = Math.max(0, Math.floor(Number(start) || 0));
  let safeEnd = Math.max(safeStart, Math.floor(Number(end) || 0));

  while (safeStart >= referenceLength && safeEnd > referenceLength) {
    safeStart -= referenceLength;
    safeEnd -= referenceLength;
  }

  if (safeEnd <= referenceLength) {
    return {
      start: safeStart,
      end: safeEnd
    };
  }

  return {
    start: normalizeReferenceCoordinate(safeStart, referenceLength),
    end: normalizeReferenceCoordinate(safeEnd, referenceLength)
  };
}

export {
  normalizeCircularDifferenceRange,
  normalizeCircularRange
};
