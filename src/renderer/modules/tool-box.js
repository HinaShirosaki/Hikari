import { initToolBoxViewManager } from './tool-box/view-manager.js';
import { initMolarityTool } from './tool-box/molarity-ui.js';
import { initPeptideTool } from './sequence-viewer/calculations/ui/peptide-tool.js';
import { initTranslationTool } from './sequence-viewer/calculations/ui/translation-tool.js';
import { initOligoTool } from './sequence-viewer/calculations/ui/oligo-tool.js';
import { initExtinctionTool } from './sequence-viewer/calculations/ui/extinction-tool.js';
import { initQpcrTool } from './tool-box/qpcr-ui.js';
import { initBufferTool } from './tool-box/buffer-ui.js';
import { initFixedReactionTool } from './tool-box/fixed-reaction-ui.js';
import { initCrisprTool } from './sequence-viewer/calculations/ui/crispr-tool.js';
import { toNumber } from './tool-box/common.js';
import {
  concentrationToM,
  concentrationFromM,
  volumeToL,
  volumeFromL,
  massToG,
  massFromG
} from '../lib/molarity.js';
import {
  cleanNucleotideSequence,
  nucleotideCounts,
  reverseComplementDna,
  translateDnaSequence,
  cleanProteinSequence,
  parseRestrictionSites,
  getCodonOptionsForResidue,
  reverseTranslateProteinSequence,
  formatSequenceLines
} from './sequence-viewer/calculations/sequence.js';
import { oligoMolecularWeight, oligoExtinction, oligoTm } from './sequence-viewer/calculations/oligo.js';
import {
  cleanSequence,
  countResidues,
  calculatePeptideMass,
  positiveCharge,
  negativeCharge,
  calculateNetCharge,
  estimatePI,
  residueSummary,
  peptideStats
} from './sequence-viewer/calculations/protein.js';
import { linearRegression } from './tool-box/qpcr.js';
import {
  normalizeIupacPattern,
  matchesIupacPattern,
  parseCrisprTargetsInput,
  collectCrisprPamSites,
  computeCrisprOffTargetStats,
  designCrisprGuides
} from './sequence-viewer/calculations/crispr.js';
import {
  calculateMolarityMass,
  calculateMolarityVolume,
  calculateMolarityConcentration,
  calculateMolarityDilution,
  calculateMolarity,
  parseBufferConcentration,
  calculateBufferIngredient,
  calculateBufferRecipe,
  calculateFixedReactionReagent,
  calculateFixedReaction
} from '../lib/bench-calculations.js';

export {
  toNumber,
  formatSequenceLines,
  concentrationToM,
  concentrationFromM,
  volumeToL,
  volumeFromL,
  massToG,
  massFromG,
  cleanNucleotideSequence,
  nucleotideCounts,
  reverseComplementDna,
  translateDnaSequence,
  cleanProteinSequence,
  parseRestrictionSites,
  getCodonOptionsForResidue,
  reverseTranslateProteinSequence,
  oligoMolecularWeight,
  oligoExtinction,
  oligoTm,
  linearRegression,
  cleanSequence,
  countResidues,
  calculatePeptideMass,
  positiveCharge,
  negativeCharge,
  calculateNetCharge,
  estimatePI,
  residueSummary,
  peptideStats,
  normalizeIupacPattern,
  matchesIupacPattern,
  parseCrisprTargetsInput,
  collectCrisprPamSites,
  computeCrisprOffTargetStats,
  designCrisprGuides,
  calculateMolarityMass,
  calculateMolarityVolume,
  calculateMolarityConcentration,
  calculateMolarityDilution,
  calculateMolarity,
  parseBufferConcentration,
  calculateBufferIngredient,
  calculateBufferRecipe,
  calculateFixedReactionReagent,
  calculateFixedReaction
};

export function initToolBox(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;

  const viewManager = initToolBoxViewManager({
    document: rootDocument,
    defaultViewId: 'tool-molarity-view'
  });

  const sharedOptions = {
    document: rootDocument,
    safeText: options?.safeText,
    getStoredCompounds: options?.getStoredCompounds
  };

  initMolarityTool(sharedOptions);
  initPeptideTool(sharedOptions);
  initTranslationTool(sharedOptions);
  initOligoTool(sharedOptions);
  initExtinctionTool(sharedOptions);
  initQpcrTool(sharedOptions);
  initBufferTool(sharedOptions);
  initFixedReactionTool(sharedOptions);
  initCrisprTool(sharedOptions);

  return viewManager;
}
