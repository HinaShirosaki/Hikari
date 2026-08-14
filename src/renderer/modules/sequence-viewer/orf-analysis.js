import { translateDnaCodon } from './calculations/sequence.js';
import * as sharedOrfFeatures from './algorithms/orf-features.js';
import {
  DEFAULT_MIN_ORF_AA_LENGTH
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
  normalizeTopology
} from './shared.js';

const ORF_FEATURE_CACHE = new WeakMap();

function buildStopCodonCacheKey(value) {
  return getEnabledOrfStopCodons(value).join(',');
}

export function buildOrfFeatures(sequence, topology = 'linear', options = {}) {
  return sharedOrfFeatures.buildOrfFeatures(sequence, topology, options);
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
      codonPositions,
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
