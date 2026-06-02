export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
      quantifyConfirmed: false
    },
    addedBands: [],
    ladderLane: null,
    ladderBands: [],
    ladderBandsDone: false,
    laneTable: {
      rows: []
    }
  };
}

function normalizeOptionalPixel(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
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
