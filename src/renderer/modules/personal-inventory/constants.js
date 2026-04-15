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

export function getContainerTypeLabel(type) {
  if (type === 'single') {
    return 'Single container';
  }
  if (type === 'plate96') {
    return '96-well plate';
  }
  return '81-well cube box';
}

export function getContainerLayout(type) {
  if (type === 'plate96') {
    return {
      rows: 8,
      cols: 12,
      className: 'plate96',
      helperText: '96-well microplate with SBS footprint. Click a well to assign or edit linked samples.'
    };
  }
  return {
    rows: 9,
    cols: 9,
    className: 'box81',
    helperText: '9 x 9 square box (81 wells). Click a cell to set samples on the right side.'
  };
}

export function getWellName(type, index) {
  if (type === 'plate96') {
    const rowLabel = String.fromCharCode(65 + Math.floor(index / 12));
    const columnLabel = (index % 12) + 1;
    return `${rowLabel}${columnLabel}`;
  }
  return `W${index + 1}`;
}

export function createDefaultWells(type) {
  if (type === 'single') {
    return [];
  }
  const layout = getContainerLayout(type);
  return Array.from({ length: layout.rows * layout.cols }, (_item, index) => ({
    name: getWellName(type, index),
    content: ''
  }));
}

export function getSectionNames() {
  return ['Room Temp', '4 Degree', '-20 Degree', '-80 Degree', 'Liquid Nitrogen'];
}

export function getSectionDisplay(section) {
  return SECTION_DISPLAY[section] || { short: '--', title: section || 'Unknown', note: '' };
}
