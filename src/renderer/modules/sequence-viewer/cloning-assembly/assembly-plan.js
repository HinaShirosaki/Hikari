import { CLONING_PRIMER_TM_THRESHOLDS, DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeFragment } from './fragments.js';
import { findSelectedHostVector } from './host-vector-selection.js';
import { buildOrderedFragmentMap, normalizeEditRequest } from './edit-map.js';
import { evaluateGibsonAssembly, evaluateOverlapPcr } from './overlap-evaluation.js';
import { evaluateRestrictionLigation } from './restriction-ligation.js';
import { evaluateSiteDirectedMutagenesis } from './site-mutagenesis-evaluation.js';
import { buildAlternateStrategyRecommendation, buildGlobalWarnings, chooseAssemblyStrategy } from './strategy.js';
import { buildAssemblyDesign, buildProcedureSteps, buildValidationPlan } from './procedure.js';
import { designCloningPrimers } from './primer-design.js';

const ROUTE_THRESHOLD_LEVELS = [
  ['strict', CLONING_PRIMER_TM_THRESHOLDS.strict],
  ['moderate', CLONING_PRIMER_TM_THRESHOLDS.moderate],
  ['relaxed', CLONING_PRIMER_TM_THRESHOLDS.relaxed]
];

// Route feasibility climbs the same strict->moderate->relaxed ladder as primer
// design: a junction whose only workable overlap sits in the moderate/relaxed Tm
// band should still let the route through (and carry that level's overlaps into
// primer design) instead of being frozen out at strict. Returns the first feasible
// level, or the relaxed attempt if every level fails.
function evaluateRouteWithFallback(evaluate, fragments, options) {
  let lastResult = null;
  for (const [thresholdLevel, thresholds] of ROUTE_THRESHOLD_LEVELS) {
    const result = { ...evaluate(fragments, { ...options, thresholds }), thresholdLevel };
    if (result.feasible) {
      return result;
    }
    lastResult = result;
  }
  return lastResult;
}

export function assembleCloningPlan(payload = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(payload?.preferences || {})
  };
  const normalizedResultSequence = normalizeSequence(payload?.resultSequence || '');
  const normalizedFragments = asArray(payload?.fragments).map((fragment, index) => normalizeFragment(fragment, index));
  const selectedHost = findSelectedHostVector(payload?.hostVectors, normalizedResultSequence, payload?.hostVectorId);
  const normalizedEdit = normalizeEditRequest(payload?.editRequest, selectedHost?.sequence || normalizedResultSequence || '');
  const orderedFragmentMap = buildOrderedFragmentMap({
    host: selectedHost,
    fragments: normalizedFragments,
    resultSequence: normalizedResultSequence,
    editRequest: normalizedEdit
  });

  const insertFragments = normalizedFragments.filter((fragment) => fragment.type !== 'backbone');
  const assemblyFragments = selectedHost
    ? [
        {
          id: 'host_backbone',
          name: selectedHost.name,
          type: 'backbone',
          sequence: selectedHost.sequence,
          orientation: 'forward',
          metadata: {}
        },
        ...insertFragments
      ]
    : insertFragments;

  const overlapPCR = evaluateRouteWithFallback(evaluateOverlapPcr, insertFragments, {
    preferences: config
  });
  const gibson = evaluateRouteWithFallback(evaluateGibsonAssembly, assemblyFragments, {
    preferences: config,
    circular: Boolean(selectedHost)
  });
  const restrictionLigation = config?.allowRestrictionLigation === false
    ? {
        feasible: false,
        selectedSites: null,
        candidatePairs: [],
        warnings: [],
        reason: 'Restriction-ligation is disabled for this cloning plan.'
      }
      : evaluateRestrictionLigation({
          host: selectedHost,
          fragmentMap: orderedFragmentMap,
          resultSequence: normalizedResultSequence,
          preferences: config
        });
  const siteDirectedMutagenesis = evaluateSiteDirectedMutagenesis({
    host: selectedHost,
    resultSequence: normalizedResultSequence,
    editRequest: normalizedEdit,
    preferences: config
  });

  const routeEvaluations = {
    overlapPCR,
    gibson,
    restrictionLigation,
    siteDirectedMutagenesis
  };

  const recommendedStrategy = chooseAssemblyStrategy({
    fragmentMap: orderedFragmentMap,
    routeEvaluations,
    editRequest: normalizedEdit,
    config
  });
  const assembledVectorDesign = buildAssemblyDesign(
    recommendedStrategy,
    orderedFragmentMap,
    routeEvaluations,
    normalizedResultSequence
  );
  const primerOligoPlan = designCloningPrimers({
    strategy: recommendedStrategy?.name,
    fragmentMap: orderedFragmentMap,
    orderedFragmentMap,
    routeEvaluations,
    selectedHost,
    host: selectedHost,
    editRequest: normalizedEdit,
    preferences: config,
    assembledVectorDesign
  });
  const stepByStepProcedure = buildProcedureSteps(
    recommendedStrategy?.name,
    assembledVectorDesign,
    orderedFragmentMap
  );
  const validationPlan = buildValidationPlan(
    recommendedStrategy?.name,
    orderedFragmentMap
  );
  const warnings = buildGlobalWarnings(routeEvaluations, primerOligoPlan, recommendedStrategy?.name);
  // A plan is only executable if a strategy was selected AND a primer/oligo set
  // could be designed for it under some threshold level. Reporting strategy
  // feasibility alone would surface unbuildable plans (e.g. a sized-ok edit whose
  // mutagenesis primers fail every threshold) as feasible.
  const strategyFeasible = Boolean(recommendedStrategy?.feasible);
  const primersFeasible = Boolean(primerOligoPlan?.feasible);

  return {
    feasible: strategyFeasible && primersFeasible,
    primersFeasible,
    recommendedAssemblyStrategy: recommendedStrategy?.name || null,
    selectedHost: selectedHost
      ? {
          id: selectedHost.id,
          name: selectedHost.name,
          topology: selectedHost.topology,
          sequenceLength: selectedHost.sequence.length
        }
      : null,
    orderedFragmentMap,
    routeEvaluations,
    assembledVectorDesign,
    primerOligoPlan,
    restrictionEnzymeSelection: recommendedStrategy?.name === 'restriction-ligation'
      ? restrictionLigation.selectedSites
      : null,
    expectedJunctionLogic: assembledVectorDesign.junctions || [],
    stepByStepProcedure,
    validationPlan,
    warnings,
    alternateStrategyRecommendation: recommendedStrategy?.feasible
      ? null
      : buildAlternateStrategyRecommendation(routeEvaluations)
  };
}
