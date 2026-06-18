export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sampleArrayValue(data, width, height, x, y) {
  const safeX = clamp(Number(x) || 0, 0, width - 1);
  const safeY = clamp(Number(y) || 0, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = (data[(y0 * width) + x0] * (1 - tx)) + (data[(y0 * width) + x1] * tx);
  const bottom = (data[(y1 * width) + x0] * (1 - tx)) + (data[(y1 * width) + x1] * tx);
  return (top * (1 - ty)) + (bottom * ty);
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function confidenceLabel(score) {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.5) {
    return 'medium';
  }
  return 'low';
}

export function createEmptyManualOverrides() {
  return {
    laneSegmentation: {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null,
      perLaneBandEnabled: false,
      laneBandWindows: [],
      laneVertices: [],
      quantifyConfirmed: false
    },
    addedBands: [],
    ladderLane: null,
    ladderBands: [],
    ladderBandsDone: false,
    peakIntegrations: [],
    laneTable: {
      rows: []
    }
  };
}

const LANE_VERTEX_KEYS = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);

function normalizeOptionalPixel(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function normalizeVertexPoint(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y))
  };
}

export function normalizeLaneBandWindows(raw) {
  const byLane = new Map();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const laneValue = Number(item?.laneIndex ?? item?.lane ?? item?.index);
    const laneIndex = Number.isFinite(laneValue) && laneValue >= 1
      ? Math.floor(laneValue)
      : null;
    if (!laneIndex) {
      return;
    }
    const bandTop = normalizeOptionalPixel(item?.bandTop ?? item?.top ?? item?.yTop);
    const bandBottom = normalizeOptionalPixel(item?.bandBottom ?? item?.bottom ?? item?.yBottom);
    if (!Number.isFinite(bandTop) && !Number.isFinite(bandBottom)) {
      return;
    }
    byLane.set(laneIndex, {
      laneIndex,
      bandTop,
      bandBottom
    });
  });

  return [...byLane.values()].sort((a, b) => a.laneIndex - b.laneIndex);
}

export function normalizeLaneVertices(raw) {
  const byLane = new Map();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const laneValue = Number(item?.laneIndex ?? item?.lane ?? item?.index);
    const laneIndex = Number.isFinite(laneValue) && laneValue >= 1
      ? Math.floor(laneValue)
      : null;
    if (!laneIndex) {
      return;
    }

    const source = Array.isArray(item?.vertices) && item.vertices.length >= 4
      ? {
        topLeft: item.vertices[0],
        topRight: item.vertices[1],
        bottomRight: item.vertices[2],
        bottomLeft: item.vertices[3]
      }
      : item;
    const points = {};
    const allValid = LANE_VERTEX_KEYS.every((key) => {
      const point = normalizeVertexPoint(source?.[key]);
      if (!point) {
        return false;
      }
      points[key] = point;
      return true;
    });
    if (!allValid) {
      return;
    }

    byLane.set(laneIndex, {
      laneIndex,
      ...points
    });
  });

  return [...byLane.values()].sort((a, b) => a.laneIndex - b.laneIndex);
}

function normalizePeakPoint(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = normalizeOptionalPixel(raw.row ?? raw.pixelY ?? raw.y);
  if (!Number.isFinite(row)) {
    return null;
  }
  const value = Number(raw.value ?? raw.intensity);
  return {
    row,
    value: Number.isFinite(value) ? value : null
  };
}

export function normalizePeakIntegrations(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const laneValue = Number(item?.laneIndex ?? item?.lane ?? item?.index);
      const laneIndex = Number.isFinite(laneValue) && laneValue >= 1
        ? Math.floor(laneValue)
        : null;
      if (!laneIndex) {
        return null;
      }

      const left = normalizePeakPoint(item?.left ?? item?.baselineLeft ?? item?.start);
      const right = normalizePeakPoint(item?.right ?? item?.baselineRight ?? item?.end);
      if (!left && !right) {
        return null;
      }

      const dividers = (Array.isArray(item?.dividers) ? item.dividers : [])
        .map((value) => Math.floor(Number(value?.row ?? value?.pixelY ?? value)))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b)
        .filter((value, index, all) => index === 0 || value !== all[index - 1]);

      return {
        laneIndex,
        left,
        right,
        dividers
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.laneIndex !== b.laneIndex) {
        return a.laneIndex - b.laneIndex;
      }
      const aRow = Math.min(a.left?.row ?? Number.POSITIVE_INFINITY, a.right?.row ?? Number.POSITIVE_INFINITY);
      const bRow = Math.min(b.left?.row ?? Number.POSITIVE_INFINITY, b.right?.row ?? Number.POSITIVE_INFINITY);
      return aRow - bRow;
    });
}

export function buildDefaultLaneVertices(lane, height = 1) {
  const bottomY = Math.max(0, Math.floor(Number(height) || 1) - 1);
  const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
  const xEnd = Math.max(xStart + 1, Math.floor(Number(lane?.xEnd) || xStart + 1));
  return {
    topLeft: { x: xStart, y: 0 },
    topRight: { x: xEnd, y: 0 },
    bottomRight: { x: xEnd, y: bottomY },
    bottomLeft: { x: xStart, y: bottomY }
  };
}

export function clampLaneVertices(vertices, width = Number.POSITIVE_INFINITY, height = Number.POSITIVE_INFINITY) {
  const maxX = Number.isFinite(width) ? Math.max(0, Math.floor(width) - 1) : Number.POSITIVE_INFINITY;
  const maxY = Number.isFinite(height) ? Math.max(0, Math.floor(height) - 1) : Number.POSITIVE_INFINITY;
  const output = {};
  LANE_VERTEX_KEYS.forEach((key) => {
    const point = normalizeVertexPoint(vertices?.[key]) || { x: 0, y: 0 };
    output[key] = {
      x: Math.min(maxX, point.x),
      y: Math.min(maxY, point.y)
    };
  });
  return output;
}

export function getLaneVerticesForLane(laneSegmentation = {}, laneIndex, lane, width = null, height = null) {
  const targetLane = Math.floor(Number(laneIndex));
  const saved = normalizeLaneVertices(laneSegmentation?.laneVertices)
    .find((item) => item.laneIndex === targetLane);
  const source = saved || {
    laneIndex: targetLane,
    ...buildDefaultLaneVertices(lane, height)
  };
  return {
    laneIndex: targetLane,
    ...clampLaneVertices(source, width, height)
  };
}

export function getLaneVertexBounds(vertices, width = Number.POSITIVE_INFINITY) {
  const points = LANE_VERTEX_KEYS
    .map((key) => normalizeVertexPoint(vertices?.[key]))
    .filter(Boolean);
  if (!points.length) {
    return null;
  }
  const maxX = Number.isFinite(width) ? Math.max(0, Math.floor(width) - 1) : Number.POSITIVE_INFINITY;
  const minX = Math.min(...points.map((point) => point.x));
  const maxPointX = Math.max(...points.map((point) => point.x));
  return {
    xStart: Math.max(0, Math.min(maxX, Math.floor(minX))),
    xEnd: Math.max(0, Math.min(maxX, Math.ceil(maxPointX)))
  };
}

export function getLaneVertexArray(lane) {
  const vertices = lane?.vertices || lane;
  return LANE_VERTEX_KEYS
    .map((key) => normalizeVertexPoint(vertices?.[key]))
    .filter(Boolean);
}

function distanceBetweenPoints(a, b) {
  if (!a || !b) {
    return 0;
  }
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function interpolatePoint(start, end, fraction) {
  const t = Math.min(1, Math.max(0, Number(fraction) || 0));
  return {
    x: start.x + ((end.x - start.x) * t),
    y: start.y + ((end.y - start.y) * t)
  };
}

function subtractPoints(a, b) {
  return {
    x: Number(a?.x) - Number(b?.x),
    y: Number(a?.y) - Number(b?.y)
  };
}

function dotPoints(a, b) {
  return (a.x * b.x) + (a.y * b.y);
}

function crossPoints(a, b) {
  return (a.x * b.y) - (a.y * b.x);
}

function normalizeVector(vector) {
  const length = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y));
  if (!Number.isFinite(length) || length <= 1e-9) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function getLaneAxisGeometry(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 4) {
    return null;
  }

  const topCenter = midpoint(vertices[0], vertices[1]);
  const bottomCenter = midpoint(vertices[3], vertices[2]);
  const leftAxis = normalizeVector(subtractPoints(vertices[3], vertices[0]));
  const rightAxis = normalizeVector(subtractPoints(vertices[2], vertices[1]));
  const centerAxis = normalizeVector(subtractPoints(bottomCenter, topCenter));
  let axis = null;
  if (leftAxis && rightAxis) {
    axis = normalizeVector({
      x: leftAxis.x + rightAxis.x,
      y: leftAxis.y + rightAxis.y
    });
  }
  axis = axis || leftAxis || rightAxis || centerAxis;
  if (!axis) {
    return null;
  }

  let across = normalizeVector({ x: -axis.y, y: axis.x });
  const topEdge = subtractPoints(vertices[1], vertices[0]);
  if (across && dotPoints(across, topEdge) < 0) {
    across = { x: -across.x, y: -across.y };
  }
  if (!across) {
    return null;
  }

  return {
    axis,
    across,
    topCenter,
    bottomCenter
  };
}

function projectEdgeWidth(start, end, across) {
  return Math.abs(dotPoints(subtractPoints(end, start), across));
}

function addLineIntersection(intersections, center, direction, distance) {
  if (!Number.isFinite(distance)) {
    return;
  }
  intersections.push({
    distance,
    point: {
      x: center.x + (direction.x * distance),
      y: center.y + (direction.y * distance)
    }
  });
}

function getLinePolygonIntersections(center, direction, vertices) {
  const intersections = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const edge = subtractPoints(end, start);
    const fromCenter = subtractPoints(start, center);
    const denominator = crossPoints(direction, edge);

    if (Math.abs(denominator) <= 1e-9) {
      if (Math.abs(crossPoints(fromCenter, direction)) <= 1e-6) {
        addLineIntersection(intersections, center, direction, dotPoints(subtractPoints(start, center), direction));
        addLineIntersection(intersections, center, direction, dotPoints(subtractPoints(end, center), direction));
      }
      continue;
    }

    const lineDistance = crossPoints(fromCenter, edge) / denominator;
    const edgeFraction = crossPoints(fromCenter, direction) / denominator;
    if (edgeFraction >= -1e-6 && edgeFraction <= 1 + 1e-6) {
      addLineIntersection(intersections, center, direction, lineDistance);
    }
  }

  return intersections
    .sort((a, b) => a.distance - b.distance)
    .filter((entry, index, all) => index === 0 || Math.abs(entry.distance - all[index - 1].distance) > 1e-5);
}

export function getLaneRectifiedHeight(_lane, fallbackHeight = 1) {
  return Math.max(1, Math.floor(Number(fallbackHeight) || 1));
}

export function getLaneRectifiedWidth(lane) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length >= 4) {
    const geometry = getLaneAxisGeometry(vertices);
    const topWidth = geometry
      ? projectEdgeWidth(vertices[0], vertices[1], geometry.across)
      : distanceBetweenPoints(vertices[0], vertices[1]);
    const bottomWidth = geometry
      ? projectEdgeWidth(vertices[3], vertices[2], geometry.across)
      : distanceBetweenPoints(vertices[3], vertices[2]);
    return Math.max(1, Math.round(((topWidth + bottomWidth) / 2) + 1));
  }
  const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
  const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
  return Math.max(1, xEnd - xStart + 1);
}

export function getLaneRowSegment(lane, rowY, imageHeight = null) {
  const rectifiedHeight = getLaneRectifiedHeight(lane, imageHeight);
  const safeRow = clamp(Math.round(Number(rowY) || 0), 0, rectifiedHeight - 1);
  const t = rectifiedHeight <= 1 ? 0 : safeRow / (rectifiedHeight - 1);
  const vertices = getLaneVertexArray(lane);
  if (vertices.length >= 4) {
    const geometry = getLaneAxisGeometry(vertices);
    if (geometry) {
      const center = interpolatePoint(geometry.topCenter, geometry.bottomCenter, t);
      const intersections = getLinePolygonIntersections(center, geometry.across, vertices);
      if (intersections.length >= 2) {
        return {
          row: safeRow,
          t,
          left: intersections[0].point,
          right: intersections[intersections.length - 1].point
        };
      }
    }
    return {
      row: safeRow,
      t,
      left: interpolatePoint(vertices[0], vertices[3], t),
      right: interpolatePoint(vertices[1], vertices[2], t)
    };
  }
  const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
  const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
  return {
    row: safeRow,
    t,
    left: { x: xStart, y: safeRow },
    right: { x: xEnd, y: safeRow }
  };
}

export function getLaneRowBounds(lane, rowY, width = Number.POSITIVE_INFINITY) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    const xStart = Math.max(0, Math.floor(Number(lane?.xStart) || 0));
    const xEnd = Math.max(xStart, Math.floor(Number(lane?.xEnd) || xStart));
    return { xStart, xEnd };
  }

  const scanY = Math.round(Number(rowY));
  if (!Number.isFinite(scanY)) {
    return null;
  }

  const intersections = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (start.y === end.y) {
      continue;
    }
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    if (scanY < minY || scanY > maxY) {
      continue;
    }
    const t = (scanY - start.y) / (end.y - start.y);
    if (t < 0 || t > 1) {
      continue;
    }
    intersections.push(start.x + ((end.x - start.x) * t));
  }

  const unique = intersections
    .sort((a, b) => a - b)
    .filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 0.001);
  if (unique.length < 2) {
    return null;
  }

  const maxX = Number.isFinite(width) ? Math.max(0, Math.floor(width) - 1) : Number.POSITIVE_INFINITY;
  const xStart = Math.max(0, Math.min(maxX, Math.ceil(unique[0])));
  const xEnd = Math.max(0, Math.min(maxX, Math.floor(unique[unique.length - 1])));
  return xEnd >= xStart ? { xStart, xEnd } : null;
}

export function laneContainsPoint(lane, x, y, width = Number.POSITIVE_INFINITY) {
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    const bounds = getLaneRowBounds(lane, y, width);
    return Boolean(bounds && x >= bounds.xStart && x <= bounds.xEnd);
  }
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const current = vertices[index];
    const last = vertices[previous];
    const crosses = ((current.y > y) !== (last.y > y))
      && (x < (((last.x - current.x) * (y - current.y)) / ((last.y - current.y) || 1e-9)) + current.x);
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

export function lanePointToRectifiedRow(lane, point, imageHeight = null) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return null;
  }
  const rectifiedHeight = getLaneRectifiedHeight(lane, imageHeight);
  const vertices = getLaneVertexArray(lane);
  if (vertices.length < 4) {
    return clamp(Math.round(Number(point.y)), 0, rectifiedHeight - 1);
  }

  const topCenter = {
    x: (vertices[0].x + vertices[1].x) / 2,
    y: (vertices[0].y + vertices[1].y) / 2
  };
  const bottomCenter = {
    x: (vertices[3].x + vertices[2].x) / 2,
    y: (vertices[3].y + vertices[2].y) / 2
  };
  const axis = {
    x: bottomCenter.x - topCenter.x,
    y: bottomCenter.y - topCenter.y
  };
  const axisLengthSq = (axis.x * axis.x) + (axis.y * axis.y);
  if (axisLengthSq <= 1e-9) {
    return clamp(Math.round(Number(point.y)), 0, rectifiedHeight - 1);
  }
  const t = (((Number(point.x) - topCenter.x) * axis.x) + ((Number(point.y) - topCenter.y) * axis.y)) / axisLengthSq;
  return clamp(Math.round(t * (rectifiedHeight - 1)), 0, rectifiedHeight - 1);
}

export function isPerLaneBandMode(laneSegmentation = {}) {
  return Boolean(
    laneSegmentation?.perLaneBandEnabled
    || laneSegmentation?.perLaneBandMode
    || laneSegmentation?.laneBandMode
  );
}

export function hasCompleteLaneBandWindow(window) {
  return Number.isFinite(window?.bandTop) && Number.isFinite(window?.bandBottom);
}

export function getLaneBandWindow(laneSegmentation = {}, laneIndex) {
  const targetLane = Math.floor(Number(laneIndex));
  if (!Number.isFinite(targetLane) || targetLane < 1) {
    return null;
  }
  return normalizeLaneBandWindows(laneSegmentation?.laneBandWindows)
    .find((window) => window.laneIndex === targetLane) || null;
}

export function getTargetBandWindowForLane(laneSegmentation = {}, laneIndex) {
  if (isPerLaneBandMode(laneSegmentation)) {
    const laneWindow = getLaneBandWindow(laneSegmentation, laneIndex);
    return hasCompleteLaneBandWindow(laneWindow)
      ? {
        laneIndex: laneWindow.laneIndex,
        bandTop: laneWindow.bandTop,
        bandBottom: laneWindow.bandBottom,
        perLane: true
      }
      : null;
  }

  const bandTop = normalizeOptionalPixel(laneSegmentation?.bandTop);
  const bandBottom = normalizeOptionalPixel(laneSegmentation?.bandBottom);
  return Number.isFinite(bandTop) && Number.isFinite(bandBottom)
    ? {
      laneIndex: Math.max(1, Math.floor(Number(laneIndex) || 1)),
      bandTop,
      bandBottom,
      perLane: false
    }
    : null;
}

export function countCompleteLaneBandWindows(laneSegmentation = {}) {
  return normalizeLaneBandWindows(laneSegmentation?.laneBandWindows)
    .filter(hasCompleteLaneBandWindow)
    .length;
}

export function hasAnyTargetBandWindow(laneSegmentation = {}) {
  if (isPerLaneBandMode(laneSegmentation)) {
    return countCompleteLaneBandWindows(laneSegmentation) > 0;
  }
  return Boolean(getTargetBandWindowForLane(laneSegmentation, 1));
}

export function normalizeManualOverrides(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const normalized = createEmptyManualOverrides();

  const rawSegmentation = input.laneSegmentation && typeof input.laneSegmentation === 'object'
    ? input.laneSegmentation
    : {};
  const rawGelLeft = rawSegmentation.gelLeft;
  const rawGelRight = rawSegmentation.gelRight;
  const rawBandTop = rawSegmentation.bandTop;
  const rawBandBottom = rawSegmentation.bandBottom;
  const gelLeft = (rawGelLeft === null || rawGelLeft === undefined || rawGelLeft === '')
    ? NaN
    : Number(rawGelLeft);
  const gelRight = (rawGelRight === null || rawGelRight === undefined || rawGelRight === '')
    ? NaN
    : Number(rawGelRight);
  const bandTop = (rawBandTop === null || rawBandTop === undefined || rawBandTop === '')
    ? NaN
    : Number(rawBandTop);
  const bandBottom = (rawBandBottom === null || rawBandBottom === undefined || rawBandBottom === '')
    ? NaN
    : Number(rawBandBottom);
  normalized.laneSegmentation = {
    gelLeft: Number.isFinite(gelLeft) ? Math.max(0, Math.floor(gelLeft)) : null,
    gelRight: Number.isFinite(gelRight) ? Math.max(0, Math.floor(gelRight)) : null,
    dividers: (Array.isArray(rawSegmentation.dividers) ? rawSegmentation.dividers : [])
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]),
    dividerDone: Boolean(rawSegmentation.dividerDone),
    bandTop: Number.isFinite(bandTop) ? Math.max(0, Math.floor(bandTop)) : null,
    bandBottom: Number.isFinite(bandBottom) ? Math.max(0, Math.floor(bandBottom)) : null,
    perLaneBandEnabled: isPerLaneBandMode(rawSegmentation),
    laneBandWindows: normalizeLaneBandWindows(rawSegmentation.laneBandWindows),
    laneVertices: normalizeLaneVertices(rawSegmentation.laneVertices),
    quantifyConfirmed: Boolean(rawSegmentation.quantifyConfirmed)
  };

  normalized.addedBands = (Array.isArray(input.addedBands) ? input.addedBands : [])
    .map((item) => ({
      laneIndex: Math.max(1, Math.floor(Number(item?.laneIndex) || 0)),
      pixelY: Math.max(0, Math.floor(Number(item?.pixelY) || 0))
    }))
    .filter((item) => item.laneIndex > 0);

  const ladderLaneValue = Number(input.ladderLane);
  normalized.ladderLane = Number.isFinite(ladderLaneValue) && ladderLaneValue >= 1
    ? Math.floor(ladderLaneValue)
    : null;
  normalized.ladderBands = (Array.isArray(input.ladderBands) ? input.ladderBands : [])
    .map((item) => ({
      pixelY: Math.max(0, Math.floor(Number(item?.pixelY) || 0)),
      mw: Number(item?.mw)
    }))
    .filter((item) => Number.isFinite(item.mw) && item.mw > 0)
    .sort((a, b) => a.pixelY - b.pixelY);
  normalized.ladderBandsDone = Boolean(input.ladderBandsDone);
  normalized.peakIntegrations = normalizePeakIntegrations(input.peakIntegrations);
  const rawLaneTable = input.laneTable && typeof input.laneTable === 'object'
    ? input.laneTable
    : {};
  normalized.laneTable = {
    rows: (Array.isArray(rawLaneTable.rows) ? rawLaneTable.rows : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        label: String(row.label ?? '').slice(0, 160),
        values: (Array.isArray(row.values) ? row.values : [])
          .map((value) => String(value ?? '').slice(0, 160))
      }))
  };

  return normalized;
}

export function safeFilePart(raw, fallback) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
