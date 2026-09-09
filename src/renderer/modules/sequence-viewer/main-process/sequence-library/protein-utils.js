'use strict';

const { CODON_TO_AMINO_ACID } = require('./constants');
const { normalizeSequenceText } = require('./utils');

function normalizeProteinSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z*]/g, '');
}

function trimProteinAtFirstStop(proteinSequence) {
  const normalized = normalizeProteinSequence(proteinSequence);
  const stopIndex = normalized.indexOf('*');
  return stopIndex >= 0 ? normalized.slice(0, stopIndex) : normalized;
}

function translateFeatureSequenceToProtein(featureSequence) {
  const sequence = normalizeSequenceText(featureSequence);
  const codonCount = Math.floor(sequence.length / 3);
  if (codonCount <= 0) {
    return '';
  }

  let protein = '';
  for (let index = 0; index < codonCount; index += 1) {
    const codon = sequence.slice(index * 3, (index * 3) + 3);
    const aminoAcid = CODON_TO_AMINO_ACID[codon] || 'X';
    if (aminoAcid === '*') {
      break;
    }
    protein += aminoAcid;
  }
  return protein;
}

function resolveFeatureProteinPayload(feature, featureSequence) {
  if (String(feature?.type || '').toLowerCase() !== 'cds') {
    return { proteinSequence: '', translationSource: '' };
  }

  const qualifierProteinSequence = trimProteinAtFirstStop(feature?.translation || feature?.proteinSequence || '');
  if (qualifierProteinSequence) {
    return {
      proteinSequence: qualifierProteinSequence,
      translationSource: 'qualifier'
    };
  }

  const offset = Number(feature?.qualifiers?.codon_start || 1) - 1;
  if (![0, 1, 2].includes(offset) || Number(feature?.qualifiers?.transl_table || 1) !== 1) return { proteinSequence: '', translationSource: '' };
  const derivedProteinSequence = translateFeatureSequenceToProtein(featureSequence.slice(offset));
  if (derivedProteinSequence) {
    return {
      proteinSequence: derivedProteinSequence,
      translationSource: 'derived'
    };
  }
  return { proteinSequence: '', translationSource: '' };
}

module.exports = {
  normalizeProteinSequence,
  resolveFeatureProteinPayload,
  translateFeatureSequenceToProtein,
  trimProteinAtFirstStop
};
