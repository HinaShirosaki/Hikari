import { CLONING_PRIMER_TM_THRESHOLDS } from './constants.js';
import { asArray } from './sequence-utils.js';
import { buildRouteWarnings } from './primer-records.js';

export function designWithThresholdFallback(designCallback) {
  const levels = [
    ['strict', CLONING_PRIMER_TM_THRESHOLDS.strict],
    ['moderate', CLONING_PRIMER_TM_THRESHOLDS.moderate],
    ['relaxed', CLONING_PRIMER_TM_THRESHOLDS.relaxed]
  ];
  const attempts = [];

  for (const [levelName, thresholds] of levels) {
    const result = designCallback(thresholds, levelName);
    attempts.push({
      level: levelName,
      feasible: Boolean(result?.feasible),
      warningCount: asArray(result?.warnings).length
    });
    if (result?.feasible) {
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
      'Primer design failed under strict, moderate, and relaxed thresholds. Consider Gibson assembly, overlap PCR, or synthesis.'
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
