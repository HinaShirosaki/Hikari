import { escapeCsv } from '../../lib/csv.js';
export { escapeCsv };

export {
  clamp,
  sampleArrayValue,
  round,
  mean,
  confidenceLabel
} from './shared/numeric.js';
export {
  getLaneVertexArray,
  getLaneRectifiedHeight,
  getLaneRectifiedWidth,
  getLaneRowSegment,
  getLaneRowBounds,
  laneContainsPoint,
  lanePointToRectifiedRow
} from './shared/lane-geometry.js';

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

import {
  LANE_VERTEX_KEYS,
  normalizeOptionalPixel,
  normalizeVertexPoint
} from './shared/lane-vertices.js';

export { LANE_VERTEX_KEYS, normalizeOptionalPixel, normalizeVertexPoint };


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
