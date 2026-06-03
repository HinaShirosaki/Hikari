import * as indexModule from './sequence-viewer/index.js';
import * as alignmentModule from './sequence-viewer/alignment.js';
import * as detailAlignmentModule from './sequence-viewer/detail-alignment.js';
import * as orfAnalysisModule from './sequence-viewer/orf-analysis.js';
import * as parsingModule from './sequence-viewer/parsing.js';
import * as renderingModule from './sequence-viewer/rendering.js';
import * as restrictionAnalysisModule from './sequence-viewer/restriction-analysis.js';
import * as sharedModule from './sequence-viewer/shared.js';
import * as storageModule from './sequence-viewer/storage.js';

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
  const getApiBridge = typeof options?.getApiBridge === 'function'
    ? options.getApiBridge
    : () => options?.apiBridge
      || options?.bridge
      || globalThis?.window?.enanaApi
      || globalThis?.enanaApi
      || ((typeof window !== 'undefined' && window?.enanaApi) ? window.enanaApi : null);
  return indexModule.initSequenceViewer({
    ...options,
    document: options?.document || globalThis?.document || (typeof document !== 'undefined' ? document : null),
    apiBridge: getApiBridge(),
    getApiBridge,
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

export function parseAb1Record(rawInput, options = {}) {
  return parsingModule.parseAb1Record(rawInput, options);
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

export function alignSequenceToReference(referenceRecord, queryRecord, options = {}) {
  return alignmentModule.alignSequenceToReference(referenceRecord, queryRecord, options);
}

export function renderAlignmentTracePanelHtml(input = {}) {
  return detailAlignmentModule.renderAlignmentTracePanelHtml(input);
}

export function buildCircularPreviewHtmlDocument(record) {
  return storageModule.buildCircularPreviewHtmlDocument(record);
}
