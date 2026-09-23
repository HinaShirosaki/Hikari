import { translateDnaSequence } from '../calculations/sequence.js';
import { cleanText } from '../shared.js';
import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { PROTEIN_DIRECT_CLONING_MAX_AA } from './constants.js';
import { createCustomRow } from './row-factory.js';

const STANDARD_PROTEIN_RESIDUES = new Set('ACDEFGHIKLMNPQRSTVWY*');

function normalizeProteinInput(raw) {
  return sanitizeProteinAssemblySequence(raw || '', true);
}

function countAminoAcids(sequence) {
  return [...String(sequence || '')].filter((residue) => residue !== '*').length;
}

export function parseAddProteinInput(raw, type = 'protein') {
  if (type !== 'dna') {
    const sequence = normalizeProteinInput(raw);
    const unsupported = [...new Set([...sequence].filter((residue) => !STANDARD_PROTEIN_RESIDUES.has(residue)))];
    return { sequence, unsupported, error: unsupported.length ? `Unsupported residues: ${unsupported.join(', ')}` : '', sourceDnaSequence: '' };
  }
  const dna = String(raw || '').replace(/\s/g, '').toUpperCase();
  const unsupported = [...new Set([...dna].filter((base) => !'ACGT'.includes(base)))];
  let error = unsupported.length ? `Unsupported DNA bases: ${unsupported.join(', ')}. Use A, C, G and T.` : '';
  if (!error && dna.length % 3) error = 'DNA must contain complete codons (a multiple of 3 bases).';
  let sequence = error ? '' : translateDnaSequence(dna, 1, 'star').protein;
  const terminalStop = sequence.endsWith('*');
  if (terminalStop) sequence = sequence.slice(0, -1);
  if (!error && sequence.includes('*')) error = 'DNA contains an internal stop codon. Enter a continuous coding sequence.';
  return { sequence, unsupported, error, dnaLength: dna.length, sourceDnaSequence: terminalStop ? dna.slice(0, -3) : dna };
}

export function installProteinBuilderAddProteinDialog(ctx) {
  const { elements, state } = ctx;

  ctx.renderAddProteinDialog = function renderAddProteinDialog(options = {}) {
    const isDna = elements.proteinBuilderAddProteinType?.value === 'dna';
    const input = parseAddProteinInput(elements.proteinBuilderAddProteinSequence?.value, isDna ? 'dna' : 'protein');
    const aaLength = countAminoAcids(input.sequence);
    const isError = Boolean(input.error);
    const status = input.error || `${isDna ? `${input.dnaLength} bp → ` : ''}${aaLength} aa${aaLength > PROTEIN_DIRECT_CLONING_MAX_AA ? ' | Cloning Design unavailable after vector insertion' : ''}`;
    if (elements.proteinBuilderAddProteinSequence) {
      elements.proteinBuilderAddProteinSequence.placeholder = isDna ? 'Enter a DNA coding sequence (5′ to 3′)' : 'Enter an amino-acid sequence';
    }
    if (elements.proteinBuilderAddProteinHint) {
      elements.proteinBuilderAddProteinHint.textContent = isDna
        ? 'Translated from the first base using the standard genetic code. Use complete codons; an optional final stop codon is removed. Original codons are retained when building DNA.'
        : 'Enter the protein sequence using one-letter amino-acid codes.';
    }

    if (elements.proteinBuilderAddProteinOverlay && Object.hasOwn(options, 'open')) {
      elements.proteinBuilderAddProteinOverlay.hidden = !options.open;
    }
    if (elements.proteinBuilderAddProteinStatus) {
      elements.proteinBuilderAddProteinStatus.textContent = status;
      elements.proteinBuilderAddProteinStatus.classList.toggle('is-error', isError);
    }
    if (elements.proteinBuilderAddProteinConfirmBtn) {
      elements.proteinBuilderAddProteinConfirmBtn.disabled = !aaLength || isError;
    }
    return { ...input, aaLength };
  };

  ctx.openAddProteinDialog = function openAddProteinDialog() {
    if (elements.proteinBuilderAddProteinType) elements.proteinBuilderAddProteinType.value = 'protein';
    if (elements.proteinBuilderAddProteinName) {
      elements.proteinBuilderAddProteinName.value = '';
    }
    if (elements.proteinBuilderAddProteinSequence) {
      elements.proteinBuilderAddProteinSequence.value = '';
    }
    ctx.renderAddProteinDialog({ open: true });
    elements.proteinBuilderAddProteinName?.focus?.();
  };

  ctx.closeAddProteinDialog = function closeAddProteinDialog() {
    ctx.renderAddProteinDialog({ open: false });
    elements.proteinBuilderAddProteinBtn?.focus?.();
  };

  ctx.addProteinFromDialog = function addProteinFromDialog() {
    const input = ctx.renderAddProteinDialog();
    if (!input.aaLength || input.error) {
      return false;
    }
    const label = cleanText(elements.proteinBuilderAddProteinName?.value, 160).trim() || 'Custom Protein';
    const row = createCustomRow(state.nextRowId++, label, input.sequence);
    if (input.sourceDnaSequence) row.sourceDnaSequence = input.sourceDnaSequence;
    ctx.appendRow(row);
    ctx.invalidateDnaConstruct();
    ctx.closeAddProteinDialog();
    ctx.render();
    ctx.setBuilderStatus(`Added ${label} (${input.aaLength} aa) to the chain.`);
    return true;
  };
}

export { countAminoAcids };
