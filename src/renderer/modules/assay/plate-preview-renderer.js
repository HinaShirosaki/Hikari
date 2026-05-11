import { layoutToMap, toRowLabel, wellIdFor } from './plate-model.js';
import { parseConcentrationMagnitude } from './concentration-utils.js';

function hashSampleId(sampleId) {
  let hash = 2166136261;
  const text = String(sampleId || '').trim();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleColor(sampleId) {
  const hash = hashSampleId(sampleId);
  const hue = Math.round((hash * 137.508) % 360);
  return {
    hue,
    accentHue: (hue + 28 + (hash % 42)) % 360,
    saturation: 74 + (hash % 18)
  };
}

function buildRankedConcentrations(filledLayouts) {
  const rawValues = filledLayouts
    .map((item) => String(item.concentration || '').trim())
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

export function buildPlatePreviewHtml({
  def,
  sampleAxis,
  layout,
  sampleValues,
  concentrationValues,
  plateEditField,
  activeWellEditorId,
  safeText
}) {
  const cellMap = layoutToMap(layout);
  const totalWells = def.rows * def.columns;
  const maxRows = totalWells > 384 ? 16 : def.rows;
  const maxColumns = totalWells > 384 ? 24 : def.columns;

  const rowAxisRole = sampleAxis === 'row' ? 'sample' : 'concentration';
  const columnAxisRole = sampleAxis === 'row' ? 'concentration' : 'sample';
  const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
  const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
  const rowAxisValues = rowAxisRole === 'sample' ? sampleValues : concentrationValues;
  const columnAxisValues = columnAxisRole === 'sample' ? sampleValues : concentrationValues;
  const filledLayouts = Object.values(cellMap).filter((item) => item && (item.sampleId || item.concentration));
  const rankedConcentrations = buildRankedConcentrations(filledLayouts);

  const headers = ['<th></th>', `<th>${safeText(rowAxisLabel)}</th>`];
  for (let col = 0; col < maxColumns; col += 1) {
    headers.push(`<th>${col + 1}</th>`);
  }

  const axisRowCells = [`<th>${safeText(columnAxisLabel)}</th>`, '<td></td>'];
  for (let col = 0; col < maxColumns; col += 1) {
    const value = String(columnAxisValues[col] || '');
    axisRowCells.push(`
      <td class="assay-axis-cell">
        <input
          type="text"
          class="assay-axis-input"
          data-axis-dimension="column"
          data-axis-index="${col}"
          value="${safeText(value)}"
          placeholder="${columnAxisRole === 'sample' ? 'Sample' : 'Conc'}"
        />
      </td>
    `);
  }

  const rows = [];
  for (let row = 0; row < maxRows; row += 1) {
    const rowLabel = toRowLabel(row);
    const rowAxisValue = String(rowAxisValues[row] || '');
    const cells = [
      `<th>${rowLabel}</th>`,
      `
        <td class="assay-axis-cell">
          <input
            type="text"
            class="assay-axis-input"
            data-axis-dimension="row"
            data-axis-index="${row}"
            value="${safeText(rowAxisValue)}"
            placeholder="${rowAxisRole === 'sample' ? 'Sample' : 'Conc'}"
          />
        </td>
      `
    ];
    for (let col = 0; col < maxColumns; col += 1) {
      const well = wellIdFor(row, col);
      const cellLayout = cellMap[well];
      const filled = cellLayout && (cellLayout.sampleId || cellLayout.concentration) ? ' is-filled' : '';
      const active = activeWellEditorId === well ? ' is-active' : '';
      const sampleValue = String(cellLayout?.sampleId || '').trim();
      const concentrationValue = String(cellLayout?.concentration || '').trim();
      const sampleLabel = sampleValue || '-';
      const concentrationLabel = concentrationValue || '-';
      const editable = plateEditField === 'concentration' ? 'Concentration' : 'Sample ID';
      const editableValue = plateEditField === 'concentration' ? concentrationValue : sampleValue;
      const secondaryMeta = plateEditField === 'concentration'
        ? `S: ${safeText(sampleLabel)}`
        : `C: ${safeText(concentrationLabel)}`;
      const meta = cellLayout
        ? `Sample ID: ${cellLayout.sampleId || '-'} | Concentration: ${cellLayout.concentration || '-'}`
        : 'Sample ID: - | Concentration: -';
      const color = sampleValue
        ? sampleColor(sampleValue)
        : { hue: 210, accentHue: 232, saturation: 72 };
      const intensity = concentrationValue
        ? (rankedConcentrations.get(concentrationValue) || 0.58)
        : (sampleValue ? 0.36 : 0);
      const topAlpha = Math.min(0.92, 0.22 + (intensity * 0.68));
      const bottomAlpha = Math.min(0.98, 0.28 + (intensity * 0.78));
      const topLightness = Math.max(76, 97 - (intensity * 18));
      const middleLightness = Math.max(64, 91 - (intensity * 24));
      const bottomLightness = Math.max(54, 88 - (intensity * 30));
      const borderAlpha = Math.min(0.78, 0.28 + (intensity * 0.5));
      const highlightAlpha = Math.min(0.48, 0.16 + (intensity * 0.2));
      const shadowAlpha = Math.min(0.34, 0.1 + (intensity * 0.24));
      const cellStyle = sampleValue || concentrationValue
        ? ` style="background: linear-gradient(145deg, hsla(${color.accentHue}, ${Math.min(98, color.saturation + 8)}%, ${Math.min(98, topLightness + 2)}%, ${topAlpha}) 0%, hsla(${color.hue}, ${color.saturation}%, ${middleLightness}%, ${Math.min(0.96, topAlpha + 0.08)}) 48%, hsla(${color.hue}, ${Math.min(98, color.saturation + 12)}%, ${bottomLightness}%, ${bottomAlpha}) 100%); border-color: hsla(${color.hue}, 70%, 38%, ${borderAlpha}); box-shadow: inset 0 1px 0 hsla(${color.accentHue}, 90%, 98%, ${highlightAlpha}), inset 0 -12px 20px hsla(${color.hue}, 76%, 44%, ${shadowAlpha});"`
        : '';
      cells.push(`
        <td class="assay-well${filled}${active}" data-well="${well}" title="${safeText(`${well} • ${meta} • Click to edit ${editable}`)}"${cellStyle}>
          <div class="assay-well-id">${safeText(well)}</div>
          <input
            type="text"
            class="assay-well-inline-input"
            data-well-inline-field="${plateEditField}"
            data-well="${well}"
            value="${safeText(editableValue)}"
            placeholder="${plateEditField === 'concentration' ? 'Conc' : 'Sample'}"
          />
          <div class="assay-well-meta">${secondaryMeta}</div>
        </td>
      `);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  const note = totalWells > 384
    ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${def.label} plate.</p>`
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
