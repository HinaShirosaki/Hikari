import { CLONING_PRIMER_TM_THRESHOLDS } from './constants.js';
import { asArray } from './sequence-utils.js';
import { buildRouteWarnings, forwardReversePairs } from './primer-records.js';

// Largest Tm gap between any forward/reverse primer pair. Multi-oligo tile primers
// carry no `_F`/`_R` suffix and are excluded by forwardReversePairs — their
// compatibility is governed by the overlap Tm cap, not a forward/reverse pairing.
function maxForwardReverseTmDifference(primers) {
  return forwardReversePairs(primers).reduce(
    (max, group) => Math.max(max, Math.abs(group.F - group.R)),
    0
  );
}

function overlapTmSpread(overlapSummary) {
  const groups = new Map();
  asArray(overlapSummary).forEach((item) => {
    const tm = Number(item?.overlapTm);
    if (!Number.isFinite(tm) || tm <= 0) return;
    const key = item.overlapGroup || 'cloning assembly';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tm);
  });
  // Oligo preparation and downstream assembly are separate reactions with
  // different temperature windows. Balance overlaps within each tube.
  return Math.max(0, ...[...groups.values()].map((tms) => Math.max(...tms) - Math.min(...tms)));
}

// A feasible design from a callback still has to clear the active level's
// Tm-difference caps; otherwise the ladder falls through to a looser level.
function findTmDifferenceViolation(result, thresholds) {
  const maxPrimerDifference = Number(thresholds?.maxPrimerTmDifference);
  if (Number.isFinite(maxPrimerDifference)) {
    const primerDifference = maxForwardReverseTmDifference(result?.primers);
    if (primerDifference > maxPrimerDifference) {
      return { kind: 'primer-pair', spread: primerDifference, cap: maxPrimerDifference };
    }
  }
  const maxOverlapDifference = Number(thresholds?.maxOverlapTmDifference);
  if (Number.isFinite(maxOverlapDifference)) {
    const overlapDifference = overlapTmSpread(result?.overlapSummary);
    if (overlapDifference > maxOverlapDifference) {
      return { kind: 'overlap', spread: overlapDifference, cap: maxOverlapDifference };
    }
  }
  return null;
}

function qualityViolation(result) {
  const blockers = asArray(result?.qualityBlockers).filter(Boolean);
  return blockers.length ? blockers : null;
}

export function designWithThresholdFallback(designCallback) {
  const levels = [
    ['strict', CLONING_PRIMER_TM_THRESHOLDS.strict],
    ['moderate', CLONING_PRIMER_TM_THRESHOLDS.moderate],
    ['relaxed', CLONING_PRIMER_TM_THRESHOLDS.relaxed]
  ];
  const attempts = [];
  let lastTmViolation = null;
  let lastQualityViolation = null;
  let lastResult = null;

  for (const [levelName, thresholds] of levels) {
    const result = designCallback(thresholds, levelName);
    lastResult = result;
    const tmViolation = result?.feasible ? findTmDifferenceViolation(result, thresholds) : null;
    const primerQualityViolation = result?.feasible ? qualityViolation(result) : null;
    const levelFeasible = Boolean(result?.feasible) && !tmViolation && !primerQualityViolation;
    attempts.push({
      level: levelName,
      feasible: levelFeasible,
      warningCount: asArray(result?.warnings).length,
      ...(tmViolation ? { rejectedForTmDifference: true } : {}),
      ...(primerQualityViolation ? { rejectedForPrimerQuality: true } : {})
    });
    if (tmViolation) {
      lastTmViolation = { level: levelName, ...tmViolation };
    }
    if (primerQualityViolation) {
      lastQualityViolation = primerQualityViolation;
      lastResult = {
        ...result,
        warnings: [...new Set([
          ...asArray(result?.warnings),
          ...primerQualityViolation
        ])]
      };
    }
    if (levelFeasible) {
      return {
        ...result,
        feasible: true,
        selectedThresholdLevel: levelName,
        attempts,
        warnings: [...new Set([
          ...asArray(result?.warnings),
          ...asArray(result?.qualityWarnings)
        ].filter(Boolean))]
      };
    }
  }

  return {
    ...lastResult,
    feasible: false,
    selectedThresholdLevel: null,
    attempts,
    warnings: [...new Set([
      ...asArray(lastResult?.warnings),
      // A blocking sequence defect is named first: unlike a Tm miss, no looser
      // threshold level can resolve it, so "failed under all thresholds" would
      // point at the wrong knob.
      lastQualityViolation
        ? 'Every threshold level produced primers with a blocking sequence defect (listed above); loosening Tm limits cannot resolve it. Shift the fragment boundaries or order the fragment by synthesis.'
        : lastTmViolation
          ? `Designed oligos exceeded the ${lastTmViolation.level} ${lastTmViolation.kind} Tm-difference cap (${lastTmViolation.spread.toFixed(1)} °C vs ${lastTmViolation.cap} °C limit) and no looser threshold level produced a balanced set. Consider redesigning fragment boundaries, Gibson assembly, overlap PCR, or synthesis.`
          : 'Primer design failed under strict, moderate, and relaxed thresholds. Consider Gibson assembly, overlap PCR, or synthesis.'
    ].filter(Boolean))]
  };
}

const ROUTE_KEY_BY_STRATEGY = {
  'restriction-ligation': 'restrictionLigation',
  gibson: 'gibson',
  'overlap-pcr': 'overlapPCR',
  'site-directed-mutagenesis': 'siteDirectedMutagenesis'
};

export function buildGlobalWarnings(routeEvaluations, primerPlan, strategyName) {
  const warnings = [];
  const selectedRoute = routeEvaluations?.[ROUTE_KEY_BY_STRATEGY[strategyName]] || null;
  // A successful plan should not read like four simultaneous protocols. Keep
  // its warnings scoped to the route the user can execute; when no route was
  // selected, retain every evaluator's failure details for diagnosis.
  const routeResults = selectedRoute ? [selectedRoute] : Object.values(routeEvaluations || {});
  routeResults.forEach((result) => warnings.push(...buildRouteWarnings(result)));
  warnings.push(...asArray(primerPlan?.warnings));
  if (!strategyName) {
    warnings.push('No feasible assembly strategy was identified from the provided inputs.');
  }
  return [...new Set(warnings.filter(Boolean))];
}

export function buildAlternateStrategyRecommendation(routeEvaluations) {
  const options = [];
  if (routeEvaluations?.restrictionLigation?.feasible) {
    options.push('restriction-ligation');
  }
  if (routeEvaluations?.gibson?.feasible) {
    options.push('Gibson assembly');
  }
  if (routeEvaluations?.overlapPCR?.feasible) {
    options.push('overlap PCR');
  }
  if (routeEvaluations?.siteDirectedMutagenesis?.feasible) {
    options.push('site-directed mutagenesis');
  }
  if (!options.length) {
    return 'Provide a clearer host backbone, fragment order, or edit request to enable route evaluation.';
  }
  return `Consider ${options.join(' or ')} as an alternate route.`;
}

export function chooseAssemblyStrategy({ fragmentMap, routeEvaluations, editRequest, config }) {
  const insertCount = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone').length;
  if (editRequest && routeEvaluations?.siteDirectedMutagenesis?.feasible) {
    return {
      feasible: true,
      name: 'site-directed-mutagenesis',
      reason: 'A local edit is feasible on the selected template backbone.'
    };
  }

  if (
    config?.preferRestrictionLigation !== false
    && insertCount <= 1
    && routeEvaluations?.restrictionLigation?.feasible
  ) {
    return {
      feasible: true,
      name: 'restriction-ligation',
      reason: 'A clean unique restriction site pair is available for a simple host-plus-insert path.'
    };
  }

  if (
    insertCount > 1
    && config?.preferGibsonForMultiFragment !== false
    && routeEvaluations?.gibson?.feasible
  ) {
    return {
      feasible: true,
      name: 'gibson',
      reason: 'Multiple fragments are present and Gibson assembly is feasible across all required junctions.'
    };
  }

  if (routeEvaluations?.gibson?.feasible) {
    return {
      feasible: true,
      name: 'gibson',
      reason: 'Gibson assembly is feasible across the proposed fragment order.'
    };
  }

  if (routeEvaluations?.overlapPCR?.feasible) {
    const downstreamAssemblyMethod = routeEvaluations?.restrictionLigation?.feasible
      ? 'restriction-ligation'
      : (routeEvaluations?.gibson?.feasible ? 'gibson' : null);
    if (downstreamAssemblyMethod) {
      return {
        feasible: true,
        name: 'overlap-pcr',
        downstreamAssemblyMethod,
        reason: 'Insert fragments can be fused by overlap PCR and a downstream backbone insertion method is available.'
      };
    }
  }

  if (routeEvaluations?.restrictionLigation?.feasible) {
    return {
      feasible: true,
      name: 'restriction-ligation',
      reason: 'Restriction-ligation remains the only feasible evaluated route.'
    };
  }

  return {
    feasible: false,
    name: null,
    reason: 'No evaluated assembly route is currently feasible.'
  };
}
