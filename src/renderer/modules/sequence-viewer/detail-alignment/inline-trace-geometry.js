import { cleanText } from '../shared.js';
import { INLINE_TRACE_HEIGHT, INLINE_TRACE_SIGNAL_HEIGHT, INLINE_TRACE_SIGNAL_TOP, TRACE_MAX_PATH_POINTS, TRACE_PIXELS_PER_BASE } from './trace-constants.js';
import { buildSmoothTracePathData, clampTraceValue, formatSvgNumber, smoothTraceValues } from './trace-normalizing.js';

function buildInlineTraceCoordinateMap(traceCells, lineStart, charAdvancePx) {
  const safeLineStart = Math.max(0, Math.floor(Number(lineStart) || 0));
  const safeAdvance = Math.max(1, Number(charAdvancePx) || TRACE_PIXELS_PER_BASE);
  const anchorsByPosition = new Map();

  (Array.isArray(traceCells) ? traceCells : []).forEach((cell) => {
    const position = Number(cell?.position);
    const referenceIndex = Math.floor(Number(cell?.referenceIndex));
    if (!Number.isFinite(position) || !Number.isFinite(referenceIndex)) {
      return;
    }
    const x = ((referenceIndex - safeLineStart) + 0.5) * safeAdvance;
    const existing = anchorsByPosition.get(position);
    if (existing) {
      existing.xTotal += x;
      existing.count += 1;
      return;
    }
    anchorsByPosition.set(position, { position, xTotal: x, count: 1 });
  });

  const anchors = [...anchorsByPosition.values()]
    .map((anchor) => ({
      position: anchor.position,
      x: anchor.xTotal / Math.max(1, anchor.count)
    }))
    .sort((left, right) => left.position - right.position);
  if (!anchors.length) {
    return null;
  }

  const fallbackSlope = safeAdvance / Math.max(1, Number(anchors[1]?.position) - Number(anchors[0]?.position) || 1);
  const slopeAt = (anchorIndex, direction) => {
    const anchor = anchors[anchorIndex];
    const neighbor = anchors[anchorIndex + direction];
    const sampleDelta = Number(neighbor?.position) - Number(anchor?.position);
    const xDelta = Number(neighbor?.x) - Number(anchor?.x);
    return Number.isFinite(sampleDelta) && sampleDelta > 0 && Number.isFinite(xDelta)
      ? xDelta / sampleDelta
      : fallbackSlope;
  };
  const leadingSlope = anchors.length > 1 ? slopeAt(0, 1) : fallbackSlope;
  const trailingSlope = anchors.length > 1 ? slopeAt(anchors.length - 2, 1) : fallbackSlope;

  return {
    anchors,
    positionToX(position) {
      const safePosition = Number(position) || 0;
      const first = anchors[0];
      const last = anchors[anchors.length - 1];
      if (safePosition <= first.position) {
        return first.x + ((safePosition - first.position) * leadingSlope);
      }
      if (safePosition >= last.position) {
        return last.x + ((safePosition - last.position) * trailingSlope);
      }

      let low = 0;
      let high = anchors.length - 1;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (anchors[middle].position <= safePosition) {
          low = middle;
        } else {
          high = middle;
        }
      }
      const start = anchors[low];
      const end = anchors[high];
      const span = Math.max(1, end.position - start.position);
      return start.x + (((safePosition - start.position) / span) * (end.x - start.x));
    }
  };
}

function buildInlineTraceSamplePoints(values, sampleStart, sampleEnd, maxSignal, coordinateMap) {
  const smoothedValues = smoothTraceValues(values);
  if (!smoothedValues.length || !coordinateMap) {
    return [];
  }

  const startIndex = clampTraceValue(Math.floor(Number(sampleStart) || 0), 0, smoothedValues.length - 1);
  const endIndex = clampTraceValue(Math.ceil(Number(sampleEnd) || startIndex + 1), startIndex + 1, smoothedValues.length);
  const pointCount = Math.max(1, endIndex - startIndex);
  const step = Math.max(1, Math.ceil(pointCount / TRACE_MAX_PATH_POINTS));
  const signalMax = Math.max(1, Number(maxSignal) || 1);
  const points = [];

  for (let start = startIndex; start < endIndex; start += step) {
    const end = Math.min(endIndex, start + step);
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += Math.max(0, Number(smoothedValues[index]) || 0);
    }

    const averageValue = total / Math.max(1, end - start);
    const sampleIndex = start + ((end - start - 1) / 2);
    points.push({
      x: coordinateMap.positionToX(sampleIndex),
      y: INLINE_TRACE_SIGNAL_TOP + INLINE_TRACE_SIGNAL_HEIGHT - ((averageValue / signalMax) * INLINE_TRACE_SIGNAL_HEIGHT)
    });
  }

  return points;
}

function buildInlineTracePathData(values, sampleStart, sampleEnd, maxSignal, coordinateMap) {
  return buildSmoothTracePathData(buildInlineTraceSamplePoints(values, sampleStart, sampleEnd, maxSignal, coordinateMap));
}

function computeInlineTraceSampleWindow(traceCells, displayTrace) {
  const positions = traceCells
    .map((cell) => Number(cell?.position))
    .filter((position) => Number.isFinite(position));
  if (!positions.length) {
    return null;
  }

  const sorted = [...positions].sort((left, right) => left - right);
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  const averageGap = gaps.length
    ? gaps.reduce((total, gap) => total + gap, 0) / gaps.length
    : Math.max(8, Math.floor((Number(displayTrace?.sampleCount) || 1) / Math.max(1, Number(displayTrace?.sequence?.length) || 1)));
  const padding = Math.max(4, averageGap * 0.75);
  return {
    start: clampTraceValue(sorted[0] - padding, 0, Math.max(1, displayTrace.sampleCount - 1)),
    end: clampTraceValue(sorted[sorted.length - 1] + padding, 1, Math.max(1, displayTrace.sampleCount))
  };
}

function renderInlineTraceChannelPaths(displayTrace, sampleWindow, coordinateMap) {
  const startIndex = clampTraceValue(Math.floor(sampleWindow.start), 0, displayTrace.sampleCount - 1);
  const endIndex = clampTraceValue(Math.ceil(sampleWindow.end), startIndex + 1, displayTrace.sampleCount);
  const smoothedByBase = displayTrace.channels.map((channel) => ({
    base: cleanText(channel.base, 1).toLowerCase(),
    values: smoothTraceValues(channel.values)
  }));
  const maxSignal = Math.max(
    1,
    ...smoothedByBase.flatMap((channel) => channel.values.slice(startIndex, endIndex))
      .map((value) => Math.max(0, Number(value) || 0))
  );

  return smoothedByBase
    .map((channel) => {
      const pathData = buildInlineTracePathData(channel.values, sampleWindow.start, sampleWindow.end, maxSignal, coordinateMap);
      return pathData
        ? `<path class="sequence-viewer-trace-line sequence-viewer-trace-line-${channel.base}" d="${pathData}"></path>`
        : '';
    })
    .filter(Boolean)
    .join('');
}

function renderInlineTraceGrid(traceWidth) {
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const x = formatSvgNumber(ratio * traceWidth);
    return `<line class="sequence-viewer-trace-grid-line" x1="${x}" y1="${INLINE_TRACE_SIGNAL_TOP}" x2="${x}" y2="${INLINE_TRACE_SIGNAL_TOP + INLINE_TRACE_SIGNAL_HEIGHT}"></line>`;
  }).join('');
}

function renderInlineTraceLineHtml(displayTrace, traceCells, lineStart, lineEnd, options = {}) {
  const safeCells = (Array.isArray(traceCells) ? traceCells : [])
    .filter((cell) => Number(cell?.referenceIndex) >= lineStart && Number(cell?.referenceIndex) < lineEnd);
  if (!safeCells.length) {
    return '';
  }

  const sampleWindow = computeInlineTraceSampleWindow(safeCells, displayTrace);
  if (!sampleWindow) {
    return '';
  }

  const charAdvancePx = Math.max(1, Number(options?.charAdvancePx) || TRACE_PIXELS_PER_BASE);
  const traceWidth = Math.max(1, (lineEnd - lineStart) * charAdvancePx);
  const coordinateMap = buildInlineTraceCoordinateMap(safeCells, lineStart, charAdvancePx);
  if (!coordinateMap) {
    return '';
  }
  const firstAnchor = coordinateMap.anchors[0];
  const lastAnchor = coordinateMap.anchors[coordinateMap.anchors.length - 1];

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-inline-trace-row">
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-query-end"></span>
      <span class="sequence-viewer-inline-trace-cell" style="width:${traceWidth.toFixed(3)}px;">
        <svg
          class="sequence-viewer-inline-trace-svg"
          style="width:${traceWidth.toFixed(3)}px;"
          viewBox="0 0 ${formatSvgNumber(traceWidth)} ${INLINE_TRACE_HEIGHT}"
          role="img"
          aria-label="Chromatogram bases ${lineStart + 1}-${lineEnd}"
          data-alignment-anchor-count="${coordinateMap.anchors.length}"
          data-alignment-first-base-x="${formatSvgNumber(firstAnchor.x)}"
          data-alignment-last-base-x="${formatSvgNumber(lastAnchor.x)}"
        >
          <rect class="sequence-viewer-trace-plot-bg" x="0" y="${INLINE_TRACE_SIGNAL_TOP}" width="${formatSvgNumber(traceWidth)}" height="${INLINE_TRACE_SIGNAL_HEIGHT}"></rect>
          <g class="sequence-viewer-trace-grid">${renderInlineTraceGrid(traceWidth)}</g>
          <g class="sequence-viewer-trace-lines">${renderInlineTraceChannelPaths(displayTrace, sampleWindow, coordinateMap)}</g>
        </svg>
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-query-end"></span>
    </div>
  `;
}

function buildInlineTraceLines(displayTrace, traceCells, sequenceLength, options = {}) {
  const lineLength = Math.max(1, Math.floor(Number(options?.lineLength) || 0));
  if (!displayTrace || !traceCells?.length || !lineLength) {
    return {};
  }

  const traceLines = {};
  for (let lineStart = 0; lineStart < sequenceLength; lineStart += lineLength) {
    const lineEnd = Math.min(sequenceLength, lineStart + lineLength);
    const html = renderInlineTraceLineHtml(displayTrace, traceCells, lineStart, lineEnd, {
      charAdvancePx: options.charAdvancePx
    });
    if (html) {
      traceLines[String(lineStart)] = html;
    }
  }
  return traceLines;
}

export {
  buildInlineTraceLines
};
