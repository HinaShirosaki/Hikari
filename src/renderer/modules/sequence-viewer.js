import * as indexModule from './sequence-viewer/index.js';
import * as orfAnalysisModule from './sequence-viewer/orf-analysis.js';
import * as parsingModule from './sequence-viewer/parsing.js';
import * as renderingModule from './sequence-viewer/rendering.js';
import * as restrictionAnalysisModule from './sequence-viewer/restriction-analysis.js';
import * as sharedModule from './sequence-viewer/shared.js';

function readWrapperStoragePath() {
  try {
    const storage = globalThis?.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = storage?.getItem?.('enana_state_v1');
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
  const bridge = options?.apiBridge
    || options?.bridge
    || globalThis?.window?.enanaApi
    || globalThis?.enanaApi
    || ((typeof window !== 'undefined' && window?.enanaApi) ? window.enanaApi : null);
  return indexModule.initSequenceViewer({
    ...options,
    document: options?.document || globalThis?.document || (typeof document !== 'undefined' ? document : null),
    apiBridge: bridge,
    storagePath: String(options?.storagePath || readWrapperStoragePath() || '').trim()
  });
}

export function normalizeSequenceText(raw) {
  return sharedModule.normalizeSequenceText(raw);
}

export function detectSequenceFormat(rawText) {
  return sharedModule.detectSequenceFormat(rawText);
}

export function parseFastaRecords(rawInput, options = {}) {
  return parsingModule.parseFastaRecords(rawInput, options);
}

export function parseFastqRecords(rawInput, options = {}) {
  return parsingModule.parseFastqRecords(rawInput, options);
}

export function parseGenBankRecords(rawInput) {
  return parsingModule.parseGenBankRecords(rawInput);
}

export function parseInputRecords(rawInput, options = {}) {
  return parsingModule.parseInputRecords(rawInput, options);
}

export function normalizeExternalPayload(payload) {
  return parsingModule.normalizeExternalPayload(payload);
}

export function parseGenBankLocationSegments(rawExpression, sequenceLength, strand = 1) {
  return parsingModule.parseGenBankLocationSegments(rawExpression, sequenceLength, strand);
}

export function complementBase(base) {
  return sharedModule.complementBase(base);
}

export function complementSequence(sequence) {
  return sharedModule.complementSequence(sequence);
}

export function buildCommercialRestrictionFeatures(sequence, topology = 'linear', options = {}) {
  return restrictionAnalysisModule.buildCommercialRestrictionFeatures(sequence, topology, options);
}

export function buildOrfFeatures(sequence, topology = 'linear', options = {}) {
  return orfAnalysisModule.buildOrfFeatures(sequence, topology, options);
}

export function buildSelectedOrfTranslationContext(sequence, feature, options = {}) {
  return orfAnalysisModule.buildSelectedOrfTranslationContext(sequence, feature, options);
}

export function renderDualStrandSequenceLinesHtml(sequence, highlightedSegments = [], options = {}) {
  return renderingModule.renderDualStrandSequenceLinesHtml(sequence, highlightedSegments, options);
}

export function computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, charAdvancePx, cutBaseIndex = null) {
  return restrictionAnalysisModule.computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, charAdvancePx, cutBaseIndex);
}

export function buildRestrictionCutPolylinePoints(
  widthPx,
  topCutLocalPx,
  bottomCutLocalPx,
  boxHeightPx,
  topRowHeightPx,
  strandGapPx,
  labelGapPx
) {
  return restrictionAnalysisModule.buildRestrictionCutPolylinePoints(
    widthPx,
    topCutLocalPx,
    bottomCutLocalPx,
    boxHeightPx,
    topRowHeightPx,
    strandGapPx,
    labelGapPx
  );
}

export function formatSelectedFeatureDetailHtml(feature, sequenceLength) {
  return renderingModule.formatSelectedFeatureDetailHtml(feature, sequenceLength);
}

export function computeGcPercent(sequence) {
  return sharedModule.computeGcPercent(sequence);
}

export function countAmbiguousBases(sequence) {
  return sharedModule.countAmbiguousBases(sequence);
}

export function summarizeFastqQuality(qualityText) {
  return parsingModule.summarizeFastqQuality(qualityText);
}
