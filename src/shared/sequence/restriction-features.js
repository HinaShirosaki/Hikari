import { COMMERCIAL_RESTRICTION_ENZYMES } from '../data/commercial-restriction-enzymes.js';
import {
  normalizeSequenceText,
  normalizeTopology,
  reverseComplementIupac
} from './sequence-utils.js';

const RESTRICTION_VENDOR_CODE_BY_KEY = Object.freeze({
  neb: 'N',
  thermo: 'B'
});

function motifToRegexBody(motif) {
  const classes = [...String(motif || '').toUpperCase().replace(/U/g, 'T').trim()].map((base) => ({
    A: 'A',
    C: 'C',
    G: 'G',
    T: 'T',
    R: '[AG]',
    Y: '[CT]',
    S: '[GC]',
    W: '[AT]',
    K: '[GT]',
    M: '[AC]',
    B: '[CGT]',
    D: '[AGT]',
    H: '[ACT]',
    V: '[ACG]',
    N: '[ACGT]'
  }[base] || ''));
  return classes.some((entry) => !entry) ? '' : classes.join('');
}

function findMotifHits(sequence, motif, topology = 'linear') {
  const text = normalizeSequenceText(sequence);
  const normalizedMotif = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  const patternBody = motifToRegexBody(normalizedMotif);
  if (!text.length || !normalizedMotif.length || !patternBody.length) {
    return [];
  }
  const circular = normalizeTopology(topology) === 'circular';
  const scanText = circular && normalizedMotif.length > 1
    ? `${text}${text.slice(0, normalizedMotif.length - 1)}`
    : text;
  const regex = new RegExp(`(?=(${patternBody}))`, 'g');
  const hits = [];
  let match = regex.exec(scanText);
  while (match) {
    const start = match.index;
    if (start < text.length) {
      const end = start + normalizedMotif.length;
      hits.push({
        start,
        segments: end <= text.length
          ? [{ start, end }]
          : [{ start, end: text.length }, { start: 0, end: end - text.length }]
      });
    }
    regex.lastIndex = start + 1;
    match = regex.exec(scanText);
  }
  return hits;
}

export function normalizeRestrictionVendorFilter(filter) {
  return {
    neb: filter?.neb !== false,
    thermo: filter?.thermo !== false
  };
}

function selectedVendorCodes(filter) {
  const normalized = normalizeRestrictionVendorFilter(filter);
  return Object.entries(RESTRICTION_VENDOR_CODE_BY_KEY)
    .filter(([key]) => Boolean(normalized[key]))
    .map(([, code]) => code);
}

function pickRepresentative(enzymes) {
  return [...(Array.isArray(enzymes) ? enzymes.filter(Boolean) : [])].sort((left, right) => {
    const vendorDifference = (right?.vendorCodes?.length || 0) - (left?.vendorCodes?.length || 0);
    return vendorDifference
      || String(left?.name || '').length - String(right?.name || '').length
      || String(left?.name || '').localeCompare(String(right?.name || ''));
  })[0] || null;
}

function describeFeature(vendorCodes, enzymeCount, enzymeName) {
  const hasNeb = vendorCodes.includes('N');
  const hasThermo = vendorCodes.includes('B');
  const vendorLabel = hasNeb && hasThermo ? 'NEB/Thermo' : (hasNeb ? 'NEB' : (hasThermo ? 'Thermo' : 'selected vendors'));
  return enzymeCount > 1
    ? `Unique ${vendorLabel} restriction site shared by ${enzymeCount} commercial enzymes.`
    : `Unique ${vendorLabel} restriction site recognized by ${String(enzymeName || '-')}.`;
}

export function buildCommercialRestrictionBaseFeatures(sequence, topology = 'linear') {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    return [];
  }
  const features = [];
  COMMERCIAL_RESTRICTION_ENZYMES.forEach((entry, entryIndex) => {
    const motif = String(entry?.site || '').toUpperCase().replace(/U/g, 'T').trim();
    if (!motif) {
      return;
    }
    const hitsBySegmentKey = new Map();
    const collectHits = (scanMotif, strand) => {
      findMotifHits(text, scanMotif, topology).forEach((hit) => {
        const key = hit.segments.map((segment) => `${segment.start}-${segment.end}`).join(',');
        if (!hitsBySegmentKey.has(key)) {
          hitsBySegmentKey.set(key, { ...hit, strand });
        }
      });
    };
    collectHits(motif, 1);
    const reverseMotif = reverseComplementIupac(motif);
    if (reverseMotif && reverseMotif !== motif) {
      collectHits(reverseMotif, -1);
    }
    if (hitsBySegmentKey.size !== 1) {
      return;
    }

    const hit = [...hitsBySegmentKey.values()][0];
    const enzymes = Array.isArray(entry?.enzymes) ? entry.enzymes.filter(Boolean) : [];
    const representative = pickRepresentative(enzymes);
    const enzymeNames = Array.isArray(entry?.enzymeNames)
      ? entry.enzymeNames.filter(Boolean)
      : enzymes.map((enzyme) => String(enzyme?.name || '').trim()).filter(Boolean);
    const cutPatterns = (Array.isArray(entry?.cutPatterns) ? entry.cutPatterns : [])
      .map((pattern) => String(pattern || '').trim().toUpperCase())
      .filter((pattern) => pattern && !pattern.includes('?'));
    const vendorCodes = Array.isArray(entry?.vendorCodes) ? entry.vendorCodes : [];
    features.push({
      id: `commercial_restriction_${entryIndex}_${hit.start}_${hit.strand === -1 ? 'minus' : 'plus'}`,
      name: String(representative?.name || entry?.name || motif),
      type: 'restriction_site',
      strand: hit.strand,
      description: describeFeature(vendorCodes, enzymeNames.length, representative?.name || entry?.name || motif),
      source: 'commercial_restriction',
      mode: 'NEB/Thermo',
      site: motif,
      cut: cutPatterns.length === 1 ? cutPatterns[0] : '',
      cutPatterns,
      enzymeNames,
      vendorCodes,
      vendors: Array.isArray(entry?.vendors) ? entry.vendors : [],
      enzymes,
      segments: hit.segments
    });
  });
  return features.sort((left, right) => (
    (left.segments?.[0]?.start ?? 0) - (right.segments?.[0]?.start ?? 0)
    || String(left.name || '').localeCompare(String(right.name || ''))
  ));
}

export function filterCommercialRestrictionFeatures(features, vendorFilter) {
  const codeSet = new Set(selectedVendorCodes(vendorFilter));
  if (!codeSet.size) {
    return [];
  }
  return (Array.isArray(features) ? features : []).map((feature) => {
    if (String(feature?.type || '').toLowerCase() !== 'restriction_site') {
      return feature;
    }
    const enzymes = (Array.isArray(feature?.enzymes) ? feature.enzymes : []).filter((enzyme) => (
      (Array.isArray(enzyme?.vendorCodes) ? enzyme.vendorCodes : []).some((code) => codeSet.has(code))
    ));
    if (!enzymes.length) {
      return null;
    }
    const representative = pickRepresentative(enzymes);
    const enzymeNames = enzymes.map((enzyme) => String(enzyme?.name || '').trim()).filter(Boolean);
    const cutPatterns = [...new Set(enzymes
      .map((enzyme) => String(enzyme?.cut || '').trim().toUpperCase())
      .filter((pattern) => pattern && !pattern.includes('?')))];
    const vendorCodes = [...new Set(enzymes.flatMap((enzyme) => enzyme?.vendorCodes || []))].sort();
    return {
      ...feature,
      name: String(representative?.name || feature.name || feature.site || 'restriction_site'),
      cut: cutPatterns.length === 1 ? cutPatterns[0] : '',
      cutPatterns,
      enzymeNames,
      vendorCodes,
      vendors: [...new Set(enzymes.flatMap((enzyme) => enzyme?.vendors || []))],
      enzymes,
      description: describeFeature(vendorCodes, enzymeNames.length, representative?.name || feature.name)
    };
  }).filter(Boolean);
}

export function buildCommercialRestrictionFeatures(sequence, topology = 'linear', options = {}) {
  return filterCommercialRestrictionFeatures(
    buildCommercialRestrictionBaseFeatures(sequence, topology),
    options?.vendorFilter
  );
}
