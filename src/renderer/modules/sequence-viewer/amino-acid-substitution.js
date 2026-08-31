import {
  getCodonOptionsForResidue,
  translateDnaCodon
} from './calculations/sequence.js';
import {
  complementBase,
  normalizeSequenceText
} from './shared.js';

export const STANDARD_AMINO_ACIDS = Object.freeze([
  { code: 'A', shortName: 'Ala', name: 'Alanine' },
  { code: 'C', shortName: 'Cys', name: 'Cysteine' },
  { code: 'D', shortName: 'Asp', name: 'Aspartic acid' },
  { code: 'E', shortName: 'Glu', name: 'Glutamic acid' },
  { code: 'F', shortName: 'Phe', name: 'Phenylalanine' },
  { code: 'G', shortName: 'Gly', name: 'Glycine' },
  { code: 'H', shortName: 'His', name: 'Histidine' },
  { code: 'I', shortName: 'Ile', name: 'Isoleucine' },
  { code: 'K', shortName: 'Lys', name: 'Lysine' },
  { code: 'L', shortName: 'Leu', name: 'Leucine' },
  { code: 'M', shortName: 'Met', name: 'Methionine' },
  { code: 'N', shortName: 'Asn', name: 'Asparagine' },
  { code: 'P', shortName: 'Pro', name: 'Proline' },
  { code: 'Q', shortName: 'Gln', name: 'Glutamine' },
  { code: 'R', shortName: 'Arg', name: 'Arginine' },
  { code: 'S', shortName: 'Ser', name: 'Serine' },
  { code: 'T', shortName: 'Thr', name: 'Threonine' },
  { code: 'V', shortName: 'Val', name: 'Valine' },
  { code: 'W', shortName: 'Trp', name: 'Tryptophan' },
  { code: 'Y', shortName: 'Tyr', name: 'Tyrosine' }
]);

const STANDARD_AMINO_ACID_CODES = new Set(STANDARD_AMINO_ACIDS.map((entry) => entry.code));

function normalizeAminoAcidCode(value) {
  return String(value || '').trim().slice(0, 1).toUpperCase();
}

function normalizeCodonPositions(value, sequenceLength) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const positions = source.map((position) => Math.round(Number(position)));
  if (
    positions.length !== 3
    || positions.some((position) => !Number.isFinite(position) || position < 0 || position >= sequenceLength)
    || new Set(positions).size !== 3
  ) {
    throw new Error('The selected amino acid no longer maps to one complete codon.');
  }
  return positions;
}

function countCodonDifferences(left, right) {
  let differences = 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      differences += 1;
    }
  }
  return differences;
}

export function chooseClosestAminoAcidCodon(currentCodon, targetAminoAcid) {
  const sourceCodon = normalizeSequenceText(currentCodon).slice(0, 3);
  const targetCode = normalizeAminoAcidCode(targetAminoAcid);
  if (!STANDARD_AMINO_ACID_CODES.has(targetCode)) {
    throw new Error('Choose one of the 20 standard amino acids.');
  }

  const candidates = getCodonOptionsForResidue(targetCode)
    .map((entry) => String(entry?.codon || '').toUpperCase())
    .filter((codon) => codon.length === 3)
    .sort((left, right) => (
      countCodonDifferences(sourceCodon, left) - countCodonDifferences(sourceCodon, right)
      || left.localeCompare(right)
    ));
  if (!candidates.length) {
    throw new Error(`No DNA codon is available for amino acid ${targetCode}.`);
  }
  return candidates[0];
}

export function resolveAminoAcidCodonContext(sequence, payload = {}) {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    throw new Error('Load a DNA sequence before changing an amino acid.');
  }
  const strand = Number(payload?.strand) === -1 ? -1 : 1;
  const codonPositions = normalizeCodonPositions(payload?.codonPositions, text.length);
  const codon = codonPositions
    .map((position) => {
      const genomicBase = text[position] || 'N';
      return strand === -1 ? complementBase(genomicBase) : genomicBase;
    })
    .join('');
  return {
    aminoAcid: translateDnaCodon(codon) || 'X',
    codon,
    codonPositions,
    strand
  };
}

export function buildAminoAcidSubstitution(sequence, payload = {}) {
  const text = normalizeSequenceText(sequence);
  const context = resolveAminoAcidCodonContext(text, payload);
  const expectedCodon = normalizeSequenceText(payload?.currentCodon).slice(0, 3);
  const expectedAminoAcid = normalizeAminoAcidCode(payload?.currentAminoAcid);
  if (expectedCodon && expectedCodon !== context.codon) {
    throw new Error('The selected codon changed before the amino-acid edit could be applied.');
  }
  if (expectedAminoAcid && expectedAminoAcid !== context.aminoAcid) {
    throw new Error('The selected amino acid changed before the edit could be applied.');
  }

  const targetAminoAcid = normalizeAminoAcidCode(payload?.targetAminoAcid);
  if (!STANDARD_AMINO_ACID_CODES.has(targetAminoAcid)) {
    throw new Error('Choose one of the 20 standard amino acids.');
  }
  if (targetAminoAcid === context.aminoAcid) {
    throw new Error(`${targetAminoAcid} is already encoded at this codon.`);
  }

  const targetCodon = chooseClosestAminoAcidCodon(context.codon, targetAminoAcid);
  const nextBases = [...text];
  context.codonPositions.forEach((position, codonIndex) => {
    const codingBase = targetCodon[codonIndex];
    nextBases[position] = context.strand === -1 ? complementBase(codingBase) : codingBase;
  });
  const nextSequence = nextBases.join('');

  return {
    ...context,
    changedBaseCount: context.codonPositions.reduce(
      (count, position) => count + (text[position] === nextSequence[position] ? 0 : 1),
      0
    ),
    nextSequence,
    targetAminoAcid,
    targetCodon
  };
}
