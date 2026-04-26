import { buildLanesFromManualSegmentation } from './analysis-core.js';
import { clamp, mean, normalizeManualOverrides, round } from './shared.js';
import { formatAnalysisTypeLabel } from './presentation.js';

const LANE_PROFILE_VIEWBOX = Object.freeze({
  width: 320,
  height: 190,
  plotLeft: 14,
  plotTop: 14,
  plotRight: 306,
  plotBottom: 164
});

export function selectViewerBaseImageData(currentImage, _preprocessed = null) {
  return currentImage?.imageData || null;
}

function smoothSeries(values, radius = 4) {
  if (!values.length) {
    return [];
  }

  const safeRadius = Math.max(1, Math.floor(radius));
  const output = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
      const sampleIndex = clamp(index + offset, 0, values.length - 1);
      const weight = (safeRadius + 1) - Math.abs(offset);
      weightedSum += values[sampleIndex] * weight;
      totalWeight += weight;
    }
    output[index] = totalWeight ? (weightedSum / totalWeight) : values[index];
  }

  return Array.from(output);
}

function computeLaneIntensityProfile({ signal, width, height, lane }) {
  if (!signal?.length || !lane || width <= 0 || height <= 0) {
    return null;
  }

  const laneWidth = Math.max(1, lane.xEnd - lane.xStart + 1);
  const rowMeans = new Float32Array(height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let rowSum = 0;
    for (let x = lane.xStart; x <= lane.xEnd; x += 1) {
      rowSum += signal[rowOffset + x];
    }
    rowMeans[y] = rowSum / laneWidth;
  }

  const smoothingRadius = Math.max(2, Math.min(10, Math.round(height / 90)));
  const values = smoothSeries(rowMeans, smoothingRadius);

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  let total = 0;
  let peakRow = 0;
  let peakValue = Number.NEGATIVE_INFINITY;

  values.forEach((value, index) => {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
    total += value;
    if (value > peakValue) {
      peakValue = value;
      peakRow = index;
    }
  });

  return {
    values,
    meanValue: values.length ? (total / values.length) : 0,
    minValue: Number.isFinite(minValue) ? minValue : 0,
    maxValue: Number.isFinite(maxValue) ? maxValue : 0,
    peakRow,
    peakValue: Number.isFinite(peakValue) ? peakValue : 0,
    laneWidth
  };
}

function downsampleLaneProfile(values, maxPoints = 220) {
  if (!values.length) {
    return [];
  }

  const targetCount = Math.min(maxPoints, values.length);
  if (targetCount === values.length) {
    return values.map((value, row) => ({ row, value }));
  }

  const bucketSize = values.length / targetCount;
  const points = [];

  for (let bucketIndex = 0; bucketIndex < targetCount; bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = bucketIndex === targetCount - 1
      ? values.length
      : Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));

    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += values[index];
    }

    points.push({
      row: (start + (end - 1)) / 2,
      value: sum / Math.max(1, end - start)
    });
  }

  return points;
}

function buildSmoothPath(points) {
  if (!points.length) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x} ${last.y}`;
  return path;
}

function getLaneProfileLanes(runtime) {
  if (!runtime.currentImage) {
    return [];
  }

  const overrides = normalizeManualOverrides(runtime.manualOverrides);
  const segmented = buildLanesFromManualSegmentation(overrides, runtime.currentImage.width) || [];
  if (segmented.length) {
    return segmented.map((lane) => ({
      laneIndex: lane.index + 1,
      xStart: lane.xStart,
      xEnd: lane.xEnd
    }));
  }

  return (runtime.currentReport?.lanes || []).map((lane) => ({
    laneIndex: lane.laneIndex,
    xStart: lane.xStart,
    xEnd: lane.xEnd
  }));
}

function createFallbackSignal(gray = null) {
  if (!gray?.length) {
    return null;
  }
  const inverted = new Float32Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    inverted[index] = 1 - gray[index];
  }
  return inverted;
}

function renderLaneProfilePlaceholder(svg, message) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = LANE_PROFILE_VIEWBOX;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="lane-profile-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <text class="lane-profile-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">${message}</text>
    <text class="lane-profile-axis-label" x="${plotLeft}" y="${height - 8}">Top</text>
    <text class="lane-profile-axis-label" x="${plotRight}" y="${height - 8}" text-anchor="end">Bottom</text>
  `;
}

function renderLaneProfileSvg(svg, profile, bandTop = null, bandBottom = null) {
  const {
    width,
    height,
    plotLeft,
    plotTop,
    plotRight,
    plotBottom
  } = LANE_PROFILE_VIEWBOX;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const rowMax = Math.max(1, profile.values.length - 1);
  const valueSpan = Math.max(1e-6, profile.maxValue - profile.minValue);
  const points = downsampleLaneProfile(profile.values).map((point) => ({
    x: plotLeft + ((point.row / rowMax) * plotWidth),
    y: plotBottom - (((point.value - profile.minValue) / valueSpan) * plotHeight)
  }));
  const path = buildSmoothPath(points);
  const peakX = plotLeft + ((profile.peakRow / rowMax) * plotWidth);
  const peakY = plotBottom - (((profile.peakValue - profile.minValue) / valueSpan) * plotHeight);

  let highlightedBand = '';
  if (Number.isFinite(bandTop) && Number.isFinite(bandBottom)) {
    const start = clamp(Math.min(bandTop, bandBottom), 0, rowMax);
    const end = clamp(Math.max(bandTop, bandBottom), start, rowMax);
    const rectX = plotLeft + ((start / rowMax) * plotWidth);
    const rectWidth = Math.max(2, ((end - start) / rowMax) * plotWidth);
    highlightedBand = `<rect class="lane-profile-window" x="${rectX}" y="${plotTop}" width="${rectWidth}" height="${plotHeight}" rx="8" />`;
  }

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect class="lane-profile-frame" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" />
    ${highlightedBand}
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 4)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 4)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + (plotHeight / 2)}" x2="${plotRight}" y2="${plotTop + (plotHeight / 2)}" />
    <line class="lane-profile-grid" x1="${plotLeft}" y1="${plotTop + ((plotHeight * 3) / 4)}" x2="${plotRight}" y2="${plotTop + ((plotHeight * 3) / 4)}" />
    <path class="lane-profile-path-shadow" d="${path}" />
    <path class="lane-profile-path" d="${path}" />
    <circle class="lane-profile-peak" cx="${peakX}" cy="${peakY}" r="4" />
    <text class="lane-profile-axis-label" x="${plotLeft}" y="${height - 8}">Top</text>
    <text class="lane-profile-axis-label" x="${plotRight}" y="${height - 8}" text-anchor="end">Bottom</text>
  `;
}

export function createRenderingController({ runtime, elements, safeText, deps = {} }) {
  function renderLaneProfile() {
    if (
      !elements.gelLaneProfilePanel
      || !elements.gelLaneProfileSelect
      || !elements.gelLaneProfileCaption
      || !elements.gelLaneProfileChart
      || !elements.gelLaneProfileMeta
    ) {
      return;
    }

    elements.gelLaneProfilePanel.hidden = !runtime.currentImage;

    if (!runtime.currentImage) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      elements.gelLaneProfileCaption.textContent = 'Load a gel image to inspect a lane profile.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile appears here after you divide the gel into lanes.');
      return;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const lanes = getLaneProfileLanes(runtime);

    if (!lanes.length) {
      runtime.selectedLaneProfileLane = null;
      elements.gelLaneProfileSelect.disabled = true;
      elements.gelLaneProfileSelect.innerHTML = '<option value="">Select lane</option>';
      elements.gelLaneProfileCaption.textContent = 'Finish lane division to plot the average row intensity for a lane.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Set left/right borders and lane dividers first.');
      return;
    }

    const availableLaneIds = new Set(lanes.map((lane) => lane.laneIndex));
    if (!availableLaneIds.has(runtime.selectedLaneProfileLane)) {
      runtime.selectedLaneProfileLane = lanes[0].laneIndex;
    }

    const selectedLane = lanes.find((lane) => lane.laneIndex === runtime.selectedLaneProfileLane) || lanes[0];
    runtime.selectedLaneProfileLane = selectedLane.laneIndex;

    elements.gelLaneProfileSelect.disabled = false;
    elements.gelLaneProfileSelect.innerHTML = lanes
      .map((lane) => `<option value="${lane.laneIndex}">Lane ${lane.laneIndex}</option>`)
      .join('');
    elements.gelLaneProfileSelect.value = String(selectedLane.laneIndex);

    const preprocessed = deps.getPreprocessedImageForCurrentSettings?.();
    const signal = preprocessed?.cleanNormalized || createFallbackSignal(runtime.currentImage.gray);
    const profile = computeLaneIntensityProfile({
      signal,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      lane: selectedLane
    });

    if (!profile) {
      elements.gelLaneProfileCaption.textContent = 'Lane profile could not be calculated for this image.';
      elements.gelLaneProfileMeta.textContent = '';
      renderLaneProfilePlaceholder(elements.gelLaneProfileChart, 'Lane profile unavailable.');
      return;
    }

    const hasBandWindow = Number.isFinite(overrides.laneSegmentation?.bandTop) && Number.isFinite(overrides.laneSegmentation?.bandBottom);
    elements.gelLaneProfileCaption.textContent = hasBandWindow
      ? `Average row signal for lane ${selectedLane.laneIndex}. The highlighted band window follows steps 6 and 7.`
      : `Average row signal for lane ${selectedLane.laneIndex} using the current enhancement settings.`;
    elements.gelLaneProfileMeta.innerHTML = [
      `x ${selectedLane.xStart}-${selectedLane.xEnd}`,
      `width ${profile.laneWidth}px`,
      `peak row ${profile.peakRow}`,
      `peak ${round(profile.peakValue, 4) ?? '-'}`,
      `mean ${round(profile.meanValue, 4) ?? '-'}`
    ]
      .map((item) => `<span>${safeText(item)}</span>`)
      .join('');

    renderLaneProfileSvg(
      elements.gelLaneProfileChart,
      profile,
      overrides.laneSegmentation?.bandTop,
      overrides.laneSegmentation?.bandBottom
    );
  }

  function renderCanvas() {
    if (!elements.gelCanvas) {
      deps.renderLaneTable?.();
      renderLaneProfile();
      return;
    }

    const context = elements.gelCanvas.getContext('2d');
    if (!runtime.currentImage || !context) {
      elements.gelCanvas.width = 1;
      elements.gelCanvas.height = 1;
      context?.clearRect(0, 0, 1, 1);
      deps.renderLaneTable?.();
      renderLaneProfile();
      return;
    }

    elements.gelCanvas.width = runtime.currentImage.width;
    elements.gelCanvas.height = runtime.currentImage.height;
    const baseImageData = selectViewerBaseImageData(runtime.currentImage);
    context.putImageData(baseImageData, 0, 0);

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const segmentationLanes = buildLanesFromManualSegmentation(overrides, runtime.currentImage.width) || [];
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

      if (Number.isFinite(segmentation.bandTop)) {
        const y = clamp(segmentation.bandTop, 0, runtime.currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(runtime.currentImage.width, y + 0.5);
        context.stroke();
      }
      if (Number.isFinite(segmentation.bandBottom)) {
        const y = clamp(segmentation.bandBottom, 0, runtime.currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(runtime.currentImage.width, y + 0.5);
        context.stroke();
      }

      if (Number.isFinite(segmentation.bandTop) && Number.isFinite(segmentation.bandBottom) && segmentationLanes.length) {
        const top = clamp(Math.min(segmentation.bandTop, segmentation.bandBottom), 0, runtime.currentImage.height - 1);
        const bottom = clamp(Math.max(segmentation.bandTop, segmentation.bandBottom), top + 1, runtime.currentImage.height - 1);
        segmentationLanes.forEach((lane) => {
          context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
          context.lineWidth = 1.2;
          context.strokeRect(
            lane.xStart + 0.5,
            top + 0.5,
            Math.max(1, lane.xEnd - lane.xStart),
            Math.max(1, bottom - top)
          );
        });
      }

      if (Number.isFinite(overrides.ladderLane) && segmentationLanes.length) {
        const ladder = segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane);
        if (ladder) {
          context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
          context.lineWidth = 2.2;
          context.strokeRect(
            ladder.xStart + 0.5,
            0.5,
            Math.max(1, ladder.xEnd - ladder.xStart),
            runtime.currentImage.height - 1
          );
        }
      }

      (Array.isArray(overrides.ladderBands) ? overrides.ladderBands : []).forEach((item) => {
        const y = clamp(Math.round(item.pixelY), 0, runtime.currentImage.height - 1);
        context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(runtime.currentImage.width, y + 0.5);
        context.stroke();
        context.fillStyle = 'rgba(255, 197, 61, 0.98)';
        context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(`${round(item.mw, 1)}kDa`, 4, Math.max(10, y - 3));
      });
      context.restore();
    }

    if (runtime.currentReport?.lanes?.length) {
      runtime.currentReport.lanes.forEach((lane) => {
        const isLadder = (overrides.ladderLane === lane.laneIndex)
          || (runtime.currentReport.calibration?.ladderLane === lane.laneIndex);
        context.strokeStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.9)';
        context.lineWidth = isLadder ? 2.2 : 1.6;
        context.strokeRect(
          lane.xStart + 0.5,
          0.5,
          Math.max(1, lane.xEnd - lane.xStart),
          runtime.currentImage.height - 1
        );

        context.fillStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.95)';
        context.font = '12px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(String(lane.laneIndex), lane.xStart + 2, 12);

        lane.bands.forEach((band) => {
          context.strokeStyle = band.manual ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 99, 132, 0.95)';
          context.lineWidth = 1.3;
          context.beginPath();
          context.moveTo(lane.xStart, band.pixelY + 0.5);
          context.lineTo(lane.xEnd, band.pixelY + 0.5);
          context.stroke();

          if (Number.isFinite(band.estimatedMw)) {
            context.fillStyle = band.manualMw ? 'rgba(34, 197, 94, 0.95)' : 'rgba(255, 99, 132, 0.92)';
            context.fillText(`${round(band.estimatedMw, 1)}kDa`, lane.xEnd + 3, band.pixelY - 1);
          }
        });
      });
    }

    deps.renderLaneTable?.();
    renderLaneProfile();
  }

  function renderReport() {
    if (!elements.gelReportSummary || !elements.gelReportJson) {
      return;
    }

    if (!runtime.currentReport) {
      elements.gelReportSummary.innerHTML = '<p class="small-note">No analysis report yet.</p>';
      elements.gelReportJson.textContent = '';
      return;
    }

    const totalBands = (runtime.currentReport.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
    const targetIntensities = (runtime.currentReport.lanes || [])
      .map((lane) => Number(lane.targetBandIntensity))
      .filter((value) => Number.isFinite(value));
    const averageTargetIntensity = targetIntensities.length
      ? round(mean(targetIntensities), 4)
      : null;
    const calibrationText = runtime.currentReport.calibration?.ok
      ? `R^2 ${runtime.currentReport.calibration.r2}`
      : 'Not calibrated';
    const enhancementText = `${runtime.currentReport.preprocessing?.denoiseStrength ?? '-'}% denoise / ${runtime.currentReport.preprocessing?.contrastBoost ?? '-'}% contrast`;
    const tiffPageText = runtime.currentReport.image?.tiffPageCount
      ? `${runtime.currentReport.image.tiffPage}/${runtime.currentReport.image.tiffPageCount}`
      : '-';
    elements.gelReportSummary.innerHTML = `
      <article class="card">
        <h3>${safeText(formatAnalysisTypeLabel(runtime.currentReport.analysisType))}</h3>
        <p><strong>Lanes:</strong> ${safeText(String(runtime.currentReport.lanes?.length || 0))}</p>
        <p><strong>Total Bands:</strong> ${safeText(String(totalBands))}</p>
        <p><strong>TIFF Page:</strong> ${safeText(String(tiffPageText))}</p>
        <p><strong>Calibration:</strong> ${safeText(calibrationText)}</p>
        <p><strong>Enhancement:</strong> ${safeText(enhancementText)}</p>
        <p><strong>Avg Target Intensity:</strong> ${safeText(String(averageTargetIntensity ?? '-'))}</p>
        <p><strong>Confidence:</strong> ${safeText(runtime.currentReport.confidence?.label || '-')} (${safeText(String(runtime.currentReport.confidence?.score ?? '-'))})</p>
      </article>
      <article class="card">
        <h3>Warnings</h3>
        <p>${safeText((runtime.currentReport.warnings || []).join(' | ') || 'None')}</p>
      </article>
    `;

    elements.gelReportJson.textContent = JSON.stringify(runtime.currentReport, null, 2);
  }

  return {
    renderCanvas,
    renderLaneProfile,
    renderReport
  };
}
