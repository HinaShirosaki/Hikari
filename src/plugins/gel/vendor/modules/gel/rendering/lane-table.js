import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { downloadBinaryFile, downloadDataUrlFile } from '../export.js';
import { normalizeManualOverrides, safeFilePart } from '../shared.js';
import { buildGelFigurePlan, createGelFigureCanvas, createGelImageCanvas } from './figure-export.js';
import { createGelPowerPoint } from './powerpoint-export.js';

export { buildGelFigurePlan, createGelFigureCanvas, createGelImageCanvas, createGelPowerPoint };

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

function normalizeColumnWidths(columns) {
  const totalWidth = columns.reduce((sum, column) => sum + column.widthPercent, 0);
  if (!columns.length || totalWidth <= 0) {
    return [];
  }
  return columns.map((column) => ({
    ...column,
    widthPercent: (column.widthPercent / totalWidth) * 100
  }));
}

function resolveVisibleLayout(layout, includeLadder, ladderLane) {
  const columns = Array.isArray(layout?.columns) ? layout.columns : [];
  const baseLayout = {
    columns: normalizeColumnWidths(columns),
    leftOffsetPercent: layout?.leftOffsetPercent || 0,
    rightOffsetPercent: layout?.rightOffsetPercent || 0
  };
  if (includeLadder || !ladderLane) {
    return baseLayout;
  }

  const ladderColumnIndex = columns.findIndex((column) => column.laneIndex === ladderLane);
  if (ladderColumnIndex < 0) {
    return baseLayout;
  }

  const ladderColumn = columns[ladderColumnIndex];
  if (ladderColumnIndex === 0 || ladderColumnIndex === columns.length - 1) {
    const gelWidthPercent = Math.max(
      0,
      100 - baseLayout.leftOffsetPercent - baseLayout.rightOffsetPercent
    );
    const ladderWidthPercent = (ladderColumn.widthPercent / 100) * gelWidthPercent;
    return {
      columns: normalizeColumnWidths(columns.filter((column) => column !== ladderColumn)),
      leftOffsetPercent: baseLayout.leftOffsetPercent + (ladderColumnIndex === 0 ? ladderWidthPercent : 0),
      rightOffsetPercent: baseLayout.rightOffsetPercent
        + (ladderColumnIndex === columns.length - 1 ? ladderWidthPercent : 0)
    };
  }

  // An interior ladder leaves two non-contiguous sample groups in the source gel.
  // Keep its track as an invisible gap so every remaining header stays over its lane.
  return {
    ...baseLayout,
    columns: baseLayout.columns.map((column) => ({
      ...column,
      excluded: column.laneIndex === ladderLane
    }))
  };
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
  let figureExportPromise = null;

  function resolveLadderLane(layout = resolveLaneLayout(runtime)) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const requested = Math.floor(Number(normalized.ladderLane));
    return Number.isFinite(requested) && requested >= 1 && requested <= (layout?.laneCount || 0)
      ? requested
      : null;
  }

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

  // ponytail: fit the gel to the stage box so a slim crop is not cut off at the
  // bottom. The lane table shares the same max width so its columns stay aligned.
  // Crop mode keeps the fitted box too: Cropper sizes its container from the shell,
  // so a definite shell height is what leaves room around the crop handles.
  function fitViewerToStage() {
    const stage = elements.gelViewerStage;
    const row = elements.gelImageRow;
    const image = runtime.currentImage;
    const stageHeight = stage?.clientHeight || 0;
    if (!stage || !row) {
      return;
    }
    const labelWidth = stage.classList.contains('has-lane-table') ? LABEL_COLUMN_WIDTH_PX : 0;
    const usableWidth = (stage.clientWidth || 0) - labelWidth;
    const rowTop = row.getBoundingClientRect?.()?.top;
    const stageTop = stage.getBoundingClientRect?.()?.top;
    const contentTop = Number.isFinite(rowTop) && Number.isFinite(stageTop) ? rowTop - stageTop : 0;
    const usableHeight = stageHeight - contentTop;
    if (!image?.width || !image?.height || usableWidth <= 0 || usableHeight <= 0) {
      stage.classList.remove('is-fitted');
      return;
    }
    const canvasWidth = Math.min(usableWidth, (usableHeight * image.width) / image.height);
    stage.style.setProperty('--gel-fit-width', `${Math.floor(canvasWidth + labelWidth)}px`);
    stage.style.setProperty('--gel-fit-height', `${Math.floor(usableHeight)}px`);
    stage.classList.add('is-fitted');
  }

  function render() {
    renderLaneTableShell();
    fitViewerToStage();
  }

  function renderLaneTableShell() {
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
    const ladderLane = resolveLadderLane(layout);
    const includeLadder = runtime.figureExportIncludeLadder !== false;
    const visibleLayout = resolveVisibleLayout(layout, includeLadder, ladderLane);
    const visibleColumns = visibleLayout.columns;

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

    const colMarkup = visibleColumns
      .map((column) => `<col style="width:${formatPercentWidth(column.widthPercent)};" />`)
      .join('');
    const headerMarkup = visibleColumns
      .map((column) => column.excluded
        ? '<th class="gel-lane-table-excluded-cell" aria-hidden="true"></th>'
        : `<th scope="col">Lane ${column.laneIndex}</th>`)
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
      const cells = visibleColumns.map((column) => {
        if (column.excluded) {
          return '<td class="gel-lane-table-excluded-cell" aria-hidden="true"></td>';
        }
        const columnIndex = column.laneIndex - 1;
        return `
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
      `;
      }).join('');

      return `
        <tr>
          ${cells}
        </tr>
      `;
    }).join('');

    elements.gelLaneTableShell.innerHTML = `
      <div class="gel-lane-table-toolbar">
        <div class="gel-lane-table-actions">
          <label class="small-note gel-lane-table-ladder-choice">
            <input
              type="checkbox"
              data-gel-table-include-ladder
              ${includeLadder ? 'checked' : ''}
              ${ladderLane ? '' : 'disabled'}
            />
            Include ladder lane
          </label>
          <button type="button" class="ghost-btn" data-gel-table-add-row>Add row</button>
          <button type="button" class="primary-btn" data-gel-table-generate-image>Generate image</button>
          <button type="button" class="ghost-btn" data-gel-table-generate-pptx>Generate PowerPoint</button>
        </div>
      </div>
      <div class="gel-lane-table-labels">
        <div class="gel-lane-table-label-head">Label</div>
        ${labelMarkup}
      </div>
      <div class="gel-lane-table-grid-shell">
        <div
          class="gel-lane-table-grid-offsets"
          style="padding-left:${formatPercentWidth(visibleLayout.leftOffsetPercent)}; padding-right:${formatPercentWidth(visibleLayout.rightOffsetPercent)};"
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
      deps.setStatus?.('Set and finish the lane dividers, then keep the gel visible before adding the table.');
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

  async function onGenerateFigureClick(button = null) {
    if (figureExportPromise) {
      return figureExportPromise;
    }
    if (!runtime.currentImage?.imageData) {
      deps.setStatus?.('Load a gel image before generating a figure.');
      return null;
    }

    const layout = resolveLaneLayout(runtime);
    const includeLadder = runtime.figureExportIncludeLadder !== false;
    const ladderLane = resolveLadderLane(layout);
    const originalLabel = button?.textContent || 'Generate image';
    if (button) {
      button.disabled = true;
      button.setAttribute?.('aria-busy', 'true');
      button.textContent = 'Generating…';
    }

    figureExportPromise = Promise.resolve()
      .then(async () => {
        const imageData = deps.getFigureImageData?.() || runtime.currentImage.imageData;
        const createFigure = deps.createGelFigureCanvas || createGelFigureCanvas;
        const result = createFigure({
          documentObject: deps.documentObject || elements.gelLaneTableShell?.ownerDocument || globalThis?.document,
          imageData,
          imageWidth: runtime.currentImage.width,
          imageHeight: runtime.currentImage.height,
          manualOverrides: runtime.manualOverrides,
          includeLadder,
          ladderLane
        });
        const fileName = `${safeFilePart(elements.gelNameInput?.value, 'gel-figure')}.png`;
        const dataUrl = result.canvas.toDataURL('image/png');
        const downloadFigure = deps.downloadDataUrlFile || downloadDataUrlFile;
        const downloadResult = await downloadFigure({ dataUrl, fileName });
        if (downloadResult?.canceled) {
          deps.setStatus?.('Image export canceled.');
          return downloadResult;
        }
        // Cleared, not announced: the saved file is its own confirmation, but the
        // previous status must not linger as if it described this export.
        deps.setStatus?.('');
        return downloadResult;
      })
      .catch((error) => {
        deps.setStatus?.(`Could not generate image: ${error?.message || error}`);
        return null;
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.removeAttribute?.('aria-busy');
          button.textContent = originalLabel;
        }
        figureExportPromise = null;
      });
    return figureExportPromise;
  }

  async function onGeneratePowerPointClick(button = null) {
    if (figureExportPromise) {
      return figureExportPromise;
    }
    if (!runtime.currentImage?.imageData) {
      deps.setStatus?.('Load a gel image before generating a PowerPoint.');
      return null;
    }

    const layout = resolveLaneLayout(runtime);
    const includeLadder = runtime.figureExportIncludeLadder !== false;
    const ladderLane = resolveLadderLane(layout);
    const originalLabel = button?.textContent || 'Generate PowerPoint';
    if (button) {
      button.disabled = true;
      button.setAttribute?.('aria-busy', 'true');
      button.textContent = 'Generating…';
    }

    figureExportPromise = Promise.resolve()
      .then(async () => {
        const imageData = deps.getFigureImageData?.() || runtime.currentImage.imageData;
        const createGelImage = deps.createGelImageCanvas || createGelImageCanvas;
        const gelResult = createGelImage({
          documentObject: deps.documentObject || elements.gelLaneTableShell?.ownerDocument || globalThis?.document,
          imageData,
          imageWidth: runtime.currentImage.width,
          imageHeight: runtime.currentImage.height,
          manualOverrides: runtime.manualOverrides,
          includeLadder,
          ladderLane
        });
        const title = String(elements.gelNameInput?.value || '').trim() || 'Gel figure';
        const createPowerPoint = deps.createGelPowerPoint || createGelPowerPoint;
        const powerPoint = await createPowerPoint({
          plan: gelResult.plan,
          gelImageDataUrl: gelResult.canvas.toDataURL('image/png'),
          title
        });
        const fileName = `${safeFilePart(title, 'gel-figure')}.pptx`;
        const downloadPowerPoint = deps.downloadBinaryFile || downloadBinaryFile;
        const downloadResult = await downloadPowerPoint({
          bytes: powerPoint.bytes,
          fileName,
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        });
        if (downloadResult?.canceled) {
          deps.setStatus?.('PowerPoint export canceled.');
          return downloadResult;
        }
        const cropSummary = gelResult.plan.croppedToBandLines
          ? ` Cropped to rows ${gelResult.plan.sourceTop}-${gelResult.plan.sourceBottom}.`
          : '';
        const ladderSummary = !gelResult.plan.includeLadder && gelResult.plan.ladderLane
          ? ` Ladder lane ${gelResult.plan.ladderLane} excluded.`
          : '';
        deps.setStatus?.(`Generated ${downloadResult?.fileName || fileName} with an editable table.${cropSummary}${ladderSummary}`);
        return downloadResult;
      })
      .catch((error) => {
        deps.setStatus?.(`Could not generate PowerPoint: ${error?.message || error}`);
        return null;
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.removeAttribute?.('aria-busy');
          button.textContent = originalLabel;
        }
        figureExportPromise = null;
      });
    return figureExportPromise;
  }

  function onShellClick(event) {
    const powerPointButton = event?.target?.closest?.('[data-gel-table-generate-pptx]');
    if (powerPointButton) {
      return onGeneratePowerPointClick(powerPointButton);
    }
    const generateButton = event?.target?.closest?.('[data-gel-table-generate-image]');
    if (generateButton) {
      return onGenerateFigureClick(generateButton);
    }
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
    const ladderToggle = event?.target?.closest?.('[data-gel-table-include-ladder]');
    if (ladderToggle) {
      runtime.figureExportIncludeLadder = Boolean(ladderToggle.checked);
      render();
      return;
    }
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
    onGenerateFigureClick,
    onGeneratePowerPointClick,
    onShellClick,
    onShellInput,
    render,
    fitViewerToStage
  };
}
