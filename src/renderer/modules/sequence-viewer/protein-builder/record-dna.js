import { buildOrfFeatures } from '../orf-analysis.js';
import { cleanText } from '../shared.js';
import { extractDnaFromRecordSegments, normalizeRecordSegments } from './segments.js';
import {
  alignDnaToProteinSequence,
  normalizeProteinBuildSequence,
  proteinsEquivalent,
  stripTerminalStop,
  translateDnaToProtein
} from './sequence-utils.js';

export function buildRecordSequenceCandidate(record, feature, sourceKind = 'feature') {
  const featureType = cleanText(feature?.type, 120).toLowerCase();
  const hasExplicitProtein = Boolean(cleanText(feature?.translation || feature?.proteinSequence, 24000));
  const isLikelyCoding = hasExplicitProtein
    || featureType === 'cds'
    || featureType === 'insert'
    || featureType === 'open_reading_frame'
    || featureType === 'orf';
  if (!isLikelyCoding) {
    return null;
  }

  const dnaSequence = extractDnaFromRecordSegments(record?.sequence, feature?.segments, Number(feature?.strand) === -1 ? -1 : 1);
  if (!dnaSequence) {
    return null;
  }
  const proteinSequence = normalizeProteinBuildSequence(
    feature?.translation
      || feature?.proteinSequence
      || translateDnaToProtein(dnaSequence)
  );
  if (!proteinSequence.length) {
    return null;
  }

  return {
    sourceKind,
    type: featureType || 'feature',
    label: cleanText(feature?.name, 140) || 'feature',
    dnaSequence,
    proteinSequence,
    segments: normalizeRecordSegments(feature?.segments, String(record?.sequence || '').length),
    strand: Number(feature?.strand) === -1 ? -1 : 1
  };
}

export function getPoiSourcePriority(candidate) {
  const sourceKind = cleanText(candidate?.sourceKind, 40).toLowerCase();
  const type = cleanText(candidate?.type, 120).toLowerCase();
  if (sourceKind === 'selected_feature') {
    return 0;
  }
  if (type === 'cds') {
    return 1;
  }
  if (type === 'insert') {
    return 2;
  }
  if (type === 'open_reading_frame' || type === 'orf') {
    return 3;
  }
  return 4;
}

function collectRecordSequenceCandidates(record, selectedFeature = null, targetProtein = '') {
  if (!record?.sequence?.length) {
    return [];
  }

  const normalizedTarget = normalizeProteinBuildSequence(targetProtein);
  const dedupe = new Set();
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidate?.dnaSequence || !candidate?.proteinSequence) {
      return;
    }
    if (normalizedTarget.length && !proteinsEquivalent(candidate.proteinSequence, normalizedTarget)) {
      return;
    }
    const key = [
      cleanText(candidate.sourceKind, 40),
      cleanText(candidate.type, 120),
      cleanText(candidate.label, 140),
      candidate.strand === -1 ? -1 : 1,
      candidate.segments.map((segment) => `${segment.start}-${segment.end}`).join(',')
    ].join('|');
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    candidates.push(candidate);
  };

  pushCandidate(buildRecordSequenceCandidate(record, selectedFeature, 'selected_feature'));
  (Array.isArray(record?.features) ? record.features : []).forEach((feature) => {
    pushCandidate(buildRecordSequenceCandidate(record, feature, 'record_feature'));
  });

  buildOrfFeatures(record.sequence, record.topology, {
    minAaLength: Math.max(1, stripTerminalStop(normalizedTarget).length)
  }).forEach((orfFeature) => {
    pushCandidate(buildRecordSequenceCandidate(record, orfFeature, 'record_orf'));
  });

  return candidates;
}

function sortRecordSequenceCandidates(candidates, targetProtein = '') {
  const normalizedTarget = normalizeProteinBuildSequence(targetProtein);
  return [...candidates].sort((left, right) => {
    const leftPriority = getPoiSourcePriority(left);
    const rightPriority = getPoiSourcePriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    if (normalizedTarget.length) {
      const leftLengthDelta = Math.abs(stripTerminalStop(left.proteinSequence).length - stripTerminalStop(normalizedTarget).length);
      const rightLengthDelta = Math.abs(stripTerminalStop(right.proteinSequence).length - stripTerminalStop(normalizedTarget).length);
      if (leftLengthDelta !== rightLengthDelta) {
        return leftLengthDelta - rightLengthDelta;
      }
    } else if (left.proteinSequence.length !== right.proteinSequence.length) {
      return right.proteinSequence.length - left.proteinSequence.length;
    }
    return cleanText(left.label, 140).localeCompare(cleanText(right.label, 140));
  });
}

function describeRecordSequenceSource(candidate) {
  const best = candidate || {};
  const sourceLabel = cleanText(best?.label, 140) || 'current vector';
  const sourceType = cleanText(best?.type, 120).toLowerCase();
  const sourceDescription = sourceType === 'cds'
    ? `current vector CDS ${sourceLabel}`
    : (sourceType === 'open_reading_frame' || sourceType === 'orf'
      ? `current vector ORF ${sourceLabel}`
      : `current vector feature ${sourceLabel}`);

  return { sourceLabel, sourceDescription };
}

export function resolvePoiSourceFromRecord(record, selectedFeature = null) {
  const candidates = sortRecordSequenceCandidates(
    collectRecordSequenceCandidates(record, selectedFeature)
  );
  if (!candidates.length) {
    return null;
  }

  const best = candidates[0];
  const { sourceLabel, sourceDescription } = describeRecordSequenceSource(best);

  return {
    label: sourceLabel,
    proteinSequence: best.proteinSequence,
    dnaSequence: best.dnaSequence,
    note: `Uses DNA from ${sourceDescription}.`,
    reusedSource: `Reused active DNA from ${sourceDescription}.`,
    sourceLabel
  };
}

export function resolvePoiDnaFromRecord(proteinSequence, record, selectedFeature = null) {
  const targetProtein = normalizeProteinBuildSequence(proteinSequence);
  if (!targetProtein.length) {
    return null;
  }

  const candidates = sortRecordSequenceCandidates(
    collectRecordSequenceCandidates(record, selectedFeature, targetProtein),
    targetProtein
  );
  if (!candidates.length) {
    return null;
  }

  const best = candidates[0];
  const { sourceLabel, sourceDescription } = describeRecordSequenceSource(best);

  return {
    dnaSequence: alignDnaToProteinSequence(best.dnaSequence, proteinSequence),
    note: `Reused active DNA from ${sourceDescription}.`,
    sourceLabel
  };
}
