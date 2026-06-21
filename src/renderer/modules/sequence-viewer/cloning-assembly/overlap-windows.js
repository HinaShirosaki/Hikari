import { reverseComplementDna } from '../../tool-box/sequence.js';
import { oligoTm } from '../../tool-box/oligo.js';
import {
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH,
  DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH
} from './constants.js';
import { computeGcContent, createMidpoint, normalizeSequence } from './sequence-utils.js';

export function longestTerminalOverlap(leftSequence, rightSequence, maxLength = Number.POSITIVE_INFINITY) {
  const left = normalizeSequence(leftSequence);
  const right = normalizeSequence(rightSequence);
  const safeMax = Math.min(
    left.length,
    right.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );

  for (let length = safeMax; length >= 1; length -= 1) {
    const suffix = left.slice(left.length - length);
    const prefix = right.slice(0, length);
    if (suffix === prefix) {
      return {
        sequence: suffix,
        length
      };
    }
  }

  return {
    sequence: '',
    length: 0
  };
}

export function candidateScore(tm, midpoint, length, preferredLength) {
  return Math.abs(tm - midpoint) + (Math.abs(length - preferredLength) * 0.25);
}

export function selectBindingWindow(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  const cleaned = normalizeSequence(sequence);
  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const minLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxLength = Math.min(
    cleaned.length,
    Number(thresholds?.primerLength?.max) || cleaned.length,
    Math.max(0, maxPrimerLength - Math.max(0, Number(tailLength) || 0))
  );

  if (maxLength < minLength) {
    return null;
  }

  const preferredTm = createMidpoint(thresholds?.primerTm);
  const preferredLength = createMidpoint(thresholds?.primerLength);
  let best = null;

  for (let length = minLength; length <= maxLength; length += 1) {
    const bindingSource = direction === 'reverse'
      ? cleaned.slice(Math.max(0, cleaned.length - length))
      : cleaned.slice(0, length);
    const bindingSequence = direction === 'reverse'
      ? reverseComplementDna(bindingSource)
      : bindingSource;
    const tm = oligoTm(bindingSequence, 'DNA');
    if (tm < thresholds.primerTm.min || tm > thresholds.primerTm.max) {
      continue;
    }
    const score = candidateScore(tm, preferredTm, length, preferredLength);
    if (!best || score < best.score) {
      best = {
        bindingSequence,
        sourceSequence: bindingSource,
        length,
        tm,
        gcContent: computeGcContent(bindingSequence),
        score
      };
    }
  }

  return best;
}

export function selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const maxTailLength = Math.min(
    rightSequence.length,
    Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength) - Number(thresholds?.primerLength?.min || 0),
    Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
  );
  const minLength = Math.min(
    maxTailLength,
    Math.max(1, Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH)
  );
  const preferredTm = createMidpoint(thresholds?.overlapTm);

  let best = null;
  for (let length = minLength; length <= maxTailLength; length += 1) {
    const overlapSequence = rightSequence.slice(0, length);
    const overlapTm = oligoTm(overlapSequence, 'DNA');
    if (overlapTm < thresholds.overlapTm.min || overlapTm > thresholds.overlapTm.max) {
      continue;
    }
    const leftBinding = selectBindingWindow(leftSequence, 'reverse', thresholds, length, config);
    if (!leftBinding) {
      continue;
    }
    const score = Math.abs(overlapTm - preferredTm) + Math.abs(length - minLength) * 0.1;
    if (!best || score < best.score) {
      best = {
        sequence: overlapSequence,
        length,
        tm: overlapTm,
        gcContent: computeGcContent(overlapSequence),
        leftBinding,
        score
      };
    }
  }

  return best;
}
