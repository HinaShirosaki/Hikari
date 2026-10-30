import { mapProteinHighlightParts } from './highlight-parts.js';
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
  if (sourceDnaSequence.length && part?.codonOptimize !== true) {
    const alignedSequence = alignDnaToProteinSequence(sourceDnaSequence, proteinSequence);
    return {
      ok: true,
      label: cleanText(part?.label, 160) || 'Block',
      dnaSequence: alignedSequence,
      templateSequence: alignedSequence,
      templateName: cleanText(part?.sourceVectorName, 160),
      templateEntryId: cleanText(part?.sourceVectorId, 200),
      templateHostSequence: normalizeSequenceText(part?.sourceVectorSequence || '')
    };
  }

  if (cleanText(part?.kind, 40).toLowerCase() === 'poi') {
    const poiSource = resolvePoiDnaFromRecord(proteinSequence, options?.record, options?.selectedFeature);
    if (poiSource?.dnaSequence) {
      return {
        ok: true,
        label: cleanText(part?.label, 160) || 'POI',
        dnaSequence: poiSource.dnaSequence,
        templateSequence: poiSource.dnaSequence
      };
    }
  }

  const reverseTranslated = reverseTranslateProteinSequence(proteinSequence, {
    organism: options?.organism
  });
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
    dnaSequence: normalizeSequenceText(reverseTranslated.dna),
    codonOptimized: part?.codonOptimize === true
  };
}

// A hand edit to the assembled protein is usually an initiator M, a stop, or a
// residue or two. Rebuilding the whole coding sequence for that would throw away
// the part templates the primers are designed against, so only the residues that
// actually changed get new codons.
function reconcileDnaToProtein(dnaSequence, chainProtein, targetProtein, options = {}) {
  const dna = normalizeSequenceText(dnaSequence);
  const chain = normalizeProteinBuildSequence(chainProtein);
  const target = normalizeProteinBuildSequence(targetProtein);
  if (!dna.length || !target.length || chain === target) {
    return { sequence: dna, note: '' };
  }
  if (dna.length !== chain.length * 3) {
    // The coding sequence does not line up codon-for-codon with the chain, so
    // there is nothing safe to patch: build the edited protein outright.
    const rebuilt = reverseTranslateProteinSequence(target, { organism: options?.organism });
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
    const leadDna = lead.length ? reverseTranslateProteinSequence(lead, { organism: options?.organism }) : { ok: true, dna: '' };
    const tailDna = tail.length ? reverseTranslateProteinSequence(tail, { organism: options?.organism }) : { ok: true, dna: '' };
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
  const replacement = changed.length
    ? reverseTranslateProteinSequence(changed, { organism: options?.organism })
    : { ok: true, dna: '' };
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
  const organism = cleanText(payload?.codonUsageProfile || options?.organism, 80);
  if (!proteinConstruct.ok) {
    return {
      ok: false,
      length: 0,
      sequence: '',
      warnings: Array.isArray(proteinConstruct?.warnings) ? proteinConstruct.warnings : [],
      errors: Array.isArray(proteinConstruct?.errors) ? proteinConstruct.errors : ['Unable to build the protein construct first.'],
      parts: []
    };
  }

  const parts = [];
  const warnings = Array.isArray(proteinConstruct?.warnings) ? [...proteinConstruct.warnings] : [];
  const errors = [];

  (Array.isArray(proteinConstruct?.parts) ? proteinConstruct.parts : []).forEach((part) => {
    const dnaPart = buildDnaPartFromProtein(part, { ...options, organism });
    if (!dnaPart?.ok || !dnaPart?.dnaSequence) {
      errors.push(dnaPart?.error || `Unable to generate DNA for ${cleanText(part?.label, 160) || 'block'}.`);
      return;
    }
    parts.push({
      label: dnaPart.label,
      type: cleanText(part?.type, 40) || 'custom',
      kind: cleanText(part?.kind, 40) || 'custom',
      paletteSlot: Math.max(1, Number(part?.paletteSlot) || parts.length + 1),
      proteinLength: String(part?.sequence || '').replace(/\*/g, '').length,
      dnaSequence: dnaPart.dnaSequence,
      templateSequence: normalizeSequenceText(dnaPart.templateSequence || ''),
      templateName: cleanText(dnaPart.templateName, 160),
      templateEntryId: cleanText(dnaPart.templateEntryId, 200),
      templateHostSequence: normalizeSequenceText(dnaPart.templateHostSequence || ''),
      codonOptimized: dnaPart.codonOptimized === true,
      length: dnaPart.dnaSequence.length
    });
  });

  const chainDna = parts.map((part) => part.dnaSequence).join('');
  const reconciled = reconcileDnaToProtein(
    chainDna,
    proteinConstruct.chainSequence || proteinConstruct.sequence,
    proteinConstruct.sequence,
    { organism }
  );
  const sequence = reconciled.sequence;
  let highlightOffset = 0;
  const highlightParts = sequence.length === proteinConstruct.sequence.length * 3
    ? mapProteinHighlightParts(proteinConstruct.sequence, proteinConstruct.parts).map((part) => {
      const dnaSequence = sequence.slice(highlightOffset, highlightOffset + part.sequence.length * 3);
      highlightOffset += dnaSequence.length;
      return { ...part, dnaSequence };
    })
    : parts;
  return {
    ok: Boolean(sequence.length) && errors.length === 0,
    length: sequence.length,
    sequence,
    warnings,
    errors,
    parts,
    highlightParts
  };
}
