import { reverseComplementDna } from '../calculations/sequence.js';
import { cloningPrimerTm } from '../calculations/oligo.js';
import {
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH,
  DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH
} from './constants.js';
import { computeGcContent, createMidpoint, normalizeSequence } from './sequence-utils.js';
import { countPrimerBindingSites } from './primer-quality.js';

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

function scanBindingCandidates(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  const cleaned = normalizeSequence(sequence);
  const specificitySequence = normalizeSequence(config?.specificitySequence || cleaned);
  const specificityCircular = Boolean(config?.specificityCircular);
  const requireUniqueBinding = config?.requireUniqueBinding !== false;
  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const minLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxLength = Math.min(
    cleaned.length,
    Number(thresholds?.primerLength?.max) || cleaned.length,
    Math.max(0, maxPrimerLength - Math.max(0, Number(tailLength) || 0))
  );

  if (maxLength < minLength) {
    return { best: null, evaluated: 0, nonUnique: 0 };
  }

  const preferredTm = createMidpoint(thresholds?.primerTm);
  const preferredLength = createMidpoint(thresholds?.primerLength);
  let best = null;
  let evaluated = 0;
  let nonUnique = 0;

  for (let length = minLength; length <= maxLength; length += 1) {
    evaluated += 1;
    const bindingSource = direction === 'reverse'
      ? cleaned.slice(Math.max(0, cleaned.length - length))
      : cleaned.slice(0, length);
    const bindingSequence = direction === 'reverse'
      ? reverseComplementDna(bindingSource)
      : bindingSource;
    const bindingSiteCount = countPrimerBindingSites(specificitySequence, bindingSequence, specificityCircular);
    if (requireUniqueBinding && bindingSiteCount !== 1) {
      nonUnique += 1;
      continue;
    }
    const tm = cloningPrimerTm(bindingSequence);
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
        bindingSiteCount,
        score
      };
    }
  }

  return { best, evaluated, nonUnique };
}

export function selectBindingWindow(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  return scanBindingCandidates(sequence, direction, thresholds, tailLength, config).best;
}

// Why no window matched. A repeated template is the one cause the threshold
// ladder cannot fix, so it must not be reported as a Tm failure.
export function describeBindingWindowFailure(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  const { best, evaluated, nonUnique } = scanBindingCandidates(sequence, direction, thresholds, tailLength, config);
  if (best || !nonUnique) {
    return '';
  }
  return nonUnique === evaluated
    ? 'Every candidate window binds more than one site on the template, so no unique primer exists here; relaxing Tm thresholds cannot help. Move the boundary out of the repeated region or design against a unique flank.'
    : `${nonUnique} of ${evaluated} candidate windows were rejected for binding more than one site on the template; the rest missed the Tm or length window.`;
}

function engineeredOverlapLengths(rightSequence, thresholds, config) {
  const maxTailLength = Math.min(
    rightSequence.length,
    Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength) - Number(thresholds?.primerLength?.min || 0),
    Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
  );
  return {
    maxTailLength,
    minLength: Math.min(
      maxTailLength,
      Math.max(1, Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH)
    )
  };
}

// An engineered overlap needs a binding window on the left fragment, so a
// repeated left fragment blocks the junction before any primer is designed.
export function describeEngineeredOverlapFailure(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const { minLength } = engineeredOverlapLengths(rightSequence, thresholds, config);
  return describeBindingWindowFailure(leftSequence, 'reverse', thresholds, minLength, config);
}

export function selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const { minLength, maxTailLength } = engineeredOverlapLengths(rightSequence, thresholds, config);
  const preferredTm = createMidpoint(thresholds?.overlapTm);

  let best = null;
  for (let length = minLength; length <= maxTailLength; length += 1) {
    const overlapSequence = rightSequence.slice(0, length);
    const overlapTm = cloningPrimerTm(overlapSequence);
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
