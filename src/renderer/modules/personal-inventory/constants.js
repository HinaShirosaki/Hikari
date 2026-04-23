export const SAMPLE_TYPE_COLORS = {
  plasmid: '#2f6fec',
  cell_line: '#e8871a',
  strain: '#159a8a',
  antibody: '#d75062',
  protein: '#3b9d3a',
  compound: '#7a58e8',
  primer: '#be9a1a',
  other: '#718096'
};

export const SAMPLE_TYPE_LABELS = {
  plasmid: 'Plasmid',
  cell_line: 'Cell Line',
  strain: 'Strain',
  antibody: 'Antibody',
  protein: 'Protein',
  compound: 'Compound',
  primer: 'Primer',
  other: 'Other'
};

export const SECTION_DISPLAY = {
  'Room Temp': { short: 'RT', title: 'Room Temp', note: 'Bench and cabinet storage' },
  '4 Degree': { short: '4C', title: '4 C', note: 'Cold shelf storage' },
  '-20 Degree': { short: '-20', title: '-20 C', note: 'Short-term freezer storage' },
  '-80 Degree': { short: '-80', title: '-80 C', note: 'Long-term freezer storage' },
  'Liquid Nitrogen': { short: 'LN2', title: 'Liquid Nitrogen', note: 'Cryogenic storage' }
};

const CUSTOM_GRID_MIN_DIMENSION = 1;
const CUSTOM_GRID_MAX_DIMENSION = 24;
const CUSTOM_GRID_DEFAULT_ROWS = 9;
const CUSTOM_GRID_DEFAULT_COLS = 9;

function clampGridDimension(value, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(CUSTOM_GRID_MAX_DIMENSION, Math.max(CUSTOM_GRID_MIN_DIMENSION, parsed));
}

function getContainerType(containerOrType) {
  if (containerOrType && typeof containerOrType === 'object') {
    const type = String(containerOrType.type || '').trim();
    return type || 'box81';
  }
  const type = String(containerOrType || '').trim();
  return type || 'box81';
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
  return '81-well cube box';
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
      className: 'box81',
      helperText: `${rows} x ${cols} custom grid box. Click a cell to set samples on the right side.`
    };
  }
  return {
    rows: 9,
    cols: 9,
    className: 'box81',
    helperText: '9 x 9 square box (81 wells). Click a cell to set samples on the right side.'
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

export function getSectionNames() {
  return ['Room Temp', '4 Degree', '-20 Degree', '-80 Degree', 'Liquid Nitrogen'];
}

export function getSectionDisplay(section) {
  return SECTION_DISPLAY[section] || { short: '--', title: section || 'Unknown', note: '' };
}
