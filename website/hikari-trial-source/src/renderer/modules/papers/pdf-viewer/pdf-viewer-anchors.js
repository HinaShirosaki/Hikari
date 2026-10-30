export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function clampCommentAnchor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }
  return clamp(numeric, 0, 1);
}

export function computePdfAnchorFromClientPoint({ clientX, clientY, rect } = {}) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    anchorX: clampCommentAnchor((Number(clientX) - Number(rect.left || 0)) / width),
    anchorY: clampCommentAnchor((Number(clientY) - Number(rect.top || 0)) / height)
  };
}

export function getPdfCommentPinPosition(anchorX, anchorY) {
  const left = clampCommentAnchor(anchorX);
  const top = clampCommentAnchor(anchorY);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return {
      left: '0%',
      top: '0%'
    };
  }
  return {
    left: `${(left * 100).toFixed(3)}%`,
    top: `${(top * 100).toFixed(3)}%`
  };
}
