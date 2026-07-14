import { escapeHtml } from '../../lib/html.js';
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
const TRACE_PIXELS_PER_BASE = 16;
const TRACE_SIGNAL_TOP = 20;
const TRACE_SIGNAL_HEIGHT = 118;
const TRACE_MAX_PATH_POINTS = 2600;
const TRACE_SMOOTHING_RADIUS = 2;
const INLINE_TRACE_HEIGHT = 104;
const INLINE_TRACE_SIGNAL_TOP = 10;
const INLINE_TRACE_SIGNAL_HEIGHT = 82;

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
  // Compute it once on demand and cache it on the trace object so inline
  // rendering can use processed data without re-running the pipeline.
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

function normalizeTrackReferenceIndex(value, sequenceLength, allowWrap) {
  const safeLength = Math.max(0, Math.floor(Number(sequenceLength) || 0));
  if (!safeLength) {
    return null;
  }

  const numeric = Math.floor(Number(value) || 0);
  if (numeric >= 0 && numeric < safeLength) {
    return numeric;
  }
  if (!allowWrap) {
    return null;
  }

  let wrapped = numeric % safeLength;
  if (wrapped < 0) {
    wrapped += safeLength;
  }
  return wrapped;
}

export function buildAlignmentSequenceTrack(state, record, options = {}) {
  const referenceSequence = normalizeSequenceText(record?.sequence || '');
  const result = state?.activeAlignmentResult && typeof state.activeAlignmentResult === 'object'
    ? state.activeAlignmentResult
    : null;
  if (!state?.alignmentViewEnabled || !referenceSequence.length || !result) {
    return null;
  }

  const alignedReference = String(result.alignedReference || '').toUpperCase();
  const alignedQuery = String(result.alignedQuery || '').toUpperCase();
  const columnCount = Math.min(alignedReference.length, alignedQuery.length);
  if (!columnCount) {
    return null;
  }

  const cells = Array.from({ length: referenceSequence.length }, () => null);
  const traceCells = [];
  const queryRecord = state?.activeAlignmentQueryRecord && typeof state.activeAlignmentQueryRecord === 'object'
    ? state.activeAlignmentQueryRecord
    : null;
  const displayTrace = queryRecord
    ? buildDisplayAlignmentTrace(queryRecord, result, { useProcessed: state?.traceUseProcessed !== false })
    : null;
  const allowWrap = Boolean(result.referenceSpan?.wraps);
  let referenceCursor = Math.max(0, Math.floor(Number(result.referenceSpan?.start) || 0));
  let queryCursor = 0;
  let filledCount = 0;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const referenceBase = alignedReference[columnIndex] || '-';
    const queryBase = alignedQuery[columnIndex] || '-';
    if (referenceBase === '-') {
      if (queryBase !== '-') {
        queryCursor += 1;
      }
      continue;
    }

    const referenceIndex = normalizeTrackReferenceIndex(referenceCursor, referenceSequence.length, allowWrap);
    referenceCursor += 1;
    if (!Number.isFinite(referenceIndex)) {
      continue;
    }

    const displayBase = queryBase === '-' ? '-' : queryBase;
    const kind = queryBase === '-'
      ? 'deletion'
      : (referenceBase === queryBase ? 'match' : 'mismatch');
    cells[referenceIndex] = {
      base: displayBase,
      kind
    };
    if (queryBase !== '-' && displayTrace?.positions?.length) {
      traceCells.push({
        referenceIndex,
        queryIndex: queryCursor,
        position: displayTrace.positions[queryCursor],
        base: displayTrace.sequence?.[queryCursor] || queryBase,
        kind
      });
    }
    if (queryBase !== '-') {
      queryCursor += 1;
    }
    filledCount += 1;
  }

  if (!filledCount) {
    return null;
  }

  return {
    cells,
    traceLines: buildInlineTraceLines(displayTrace, traceCells, referenceSequence.length, {
      lineLength: options?.lineLength,
      charAdvancePx: options?.charAdvancePx
    }),
    name: cleanText(state.activeAlignmentSessionName || result.queryName, 140),
    orientation: cleanText(result.orientation, 40).toLowerCase() === 'reverse' ? 'reverse' : 'forward'
  };
}

export function getAlignmentSessionsForRecord(state, record) {
  const sessions = Array.isArray(state?.alignmentSessions) ? state.alignmentSessions : [];
  const referenceKey = buildSequenceSignature(record?.sequence || '', 'ref');
  if (!referenceKey) {
    return [];
  }
  const activeEntryId = cleanText(state?.activeEntryId, 200);
  return sessions.filter((session) => {
    const sessionReferenceKey = cleanText(session?.referenceRecordKey, 200);
    return !sessionReferenceKey
      || sessionReferenceKey === referenceKey
      || isStoredAlignmentSessionForActiveEntry(session, activeEntryId);
  });
}

function isStoredAlignmentSessionForActiveEntry(session, activeEntryId = '') {
  const entryId = cleanText(activeEntryId, 200);
  if (!entryId) {
    return false;
  }
  const sourceRelPath = cleanText(session?.storedSourceRelPath, 2000).replace(/\\/g, '/');
  const sourceAbsPath = cleanText(session?.storedSourcePath, 4000).replace(/\\/g, '/');
  const entryPathPattern = new RegExp(`(?:^|/)entries/${escapeRegExp(entryId)}/alignments(?:/|$)`);
  return entryPathPattern.test(sourceRelPath) || entryPathPattern.test(sourceAbsPath);
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    elements.alignmentActiveNote.style.color = hasAppliedAlignment || savedSessions.length ? '' : 'var(--theme-text-muted)';
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
