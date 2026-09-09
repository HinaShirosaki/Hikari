import { assembleCloningPlan } from '../cloning-assembly.js';
import { buildMegaprimerRestrictionPlan } from '../cloning-assembly/megaprimer-restriction.js';
import { buildQ5KldPlan } from '../cloning-assembly/q5-kld-mutagenesis.js';
import { buildGoldenGatePlan } from '../cloning-assembly/golden-gate.js';
import { buildOverlapExtensionLigationPlan } from '../cloning-assembly/overlap-extension-ligation.js';
import { clamp, cleanText, normalizeSequenceText } from '../shared.js';
import { describeEditTarget, renamePrimers } from '../primer-naming.js';
import { asArray } from '../../../lib/normalize.js';
import { buildLinearizedBackbone, extractOriginalTemplateForEditedRange } from './edit-ranges.js';
import { IN_FUSION_PROCEDURE, STRATEGY_GIBSON, STRATEGY_GOLDEN_GATE, STRATEGY_IN_FUSION, STRATEGY_OVERLAP_EXTENSION, STRATEGY_Q5_KLD, STRATEGY_TWO_STEP_LIGATION, STRATEGY_WHOLE_PLASMID } from './strategies.js';

function buildWholePlasmidPlan(source = {}, record = {}) {
  const templateSequence = normalizeSequenceText(source?.originalSequence || '');
  const resultSequence = normalizeSequenceText(record?.sequence || source?.editedSequence || '');
  if (!templateSequence.length || !resultSequence.length) {
    return null;
  }

  return assembleCloningPlan({
    hostVectors: [
      {
        id: 'edited_template_plasmid',
        name: cleanText(source?.recordName || record?.name, 160) || 'Template plasmid',
        topology: cleanText(record?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
        sequence: templateSequence
      }
    ],
    hostVectorId: 'edited_template_plasmid',
    fragments: [],
    resultSequence,
    editRequest: source?.editRequest,
    preferences: {
      allowRestrictionLigation: false,
      preferRestrictionLigation: false,
      preferGibsonForMultiFragment: false
    }
  });
}

function buildInsertAssemblyPlan(source = {}, record = {}, range = {}, strategy, donor = null, preferenceOverrides = {}) {
  const sequence = normalizeSequenceText(record?.sequence || source?.editedSequence || '');
  const sequenceLength = sequence.length;
  if (!sequenceLength) {
    return null;
  }

  const start = clamp(Math.round(Number(range?.start) || 0), 0, sequenceLength - 1);
  const end = clamp(Math.round(Number(range?.end) || start + 1), start + 1, sequenceLength);
  const insertSequence = sequence.slice(start, end);
  // A gene amplified from another plasmid is a PCR off that donor, not off this
  // record: the donor is what the primers anneal to, and what their specificity
  // has to be checked against.
  const donorSequence = normalizeSequenceText(donor?.sequence || '');
  const originalSequence = normalizeSequenceText(source?.originalSequence || '');
  const templateSequence = donorSequence
    || extractOriginalTemplateForEditedRange(source, start, end);
  const backboneSequence = buildLinearizedBackbone(sequence, start, end);
  // The backbone amplicon is PCR'd off the intact pre-edit vector, which still
  // carries whatever sat at the edit site and still wraps at the origin. Judging
  // backbone primers against the linearized backbone alone passed a primer that
  // also binds inside the removed region, or across the origin, as unique.
  const vectorTemplateSequence = normalizeSequenceText(source?.originalSequence || '');

  if (!insertSequence.length || !backboneSequence.length) {
    return null;
  }

  const isGibson = strategy === STRATEGY_GIBSON;
  return assembleCloningPlan({
    hostVectors: [
      {
        id: 'edited_linearized_backbone',
        name: `${cleanText(record?.name || source?.recordName, 120) || 'Vector'} backbone`,
        topology: 'linear',
        sequence: backboneSequence,
        metadata: vectorTemplateSequence
          ? {
              specificitySequence: vectorTemplateSequence,
              specificityCircular: cleanText(record?.topology, 40).toLowerCase() !== 'linear'
            }
          : {}
      }
    ],
    hostVectorId: 'edited_linearized_backbone',
    fragments: [
      {
        id: 'edited_amplicon',
        // The donor belongs in templateName, not in the fragment name, or the
        // procedure reads "amplify pDonor amplicon off pDonor".
        name: donorSequence ? 'Insert amplicon' : 'Edited amplicon',
        type: 'insert',
        sequence: insertSequence,
        metadata: {
          source: donorSequence ? 'donor_plasmid' : 'sequence_viewer_edit',
          templateSequence,
          templateName: donorSequence ? cleanText(donor?.name, 120) : '',
          // Uniqueness is judged over the whole donor, since that is the DNA in
          // the tube -- a primer unique to the gene can still prime elsewhere.
          specificitySequence: donorSequence || originalSequence,
          specificityCircular: cleanText(donorSequence ? donor?.topology : record?.topology, 40).toLowerCase() !== 'linear'
        }
      }
    ],
    resultSequence: sequence,
    preferences: isGibson
      ? {
          allowRestrictionLigation: false,
          preferRestrictionLigation: false,
          preferGibsonForMultiFragment: true,
          ...preferenceOverrides
        }
      : {
          allowRestrictionLigation: true,
          preferRestrictionLigation: true,
          preferGibsonForMultiFragment: false,
          ...preferenceOverrides
        }
  });
}

function planPrimers(plan = {}, groupLabel = '') {
  return asArray(plan?.primerOligoPlan?.primers).map((primer) => ({
    ...primer,
    groupLabel: cleanText(primer?.groupLabel, 120) || groupLabel
  }));
}

function collectWarnings(...plans) {
  const warnings = [];
  plans.forEach((plan) => {
    asArray(plan?.warnings).forEach((warning) => {
      if (warning && !warnings.includes(warning)) {
        warnings.push(warning);
      }
    });
    asArray(plan?.primerOligoPlan?.warnings).forEach((warning) => {
      if (warning && !warnings.includes(warning)) {
        warnings.push(warning);
      }
    });
  });
  return warnings;
}

function firstEnzymeName(displayPlan = {}) {
  const selection = asArray(displayPlan?.plans)
    .map((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .find((entry) => entry.length) || [];
  return cleanText(selection[0]?.name, 40);
}

// Route names ("mutagenesis_F", "gg_backbone_R") become bench names once the
// record is known: "MPM2 A34J F", "BsaI vector R".
function buildDisplayPlan(args = {}) {
  const { source, record } = args;
  const displayPlan = buildRoutePlan(args);
  const { gene, mutation } = describeEditTarget({
    record,
    originalSequence: source?.originalSequence,
    editRequest: source?.editRequest
  });
  return {
    ...displayPlan,
    primers: renamePrimers(displayPlan.primers, {
      gene,
      mutation,
      targetLabel: gene,
      enzyme: firstEnzymeName(displayPlan),
      backboneNames: [`${cleanText(record?.name || source?.recordName, 120) || 'Vector'} backbone`]
    })
  };
}

function buildRoutePlan({ strategy, source, record, range, donor }) {
  if (strategy === STRATEGY_WHOLE_PLASMID) {
    const wholePlasmidPlan = buildWholePlasmidPlan(source, record);
    return {
      strategy,
      feasible: Boolean(wholePlasmidPlan?.feasible),
      plans: [{ label: 'Whole plasmid amplification', plan: wholePlasmidPlan }],
      primers: planPrimers(wholePlasmidPlan, 'Whole plasmid PCR'),
      warnings: collectWarnings(wholePlasmidPlan),
      summary: {
        templateLength: normalizeSequenceText(source?.originalSequence || '').length,
        resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length
      }
    };
  }

  if (strategy === STRATEGY_Q5_KLD) {
    return {
      strategy,
      ...buildQ5KldPlan({
        originalSequence: source?.originalSequence,
        editedSequence: record?.sequence || source?.editedSequence,
        editRequest: source?.editRequest,
        recordName: source?.recordName || record?.name,
        topology: record?.topology
      })
    };
  }

  if (strategy === STRATEGY_TWO_STEP_LIGATION) {
    return {
      strategy,
      ...buildMegaprimerRestrictionPlan({
        originalSequence: source?.originalSequence,
        editedSequence: record?.sequence || source?.editedSequence,
        editRequest: source?.editRequest,
        recordName: source?.recordName || record?.name,
        topology: record?.topology
      })
    };
  }

  if (strategy === STRATEGY_OVERLAP_EXTENSION) {
    const sequence = normalizeSequenceText(record?.sequence || source?.editedSequence || '');
    const insertStart = clamp(Math.round(Number(range?.start) || 0), 0, Math.max(0, sequence.length - 1));
    const insertEnd = clamp(Math.round(Number(range?.end) || insertStart), insertStart, sequence.length);
    return {
      strategy,
      ...buildOverlapExtensionLigationPlan({
        sequence,
        range,
        recordName: source?.recordName || record?.name,
        topology: record?.topology,
        // The flanks are amplified off the vector as it is today, before the
        // insert was placed into it.
        vectorSequence: source?.originalSequence,
        insertTemplate: extractOriginalTemplateForEditedRange(source, insertStart, insertEnd),
        insertTemplateHostSequence: source?.originalSequence,
        insertTemplateCircular: cleanText(record?.topology, 40).toLowerCase() !== 'linear',
        donor
      })
    };
  }

  if (strategy === STRATEGY_GOLDEN_GATE) {
    const insertStart = Math.max(0, Math.round(Number(range?.start) || 0));
    const insertEnd = Math.max(insertStart, Math.round(Number(range?.end) || insertStart));
    const insertTemplateSequence = extractOriginalTemplateForEditedRange(source, insertStart, insertEnd);
    return {
      strategy,
      ...buildGoldenGatePlan({
        sequence: record?.sequence || source?.editedSequence,
        range,
        recordName: source?.recordName || record?.name,
        topology: record?.topology,
        vectorTemplateSequence: source?.originalSequence,
        insertTemplateSequence,
        insertTemplateHostSequence: source?.originalSequence,
        insertTemplateName: source?.recordName || record?.name,
        insertTemplateCircular: cleanText(record?.topology, 40).toLowerCase() !== 'linear',
        donor
      })
    };
  }

  // In-Fusion reuses the Gibson homology-overlap primers; only the bench
  // procedure differs (one In-Fusion reaction vs. exonuclease + ligase).
  if (strategy === STRATEGY_IN_FUSION) {
    const inFusionAssembly = buildInsertAssemblyPlan(source, record, range, STRATEGY_GIBSON, donor, {
      minEngineeredOverlapLength: 15,
      maxEngineeredOverlapLength: 21,
      overlapTmRange: { min: 45, max: 75 },
      allowExistingTerminalOverlap: false
    });
    const plan = inFusionAssembly
      ? { ...inFusionAssembly, stepByStepProcedure: IN_FUSION_PROCEDURE }
      : inFusionAssembly;
    return {
      strategy,
      feasible: Boolean(plan?.feasible),
      plans: [{ label: 'In-Fusion assembly', plan }],
      primers: planPrimers(plan, 'In-Fusion'),
      warnings: collectWarnings(plan),
      summary: {
        templateLength: normalizeSequenceText(source?.originalSequence || '').length,
        resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length,
        insertLength: Math.max(0, Number(range?.end) - Number(range?.start))
      }
    };
  }

  const assemblyPlan = buildInsertAssemblyPlan(source, record, range, strategy, donor);
  return {
    strategy,
    feasible: Boolean(assemblyPlan?.feasible),
    plans: [{ label: 'Gibson assembly', plan: assemblyPlan }],
    primers: planPrimers(assemblyPlan, 'Gibson assembly'),
    warnings: collectWarnings(assemblyPlan),
    summary: {
      templateLength: normalizeSequenceText(source?.originalSequence || '').length,
      resultLength: normalizeSequenceText(record?.sequence || source?.editedSequence || '').length,
      insertLength: Math.max(0, Number(range?.end) - Number(range?.start))
    }
  };
}

export {
  buildDisplayPlan
};
