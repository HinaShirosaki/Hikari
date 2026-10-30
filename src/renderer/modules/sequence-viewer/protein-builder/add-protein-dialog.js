import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { translateDnaSequence } from '../calculations/sequence.js';
import { cleanText } from '../shared.js';
import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { createCustomRow } from './row-factory.js';
import { installProteinBuilderUniProtPicker } from './uniprot-picker.js';

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
  installProteinBuilderUniProtPicker(ctx);

  ctx.renderAddProteinDialog = function renderAddProteinDialog(options = {}) {
    const isDna = elements.proteinBuilderAddProteinType?.value === 'dna';
    const input = ctx.isUniProtSource()
      ? { ...ctx.getUniProtInput(), sourceDnaSequence: '' }
      : parseAddProteinInput(elements.proteinBuilderAddProteinSequence?.value, isDna ? 'dna' : 'protein');
    const aaLength = countAminoAcids(input.sequence);
    if (elements.proteinBuilderAddProteinSequence) {
      i18nUi.setAttribute(elements.proteinBuilderAddProteinSequence, "placeholder", (isDna ? i18nUi.message("Enter a DNA coding sequence (5′ to 3′)") : i18nUi.message("Enter an amino-acid sequence")));
    }

    if (elements.proteinBuilderAddProteinOverlay && Object.hasOwn(options, 'open')) {
      elements.proteinBuilderAddProteinOverlay.hidden = !options.open;
    }
    if (elements.proteinBuilderAddProteinConfirmBtn) {
      elements.proteinBuilderAddProteinConfirmBtn.disabled = !aaLength || Boolean(input.error);
    }
    if (elements.proteinBuilderAddProteinValidation) {
      i18nUi.setText(elements.proteinBuilderAddProteinValidation, (input.error || (aaLength ? i18nUi.message("{p0} aa selected.", { p0: aaLength.toLocaleString() }) : '')));
      elements.proteinBuilderAddProteinValidation.hidden = !elements.proteinBuilderAddProteinValidation.textContent;
    }
    return { ...input, aaLength };
  };

  // With a row id the dialog edits that manually added block in place;
  // without one it adds a new block.
  ctx.openAddProteinDialog = function openAddProteinDialog(rowId = '') {
    const row = rowId ? state.rows.find((item) => item.id === rowId && item.kind === 'custom') : null;
    ctx.resetUniProtPicker();
    ctx.editingProteinRowId = row?.id || '';
    if (elements.proteinBuilderAddProteinTitle) i18nUi.setText(elements.proteinBuilderAddProteinTitle, (row ? i18nUi.message("Edit Protein") : i18nUi.message("Add Protein")));
    if (elements.proteinBuilderAddProteinConfirmBtn) i18nUi.setText(elements.proteinBuilderAddProteinConfirmBtn, (row ? i18nUi.message("Save") : i18nUi.message("Add to Chain")));
    if (elements.proteinBuilderAddProteinType) elements.proteinBuilderAddProteinType.value = row?.sourceDnaSequence ? 'dna' : 'protein';
    if (elements.proteinBuilderAddProteinName) {
      elements.proteinBuilderAddProteinName.value = row?.label || '';
    }
    if (elements.proteinBuilderAddProteinSequence) {
      elements.proteinBuilderAddProteinSequence.value = row ? (row.sourceDnaSequence || row.sequence || '') : '';
    }
    ctx.renderAddProteinDialog({ open: true });
    elements.proteinBuilderAddProteinName?.focus?.();
  };

  ctx.closeAddProteinDialog = function closeAddProteinDialog() {
    ctx.cancelUniProtRequests();
    ctx.renderAddProteinDialog({ open: false });
    elements.proteinBuilderAddProteinBtn?.focus?.();
  };

  ctx.addProteinFromDialog = function addProteinFromDialog() {
    const input = ctx.renderAddProteinDialog();
    if (!input.aaLength || input.error) {
      return false;
    }
    const label = cleanText(elements.proteinBuilderAddProteinName?.value, 160).trim() || 'Custom Protein';
    const editingRow = ctx.editingProteinRowId && state.rows.find((item) => item.id === ctx.editingProteinRowId);
    const provenance = input.uniprot ? { uniprot: input.uniprot, note: input.note } : null;
    if (editingRow) {
      if (!provenance && editingRow.uniprot && (input.sequence !== editingRow.sequence || input.sourceDnaSequence)) {
        delete editingRow.uniprot;
        editingRow.note = 'User-defined protein sequence.';
      }
      Object.assign(editingRow, { label, sequence: input.sequence, sourceDnaSequence: input.sourceDnaSequence });
      if (provenance) Object.assign(editingRow, provenance);
      ctx.invalidateDnaConstruct();
      ctx.closeAddProteinDialog();
      ctx.render();
      ctx.setBuilderStatus(i18nUi.text("Updated {p0} ({p1} aa).", { p0: label, p1: input.aaLength }));
      return true;
    }
    const row = createCustomRow(state.nextRowId++, label, input.sequence);
    if (provenance) Object.assign(row, provenance);
    if (input.sourceDnaSequence) row.sourceDnaSequence = input.sourceDnaSequence;
    ctx.appendRow(row);
    ctx.invalidateDnaConstruct();
    ctx.closeAddProteinDialog();
    ctx.render();
    ctx.setBuilderStatus(i18nUi.text("Added {p0} ({p1} aa) to the chain.", { p0: label, p1: input.aaLength }));
    return true;
  };
}

export { countAminoAcids };
