import { readChemicalStructureClipboard } from '../chemical-structure-clipboard.js';

export function installStructureActions(ctx) {
  const { helpers, pendingStructureDrafts, persist } = ctx;
  const { sampleCompoundDialogOverlay } = ctx.elements;
  const notifySamplesChanged = () => ctx.notifySamplesChanged();

async function captureStructureFromSource(structureSource) {
  const source = String(structureSource || '').trim();
  if (!source) {
    throw new Error('No structure source provided.');
  }
  const ketcher = await ctx.waitForKetcherInstance();
  await ketcher.setMolecule(source);
  if (typeof ketcher.layout === 'function') {
    try {
      await ketcher.layout();
    } catch {
      // Layout is best-effort; setMolecule already loaded the structure.
    }
  }
  return ctx.captureStructureDraftFromEditor();
}

async function applyStructurePasteCandidates(candidates, formats = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    ctx.setStructureStatus(ctx.buildStructureClipboardNotFoundMessage(formats));
    return false;
  }

  for (const candidate of candidates) {
    try {
      const draft = candidate?.imageDataUrl
        ? ctx.toStructureDraft({ imageDataUrl: candidate.imageDataUrl })
        : await captureStructureFromSource(candidate.source);
      ctx.applyCapturedStructureDraft(draft);
      return true;
    } catch {
      // Try the next clipboard representation if Ketcher cannot parse this one.
    }
  }

  ctx.setStructureStatus('Cannot render that structure yet. Try Copy As CDXML or MOL from ChemDraw.');
  return false;
}

function buildStructureEditorContextFromButton(button, pasteDatasetKey) {
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

async function openInventoryStructureEditor(button) {
  const mode = String(button.dataset.inventorySampleStructureOpen || '');
  const typeInput = ctx.getStructureTypeInput(mode);
  if (!ctx.isChemicalSampleType(typeInput?.value)) {
    ctx.syncStructureButtons();
    return;
  }

  const sampleId = String(button.dataset.sampleId || '');
  const sample = sampleId ? helpers.getSampleById(sampleId) : null;
  const pendingKey = ctx.getPendingStructureKey(mode);
  const draft = sample
    ? ctx.toStructureDraft(sample.compoundStructure)
    : ctx.toStructureDraft(pendingStructureDrafts.get(pendingKey));

  ctx.structureEditorContext = { mode, sampleId, pendingKey };
  ctx.openStructureDialog();
  const loaded = await ctx.syncStructureDraftToEditor(draft);
  if (!loaded) {
    ctx.setStructureStatus('Ketcher is still loading. Try Add Structure again in a moment.');
    return;
  }
  ctx.setStructureStatus('Ketcher is ready.');
}

async function pasteInventoryStructure(button) {
  const context = ctx.buildStructureEditorContextFromButton(button, 'inventorySampleStructurePaste');
  if (!context) {
    return;
  }
  ctx.structureEditorContext = context;
  ctx.setStructureStatus('Reading chemical structure from clipboard...');
  const clipboard = await readChemicalStructureClipboard();
  await applyStructurePasteCandidates(clipboard.candidates, clipboard.formats);
  ctx.closeStructureDialog();
  ctx.syncStructureButtons();
}

function applyCapturedStructureDraft(draft) {
  const context = ctx.structureEditorContext;
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

async function onInventoryStructureApplyClick(event) {
  if (!ctx.structureEditorContext) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    const draft = await ctx.captureStructureDraftFromEditor();
    ctx.applyCapturedStructureDraft(draft);
  } catch {
    ctx.setStructureStatus('Cannot read Ketcher yet. Wait a second and try again.');
  } finally {
    ctx.closeStructureDialog();
    ctx.syncStructureButtons();
  }
}

function onInventoryStructureCloseClick(event) {
  if (!ctx.structureEditorContext) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  ctx.closeStructureDialog();
}

function onInventoryStructureOverlayClick(event) {
  if (!ctx.structureEditorContext || event.target !== sampleCompoundDialogOverlay) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  ctx.closeStructureDialog();
}

function onInventoryStructureKeydown(event) {
  if (event.key !== 'Escape' || !ctx.structureEditorContext) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  ctx.closeStructureDialog();
}

  Object.assign(ctx, {
    buildStructureEditorContextFromButton,
    captureStructureFromSource,
    applyStructurePasteCandidates,
    openInventoryStructureEditor,
    pasteInventoryStructure,
    applyCapturedStructureDraft,
    onInventoryStructureApplyClick,
    onInventoryStructureCloseClick,
    onInventoryStructureOverlayClick,
    onInventoryStructureKeydown
  });
}
