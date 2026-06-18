import {
  readChemicalStructureClipboard,
  toChemicalStructureDraftFromCandidate
} from '../chemical-structure-clipboard.js';

export function installStructureActions(ctx) {
  const { helpers, pendingStructureDrafts, persist } = ctx;
  const notifySamplesChanged = () => ctx.notifySamplesChanged();

async function applyStructurePasteCandidates(candidates, formats = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    ctx.setStructureStatus(ctx.buildStructureClipboardNotFoundMessage(formats));
    return false;
  }

  for (const candidate of candidates) {
    const directDraft = toChemicalStructureDraftFromCandidate(candidate);
    if (directDraft) {
      const draft = ctx.toStructureDraft(directDraft);
      ctx.applyCapturedStructureDraft(draft);
      return true;
    }
  }

  ctx.setStructureStatus('Cannot save that structure yet. Try SMILES, MOL/SDF, or a copied image.');
  return false;
}

function buildStructurePasteContextFromButton(button, pasteDatasetKey) {
  const mode = String(button.dataset[pasteDatasetKey] || '');
  const typeInput = ctx.getStructureTypeInput(mode);
  if (!ctx.isChemicalSampleType(typeInput?.value)) {
    ctx.syncStructureButtons();
    return null;
  }

  const sampleId = String(button.dataset.sampleId || '');
  return {
    mode,
    sampleId,
    pendingKey: ctx.getPendingStructureKey(mode)
  };
}

async function pasteInventoryStructure(button) {
  const context = ctx.buildStructurePasteContextFromButton(button, 'inventorySampleStructurePaste');
  if (!context) {
    return;
  }
  ctx.structurePasteContext = context;
  try {
    ctx.setStructureStatus('Reading chemical structure from clipboard...');
    const clipboard = await readChemicalStructureClipboard();
    await applyStructurePasteCandidates(clipboard.candidates, clipboard.formats);
  } finally {
    ctx.structurePasteContext = null;
    ctx.syncStructureButtons();
  }
}

function applyCapturedStructureDraft(draft) {
  const context = ctx.structurePasteContext;
  if (!context) {
    return;
  }
  const normalized = ctx.normalizeStructureData(draft);
  if (context.sampleId) {
    const sample = helpers.getSampleById(context.sampleId);
    if (sample) {
      sample.type = 'chemical';
      sample.compoundStructure = normalized;
      sample.updatedAt = new Date().toISOString();
      persist();
      notifySamplesChanged();
    }
    ctx.setStructureStatus(normalized ? 'Structure saved for this sample.' : 'No structure detected.');
    return;
  }

  if (normalized) {
    pendingStructureDrafts.set(context.pendingKey, normalized);
    ctx.setStructureStatus('Structure ready. Click Add Sample to save it.');
  } else {
    pendingStructureDrafts.delete(context.pendingKey);
    ctx.setStructureStatus('No structure detected.');
  }
}

  Object.assign(ctx, {
    buildStructurePasteContextFromButton,
    applyStructurePasteCandidates,
    pasteInventoryStructure,
    applyCapturedStructureDraft
  });
}
