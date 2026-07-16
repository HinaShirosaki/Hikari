import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { normalizeManualOverrides } from '../shared.js';

const LABEL_COLUMN_WIDTH_PX = 118;

function cloneLaneTableRows(rows = []) {
  return rows.map((row) => ({
    label: String(row?.label ?? ''),
    values: Array.isArray(row?.values) ? row.values.map((value) => String(value ?? '')) : []
  }));
}

function formatPercentWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0%';
  }
  return `${Math.round(numeric * 10000) / 10000}%`;
}

function resolveLaneLayout(runtime) {
  if (!runtime.currentImage) {
    return null;
  }
  const imageWidth = Math.max(1, Math.floor(Number(runtime.currentImage.width) || 0));
  const overrides = normalizeManualOverrides(runtime.manualOverrides);
  const lanes = buildLanesFromManualSegmentation(overrides, runtime.currentImage.width) || [];
  if (!lanes.length) {
    return null;
  }

  const segmentation = overrides.laneSegmentation || {};
  if (!Number.isFinite(segmentation.gelLeft) || !Number.isFinite(segmentation.gelRight)) {
    return null;
  }

  const gelLeft = Math.max(0, Math.min(imageWidth - 1, Math.floor(segmentation.gelLeft)));
  const gelRight = Math.max(gelLeft + 1, Math.min(imageWidth - 1, Math.floor(segmentation.gelRight)));
  const gelWidth = Math.max(1, gelRight - gelLeft);
  const leftGapWidth = gelLeft;
  const rightGapWidth = Math.max(0, imageWidth - gelRight);
  const columns = lanes.map((lane) => ({
    laneIndex: lane.index + 1,
    widthPercent: Math.max(0, ((lane.xEnd - lane.xStart + 1) / gelWidth) * 100)
  }));

  return {
    columns,
    laneCount: columns.length,
    leftOffsetPercent: Math.max(0, (leftGapWidth / imageWidth) * 100),
    rightOffsetPercent: Math.max(0, (rightGapWidth / imageWidth) * 100)
  };
}

function hasDividerLayout(overrides) {
  const segmentation = overrides?.laneSegmentation || {};
  return Number.isFinite(segmentation.gelLeft)
    && Number.isFinite(segmentation.gelRight)
    && (Boolean(segmentation.dividerDone) || Boolean(overrides?.laneSegmentation?.dividerDone));
}

export function createLaneTableController({ runtime, elements, safeText, deps = {} }) {
  function updateRows(updater) {
    if (typeof updater !== 'function') {
      return [];
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const currentRows = cloneLaneTableRows(normalized.laneTable?.rows || []);
    const nextRows = updater(currentRows);
    runtime.manualOverrides = {
      ...normalized,
      laneTable: {
        rows: Array.isArray(nextRows) ? nextRows : currentRows
      }
    };
    return runtime.manualOverrides.laneTable.rows;
  }

  function createBlankRow(laneCount) {
    return {
      label: '',
      values: Array.from({ length: Math.max(1, laneCount) }, () => '')
    };
  }

  function focusLastRowLabel() {
    const inputs = elements.gelLaneTableShell?.querySelectorAll?.('[data-gel-table-role="label"]');
    if (!inputs?.length) {
      return;
    }
    const target = inputs[inputs.length - 1];
    target.focus();
    target.select?.();
  }

  function render() {
    if (
      !elements.gelAddTableBtn
      || !elements.gelLaneTableShell
      || !elements.gelViewerStage
      || !elements.gelImageRow
      || !elements.gelLaneTableSpacer
    ) {
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const layout = resolveLaneLayout(runtime);
    const dividerReady = hasDividerLayout(overrides);
    const rows = cloneLaneTableRows(overrides.laneTable?.rows || []);
    const hasTable = Boolean(layout && rows.length && !runtime.cropperActive);
    const canAddTable = dividerReady && Boolean(layout) && !runtime.cropperActive;

    elements.gelAddTableBtn.hidden = false;
    elements.gelAddTableBtn.disabled = !canAddTable || hasTable;
    elements.gelViewerStage.style.setProperty('--gel-lane-label-width', `${LABEL_COLUMN_WIDTH_PX}px`);
    elements.gelViewerStage.classList.toggle('has-lane-table', hasTable);
    elements.gelLaneTableSpacer.hidden = !hasTable;
    elements.gelLaneTableShell.hidden = !hasTable;

    if (!hasTable || !layout) {
      elements.gelLaneTableShell.innerHTML = '';
      return;
    }

    const colMarkup = layout.columns
      .map((column) => `<col style="width:${formatPercentWidth(column.widthPercent)};" />`)
      .join('');
    const headerMarkup = layout.columns
      .map((column) => `<th scope="col">Lane ${column.laneIndex}</th>`)
      .join('');
    const labelMarkup = rows.map((row, rowIndex) => `
      <div class="gel-lane-table-label-cell">
        <input
          type="text"
          class="gel-lane-table-input gel-lane-table-input-label"
          data-gel-table-role="label"
          data-gel-table-row="${rowIndex}"
          value="${safeText(row.label || '')}"
          placeholder="Label"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    `).join('');
    const bodyMarkup = rows.map((row, rowIndex) => {
      const cells = layout.columns.map((_column, columnIndex) => `
        <td>
          <input
            type="text"
            class="gel-lane-table-input"
            data-gel-table-role="value"
            data-gel-table-row="${rowIndex}"
            data-gel-table-col="${columnIndex}"
            value="${safeText(row.values[columnIndex] || '')}"
            placeholder=" "
            autocomplete="off"
            spellcheck="false"
          />
        </td>
      `).join('');

      return `
        <tr>
          ${cells}
        </tr>
      `;
    }).join('');

    elements.gelLaneTableShell.innerHTML = `
      <div class="gel-lane-table-toolbar">
        <p class="small-note">Lane columns stay aligned with the current gel borders and dividers.</p>
        <button type="button" class="ghost-btn" data-gel-table-add-row>Add row</button>
      </div>
      <div class="gel-lane-table-labels">
        <div class="gel-lane-table-label-head">Label</div>
        ${labelMarkup}
      </div>
      <div class="gel-lane-table-grid-shell">
        <div
          class="gel-lane-table-grid-offsets"
          style="padding-left:${formatPercentWidth(layout.leftOffsetPercent)}; padding-right:${formatPercentWidth(layout.rightOffsetPercent)};"
        >
          <div class="gel-lane-table-wrap">
            <table class="gel-lane-table">
              <colgroup>${colMarkup}</colgroup>
              <thead>
                <tr>
                  ${headerMarkup}
                </tr>
              </thead>
              <tbody>
                ${bodyMarkup}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function onAddTableClick() {
    const layout = resolveLaneLayout(runtime);
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    if (!layout || !hasDividerLayout(overrides)) {
      deps.setStatus?.('Set left and right borders, finish dividers, and keep the gel visible before adding the table.');
      return;
    }
    updateRows((rows) => {
      if (rows.length) {
        return rows;
      }
      return [createBlankRow(layout.laneCount)];
    });
    render();
    deps.setStatus?.('Added an aligned table above the gel. Use Add row to expand it.');
    requestAnimationFrame(() => {
      focusLastRowLabel();
    });
  }

  function onShellClick(event) {
    const addRowButton = event?.target?.closest?.('[data-gel-table-add-row]');
    if (!addRowButton) {
      return;
    }
    const layout = resolveLaneLayout(runtime);
    if (!layout) {
      deps.setStatus?.('Reload the gel image and finish lane dividers before adding more rows.');
      return;
    }
    updateRows((rows) => [
      ...rows,
      createBlankRow(layout.laneCount)
    ]);
    render();
    requestAnimationFrame(() => {
      focusLastRowLabel();
    });
  }

  function onShellInput(event) {
    const input = event?.target?.closest?.('[data-gel-table-row]');
    if (!input) {
      return;
    }

    const rowIndex = Number(input.dataset.gelTableRow);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return;
    }

    const role = String(input.dataset.gelTableRole || '');
    const columnIndex = Number(input.dataset.gelTableCol);
    const nextValue = String(input.value || '').slice(0, 160);
    updateRows((rows) => {
      if (!rows[rowIndex]) {
        return rows;
      }
      const nextRows = cloneLaneTableRows(rows);
      if (role === 'label') {
        nextRows[rowIndex].label = nextValue;
        return nextRows;
      }
      if (role === 'value' && Number.isInteger(columnIndex) && columnIndex >= 0) {
        while (nextRows[rowIndex].values.length <= columnIndex) {
          nextRows[rowIndex].values.push('');
        }
        nextRows[rowIndex].values[columnIndex] = nextValue;
      }
      return nextRows;
    });
  }

  return {
    onAddTableClick,
    onShellClick,
    onShellInput,
    render
  };
}
