export const CHEMICAL_STRUCTURE_SAMPLE_TYPES = new Set(['chemical', 'compound']);

export function normalizeCompoundStructureData(input) {
  const smiles = String(input?.smiles || '').trim();
  const molfile = String(input?.molfile || '').trim();
  const imageDataUrl = String(input?.imageDataUrl || '').trim();
  if (!smiles && !molfile && !imageDataUrl) {
    return null;
  }
  return { smiles, molfile, imageDataUrl };
}

export function toCompoundStructureDraft(input) {
  return {
    smiles: String(input?.smiles || '').trim(),
    molfile: String(input?.molfile || '').trim(),
    imageDataUrl: String(input?.imageDataUrl || '').trim()
  };
}

export function emptyCompoundStructureDraft() {
  return { smiles: '', molfile: '', imageDataUrl: '' };
}

export function isChemicalStructureSampleType(sampleType) {
  return CHEMICAL_STRUCTURE_SAMPLE_TYPES.has(String(sampleType || '').trim().toLowerCase());
}

export function formatCompoundStructureSummary(structure) {
  const normalized = normalizeCompoundStructureData(structure);
  if (!normalized) {
    return '-';
  }
  if (normalized.smiles) {
    return normalized.smiles;
  }
  if (normalized.imageDataUrl) {
    return 'Snapshot only';
  }
  return 'Molfile only';
}

export function buildCompoundClipboardNotFoundMessage(formats = []) {
  const base = 'No CDXML, MOL, SDF, SMILES, InChI, or ChemDraw image found on the clipboard.';
  const visibleFormats = Array.from(new Set((Array.isArray(formats) ? formats : [])
    .map((format) => String(format || '').trim())
    .filter(Boolean)));
  if (!visibleFormats.length) {
    return base;
  }
  return `${base} Clipboard formats seen: ${visibleFormats.slice(0, 8).join(', ')}.`;
}
