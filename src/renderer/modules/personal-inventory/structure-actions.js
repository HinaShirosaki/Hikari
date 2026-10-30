import {
  readChemicalStructureClipboard,
  toChemicalStructureDraftFromCandidate
} from './chemical-structure-clipboard.js';
import { sampleUi, sampleNotice, sampleClipboardMessage } from './localization.js';

export function installStructureActions(ctx) {
  const { helpers, pendingStructureDrafts, persist } = ctx;

async function applyStructurePasteCandidates(candidates, formats = []) {
  const supportedCandidates = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.sourceFormat !== 'image');
  if (!supportedCandidates.length) {
    ctx.setStructureStatus(sampleClipboardMessage(formats), true);
    return false;
  }

  for (const candidate of supportedCandidates) {
    const directDraft = toChemicalStructureDraftFromCandidate(candidate);
    if (directDraft) {
      const draft = ctx.toStructureDraft(directDraft);
      ctx.applyCapturedStructureDraft(draft);
      return true;
    }
  }

  ctx.setStructureStatus(sampleUi('structure.unsupported'), true);
  sampleNotice(sampleUi('structure.unsupported'), { type: 'error' });
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
    ctx.setStructureStatus(sampleUi('structure.reading'));
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
    }
    if (!normalized) {
      sampleNotice(sampleUi('structure.empty'), { type: 'error' });
    }
    ctx.setStructureStatus(normalized ? sampleUi('structure.saved') : sampleUi('structure.empty'), !normalized);
    return;
  }

  if (normalized) {
    pendingStructureDrafts.set(context.pendingKey, normalized);
    ctx.setStructureStatus(sampleUi('structure.ready'));
  } else {
    pendingStructureDrafts.delete(context.pendingKey);
    sampleNotice(sampleUi('structure.empty'), { type: 'error' });
    ctx.setStructureStatus(sampleUi('structure.empty'), true);
  }
}

  Object.assign(ctx, {
    buildStructurePasteContextFromButton,
    applyStructurePasteCandidates,
    pasteInventoryStructure,
    applyCapturedStructureDraft
  });
}
