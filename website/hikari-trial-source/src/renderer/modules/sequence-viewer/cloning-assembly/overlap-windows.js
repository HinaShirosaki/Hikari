import { reverseComplementDna } from '../calculations/sequence.js';
import { cloningPrimerTm } from '../calculations/oligo.js';
import {
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH,
  DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH
} from './constants.js';
import { computeGcContent, createMidpoint, normalizeSequence } from './sequence-utils.js';
import { countPrimerBindingSites } from './primer-quality.js';
import { fragmentPrimerConfig, resolveFragmentPrimerTemplate } from './primer-records.js';

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
  const scan = scanBindingCandidates(sequence, direction, thresholds, tailLength, config);
  // `absent` can only be non-zero when the window was checked against a template
  // the caller declared -- the donor plasmid the user picked in Vector Builder or
  // Protein Builder. That copy going stale, or carrying the feature annotated on
  // the other strand, must not veto a design the bench can run, so the design
  // proceeds off the assembled sequence and says what the check found. A purely
  // repeated template is left blocking: it really would give two PCR products,
  // and no note makes that work.
  if (scan.best || !scan.absent) {
    return scan.best;
  }
  const relaxed = scanBindingCandidates(sequence, direction, thresholds, tailLength, {
    ...config,
    requireUniqueBinding: false
  });
  return relaxed.best
    ? {
        ...relaxed.best,
        specificityWarning: 'No primer window for this fragment occurs on the stated PCR template, so the primers were designed off the assembled sequence. Confirm the template really carries it before ordering.'
      }
    : null;
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
    minLength: Math.max(1, Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH)
  };
}

// An engineered overlap needs a binding window on both fragments, so a repeated
// flank blocks the junction before any primer is designed.
export function describeEngineeredOverlapFailure(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const left = resolveFragmentPrimerTemplate(leftFragment);
  const right = resolveFragmentPrimerTemplate(rightFragment);
  return describeBindingWindowFailure(left.templateSequence, 'reverse', thresholds, left.reverseAddedSequence.length, fragmentPrimerConfig(leftFragment, config))
    || describeBindingWindowFailure(right.templateSequence, 'forward', thresholds, right.forwardAddedSequence.length, fragmentPrimerConfig(rightFragment, config));
}

// Search junctions in the intended product. Template cores only determine the
// annealing windows and how much of each oligo is already occupied by additions.
export function selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const leftTemplate = resolveFragmentPrimerTemplate(leftFragment);
  const rightTemplate = resolveFragmentPrimerTemplate(rightFragment);
  const leftConfig = fragmentPrimerConfig(leftFragment, config);
  const rightConfig = fragmentPrimerConfig(rightFragment, config);
  const { minLength, maxTotalLength } = engineeredOverlapLengths(leftSequence, rightSequence, thresholds, config);
  const preferredTm = createMidpoint(thresholds?.overlapTm);
  // Cache by added-tail length: the same PCR window serves many candidate seams.
  const leftBindings = new Map();
  const rightBindings = new Map();
  const binding = (cache, template, direction, added, fragmentConfig) => {
    if (!cache.has(added)) {
      const nativeAddition = direction === 'reverse' ? template.reverseAddedSequence : template.forwardAddedSequence;
      cache.set(added, selectBindingWindow(template.templateSequence, direction, thresholds, added + nativeAddition.length, fragmentConfig));
    }
    return cache.get(added);
  };
  const search = (oneSided) => {
    let best = null;
    for (let length = minLength; length <= maxTotalLength; length += 1) {
      const maxLeft = oneSided ? 0 : Math.min(leftSequence.length, length);
      for (let leftShare = oneSided ? 0 : 1; leftShare <= maxLeft; leftShare += 1) {
        const rightShare = length - leftShare;
        if (rightShare > rightSequence.length) {
          continue;
        }
        const leftPart = leftSequence.slice(leftSequence.length - leftShare);
        const rightPart = rightSequence.slice(0, rightShare);
        const sequence = `${leftPart}${rightPart}`;
        const tm = cloningPrimerTm(sequence);
        if (tm < thresholds.overlapTm.min || tm > thresholds.overlapTm.max) {
          continue;
        }
        const leftBinding = binding(leftBindings, leftTemplate, 'reverse', rightShare, leftConfig);
        const rightBinding = binding(rightBindings, rightTemplate, 'forward', leftShare, rightConfig);
        if (!leftBinding || !rightBinding) {
          continue;
        }
        const score = Math.abs(tm - preferredTm) + (length - minLength) * 0.1;
        if (!best || score < best.score) {
          best = {
            sequence, length, tm, gcContent: computeGcContent(sequence),
            leftBinding, rightBinding, leftReverseTail: rightPart,
            rightForwardTail: leftPart,
            leftReverseTargetTail: `${leftTemplate.reverseAddedSequence}${rightPart}`,
            rightForwardTargetTail: `${leftPart}${rightTemplate.forwardAddedSequence}`,
            score
          };
        }
      }
    }
    return best;
  };
  // Preserve a working one-sided design, then try every split (including a
  // complete tail on the other primer), not just an arbitrary 50/50 split.
  const anchored = search(true) || search(false);
  if (anchored) {
    return anchored;
  }

  // The desired-fragment boundary is not a physical PCR boundary when it
  // falls in added DNA. Search the whole gap between the two template cores:
  // one primer can supply its prefix and the other its suffix, with a shared
  // window in between. Keeping the entire addition on its original fragment
  // can exceed that primer's budget even though these two tails fit together.
  const flank = `${leftTemplate.reverseAddedSequence}${rightTemplate.forwardAddedSequence}`;
  const maxPrimerLength = Number(config.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength;
  const maxTailLength = maxPrimerLength - thresholds.primerLength.min;
  if (!flank.length || flank.length + minLength > 2 * maxTailLength) {
    return null;
  }
  const leftCore = leftTemplate.templateSequence.slice(-maxTotalLength);
  const rightCore = rightTemplate.templateSequence.slice(0, maxTotalLength);
  const context = `${leftCore}${flank}${rightCore}`;
  const flankStart = leftCore.length;
  const flankEnd = flankStart + flank.length;
  const originalBoundary = flankStart + leftTemplate.reverseAddedSequence.length;
  // The existing cache accounts for original additions; shifted tails need
  // their complete lengths instead.
  leftBindings.clear();
  rightBindings.clear();
  const shiftedBinding = (cache, template, direction, tail, fragmentConfig) => {
    if (!cache.has(tail.length)) {
      cache.set(tail.length, selectBindingWindow(template.templateSequence, direction, thresholds, tail.length, fragmentConfig));
    }
    return cache.get(tail.length);
  };
  let best = null;
  for (let length = minLength; length <= maxTotalLength; length += 1) {
    for (let start = Math.max(0, flankStart - length); start <= Math.min(flankEnd, context.length - length); start += 1) {
      const end = start + length;
      const leftTail = context.slice(flankStart, Math.max(flankStart, end));
      const rightTail = context.slice(Math.min(start, flankEnd), flankEnd);
      if (leftTail.length > maxTailLength || rightTail.length > maxTailLength) {
        continue;
      }
      const sequence = context.slice(start, end);
      const tm = cloningPrimerTm(sequence);
      if (tm < thresholds.overlapTm.min || tm > thresholds.overlapTm.max) {
        continue;
      }
      const leftBinding = shiftedBinding(leftBindings, leftTemplate, 'reverse', leftTail, leftConfig);
      const rightBinding = shiftedBinding(rightBindings, rightTemplate, 'forward', rightTail, rightConfig);
      if (!leftBinding || !rightBinding) {
        continue;
      }
      const score = Math.abs(tm - preferredTm) + (length - minLength) * 0.1
        + Math.max(leftTail.length + leftBinding.length, rightTail.length + rightBinding.length) * 0.05;
      if (!best || score < best.score) {
        const split = Math.max(start, Math.min(end, originalBoundary));
        best = {
          sequence, length, tm, gcContent: computeGcContent(sequence), leftBinding, rightBinding,
          leftReverseTail: context.slice(split, end), rightForwardTail: context.slice(start, split),
          leftReverseTargetTail: leftTail, rightForwardTargetTail: rightTail,
          redistributedFlankLength: flank.length, score
        };
      }
    }
  }
  return best;
}
