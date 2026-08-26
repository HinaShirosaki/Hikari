import { reverseComplementDna } from '../calculations/sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { describeBindingWindowFailure, selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, resolveFragmentPrimerTemplate } from './primer-records.js';

export function designRestrictionLigationPrimers(fragmentMap, restrictionEvaluation, thresholds, config) {
  const inserts = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone');
  const selectedSites = asArray(restrictionEvaluation?.selectedSites);
  if (!inserts.length || selectedSites.length < 2) {
    return {
      feasible: false,
      warnings: ['Restriction-ligation primer design requires at least one insert and two selected restriction sites.']
    };
  }

  const insert = inserts[0];
  const clampSequence = normalizeSequence(config?.primerClampSequence || DEFAULT_CLONING_PREFERENCES.primerClampSequence);
  const forwardTail = `${clampSequence}${normalizeSequence(selectedSites[0].site || '')}`;
  const reverseTail = `${clampSequence}${normalizeSequence(selectedSites[1].site || '')}`;
  const forwardBinding = selectBindingWindow(insert.sequence, 'forward', thresholds, forwardTail.length, config);
  const reverseBinding = selectBindingWindow(insert.sequence, 'reverse', thresholds, reverseTail.length, config);

  if (!forwardBinding || !reverseBinding) {
    const missing = forwardBinding ? 'reverse' : 'forward';
    const reason = describeBindingWindowFailure(
      insert.sequence,
      missing,
      thresholds,
      (missing === 'forward' ? forwardTail : reverseTail).length,
      config
    );
    return {
      feasible: false,
      warnings: [`Unable to find insert-binding primer windows compatible with the selected restriction tails.${reason ? ` ${reason}` : ''}`]
    };
  }

  const primers = [
    buildPrimerRecord({
      name: `${insert.name}_F`,
      role: 'restriction-forward',
      sequence: `${forwardTail}${forwardBinding.bindingSequence}`,
      tailSequence: forwardTail,
      bindingSequence: forwardBinding.bindingSequence,
      groupLabel: `${insert.name} PCR`,
      ampliconLength: insert.sequence.length,
      templateId: insert.id,
      warnings: [`Adds ${selectedSites[0].name || selectedSites[0].site} to the 5' end.`]
    }),
    buildPrimerRecord({
      name: `${insert.name}_R`,
      role: 'restriction-reverse',
      sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
      tailSequence: reverseTail,
      bindingSequence: reverseBinding.bindingSequence,
      groupLabel: `${insert.name} PCR`,
      ampliconLength: insert.sequence.length,
      templateId: insert.id,
      warnings: [`Adds ${selectedSites[1].name || selectedSites[1].site} to the 5' end.`]
    })
  ];

  return {
    feasible: true,
    primers,
    warnings: []
  };
}

export function designAssemblyPrimersForRoute(fragments, junctions, thresholds, config) {
  const safeFragments = asArray(fragments);
  const safeJunctions = asArray(junctions);
  const primers = [];
  const warnings = [];

  safeFragments.forEach((fragment, index) => {
    const nextJunction = safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && !junction.wrapAround)
      || safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && junction.wrapAround);
    const previousJunction = safeJunctions.find((junction) => junction.rightFragmentId === fragment.id && !junction.wrapAround)
      || safeJunctions.find((junction) => junction.rightFragmentId === fragment.id && junction.wrapAround);
    const templateDesign = resolveFragmentPrimerTemplate(fragment);
    // Each seam is split between the two primers that meet at it, so this
    // fragment's forward primer carries the previous fragment's 3' end.
    const previousOverlap = previousJunction && previousJunction.mode === 'primer-introduced'
      ? normalizeSequence(previousJunction.rightForwardTail)
      : '';
    const templateForwardAddition = normalizeSequence(templateDesign.forwardAddedSequence);
    const forwardTail = `${previousOverlap}${templateForwardAddition}`;
    const nextOverlap = nextJunction && nextJunction.mode === 'primer-introduced'
      ? normalizeSequence(nextJunction.leftReverseTail)
      : '';
    const reverseTargetTail = `${normalizeSequence(templateDesign.reverseAddedSequence)}${nextOverlap}`;
    const reverseTail = reverseTargetTail ? reverseComplementDna(reverseTargetTail) : '';
    // A fragment amplified from a donor plasmid carries its own specificity
    // template; without one the window is only checked against itself.
    const fragmentConfig = fragment?.metadata?.specificitySequence
      ? {
          ...config,
          specificitySequence: fragment.metadata.specificitySequence,
          specificityCircular: Boolean(fragment.metadata.specificityCircular)
        }
      : config;
    const forwardBinding = selectBindingWindow(templateDesign.templateSequence, 'forward', thresholds, forwardTail.length, fragmentConfig);
    const reverseBinding = selectBindingWindow(templateDesign.templateSequence, 'reverse', thresholds, reverseTail.length, fragmentConfig);

    if (!forwardBinding || !reverseBinding) {
      const missing = forwardBinding ? 'reverse' : 'forward';
      const reason = describeBindingWindowFailure(
        templateDesign.templateSequence,
        missing,
        thresholds,
        (missing === 'forward' ? forwardTail : reverseTail).length,
        fragmentConfig
      );
      warnings.push(`Unable to find compatible binding windows for ${fragment.name}.${reason ? ` ${reason}` : ''}`);
      return;
    }

    const forwardWarnings = [
      ...asArray(templateDesign.warnings),
      templateForwardAddition
        ? `Adds ${templateForwardAddition.length} nt at the 5' end from the primer tail.`
        : '',
      previousOverlap
        ? `Carries ${previousOverlap.length} nt of the ${previousJunction.overlapLength} nt overlap with ${previousJunction.leftFragmentName}.`
        : ''
    ].filter(Boolean);
    const reverseWarnings = [
      normalizeSequence(templateDesign.reverseAddedSequence)
        ? `Adds ${normalizeSequence(templateDesign.reverseAddedSequence).length} nt at the 3' end from the primer tail.`
        : '',
      nextOverlap
        ? `Carries ${nextOverlap.length} nt of the ${nextJunction.overlapLength} nt overlap into ${nextJunction.rightFragmentName}.`
        : ''
    ].filter(Boolean);

    primers.push(
      buildPrimerRecord({
        name: `${fragment.name}_F`,
        role: index === 0 ? 'assembly-forward-start' : 'assembly-forward',
        sequence: `${forwardTail}${forwardBinding.bindingSequence}`,
        tailSequence: forwardTail,
        bindingSequence: forwardBinding.bindingSequence,
        groupLabel: `${fragment.name} PCR`,
        ampliconLength: templateDesign.desiredSequence.length,
        templateId: fragment.id,
        warnings: forwardWarnings
      })
    );
    primers.push(
      buildPrimerRecord({
        name: `${fragment.name}_R`,
        role: nextJunction?.mode === 'primer-introduced' ? 'assembly-reverse-overlap' : 'assembly-reverse',
        sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
        tailSequence: reverseTail,
        bindingSequence: reverseBinding.bindingSequence,
        groupLabel: `${fragment.name} PCR`,
        ampliconLength: templateDesign.desiredSequence.length,
        templateId: fragment.id,
        warnings: reverseWarnings
      })
    );
  });

  if (!primers.length || warnings.length) {
    return {
      feasible: false,
      primers,
      warnings: warnings.length ? warnings : ['Unable to design a complete assembly primer set.']
    };
  }

  return {
    feasible: true,
    primers,
    warnings: []
  };
}
