import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { downloadBinaryFile, downloadDataUrlFile } from '../export.js';
import { CAPTION_ANGLE, normalizeManualOverrides, safeFilePart } from '../shared.js';
import { buildGelFigurePlan, canvasTextEm, createGelFigureCanvas, createGelImageCanvas } from './figure-export.js';
import { syncTableInputs, tableInputsMarkup, tableInputsShape, writeTableInput } from './table-inputs.js';
import { createGelPowerPoint } from './powerpoint-export.js';

export { buildGelFigurePlan, createGelFigureCanvas, createGelImageCanvas, createGelPowerPoint };

const LABEL_COLUMN_WIDTH_PX = 118;

function cloneLaneTableRows(rows = []) {
  return rows.map((row) => ({
    label: String(row?.label ?? ''),
    values: Array.isArray(row?.values) ? row.values.map((value) => String(value ?? '')) : []
  }));
}

let measureCanvasContext = null;
const measureContext = () => (measureCanvasContext ||= globalThis.document?.createElement?.('canvas')?.getContext?.('2d') || null);

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

export function createLaneTableController({ runtime, elements, deps = {} }) {
  let figureExportPromise = null;
  let panelOpen = null;
  // The export's label column as a share of the image width (0 without a table).
  let labelShare = 0;

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
    const inputs = elements.gelLaneTableShell?.querySelectorAll?.('.gel-table-input.is-label');
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
    // The label column keeps the export's share of the gel width, at least LABEL_COLUMN_WIDTH_PX.
    const tableShown = stage.classList.contains('has-lane-table');
    const minLabelWidth = tableShown ? LABEL_COLUMN_WIDTH_PX : 0;
    const share = tableShown ? labelShare : 0;
    const panel = elements.gelLaneTablePanel;
    const tableWidth = panel && !panel.hidden ? elements.gelLaneTableShell?.clientWidth : 0;
    const totalWidth = Math.min(stage.clientWidth || 0, tableWidth || stage.clientWidth || 0);
    const usableWidth = Math.min(totalWidth - minLabelWidth, totalWidth / (1 + share));
    // The table strip's height is a fixed share of the image width (container
    // units), so solve for the width that fits both. The dock stops at 42% of
    // the stage (its CSS max-height); past that a long table scrolls in it.
    const docked = Boolean(panel && !panel.hidden);
    const strip = docked ? elements.gelLaneTableShell?.querySelector?.('.gel-table-strip-lanes') : null;
    const stripPerWidth = strip?.clientWidth ? strip.getBoundingClientRect().height / strip.clientWidth : 0;
    const bodyHeight = strip?.closest?.('.gel-lane-table-body')?.clientHeight || 0;
    const fixedHeight = docked ? panel.getBoundingClientRect().height - bodyHeight + 12 : 0;
    if (!image?.width || !image?.height || usableWidth <= 0 || stageHeight - fixedHeight <= 0) {
      stage.classList.remove('is-fitted');
      return;
    }
    const aspect = image.width / image.height;
    let canvasWidth = Math.min(usableWidth, (stageHeight - fixedHeight) * aspect / (1 + stripPerWidth * aspect));
    if (fixedHeight - 12 + stripPerWidth * canvasWidth > stageHeight * 0.42) {
      canvasWidth = Math.min(usableWidth, (stageHeight * 0.58 - 12) * aspect);
    }
    const labelWidth = Math.max(minLabelWidth, Math.round(canvasWidth * share));
    stage.style.setProperty('--gel-lane-label-width', `${labelWidth || LABEL_COLUMN_WIDTH_PX}px`);
    stage.style.setProperty('--gel-fit-width', `${Math.floor(canvasWidth + labelWidth)}px`);
    const fittedHeight = canvasWidth * image.height / image.width;
    stage.style.setProperty('--gel-fit-height', `${Math.floor(fittedHeight)}px`);
    stage.classList.add('is-fitted');
  }

  function render() {
    renderLaneTableShell();
    fitViewerToStage();
  }

  function renderLaneTableShell() {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const layout = resolveLaneLayout(runtime);
    const dividerReady = hasDividerLayout(overrides);
    const rows = cloneLaneTableRows(overrides.laneTable?.rows || []);
    const hasTable = Boolean(layout && rows.length && !runtime.cropperActive);
    const canAddTable = dividerReady && Boolean(layout) && !runtime.cropperActive;
    // Export only needs finished lane dividers, so the toolbar buttons stay usable
    // whether or not a lane table has been added.
    const canExport = canAddTable && Boolean(runtime.currentImage?.imageData);
    if (elements.gelExportImageBtn) {
      elements.gelExportImageBtn.disabled = !canExport;
    }
    if (elements.gelExportPptxBtn) {
      elements.gelExportPptxBtn.disabled = !canExport;
    }

    if (
      !elements.gelAddTableBtn
      || !elements.gelLaneTableShell
      || !elements.gelViewerStage
      || !elements.gelImageRow
      || !elements.gelLaneTableSpacer
    ) {
      return;
    }

    const ladderLane = resolveLadderLane(layout);
    const includeLadder = runtime.figureExportIncludeLadder !== false;

    // The table strip shows with any gel image until closed, so Add table stays
    // in reach; without finished dividers, clicking it says what is missing.
    const panelVisible = !runtime.cropperActive && (panelOpen ?? (hasTable || Boolean(runtime.currentImage)));
    if (elements.gelLaneTablePanel) elements.gelLaneTablePanel.hidden = !panelVisible;
    elements.gelOpenLaneTableBtn?.setAttribute('aria-expanded', String(panelVisible));
    elements.gelOpenLaneTableBtn?.classList.toggle('is-active', panelVisible);
    elements.gelAddTableBtn.hidden = hasTable;
    elements.gelAddTableBtn.disabled = hasTable || !runtime.currentImage || runtime.cropperActive;
    elements.gelLaneTablePanel?.querySelectorAll?.('[data-gel-table-add-row],[data-gel-table-remove-row]')
      .forEach((node) => { node.hidden = !hasTable; });
    const ladderChoice = elements.gelLaneTablePanel?.querySelector?.('[data-gel-table-ladder]');
    if (ladderChoice) ladderChoice.hidden = !hasTable || !ladderLane;
    const ladderToggle = elements.gelLaneTablePanel?.querySelector?.('[data-gel-table-include-ladder]');
    if (ladderToggle) {
      ladderToggle.checked = includeLadder;
      ladderToggle.disabled = !ladderLane;
    }
    const inlineTable = hasTable && (!elements.gelLaneTablePanel || panelVisible);
    elements.gelViewerStage.classList.toggle('has-lane-table', inlineTable);
    elements.gelLaneTableSpacer.hidden = !inlineTable;
    const shell = elements.gelLaneTableShell;
    shell.hidden = !hasTable;

    labelShare = 0;
    if (!hasTable || !layout) {
      shell.dataset.shape = '';
      i18nUi.setHtml(shell, '');
      return;
    }

    // The strip shows the table as the export draws it (figure-export.js), over
    // the image's own lanes: positions in percent of the image width, type and
    // heights in container units, so it follows the fitted gel at any size.
    const image = runtime.currentImage;
    const lanes = buildLanesFromManualSegmentation(overrides, image.width) || [];
    const plan = buildGelFigurePlan({ imageWidth: image.width, imageHeight: image.height, manualOverrides: overrides,
      includeLadder, ladderLane, measureTextEm: canvasTextEm(measureContext()) });
    const percent = (value) => `${value / image.width * 100}%`;
    const fluid = (value) => `calc(${value / image.width * 100} * 1cqw)`;
    const line = plan.fontSize * 1.6;
    labelShare = plan.labelWidth / image.width;
    const cells = rows.flatMap((_, row) => {
      const center = plan.captions ? plan.captions.y : (row + 0.5) * plan.rowHeight;
      const height = plan.captions ? line : plan.rowHeight;
      return [
        { row, lane: 0, style: `left:calc(-1 * var(--gel-lane-label-width));width:var(--gel-lane-label-width);top:${fluid(center - height / 2)};height:${fluid(height)}` },
        ...plan.slices.map((slice, index) => {
          const lane = lanes[slice.laneIndex - 1];
          return plan.captions
            ? { row, lane: slice.laneIndex, rotated: true, style: `left:${percent(lane.center)};top:${fluid(plan.captions.y - line / 2)};width:${fluid(Math.max(plan.captions.widths[index], plan.fontSize * 2) + plan.fontSize)};height:${fluid(line)}` }
            : { row, lane: slice.laneIndex, style: `left:${percent(lane.xStart)};width:${percent(lane.xEnd - lane.xStart + 1)};top:${fluid(row * plan.rowHeight)};height:${fluid(plan.rowHeight)}` };
        })
      ];
    });
    shell.style.setProperty('--table-font', String(plan.fontSize / image.width * 100));
    // Slack below the rows keeps a label centered on the caption line inside the strip.
    shell.style.setProperty('--table-height', fluid(plan.tableHeight - plan.tableGap + plan.fontSize / 2));
    shell.style.setProperty('--caption-angle', `-${CAPTION_ANGLE}deg`);
    const shape = tableInputsShape(cells);
    if (shell.dataset.shape === shape) {
      syncTableInputs(shell, cells, rows);
      return;
    }
    shell.dataset.shape = shape;
    i18nUi.setHtml(shell, `<div class="gel-table-strip-label"></div><div class="gel-table-strip-lanes"><div class="gel-table-strip-box">${tableInputsMarkup(cells, rows)}</div></div>`);
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
    panelOpen = true;
    render();
    deps.setStatus?.('');
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

    const originalLabel = button?.textContent || 'Export image';
    if (button) {
      button.disabled = true;
      button.setAttribute?.('aria-busy', 'true');
      i18nUi.setText(button, i18nUi.message("Generating…"));
    }

    figureExportPromise = Promise.resolve()
      .then(async () => {
        const imageData = await deps.getFigureImageData?.() || runtime.currentImage.imageData;
        const layout = resolveLaneLayout(runtime);
        const includeLadder = runtime.figureExportIncludeLadder !== false;
        const ladderLane = resolveLadderLane(layout);
        const createFigure = deps.createGelFigureCanvas || createGelFigureCanvas;
        const result = createFigure({
          documentObject: deps.documentObject || elements.gelLaneTableShell?.ownerDocument || globalThis?.document,
          imageData,
          imageWidth: runtime.currentImage.width,
          imageHeight: runtime.currentImage.height,
          manualOverrides: runtime.manualOverrides,
          includeLadder,
          ladderLane,
          showLadderLabels: Boolean(elements.gelExportLadderLabelsInput?.checked),
          ladderPreset: elements.gelLadderPresetSelect?.value
        });
        const fileName = `${safeFilePart(elements.gelNameInput?.value, 'gel-figure')}.png`;
        const dataUrl = result.canvas.toDataURL('image/png');
        const downloadFigure = deps.downloadDataUrlFile || downloadDataUrlFile;
        const downloadResult = await downloadFigure({ dataUrl, fileName });
        if (downloadResult?.canceled) {
          deps.setStatus?.('');
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
          i18nUi.setText(button, originalLabel);
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

    const originalLabel = button?.textContent || 'Export PPT';
    if (button) {
      button.disabled = true;
      button.setAttribute?.('aria-busy', 'true');
      i18nUi.setText(button, i18nUi.message("Generating…"));
    }

    figureExportPromise = Promise.resolve()
      .then(async () => {
        const imageData = await deps.getFigureImageData?.() || runtime.currentImage.imageData;
        const layout = resolveLaneLayout(runtime);
        const includeLadder = runtime.figureExportIncludeLadder !== false;
        const ladderLane = resolveLadderLane(layout);
        const createGelImage = deps.createGelImageCanvas || createGelImageCanvas;
        const gelResult = createGelImage({
          documentObject: deps.documentObject || elements.gelLaneTableShell?.ownerDocument || globalThis?.document,
          imageData,
          imageWidth: runtime.currentImage.width,
          imageHeight: runtime.currentImage.height,
          manualOverrides: runtime.manualOverrides,
          includeLadder,
          ladderLane,
          showLadderLabels: Boolean(elements.gelExportLadderLabelsInput?.checked),
          ladderPreset: elements.gelLadderPresetSelect?.value
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
          deps.setStatus?.('');
          return downloadResult;
        }
        const cropSummary = gelResult.plan.croppedToBandLines
          ? ` Cropped to rows ${gelResult.plan.sourceTop}-${gelResult.plan.sourceBottom}.`
          : '';
        const ladderSummary = !gelResult.plan.includeLadder && gelResult.plan.ladderLane
          ? ` Ladder lane ${gelResult.plan.ladderLane} excluded.`
          : '';
        const tableSummary = gelResult.plan.rows?.length ? ' with an editable table' : '';
        deps.setStatus?.(`Generated ${downloadResult?.fileName || fileName}${tableSummary}.${cropSummary}${ladderSummary}`);
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
          i18nUi.setText(button, originalLabel);
        }
        figureExportPromise = null;
      });
    return figureExportPromise;
  }

  function onShellClick(event) {
    if (event?.target?.closest?.('[data-gel-table-remove-row]')) {
      updateRows((rows) => rows.slice(0, -1));
      render();
      return;
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
    const input = event?.target?.closest?.('.gel-table-input');
    if (!input) {
      return;
    }
    updateRows((rows) => {
      writeTableInput(rows, input);
      return rows;
    });
    render();
  }

  function onTogglePanel() {
    panelOpen = Boolean(elements.gelLaneTablePanel?.hidden);
    render();
  }

  function onClosePanel() {
    panelOpen = false;
    render();
    elements.gelOpenLaneTableBtn?.focus({ preventScroll: true });
  }

  return {
    onTogglePanel,
    onClosePanel,
    onAddTableClick,
    onGenerateFigureClick,
    onGeneratePowerPointClick,
    onShellClick,
    onShellInput,
    render,
    fitViewerToStage
  };
}
