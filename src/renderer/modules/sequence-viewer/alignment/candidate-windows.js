import { normalizeTopology } from '../shared.js';
import { DEFAULT_MAX_CANDIDATE_WINDOWS, DEFAULT_WINDOW_PADDING_BP } from './constants.js';

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeAlignmentRecord(record, fallbackName) {
  const safeRecord = record && typeof record === 'object' ? record : {};
  const sequence = String(safeRecord.sequence || '').toUpperCase();
  if (!sequence) {
    throw new Error(`${fallbackName} record has no sequence.`);
  }

  return {
    name: String(safeRecord.name || fallbackName || 'record').trim() || fallbackName || 'record',
    sourceFormat: String(safeRecord.sourceFormat || 'unknown').trim() || 'unknown',
    topology: normalizeTopology(safeRecord.topology || 'linear'),
    sequence
  };
}

function isCanonicalDnaSegment(segment) {
  return /^[ACGT]+$/.test(String(segment || ''));
}

function buildKmerIndex(sequence, k) {
  const index = new Map();
  const length = Math.max(0, sequence.length - k + 1);
  for (let position = 0; position < length; position += 1) {
    const kmer = sequence.slice(position, position + k);
    if (!isCanonicalDnaSegment(kmer)) {
      continue;
    }
    if (!index.has(kmer)) {
      index.set(kmer, []);
    }
    index.get(kmer).push(position);
  }
  return index;
}

function collectOffsetBins(referenceSequence, querySequence, k) {
  const referenceIndex = buildKmerIndex(referenceSequence, k);
  const bins = new Map();
  const limit = Math.max(0, querySequence.length - k + 1);

  for (let queryPosition = 0; queryPosition < limit; queryPosition += 1) {
    const kmer = querySequence.slice(queryPosition, queryPosition + k);
    if (!isCanonicalDnaSegment(kmer)) {
      continue;
    }

    const referencePositions = referenceIndex.get(kmer);
    if (!referencePositions?.length) {
      continue;
    }

    referencePositions.forEach((referencePosition) => {
      const offset = referencePosition - queryPosition;
      bins.set(offset, (bins.get(offset) || 0) + 1);
    });
  }

  return [...bins.entries()]
    .map(([offset, count]) => ({ offset, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.offset - right.offset;
    });
}

function buildCandidateWindows(referenceSequence, querySequence, topology, options = {}) {
  const safeTopology = normalizeTopology(topology);
  const isCircular = safeTopology === 'circular';
  const queryLength = Math.max(0, querySequence.length);
  const searchSequence = isCircular ? `${referenceSequence}${referenceSequence}` : referenceSequence;
  const k = queryLength < 80 ? 6 : 8;
  const padding = Math.max(0, Number(options.windowPadding) || DEFAULT_WINDOW_PADDING_BP);
  const targetWindowLength = Math.max(queryLength, queryLength + (padding * 2));
  const topLimit = Math.max(1, Math.floor(Number(options.maxWindows) || DEFAULT_MAX_CANDIDATE_WINDOWS));

  const bins = collectOffsetBins(searchSequence, querySequence, k).slice(0, topLimit);
  const windows = [];
  const seen = new Set();

  const pushWindow = (start, end, anchorCount = 0) => {
    const safeStart = clamp(Math.floor(start), 0, Math.max(0, searchSequence.length));
    const safeEnd = clamp(Math.ceil(end), safeStart, Math.max(0, searchSequence.length));
    const key = `${safeStart}:${safeEnd}`;
    if (seen.has(key) || safeEnd <= safeStart) {
      return;
    }
    seen.add(key);
    windows.push({
      start: safeStart,
      end: safeEnd,
      anchorCount
    });
  };

  bins.forEach((bin) => {
    let windowStart = Math.floor(bin.offset - padding);
    let windowEnd = windowStart + targetWindowLength;

    if (windowStart < 0) {
      windowEnd = Math.min(searchSequence.length, windowEnd - windowStart);
      windowStart = 0;
    }
    if (windowEnd > searchSequence.length) {
      const overflow = windowEnd - searchSequence.length;
      windowStart = Math.max(0, windowStart - overflow);
      windowEnd = searchSequence.length;
    }

    pushWindow(windowStart, windowEnd, bin.count);
  });

  if (!windows.length) {
    pushWindow(0, searchSequence.length, 0);
  }

  return {
    k,
    searchSequence,
    windows
  };
}

export {
  buildCandidateWindows,
  normalizeAlignmentRecord
};
