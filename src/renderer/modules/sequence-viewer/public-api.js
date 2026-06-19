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
  formatSelectedFeatureDetailHtml,
  renderDualStrandSequenceLinesHtml
} from './rendering.js';

export { alignSequenceToReference } from './alignment.js';
export { renderAlignmentTracePanelHtml } from './detail-alignment.js';
export { buildCircularPreviewHtmlDocument } from './storage.js';
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
