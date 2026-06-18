import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeEditRequest } from './edit-map.js';
import { selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, summarizePrimerPlan } from './primer-records.js';
import { designRestrictionLigationPrimers } from './assembly-primers.js';
import { designAssemblyPrimersForRoute } from './assembly-primers.js';
import { designMutagenesisPrimers } from './mutagenesis.js';
import { designWithThresholdFallback } from './strategy.js';

export function designCloningPrimers(args = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(args?.preferences || {})
  };
  const strategyName = String(args?.strategy || args?.recommendedAssemblyStrategy || '').trim().toLowerCase();
  const fragmentMap = args?.fragmentMap || args?.orderedFragmentMap || null;
  const routeEvaluations = args?.routeEvaluations || {};
  const host = args?.selectedHost || args?.host || null;
  const normalizedEdit = normalizeEditRequest(args?.editRequest, host?.sequence || fragmentMap?.resultSequence || '');

  return designWithThresholdFallback((thresholds) => {
    if (strategyName === 'restriction-ligation') {
      const base = designRestrictionLigationPrimers(
        fragmentMap,
        routeEvaluations?.restrictionLigation || args?.restrictionEvaluation || {},
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers)
      };
    }

    if (strategyName === 'gibson') {
      const base = designAssemblyPrimersForRoute(
        asArray(fragmentMap?.fragments),
        routeEvaluations?.gibson?.junctions,
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, routeEvaluations?.gibson?.junctions)
      };
    }

    if (strategyName === 'overlap-pcr') {
      const insertFragments = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone');
      const base = designAssemblyPrimersForRoute(
        insertFragments,
        routeEvaluations?.overlapPCR?.junctions,
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, routeEvaluations?.overlapPCR?.junctions),
        warnings: [
          ...asArray(base.warnings),
          args?.assembledVectorDesign?.downstreamAssemblyMethod
            ? `Backbone insertion should proceed by ${args.assembledVectorDesign.downstreamAssemblyMethod} after insert fusion.`
            : ''
        ].filter(Boolean)
      };
    }

    if (strategyName === 'site-directed-mutagenesis' && normalizedEdit) {
      const base = designMutagenesisPrimers(host?.sequence || fragmentMap?.resultSequence || '', normalizedEdit, thresholds, config);
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, base.overlapSummary)
      };
    }

    return {
      feasible: false,
      warnings: ['No primer-design route matches the selected assembly strategy.']
    };
  });
}


export function designPcrPrimerPair(sequence, options = {}) {
  const templateSequence = normalizeSequence(sequence);
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(options?.preferences || {})
  };
  const baseName = String(options?.name || '').trim() || 'selection';

  if (!templateSequence.length) {
    return {
      feasible: false,
      primers: [],
      selectedThresholdLevel: null,
      attempts: [],
      warnings: ['Select one or more DNA bases before designing primers.']
    };
  }

  return designWithThresholdFallback((thresholds) => {
    const forwardBinding = selectBindingWindow(templateSequence, 'forward', thresholds, 0, config);
    const reverseBinding = selectBindingWindow(templateSequence, 'reverse', thresholds, 0, config);
    if (!forwardBinding || !reverseBinding) {
      return {
        feasible: false,
        primers: [],
        warnings: ['No forward/reverse PCR primer pair matched the current threshold set for this sequence.']
      };
    }

    const primers = [
      buildPrimerRecord({
        name: `${baseName}_F`,
        role: 'pcr-forward',
        sequence: forwardBinding.bindingSequence,
        bindingSequence: forwardBinding.bindingSequence
      }),
      buildPrimerRecord({
        name: `${baseName}_R`,
        role: 'pcr-reverse',
        sequence: reverseBinding.bindingSequence,
        bindingSequence: reverseBinding.bindingSequence
      })
    ];

    return {
      feasible: true,
      primers,
      warnings: [],
      ...summarizePrimerPlan(primers)
    };
  });
}
