import { annotatePlasmidSequence } from '../plannotate-js.js';
import { PLANNOTATE_DEFAULT_OPTIONS } from './constants.js';
import {
  clamp,
  normalizeRecordName,
  normalizeTopology
} from './shared.js';

export function getEnanaApiBridge() {
  return globalThis?.window?.enanaApi || globalThis?.enanaApi || null;
}

function getPlannotateSegmentsFromHit(hit, sequenceLength, topology = 'circular') {
  const normalizedLength = Math.max(0, Number(sequenceLength) || 0);
  if (!normalizedLength) {
    return [];
  }

  const qstart = clamp(Math.round(Number(hit?.qstart) || 0), 0, normalizedLength);
  const qendRaw = Number(hit?.qend);
  const qend = qendRaw === 0
    ? normalizedLength
    : clamp(Math.round(qendRaw || 0), 0, normalizedLength);

  if (normalizeTopology(topology) === 'linear') {
    const left = Math.min(qstart, qend);
    const right = Math.max(qstart, qend);
    return right > left ? [{ start: left, end: right }] : [];
  }

  const wrapsOrigin = Boolean(hit?.crossesOrigin) || qend < qstart;
  if (!wrapsOrigin) {
    return qend > qstart ? [{ start: qstart, end: qend }] : [];
  }

  const segments = [];
  if (normalizedLength > qstart) {
    segments.push({ start: qstart, end: normalizedLength });
  }
  if (qend > 0) {
    segments.push({ start: 0, end: qend });
  }
  if (!segments.length && qstart === 0 && qend === 0) {
    segments.push({ start: 0, end: normalizedLength });
  }
  return segments;
}

function formatPlannotateHitLocation(hit, sequenceLength) {
  const normalizedLength = Math.max(1, Number(sequenceLength) || 1);
  const start = clamp((Number(hit?.qstart) || 0) + 1, 1, normalizedLength);
  const rawEnd = Number(hit?.qend);
  const end = rawEnd === 0 ? normalizedLength : clamp(rawEnd || 0, 1, normalizedLength);
  if (!hit?.crossesOrigin) {
    return `${start}..${end}`;
  }
  return `${start}..${normalizedLength}, 1..${end}`;
}

export function buildPlannotateFeaturesFromResult(result, fallbackSequenceLength, fallbackTopology = 'linear') {
  const sequenceLength = Math.max(0, Number(result?.sequenceLength) || Number(fallbackSequenceLength) || 0);
  const topology = normalizeTopology(result?.topology || fallbackTopology);
  const hits = Array.isArray(result?.hits) ? result.hits : [];

  return hits
    .map((hit, index) => {
      const segments = getPlannotateSegmentsFromHit(hit, sequenceLength, topology);
      if (!segments.length) {
        return null;
      }
      return {
        id: `plannotate_${index + 1}`,
        name: normalizeRecordName(hit?.Feature || `feature_${index + 1}`, `feature_${index + 1}`),
        type: normalizeRecordName(hit?.Type || 'misc_feature', 'misc_feature').toLowerCase(),
        strand: Number(hit?.sframe) === -1 ? -1 : 1,
        description: String(hit?.Description || ''),
        source: 'plannotate',
        locationText: formatPlannotateHitLocation(hit, sequenceLength),
        identity: Number.isFinite(Number(hit?.pident)) ? Number(hit.pident) : null,
        coverage: Number.isFinite(Number(hit?.percmatch)) ? Number(hit.percmatch) : null,
        mode: String(hit?.matchMode || ''),
        segments
      };
    })
    .filter(Boolean);
}

async function runPlannotateAnnotationForSequence(sequence, topology, options = {}) {
  const resolvedOptions = {
    ...PLANNOTATE_DEFAULT_OPTIONS,
    ...(options && typeof options === 'object' ? options : {}),
    topology: normalizeTopology(topology || 'linear')
  };

  const bridge = resolvedOptions.apiBridge || resolvedOptions.bridge || getEnanaApiBridge();
  const backend = bridge?.plannotateAnnotate;
  if (typeof backend === 'function') {
    const response = await backend({
      sequenceText: sequence,
      topology: resolvedOptions.topology,
      detailed: Boolean(resolvedOptions.detailed),
      minIdentity: Number(resolvedOptions.minIdentity) || PLANNOTATE_DEFAULT_OPTIONS.minIdentity,
      minCoverage: Number(resolvedOptions.minCoverage) || PLANNOTATE_DEFAULT_OPTIONS.minCoverage,
      minHitLength: Math.round(Number(resolvedOptions.minHitLength) || PLANNOTATE_DEFAULT_OPTIONS.minHitLength)
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'pLannotate backend annotation failed.');
    }
    return response.result || {
      sequence,
      sequenceLength: String(sequence || '').length,
      topology: resolvedOptions.topology,
      hits: [],
      warnings: []
    };
  }

  const fallback = annotatePlasmidSequence(sequence, resolvedOptions);
  fallback.warnings = [
    'Native blastn/diamond backend unavailable. Displaying JS fallback annotations.',
    ...(Array.isArray(fallback.warnings) ? fallback.warnings : [])
  ];
  return fallback;
}

export {
  runPlannotateAnnotationForSequence
};
