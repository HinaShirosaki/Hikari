import { cleanProteinSequence, translateDnaSequence } from '../../tool-box/sequence.js';
import { sanitizeProteinAssemblySequence } from '../../tool-box/protein-assembly.js';
import { normalizeSequenceText } from '../shared.js';
import { DNA_ALPHABET } from './constants.js';

export function isLikelyDnaSequence(sequence) {
  const cleaned = String(sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  return Boolean(cleaned) && DNA_ALPHABET.test(cleaned);
}

export function buildFeatureDerivedSequence(feature) {
  const rawSequence = String(feature?.sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  if (!rawSequence) {
    return {
      sequence: '',
      mode: 'empty',
      warnings: ['Stored feature has no sequence.'],
      sourceSequence: ''
    };
  }

  if (!isLikelyDnaSequence(rawSequence)) {
    return {
      sequence: cleanProteinSequence(rawSequence, true),
      mode: 'protein',
      warnings: [],
      sourceSequence: rawSequence
    };
  }

  const translation = translateDnaSequence(rawSequence, 1, 'star');
  const warnings = [];
  let protein = String(translation?.protein || '');
  if (protein.endsWith('*')) {
    protein = protein.slice(0, -1);
  }
  if (protein.includes('*')) {
    warnings.push('Translated feature contains an internal stop codon.');
  }
  if (translation?.remainderBases) {
    warnings.push(`${translation.remainderBases} trailing base(s) were ignored during translation.`);
  }
  if (!protein.length) {
    warnings.push('Stored feature did not yield an amino-acid block.');
  }
  return {
    sequence: sanitizeProteinAssemblySequence(protein, true),
    mode: 'translated',
    warnings,
    sourceSequence: rawSequence
  };
}

export function normalizeProteinBuildSequence(sequence) {
  return sanitizeProteinAssemblySequence(sequence || '', true);
}

export function stripTerminalStop(proteinSequence) {
  const cleaned = normalizeProteinBuildSequence(proteinSequence);
  return cleaned.endsWith('*') ? cleaned.slice(0, -1) : cleaned;
}

export function proteinsEquivalent(left, right) {
  return stripTerminalStop(left) === stripTerminalStop(right);
}

export function translateDnaToProtein(dnaSequence) {
  const cleaned = normalizeSequenceText(dnaSequence);
  if (!cleaned.length) {
    return '';
  }
  return normalizeProteinBuildSequence(translateDnaSequence(cleaned, 1, 'star')?.protein || '');
}

export function alignDnaToProteinSequence(dnaSequence, proteinSequence) {
  const cleanedDna = normalizeSequenceText(dnaSequence);
  const cleanedProtein = normalizeProteinBuildSequence(proteinSequence);
  if (!cleanedDna.length || !cleanedProtein.length) {
    return cleanedDna;
  }

  const translated = translateDnaToProtein(cleanedDna);
  if (translated === cleanedProtein) {
    return cleanedDna;
  }
  if (!cleanedProtein.endsWith('*') && translated === `${cleanedProtein}*` && cleanedDna.length >= 3) {
    return cleanedDna.slice(0, -3);
  }
  return cleanedDna;
}
