import { reverseComplementDna } from '../calculations/sequence.js';
import { oligoTm } from '../calculations/oligo.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { createMidpoint, normalizeSequence } from './sequence-utils.js';
import { candidateScore } from './overlap-windows.js';
import { buildPrimerRecord } from './primer-records.js';

export function findMutagenesisWindow(flankSequence, side, thresholds, targetBudget) {
  const cleaned = normalizeSequence(flankSequence);
  if (!cleaned.length) {
    return null;
  }

  const minLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxLength = Math.min(cleaned.length, Math.max(minLength, targetBudget));
  const preferredTm = createMidpoint(thresholds?.primerTm);
  let best = null;

  for (let length = minLength; length <= maxLength; length += 1) {
    const sequence = side === 'left'
      ? cleaned.slice(cleaned.length - length)
      : cleaned.slice(0, length);
    const tm = oligoTm(sequence, 'DNA');
    if (tm < thresholds.primerTm.min || tm > thresholds.primerTm.max) {
      continue;
    }
    const score = Math.abs(tm - preferredTm) + Math.abs(length - minLength) * 0.1;
    if (!best || score < best.score) {
      best = {
        sequence,
        tm,
        length,
        score
      };
    }
  }

  return best;
}

export function selectSimpleMutagenesisPrimer(template, normalizedEdit, thresholds, config) {
  const leftFlank = template.slice(0, normalizedEdit.startIndex);
  const rightFlank = template.slice(normalizedEdit.endIndex);
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

  if (replacement.length >= maxTotalLength) {
    return null;
  }

  const maxLeftLength = Math.min(leftFlank.length, maxTotalLength - replacement.length - minFlankLength);
  const maxRightLength = Math.min(rightFlank.length, maxTotalLength - replacement.length - minFlankLength);
  if (maxLeftLength < minFlankLength || maxRightLength < minFlankLength) {
    return null;
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
      const tm = oligoTm(primerSequence, 'DNA');
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

  return best;
}

export function designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const template = normalizeSequence(templateSequence);
  const primer = selectSimpleMutagenesisPrimer(template, normalizedEdit, thresholds, config);
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
    warnings: ['No simple mutagenesis primer pair satisfied the current threshold set.']
  };
}
