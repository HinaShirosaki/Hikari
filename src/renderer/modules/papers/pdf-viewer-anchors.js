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

export function getHighlightMarkerBox(box = {}) {
  const left = clamp(Number(box.x) || 0, 0, 1);
  const top = clamp(Number(box.y) || 0, 0, 1);
  const width = clamp(Number(box.width) || 0, 0, 1);
  const height = clamp(Number(box.height) || 0, 0, 1);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const adjustedTop = clamp(top + (height * 0.3), 0, 1);
  const adjustedBottom = clamp(top + (height * 1.02), 0, 1);
  if (adjustedBottom <= adjustedTop) {
    return null;
  }

  return {
    left,
    top: adjustedTop,
    width: Math.min(width, 1 - left),
    height: adjustedBottom - adjustedTop
  };
}
