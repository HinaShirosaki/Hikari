import { clamp } from './pdf-viewer-anchors.js';

const QUAD_POINT_STRIDE = 8;

function roundGeometryValue(value) {
  return Number((Number(value) || 0).toFixed(6));
}

export function normalizePageDimension(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function normalizeQuadPointList(quadPoints) {
  const source = ArrayBuffer.isView(quadPoints)
    ? Array.from(quadPoints)
    : Array.isArray(quadPoints)
      ? quadPoints
      : [];
  const values = [];
  for (let index = 0; index < source.length; index += QUAD_POINT_STRIDE) {
    const group = source.slice(index, index + QUAD_POINT_STRIDE).map((value) => Number(value));
    if (group.length !== QUAD_POINT_STRIDE || group.some((value) => !Number.isFinite(value))) {
      continue;
    }
    values.push(...group);
  }
  return values.map(roundGeometryValue);
}

export function normalizeHighlightBoxes(boxes) {
  return (Array.isArray(boxes) ? boxes : [])
    .map((box) => {
      if (!box || typeof box !== 'object') {
        return null;
      }
      const left = clamp(Number(box.x) || 0, 0, 1);
      const top = clamp(Number(box.y) || 0, 0, 1);
      const width = clamp(Number(box.width) || 0, 0, 1);
      const height = clamp(Number(box.height) || 0, 0, 1);
      if (width <= 0 || height <= 0) {
        return null;
      }
      const right = clamp(left + width, 0, 1);
      const bottom = clamp(top + height, 0, 1);
      if (right <= left || bottom <= top) {
        return null;
      }
      return {
        x: roundGeometryValue(left),
        y: roundGeometryValue(top),
        width: roundGeometryValue(right - left),
        height: roundGeometryValue(bottom - top)
      };
    })
    .filter(Boolean);
}

export function boxesToPdfQuadPoints(boxes, {
  pageWidth = 0,
  pageHeight = 0,
  pageX = 0,
  pageY = 0
} = {}) {
  const width = normalizePageDimension(pageWidth);
  const height = normalizePageDimension(pageHeight);
  if (!width || !height) {
    return [];
  }

  const quadPoints = [];
  normalizeHighlightBoxes(boxes).forEach((box) => {
    const left = (box.x * width) + pageX;
    const right = left + (box.width * width);
    const top = ((1 - box.y) * height) + pageY;
    const bottom = top - (box.height * height);
    // PDF.js serializes highlight rectangles as tL, tR, bL, bR in PDF page coordinates.
    quadPoints.push(left, top, right, top, left, bottom, right, bottom);
  });
  return quadPoints.map(roundGeometryValue);
}

export function pdfQuadPointsToBoxes(quadPoints, {
  pageWidth = 0,
  pageHeight = 0,
  pageX = 0,
  pageY = 0
} = {}) {
  const width = normalizePageDimension(pageWidth);
  const height = normalizePageDimension(pageHeight);
  if (!width || !height) {
    return [];
  }

  const values = normalizeQuadPointList(quadPoints);
  const boxes = [];
  for (let index = 0; index < values.length; index += QUAD_POINT_STRIDE) {
    const xs = [
      values[index],
      values[index + 2],
      values[index + 4],
      values[index + 6]
    ];
    const ys = [
      values[index + 1],
      values[index + 3],
      values[index + 5],
      values[index + 7]
    ];
    const left = clamp((Math.min(...xs) - pageX) / width, 0, 1);
    const right = clamp((Math.max(...xs) - pageX) / width, 0, 1);
    const top = clamp(1 - ((Math.max(...ys) - pageY) / height), 0, 1);
    const bottom = clamp(1 - ((Math.min(...ys) - pageY) / height), 0, 1);
    if (right <= left || bottom <= top) {
      continue;
    }
    boxes.push({
      x: roundGeometryValue(left),
      y: roundGeometryValue(top),
      width: roundGeometryValue(right - left),
      height: roundGeometryValue(bottom - top)
    });
  }
  return boxes;
}

export function buildHighlightSvgPath(boxes) {
  return normalizeHighlightBoxes(boxes)
    .map((box) => {
      const left = roundGeometryValue(box.x);
      const top = roundGeometryValue(box.y);
      const right = roundGeometryValue(box.x + box.width);
      const bottom = roundGeometryValue(box.y + box.height);
      return `M${left} ${top}H${right}V${bottom}H${left}Z`;
    })
    .join(' ');
}
