import { CLONING_PRIMER_TM_THRESHOLDS } from './constants.js';
import { asArray } from './sequence-utils.js';
import { buildRouteWarnings } from './primer-records.js';

// Largest Tm gap between any forward/reverse primer pair (grouped by the shared
// `<name>_F` / `<name>_R` base). Multi-oligo tile primers carry no `_F`/`_R`
// suffix and are intentionally excluded here — their compatibility is governed by
// the overlap Tm cap, not by a forward/reverse pairing.
function maxForwardReverseTmDifference(primers) {
  const pairs = new Map();
  asArray(primers).forEach((primer) => {
    const match = String(primer?.name || '').match(/^(.*)_([FR])$/);
    if (!match) {
      return;
    }
    const group = pairs.get(match[1]) || {};
    group[match[2]] = Number(primer?.tm) || 0;
    pairs.set(match[1], group);
  });

  let maxDifference = 0;
  pairs.forEach((group) => {
    if (Number.isFinite(group.F) && Number.isFinite(group.R)) {
      maxDifference = Math.max(maxDifference, Math.abs(group.F - group.R));
    }
  });
  return maxDifference;
}

function overlapTmSpread(overlapSummary) {
  const tms = asArray(overlapSummary)
    .map((item) => Number(item?.overlapTm))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (tms.length < 2) {
    return 0;
  }
  return Math.max(...tms) - Math.min(...tms);
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

export function designWithThresholdFallback(designCallback) {
  const levels = [
    ['strict', CLONING_PRIMER_TM_THRESHOLDS.strict],
    ['moderate', CLONING_PRIMER_TM_THRESHOLDS.moderate],
    ['relaxed', CLONING_PRIMER_TM_THRESHOLDS.relaxed]
  ];
  const attempts = [];
  let lastTmViolation = null;

  for (const [levelName, thresholds] of levels) {
    const result = designCallback(thresholds, levelName);
    const tmViolation = result?.feasible ? findTmDifferenceViolation(result, thresholds) : null;
    const levelFeasible = Boolean(result?.feasible) && !tmViolation;
    attempts.push({
      level: levelName,
      feasible: levelFeasible,
      warningCount: asArray(result?.warnings).length,
      ...(tmViolation ? { rejectedForTmDifference: true } : {})
    });
    if (tmViolation) {
      lastTmViolation = { level: levelName, ...tmViolation };
    }
    if (levelFeasible) {
      return {
        ...result,
        feasible: true,
        selectedThresholdLevel: levelName,
        attempts
      };
    }
  }

  return {
    feasible: false,
    selectedThresholdLevel: null,
    attempts,
    warnings: [
      lastTmViolation
        ? `Designed oligos exceeded the ${lastTmViolation.level} ${lastTmViolation.kind} Tm-difference cap (${lastTmViolation.spread.toFixed(1)} °C vs ${lastTmViolation.cap} °C limit) and no looser threshold level produced a balanced set. Consider redesigning fragment boundaries, Gibson assembly, overlap PCR, or synthesis.`
        : 'Primer design failed under strict, moderate, and relaxed thresholds. Consider Gibson assembly, overlap PCR, or synthesis.'
    ]
  };
}

export function buildGlobalWarnings(routeEvaluations, primerPlan, strategyName) {
  const warnings = [];
  Object.values(routeEvaluations || {}).forEach((result) => {
    warnings.push(...buildRouteWarnings(result));
  });
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
