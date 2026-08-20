import { cloningPrimerTm } from '../calculations/oligo.js';
import {
  CLONING_PRIMER_TM_THRESHOLDS,
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_GIBSON_MIN_FRAGMENT_COUNT,
  DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT
} from './constants.js';
import { asArray, computeGcContent } from './sequence-utils.js';
import { normalizeFragment } from './fragments.js';
import {
  describeEngineeredOverlapFailure,
  longestTerminalOverlap,
  selectEngineeredOverlap
} from './overlap-windows.js';

export function evaluateJunction(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const natural = longestTerminalOverlap(leftFragment?.sequence || '', rightFragment?.sequence || '');
  const naturalTm = natural.length ? cloningPrimerTm(natural.sequence) : 0;
  const naturalGc = natural.length ? computeGcContent(natural.sequence) : 0;
  if (
    natural.length
    && naturalTm >= thresholds.overlapTm.min
  ) {
    return {
      feasible: true,
      mode: 'existing',
      overlapSequence: natural.sequence,
      overlapLength: natural.length,
      overlapTm: naturalTm,
      overlapGcContent: naturalGc,
      warnings: []
    };
  }

  const engineered = selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config);
  if (engineered) {
    const warnings = [];
    if (natural.length && naturalTm < thresholds.overlapTm.min) {
      warnings.push('Existing terminal overlap is too weak; engineered primer overlap is recommended.');
    } else if (!natural.length) {
      warnings.push('No terminal overlap is present; a primer-introduced overlap is required.');
    }
    return {
      feasible: true,
      mode: 'primer-introduced',
      overlapSequence: engineered.sequence,
      overlapLength: engineered.length,
      overlapTm: engineered.tm,
      overlapGcContent: engineered.gcContent,
      leftBindingTm: engineered.leftBinding?.tm || 0,
      warnings
    };
  }

  return {
    feasible: false,
    mode: natural.length ? 'weak-existing' : 'missing',
    overlapSequence: natural.sequence,
    overlapLength: natural.length,
    overlapTm: naturalTm,
    overlapGcContent: naturalGc,
    warnings: [
      natural.length
        ? 'Existing overlap does not reach the required Tm range and no primer-compatible engineered overlap was found.'
        : 'No terminal overlap is present and no primer-compatible engineered overlap was found.',
      describeEngineeredOverlapFailure(leftFragment, rightFragment, thresholds, config)
    ].filter(Boolean)
  };
}

export function buildJunctionPairs(fragments, circular = false) {
  const list = asArray(fragments);
  const pairs = [];
  if (list.length < 2) {
    return pairs;
  }
  for (let index = 0; index < list.length - 1; index += 1) {
    pairs.push({
      left: list[index],
      right: list[index + 1],
      wrapAround: false
    });
  }
  if (circular) {
    pairs.push({
      left: list[list.length - 1],
      right: list[0],
      wrapAround: true
    });
  }
  return pairs;
}

export function evaluateFragmentAssembly(fragments, options = {}) {
  const normalizedFragments = asArray(fragments).map((fragment, index) => normalizeFragment(fragment, index));
  const circular = Boolean(options?.circular);
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(options?.preferences || {})
  };
  const thresholds = options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict;
  const pairs = buildJunctionPairs(normalizedFragments, circular);
  const junctions = pairs.map((pair) => {
    const evaluation = evaluateJunction(pair.left, pair.right, thresholds, config);
    return {
      leftFragmentId: pair.left.id,
      leftFragmentName: pair.left.name,
      rightFragmentId: pair.right.id,
      rightFragmentName: pair.right.name,
      wrapAround: pair.wrapAround,
      ...evaluation
    };
  });

  const warnings = junctions.flatMap((junction) => asArray(junction.warnings));
  return {
    fragments: normalizedFragments,
    junctions,
    feasible: junctions.length > 0 && junctions.every((junction) => junction.feasible),
    warnings
  };
}


export function evaluateOverlapPcr(fragments, options = {}) {
  const evaluation = evaluateFragmentAssembly(fragments, {
    ...options,
    circular: false,
    thresholds: options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict
  });
  return {
    feasible: evaluation.fragments.length >= DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT && evaluation.feasible,
    fragmentOrder: evaluation.fragments.map((fragment) => fragment.id),
    junctions: evaluation.junctions,
    warnings: evaluation.warnings,
    failureReasons: evaluation.feasible
      ? []
      : ['At least one fragment junction lacks a usable natural or primer-introduced overlap.']
  };
}

export function evaluateGibsonAssembly(fragments, options = {}) {
  const evaluation = evaluateFragmentAssembly(fragments, {
    ...options,
    circular: Boolean(options?.circular),
    thresholds: options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict
  });
  return {
    feasible: evaluation.fragments.length >= DEFAULT_GIBSON_MIN_FRAGMENT_COUNT && evaluation.feasible,
    fragmentOrder: evaluation.fragments.map((fragment) => fragment.id),
    junctions: evaluation.junctions,
    warnings: evaluation.warnings,
    failureReasons: evaluation.feasible
      ? []
      : ['One or more Gibson junctions could not reach the required overlap window with the current fragment set.']
  };
}
