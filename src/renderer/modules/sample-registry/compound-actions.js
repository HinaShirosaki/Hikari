import {
  getChemicalStructureCandidatesFromClipboardData,
  readChemicalStructureClipboard,
  toChemicalStructureDraftFromCandidate
} from '../../services/chemical-structure-clipboard.js';
import {
  buildCompoundClipboardNotFoundMessage,
  emptyCompoundStructureDraft,
  isChemicalStructureSampleType,
  toCompoundStructureDraft
} from './compound-model.js';
import {
  renderCompoundFields,
  setCompoundStatus
} from './compound-dialog.js';

export async function onCompoundPasteClick(ctx) {
  if (!isChemicalStructureSampleType(ctx.dom.sampleTypeInput?.value)) {
    return;
  }
  setCompoundStatus(ctx, 'Reading chemical structure from clipboard...', false);
  const clipboard = await readChemicalStructureClipboard();
  await applyCompoundStructurePasteCandidates(ctx, clipboard.candidates, clipboard.formats);
}

export function onCompoundStructurePaste(ctx, event) {
  if (!isChemicalStructureSampleType(ctx.dom.sampleTypeInput?.value)) {
    return;
  }
  const candidates = getChemicalStructureCandidatesFromClipboardData(event.clipboardData);
  if (!candidates.length) {
    return;
  }
  event.preventDefault();
  setCompoundStatus(ctx, 'Reading pasted chemical structure...', false);
  applyCompoundStructurePasteCandidates(ctx, candidates, Array.from(event.clipboardData?.types || [])).catch(() => {
    setCompoundStatus(ctx, 'Cannot save that structure yet. Try SMILES, MOL/SDF, or a copied image.', true);
  });
}

export async function applyCompoundStructurePasteCandidates(ctx, candidates, formats = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    setCompoundStatus(ctx, buildCompoundClipboardNotFoundMessage(formats), true);
    return false;
  }

  for (const candidate of candidates) {
    const draft = toChemicalStructureDraftFromCandidate(candidate);
    if (draft) {
      ctx.compoundStructureDraft = toCompoundStructureDraft(draft);
      renderCompoundFields(ctx);
      setCompoundStatus(ctx, buildCompoundPasteStatus(ctx.compoundStructureDraft), false);
      return true;
    }
  }

  setCompoundStatus(ctx, 'Cannot save that structure yet. Try SMILES, MOL/SDF, or a copied image.', true);
  return false;
}

function buildCompoundPasteStatus(draft) {
  if (draft.imageDataUrl && !draft.smiles && !draft.molfile) {
    return 'Structure image pasted from clipboard. Save the sample to keep it.';
  }
  if (draft.smiles) {
    return 'SMILES pasted from clipboard. Save the sample to keep it.';
  }
  if (draft.molfile) {
    return 'MOL/SDF structure pasted from clipboard. Save the sample to keep it.';
  }
  return 'Structure pasted from clipboard. Save the sample to keep it.';
}

export function onCompoundClearClick(ctx) {
  ctx.compoundStructureDraft = emptyCompoundStructureDraft();
  renderCompoundFields(ctx);
  setCompoundStatus(ctx, 'Chemical structure cleared.', false);
}
