import { cleanText, complementBase, normalizeSequenceText, reverseComplementIupac } from '../shared.js';
import { postProcessAb1Trace } from '../algorithms/ab1-trace-postprocess.js';
import { TRACE_BASE_ORDER, TRACE_SIGNAL_HEIGHT, TRACE_SIGNAL_TOP, TRACE_SMOOTHING_RADIUS } from './trace-constants.js';

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

export {
  buildDisplayAlignmentTrace,
  buildSmoothTracePathData,
  clampTraceValue,
  formatSvgNumber,
  smoothTraceValues
};
