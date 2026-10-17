import { hasAnyTargetBandWindow, normalizeManualOverrides } from '../shared.js';
import { copyTextToClipboard } from '../../lib/clipboard.js';

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

  function getTableRows() {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    if (!hasAnyTargetBandWindow(overrides.laneSegmentation)) {
      return [];
    }
    const labelRow = (overrides.laneTable?.rows || []).find((row) => /label/i.test(row?.label || ''));
    return (runtime.currentReport?.lanes || [])
      .filter((lane) => lane.targetBand)
      .map((lane) => [
        String(lane.laneIndex),
        String(labelRow?.values?.[lane.laneIndex - 1] || '').replace(/[\t\r\n]+/g, ' '),
        formatIntensity(Number(lane.targetBand.correctedIntensity))
      ]);
  }

  async function onCellTableCopy() {
    const rows = getTableRows();
    if (copying || !rows.length) {
      return;
    }
    copying = true;
    const status = elements.gelCellTableCopyStatus;
    if (status) status.textContent = '';
    try {
      const text = [['Lane', 'Label', 'Band intensity'], ...rows]
        .map((row) => row.join('\t')).join('\n');
      const writeText = deps.writeClipboardText || ((value) => copyTextToClipboard(value, elements.gelCellTableHost?.ownerDocument));
      await writeText(text);
      if (status) status.textContent = 'Table copied.';
    } catch {
      if (status) status.textContent = 'Could not copy. Select the table and copy it manually.';
    } finally {
      copying = false;
    }
  }

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
    if (elements.gelCellTableCopyBtn) {
      elements.gelCellTableCopyBtn.disabled = !hasCells;
    }
  }

  function renderCellTable() {
    const host = elements.gelCellTableHost;
    if (!host) {
      return;
    }

    const rows = getTableRows();
    if (elements.gelCellTableCopyStatus && !copying) {
      elements.gelCellTableCopyStatus.textContent = '';
    }
    if (!rows.length) {
      setCellTableVisibility(false);
      host.innerHTML = '';
      return;
    }

    setCellTableVisibility(true);
    const rowsHtml = rows.map(([lane, label, intensity]) => {
      return `
        <tr class="gel-cell-row">
          <td>${safeText(lane)}</td>
          <td>${safeText(label)}</td>
          <td class="num gel-cell-intensity">${safeText(intensity)}</td>
        </tr>
      `;
    }).join('');

    host.innerHTML = `
      <table class="gel-cell-table">
        <thead>
          <tr>
            <th>Lane</th>
            <th>Label</th>
            <th class="num">Band intensity</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  return { onCellTableCopy, renderCellTable };
}
