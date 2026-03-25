import { initToolBoxViewManager } from './tool-box/view-manager.js';
import { initMolarityTool } from './tool-box/molarity-ui.js';
import { initPeptideTool } from './tool-box/peptide-ui.js';
import { initTranslationTool } from './tool-box/translation-ui.js';
import { initProteinAssemblyTool } from './tool-box/protein-assembly-ui.js';
import { initOligoTool } from './tool-box/oligo-ui.js';
import { initExtinctionTool } from './tool-box/extinction-ui.js';
import { initQpcrTool } from './tool-box/qpcr-ui.js';
import { initBufferTool } from './tool-box/buffer-ui.js';
import { initPlannotateTool } from './tool-box/plannotate-ui.js';
import { initCrisprTool } from './tool-box/crispr-ui.js';
import { toNumber, formatSequenceLines } from './tool-box/common.js';
import {
  concentrationToM,
  concentrationFromM,
  volumeToL,
  volumeFromL,
  massToG,
  massFromG
} from './tool-box/molarity.js';
import {
  cleanNucleotideSequence,
  nucleotideCounts,
  reverseComplementDna,
  translateDnaSequence,
  cleanProteinSequence,
  parseRestrictionSites,
  getCodonOptionsForResidue,
  reverseTranslateProteinSequence
} from './tool-box/sequence.js';
import { oligoMolecularWeight, oligoExtinction, oligoTm } from './tool-box/oligo.js';
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
} from './tool-box/peptide.js';
import { linearRegression } from './tool-box/qpcr.js';
import { renderChemicalOptions } from './tool-box/buffer.js';
import {
  normalizeIupacPattern,
  matchesIupacPattern,
  parseCrisprTargetsInput,
  collectCrisprPamSites,
  computeCrisprOffTargetStats,
  designCrisprGuides
} from './tool-box/crispr.js';

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
  renderChemicalOptions,
  normalizeIupacPattern,
  matchesIupacPattern,
  parseCrisprTargetsInput,
  collectCrisprPamSites,
  computeCrisprOffTargetStats,
  designCrisprGuides
};

export function initToolBox(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  const onOpenSequenceViewer = typeof options?.onOpenSequenceViewer === 'function'
    ? options.onOpenSequenceViewer
    : null;

  const viewManager = initToolBoxViewManager({
    document: rootDocument,
    defaultViewId: 'tool-molarity-view'
  });

  const sharedOptions = {
    document: rootDocument
  };

  initMolarityTool(sharedOptions);
  initPeptideTool(sharedOptions);
  initTranslationTool(sharedOptions);
  initProteinAssemblyTool(sharedOptions);
  initOligoTool(sharedOptions);
  initExtinctionTool(sharedOptions);
  initQpcrTool(sharedOptions);
  initBufferTool(sharedOptions);
  // Keep the plannotate-open-sequence-viewer handoff contract anchored here.
  initPlannotateTool({
    ...sharedOptions,
    onOpenSequenceViewer
  });
  initCrisprTool(sharedOptions);

  return viewManager;
}
