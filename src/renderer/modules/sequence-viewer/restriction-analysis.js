import { COMMERCIAL_RESTRICTION_ENZYMES } from './data/commercial-restriction-enzymes.js';
import * as sharedRestrictionFeatures from './algorithms/restriction-features.js';
import {
  FALLBACK_CHAR_ADVANCE_PX,
  RESTRICTION_VENDOR_CODE_BY_KEY,
  STRAND_PAIR_ROW_GAP_PX
} from './constants.js';
import {
  clamp,
  normalizeSequenceText,
  normalizeTopology,
  reverseComplementIupac
} from './shared.js';

const COMMERCIAL_RESTRICTION_FEATURE_CACHE = new WeakMap();

function motifToRegexBody(motif) {
  const normalized = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  if (!normalized) {
    return '';
  }
  const classes = [...normalized].map((base) => ({
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
  if (classes.some((entry) => !entry)) {
    return '';
  }
  return classes.join('');
}

function findMotifHits(sequence, motif, topology = 'linear') {
  const text = normalizeSequenceText(sequence);
  const normalizedMotif = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  const patternBody = motifToRegexBody(normalizedMotif);
  if (!text.length || !normalizedMotif.length || !patternBody.length) {
    return [];
  }

  const sequenceLength = text.length;
  const motifLength = normalizedMotif.length;
  const circular = normalizeTopology(topology) === 'circular';
  const scanText = circular && motifLength > 1
    ? `${text}${text.slice(0, motifLength - 1)}`
    : text;
  const regex = new RegExp(`(?=(${patternBody}))`, 'g');
  const hits = [];

  let match = regex.exec(scanText);
  while (match) {
    const start = match.index;
    if (start < sequenceLength) {
      const end = start + motifLength;
      const segments = end <= sequenceLength
        ? [{ start, end }]
        : [
          { start, end: sequenceLength },
          { start: 0, end: end - sequenceLength }
        ];

      hits.push({
        start,
        end,
        segments
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

function getSelectedRestrictionVendorCodes(filter) {
  const normalized = normalizeRestrictionVendorFilter(filter);
  return Object.entries(RESTRICTION_VENDOR_CODE_BY_KEY)
    .filter(([key]) => Boolean(normalized[key]))
    .map(([, code]) => code);
}

function pickRestrictionRepresentativeEnzyme(enzymes) {
  const list = Array.isArray(enzymes) ? enzymes.filter(Boolean) : [];
  return [...list].sort((left, right) => {
    const leftVendorScore = Array.isArray(left?.vendorCodes) ? left.vendorCodes.length : 0;
    const rightVendorScore = Array.isArray(right?.vendorCodes) ? right.vendorCodes.length : 0;
    if (rightVendorScore !== leftVendorScore) {
      return rightVendorScore - leftVendorScore;
    }
    const leftName = String(left?.name || '');
    const rightName = String(right?.name || '');
    if (leftName.length !== rightName.length) {
      return leftName.length - rightName.length;
    }
    return leftName.localeCompare(rightName);
  })[0] || null;
}

function summarizeRestrictionVendorSelection(vendorCodes) {
  const codes = Array.isArray(vendorCodes) ? vendorCodes : [];
  const hasNeb = codes.includes(RESTRICTION_VENDOR_CODE_BY_KEY.neb);
  const hasThermo = codes.includes(RESTRICTION_VENDOR_CODE_BY_KEY.thermo);
  if (hasNeb && hasThermo) {
    return 'NEB/Thermo';
  }
  if (hasNeb) {
    return 'NEB';
  }
  if (hasThermo) {
    return 'Thermo';
  }
  return 'selected vendors';
}

function describeRestrictionFeature(vendorCodes, enzymeCount, enzymeName) {
  const vendorLabel = summarizeRestrictionVendorSelection(vendorCodes);
  if (enzymeCount > 1) {
    return `Unique ${vendorLabel} restriction site shared by ${enzymeCount} commercial enzymes.`;
  }
  return `Unique ${vendorLabel} restriction site recognized by ${String(enzymeName || '-')}.`;
}

export function buildCommercialRestrictionBaseFeatures(sequence, topology = 'linear') {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    return [];
  }

  const features = [];
  COMMERCIAL_RESTRICTION_ENZYMES.forEach((entry, entryIndex) => {
    const motif = String(entry?.site || '').toUpperCase().replace(/U/g, 'T').trim();
    if (!motif.length) {
      return;
    }

    const reverseMotif = reverseComplementIupac(motif);
    const hitsBySegmentKey = new Map();

    const collectHits = (scanMotif, strand) => {
      findMotifHits(text, scanMotif, topology).forEach((hit) => {
        const segmentKey = hit.segments.map((segment) => `${segment.start}-${segment.end}`).join(',');
        if (!hitsBySegmentKey.has(segmentKey)) {
          hitsBySegmentKey.set(segmentKey, {
            start: hit.start,
            strand,
            segments: hit.segments
          });
        }
      });
    };

    collectHits(motif, 1);
    if (reverseMotif && reverseMotif !== motif) {
      collectHits(reverseMotif, -1);
    }

    if (hitsBySegmentKey.size !== 1) {
      return;
    }

    const hit = [...hitsBySegmentKey.values()][0];
    const allEnzymes = Array.isArray(entry?.enzymes) ? entry.enzymes.filter(Boolean) : [];
    const representative = pickRestrictionRepresentativeEnzyme(allEnzymes);
    const enzymeNames = Array.isArray(entry?.enzymeNames)
      ? entry.enzymeNames.filter(Boolean)
      : allEnzymes.map((enzyme) => String(enzyme?.name || '').trim()).filter(Boolean);
    const cutPatterns = (Array.isArray(entry?.cutPatterns) ? entry.cutPatterns : [])
      .map((pattern) => String(pattern || '').trim().toUpperCase())
      .filter((pattern) => pattern && !pattern.includes('?'));
    const vendorCodes = Array.isArray(entry?.vendorCodes) ? entry.vendorCodes : [];
    const vendors = Array.isArray(entry?.vendors) ? entry.vendors : [];

    features.push({
      id: `commercial_restriction_${entryIndex}_${hit.start}_${hit.strand === -1 ? 'minus' : 'plus'}`,
      name: String(representative?.name || entry?.name || motif),
      type: 'restriction_site',
      strand: hit.strand,
      description: describeRestrictionFeature(vendorCodes, enzymeNames.length, representative?.name || entry?.name || motif),
      source: 'commercial_restriction',
      mode: 'NEB/Thermo',
      site: motif,
      cut: cutPatterns.length === 1 ? cutPatterns[0] : '',
      cutPatterns,
      enzymeNames,
      vendorCodes,
      vendors,
      enzymes: allEnzymes,
      segments: hit.segments
    });
  });

  return features.sort((left, right) => {
    const leftStart = left.segments?.[0]?.start ?? 0;
    const rightStart = right.segments?.[0]?.start ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

export function filterCommercialRestrictionFeatures(features, vendorFilter) {
  const selectedVendorCodes = getSelectedRestrictionVendorCodes(vendorFilter);
  if (!selectedVendorCodes.length) {
    return [];
  }
  const selectedVendorCodeSet = new Set(selectedVendorCodes);
  return (Array.isArray(features) ? features : [])
    .map((feature) => {
      if (String(feature?.type || '').toLowerCase() !== 'restriction_site') {
        return feature;
      }
      const filteredEnzymes = (Array.isArray(feature?.enzymes) ? feature.enzymes : [])
        .filter((enzyme) => (Array.isArray(enzyme?.vendorCodes) ? enzyme.vendorCodes : [])
          .some((code) => selectedVendorCodeSet.has(code)));
      if (!filteredEnzymes.length) {
        return null;
      }

      const representative = pickRestrictionRepresentativeEnzyme(filteredEnzymes);
      const enzymeNames = filteredEnzymes
        .map((enzyme) => String(enzyme?.name || '').trim())
        .filter(Boolean);
      const cutPatterns = [...new Set(filteredEnzymes
        .map((enzyme) => String(enzyme?.cut || '').trim().toUpperCase())
        .filter((pattern) => pattern && !pattern.includes('?')))];
      const vendorCodes = [...new Set(filteredEnzymes.flatMap((enzyme) => (
        Array.isArray(enzyme?.vendorCodes) ? enzyme.vendorCodes : []
      )))].sort();
      const vendors = [...new Set(filteredEnzymes.flatMap((enzyme) => (
        Array.isArray(enzyme?.vendors) ? enzyme.vendors : []
      )))];

      return {
        ...feature,
        name: String(representative?.name || feature.name || feature.site || 'restriction_site'),
        cut: cutPatterns.length === 1 ? cutPatterns[0] : '',
        cutPatterns,
        enzymeNames,
        vendorCodes,
        vendors,
        enzymes: filteredEnzymes,
        description: describeRestrictionFeature(vendorCodes, enzymeNames.length, representative?.name || feature.name)
      };
    })
    .filter(Boolean);
}

export function buildCommercialRestrictionFeatures(sequence, topology = 'linear', options = {}) {
  return sharedRestrictionFeatures.buildCommercialRestrictionFeatures(sequence, topology, options);
}

function parseRestrictionCutDescriptor(feature) {
  const cutPattern = String(feature?.cut || '').trim().toUpperCase();
  if (!cutPattern) {
    return null;
  }

  const siteLength = Math.max(1, normalizeSequenceText(feature?.site || '').length);
  const outsideDescriptors = [...cutPattern.matchAll(/\(([-+]?\d+)\s*\/\s*([-+]?\d+)\)/g)];

  if (cutPattern.includes('^')) {
    if ((cutPattern.match(/\^/g) || []).length !== 1 || outsideDescriptors.length) {
      return null;
    }
    const [left = '', right = ''] = cutPattern.split('^');
    const topOffset = normalizeSequenceText(left).length;
    const rightLength = normalizeSequenceText(right).length;
    if (topOffset >= 0) {
      const bottomOffset = Math.max(0, siteLength - topOffset);
      return {
        siteLength,
        topOffset,
        bottomOffset,
        sticky: topOffset !== bottomOffset && rightLength > 0
      };
    }
  }

  if (outsideDescriptors.length === 1) {
    const topOffset = Number(outsideDescriptors[0][1]);
    const bottomOffset = Number(outsideDescriptors[0][2]);
    if (Number.isFinite(topOffset) && Number.isFinite(bottomOffset)) {
      return {
        siteLength,
        topOffset: siteLength + topOffset,
        bottomOffset: siteLength + bottomOffset,
        sticky: topOffset !== bottomOffset
      };
    }
  }

  return null;
}

export function resolveRestrictionCutBaseIndices(feature) {
  const descriptor = parseRestrictionCutDescriptor(feature);
  if (!descriptor) {
    return null;
  }

  const siteStart = Number(feature?.segments?.[0]?.start);
  if (!Number.isFinite(siteStart)) {
    return null;
  }

  const strand = feature?.strand === -1 ? -1 : 1;
  if (strand === -1) {
    return {
      top: siteStart + (descriptor.siteLength - descriptor.bottomOffset),
      bottom: siteStart + (descriptor.siteLength - descriptor.topOffset),
      sticky: Boolean(descriptor.sticky)
    };
  }

  return {
    top: siteStart + descriptor.topOffset,
    bottom: siteStart + descriptor.bottomOffset,
    sticky: Boolean(descriptor.sticky)
  };
}

export function getCommercialRestrictionFeaturesForRecord(record, options = {}) {
  if (!record?.sequence) {
    return [];
  }
  const cacheKey = `${record.sequence}|${normalizeTopology(record.topology)}`;
  const cached = COMMERCIAL_RESTRICTION_FEATURE_CACHE.get(record);
  if (cached?.key === cacheKey && Array.isArray(cached.features)) {
    return filterCommercialRestrictionFeatures(cached.features, options?.vendorFilter);
  }

  const features = buildCommercialRestrictionBaseFeatures(record.sequence, record.topology);
  COMMERCIAL_RESTRICTION_FEATURE_CACHE.set(record, { key: cacheKey, features });
  return filterCommercialRestrictionFeatures(features, options?.vendorFilter);
}

export function formatRestrictionCutSummary(feature) {
  const cutPatterns = (Array.isArray(feature?.cutPatterns) ? feature.cutPatterns : [])
    .map((pattern) => String(pattern || '').trim())
    .filter((pattern) => pattern && !pattern.includes('?'));
  const singleCut = String(feature?.cut || '').trim();
  if (singleCut && !singleCut.includes('?')) {
    return {
      label: 'Cut',
      text: singleCut
    };
  }
  if (cutPatterns.length === 1) {
    return {
      label: 'Cut',
      text: cutPatterns[0]
    };
  }
  if (cutPatterns.length > 1) {
    return {
      label: 'Cut Patterns',
      text: cutPatterns.join(' · ')
    };
  }
  return null;
}

export function computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, charAdvancePx, cutBaseIndex = null) {
  const segmentStart = Number(segment?.start);
  const segmentEnd = Number(segment?.end);
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) {
    return null;
  }

  const overlapStart = Math.max(lineStart, segmentStart);
  const overlapEnd = Math.min(lineEnd, segmentEnd);
  if (overlapEnd <= overlapStart) {
    return null;
  }

  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const leftPx = Math.max(0, (overlapStart - lineStart) * safeAdvance);
  const widthPx = Math.max(1, (overlapEnd - overlapStart) * safeAdvance);

  let hasCut = Number.isFinite(cutBaseIndex) && cutBaseIndex >= overlapStart && cutBaseIndex <= overlapEnd;
  if (hasCut && cutBaseIndex === overlapStart && overlapStart > segmentStart) {
    hasCut = false;
  }

  const cutLocalPx = hasCut
    ? clamp(((cutBaseIndex - lineStart) * safeAdvance) - leftPx, 0, widthPx)
    : null;

  return {
    overlapStart,
    overlapEnd,
    leftPx,
    widthPx,
    hasCut,
    cutLocalPx
  };
}

export function resolveRestrictionCutLocalPx(cutBaseIndex, geometry, lineStart, charAdvancePx, segmentStart, segmentEnd) {
  if (!Number.isFinite(cutBaseIndex)) {
    return null;
  }
  if (cutBaseIndex < geometry.overlapStart || cutBaseIndex > geometry.overlapEnd) {
    return null;
  }
  if (cutBaseIndex === geometry.overlapStart && geometry.overlapStart > segmentStart) {
    return null;
  }
  if (cutBaseIndex === geometry.overlapEnd && geometry.overlapEnd < segmentEnd) {
    return null;
  }

  return clamp(((cutBaseIndex - lineStart) * charAdvancePx) - geometry.leftPx, 0, geometry.widthPx);
}

export function buildRestrictionCutPolylinePoints(
  widthPx,
  topCutLocalPx,
  bottomCutLocalPx,
  boxHeightPx,
  topRowHeightPx,
  strandGapPx,
  labelGapPx = 14
) {
  if (!Number.isFinite(topCutLocalPx) && !Number.isFinite(bottomCutLocalPx)) {
    return '';
  }

  const safeWidth = Math.max(1, Number(widthPx) || 1);
  const safeTopCutPx = Number.isFinite(topCutLocalPx) ? clamp(topCutLocalPx, 0, safeWidth) : null;
  const safeBottomCutPx = Number.isFinite(bottomCutLocalPx) ? clamp(bottomCutLocalPx, 0, safeWidth) : null;
  const topX = Number.isFinite(safeTopCutPx) ? safeTopCutPx : safeBottomCutPx;
  const bottomX = Number.isFinite(safeBottomCutPx) ? safeBottomCutPx : safeTopCutPx;
  const safeBoxHeight = Math.max(8, Number(boxHeightPx) || 16);
  const safeTopRowHeight = clamp(
    Number(topRowHeightPx) || 16,
    6,
    Math.max(6, safeBoxHeight - 2)
  );
  const safeStrandGap = clamp(
    Number(strandGapPx) || STRAND_PAIR_ROW_GAP_PX,
    0,
    Math.max(0, safeBoxHeight - safeTopRowHeight)
  );
  const safeLabelGap = Math.max(6, Number(labelGapPx) || RESTRICTION_LABEL_GAP_PX);
  const boxTopY = safeLabelGap;
  const topCutStartY = boxTopY + 1;
  const bridgeY = boxTopY + safeTopRowHeight + (safeStrandGap / 2);
  const boxBottomY = safeLabelGap + safeBoxHeight - 1;

  return `${topX.toFixed(2)},${topCutStartY.toFixed(2)} ${topX.toFixed(2)},${bridgeY.toFixed(2)} ${bottomX.toFixed(2)},${bridgeY.toFixed(2)} ${bottomX.toFixed(2)},${boxBottomY.toFixed(2)}`;
}
