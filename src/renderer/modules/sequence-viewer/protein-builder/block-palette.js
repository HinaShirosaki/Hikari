export const PROTEIN_BUILDER_PALETTE_SIZE = 12;

export function getProteinBuilderPaletteSlot(position = 1) {
  const numericPosition = Math.max(1, Math.round(Number(position) || 1));
  return ((numericPosition - 1) % PROTEIN_BUILDER_PALETTE_SIZE) + 1;
}

export function getProteinBuilderPaletteClass(position = 1) {
  return `sequence-viewer-protein-builder-palette-${getProteinBuilderPaletteSlot(position)}`;
}
