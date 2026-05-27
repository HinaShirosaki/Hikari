import { toCompoundStructureDraft } from './compound-model.js';
import { generateCompoundStructurePreview } from './compound-preview.js';
import { renderCompoundFields } from './compound-dialog.js';
import { delay } from './sample-utils.js';

export async function getCompoundKetcher(ctx) {
  const { sampleCompoundKetcherFrame } = ctx.dom;
  if (!sampleCompoundKetcherFrame || !sampleCompoundKetcherFrame.contentWindow) {
    throw new Error('Ketcher frame not loaded.');
  }
  let editorFrame = null;
  try {
    editorFrame = sampleCompoundKetcherFrame.contentWindow.document.getElementById('editor');
  } catch {
    throw new Error('Cannot access Ketcher host frame.');
  }
  const ketcher = editorFrame?.contentWindow?.ketcher;
  if (!ketcher) {
    throw new Error('Ketcher is still initializing.');
  }
  return ketcher;
}

export async function waitForCompoundKetcher(ctx) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await getCompoundKetcher(ctx);
    } catch {
      await delay(180);
    }
  }
  throw new Error('Ketcher is still initializing.');
}

export async function captureCompoundStructureFromEditor(ctx) {
  const ketcher = await getCompoundKetcher(ctx);
  const smiles = String(await ketcher.getSmiles()).trim();
  const molfile = String(await ketcher.getMolfile('v3000')).trim();
  const imageDataUrl = await generateCompoundStructurePreview(ketcher, molfile || smiles);
  ctx.compoundStructureDraft = toCompoundStructureDraft({ smiles, molfile, imageDataUrl });
  renderCompoundFields(ctx);
}

export async function loadCompoundStructureSource(ctx, structureSource) {
  const source = String(structureSource || '').trim();
  if (!source) {
    throw new Error('No structure source provided.');
  }
  const ketcher = await waitForCompoundKetcher(ctx);
  await ketcher.setMolecule(source);
  if (typeof ketcher.layout === 'function') {
    try {
      await ketcher.layout();
    } catch {
      // Layout is best-effort; setMolecule already loaded the structure.
    }
  }
  await captureCompoundStructureFromEditor(ctx);
}

export async function syncCompoundDraftToEditor(ctx) {
  const molecule = ctx.compoundStructureDraft.molfile || ctx.compoundStructureDraft.smiles || '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const ketcher = await getCompoundKetcher(ctx);
      await ketcher.setMolecule(molecule);
      return true;
    } catch {
      await delay(180);
    }
  }
  return false;
}

export async function clearCompoundCanvas(ctx) {
  try {
    const ketcher = await getCompoundKetcher(ctx);
    await ketcher.setMolecule('');
  } catch {
    // Ignore clear errors. The local draft is already reset.
  }
}
