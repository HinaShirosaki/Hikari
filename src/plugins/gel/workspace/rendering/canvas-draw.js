import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import {
  clamp,
  getLaneRowSegment,
  getLaneVertexArray,
  hasAnyTargetBandWindow,
  isPerLaneBandMode,
  laneContainsPoint,
  lanePointToRectifiedRow,
  normalizeLaneBandWindows,
  normalizeManualOverrides,
  round
} from '../shared.js';
import {
  createCellTableController,
  formatIntensity,
  readSnrThreshold
} from './cell-table.js';

export function selectViewerBaseImageData(currentImage, preprocessed = null, viewerMode = 'original') {
  if (viewerMode === 'processed' && preprocessed?.previewImageData) {
    return preprocessed.previewImageData;
  }
  return currentImage?.imageData || null;
}

export function createCanvasDrawController({
  runtime,
  elements,
  safeText,
  deps = {},
  clearLaneProfileHover,
  getLaneProfileLanes,
  getLastProfile,
  getLastProfileLane,
  laneProfileViewbox,
  renderLaneProfile,
  renderPeakEditor,
  setLaneProfileHover
}) {
  const { renderCellTable } = createCellTableController({ runtime, elements, safeText });

  function strokeLaneOutline(context, lane, height) {
    const vertices = getLaneVertexArray(lane);
    if (vertices.length >= 4) {
      context.beginPath();
      context.moveTo(vertices[0].x + 0.5, vertices[0].y + 0.5);
      vertices.slice(1).forEach((point) => {
        context.lineTo(point.x + 0.5, point.y + 0.5);
      });
      context.closePath();
      context.stroke();
      return;
    }
    context.strokeRect(
      lane.xStart + 0.5,
      0.5,
      Math.max(1, lane.xEnd - lane.xStart),
      Math.max(1, height - 1)
    );
  }

  function strokeLaneRowSegment(context, lane, y) {
    const segment = getLaneRowSegment(lane, y, runtime.currentImage?.height);
    context.beginPath();
    context.moveTo(segment.left.x + 0.5, segment.left.y + 0.5);
    context.lineTo(segment.right.x + 0.5, segment.right.y + 0.5);
    context.stroke();
    return true;
  }

  function strokeLaneWindow(context, lane, top, bottom) {
    const topSegment = getLaneRowSegment(lane, top, runtime.currentImage?.height);
    const bottomSegment = getLaneRowSegment(lane, bottom, runtime.currentImage?.height);
    context.beginPath();
    context.moveTo(topSegment.left.x + 0.5, topSegment.left.y + 0.5);
    context.lineTo(topSegment.right.x + 0.5, topSegment.right.y + 0.5);
    context.lineTo(bottomSegment.right.x + 0.5, bottomSegment.right.y + 0.5);
    context.lineTo(bottomSegment.left.x + 0.5, bottomSegment.left.y + 0.5);
    context.closePath();
    context.stroke();
    return true;
  }

  function drawLaneVertexHandles(context, lanes, savedLaneVertices = []) {
    const vertexToolActive = runtime.selectedViewerTool === 'lane-vertices';
    const savedLaneIndexes = new Set(
      (Array.isArray(savedLaneVertices) ? savedLaneVertices : [])
        .map((item) => Number(item?.laneIndex))
        .filter(Number.isFinite)
    );
    const outlineLanes = vertexToolActive
      ? lanes
      : lanes.filter((lane) => savedLaneIndexes.has(lane.index + 1));
    if (!outlineLanes.length) {
      return;
    }
    context.save();
    context.lineWidth = 1.7;
    context.strokeStyle = 'rgba(14, 165, 233, 0.95)';
    context.setLineDash([5, 3]);
    outlineLanes.forEach((lane) => {
      strokeLaneOutline(context, lane, runtime.currentImage.height);
    });
    if (!vertexToolActive) {
      context.restore();
      return;
    }
    context.setLineDash([]);
    context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
    outlineLanes.forEach((lane) => {
      const points = getLaneVertexArray(lane);
      points.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x + 0.5, point.y + 0.5, 5, 0, Math.PI * 2);
        context.fillStyle = 'rgba(14, 165, 233, 0.95)';
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.stroke();
        context.fillStyle = 'rgba(255, 255, 255, 0.98)';
        context.fillText(String(index + 1), point.x + 7, point.y - 5);
      });
    });
    context.restore();
  }

  function drawHoverLineOnCanvas(context) {
    const lastProfileLane = getLastProfileLane();
    if (runtime.laneProfileHoverY == null || !lastProfileLane) return;
    const y = Math.max(0, Math.min(runtime.currentImage.height - 1, Math.round(runtime.laneProfileHoverY)));
    const segment = getLaneRowSegment(lastProfileLane, y, runtime.currentImage.height);
    context.save();
    context.lineWidth = 1.4;
    context.strokeStyle = 'rgba(250, 204, 21, 0.95)';
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(segment.left.x + 0.5, segment.left.y + 0.5);
    context.lineTo(segment.right.x + 0.5, segment.right.y + 0.5);
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  function strokeRowsForLanes(context, lanes, rowY, fallbackColor = 'rgba(56, 189, 248, 0.95)') {
    const y = clamp(rowY, 0, runtime.currentImage.height - 1);
    context.strokeStyle = fallbackColor;
    if (lanes.length) {
      lanes.forEach((lane) => {
        strokeLaneRowSegment(context, lane, y);
      });
      return;
    }
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(runtime.currentImage.width, y + 0.5);
    context.stroke();
  }

  function onLaneProfileChartMouseMove(event) {
    const lastProfile = getLastProfile();
    if (!lastProfile || !elements.gelLaneProfileChart) return;
    const svg = elements.gelLaneProfileChart;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const { plotLeft, plotRight, width: viewBoxWidth } = laneProfileViewbox;
    const svgX = ((event.clientX - rect.left) / rect.width) * viewBoxWidth;
    if (svgX < plotLeft - 1 || svgX > plotRight + 1) {
      onLaneProfileChartMouseLeave();
      return;
    }
    const rowMax = Math.max(1, lastProfile.values.length - 1);
    const fraction = (svgX - plotLeft) / (plotRight - plotLeft);
    const rowIndex = Math.min(Math.max(0, Math.round(fraction * rowMax)), rowMax);
    setLaneProfileHover(svg, lastProfile, rowIndex);
    runtime.laneProfileHoverY = rowIndex;
    drawCanvas();
  }

  function onLaneProfileChartMouseLeave() {
    clearLaneProfileHover(elements.gelLaneProfileChart);
    if (runtime.laneProfileHoverY != null) {
      runtime.laneProfileHoverY = null;
      drawCanvas();
    }
  }

  function canvasPointFromEvent(event) {
    const canvas = elements.gelCanvas;
    if (!canvas || !runtime.currentImage) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) / rect.width) * runtime.currentImage.width;
    const y = ((event.clientY - rect.top) / rect.height) * runtime.currentImage.height;
    return {
      x: clamp(Math.round(x), 0, runtime.currentImage.width - 1),
      y: clamp(Math.round(y), 0, runtime.currentImage.height - 1)
    };
  }

  function findLaneAtPoint(point) {
    const lanes = getLaneProfileLanes();
    if (!lanes.length) return null;
    return lanes.find((lane) => laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width))
      || lanes.find((lane) => point.x >= lane.xStart && point.x <= lane.xEnd)
      || null;
  }

  function onCanvasHoverMove(event) {
    if (!runtime.currentImage || runtime.cropperActive) return;
    const point = canvasPointFromEvent(event);
    if (!point) return;
    const lane = findLaneAtPoint(point);
    if (!lane) {
      onCanvasHoverLeave();
      return;
    }
    let needsProfileRender = false;
    if (lane.laneIndex !== runtime.selectedLaneProfileLane) {
      runtime.selectedLaneProfileLane = lane.laneIndex;
      needsProfileRender = true;
    }
    const rowY = lanePointToRectifiedRow(lane, point, runtime.currentImage.height) ?? point.y;
    runtime.laneProfileHoverY = rowY;
    if (needsProfileRender) {
      renderLaneProfile();
    } else {
      const lastProfile = getLastProfile();
      if (lastProfile) {
        setLaneProfileHover(elements.gelLaneProfileChart, lastProfile, rowY);
      }
    }
    drawCanvas();
  }

  function onCanvasHoverLeave() {
    if (runtime.laneProfileHoverY == null) return;
    runtime.laneProfileHoverY = null;
    clearLaneProfileHover(elements.gelLaneProfileChart);
    drawCanvas();
  }

  function drawCellOverlays(context, overrides) {
    const reportLanes = runtime.currentReport?.lanes || [];
    if (!reportLanes.length) {
      return;
    }
    const segmentation = overrides.laneSegmentation || {};
    if (!hasAnyTargetBandWindow(segmentation)) {
      return;
    }
    const threshold = readSnrThreshold(elements.gelCellSnrThresholdInput);

    context.save();
    context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
    reportLanes.forEach((lane) => {
      const cell = lane.targetBand;
      if (!cell) {
        return;
      }
      const top = clamp(Math.min(cell.top, cell.bottom), 0, runtime.currentImage.height - 1);
      const bottom = clamp(Math.max(cell.top, cell.bottom), top + 1, runtime.currentImage.height - 1);
      const hasBand = Number(cell.snr) >= threshold;
      context.lineWidth = 1.4;
      if (hasBand) {
        context.setLineDash([]);
        context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
      } else {
        context.setLineDash([4, 3]);
        context.strokeStyle = 'rgba(148, 163, 184, 0.85)';
      }
      strokeLaneWindow(context, lane, top, bottom);
      context.setLineDash([]);
      const label = formatIntensity(Number(cell.correctedIntensity));
      const topSegment = getLaneRowSegment(lane, top, runtime.currentImage.height);
      context.fillStyle = hasBand ? 'rgba(34, 197, 94, 0.95)' : 'rgba(148, 163, 184, 0.9)';
      const textY = Math.max(10, topSegment.left.y - 2);
      context.fillText(label, topSegment.left.x + 2, textY);
    });
    context.restore();
  }

  function drawCanvas() {
    if (!elements.gelCanvas) {
      return;
    }
    const context = elements.gelCanvas.getContext('2d');
    if (!runtime.currentImage || !context) {
      elements.gelCanvas.width = 1;
      elements.gelCanvas.height = 1;
      context?.clearRect(0, 0, 1, 1);
      return;
    }

    elements.gelCanvas.width = runtime.currentImage.width;
    elements.gelCanvas.height = runtime.currentImage.height;
    const viewerMode = runtime.viewerMode === 'processed' ? 'processed' : 'original';
    const preprocessed = viewerMode === 'processed'
      ? deps.getPreprocessedImageForCurrentSettings?.()
      : null;
    const baseImageData = selectViewerBaseImageData(runtime.currentImage, preprocessed, viewerMode);
    context.putImageData(baseImageData, 0, 0);

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const segmentationLanes = buildLanesFromManualSegmentation(
      overrides,
      runtime.currentImage.width,
      runtime.currentImage.height
    ) || [];
    if (
      Number.isFinite(segmentation.gelLeft)
      || Number.isFinite(segmentation.gelRight)
      || (Array.isArray(segmentation.dividers) && segmentation.dividers.length)
    ) {
      context.save();
      context.lineWidth = 1.4;
      if (Number.isFinite(segmentation.gelLeft)) {
        const x = clamp(segmentation.gelLeft, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      }
      if (Number.isFinite(segmentation.gelRight)) {
        const x = clamp(segmentation.gelRight, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      }
      (Array.isArray(segmentation.dividers) ? segmentation.dividers : []).forEach((divider) => {
        const x = clamp(divider, 0, runtime.currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, runtime.currentImage.height);
        context.stroke();
      });

      const laneBandMode = isPerLaneBandMode(segmentation);
      if (!laneBandMode && Number.isFinite(segmentation.bandTop)) {
        const y = clamp(segmentation.bandTop, 0, runtime.currentImage.height - 1);
        strokeRowsForLanes(context, segmentationLanes, y);
      }
      if (!laneBandMode && Number.isFinite(segmentation.bandBottom)) {
        const y = clamp(segmentation.bandBottom, 0, runtime.currentImage.height - 1);
        strokeRowsForLanes(context, segmentationLanes, y);
      }

      if (!laneBandMode && Number.isFinite(segmentation.bandTop) && Number.isFinite(segmentation.bandBottom) && segmentationLanes.length) {
        const top = clamp(Math.min(segmentation.bandTop, segmentation.bandBottom), 0, runtime.currentImage.height - 1);
        const bottom = clamp(Math.max(segmentation.bandTop, segmentation.bandBottom), top + 1, runtime.currentImage.height - 1);
        segmentationLanes.forEach((lane) => {
          context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
          context.lineWidth = 1.2;
          strokeLaneWindow(context, lane, top, bottom);
        });
      }

      if (laneBandMode && segmentationLanes.length) {
        const laneWindowByIndex = new Map(
          normalizeLaneBandWindows(segmentation.laneBandWindows)
            .map((window) => [window.laneIndex, window])
        );
        segmentationLanes.forEach((lane) => {
          const laneIndex = lane.index + 1;
          const window = laneWindowByIndex.get(laneIndex);
          if (!window) {
            return;
          }
          context.lineWidth = 1.4;
          context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
          if (Number.isFinite(window.bandTop)) {
            const y = clamp(window.bandTop, 0, runtime.currentImage.height - 1);
            strokeLaneRowSegment(context, lane, y);
          }
          if (Number.isFinite(window.bandBottom)) {
            const y = clamp(window.bandBottom, 0, runtime.currentImage.height - 1);
            strokeLaneRowSegment(context, lane, y);
          }
          if (Number.isFinite(window.bandTop) && Number.isFinite(window.bandBottom)) {
            const top = clamp(Math.min(window.bandTop, window.bandBottom), 0, runtime.currentImage.height - 1);
            const bottom = clamp(Math.max(window.bandTop, window.bandBottom), top + 1, runtime.currentImage.height - 1);
            context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
            context.lineWidth = 1.2;
            strokeLaneWindow(context, lane, top, bottom);
          }
        });
      }

      if (Number.isFinite(overrides.ladderLane) && segmentationLanes.length) {
        const ladder = segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane);
        if (ladder) {
          context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
          context.lineWidth = 2.2;
          strokeLaneOutline(context, ladder, runtime.currentImage.height);
        }
      }

      (Array.isArray(overrides.ladderBands) ? overrides.ladderBands : []).forEach((item) => {
        const y = clamp(Math.round(item.pixelY), 0, runtime.currentImage.height - 1);
        const ladderLane = Number.isFinite(overrides.ladderLane)
          ? segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane)
          : null;
        const labelSegment = ladderLane
          ? getLaneRowSegment(ladderLane, y, runtime.currentImage.height)
          : null;
        context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
        context.lineWidth = 1.2;
        if (ladderLane) {
          strokeLaneRowSegment(context, ladderLane, y);
        } else {
          context.beginPath();
          context.moveTo(0, y + 0.5);
          context.lineTo(runtime.currentImage.width, y + 0.5);
          context.stroke();
        }
        context.fillStyle = 'rgba(255, 197, 61, 0.98)';
        context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(
          `${round(item.mw, 1)}kDa`,
          labelSegment ? labelSegment.right.x + 3 : 4,
          labelSegment ? labelSegment.right.y - 3 : Math.max(10, y - 3)
        );
      });
      context.restore();
    }

    drawCellOverlays(context, overrides);

    if (runtime.currentReport?.lanes?.length) {
      runtime.currentReport.lanes.forEach((lane) => {
        const isLadder = (overrides.ladderLane === lane.laneIndex)
          || (runtime.currentReport.calibration?.ladderLane === lane.laneIndex);
        context.strokeStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.9)';
        context.lineWidth = isLadder ? 2.2 : 1.6;
        strokeLaneOutline(context, lane, runtime.currentImage.height);

        const labelSegment = getLaneRowSegment(lane, 0, runtime.currentImage.height);
        context.fillStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.95)';
        context.font = '12px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(String(lane.laneIndex), labelSegment.left.x + 2, Math.max(12, labelSegment.left.y + 12));

        lane.bands.forEach((band) => {
          context.strokeStyle = band.manual ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 99, 132, 0.95)';
          context.lineWidth = 1.3;
          strokeLaneRowSegment(context, lane, band.pixelY);

          if (Number.isFinite(band.estimatedMw)) {
            const bandSegment = getLaneRowSegment(lane, band.pixelY, runtime.currentImage.height);
            context.fillStyle = band.manualMw ? 'rgba(34, 197, 94, 0.95)' : 'rgba(255, 99, 132, 0.92)';
            context.fillText(`${round(band.estimatedMw, 1)}kDa`, bandSegment.right.x + 3, bandSegment.right.y - 1);
          }
        });
      });
    }

    drawLaneVertexHandles(context, segmentationLanes, segmentation.laneVertices);
    drawHoverLineOnCanvas(context);
  }

  function renderCanvas() {
    drawCanvas();
    deps.renderLaneTable?.();
    renderLaneProfile();
    renderCellTable();
    renderPeakEditor();
  }

  return {
    drawCanvas,
    onCanvasHoverLeave,
    onCanvasHoverMove,
    onLaneProfileChartMouseLeave,
    onLaneProfileChartMouseMove,
    renderCanvas,
    renderCellTable
  };
}
