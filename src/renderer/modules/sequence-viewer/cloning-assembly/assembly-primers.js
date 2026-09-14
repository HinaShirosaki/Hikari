import { reverseComplementDna } from '../calculations/sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { describeBindingWindowFailure, selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, fragmentPrimerConfig, resolveFragmentPrimerTemplate } from './primer-records.js';
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
  const fragmentConfig = fragmentPrimerConfig(insert, config);
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
    // What the stated template could not confirm belongs in the plan's warnings,
    // not buried on one primer row: it used to block the route outright, so it
    // has to stay just as visible now that it only advises.
    warnings: (asArray(templateDesign.warnings).length
      ? asArray(templateDesign.warnings)
      : [forwardBinding.specificityWarning, reverseBinding.specificityWarning]
    ).filter(Boolean)
  };
}

export function designAssemblyPrimersForRoute(fragments, junctions, thresholds, config) {
  const safeFragments = asArray(fragments);
  const safeJunctions = asArray(junctions);
  const primers = [];
  // Blockers fail the route; notes ride along with a design that still works.
  const blockers = [];
  const notes = [];

  safeFragments.forEach((fragment, index) => {
    const nextJunction = safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && !junction.wrapAround)
      || safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && junction.wrapAround);
    const previousJunction = safeJunctions.find((junction) => junction.rightFragmentId === fragment.id && !junction.wrapAround)
      || safeJunctions.find((junction) => junction.rightFragmentId === fragment.id && junction.wrapAround);
    const templateDesign = resolveFragmentPrimerTemplate(fragment);
    if (templateDesign.feasible === false) {
      blockers.push(...asArray(templateDesign.blockingWarnings || templateDesign.warnings));
      return;
    }
    const templateNotes = asArray(templateDesign.warnings);
    notes.push(...templateNotes);
    // Use complete target-strand tails from junction selection: an added flank
    // can move between the neighboring PCRs without moving either template core.
    const previousOverlap = previousJunction && previousJunction.mode === 'primer-introduced'
      ? normalizeSequence(previousJunction.rightForwardTail)
      : '';
    const templateForwardAddition = normalizeSequence(templateDesign.forwardAddedSequence);
    const forwardTail = previousJunction?.mode === 'primer-introduced'
      ? normalizeSequence(previousJunction.rightForwardTargetTail ?? `${previousOverlap}${templateForwardAddition}`)
      : templateForwardAddition;
    const nextOverlap = nextJunction && nextJunction.mode === 'primer-introduced'
      ? normalizeSequence(nextJunction.leftReverseTail)
      : '';
    const templateReverseAddition = normalizeSequence(templateDesign.reverseAddedSequence);
    const reverseTargetTail = nextJunction?.mode === 'primer-introduced'
      ? normalizeSequence(nextJunction.leftReverseTargetTail ?? `${templateReverseAddition}${nextOverlap}`)
      : templateReverseAddition;
    const reverseTail = reverseTargetTail ? reverseComplementDna(reverseTargetTail) : '';
    const ampliconLength = templateDesign.templateSequence.length + forwardTail.length + reverseTail.length;
    const fragmentConfig = fragmentPrimerConfig(fragment, config);
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
      blockers.push(`Unable to find compatible binding windows for ${fragment.name}.${reason ? ` ${reason}` : ''}`);
      return;
    }
    // The resolver's own note already names the template, so only speak up here
    // when it had nothing to say.
    if (!templateNotes.length) {
      notes.push(forwardBinding.specificityWarning, reverseBinding.specificityWarning);
    }

    const forwardWarnings = [
      forwardTail
        ? `Adds ${forwardTail.length} nt at the 5' end from the primer tail.`
        : '',
      previousJunction?.mode === 'primer-introduced'
        ? `Creates a ${previousJunction.overlapLength} nt overlap with ${previousJunction.leftFragmentName}.`
        : '',
      previousJunction?.redistributedFlankLength
        ? `Shares introduction of the ${previousJunction.redistributedFlankLength} nt added flank with the neighboring fragment's reverse primer.`
        : ''
    ].filter(Boolean);
    const reverseWarnings = [
      reverseTargetTail
        ? `Adds ${reverseTargetTail.length} nt at the 3' end from the primer tail.`
        : '',
      nextJunction?.mode === 'primer-introduced'
        ? `Creates a ${nextJunction.overlapLength} nt overlap into ${nextJunction.rightFragmentName}.`
        : '',
      nextJunction?.redistributedFlankLength
        ? `Shares introduction of the ${nextJunction.redistributedFlankLength} nt added flank with the neighboring fragment's forward primer.`
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
        ampliconLength,
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
        ampliconLength,
        templateId: fragment.id,
        warnings: reverseWarnings
      })
    );
  });

  if (!primers.length || blockers.length) {
    return {
      feasible: false,
      primers,
      warnings: blockers.length ? blockers : ['Unable to design a complete assembly primer set.']
    };
  }

  return {
    feasible: true,
    primers,
    warnings: [...new Set(notes.filter(Boolean))]
  };
}
