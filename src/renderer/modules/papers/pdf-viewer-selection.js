import { clamp } from './pdf-viewer-anchors.js';

function pickRotator(textLayer, layerLeft, layerTop, parentWidth, parentHeight) {
  switch (textLayer.getAttribute('data-main-rotation')) {
    case '90':
      return (x, y, width, height) => ({
        x: (y - layerTop) / parentHeight,
        y: 1 - ((x + width - layerLeft) / parentWidth),
        width: height / parentHeight,
        height: width / parentWidth
      });
    case '180':
      return (x, y, width, height) => ({
        x: 1 - ((x + width - layerLeft) / parentWidth),
        y: 1 - ((y + height - layerTop) / parentHeight),
        width: width / parentWidth,
        height: height / parentHeight
      });
    case '270':
      return (x, y, width, height) => ({
        x: 1 - ((y + height - layerTop) / parentHeight),
        y: (x - layerLeft) / parentWidth,
        width: height / parentHeight,
        height: width / parentWidth
      });
    default:
      return (x, y, width, height) => ({
        x: (x - layerLeft) / parentWidth,
        y: (y - layerTop) / parentHeight,
        width: width / parentWidth,
        height: height / parentHeight
      });
  }
}

function findSelectionTextLayer(selection, pageLayer) {
  let textLayer = null;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range || range.collapsed) {
      continue;
    }
    const ancestor = range.commonAncestorContainer;
    const layer = (ancestor?.nodeType === 1 ? ancestor : ancestor?.parentElement)?.closest?.('.papers-viewer-text-layer') || null;
    if (!layer || !pageLayer.contains(layer) || !layer.contains(ancestor)) {
      return null;
    }
    if (textLayer && textLayer !== layer) {
      return null;
    }
    textLayer = layer;
  }
  return textLayer;
}

export function getSelectionInfo({ selection, pageLayer } = {}) {
  if (!selection || !pageLayer || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const textLayer = findSelectionTextLayer(selection, pageLayer);
  if (!textLayer) {
    return null;
  }

  const layerRect = textLayer.getBoundingClientRect?.();
  const layerLeft = Number(layerRect?.x ?? layerRect?.left);
  const layerTop = Number(layerRect?.y ?? layerRect?.top);
  const parentWidth = Number(layerRect?.width);
  const parentHeight = Number(layerRect?.height);
  if (!Number.isFinite(parentWidth) || !Number.isFinite(parentHeight) || parentWidth <= 0 || parentHeight <= 0) {
    return null;
  }

  const rotator = pickRotator(textLayer, layerLeft, layerTop, parentWidth, parentHeight);

  const boxes = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range || range.collapsed || !textLayer.contains(range.commonAncestorContainer)) {
      continue;
    }
    for (const rect of range.getClientRects()) {
      const width = Number(rect?.width);
      const height = Number(rect?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        continue;
      }
      const normalized = rotator(
        Number(rect.x ?? rect.left),
        Number(rect.y ?? rect.top),
        width,
        height
      );
      const left = clamp(normalized.x, 0, 1);
      const top = clamp(normalized.y, 0, 1);
      const right = clamp(normalized.x + normalized.width, 0, 1);
      const bottom = clamp(normalized.y + normalized.height, 0, 1);
      if (right <= left || bottom <= top) {
        continue;
      }
      boxes.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      });
    }
  }

  const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
  const pageNumber = Math.max(1, Math.round(Number(textLayer.dataset.pageNumber) || 1));
  if (!text || !boxes.length) {
    return null;
  }
  return {
    pageNumber,
    text,
    boxes
  };
}
