import {
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_SELF_CLEAVING,
  PROTEIN_ASSEMBLY_TAGS
} from './assembly-model.js';

export const BLOCK_TYPE_LABELS = Object.freeze({
  tag: 'Tag',
  linker: 'Linker',
  cleavage: 'Cleavage Site',
  peptide2a: '2A Peptide',
  feature: 'Feature DB',
  custom: 'Custom',
  poi: 'Current DNA'
});

export const DNA_ALPHABET = /^[ACGTRYSWKMBDHVN*]+$/;
export const PROTEIN_DIRECT_CLONING_MAX_AA = 20;
export const DEFAULT_CHAIN = Object.freeze([
  { kind: 'library', type: 'tag', libraryId: 'his6' },
  { kind: 'library', type: 'cleavage', libraryId: 'tev' },
  { kind: 'poi', type: 'poi' }
]);

export const COMMON_BLOCK_GROUPS = Object.freeze([
  {
    id: 'tag',
    label: 'Common peptide tags',
    items: PROTEIN_ASSEMBLY_TAGS
  },
  {
    id: 'linker',
    label: 'Linkers',
    items: PROTEIN_ASSEMBLY_LINKERS
  },
  {
    id: 'cleavage',
    label: 'Protease sites',
    items: PROTEIN_ASSEMBLY_CLEAVAGE_SITES
  },
  {
    id: 'peptide2a',
    label: 'Self-cleaving 2A peptides',
    items: PROTEIN_ASSEMBLY_SELF_CLEAVING
  }
]);

// A 2A block means the ORF is translated as one chain but yields separate
// polypeptides, so anything reporting a single product has to account for it.
export const SELF_CLEAVING_BLOCK_TYPE = 'peptide2a';

function buildLibraryLookup() {
  const lookup = new Map();
  COMMON_BLOCK_GROUPS.forEach((group) => {
    (group.items || []).forEach((item) => {
      lookup.set(`${group.id}:${item.id}`, {
        type: group.id,
        ...item
      });
    });
  });
  return lookup;
}

export const LIBRARY_LOOKUP = buildLibraryLookup();

export function getBlockTypeLabel(type) {
  return BLOCK_TYPE_LABELS[String(type || '').trim().toLowerCase()] || 'Custom';
}
