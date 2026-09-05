import { reverseComplementDna } from '../calculations/sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { describeBindingWindowFailure, selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, resolveFragmentPrimerTemplate } from './primer-records.js';
import { resolveRestrictionRecognitionSequence } from './restriction-ligation.js';

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
  const host = asArray(fragmentMap?.fragments).find((fragment) => fragment.role === 'backbone');
  const templateDesign = resolveFragmentPrimerTemplate(insert);
  if (templateDesign.feasible === false) {
    return {
      feasible: false,
      primers: [],
      warnings: asArray(templateDesign.blockingWarnings || templateDesign.warnings)
    };
  }
  const clampSequence = normalizeSequence(config?.primerClampSequence || DEFAULT_CLONING_PREFERENCES.primerClampSequence);
  const forwardSite = resolveRestrictionRecognitionSequence(selectedSites[0], host?.sequence || '');
  const reverseSite = resolveRestrictionRecognitionSequence(selectedSites[1], host?.sequence || '');
  if (!forwardSite || !reverseSite) {
    return {
      feasible: false,
      warnings: ['The selected restriction recognition sequence could not be resolved to concrete A/C/G/T bases on the host; choose another enzyme pair.']
    };
  }
  const forwardAddition = normalizeSequence(templateDesign.forwardAddedSequence);
  const reverseAddition = normalizeSequence(templateDesign.reverseAddedSequence);
  const forwardTail = `${clampSequence}${forwardSite}${forwardAddition}`;
  const reverseTail = `${clampSequence}${reverseSite}${reverseComplementDna(reverseAddition)}`;
  const fragmentConfig = insert?.metadata?.specificitySequence
    ? {
        ...config,
        specificitySequence: insert.metadata.specificitySequence,
        specificityCircular: Boolean(insert.metadata.specificityCircular)
      }
    : config;
  const forwardBinding = selectBindingWindow(
    templateDesign.templateSequence,
    'forward',
    thresholds,
    forwardTail.length,
    fragmentConfig
  );
  const reverseBinding = selectBindingWindow(
    templateDesign.templateSequence,
    'reverse',
    thresholds,
    reverseTail.length,
    fragmentConfig
  );

  if (!forwardBinding || !reverseBinding) {
    const missing = forwardBinding ? 'reverse' : 'forward';
    const reason = describeBindingWindowFailure(
      templateDesign.templateSequence,
      missing,
      thresholds,
      (missing === 'forward' ? forwardTail : reverseTail).length,
      fragmentConfig
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
      ampliconLength: templateDesign.desiredSequence.length,
      templateId: insert.id,
      warnings: [
        ...asArray(templateDesign.warnings),
        `Adds ${selectedSites[0].name || selectedSites[0].site} to the 5' end.`,
        forwardAddition ? `Adds ${forwardAddition.length} nt of desired insert sequence from the forward primer tail.` : ''
      ].filter(Boolean)
    }),
    buildPrimerRecord({
      name: `${insert.name}_R`,
      role: 'restriction-reverse',
      sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
      tailSequence: reverseTail,
      bindingSequence: reverseBinding.bindingSequence,
      groupLabel: `${insert.name} PCR`,
      ampliconLength: templateDesign.desiredSequence.length,
      templateId: insert.id,
      warnings: [
        `Adds ${selectedSites[1].name || selectedSites[1].site} to the 5' end.`,
        reverseAddition ? `Adds ${reverseAddition.length} nt of desired insert sequence from the reverse primer tail.` : ''
      ].filter(Boolean)
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
    if (templateDesign.feasible === false) {
      warnings.push(...asArray(templateDesign.blockingWarnings || templateDesign.warnings));
      return;
    }
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
