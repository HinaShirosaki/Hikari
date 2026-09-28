import {
  buildStructureClipboardNotFoundMessage as buildCompoundClipboardNotFoundMessage,
  normalizeStructureData as normalizeCompoundStructureData,
  toStructureDraft as toCompoundStructureDraft
} from '../../lib/compound-structure.js';

export const CHEMICAL_STRUCTURE_SAMPLE_TYPES = new Set(['chemical', 'compound']);

export {
  buildCompoundClipboardNotFoundMessage,
  normalizeCompoundStructureData,
  toCompoundStructureDraft
};

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
