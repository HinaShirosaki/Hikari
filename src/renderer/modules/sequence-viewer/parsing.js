import { normalizeFeatureType } from './feature-types.js';
import { clamp, detectSequenceFormat, normalizeRecordName, normalizeSequenceText, normalizeTopology } from './shared.js';
import { parseFastaRecords, parseFastqRecords } from './parsing/fasta-fastq.js';
import { parseGenBankRecords } from './parsing/genbank.js';

function parseRawSequenceRecord(rawInput) {
  const sequence = normalizeSequenceText(rawInput);
  if (!sequence.length) {
    return {
      format: 'raw',
      records: [],
      warnings: [],
      errors: ['No sequence characters were found in input.']
    };
  }

  return {
    format: 'raw',
    records: [{
      id: 'raw_1',
      name: 'sequence_1',
      description: '',
      sourceFormat: 'raw',
      topology: 'linear',
      sequence,
      quality: '',
      features: []
    }],
    warnings: [],
    errors: []
  };
}

export function parseInputRecords(rawInput, options = {}) {
  const text = String(rawInput || '');
  const format = detectSequenceFormat(text);
  if (format === 'fasta') {
    return parseFastaRecords(text, options);
  }
  if (format === 'fastq') {
    return parseFastqRecords(text, options);
  }
  if (format === 'genbank') {
    return parseGenBankRecords(text, options);
  }
  if (format === 'raw') {
    return parseRawSequenceRecord(text);
  }
  return {
    format: 'empty',
    records: [],
    warnings: [],
    errors: ['Input is empty.']
  };
}

function normalizeExternalFeature(feature, sequenceLength, index = 0) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const strandValue = Number(feature.strand);
  const strand = strandValue === -1 || feature.strand === '-' ? -1 : 1;
  const rawSegments = Array.isArray(feature.segments) ? feature.segments : [];

  const segments = rawSegments
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, sequenceLength);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean);

  if (!segments.length) {
    return null;
  }

  return {
    id: String(feature.id || `external_feature_${index + 1}`),
    name: normalizeRecordName(feature.name || feature.label || `feature_${index + 1}`, `feature_${index + 1}`),
    type: normalizeFeatureType(feature.type || 'misc_feature'),
    strand,
    description: String(feature.description || ''),
    source: String(feature.source || 'external'),
    locationText: String(feature.location || ''),
    identity: Number.isFinite(Number(feature.identity)) ? Number(feature.identity) : null,
    coverage: Number.isFinite(Number(feature.coverage)) ? Number(feature.coverage) : null,
    mode: String(feature.mode || ''),
    segments
  };
}

export function normalizeExternalPayload(payload) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const sequence = normalizeSequenceText(raw.sequence || '');
  const features = Array.isArray(raw.features)
    ? raw.features
      .map((feature, index) => normalizeExternalFeature(feature, sequence.length, index))
      .filter(Boolean)
    : [];

  return {
    id: 'external_1',
    name: normalizeRecordName(raw.name || 'external_sequence', 'external_sequence'),
    description: '',
    sourceFormat: String(raw.source || 'external'),
    topology: normalizeTopology(raw.topology || 'linear'),
    sequence,
    quality: '',
    features
  };
}

export function summarizeFastqQuality(qualityText) {
  const quality = String(qualityText || '');
  if (!quality.length) {
    return null;
  }

  const values = [...quality].map((char) => char.charCodeAt(0) - 33);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, mean, max };
}

export { parseAb1Record } from './parsing/ab1-trace.js';
export { parseFastaRecords, parseFastqRecords } from './parsing/fasta-fastq.js';
export { parseGenBankLocationSegments, parseGenBankRecords } from './parsing/genbank.js';
