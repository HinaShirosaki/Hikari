import { initSequenceViewer as initSequenceViewerInternal } from './index.js';

export {
  complementBase,
  complementSequence,
  computeGcPercent,
  countAmbiguousBases,
  detectSequenceFormat,
  normalizeSequenceText
} from './shared.js';

export {
  normalizeExternalPayload,
  parseAb1Record,
  parseFastaRecords,
  parseFastqRecords,
  parseGenBankLocationSegments,
  parseGenBankRecords,
  parseInputRecords,
  summarizeFastqQuality
} from './parsing.js';

export {
  getFeatureTypeGenbankKey,
  isPrimerBindingFeature,
  normalizeFeatureType
} from './feature-types.js';

export {
  buildCommercialRestrictionFeatures,
  buildRestrictionCutPolylinePoints,
  computeRestrictionAnnotationGeometry
} from './restriction-analysis.js';

export {
  buildOrfFeatures,
  buildSelectedOrfTranslationContext
} from './orf-analysis.js';

export {
  STANDARD_AMINO_ACIDS,
  buildAminoAcidSubstitution,
  chooseClosestAminoAcidCodon,
  resolveAminoAcidCodonContext
} from './amino-acid-substitution.js';

export {
  buildEditedSequenceName,
  buildProteinArchitectureName,
  buildProteinTargetLabel,
  buildVectorSequenceName,
  describeSequenceChanges,
  resolveVectorBackboneName
} from './sequence-naming.js';

export {
  formatSelectedFeatureDetailHtml,
  renderDualStrandSequenceLinesHtml
} from './rendering.js';

export { alignSequenceToReference } from './alignment.js';
export { buildAlignmentSequenceTrack } from './detail-alignment.js';
export {
  buildSequenceMapSvg,
  clampMapZoom,
  getMapKind,
  resolveBaseFromPoint
} from './vector-builder/sequence-map.js';
export {
  assembleCloningPlan,
  designCloningPrimers,
  designPcrPrimerPair,
  evaluateGibsonAssembly,
  evaluateOverlapPcr,
  evaluateRestrictionLigation,
  evaluateSiteDirectedMutagenesis
} from './cloning-assembly.js';
export {
  postProcessAb1Trace,
  trimByMottAlgorithm as trimAb1ByMottAlgorithm
} from './algorithms/ab1-trace-postprocess.js';

function readWrapperStoragePath() {
  try {
    const storage = globalThis?.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = storage?.getItem?.('hikari_state_v1');
    if (!raw) {
      return '';
    }
    const parsed = JSON.parse(raw);
    return String(parsed?.settings?.storagePath || '').trim();
  } catch {
    return '';
  }
}

export function initSequenceViewer(options = {}) {
  const getApiBridge = typeof options?.getApiBridge === 'function'
    ? options.getApiBridge
    : () => options?.apiBridge || options?.bridge || globalThis?.hikariApi || null;
  const explicitStoragePath = String(options?.storagePath || '').trim();
  const getStoragePath = typeof options?.getStoragePath === 'function'
    ? options.getStoragePath
    : () => explicitStoragePath || readWrapperStoragePath();
  return initSequenceViewerInternal({
    ...options,
    document: options?.document || globalThis?.document || (typeof document !== 'undefined' ? document : null),
    apiBridge: getApiBridge(),
    getApiBridge,
    getStoragePath,
    storagePath: explicitStoragePath
  });
}
