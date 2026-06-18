import { reverseComplementDna } from '../sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { selectBindingWindow } from './overlap-windows.js';
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
    return {
      feasible: false,
      warnings: ['Unable to find insert-binding primer windows compatible with the selected restriction tails.']
    };
  }

  const primers = [
    buildPrimerRecord({
      name: `${insert.name}_F`,
      role: 'restriction-forward',
      sequence: `${forwardTail}${forwardBinding.bindingSequence}`,
      tailSequence: forwardTail,
      bindingSequence: forwardBinding.bindingSequence,
      warnings: [`Adds ${selectedSites[0].name || selectedSites[0].site} to the 5' end.`]
    }),
    buildPrimerRecord({
      name: `${insert.name}_R`,
      role: 'restriction-reverse',
      sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
      tailSequence: reverseTail,
      bindingSequence: reverseBinding.bindingSequence,
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
    const templateDesign = resolveFragmentPrimerTemplate(fragment);
    const forwardTail = normalizeSequence(templateDesign.forwardAddedSequence);
    const nextOverlap = nextJunction && nextJunction.mode === 'primer-introduced'
      ? normalizeSequence(nextJunction.overlapSequence)
      : '';
    const reverseTargetTail = `${normalizeSequence(templateDesign.reverseAddedSequence)}${nextOverlap}`;
    const reverseTail = reverseTargetTail ? reverseComplementDna(reverseTargetTail) : '';
    const forwardBinding = selectBindingWindow(templateDesign.templateSequence, 'forward', thresholds, forwardTail.length, config);
    const reverseBinding = selectBindingWindow(templateDesign.templateSequence, 'reverse', thresholds, reverseTail.length, config);

    if (!forwardBinding || !reverseBinding) {
      warnings.push(`Unable to find compatible binding windows for ${fragment.name}.`);
      return;
    }

    const forwardWarnings = [
      ...asArray(templateDesign.warnings),
      forwardTail
        ? `Adds ${forwardTail.length} nt at the 5' end from the primer tail.`
        : ''
    ].filter(Boolean);
    const reverseWarnings = [
      normalizeSequence(templateDesign.reverseAddedSequence)
        ? `Adds ${normalizeSequence(templateDesign.reverseAddedSequence).length} nt at the 3' end from the primer tail.`
        : '',
      nextJunction?.mode === 'primer-introduced'
        ? `Carries a ${nextJunction.overlapLength} nt overlap into ${nextJunction.rightFragmentName}.`
        : ''
    ].filter(Boolean);

    primers.push(
      buildPrimerRecord({
        name: `${fragment.name}_F`,
        role: index === 0 ? 'assembly-forward-start' : 'assembly-forward',
        sequence: `${forwardTail}${forwardBinding.bindingSequence}`,
        tailSequence: forwardTail,
        bindingSequence: forwardBinding.bindingSequence,
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
