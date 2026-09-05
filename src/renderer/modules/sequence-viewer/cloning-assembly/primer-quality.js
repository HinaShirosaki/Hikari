import { reverseComplementDna } from '../calculations/sequence.js';
import { computeGcContent, normalizeSequence } from './sequence-utils.js';

function countExactOccurrences(sequence, query, circular = false) {
  if (!sequence.length || !query.length || (!circular && query.length > sequence.length)) {
    return 0;
  }
  const haystack = circular && query.length > 1
    ? sequence + sequence.slice(0, query.length - 1)
    : sequence;
  const limit = circular ? sequence.length : Math.max(0, sequence.length - query.length + 1);
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (haystack.slice(index, index + query.length) === query) {
      count += 1;
    }
  }
  return count;
}

// Count exact sites on either template strand. A primer is unambiguous only when
// one strand/orientation contains one matching site across the complete template.
export function countPrimerBindingSites(templateSequence, bindingSequence, circular = false) {
  const template = normalizeSequence(templateSequence);
  const binding = normalizeSequence(bindingSequence);
  if (!template.length || !binding.length) {
    return 0;
  }
  const reverse = reverseComplementDna(binding);
  return countExactOccurrences(template, binding, circular)
    + (reverse === binding ? 0 : countExactOccurrences(template, reverse, circular));
}

function longestComplementaryRun(leftSequence, rightSequence) {
  const left = normalizeSequence(leftSequence);
  const rightComplement = reverseComplementDna(normalizeSequence(rightSequence));
  let longest = 0;
  for (let offset = -rightComplement.length + 1; offset < left.length; offset += 1) {
    let run = 0;
    for (let leftIndex = Math.max(0, offset); leftIndex < Math.min(left.length, offset + rightComplement.length); leftIndex += 1) {
      const rightIndex = leftIndex - offset;
      if (left[leftIndex] === rightComplement[rightIndex]) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
  }
  return longest;
}

function longestThreePrimeComplementaryRun(leftSequence, rightSequence) {
  const left = normalizeSequence(leftSequence);
  const rightComplement = reverseComplementDna(normalizeSequence(rightSequence));
  let longest = 0;
  for (let offset = -rightComplement.length + 1; offset < left.length; offset += 1) {
    let runStartRight = -1;
    let run = 0;
    for (let leftIndex = Math.max(0, offset); leftIndex < Math.min(left.length, offset + rightComplement.length); leftIndex += 1) {
      const rightIndex = leftIndex - offset;
      if (left[leftIndex] === rightComplement[rightIndex]) {
        if (!run) {
          runStartRight = rightIndex;
        }
        run += 1;
        const touchesLeftThreePrime = leftIndex === left.length - 1;
        const touchesRightThreePrime = runStartRight === 0;
        if (touchesLeftThreePrime || touchesRightThreePrime) {
          longest = Math.max(longest, run);
        }
      } else {
        run = 0;
        runStartRight = -1;
      }
    }
  }
  return longest;
}

function longestHairpinStem(sequence, minimumLoopLength = 3) {
  const cleaned = normalizeSequence(sequence);
  let longest = 0;
  for (let leftStart = 0; leftStart < cleaned.length; leftStart += 1) {
    for (let rightStart = leftStart + minimumLoopLength + 2; rightStart < cleaned.length; rightStart += 1) {
      const maxStem = Math.min(rightStart - leftStart - minimumLoopLength, cleaned.length - rightStart);
      for (let stemLength = maxStem; stemLength > longest; stemLength -= 1) {
        const leftStem = cleaned.slice(leftStart, leftStart + stemLength);
        const rightStem = cleaned.slice(rightStart, rightStart + stemLength);
        if (leftStem === reverseComplementDna(rightStem)) {
          longest = stemLength;
          break;
        }
      }
    }
  }
  return longest;
}

export function evaluatePrimerQuality(sequence) {
  const cleaned = normalizeSequence(sequence);
  const warnings = [];
  const blockingWarnings = [];
  if (!cleaned.length) {
    return { warnings, blockingWarnings, gcContent: 0, longestHomopolymer: 0, hairpinStem: 0, selfDimerRun: 0, threePrimeSelfDimerRun: 0 };
  }
  const homopolymers = cleaned.match(/A+|C+|G+|T+/g) || [];
  const longestHomopolymer = homopolymers.reduce((max, run) => Math.max(max, run.length), 0);
  const gcContent = computeGcContent(cleaned);
  const hairpinStem = longestHairpinStem(cleaned);
  const selfDimerRun = longestComplementaryRun(cleaned, cleaned);
  const threePrimeSelfDimerRun = longestThreePrimeComplementaryRun(cleaned, cleaned);

  if (longestHomopolymer >= 5) {
    warnings.push(`Contains a ${longestHomopolymer}-base homopolymer; review synthesis and nonspecific priming risk.`);
    if (longestHomopolymer >= 7) {
      blockingWarnings.push(`Contains a ${longestHomopolymer}-base homopolymer that is too error-prone for an automatically approved cloning primer.`);
    }
  }
  if (gcContent < 25 || gcContent > 75) {
    warnings.push(`Whole-oligo GC content (${gcContent.toFixed(1)}%) is outside the preferred 25-75% range.`);
  }
  if (hairpinStem >= 6) {
    warnings.push(`Potential hairpin contains a ${hairpinStem}-base complementary stem.`);
    // A sequence-only stem count is deliberately conservative: without loop
    // energetics, shorter stems are review warnings rather than hard failures.
    if (hairpinStem >= 10) {
      blockingWarnings.push(`Potential hairpin contains a ${hairpinStem}-base stem and requires primer redesign.`);
    }
  }
  if (threePrimeSelfDimerRun >= 4) {
    warnings.push(`Potential 3' self-dimer contains ${threePrimeSelfDimerRun} complementary bases.`);
    if (threePrimeSelfDimerRun >= 8) {
      blockingWarnings.push(`Potential 3' self-dimer contains ${threePrimeSelfDimerRun} complementary bases and requires primer redesign.`);
    }
  } else if (selfDimerRun >= 8) {
    warnings.push(`Potential self-dimer contains an ${selfDimerRun}-base complementary run.`);
  }

  return { warnings, blockingWarnings, gcContent, longestHomopolymer, hairpinStem, selfDimerRun, threePrimeSelfDimerRun };
}

export function evaluatePrimerPairQuality(leftPrimer, rightPrimer) {
  const left = normalizeSequence(leftPrimer?.sequence || leftPrimer || '');
  const right = normalizeSequence(rightPrimer?.sequence || rightPrimer || '');
  const complementaryRun = longestComplementaryRun(left, right);
  const threePrimeComplementaryRun = longestThreePrimeComplementaryRun(left, right);
  const warnings = [];
  const blockingWarnings = [];
  if (threePrimeComplementaryRun >= 4) {
    warnings.push(`Potential 3' heterodimer contains ${threePrimeComplementaryRun} complementary bases.`);
    if (threePrimeComplementaryRun >= 8) {
      blockingWarnings.push(`Potential 3' heterodimer contains ${threePrimeComplementaryRun} complementary bases and requires primer redesign.`);
    }
  } else if (complementaryRun >= 8) {
    warnings.push(`Potential heterodimer contains an ${complementaryRun}-base complementary run.`);
  }
  return { warnings, blockingWarnings, complementaryRun, threePrimeComplementaryRun };
}
