import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { hasAnyTargetBandWindow, normalizeManualOverrides } from '../shared.js';
import { copyTextToClipboard } from '../../lib/clipboard.js';
import { renderBandIntensityChart } from './band-intensity-chart.js';

export function formatIntensity(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

// A measured band window counts as a band at or above this signal-to-noise ratio.
export const SNR_THRESHOLD = 3;

export function createCellTableController({ runtime, elements, safeText, deps = {} }) {
  let copying = false;

  function getMeasurements() {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    if (!hasAnyTargetBandWindow(overrides.laneSegmentation)) {
      return [];
    }
    const labelRow = (overrides.laneTable?.rows || []).find((row) => /label/i.test(row?.label || ''));
    return (runtime.currentReport?.lanes || [])
      .filter((lane) => lane.targetBand)
      .map((lane) => ({
        lane: String(lane.laneIndex),
        label: String(labelRow?.values?.[lane.laneIndex - 1] || '').replace(/[\t\r\n]+/g, ' '),
        value: lane.targetBand.intensityStatus === 'unavailable' || lane.targetBand.correctedIntensity === null ? NaN : Number(lane.targetBand.correctedIntensity),
        intensity: lane.targetBand.intensityStatus === 'unavailable' ? '-' : formatIntensity(lane.targetBand.correctedIntensity === null ? NaN : Number(lane.targetBand.correctedIntensity)),
        review: lane.targetBand.intensityStatus && lane.targetBand.intensityStatus !== 'ok',
        method: lane.targetBand.baselineMode === 'manual-peak' ? 'Manual baseline' : 'Automatic local baseline'
      }));
  }

  function getTableRows(measurements = getMeasurements()) {
    return measurements.map(({ lane, label, intensity }) => [lane, label, intensity]);
  }

  async function onCellTableCopy() {
    const rows = getTableRows();
    if (copying || !rows.length) {
      return;
    }
    copying = true;
    const status = elements.gelCellTableCopyStatus;
    if (status) i18nUi.setText(status, '');
    try {
      const text = [['Lane', 'Label', 'Band intensity'], ...rows]
        .map((row) => row.join('\t')).join('\n');
      const writeText = deps.writeClipboardText || ((value) => copyTextToClipboard(value, elements.gelCellTableHost?.ownerDocument));
      await writeText(text);
      if (status) i18nUi.setText(status, i18nUi.message("Table copied."));
    } catch {
      if (status) i18nUi.setText(status, i18nUi.message("Could not copy. Select the table and copy it manually."));
    } finally {
      copying = false;
    }
  }

  function setCellTableVisibility(hasCells) {
    if (elements.gelCellTableCopyBtn) {
      elements.gelCellTableCopyBtn.disabled = !hasCells;
    }
    if (elements.gelOpenBandIntensityBtn) elements.gelOpenBandIntensityBtn.disabled = !runtime.currentImage;
    if (elements.gelBandIntensityEmpty) elements.gelBandIntensityEmpty.hidden = hasCells;
  }

  function renderCellTable() {
    const host = elements.gelCellTableHost;
    if (!host) {
      return;
    }

    const measurements = getMeasurements();
    const rows = getTableRows(measurements);
    renderBandIntensityChart(elements.gelBandIntensityChart, measurements, safeText);
    if (elements.gelCellTableCopyStatus && !copying) {
      i18nUi.setText(elements.gelCellTableCopyStatus, '');
    }
    if (!rows.length) {
      setCellTableVisibility(false);
      i18nUi.setHtml(host, '');
      return;
    }

    setCellTableVisibility(true);
    const rowsHtml = measurements.map(({ lane, label, intensity, review, method }) => {
      return `
        <tr class="gel-cell-row">
          <td>${safeText(lane)}</td>
          <td>${safeText(label)}</td>
          <td class="num gel-cell-intensity" title="${safeText(method)}">${safeText(intensity)}${review ? `<span class="gel-intensity-review">${i18nUi.html("Review background")}</span>` : ''}</td>
        </tr>
      `;
    }).join('');

    i18nUi.setHtml(host, `
      <table class="gel-cell-table">
        <thead>
          <tr>
            <th>${i18nUi.html("Lane")}</th>
            <th>${i18nUi.html("Label")}</th>
            <th class="num">${i18nUi.html("Band intensity")}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `);
  }

  return { onCellTableCopy, renderCellTable };
}
