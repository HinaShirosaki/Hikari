import {
  buildSequenceSignature,
  cleanText,
  clamp,
  normalizeRecordName,
  normalizeSequenceText,
  normalizeTopology
} from '../shared.js';
import {
  FEATURE_SOURCE_BACKBONE_RECOGNITION,
  RECOGNIZED_BACKBONE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_SCHEMA_VERSION
} from './config.js';

export function isBackboneRecognitionFeature(feature) {
  return String(feature?.source || '').toLowerCase() === FEATURE_SOURCE_BACKBONE_RECOGNITION;
}

export function removeBackboneRecognitionFeatures(features) {
  return (Array.isArray(features) ? features : []).filter((feature) => !isBackboneRecognitionFeature(feature));
}

export function getRecognitionCandidates(match) {
  return Array.isArray(match?.candidateSelections) ? match.candidateSelections : [];
}

export function getRecognitionDisplayMatch(match, selection = {}) {
  const safeMatch = match && typeof match === 'object' ? match : null;
  if (!safeMatch) {
    return null;
  }

  const selectedCandidate = getRecognitionSelectedCandidate(safeMatch, selection?.candidateId || safeMatch.selectedCandidateId || '');
  const requestedVariantMode = selection?.variantMode === 'restriction' ? 'restriction' : 'gibson';
  const requestedVariant = selectedCandidate?.variants?.[requestedVariantMode];
  const fallbackVariant = safeMatch.variants?.gibson || safeMatch.variants?.restriction;
  const activeVariant = requestedVariant && typeof requestedVariant === 'object' ? requestedVariant : fallbackVariant;
  const activeVariantMode = requestedVariant && typeof requestedVariant === 'object'
    ? requestedVariantMode
    : (safeMatch.variants?.restriction && !safeMatch.variants?.gibson ? 'restriction' : 'gibson');
  if (!activeVariant || typeof activeVariant !== 'object') {
    return safeMatch;
  }

  return {
    ...safeMatch,
    selectedCandidateId: String(selectedCandidate?.id || safeMatch.selectedCandidateId || ''),
    activeVariantMode,
    promoter: selectedCandidate?.promoter || safeMatch.promoter || null,
    orf: selectedCandidate?.orf || safeMatch.orf || null,
    startCodon: activeVariant?.startCodon || selectedCandidate?.orf?.startCodon || '',
    stopCodon: activeVariant?.stopCodon || selectedCandidate?.orf?.stopCodon || '',
    upstreamSite: activeVariant?.upstreamSite || null,
    downstreamSite: activeVariant?.downstreamSite || null,
    siteExtensionApplied: Boolean(activeVariant?.siteExtensionApplied),
    backboneSequence: String(activeVariant?.backboneSequence || safeMatch.backboneSequence || ''),
    insertSequence: String(activeVariant?.insertSequence || safeMatch.insertSequence || ''),
    backboneLength: Math.max(0, Number(activeVariant.backboneLength) || 0),
    insertLength: Math.max(0, Number(activeVariant.insertLength) || 0),
    backboneSegments: Array.isArray(activeVariant.backboneSegments) ? activeVariant.backboneSegments : safeMatch.backboneSegments,
    insertSegments: Array.isArray(activeVariant.insertSegments) ? activeVariant.insertSegments : safeMatch.insertSegments
  };
}

export function buildRecognizedBackboneArtifact({ match, record, selection = {}, state }) {
  const displayMatch = getRecognitionDisplayMatch(match, selection);
  const normalizedSequence = normalizeSequenceText(record?.sequence || '');
  if (!displayMatch || !normalizedSequence.length) {
    return null;
  }

  const recordName = normalizeRecordName(record?.name || 'sequence', 'sequence');
  const recordSignature = buildSequenceSignature(normalizedSequence, 'seq') || `seq_${normalizedSequence.length}`;
  const hostVectorName = cleanText(displayMatch?.hostVectorName, 140) || 'Promoter-aligned backbone';
  const backboneSegments = normalizeRecognitionSegments(displayMatch?.backboneSegments, normalizedSequence.length);
  const insertSegments = normalizeRecognitionSegments(displayMatch?.insertSegments, normalizedSequence.length);
  const backboneSequence = normalizeSequenceText(displayMatch?.backboneSequence || buildSequenceFromSegments(normalizedSequence, backboneSegments));
  const insertSequence = normalizeSequenceText(displayMatch?.insertSequence || buildSequenceFromSegments(normalizedSequence, insertSegments));

  return {
    fileName: `${sanitizeStorageArtifactPart(recordName, 'sequence')}__${recordSignature}.recognized-backbone.json`,
    data: {
      schema_name: RECOGNIZED_BACKBONE_SCHEMA_NAME,
      schema_version: RECOGNIZED_BACKBONE_SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
      source_record: {
        name: recordName,
        entry_id: cleanText(state.activeEntryId, 200),
        entry_status: cleanText(state.activeEntryStatus, 40),
        sequence_signature: recordSignature,
        topology: normalizeTopology(record?.topology || 'linear')
      },
      recognition: buildRecognitionArtifactMeta(displayMatch, hostVectorName),
      backbone: { name: `Backbone (${hostVectorName})`, type: 'backbone', sequence: backboneSequence, sequence_length: backboneSequence.length, segments: backboneSegments },
      insert: { name: `Insert (${hostVectorName})`, type: 'insert', sequence: insertSequence, sequence_length: insertSequence.length, segments: insertSegments }
    }
  };
}

function getRecognitionSelectedCandidate(match, candidateId = '') {
  const candidates = getRecognitionCandidates(match);
  return candidates.find((candidate) => String(candidate?.id || '') === String(candidateId || ''))
    || candidates[0]
    || null;
}

function normalizeRecognitionSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function buildSequenceFromSegments(sequence, segments) {
  const normalizedSequence = normalizeSequenceText(sequence);
  return normalizedSequence.length
    ? normalizeRecognitionSegments(segments, normalizedSequence.length).map((segment) => normalizedSequence.slice(segment.start, segment.end)).join('')
    : '';
}

function sanitizeStorageArtifactPart(value, fallback = 'artifact') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function buildRecognitionArtifactMeta(displayMatch, hostVectorName) {
  const variantMode = displayMatch?.activeVariantMode === 'restriction' ? 'restriction' : 'gibson';
  return {
    host_vector_id: cleanText(displayMatch?.hostVectorId, 200),
    host_vector_name: hostVectorName,
    host_vector_status: cleanText(displayMatch?.hostVectorStatus, 40),
    recognition_source: cleanText(displayMatch?.recognitionSource, 80),
    variant_mode: variantMode,
    candidate_id: cleanText(displayMatch?.selectedCandidateId, 120),
    promoter_name: cleanText(displayMatch?.promoter?.name, 160),
    orf_name: cleanText(displayMatch?.orf?.name, 160),
    start_codon: cleanText(displayMatch?.startCodon, 12),
    stop_codon: cleanText(displayMatch?.stopCodon, 12),
    upstream_site_name: cleanText(displayMatch?.upstreamSite?.name, 120),
    downstream_site_name: cleanText(displayMatch?.downstreamSite?.name, 120)
  };
}
