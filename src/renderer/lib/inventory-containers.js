const CUSTOM_GRID_MIN_DIMENSION = 1;
const CUSTOM_GRID_MAX_DIMENSION = 24;
const CUSTOM_GRID_DEFAULT_ROWS = 9;
const CUSTOM_GRID_DEFAULT_COLS = 9;

export const GRID_BOX_LAYOUTS = Object.freeze({
  box25: { rows: 5, cols: 5, label: '25-well grid box' },
  box49: { rows: 7, cols: 7, label: '49-well grid box' },
  box64: { rows: 8, cols: 8, label: '64-well grid box' },
  box81: { rows: 9, cols: 9, label: '81-well cube box' },
  box100: { rows: 10, cols: 10, label: '100-well grid box' }
});

const SUPPORTED_CONTAINER_TYPES = new Set([
  ...Object.keys(GRID_BOX_LAYOUTS),
  'customGrid',
  'plate96',
  'single'
]);

function clampGridDimension(value, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(CUSTOM_GRID_MAX_DIMENSION, Math.max(CUSTOM_GRID_MIN_DIMENSION, parsed));
}

function getContainerType(containerOrType) {
  if (containerOrType && typeof containerOrType === 'object') {
    return normalizeContainerType(containerOrType.type);
  }
  return normalizeContainerType(containerOrType);
}

function getCanonicalContainerType(type = '') {
  const normalized = String(type || '').trim().toLowerCase();
  return normalized === 'customgrid' ? 'customGrid' : normalized;
}

export function normalizeContainerType(type = '') {
  const normalized = getCanonicalContainerType(type);
  return SUPPORTED_CONTAINER_TYPES.has(normalized) ? normalized : 'box81';
}

export function isSupportedContainerType(type = '') {
  return SUPPORTED_CONTAINER_TYPES.has(getCanonicalContainerType(type));
}

function getCustomGridDimension(containerOrType, primaryKey, fallbackKey, fallback) {
  if (!containerOrType || typeof containerOrType !== 'object') {
    return fallback;
  }
  return clampGridDimension(containerOrType[primaryKey] ?? containerOrType[fallbackKey], fallback);
}

export function normalizeCustomGridDimensions(rowsValue, colsValue) {
  return {
    rows: clampGridDimension(rowsValue, CUSTOM_GRID_DEFAULT_ROWS),
    cols: clampGridDimension(colsValue, CUSTOM_GRID_DEFAULT_COLS)
  };
}

export function isMultiWellContainer(containerOrType) {
  return getContainerType(containerOrType) !== 'single';
}

export function getContainerTypeLabel(containerOrType) {
  const type = getContainerType(containerOrType);
  if (type === 'single') {
    return 'Single container';
  }
  if (type === 'plate96') {
    return '96-well plate';
  }
  if (type === 'customGrid') {
    const layout = getContainerLayout(containerOrType);
    return `${layout.rows} x ${layout.cols} grid box`;
  }
  return GRID_BOX_LAYOUTS[type]?.label || GRID_BOX_LAYOUTS.box81.label;
}

export function getContainerLayout(containerOrType) {
  const type = getContainerType(containerOrType);
  if (type === 'plate96') {
    return {
      rows: 8,
      cols: 12,
      className: 'plate96',
      helperText: '96-well microplate with SBS footprint. Click a well to assign or edit linked samples.'
    };
  }
  if (type === 'customGrid') {
    const rows = getCustomGridDimension(containerOrType, 'gridRows', 'rows', CUSTOM_GRID_DEFAULT_ROWS);
    const cols = getCustomGridDimension(containerOrType, 'gridCols', 'cols', CUSTOM_GRID_DEFAULT_COLS);
    return {
      rows,
      cols,
      className: 'box81'
    };
  }
  const gridBox = GRID_BOX_LAYOUTS[type] || GRID_BOX_LAYOUTS.box81;
  return {
    rows: gridBox.rows,
    cols: gridBox.cols,
    className: 'box81'
  };
}

export function getWellName(containerOrType, index) {
  const type = getContainerType(containerOrType);
  if (type === 'plate96') {
    const layout = getContainerLayout(containerOrType);
    const rowLabel = String.fromCharCode(65 + Math.floor(index / layout.cols));
    const columnLabel = (index % layout.cols) + 1;
    return `${rowLabel}${columnLabel}`;
  }
  return `W${index + 1}`;
}

export function createDefaultWells(containerOrType) {
  if (!isMultiWellContainer(containerOrType)) {
    return [];
  }
  const layout = getContainerLayout(containerOrType);
  return Array.from({ length: layout.rows * layout.cols }, (_item, index) => ({
    name: getWellName(containerOrType, index),
    content: ''
  }));
}
