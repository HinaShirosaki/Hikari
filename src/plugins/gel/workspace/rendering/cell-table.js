import { hasAnyTargetBandWindow, normalizeManualOverrides } from '../shared.js';

export function formatIntensity(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

export function readSnrThreshold(input) {
  if (!input) {
    return 3;
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    return 3;
  }
  return value;
}

export function createCellTableController({ runtime, elements, safeText }) {
  // The report lives in its own dialog, so "has data" only gates the trigger
  // button; whether it is on screen is the user's choice.
  function setCellTableVisibility(hasCells) {
    if (!hasCells) {
      runtime.cellTableDialogOpen = false;
    }
    if (elements.gelOpenCellTableBtn) {
      elements.gelOpenCellTableBtn.disabled = !hasCells;
      elements.gelOpenCellTableBtn.setAttribute?.(
        'aria-expanded',
        String(hasCells && Boolean(runtime.cellTableDialogOpen))
      );
    }
    if (elements.gelCellTableOverlay) {
      elements.gelCellTableOverlay.hidden = !hasCells || !runtime.cellTableDialogOpen;
    }
  }

  function renderCellTable() {
    const host = elements.gelCellTableHost;
    const summary = elements.gelCellTableSummary;
    if (!host) {
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const hasBandWindow = hasAnyTargetBandWindow(segmentation);
    const reportLanes = runtime.currentReport?.lanes || [];
    const cells = reportLanes
      .map((lane) => ({ lane, cell: lane.targetBand || null }))
      .filter((entry) => entry.cell);

    if (!hasBandWindow || !cells.length) {
      setCellTableVisibility(false);
      host.innerHTML = '';
      if (summary) {
        summary.textContent = '';
      }
      return;
    }

    setCellTableVisibility(true);
    const threshold = readSnrThreshold(elements.gelCellSnrThresholdInput);
    const labelRow = (overrides.laneTable?.rows || []).find((row) => /label/i.test(row?.label || '')) || null;

    const rowsHtml = cells.map(({ lane, cell }) => {
      const snr = Number(cell.snr);
      const hasBand = Number.isFinite(snr) && snr >= threshold;
      const label = labelRow ? safeText(labelRow.values?.[lane.laneIndex - 1] || '') : '';
      const className = `gel-cell-row ${hasBand ? 'is-has-band' : 'is-empty'}`;
      const intensity = formatIntensity(Number(cell.correctedIntensity));
      const bandSum = formatIntensity(Number(cell.bandSignalSum));
      const baselineSum = formatIntensity(Number(cell.baselineSum));
      const saturationPct = Number.isFinite(Number(cell.saturationFraction))
        ? `${(Number(cell.saturationFraction) * 100).toFixed(1)}%`
        : '-';
      return `
        <tr class="${className}">
          <td>${safeText(String(lane.laneIndex))}</td>
          <td>${label}</td>
          <td class="num">${safeText(bandSum)}</td>
          <td class="num">${safeText(baselineSum)}</td>
          <td class="num gel-cell-intensity">${safeText(intensity)}</td>
          <td class="num">${safeText(Number.isFinite(snr) ? snr.toFixed(2) : '-')}</td>
          <td class="gel-cell-hasband">${hasBand ? 'yes' : 'no'}</td>
          <td class="num">${safeText(saturationPct)}</td>
        </tr>
      `;
    }).join('');

    host.innerHTML = `
      <table class="gel-cell-table">
        <thead>
          <tr>
            <th>Lane</th>
            <th>Label</th>
            <th class="num">Band sum</th>
            <th class="num">Baseline sum</th>
            <th class="num">Corrected</th>
            <th class="num">SNR</th>
            <th>Has band?</th>
            <th class="num">Sat %</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    if (summary) {
      const presentCells = cells.filter(({ cell }) => Number(cell.snr) >= threshold).length;
      const baselineMode = cells[0]?.cell?.baselineMode || 'lane-profile';
      summary.textContent = `${presentCells}/${cells.length} cells classified as band (SNR ≥ ${threshold.toFixed(1)}). Baseline: ${baselineMode}.`;
    }
  }

  return { renderCellTable };
}
