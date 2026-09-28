import {
  clamp,
  normalizeSequenceText,
  normalizeTopology,
  positiveModulo,
  reverseComplementIupac
} from './sequence-utils.js';

const ORF_START_CODONS = new Set(['ATG']);
const ORF_STOP_CODONS = ['TAA', 'TAG', 'TGA'];
const DEFAULT_MIN_ORF_AA_LENGTH = 75;

function readCircularCodon(sequence, start) {
  const text = String(sequence || '');
  const length = text.length;
  if (length < 3) {
    return '';
  }
  return `${text[positiveModulo(start, length)] || ''}${text[positiveModulo(start + 1, length)] || ''}${text[positiveModulo(start + 2, length)] || ''}`;
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

function normalizeStopCodons(value) {
  if (typeof value === 'string') {
    const selected = new Set(
      value.toUpperCase().split(/[\s,;|]+/).filter((codon) => ORF_STOP_CODONS.includes(codon))
    );
    return selected.size ? selected : new Set(ORF_STOP_CODONS);
  }

  const source = value && typeof value === 'object' ? value : null;
  if (!source) {
    return new Set(ORF_STOP_CODONS);
  }
  return new Set(ORF_STOP_CODONS.filter((codon) => {
    const hasUpper = Object.prototype.hasOwnProperty.call(source, codon);
    const hasLower = Object.prototype.hasOwnProperty.call(source, codon.toLowerCase());
    return hasUpper || hasLower
      ? source[codon] === true || source[codon.toLowerCase()] === true
      : true;
  }));
}

function detectLinearOrfHits(sequence, minNtLength, stopCodons) {
  const text = String(sequence || '');
  if (text.length < 6 || !stopCodons.size) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= text.length - 3; start += 3) {
      if (!ORF_START_CODONS.has(text.slice(start, start + 3))) {
        continue;
      }
      for (let position = start + 3; position <= text.length - 3; position += 3) {
        const stopCodon = text.slice(position, position + 3);
        if (!stopCodons.has(stopCodon)) {
          continue;
        }
        const length = (position + 3) - start;
        if (length >= minNtLength) {
          hits.push({ start, length, frame, stopCodon });
        }
        break;
      }
    }
  }
  return hits;
}

function detectCircularOrfHits(sequence, minNtLength, stopCodons) {
  const text = String(sequence || '');
  const maxCodonSteps = Math.max(0, Math.floor(text.length / 3));
  if (text.length < 6 || !stopCodons.size || !maxCodonSteps) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start < text.length; start += 3) {
      if (!ORF_START_CODONS.has(readCircularCodon(text, start))) {
        continue;
      }
      for (let step = 1; step <= maxCodonSteps; step += 1) {
        const length = (step * 3) + 3;
        if (length > text.length) {
          break;
        }
        const stopCodon = readCircularCodon(text, (start + (step * 3)) % text.length);
        if (!stopCodons.has(stopCodon)) {
          continue;
        }
        if (length >= minNtLength) {
          hits.push({ start, length, frame, stopCodon });
        }
        break;
      }
    }
  }
  return hits;
}

export function buildOrfFeatures(sequence, topology = 'linear', options = {}) {
  const text = normalizeSequenceText(sequence).replace(/[^ACGT]/g, 'N');
  if (!text.length) {
    return [];
  }

  const minAaLength = Math.max(1, Math.floor(Number(options?.minAaLength) || DEFAULT_MIN_ORF_AA_LENGTH));
  const minNtLength = Math.max(6, (minAaLength + 1) * 3);
  const normalizedTopology = normalizeTopology(topology);
  const stopCodons = normalizeStopCodons(options?.stopCodons);
  const detect = normalizedTopology === 'circular' ? detectCircularOrfHits : detectLinearOrfHits;
  const forwardHits = detect(text, minNtLength, stopCodons);
  const reverseHits = detect(reverseComplementIupac(text).replace(/[^ACGT]/g, 'N'), minNtLength, stopCodons);
  const dedupe = new Set();
  const features = [];

  const pushFeature = (hit, strand) => {
    const hitLength = Math.max(0, Number(hit?.length) || 0);
    const genomicStart = strand === 1
      ? Number(hit?.start) || 0
      : positiveModulo(text.length - ((Number(hit?.start) || 0) + hitLength), text.length);
    const segments = buildSegmentsFromStartAndLength(genomicStart, hitLength, text.length, normalizedTopology);
    if (!segments.length) {
      return;
    }
    const frameIndex = Math.max(0, Math.min(2, Number(hit?.frame) || 0));
    const frameLabel = `${strand === -1 ? '-' : '+'}${frameIndex + 1}`;
    const stopCodon = String(hit?.stopCodon || '').toUpperCase();
    const segmentKey = segments.map((segment) => `${segment.start}-${segment.end}`).join(',');
    const dedupeKey = `${strand}|${frameLabel}|${segmentKey}|${stopCodon}`;
    if (dedupe.has(dedupeKey)) {
      return;
    }
    dedupe.add(dedupeKey);
    const aaLength = Math.max(0, Math.floor(hitLength / 3) - 1);
    features.push({
      id: `orf_${strand === -1 ? 'minus' : 'plus'}_${frameIndex + 1}_${segments[0].start}_${hitLength}`,
      name: `ORF ${frameLabel}`,
      type: 'open_reading_frame',
      strand,
      description: `Predicted ORF (${aaLength} aa, ${hitLength} nt, frame ${frameLabel}, start ATG${stopCodon ? `, stop ${stopCodon}` : ''}).`,
      source: 'orf',
      mode: 'ORF',
      orfFrame: frameLabel,
      orfLengthNt: hitLength,
      orfLengthAa: aaLength,
      startCodon: 'ATG',
      stopCodon,
      segments
    });
  };

  // Nested in-frame ORFs share a stop codon: keep only the longest per stop.
  // Keyed on stop position, not frame label, because a frame that crosses the
  // origin of a circle whose length is not a multiple of 3 changes linear frame.
  const longestPerStop = (hits) => {
    const best = new Map();
    hits.forEach((hit) => {
      const stopKey = (hit.start + hit.length) % text.length;
      if ((best.get(stopKey)?.length || 0) < hit.length) {
        best.set(stopKey, hit);
      }
    });
    return [...best.values()];
  };

  longestPerStop(forwardHits).forEach((hit) => pushFeature(hit, 1));
  longestPerStop(reverseHits).forEach((hit) => pushFeature(hit, -1));
  features.sort((left, right) => {
    const startDifference = (left.segments?.[0]?.start ?? 0) - (right.segments?.[0]?.start ?? 0);
    return startDifference
      || (Number(right.orfLengthNt) || 0) - (Number(left.orfLengthNt) || 0)
      || String(left.name || '').localeCompare(String(right.name || ''));
  });
  return features;
}
