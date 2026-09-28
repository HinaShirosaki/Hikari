export function normalizeStructureData(input) {
  const smiles = String(input?.smiles || '').trim();
  const molfile = String(input?.molfile || '').trim();
  const imageDataUrl = String(input?.imageDataUrl || '').trim();
  if (!smiles && !molfile && !imageDataUrl) {
    return null;
  }
  return { smiles, molfile, imageDataUrl };
}

export function toStructureDraft(input) {
  return {
    smiles: String(input?.smiles || '').trim(),
    molfile: String(input?.molfile || '').trim(),
    imageDataUrl: String(input?.imageDataUrl || '').trim()
  };
}

export function buildStructureClipboardNotFoundMessage(formats = []) {
  const base = 'No MOL, SDF, or SMILES structure data found on the clipboard.';
  const visibleFormats = Array.from(new Set((Array.isArray(formats) ? formats : [])
    .map((format) => String(format || '').trim())
    .filter(Boolean)));
  if (!visibleFormats.length) {
    return base;
  }
  return `${base} Clipboard formats seen: ${visibleFormats.slice(0, 8).join(', ')}.`;
}
