import { reverseTranslateProteinSequence } from '../calculations/sequence.js';
import { cleanText, normalizeSequenceText } from '../shared.js';
import { alignDnaToProteinSequence, normalizeProteinBuildSequence } from './sequence-utils.js';
import { buildConstruct } from './protein-construct.js';
import { resolvePoiDnaFromRecord } from './record-dna.js';

export function buildDnaPartFromProtein(part, options = {}) {
  const proteinSequence = normalizeProteinBuildSequence(part?.sequence || '');
  if (!proteinSequence.length) {
    return null;
  }

  const sourceDnaSequence = normalizeSequenceText(part?.sourceDnaSequence || '');
  if (sourceDnaSequence.length) {
    const alignedSequence = alignDnaToProteinSequence(sourceDnaSequence, proteinSequence);
    return {
      ok: true,
      label: cleanText(part?.label, 160) || 'Block',
      dnaSequence: alignedSequence,
      templateSequence: alignedSequence,
      reusedSource: cleanText(part?.sourceDnaNote, 240)
        || (cleanText(part?.kind, 40).toLowerCase() === 'feature'
          ? `Reused stored DNA for ${cleanText(part?.label, 160) || 'feature block'}.`
          : '')
    };
  }

  if (cleanText(part?.kind, 40).toLowerCase() === 'poi') {
    const poiSource = resolvePoiDnaFromRecord(proteinSequence, options?.record, options?.selectedFeature);
    if (poiSource?.dnaSequence) {
      return {
        ok: true,
        label: cleanText(part?.label, 160) || 'POI',
        dnaSequence: poiSource.dnaSequence,
        templateSequence: poiSource.dnaSequence,
        reusedSource: poiSource.note
      };
    }
  }

  const reverseTranslated = reverseTranslateProteinSequence(proteinSequence);
  if (!reverseTranslated?.ok || !reverseTranslated?.dna) {
    return {
      ok: false,
      label: cleanText(part?.label, 160) || 'Block',
      error: reverseTranslated?.message || `Unable to generate DNA for ${cleanText(part?.label, 160) || 'block'}.`
    };
  }

  return {
    ok: true,
    label: cleanText(part?.label, 160) || 'Block',
    dnaSequence: normalizeSequenceText(reverseTranslated.dna)
  };
}

export function buildDnaConstruct(payload = {}, options = {}) {
  const proteinConstruct = buildConstruct(payload);
  if (!proteinConstruct.ok) {
    return {
      ok: false,
      length: 0,
      sequence: '',
      warnings: Array.isArray(proteinConstruct?.warnings) ? proteinConstruct.warnings : [],
      errors: Array.isArray(proteinConstruct?.errors) ? proteinConstruct.errors : ['Unable to build the protein construct first.'],
      parts: [],
      notes: []
    };
  }

  const parts = [];
  const warnings = Array.isArray(proteinConstruct?.warnings) ? [...proteinConstruct.warnings] : [];
  const errors = [];
  const notes = [];

  (Array.isArray(proteinConstruct?.parts) ? proteinConstruct.parts : []).forEach((part) => {
    const dnaPart = buildDnaPartFromProtein(part, options);
    if (!dnaPart?.ok || !dnaPart?.dnaSequence) {
      errors.push(dnaPart?.error || `Unable to generate DNA for ${cleanText(part?.label, 160) || 'block'}.`);
      return;
    }
    if (dnaPart.reusedSource) {
      notes.push(dnaPart.reusedSource);
    }
    parts.push({
      label: dnaPart.label,
      dnaSequence: dnaPart.dnaSequence,
      templateSequence: normalizeSequenceText(dnaPart.templateSequence || ''),
      length: dnaPart.dnaSequence.length
    });
  });

  const sequence = parts.map((part) => part.dnaSequence).join('');
  return {
    ok: Boolean(sequence.length) && errors.length === 0,
    length: sequence.length,
    sequence,
    warnings,
    errors,
    parts,
    notes
  };
}
