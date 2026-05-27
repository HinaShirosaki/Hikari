import { clamp } from './pdf-viewer-anchors.js';

const MIN_SELECTION_SPACE_GAP_PX = 4;
const MAX_SELECTION_SPACE_GAP_PX = 32;
const SELECTION_SPACE_GAP_LINE_RATIO = 1.25;
const SELECTION_LINE_OVERLAP_RATIO = 0.45;
const SELECTION_LINE_CENTER_RATIO = 0.65;

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

function getRectCenter(rect, axis) {
  return axis === 'x'
    ? (rect.left + rect.right) / 2
    : (rect.top + rect.bottom) / 2;
}

function getVerticalOverlap(left, right) {
  return Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
}

function isSameSelectionLine(left, right) {
  const minHeight = Math.max(Math.min(left.height, right.height), 1);
  const overlap = getVerticalOverlap(left, right);
  if (overlap >= minHeight * SELECTION_LINE_OVERLAP_RATIO) {
    return true;
  }
  return Math.abs(getRectCenter(left, 'y') - getRectCenter(right, 'y')) <= minHeight * SELECTION_LINE_CENTER_RATIO;
}

function normalizeClientSelectionRect(rect) {
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const left = Number(rect.x ?? rect.left);
  const top = Number(rect.y ?? rect.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function mergeClientRectIntoLine(line, rect) {
  line.rects.push(rect);
  line.bounds.left = Math.min(line.bounds.left, rect.left);
  line.bounds.top = Math.min(line.bounds.top, rect.top);
  line.bounds.right = Math.max(line.bounds.right, rect.right);
  line.bounds.bottom = Math.max(line.bounds.bottom, rect.bottom);
  line.bounds.width = line.bounds.right - line.bounds.left;
  line.bounds.height = line.bounds.bottom - line.bounds.top;
}

export function mergeSelectionClientRects(rects = []) {
  const candidates = (Array.isArray(rects) ? rects : [])
    .map(normalizeClientSelectionRect)
    .filter(Boolean)
    .sort((left, right) => {
      const topDelta = getRectCenter(left, 'y') - getRectCenter(right, 'y');
      return Math.abs(topDelta) > 1 ? topDelta : left.left - right.left;
    });

  const lines = [];
  candidates.forEach((rect) => {
    const line = lines.find((item) => isSameSelectionLine(item.bounds, rect));
    if (line) {
      mergeClientRectIntoLine(line, rect);
      return;
    }
    lines.push({ bounds: { ...rect }, rects: [rect] });
  });

  return lines
    .sort((left, right) => getRectCenter(left.bounds, 'y') - getRectCenter(right.bounds, 'y'))
    .flatMap((line) => {
      const sorted = line.rects.slice().sort((left, right) => left.left - right.left);
      const merged = [];
      sorted.forEach((rect) => {
        const current = merged[merged.length - 1] || null;
        if (!current) {
          merged.push({ ...rect });
          return;
        }

        const gap = rect.left - current.right;
        const maxLineHeight = Math.max(current.height, rect.height, 1);
        const maxJoinGap = Math.max(
          MIN_SELECTION_SPACE_GAP_PX,
          Math.min(MAX_SELECTION_SPACE_GAP_PX, maxLineHeight * SELECTION_SPACE_GAP_LINE_RATIO)
        );
        if (gap <= maxJoinGap && isSameSelectionLine(current, rect)) {
          current.left = Math.min(current.left, rect.left);
          current.top = Math.min(current.top, rect.top);
          current.right = Math.max(current.right, rect.right);
          current.bottom = Math.max(current.bottom, rect.bottom);
          current.width = current.right - current.left;
          current.height = current.bottom - current.top;
          return;
        }
        merged.push({ ...rect });
      });
      return merged;
    });
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
  const pageWidth = Number(textLayer.dataset.pageWidth) || parentWidth;
  const pageHeight = Number(textLayer.dataset.pageHeight) || parentHeight;
  if (!Number.isFinite(parentWidth) || !Number.isFinite(parentHeight) || parentWidth <= 0 || parentHeight <= 0) {
    return null;
  }

  const rotator = pickRotator(textLayer, layerLeft, layerTop, parentWidth, parentHeight);

  const clientRects = [];
  const boxes = [];
  const clientRect = {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY
  };
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range || range.collapsed || !textLayer.contains(range.commonAncestorContainer)) {
      continue;
    }
    for (const rect of range.getClientRects()) {
      const normalizedRect = normalizeClientSelectionRect(rect);
      if (!normalizedRect) {
        continue;
      }
      const { left: rectLeft, top: rectTop, right: rectRight, bottom: rectBottom } = normalizedRect;
      clientRect.left = Math.min(clientRect.left, rectLeft);
      clientRect.top = Math.min(clientRect.top, rectTop);
      clientRect.right = Math.max(clientRect.right, rectRight);
      clientRect.bottom = Math.max(clientRect.bottom, rectBottom);
      clientRects.push(normalizedRect);
    }
  }

  mergeSelectionClientRects(clientRects).forEach((rect) => {
    const normalized = rotator(
      rect.left,
      rect.top,
      rect.width,
      rect.height
    );
    const left = clamp(normalized.x, 0, 1);
    const top = clamp(normalized.y, 0, 1);
    const right = clamp(normalized.x + normalized.width, 0, 1);
    const bottom = clamp(normalized.y + normalized.height, 0, 1);
    if (right <= left || bottom <= top) {
      return;
    }
    boxes.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    });
  });

  const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
  const pageNumber = Math.max(1, Math.round(Number(textLayer.dataset.pageNumber) || 1));
  if (!text || !boxes.length) {
    return null;
  }
  return {
    pageNumber,
    text,
    boxes,
    pageWidth,
    pageHeight,
    clientRect: Number.isFinite(clientRect.left) && Number.isFinite(clientRect.top)
      ? {
          left: clientRect.left,
          top: clientRect.top,
          width: Math.max(clientRect.right - clientRect.left, 1),
          height: Math.max(clientRect.bottom - clientRect.top, 1)
        }
      : null
  };
}
