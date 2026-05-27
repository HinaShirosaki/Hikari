import {
  getChemicalStructureCandidatesFromClipboardData,
  readChemicalStructureClipboard
} from '../chemical-structure-clipboard.js';
import {
  buildCompoundClipboardNotFoundMessage,
  emptyCompoundStructureDraft,
  isChemicalStructureSampleType,
  toCompoundStructureDraft
} from './compound-model.js';
import {
  closeCompoundDialog,
  openCompoundDialog,
  renderCompoundFields,
  setCompoundStatus
} from './compound-dialog.js';
import {
  captureCompoundStructureFromEditor,
  clearCompoundCanvas,
  loadCompoundStructureSource,
  syncCompoundDraftToEditor
} from './compound-ketcher.js';

export async function onCompoundOpenClick(ctx) {
  if (!isChemicalStructureSampleType(ctx.dom.sampleTypeInput?.value)) {
    return;
  }
  openCompoundDialog(ctx);
  const loaded = await syncCompoundDraftToEditor(ctx);
  if (!loaded) {
    setCompoundStatus(ctx, 'Ketcher is still loading.', true);
    return;
  }
  setCompoundStatus(ctx, 'Ketcher is ready. Draw the structure and apply it to the sample.', false);
}

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
    setCompoundStatus(ctx, 'Cannot render that structure yet. Try Copy As CDXML or MOL from ChemDraw.', true);
  });
}

export async function onCompoundDialogApplyClick(ctx) {
  try {
    await captureCompoundStructureFromEditor(ctx);
    closeCompoundDialog(ctx);
    setCompoundStatus(ctx, ctx.compoundStructureDraft.smiles ? 'Structure snapshot saved with this sample.' : 'No structure detected on canvas.', false);
  } catch {
    setCompoundStatus(ctx, 'Cannot read Ketcher yet. Wait a second and try again.', true);
  }
}

export async function applyCompoundStructurePasteCandidates(ctx, candidates, formats = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    setCompoundStatus(ctx, buildCompoundClipboardNotFoundMessage(formats), true);
    return false;
  }

  for (const candidate of candidates) {
    try {
      if (candidate?.imageDataUrl) {
        ctx.compoundStructureDraft = toCompoundStructureDraft({ imageDataUrl: candidate.imageDataUrl });
        renderCompoundFields(ctx);
        setCompoundStatus(ctx, 'Structure image pasted from clipboard. Save the sample to keep it.', false);
        return true;
      }
      await loadCompoundStructureSource(ctx, candidate.source);
      setCompoundStatus(ctx, 'Structure pasted from clipboard. Save the sample to keep it.', false);
      return true;
    } catch {
      // Try the next clipboard representation if Ketcher cannot parse this one.
    }
  }

  setCompoundStatus(ctx, 'Cannot render that structure yet. Try Copy As CDXML or MOL from ChemDraw.', true);
  return false;
}

export async function onCompoundCaptureClick(ctx) {
  if (!isChemicalStructureSampleType(ctx.dom.sampleTypeInput?.value)) {
    return;
  }
  try {
    await captureCompoundStructureFromEditor(ctx);
    setCompoundStatus(ctx, ctx.compoundStructureDraft.smiles ? 'Structure snapshot refreshed from Ketcher.' : 'No structure detected on canvas.', false);
  } catch {
    setCompoundStatus(ctx, 'Cannot read Ketcher yet. Open editor and try again.', true);
  }
}

export async function onCompoundClearClick(ctx) {
  ctx.compoundStructureDraft = emptyCompoundStructureDraft();
  renderCompoundFields(ctx);
  await clearCompoundCanvas(ctx);
  setCompoundStatus(ctx, 'Chemical structure cleared.', false);
}
