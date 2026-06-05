import { escapeHtml } from '../tool-box/common.js';
import { normalizeHighlightSegments } from './rendering.js';
import {
  buildSequenceSignature,
  cleanText,
  complementBase,
  normalizeSequenceText,
  reverseComplementIupac
} from './shared.js';
import { postProcessAb1Trace } from './algorithms/ab1-trace-postprocess.js';

const TRACE_BASE_ORDER = ['A', 'C', 'G', 'T'];
const TRACE_MIN_WIDTH = 960;
const TRACE_MAX_WIDTH = 48000;
const TRACE_PIXELS_PER_BASE = 16;
const TRACE_PIXELS_PER_SAMPLE = 0.9;
const TRACE_HEIGHT = 220;
const TRACE_SIGNAL_TOP = 20;
const TRACE_SIGNAL_HEIGHT = 118;
const TRACE_BASE_LABEL_Y = 166;
const TRACE_DIFF_MARKER_Y = 190;
const TRACE_MAX_PATH_POINTS = 2600;
const TRACE_SMOOTHING_RADIUS = 2;

function clampTraceValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function formatSvgNumber(value) {
  return Number(value || 0).toFixed(2).replace(/\.?0+$/u, '');
}

function toNumberList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    return Array.from(value);
  }
  return [];
}

function normalizeTraceChannel(channel) {
  const base = cleanText(channel?.base, 1).toUpperCase();
  if (!TRACE_BASE_ORDER.includes(base)) {
    return null;
  }

  const values = toNumberList(channel?.values)
    .map((value) => Math.max(0, Math.round(Number(value) || 0)));
  return values.length ? { base, values } : null;
}

function normalizeTracePayload(trace, options = {}) {
  const safeTrace = trace && typeof trace === 'object' ? trace : null;
  if (!safeTrace) {
    return null;
  }

  const processed = safeTrace.processed && typeof safeTrace.processed === 'object'
    ? safeTrace.processed
    : null;
  const useProcessed = options?.useProcessed !== false && processed;
  const sourceChannels = Array.isArray(useProcessed ? processed.channels : safeTrace.channels)
    ? (useProcessed ? processed.channels : safeTrace.channels)
    : [];
  const sourcePositions = useProcessed ? processed.positions : safeTrace.positions;

  const channels = TRACE_BASE_ORDER
    .map((base) => sourceChannels.find((channel) => cleanText(channel?.base, 1).toUpperCase() === base))
    .map((channel) => normalizeTraceChannel(channel))
    .filter(Boolean);
  if (!channels.length) {
    return null;
  }

  const rawPositions = toNumberList(sourcePositions)
    .map((value) => Math.max(0, Math.round(Number(value) || 0)));
  const maxPosition = rawPositions.reduce((max, value) => Math.max(max, value), 0);
  const sampleCount = Math.max(
    1,
    maxPosition + 1,
    ...channels.map((channel) => channel.values.length)
  );

  return {
    channels,
    positions: rawPositions,
    sampleCount,
    source: useProcessed ? 'processed' : 'raw'
  };
}

function buildFallbackBasePositions(sequenceLength, sampleCount) {
  const safeLength = Math.max(0, Math.floor(Number(sequenceLength) || 0));
  const sampleLast = Math.max(0, Math.floor(Number(sampleCount) || 1) - 1);
  if (!safeLength) {
    return [];
  }
  return Array.from({ length: safeLength }, (_item, index) => (
    clampTraceValue(Math.round(((index + 0.5) / safeLength) * sampleLast), 0, sampleLast)
  ));
}

function normalizeBasePositions(positions, sequenceLength, sampleCount) {
  const safeLength = Math.max(0, Math.floor(Number(sequenceLength) || 0));
  const sampleLast = Math.max(0, Math.floor(Number(sampleCount) || 1) - 1);
  const fallback = buildFallbackBasePositions(safeLength, sampleCount);
  return Array.from({ length: safeLength }, (_item, index) => {
    const value = Number(positions[index]);
    return clampTraceValue(
      Number.isFinite(value) ? Math.round(value) : fallback[index],
      0,
      sampleLast
    );
  });
}

function reverseTraceChannelValues(channels) {
  const byBase = new Map((Array.isArray(channels) ? channels : []).map((channel) => [channel.base, channel]));
  return TRACE_BASE_ORDER
    .map((displayBase) => {
      const sourceBase = complementBase(displayBase);
      const sourceValues = byBase.get(sourceBase)?.values || [];
      return sourceValues.length
        ? { base: displayBase, values: [...sourceValues].reverse() }
        : null;
    })
    .filter(Boolean);
}

function ensureProcessedTrace(queryRecord) {
  // Old alignment sessions were persisted before the post-processor existed —
  // their queryRecord.trace has raw channels but no `processed` payload.
  // Compute it once on demand and cache it on the trace object so the
  // Raw/Processed switch can render and subsequent renders don't re-run
  // the pipeline.
  const trace = queryRecord?.trace;
  if (!trace || typeof trace !== 'object') {
    return;
  }
  if (trace.processed && Array.isArray(trace.processed.channels) && trace.processed.channels.length) {
    return;
  }
  const channels = Array.isArray(trace.channels) ? trace.channels : [];
  if (!channels.length) {
    return;
  }
  try {
    const processed = postProcessAb1Trace(
      { ...trace, sequence: queryRecord?.sequence || '' },
      queryRecord?.quality || ''
    );
    if (processed) {
      trace.processed = processed;
    }
  } catch {
    // Silently fall back to raw rendering — the switch stays hidden.
  }
}

function buildDisplayAlignmentTrace(queryRecord, result, options = {}) {
  const sourceSequence = normalizeSequenceText(queryRecord?.sequence || '');
  ensureProcessedTrace(queryRecord);
  const trace = normalizeTracePayload(queryRecord?.trace, options);
  if (!sourceSequence.length || !trace) {
    return null;
  }

  const basePositions = normalizeBasePositions(trace.positions, sourceSequence.length, trace.sampleCount);
  const isReverse = cleanText(result?.orientation, 40).toLowerCase() === 'reverse';
  if (!isReverse) {
    return {
      sequence: sourceSequence,
      positions: basePositions,
      channels: trace.channels,
      sampleCount: trace.sampleCount,
      orientation: 'forward',
      source: trace.source
    };
  }

  const sampleLast = Math.max(0, trace.sampleCount - 1);
  return {
    sequence: reverseComplementIupac(sourceSequence),
    positions: [...basePositions].reverse().map((position) => clampTraceValue(sampleLast - position, 0, sampleLast)),
    channels: reverseTraceChannelValues(trace.channels),
    sampleCount: trace.sampleCount,
    orientation: 'reverse',
    source: trace.source
  };
}

function buildAlignmentQueryDifferenceMap(result) {
  const map = new Map();
  const differences = Array.isArray(result?.differences) ? result.differences : [];
  differences.forEach((difference) => {
    const type = cleanText(difference?.type, 40).toLowerCase();
    if (type !== 'mismatch' && type !== 'insertion') {
      return;
    }
    const start = Math.max(0, Math.floor(Number(difference?.queryStart) || 0));
    const end = Math.max(start, Math.floor(Number(difference?.queryEnd) || 0));
    for (let index = start; index < end; index += 1) {
      map.set(index, type);
    }
  });
  return map;
}

function computeTraceViewportWidth(displayTrace) {
  const baseCount = Math.max(0, Math.floor(Number(displayTrace?.sequence?.length) || 0));
  const sampleCount = Math.max(0, Math.floor(Number(displayTrace?.sampleCount) || 0));
  const targetWidth = Math.max(
    TRACE_MIN_WIDTH,
    baseCount * TRACE_PIXELS_PER_BASE,
    sampleCount * TRACE_PIXELS_PER_SAMPLE
  );
  return Math.round(clampTraceValue(targetWidth, TRACE_MIN_WIDTH, TRACE_MAX_WIDTH));
}

function positionToTraceX(position, sampleCount, traceWidth) {
  const sampleLast = Math.max(1, Math.floor(Number(sampleCount) || 1) - 1);
  const safeWidth = Math.max(TRACE_MIN_WIDTH, Number(traceWidth) || TRACE_MIN_WIDTH);
  return (clampTraceValue(position, 0, sampleLast) / sampleLast) * safeWidth;
}

function smoothTraceValues(values) {
  const safeValues = toNumberList(values);
  if (!safeValues.length) {
    return [];
  }

  return safeValues.map((_value, index) => {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (let offset = -TRACE_SMOOTHING_RADIUS; offset <= TRACE_SMOOTHING_RADIUS; offset += 1) {
      const sourceIndex = clampTraceValue(index + offset, 0, safeValues.length - 1);
      const weight = TRACE_SMOOTHING_RADIUS + 1 - Math.abs(offset);
      weightedTotal += Math.max(0, Number(safeValues[sourceIndex]) || 0) * weight;
      weightTotal += weight;
    }
    return weightTotal ? weightedTotal / weightTotal : 0;
  });
}

function buildTraceSamplePoints(values, sampleCount, maxSignal, traceWidth) {
  const smoothedValues = smoothTraceValues(values);
  if (!smoothedValues.length) {
    return [];
  }

  const step = Math.max(1, Math.ceil(smoothedValues.length / TRACE_MAX_PATH_POINTS));
  const signalMax = Math.max(1, Number(maxSignal) || 1);
  const points = [];

  for (let start = 0; start < smoothedValues.length; start += step) {
    const end = Math.min(smoothedValues.length, start + step);
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += Math.max(0, Number(smoothedValues[index]) || 0);
    }

    const averageValue = total / Math.max(1, end - start);
    const sampleIndex = start + ((end - start - 1) / 2);
    points.push({
      x: positionToTraceX(sampleIndex, sampleCount, traceWidth),
      y: TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT - ((averageValue / signalMax) * TRACE_SIGNAL_HEIGHT)
    });
  }

  const lastSampleIndex = smoothedValues.length - 1;
  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.x < positionToTraceX(lastSampleIndex, sampleCount, traceWidth)) {
    const lastValue = Math.max(0, Number(smoothedValues[lastSampleIndex]) || 0);
    points.push({
      x: positionToTraceX(lastSampleIndex, sampleCount, traceWidth),
      y: TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT - ((lastValue / signalMax) * TRACE_SIGNAL_HEIGHT)
    });
  }

  return points;
}

function buildSmoothTracePathData(points) {
  if (!Array.isArray(points) || !points.length) {
    return '';
  }
  if (points.length === 1) {
    return `M${formatSvgNumber(points[0].x)},${formatSvgNumber(points[0].y)}`;
  }

  const maxY = TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT;
  const commands = [`M${formatSvgNumber(points[0].x)},${formatSvgNumber(points[0].y)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const c1x = current.x + ((next.x - previous.x) / 6);
    const c1y = clampTraceValue(current.y + ((next.y - previous.y) / 6), TRACE_SIGNAL_TOP, maxY);
    const c2x = next.x - ((afterNext.x - current.x) / 6);
    const c2y = clampTraceValue(next.y - ((afterNext.y - current.y) / 6), TRACE_SIGNAL_TOP, maxY);
    commands.push([
      'C',
      `${formatSvgNumber(c1x)},${formatSvgNumber(c1y)}`,
      `${formatSvgNumber(c2x)},${formatSvgNumber(c2y)}`,
      `${formatSvgNumber(next.x)},${formatSvgNumber(next.y)}`
    ].join(' '));
  }

  return commands.join(' ');
}

function buildTracePathData(values, sampleCount, maxSignal, traceWidth) {
  return buildSmoothTracePathData(buildTraceSamplePoints(values, sampleCount, maxSignal, traceWidth));
}

function renderTraceGrid(traceWidth) {
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const x = formatSvgNumber(ratio * traceWidth);
    return `<line class="sequence-viewer-trace-grid-line" x1="${x}" y1="${TRACE_SIGNAL_TOP}" x2="${x}" y2="${TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT}"></line>`;
  }).join('');
}

function renderTraceChannelPolylines(displayTrace, traceWidth) {
  const maxSignal = Math.max(
    1,
    ...displayTrace.channels.flatMap((channel) => toNumberList(channel.values))
      .map((value) => Math.max(0, Number(value) || 0))
  );

  return displayTrace.channels
    .map((channel) => {
      const base = cleanText(channel.base, 1).toLowerCase();
      const pathData = buildTracePathData(channel.values, displayTrace.sampleCount, maxSignal, traceWidth);
      return pathData
        ? `<path class="sequence-viewer-trace-line sequence-viewer-trace-line-${base}" d="${pathData}"></path>`
        : '';
    })
    .filter(Boolean)
    .join('');
}

function renderTraceBaseCalls(displayTrace, differenceMap, traceWidth) {
  const sequence = String(displayTrace.sequence || '');
  const maxLabels = Math.max(1, Math.floor(traceWidth / 18));
  const maxTicks = Math.max(1, Math.floor(traceWidth / 7));
  const labelStep = Math.max(1, Math.ceil(sequence.length / maxLabels));
  const tickStep = Math.max(1, Math.ceil(sequence.length / maxTicks));

  return displayTrace.positions
    .map((position, index) => {
      const x = formatSvgNumber(positionToTraceX(position, displayTrace.sampleCount, traceWidth));
      const base = sequence[index] || 'N';
      const baseClass = TRACE_BASE_ORDER.includes(base) ? base.toLowerCase() : 'unknown';
      const diffType = differenceMap.get(index) || '';
      const tick = index % tickStep === 0
        ? `<line class="sequence-viewer-trace-base-tick${diffType ? ` sequence-viewer-trace-base-tick-${diffType}` : ''}" x1="${x}" y1="${TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT + 6}" x2="${x}" y2="${TRACE_SIGNAL_TOP + TRACE_SIGNAL_HEIGHT + 18}"></line>`
        : '';
      const label = index % labelStep === 0 || diffType
        ? `<text class="sequence-viewer-trace-base-call sequence-viewer-trace-base-${baseClass}${diffType ? ` sequence-viewer-trace-base-call-${diffType}` : ''}" x="${x}" y="${TRACE_BASE_LABEL_Y}">${escapeHtml(base)}</text>`
        : '';
      return `${tick}${label}`;
    })
    .join('');
}

function renderTraceDifferenceMarkers(displayTrace, differenceMap, traceWidth) {
  return [...differenceMap.entries()]
    .filter(([index]) => Number.isFinite(Number(displayTrace.positions[index])))
    .slice(0, 500)
    .map(([index, type]) => {
      const x = formatSvgNumber(positionToTraceX(displayTrace.positions[index], displayTrace.sampleCount, traceWidth));
      const label = `${type} at query base ${index + 1}`;
      return `
        <circle class="sequence-viewer-trace-diff-marker sequence-viewer-trace-diff-${escapeHtml(type)}" cx="${x}" cy="${TRACE_DIFF_MARKER_Y}" r="4">
          <title>${escapeHtml(label)}</title>
        </circle>
      `;
    })
    .join('');
}

function renderTraceLegend() {
  return TRACE_BASE_ORDER.map((base) => `
    <span class="sequence-viewer-trace-legend-item sequence-viewer-trace-base-${base.toLowerCase()}">
      <span class="sequence-viewer-trace-legend-swatch" aria-hidden="true"></span>${base}
    </span>
  `).join('');
}

function renderTraceUnavailableHtml(queryRecord) {
  const queryName = cleanText(queryRecord?.name, 140) || 'AB1 trace';
  return `
    <div class="sequence-viewer-alignment-trace-head">
      <strong>Chromatogram</strong>
      <span class="small-note">${escapeHtml(queryName)}</span>
    </div>
    <p class="small-note">AB1 chromatogram channels were not available for this alignment.</p>
  `;
}

export function renderAlignmentTracePanelHtml({ state = {} } = {}) {
  const result = state?.activeAlignmentResult && typeof state.activeAlignmentResult === 'object'
    ? state.activeAlignmentResult
    : null;
  const queryRecord = state?.activeAlignmentQueryRecord && typeof state.activeAlignmentQueryRecord === 'object'
    ? state.activeAlignmentQueryRecord
    : null;
  if (!state?.alignmentViewEnabled || !result || !queryRecord) {
    return '';
  }

  const sourceFormat = cleanText(queryRecord.sourceFormat || result.queryFormat, 80).toLowerCase();
  const hasTraceObject = Boolean(queryRecord.trace && typeof queryRecord.trace === 'object');
  if (!hasTraceObject && sourceFormat !== 'ab1') {
    return '';
  }

  const useProcessed = state?.traceUseProcessed !== false;
  const displayTrace = buildDisplayAlignmentTrace(queryRecord, result, { useProcessed });
  if (!displayTrace) {
    return sourceFormat === 'ab1' ? renderTraceUnavailableHtml(queryRecord) : '';
  }

  const differenceMap = buildAlignmentQueryDifferenceMap(result);
  const traceWidth = computeTraceViewportWidth(displayTrace);
  const queryName = cleanText(queryRecord.name || result.queryName, 140) || 'AB1 trace';
  const identity = Number(result.identityPercent);
  const coverage = Number(result.queryCoveragePercent);
  const details = [
    `${displayTrace.sequence.length.toLocaleString()} bases`,
    `${displayTrace.sampleCount.toLocaleString()} samples`,
    `${displayTrace.orientation} alignment`,
    Number.isFinite(identity) ? `${identity.toFixed(2)}% identity` : '',
    Number.isFinite(coverage) ? `${coverage.toFixed(2)}% coverage` : ''
  ].filter(Boolean);
  const svgLabel = `AB1 chromatogram for ${queryName}`;
  const hasProcessed = Boolean(
    queryRecord?.trace
    && queryRecord.trace.processed
    && Array.isArray(queryRecord.trace.processed.channels)
    && queryRecord.trace.processed.channels.length
  );
  const sourceSwitch = hasProcessed ? `
    <div class="sequence-viewer-trace-source-switch" role="group" aria-label="Chromatogram signal source">
      <button type="button"
              class="sequence-viewer-trace-source-btn${useProcessed ? '' : ' sequence-viewer-trace-source-btn-active'}"
              data-trace-source="raw"
              aria-pressed="${useProcessed ? 'false' : 'true'}"
              title="Show the raw chromatogram channels exactly as recorded in the AB1 file.">Raw</button>
      <button type="button"
              class="sequence-viewer-trace-source-btn${useProcessed ? ' sequence-viewer-trace-source-btn-active' : ''}"
              data-trace-source="processed"
              aria-pressed="${useProcessed ? 'true' : 'false'}"
              title="Show the post-processed chromatogram: baseline subtraction, cross-talk reduction, normalization, Savitzky-Golay smoothing, and peak refinement.">Processed</button>
    </div>
  ` : '';

  return `
    <div class="sequence-viewer-alignment-trace-head">
      <div class="sequence-viewer-alignment-trace-head-title">
        <strong>Chromatogram</strong>
        <span class="small-note">${escapeHtml(queryName)} | ${escapeHtml(details.join(' | '))}</span>
      </div>
      ${sourceSwitch}
    </div>
    <div class="sequence-viewer-alignment-trace-scroll">
      <svg
        class="sequence-viewer-alignment-trace-svg"
        style="width:${traceWidth}px;"
        viewBox="0 0 ${traceWidth} ${TRACE_HEIGHT}"
        role="img"
        aria-label="${escapeHtml(svgLabel)}"
      >
        <rect class="sequence-viewer-trace-plot-bg" x="0" y="${TRACE_SIGNAL_TOP}" width="${traceWidth}" height="${TRACE_SIGNAL_HEIGHT}"></rect>
        <g class="sequence-viewer-trace-grid">${renderTraceGrid(traceWidth)}</g>
        <g class="sequence-viewer-trace-lines">${renderTraceChannelPolylines(displayTrace, traceWidth)}</g>
        <g class="sequence-viewer-trace-base-calls">${renderTraceBaseCalls(displayTrace, differenceMap, traceWidth)}</g>
        <g class="sequence-viewer-trace-differences">${renderTraceDifferenceMarkers(displayTrace, differenceMap, traceWidth)}</g>
      </svg>
    </div>
    <div class="sequence-viewer-alignment-trace-legend">
      ${renderTraceLegend()}
      ${differenceMap.size ? '<span class="sequence-viewer-trace-legend-diff">Differences marked below base calls</span>' : ''}
    </div>
  `;
}

export function getAlignmentSessionsForRecord(state, record) {
  const sessions = Array.isArray(state?.alignmentSessions) ? state.alignmentSessions : [];
  const referenceKey = buildSequenceSignature(record?.sequence || '', 'ref');
  if (!referenceKey) {
    return [];
  }
  return sessions.filter((session) => {
    const sessionReferenceKey = cleanText(session?.referenceRecordKey, 200);
    return !sessionReferenceKey || sessionReferenceKey === referenceKey;
  });
}

export function syncAlignmentControlsState({ elements = {}, state = {}, record = null } = {}) {
  const hasRecord = Boolean(record?.sequence?.length);
  const savedSessions = getAlignmentSessionsForRecord(state, record);
  const hasAppliedAlignment = Boolean(state.activeAlignmentResult && state.activeAlignmentQueryRecord);
  if (elements.alignmentSessionSelect) {
    if (!savedSessions.length) {
      elements.alignmentSessionSelect.innerHTML = '<option value="">No saved alignments</option>';
      elements.alignmentSessionSelect.value = '';
      elements.alignmentSessionSelect.disabled = true;
    } else {
      elements.alignmentSessionSelect.disabled = false;
      elements.alignmentSessionSelect.innerHTML = savedSessions
        .map((session) => {
          const sessionId = cleanText(session?.id, 200);
          const label = cleanText(session?.name || session?.queryRecord?.name || 'alignment', 120) || 'alignment';
          const selected = sessionId === String(state.activeAlignmentSessionId || '') ? ' selected' : '';
          return `<option value="${escapeHtml(sessionId)}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join('');
      if (!savedSessions.some((session) => String(session?.id || '') === String(state.activeAlignmentSessionId || ''))) {
        elements.alignmentSessionSelect.value = cleanText(savedSessions[0]?.id, 200);
      }
    }
  }

  if (elements.alignmentToggle) {
    elements.alignmentToggle.checked = Boolean(state.alignmentViewEnabled && hasAppliedAlignment);
    elements.alignmentToggle.disabled = !hasRecord || !hasAppliedAlignment;
  }
  if (elements.alignmentActiveNote) {
    elements.alignmentActiveNote.textContent = hasAppliedAlignment
      ? ''
      : (savedSessions.length
        ? `${savedSessions.length.toLocaleString()} saved alignment${savedSessions.length === 1 ? '' : 's'} ready for this reference.`
        : 'No alignment selected.');
  }
  if (elements.alignmentActiveNote?.style) {
    elements.alignmentActiveNote.style.color = hasAppliedAlignment || savedSessions.length ? '' : 'var(--muted)';
  }
}

export function getAlignmentHighlightSegments(state, record) {
  if (!state?.alignmentViewEnabled || !record?.sequence?.length) {
    return [];
  }

  const differences = Array.isArray(state?.activeAlignmentResult?.differences)
    ? state.activeAlignmentResult.differences
    : [];
  if (!differences.length) {
    return [];
  }

  return normalizeHighlightSegments(
    differences
      .filter((difference) => difference?.type === 'mismatch' || difference?.type === 'deletion')
      .map((difference) => ({
        start: Math.max(0, Number(difference?.referenceStart) || 0),
        end: Math.max(0, Number(difference?.referenceEnd) || 0),
        kind: 'alignment'
      })),
    record.sequence.length
  );
}
