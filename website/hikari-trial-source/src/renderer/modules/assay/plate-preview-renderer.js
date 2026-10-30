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
    saturation: 74 + (hash % 18)
  };
}

// The well fill is fixed across themes, so its text must be too: dark or white,
// whichever contrasts more with the fill (WCAG relative luminance).
function wellTextColor(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const channel = (n) => {
    const k = (n + (hue / 30)) % 12;
    const srgb = l - (s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (0.2126 * channel(0)) + (0.7152 * channel(8)) + (0.0722 * channel(4));
  // #2a241d has luminance ~0.018; it and white contrast equally at ~0.22.
  return luminance > 0.22 ? '#2a241d' : '#ffffff';
}

function buildRankedConcentrations(filledLayouts) {
  const rawValues = filledLayouts
    .map((item) => String(item.concentration || '').trim())
    .filter(Boolean);
  const numericValues = rawValues
    .map((value) => ({ value, magnitude: parseConcentrationMagnitude(value) }))
    .filter((item) => item.magnitude !== null);
  if (numericValues.length >= 2) {
    const positiveMagnitudes = numericValues
      .map((item) => item.magnitude)
      .filter((value) => value > 0);
    const zeroFloor = positiveMagnitudes.length
      ? Math.log10(Math.min(...positiveMagnitudes)) - 1
      : 0;
    const magnitudes = numericValues.map((item) => item.magnitude > 0
      ? Math.log10(item.magnitude)
      : zeroFloor);
    const min = Math.min(...magnitudes);
    const max = Math.max(...magnitudes);
    const span = max - min || 1;
    return new Map(numericValues.map((item, index) => [
      item.value,
      0.24 + (((magnitudes[index] - min) / span) * 0.62)
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
  concentrationUnit,
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
  const unitSuffix = String(concentrationUnit || '').trim() ? ` (${String(concentrationUnit).trim()})` : '';
  const concentrationAxisLabel = `Conc.${unitSuffix}`;
  const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : concentrationAxisLabel;
  const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : concentrationAxisLabel;
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
      const editable = plateEditField === 'concentration' ? 'Conc.' : 'Sample ID';
      const editableValue = plateEditField === 'concentration' ? concentrationValue : sampleValue;
      const secondaryMeta = plateEditField === 'concentration'
        ? `S: ${safeText(sampleLabel)}`
        : `C: ${safeText(concentrationLabel)}`;
      const meta = cellLayout
        ? `Sample ID: ${cellLayout.sampleId || '-'} | Conc.: ${cellLayout.concentration || '-'}`
        : 'Sample ID: - | Conc.: -';
      const color = sampleValue
        ? sampleColor(sampleValue)
        : { hue: 210, saturation: 72 };
      const intensity = concentrationValue
        ? (rankedConcentrations.get(concentrationValue) || 0.58)
        : (sampleValue ? 0.36 : 0);
      const saturation = Math.round(Math.min(94, color.saturation - 10 + (intensity * 18)));
      const lightness = Math.round(Math.max(58, 96 - (intensity * 34)));
      const cellStyle = sampleValue || concentrationValue
        ? ` style="background-color: hsl(${color.hue} ${saturation}% ${lightness}%); color: ${wellTextColor(color.hue, saturation, lightness)};"`
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
