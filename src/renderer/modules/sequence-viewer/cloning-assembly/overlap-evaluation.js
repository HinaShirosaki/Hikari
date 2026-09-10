import { cloningPrimerTm } from '../calculations/oligo.js';
import {
  CLONING_PRIMER_TM_THRESHOLDS,
  DEFAULT_CLONING_PREFERENCES,
  DEFAULT_GIBSON_MIN_FRAGMENT_COUNT,
  DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT
} from './constants.js';
import { asArray, computeGcContent, describeAmbiguousDna, normalizeSequence } from './sequence-utils.js';
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
  const naturalOverlapIsDeclared = config?.allowExistingTerminalOverlap === true
    || leftFragment?.metadata?.sharedOverlapWithNext === true
    || rightFragment?.metadata?.sharedOverlapWithPrevious === true;
  const minDeliberateOverlap = config?.minEngineeredOverlapLength
    || DEFAULT_CLONING_PREFERENCES.minEngineeredOverlapLength;
  // Extending an already shared region as though the fragments were disjoint
  // duplicates that region in the product. Require new boundaries instead.
  if (naturalOverlapIsDeclared && natural.length && (
    natural.length < minDeliberateOverlap
    || naturalTm < thresholds.overlapTm.min
    || naturalTm > thresholds.overlapTm.max
  )) {
    return {
      feasible: false, mode: 'weak-existing', overlapSequence: natural.sequence,
      overlapLength: natural.length, overlapTm: naturalTm, overlapGcContent: naturalGc,
      warnings: ['Declared shared overlap is outside the required length or Tm range. Adjust the fragment boundaries before primer design.']
    };
  }
  if (
    naturalOverlapIsDeclared
    && natural.length
    && naturalTm >= thresholds.overlapTm.min
    && naturalTm <= thresholds.overlapTm.max
  ) {
    return {
      feasible: true,
      mode: 'existing',
      overlapSequence: natural.sequence,
      overlapLength: natural.length,
      overlapTm: naturalTm,
      overlapGcContent: naturalGc,
      // Already shared by both fragments; neither primer adds anything.
      leftReverseTail: '',
      rightForwardTail: '',
      warnings: []
    };
  }

  const engineered = selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config);
  if (engineered) {
    const warnings = [];
    if (!naturalOverlapIsDeclared && natural.length >= minDeliberateOverlap) {
      // Only a match long enough to have been designed is worth reporting. Two
      // fragments cut from one sequence share their boundary base a quarter of
      // the time; saying so on every such junction is noise, not provenance.
      warnings.push('Matching terminal bases were treated as separate intended sequence, not collapsed as a shared overlap; set explicit shared-overlap metadata only when both fragments physically contain that overlap.');
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
      // Record the exact split used by the two flanking primers.
      leftReverseTail: engineered.leftReverseTail,
      rightForwardTail: engineered.rightForwardTail,
      warnings
    };
  }

  return {
    feasible: false,
    mode: naturalOverlapIsDeclared && natural.length ? 'weak-existing' : 'missing',
    overlapSequence: natural.sequence,
    overlapLength: natural.length,
    overlapTm: naturalTm,
    overlapGcContent: naturalGc,
    warnings: [
      naturalOverlapIsDeclared && natural.length
        ? 'Declared existing overlap is outside the required Tm range and no primer-compatible engineered overlap was found.'
        : natural.length
          ? 'Matching terminal bases were not declared as a physically shared overlap, and no primer-compatible engineered overlap was found.'
          : 'No terminal overlap is present and no primer-compatible engineered overlap was found.',
      describeEngineeredOverlapFailure(leftFragment, rightFragment, thresholds, config)
    ].filter(Boolean)
  };
}

function buildJunctionPairs(fragments, circular = false) {
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
  const ambiguityWarnings = asArray(fragments).flatMap((fragment, index) => [
    describeAmbiguousDna(fragment?.sequence, `Fragment ${fragment?.name || index + 1}`),
    describeAmbiguousDna(
      fragment?.templateSequence || fragment?.metadata?.templateSequence,
      `Template for ${fragment?.name || index + 1}`
    ),
    describeAmbiguousDna(
      fragment?.metadata?.specificitySequence,
      `Specificity template for ${fragment?.name || index + 1}`
    )
  ]).filter(Boolean);
  if (ambiguityWarnings.length) {
    return {
      fragments: [],
      junctions: [],
      feasible: false,
      warnings: ambiguityWarnings
    };
  }
  const normalizedFragments = asArray(fragments).map((fragment, index) => normalizeFragment(fragment, index));
  if (normalizedFragments.some((fragment) => !fragment.sequence.length)
    || new Set(normalizedFragments.map((fragment) => fragment.id)).size !== normalizedFragments.length) {
    return { fragments: normalizedFragments, junctions: [], feasible: false, warnings: ['Each assembly fragment must have a nonempty sequence and a unique ID.'] };
  }
  const circular = Boolean(options?.circular);
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(options?.preferences || {})
  };
  const baseThresholds = options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict;
  const thresholds = config?.overlapTmRange
    ? { ...baseThresholds, overlapTm: { ...config.overlapTmRange } }
    : baseThresholds;
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
  const resultSequence = normalizeSequence(options?.resultSequence);
  let product = normalizedFragments.map((fragment, index) => {
    const previous = junctions.find((junction) => junction.rightFragmentId === fragment.id && !junction.wrapAround);
    return index && previous?.mode === 'existing' ? fragment.sequence.slice(previous.overlapLength) : fragment.sequence;
  }).join('');
  const closing = junctions.find((junction) => junction.wrapAround && junction.mode === 'existing');
  if (closing) {
    product = product.slice(0, product.length - closing.overlapLength);
  }
  const productMatches = !resultSequence || (product.length === resultSequence.length && (
    circular ? `${product}${product}`.includes(resultSequence) : product === resultSequence
  ));
  if (!productMatches) {
    warnings.push('The chosen fragment order does not reconstruct the assembled sequence. Check the fragment boundaries and orientation.');
  }
  return {
    fragments: normalizedFragments,
    junctions,
    feasible: productMatches && junctions.length > 0 && junctions.every((junction) => junction.feasible),
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
