import { designSimpleMutagenesisPrimers } from './mutagenesis-simple.js';
import { normalizeSequence } from './sequence-utils.js';

export function designMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const simpleDesign = designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config);
  if (simpleDesign.feasible) {
    return simpleDesign;
  }

  // An edit that adds DNA can also fail for a reason no threshold level fixes:
  // it is too long to ride on a complementary primer pair. Say so *alongside*
  // the scan's own diagnosis. The tiled-oligo route this used to defer to never
  // emitted a primer under any input -- it only replaced the real reason (say, a
  // repeated 3' flank) with a size message.
  const addedSequence = normalizeSequence(normalizedEdit?.editedSequence || '');
  if (addedSequence.length && (normalizedEdit.type === 'insertion' || normalizedEdit.type === 'replacement')) {
    return {
      ...simpleDesign,
      warnings: [
        ...simpleDesign.warnings,
        `The ${addedSequence.length}-nt edit may not fit the complementary whole-plasmid primer route. Use Q5/KLD split-tail primers, or prepare the insert from overlapping oligos within a Gibson/In-Fusion design.`
      ]
    };
  }

  return simpleDesign;
}
