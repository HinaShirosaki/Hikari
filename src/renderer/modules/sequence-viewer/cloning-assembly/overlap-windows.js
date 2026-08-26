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
    return { best: null, evaluated: 0, absent: 0, repeated: 0 };
  }

  const preferredTm = createMidpoint(thresholds?.primerTm);
  const preferredLength = createMidpoint(thresholds?.primerLength);
  let best = null;
  let evaluated = 0;
  // A window missing from the template and a window that hits it twice are
  // different problems -- the wrong template vs. a repeat -- and only became
  // distinguishable once specificity stopped being checked against the
  // candidate's own sequence.
  let absent = 0;
  let repeated = 0;

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
      if (bindingSiteCount) {
        repeated += 1;
      } else {
        absent += 1;
      }
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

  return { best, evaluated, absent, repeated };
}

export function selectBindingWindow(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  return scanBindingCandidates(sequence, direction, thresholds, tailLength, config).best;
}

// Why no window matched. A repeated or wrong template is the one cause the
// threshold ladder cannot fix, so it must not be reported as a Tm failure.
export function describeBindingWindowFailure(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  const { best, evaluated, absent, repeated } = scanBindingCandidates(sequence, direction, thresholds, tailLength, config);
  if (best || !(absent + repeated)) {
    return '';
  }
  if (absent === evaluated) {
    return 'No candidate window occurs anywhere on the PCR template, so this fragment cannot be amplified from it; relaxing Tm thresholds cannot help. Check that the donor plasmid really carries this sequence, or amplify it from the record it was designed in.';
  }
  if (repeated === evaluated) {
    return 'Every candidate window binds more than one site on the template, so no unique primer exists here; relaxing Tm thresholds cannot help. Move the boundary out of the repeated region or design against a unique flank.';
  }
  const reasons = [
    absent ? `${absent} absent from the template` : '',
    repeated ? `${repeated} binding more than one site on it` : ''
  ].filter(Boolean).join(' and ');
  return `${absent + repeated} of ${evaluated} candidate windows were rejected (${reasons}); the rest missed the Tm or length window.`;
}

function engineeredOverlapLengths(leftSequence, rightSequence, thresholds, config) {
  const maxTotalLength = Math.min(
    leftSequence.length + rightSequence.length,
    // Each primer carries about half, so the cap on one tail no longer caps the
    // seam. Two tails' worth is still the ceiling.
    2 * Math.max(0, (Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength) - Number(thresholds?.primerLength?.min || 0)),
    Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
  );
  return {
    maxTotalLength,
    minLength: Math.min(
      maxTotalLength,
      Math.max(1, Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH)
    )
  };
}

// An engineered overlap needs a binding window on both fragments, so a repeated
// flank blocks the junction before any primer is designed.
export function describeEngineeredOverlapFailure(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const { minLength } = engineeredOverlapLengths(leftSequence, rightSequence, thresholds, config);
  const share = Math.max(1, Math.floor(minLength / 2));
  return describeBindingWindowFailure(leftSequence, 'reverse', thresholds, share, config)
    || describeBindingWindowFailure(rightSequence, 'forward', thresholds, share, config);
}

// A seam that has to be built by primers is normally hung on one primer: the
// left fragment's reverse primer carries the right fragment's start. That fails
// at an AT-rich junction, where the seam needs 35-40 nt to reach Tm and the
// flank needs a 34 nt binding window -- past any orderable oligo, and the
// junction was then reported as having no possible overlap at all. The seam is
// shared by both amplicons, so it can instead be split: part of it is the left
// fragment's own 3' end (added by the right fragment's forward primer) and part
// is the right fragment's 5' start (added by the left fragment's reverse
// primer). One-sided is still tried first, so a junction that already worked
// keeps exactly the primers it had.
export function selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  // The seam sits at the fragment boundary: these are two stretches of one
  // intended construct, so an accidental terminal identity is not a region to
  // merge -- collapsing it would delete those bases from the product.
  const { minLength, maxTotalLength } = engineeredOverlapLengths(leftSequence, rightSequence, thresholds, config);
  const preferredTm = createMidpoint(thresholds?.overlapTm);

  const search = (splitShare) => {
    let best = null;
    for (let added = minLength; added <= maxTotalLength; added += 1) {
      const leftShare = Math.min(leftSequence.length, splitShare(added));
      const rightShare = added - leftShare;
      if (rightShare < 0 || rightShare > rightSequence.length) {
        continue;
      }
      const leftPart = leftSequence.slice(leftSequence.length - leftShare);
      const rightPart = rightSequence.slice(0, rightShare);
      const overlapSequence = `${leftPart}${rightPart}`;
      const overlapTm = cloningPrimerTm(overlapSequence);
      if (overlapTm < thresholds.overlapTm.min || overlapTm > thresholds.overlapTm.max) {
        continue;
      }
      const leftBinding = selectBindingWindow(leftSequence, 'reverse', thresholds, rightShare, config);
      if (!leftBinding) {
        continue;
      }
      const rightBinding = leftShare
        ? selectBindingWindow(rightSequence, 'forward', thresholds, leftShare, config)
        : null;
      if (leftShare && !rightBinding) {
        continue;
      }
      const score = Math.abs(overlapTm - preferredTm) + Math.abs(added - minLength) * 0.1;
      if (!best || score < best.score) {
        best = {
          sequence: overlapSequence,
          length: overlapSequence.length,
          tm: overlapTm,
          gcContent: computeGcContent(overlapSequence),
          leftBinding,
          rightBinding,
          // What each neighbour's primer has to add for the two amplicons to end
          // up sharing this seam.
          leftReverseTail: rightPart,
          rightForwardTail: leftPart,
          score
        };
      }
    }
    return best;
  };

  return search(() => 0) || search((added) => Math.ceil(added / 2));
}
