import { layoutToMap, toRowLabel, wellIdFor } from './plate-model.js';
import { parseConcentrationMagnitude } from './concentration-utils.js';
import { plateAttributes, plateMessage } from './localization.js';

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
  const unit = String(concentrationUnit || '').trim();
  const concentrationAxisLabel = unit ? plateMessage('grid.concentrationUnit', { unit }) : plateMessage('grid.concentration');
  const rowAxisLabel = rowAxisRole === 'sample' ? plateMessage('field.sampleId') : concentrationAxisLabel;
  const columnAxisLabel = columnAxisRole === 'sample' ? plateMessage('field.sampleId') : concentrationAxisLabel;
  const axisPlaceholder = role => plateAttributes({ placeholder: role === 'sample' ? 'grid.samplePlaceholder' : 'grid.concentrationPlaceholder' });
  const rowAxisValues = rowAxisRole === 'sample' ? sampleValues : concentrationValues;
  const columnAxisValues = columnAxisRole === 'sample' ? sampleValues : concentrationValues;
  const filledLayouts = Object.values(cellMap).filter((item) => item && (item.sampleId || item.concentration));
  const rankedConcentrations = buildRankedConcentrations(filledLayouts);

  const headers = ['<th></th>', `<th>${rowAxisLabel}</th>`];
  for (let col = 0; col < maxColumns; col += 1) {
    headers.push(`<th>${col + 1}</th>`);
  }

  const axisRowCells = [`<th>${columnAxisLabel}</th>`, '<td></td>'];
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
          ${axisPlaceholder(columnAxisRole)}
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
            ${axisPlaceholder(rowAxisRole)}
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
      const editsConcentration = plateEditField === 'concentration';
      const editableValue = editsConcentration ? concentrationValue : sampleValue;
      const secondaryMeta = editsConcentration
        ? plateMessage('grid.sampleShort', { value: sampleLabel })
        : plateMessage('grid.concentrationShort', { value: concentrationLabel });
      const wellTitle = plateAttributes({ title: editsConcentration ? 'grid.wellConcentration' : 'grid.wellSample' }, {
        well, sample: cellLayout?.sampleId || '-', concentration: cellLayout?.concentration || '-'
      });
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
        <td class="assay-well${filled}${active}" data-well="${well}" ${wellTitle}${cellStyle}>
          <div class="assay-well-id">${safeText(well)}</div>
          <input
            type="text"
            class="assay-well-inline-input"
            data-well-inline-field="${plateEditField}"
            data-well="${well}"
            value="${safeText(editableValue)}"
            ${axisPlaceholder(editsConcentration ? 'concentration' : 'sample')}
          />
          <div class="assay-well-meta">${secondaryMeta}</div>
        </td>
      `);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  const note = totalWells > 384
    ? `<p class="small-note">${plateMessage('grid.previewNote', { rows: maxRows, columns: maxColumns, count: def.value })}</p>`
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
