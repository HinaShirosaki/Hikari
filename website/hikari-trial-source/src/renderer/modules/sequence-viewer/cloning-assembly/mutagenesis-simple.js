import { reverseComplementDna } from '../calculations/sequence.js';
import { cloningPrimerTm } from '../calculations/oligo.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { createMidpoint, normalizeSequence } from './sequence-utils.js';
import { candidateScore } from './overlap-windows.js';
import { buildPrimerRecord } from './primer-records.js';
import { countPrimerBindingSites } from './primer-quality.js';

function scanSimpleMutagenesisPrimers(template, normalizedEdit, thresholds, config) {
  const circular = String(config?.topology || '').toLowerCase() !== 'linear';
  const flankBudget = Math.max(1, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const leftFlank = circular
    ? `${template}${template.slice(0, normalizedEdit.startIndex)}`.slice(-flankBudget)
    : template.slice(0, normalizedEdit.startIndex);
  const rightFlank = circular
    ? `${template.slice(normalizedEdit.endIndex)}${template}`.slice(0, flankBudget)
    : template.slice(normalizedEdit.endIndex);
  const replacement = normalizedEdit.type === 'deletion'
    ? ''
    : normalizeSequence(normalizedEdit.editedSequence || '');
  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const minPrimerLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxPrimerWindow = Math.max(minPrimerLength, Number(thresholds?.primerLength?.max) || maxPrimerLength);
  const maxTotalLength = Math.min(maxPrimerLength, maxPrimerWindow);
  const minFlankLength = Math.max(1, Number(config?.minMutagenesisFlankLength) || DEFAULT_CLONING_PREFERENCES.minMutagenesisFlankLength);
  const preferredTm = createMidpoint(thresholds?.primerTm);
  const preferredLength = createMidpoint(thresholds?.primerLength);
  let best = null;
  let evaluated = 0;
  let nonUnique = 0;

  if (replacement.length >= maxTotalLength) {
    return { best: null, evaluated: 0, nonUnique: 0 };
  }

  const maxLeftLength = Math.min(leftFlank.length, maxTotalLength - replacement.length - minFlankLength);
  const maxRightLength = Math.min(rightFlank.length, maxTotalLength - replacement.length - minFlankLength);
  if (maxLeftLength < minFlankLength || maxRightLength < minFlankLength) {
    return { best: null, evaluated: 0, nonUnique: 0 };
  }

  for (let leftLength = minFlankLength; leftLength <= maxLeftLength; leftLength += 1) {
    const leftSequence = leftFlank.slice(leftFlank.length - leftLength);
    for (let rightLength = minFlankLength; rightLength <= maxRightLength; rightLength += 1) {
      const rightSequence = rightFlank.slice(0, rightLength);
      const primerSequence = `${leftSequence}${replacement}${rightSequence}`;
      const primerLength = primerSequence.length;
      if (primerLength < minPrimerLength || primerLength > maxTotalLength) {
        continue;
      }
      evaluated += 1;
      if (config?.requireUniqueBinding !== false) {
        const leftThreePrimeTarget = leftSequence.slice(0, Math.min(12, leftSequence.length));
        const rightThreePrimeTarget = rightSequence.slice(-Math.min(12, rightSequence.length));
        if (
          countPrimerBindingSites(template, leftThreePrimeTarget, circular) !== 1
          || countPrimerBindingSites(template, rightThreePrimeTarget, circular) !== 1
        ) {
          nonUnique += 1;
          continue;
        }
      }
      const tm = cloningPrimerTm(primerSequence);
      if (tm < thresholds.primerTm.min || tm > thresholds.primerTm.max) {
        continue;
      }
      const editCenter = leftLength + (replacement.length / 2);
      const primerCenter = primerLength / 2;
      const balancePenalty = Math.abs(editCenter - primerCenter) * 0.35;
      const score = candidateScore(tm, preferredTm, primerLength, preferredLength) + balancePenalty;
      if (!best || score < best.score) {
        best = {
          sequence: primerSequence,
          leftSequence,
          rightSequence,
          replacement,
          tm,
          length: primerLength,
          score
        };
      }
    }
  }

  return { best, evaluated, nonUnique };
}

// The 3' ends of a mutagenesis primer must each land on one site, so a repeated
// flank rules the route out no matter how the thresholds move. Reads the scan the
// caller already ran: this search is O(flank^2) with a template scan per candidate.
function describeSimpleMutagenesisFailure({ best, evaluated, nonUnique }) {
  if (best || !nonUnique) {
    return '';
  }
  return nonUnique === evaluated
    ? "Both primer 3' ends land on sequence that repeats elsewhere on the plasmid, so no unique mutagenesis pair exists; relaxing Tm thresholds cannot help. Mutate from a unique flank, or use a route that cuts the repeat out of the amplicon."
    : `${nonUnique} of ${evaluated} candidate pairs were rejected for 3' ends that repeat elsewhere on the plasmid; the rest missed the Tm or length window.`;
}

export function designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const template = normalizeSequence(templateSequence);
  const scan = scanSimpleMutagenesisPrimers(template, normalizedEdit, thresholds, config);
  const primer = scan.best;
  if (primer) {
    const reverseSequence = reverseComplementDna(primer.sequence);
    const bindingSequence = `${primer.leftSequence}${primer.rightSequence}`;
    return {
      feasible: true,
      primers: [
        buildPrimerRecord({
          name: 'mutagenesis_F',
          role: 'mutagenesis-forward',
          sequence: primer.sequence,
          tailSequence: primer.replacement,
          bindingSequence,
          tmSequence: primer.sequence,
          warnings: []
        }),
        buildPrimerRecord({
          name: 'mutagenesis_R',
          role: 'mutagenesis-reverse',
          sequence: reverseSequence,
          tailSequence: reverseComplementDna(primer.replacement),
          bindingSequence: reverseComplementDna(bindingSequence),
          tmSequence: reverseSequence,
          warnings: []
        })
      ],
      warnings: []
    };
  }

  return {
    feasible: false,
    primers: [],
    warnings: [
      'No simple mutagenesis primer pair satisfied the current threshold set.',
      describeSimpleMutagenesisFailure(scan)
    ].filter(Boolean)
  };
}
