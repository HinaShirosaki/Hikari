'use strict';

const {
  MIN_PROTEIN_ANNOTATION_AA_LENGTH,
  ORF_START_CODONS,
  ORF_STOP_CODONS
} = require('./constants');
const {
  normalizeSequenceText,
  normalizeTopologyValue,
  positiveModulo,
  reverseComplementIupac
} = require('./utils');
const {
  buildSegmentsFromStartAndLength,
  readCircularCodon,
  readSequenceSpan
} = require('./sequence-geometry');
const { translateFeatureSequenceToProtein } = require('./protein-utils');

function detectLinearOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= sequenceLength - 3; start += 3) {
      if (!ORF_START_CODONS.has(text.slice(start, start + 3))) {
        continue;
      }
      const hit = findLinearStop(text, start, minNtLength, frame);
      if (hit) {
        hits.push(hit);
      }
    }
  }
  return hits;
}

function findLinearStop(text, start, minNtLength, frame) {
  for (let position = start + 3; position <= text.length - 3; position += 3) {
    const stopCodon = text.slice(position, position + 3);
    if (!ORF_STOP_CODONS.has(stopCodon)) {
      continue;
    }
    const length = (position + 3) - start;
    return length >= minNtLength ? { start, length, frame, stopCodon } : null;
  }
  return null;
}

function detectCircularOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const maxCodonSteps = Math.max(0, Math.floor(sequenceLength / 3));
  if (!maxCodonSteps) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start < sequenceLength; start += 3) {
      if (!ORF_START_CODONS.has(readCircularCodon(text, start))) {
        continue;
      }
      const hit = findCircularStop(text, start, minNtLength, frame, maxCodonSteps);
      if (hit) {
        hits.push(hit);
      }
    }
  }
  return hits;
}

function findCircularStop(text, start, minNtLength, frame, maxCodonSteps) {
  for (let step = 1; step <= maxCodonSteps; step += 1) {
    const length = (step * 3) + 3;
    if (length > text.length) {
      break;
    }
    const position = (start + (step * 3)) % text.length;
    const stopCodon = readCircularCodon(text, position);
    if (!ORF_STOP_CODONS.has(stopCodon)) {
      continue;
    }
    return length >= minNtLength ? { start, length, frame, stopCodon } : null;
  }
  return null;
}

function detectOrfHitsForSequence(sequence, topology, minNtLength) {
  return normalizeTopologyValue(topology) === 'circular'
    ? detectCircularOrfHits(sequence, minNtLength)
    : detectLinearOrfHits(sequence, minNtLength);
}

function buildProteinAnnotationOrfs(sequence, topology = 'linear', minAaLength = MIN_PROTEIN_ANNOTATION_AA_LENGTH) {
  const text = normalizeSequenceText(sequence).replace(/[^ACGT]/g, 'N');
  const sequenceLength = text.length;
  if (!sequenceLength) {
    return [];
  }

  const normalizedTopology = normalizeTopologyValue(topology);
  const safeMinAaLength = Math.max(1, Math.floor(Number(minAaLength) || MIN_PROTEIN_ANNOTATION_AA_LENGTH));
  const minNtLength = Math.max(6, (safeMinAaLength + 1) * 3);
  const forwardHits = detectOrfHitsForSequence(text, normalizedTopology, minNtLength);
  const reverseSequence = reverseComplementIupac(text).replace(/[^ACGT]/g, 'N');
  const reverseHits = detectOrfHitsForSequence(reverseSequence, normalizedTopology, minNtLength);
  const dedupe = new Set();
  const orfs = [];

  forwardHits.forEach((hit) => pushOrf(orfs, dedupe, hit, 1, text, reverseSequence, sequenceLength, normalizedTopology));
  reverseHits.forEach((hit) => pushOrf(orfs, dedupe, hit, -1, text, reverseSequence, sequenceLength, normalizedTopology));
  return orfs.sort((left, right) => (left.segments?.[0]?.start ?? 0) - (right.segments?.[0]?.start ?? 0)
    || Math.max(0, Number(right.orfLengthNt) || 0) - Math.max(0, Number(left.orfLengthNt) || 0));
}

function pushOrf(orfs, dedupe, hit, strand, text, reverseSequence, sequenceLength, topology) {
  const hitLength = Math.max(0, Number(hit?.length) || 0);
  if (hitLength <= 0) {
    return;
  }

  const genomicStart = strand === 1
    ? Math.max(0, Number(hit?.start) || 0)
    : positiveModulo(sequenceLength - ((Number(hit?.start) || 0) + hitLength), sequenceLength);
  const segments = buildSegmentsFromStartAndLength(genomicStart, hitLength, sequenceLength, topology);
  if (!segments.length) {
    return;
  }

  const sourceSequence = strand === 1 ? text : reverseSequence;
  const dnaSequence = readSequenceSpan(sourceSequence, Number(hit?.start) || 0, hitLength, topology);
  const proteinSequence = translateFeatureSequenceToProtein(dnaSequence);
  if (!proteinSequence) {
    return;
  }

  const frameIndex = Math.max(0, Math.min(2, Number(hit?.frame) || 0));
  const frameLabel = `${strand === -1 ? '-' : '+'}${frameIndex + 1}`;
  const dedupeKey = `${strand}|${frameLabel}|${segments.map((segment) => `${segment.start}-${segment.end}`).join(',')}|${proteinSequence}`;
  if (dedupe.has(dedupeKey)) {
    return;
  }
  dedupe.add(dedupeKey);
  orfs.push({
    strand,
    segments,
    dnaSequence,
    proteinSequence,
    translation: proteinSequence,
    orfFrame: frameLabel,
    orfLengthNt: hitLength,
    orfLengthAa: proteinSequence.length,
    startCodon: 'ATG',
    stopCodon: String(hit?.stopCodon || '').toUpperCase()
  });
}

module.exports = { buildProteinAnnotationOrfs };
