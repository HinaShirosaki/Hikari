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

export function installProteinBuilderAddProteinDialog(ctx) {
  const { elements, state } = ctx;

  ctx.renderAddProteinDialog = function renderAddProteinDialog(options = {}) {
    const sequence = normalizeProteinInput(elements.proteinBuilderAddProteinSequence?.value);
    const unsupported = [...new Set([...sequence].filter((residue) => !STANDARD_PROTEIN_RESIDUES.has(residue)))];
    const aaLength = countAminoAcids(sequence);
    const isError = unsupported.length > 0;
    const status = isError
      ? `Unsupported residues: ${unsupported.join(', ')}`
      : `${aaLength} aa${aaLength > PROTEIN_DIRECT_CLONING_MAX_AA ? ' | Cloning Design unavailable after vector insertion' : ''}`;

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
    return { sequence, aaLength, unsupported };
  };

  ctx.openAddProteinDialog = function openAddProteinDialog() {
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
    if (!input.aaLength || input.unsupported.length) {
      return false;
    }
    const label = cleanText(elements.proteinBuilderAddProteinName?.value, 160).trim() || 'Custom Protein';
    ctx.appendRow(createCustomRow(state.nextRowId++, label, input.sequence));
    ctx.invalidateDnaConstruct();
    ctx.closeAddProteinDialog();
    ctx.render();
    ctx.setBuilderStatus(`Added ${label} (${input.aaLength} aa) to the chain.`);
    return true;
  };
}

export { countAminoAcids };
