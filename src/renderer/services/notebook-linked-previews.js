import {
  getAssayAxisTemplateValues,
  getPlateDefinition,
  layoutToMap,
  toRowLabel,
  wellIdFor
} from '../modules/assay/plate-model.js';

function parseTimestamp(rawValue) {
  const timestamp = Date.parse(String(rawValue || '').trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatLinkedPreviewTimestamp(rawValue) {
  const timestamp = parseTimestamp(rawValue);
  if (!timestamp) {
    return 'Unknown time';
  }
  return new Date(timestamp).toLocaleString();
}

export function findLatestLinkedRecord(items, notebookEntryId) {
  const targetEntryId = String(notebookEntryId || '').trim();
  if (!targetEntryId) {
    return null;
  }
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.notebookEntryId || '').trim() === targetEntryId)
    .slice()
    .sort((left, right) => parseTimestamp(right?.updatedAt) - parseTimestamp(left?.updatedAt))[0] || null;
}

function hashSampleId(sampleId) {
  let hash = 0;
  const text = String(sampleId || '').trim();
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) % 360;
  }
  return hash;
}

function sampleHue(sampleId) {
  return (hashSampleId(sampleId) + 18) % 360;
}

function parseConcentrationMagnitude(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Zuµμ]*)/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rawUnit = String(match[2] || '').toLowerCase().replace('μ', 'u').replace('µ', 'u');
  const scaleMap = {
    fm: 1e-15,
    pm: 1e-12,
    nm: 1e-9,
    um: 1e-6,
    mm: 1e-3,
    cm: 1e-2,
    m: 1,
    kg: 1e3,
    gm: 1,
    mg: 1e-3,
    ug: 1e-6,
    ng: 1e-9,
    pg: 1e-12
  };
  const unit = rawUnit.replace(/\/.*$/, '');
  // A present-but-unknown unit is a typo/unsupported unit, not base molar. Returning
  // null drops it (it's filtered out below) instead of scaling by 1 — a stray "10
  // millimolar" would otherwise read as 10 M and skew the whole heatmap min/max.
  if (unit && !Object.prototype.hasOwnProperty.call(scaleMap, unit)) {
    return null;
  }
  return numeric * (scaleMap[unit] || 1);
}

function buildConcentrationIntensityMap(layoutMap) {
  const rawValues = Object.values(layoutMap)
    .map((item) => String(item?.concentration || '').trim())
    .filter(Boolean);
  const numericValues = rawValues
    .map((value) => ({ value, magnitude: parseConcentrationMagnitude(value) }))
    .filter((item) => item.magnitude !== null);

  if (numericValues.length >= 2) {
    const magnitudes = numericValues.map((item) => item.magnitude);
    const min = Math.min(...magnitudes);
    const max = Math.max(...magnitudes);
    const span = max - min || 1;
    return new Map(numericValues.map((item) => [
      item.value,
      0.28 + (((item.magnitude - min) / span) * 0.54)
    ]));
  }

  const unique = [...new Set(rawValues)];
  if (unique.length >= 2) {
    return new Map(unique.map((value, index) => [
      value,
      0.28 + ((index / (unique.length - 1 || 1)) * 0.54)
    ]));
  }
  return new Map(unique.map((value) => [value, 0.52]));
}

export function buildNotebookAssayPlatePreviewHtml(assay, safeText) {
  if (!assay) {
    return '';
  }

  const definition = getPlateDefinition(assay.plateType);
  const sampleAxis = assay.sampleAxis === 'column' ? 'column' : 'row';
  const axisValues = getAssayAxisTemplateValues(assay, definition);
  const layoutMap = layoutToMap(assay.wellLayout || []);
  const totalWells = definition.rows * definition.columns;
  const maxRows = totalWells > 384 ? 16 : definition.rows;
  const maxColumns = totalWells > 384 ? 24 : definition.columns;
  const rowAxisRole = sampleAxis === 'row' ? 'sample' : 'concentration';
  const columnAxisRole = sampleAxis === 'row' ? 'concentration' : 'sample';
  const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
  const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
  const rowAxisValues = rowAxisRole === 'sample' ? axisValues.sampleValues : axisValues.concentrationValues;
  const columnAxisValues = columnAxisRole === 'sample' ? axisValues.sampleValues : axisValues.concentrationValues;
  const concentrationIntensityMap = buildConcentrationIntensityMap(layoutMap);

  const headers = ['<th></th>', `<th>${safeText(rowAxisLabel)}</th>`];
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    headers.push(`<th>${columnIndex + 1}</th>`);
  }

  const axisRowCells = [`<th>${safeText(columnAxisLabel)}</th>`, '<td></td>'];
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    axisRowCells.push(
      `<td class="biology-notebook-assay-axis-cell"><span class="biology-notebook-assay-axis-value">${safeText(columnAxisValues[columnIndex] || '-')}</span></td>`
    );
  }

  const rows = [];
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const cells = [
      `<th>${toRowLabel(rowIndex)}</th>`,
      `<td class="biology-notebook-assay-axis-cell"><span class="biology-notebook-assay-axis-value">${safeText(rowAxisValues[rowIndex] || '-')}</span></td>`
    ];

    for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
      const well = wellIdFor(rowIndex, columnIndex);
      const layout = layoutMap[well];
      const sampleValue = String(layout?.sampleId || '').trim();
      const concentrationValue = String(layout?.concentration || '').trim();
      const hue = sampleValue ? sampleHue(sampleValue) : 210;
      const intensity = concentrationValue
        ? (concentrationIntensityMap.get(concentrationValue) || 0.52)
        : (sampleValue ? 0.3 : 0);
      const cellStyle = sampleValue || concentrationValue
        ? ` style="background: hsla(${hue}, 72%, 74%, ${intensity}); border-color: hsla(${hue}, 45%, 52%, 0.42);"`
        : '';
      const meta = layout
        ? `Sample ID: ${sampleValue || '-'} | Concentration: ${concentrationValue || '-'}`
        : 'Sample ID: - | Concentration: -';

      cells.push(`
        <td class="assay-well"${cellStyle} title="${safeText(`${well} • ${meta}`)}">
          <div class="assay-well-id">${safeText(well)}</div>
          <span class="biology-notebook-assay-well-primary">${safeText(`S: ${sampleValue || '-'}`)}</span>
          <span class="biology-notebook-assay-well-secondary">${safeText(`C: ${concentrationValue || '-'}`)}</span>
        </td>
      `);
    }

    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  const note = totalWells > 384
    ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${safeText(definition.label)}.</p>`
    : '';

  return `
    ${note}
    <div class="assay-plate-table-wrap">
      <table class="assay-plate-table">
        <thead>
          <tr>${headers.join('')}</tr>
          <tr class="assay-plate-editor-row">${axisRowCells.join('')}</tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}
