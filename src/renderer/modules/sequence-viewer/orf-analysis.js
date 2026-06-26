import { translateDnaCodon } from '../tool-box/sequence.js';
import * as sharedOrfFeatures from './algorithms/orf-features.js';
import {
  DEFAULT_MIN_ORF_AA_LENGTH,
  ORF_START_CODONS,
  ORF_STOP_CODONS
} from './constants.js';
import {
  getEnabledOrfStopCodons,
  normalizeOrfStopCodonSelection,
  resolveOrfTranslationDisplay
} from './translation-style.js';
import {
  clamp,
  complementBase,
  normalizeSequenceText,
  normalizeTopology,
  reverseComplementIupac
} from './shared.js';

const ORF_FEATURE_CACHE = new WeakMap();

function positiveModulo(value, modulo) {
  if (!Number.isFinite(Number(modulo)) || modulo <= 0) {
    return 0;
  }
  const numeric = Number(value) || 0;
  return ((numeric % modulo) + modulo) % modulo;
}

function readCircularCodon(sequence, start) {
  const text = String(sequence || '');
  const length = text.length;
  if (length < 3) {
    return '';
  }
  const first = text[positiveModulo(start, length)] || '';
  const second = text[positiveModulo(start + 1, length)] || '';
  const third = text[positiveModulo(start + 2, length)] || '';
  return `${first}${second}${third}`;
}

function buildSegmentsFromStartAndLength(start, length, sequenceLength, topology = 'linear') {
  const normalizedLength = Math.max(0, Number(sequenceLength) || 0);
  const normalizedSpan = Math.max(0, Number(length) || 0);
  if (!normalizedLength || normalizedSpan <= 0) {
    return [];
  }

  if (normalizeTopology(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, normalizedLength);
    const safeEnd = clamp(safeStart + normalizedSpan, 0, normalizedLength);
    return safeEnd > safeStart ? [{ start: safeStart, end: safeEnd }] : [];
  }

  const circularStart = positiveModulo(Math.round(Number(start) || 0), normalizedLength);
  if (normalizedSpan >= normalizedLength) {
    if (circularStart === 0) {
      return [{ start: 0, end: normalizedLength }];
    }
    return [
      { start: circularStart, end: normalizedLength },
      { start: 0, end: circularStart }
    ];
  }

  const circularEnd = (circularStart + normalizedSpan) % normalizedLength;
  if (circularEnd > circularStart) {
    return [{ start: circularStart, end: circularEnd }];
  }
  if (circularEnd === circularStart) {
    return [{ start: 0, end: normalizedLength }];
  }
  return [
    { start: circularStart, end: normalizedLength },
    { start: 0, end: circularEnd }
  ];
}

function buildStopCodonSet(value) {
  return new Set(getEnabledOrfStopCodons(value));
}

function buildStopCodonCacheKey(value) {
  return getEnabledOrfStopCodons(value).join(',');
}

function detectLinearOrfHits(sequence, minNtLength, stopCodons = ORF_STOP_CODONS) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  const activeStopCodons = stopCodons instanceof Set ? stopCodons : new Set(stopCodons || []);
  if (sequenceLength < 6 || !activeStopCodons.size) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= sequenceLength - 3; start += 3) {
      const startCodon = text.slice(start, start + 3);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let position = start + 3; position <= sequenceLength - 3; position += 3) {
        const stopCodon = text.slice(position, position + 3);
        if (!activeStopCodons.has(stopCodon)) {
          continue;
        }
        const length = (position + 3) - start;
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectCircularOrfHits(sequence, minNtLength, stopCodons = ORF_STOP_CODONS) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  const activeStopCodons = stopCodons instanceof Set ? stopCodons : new Set(stopCodons || []);
  if (sequenceLength < 6 || !activeStopCodons.size) {
    return [];
  }

  const maxCodonSteps = Math.max(0, Math.floor(sequenceLength / 3));
  if (!maxCodonSteps) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start < sequenceLength; start += 3) {
      const startCodon = readCircularCodon(text, start);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let step = 1; step <= maxCodonSteps; step += 1) {
        const length = (step * 3) + 3;
        if (length > sequenceLength) {
          break;
        }
        const position = (start + (step * 3)) % sequenceLength;
        const stopCodon = readCircularCodon(text, position);
        if (!activeStopCodons.has(stopCodon)) {
          continue;
        }
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectOrfHitsForSequence(sequence, topology, minNtLength, stopCodons = ORF_STOP_CODONS) {
  const normalizedTopology = normalizeTopology(topology);
  return normalizedTopology === 'circular'
    ? detectCircularOrfHits(sequence, minNtLength, stopCodons)
    : detectLinearOrfHits(sequence, minNtLength, stopCodons);
}

export function buildOrfFeatures(sequence, topology = 'linear', options = {}) {
  return sharedOrfFeatures.buildOrfFeatures(sequence, topology, options);
}

function collapseNestedOrfFeatures(features, sequenceLength) {
  const list = Array.isArray(features) ? features : [];
  if (list.length < 2) {
    return list;
  }

  const annotated = list.map((feature, index) => ({
    feature,
    index,
    strand: feature?.strand === -1 ? -1 : 1,
    frame: String(feature?.orfFrame || ''),
    indices: getOrfCodingIndices(feature, sequenceLength)
  }));
  const byGroup = new Map();
  annotated.forEach((entry) => {
    const key = `${entry.strand}|${entry.frame}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
    }
    byGroup.get(key).push(entry);
  });

  const discarded = new Set();
  const isSubset = (inner, outer) => {
    if (!inner.length || inner.length > outer.length) {
      return false;
    }
    const outerSet = new Set(outer);
    return inner.every((index) => outerSet.has(index));
  };

  byGroup.forEach((entries) => {
    const ranked = [...entries].sort((left, right) => {
      if (right.indices.length !== left.indices.length) {
        return right.indices.length - left.indices.length;
      }
      return left.index - right.index;
    });

    for (let i = 0; i < ranked.length; i += 1) {
      const outer = ranked[i];
      if (!outer.indices.length || discarded.has(outer.index)) {
        continue;
      }
      for (let j = i + 1; j < ranked.length; j += 1) {
        const inner = ranked[j];
        if (!inner.indices.length || discarded.has(inner.index)) {
          continue;
        }
        if (isSubset(inner.indices, outer.indices)) {
          discarded.add(inner.index);
        }
      }
    }
  });

  return list.filter((_feature, index) => !discarded.has(index));
}

export function isOrfFeature(feature) {
  if (!feature || typeof feature !== 'object') {
    return false;
  }
  return String(feature.type || '').toLowerCase() === 'open_reading_frame'
    || String(feature.source || '').toLowerCase() === 'orf';
}

function getOrfCodingIndices(feature, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength || !isOrfFeature(feature)) {
    return [];
  }

  const strand = feature?.strand === -1 ? -1 : 1;
  const segments = (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, safeLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, safeLength)
    }))
    .filter((segment) => segment.end > segment.start);
  if (!segments.length) {
    return [];
  }

  const indices = [];
  if (strand === 1) {
    segments.forEach((segment) => {
      for (let index = segment.start; index < segment.end; index += 1) {
        indices.push(index);
      }
    });
  } else {
    for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const segment = segments[segmentIndex];
      for (let index = segment.end - 1; index >= segment.start; index -= 1) {
        indices.push(index);
      }
    }
  }

  return indices;
}

export function buildSelectedOrfTranslationContext(sequence, feature, options = {}) {
  const text = normalizeSequenceText(sequence);
  const sequenceLength = text.length;
  if (!sequenceLength || !isOrfFeature(feature)) {
    return null;
  }

  const strand = feature?.strand === -1 ? -1 : 1;
  const stopDisplay = options?.stopVisibility ?? options?.stopMode;
  const codingIndices = getOrfCodingIndices(feature, sequenceLength);
  const codonCount = Math.floor(codingIndices.length / 3);
  if (!codonCount) {
    return null;
  }

  const anchors = [];

  for (let codonIndex = 0; codonIndex < codonCount; codonIndex += 1) {
    const codonPositions = codingIndices.slice(codonIndex * 3, (codonIndex + 1) * 3);
    if (codonPositions.length !== 3) {
      continue;
    }
    const codon = codonPositions
      .map((baseIndex) => {
        const genomicBase = text[baseIndex] || 'N';
        return strand === -1 ? complementBase(genomicBase) : genomicBase;
      })
      .join('');
    const aa = translateDnaCodon(codon) || 'X';
    if (aa === '*') {
      break;
    }
    const display = resolveOrfTranslationDisplay(aa, codon, stopDisplay);
    if (!display) {
      continue;
    }
    const anchorIndex = Math.min(...codonPositions);
    anchors.push({
      baseIndex: anchorIndex,
      aa,
      codon,
      displayText: display.text,
      colorKey: display.colorKey,
      isStop: Boolean(display.isStop),
      title: aa === '*'
        ? `Stop codon ${display.text === '*' ? codon : display.text}`
        : `${display.text} (${codon})`
    });
  }

  if (!anchors.length) {
    return null;
  }

  anchors.sort((left, right) => left.baseIndex - right.baseIndex);
  return {
    strand,
    anchors
  };
}

export function getOrfFeaturesForRecord(record, options = {}) {
  if (!record?.sequence) {
    return [];
  }
  const minAaLength = Math.max(1, Math.floor(Number(options?.minAaLength) || DEFAULT_MIN_ORF_AA_LENGTH));
  const stopCodonSelection = normalizeOrfStopCodonSelection(options?.stopCodons);
  const cacheKey = `${record.sequence}|${normalizeTopology(record.topology)}|${minAaLength}|${buildStopCodonCacheKey(stopCodonSelection)}`;
  const cached = ORF_FEATURE_CACHE.get(record);
  if (cached?.key === cacheKey && Array.isArray(cached.features)) {
    return cached.features;
  }

  const features = buildOrfFeatures(record.sequence, record.topology, {
    minAaLength,
    stopCodons: stopCodonSelection
  });
  ORF_FEATURE_CACHE.set(record, { key: cacheKey, features });
  return features;
}
