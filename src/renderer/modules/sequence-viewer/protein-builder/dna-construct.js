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
      templateName: cleanText(part?.sourceVectorName, 160),
      templateHostSequence: normalizeSequenceText(part?.sourceVectorSequence || ''),
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

// A hand edit to the assembled protein is usually an initiator M, a stop, or a
// residue or two. Rebuilding the whole coding sequence for that would throw away
// the part templates the primers are designed against, so only the residues that
// actually changed get new codons.
function reconcileDnaToProtein(dnaSequence, chainProtein, targetProtein) {
  const dna = normalizeSequenceText(dnaSequence);
  const chain = normalizeProteinBuildSequence(chainProtein);
  const target = normalizeProteinBuildSequence(targetProtein);
  if (!dna.length || !target.length || chain === target) {
    return { sequence: dna, note: '' };
  }
  if (dna.length !== chain.length * 3) {
    // The coding sequence does not line up codon-for-codon with the chain, so
    // there is nothing safe to patch: build the edited protein outright.
    const rebuilt = reverseTranslateProteinSequence(target);
    return rebuilt?.ok && rebuilt?.dna
      ? { sequence: normalizeSequenceText(rebuilt.dna), note: 'Hand-edited assembled sequence was reverse translated in full.' }
      : { sequence: dna, note: '' };
  }

  // The common case is a pure addition -- an initiator M, a stop, or both --
  // which keeps every part codon exactly as the chain built it.
  const chainAt = target.indexOf(chain);
  if (chainAt >= 0 && chain.length) {
    const lead = target.slice(0, chainAt);
    const tail = target.slice(chainAt + chain.length);
    const leadDna = lead.length ? reverseTranslateProteinSequence(lead) : { ok: true, dna: '' };
    const tailDna = tail.length ? reverseTranslateProteinSequence(tail) : { ok: true, dna: '' };
    if (leadDna?.ok && tailDna?.ok) {
      const added = [
        lead.length ? `${lead} at the N-terminus` : '',
        tail.length ? `${tail} at the C-terminus` : ''
      ].filter(Boolean).join(' and ');
      return {
        sequence: `${normalizeSequenceText(leadDna.dna || '')}${dna}${normalizeSequenceText(tailDna.dna || '')}`,
        note: `Hand-edited assembled sequence: added ${added}; the chain kept its own codons.`
      };
    }
  }

  const shortest = Math.min(chain.length, target.length);
  let prefix = 0;
  while (prefix < shortest && chain[prefix] === target[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shortest - prefix
    && chain[chain.length - 1 - suffix] === target[target.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const changed = target.slice(prefix, target.length - suffix);
  const replacement = changed.length ? reverseTranslateProteinSequence(changed) : { ok: true, dna: '' };
  if (!replacement?.ok && changed.length) {
    return { sequence: dna, note: '' };
  }
  const sequence = `${dna.slice(0, prefix * 3)}${normalizeSequenceText(replacement.dna || '')}${dna.slice((chain.length - suffix) * 3)}`;
  return {
    sequence,
    note: changed.length
      ? `Hand-edited assembled sequence: residue ${prefix + 1}${changed.length > 1 ? `-${prefix + changed.length}` : ''} (${changed}) rebuilt; the rest of the chain kept its own codons.`
      : `Hand-edited assembled sequence: ${chain.length - target.length} residue(s) removed at residue ${prefix + 1}; the rest of the chain kept its own codons.`
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
      templateName: cleanText(dnaPart.templateName, 160),
      templateHostSequence: normalizeSequenceText(dnaPart.templateHostSequence || ''),
      length: dnaPart.dnaSequence.length
    });
  });

  const chainDna = parts.map((part) => part.dnaSequence).join('');
  const reconciled = reconcileDnaToProtein(
    chainDna,
    proteinConstruct.chainSequence || proteinConstruct.sequence,
    proteinConstruct.sequence
  );
  if (reconciled.note) {
    notes.push(reconciled.note);
  }
  const sequence = reconciled.sequence;
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
