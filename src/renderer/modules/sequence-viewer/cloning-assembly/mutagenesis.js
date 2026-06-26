import { designSimpleMutagenesisPrimers } from './mutagenesis-simple.js';
import { designTiledInsertionOligos } from './mutagenesis-tiling.js';

export function designMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const simpleDesign = designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config);
  if (simpleDesign.feasible) {
    return simpleDesign;
  }

  if (normalizedEdit.type === 'insertion' || normalizedEdit.type === 'replacement') {
    return designTiledInsertionOligos(templateSequence, normalizedEdit, thresholds, config);
  }

  return simpleDesign;
}
