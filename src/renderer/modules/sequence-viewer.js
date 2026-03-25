import { escapeHtml } from './tool-box/common.js';
import { annotatePlasmidSequence } from './plannotate-js.js';
import { translateDnaSequence } from './tool-box/sequence.js';
import { COMMERCIAL_RESTRICTION_ENZYMES } from './commercial-restriction-enzymes.js';

const DEFAULT_MAX_RECORDS = 5000;
const DEFAULT_SEQUENCE_LINE_LENGTH = 120;
const DUAL_STRAND_SCROLL_STEP = 44;
const FALLBACK_CHAR_ADVANCE_PX = 8.8;
const FALLBACK_SEQUENCE_LINE_HEIGHT_PX = 16;
const RESTRICTION_LABEL_GAP_PX = 14;
const STRAND_PAIR_ROW_GAP_PX = 8;
const DEFAULT_STRAND_MARKER_COLUMN_PX = 28;
const DEFAULT_STRAND_COLUMN_GAP_PX = 6;
const LINE_FEATURE_BAR_HEIGHT_PX = 16;
const LINE_FEATURE_BAR_GAP_PX = 3;
const LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX = 5;
const FEATURE_TOOLTIP_OFFSET_PX = 12;
const AMINO_ACID_ROW_LABEL = 'AA';
const PLANNOTATE_DEFAULT_OPTIONS = Object.freeze({
  detailed: false,
  minIdentity: 85,
  minCoverage: 0.25,
  minHitLength: 24
});
const BASE_COMPLEMENT = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
  '*': '*'
});

const IUPAC_DNA_CLASS = Object.freeze({
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
});

const COMMERCIAL_RESTRICTION_FEATURE_CACHE = new WeakMap();
const ORF_FEATURE_CACHE = new WeakMap();
const ORF_START_CODONS = new Set(['ATG']);
const ORF_STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);
const DEFAULT_MIN_ORF_AA_LENGTH = 75;
const RESTRICTION_VENDOR_CODE_BY_KEY = Object.freeze({
  neb: 'N',
  thermo: 'B'
});
const DEFAULT_RESTRICTION_VENDOR_FILTER = Object.freeze({
  neb: true,
  thermo: true
});

function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

function complementBase(base) {
  const normalized = String(base || '').toUpperCase();
  return BASE_COMPLEMENT[normalized] || 'N';
}

function complementSequence(sequence) {
  return [...normalizeSequenceText(sequence)].map((base) => complementBase(base)).join('');
}

function reverseComplementIupac(sequence) {
  const raw = String(sequence || '').toUpperCase().replace(/U/g, 'T');
  return [...raw].reverse().map((base) => complementBase(base)).join('');
}

function motifToRegexBody(motif) {
  const normalized = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  if (!normalized) {
    return '';
  }
  const classes = [...normalized].map((base) => IUPAC_DNA_CLASS[base] || '');
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

function normalizeRestrictionVendorFilter(filter) {
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

function buildCommercialRestrictionBaseFeatures(sequence, topology = 'linear') {
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

function filterCommercialRestrictionFeatures(features, vendorFilter) {
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

function buildCommercialRestrictionFeatures(sequence, topology = 'linear', options = {}) {
  const baseFeatures = buildCommercialRestrictionBaseFeatures(sequence, topology);
  return filterCommercialRestrictionFeatures(baseFeatures, options?.vendorFilter);
}

function positiveModulo(value, modulo) {
  if (!Number.isFinite(Number(modulo)) || modulo <= 0) {
    return 0;
  }
  const numeric = Number(value) || 0;
  return ((numeric % modulo) + modulo) % modulo;
}

function readCircularCodon(sequence, start) {
  const text = String(sequence || '');
  const length = text.length;
  if (length < 3) {
    return '';
  }
  const first = text[positiveModulo(start, length)] || '';
  const second = text[positiveModulo(start + 1, length)] || '';
  const third = text[positiveModulo(start + 2, length)] || '';
  return `${first}${second}${third}`;
}

function buildSegmentsFromStartAndLength(start, length, sequenceLength, topology = 'linear') {
  const normalizedLength = Math.max(0, Number(sequenceLength) || 0);
  const normalizedSpan = Math.max(0, Number(length) || 0);
  if (!normalizedLength || normalizedSpan <= 0) {
    return [];
  }

  if (normalizeTopology(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, normalizedLength);
    const safeEnd = clamp(safeStart + normalizedSpan, 0, normalizedLength);
    return safeEnd > safeStart ? [{ start: safeStart, end: safeEnd }] : [];
  }

  const circularStart = positiveModulo(Math.round(Number(start) || 0), normalizedLength);
  if (normalizedSpan >= normalizedLength) {
    if (circularStart === 0) {
      return [{ start: 0, end: normalizedLength }];
    }
    return [
      { start: circularStart, end: normalizedLength },
      { start: 0, end: circularStart }
    ];
  }

  const circularEnd = (circularStart + normalizedSpan) % normalizedLength;
  if (circularEnd > circularStart) {
    return [{ start: circularStart, end: circularEnd }];
  }
  if (circularEnd === circularStart) {
    return [{ start: 0, end: normalizedLength }];
  }
  return [
    { start: circularStart, end: normalizedLength },
    { start: 0, end: circularEnd }
  ];
}

function detectLinearOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= sequenceLength - 3; start += 3) {
      const startCodon = text.slice(start, start + 3);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let position = start + 3; position <= sequenceLength - 3; position += 3) {
        const stopCodon = text.slice(position, position + 3);
        if (!ORF_STOP_CODONS.has(stopCodon)) {
          continue;
        }
        const length = (position + 3) - start;
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectCircularOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const maxCodonSteps = Math.max(0, Math.floor(sequenceLength / 3));
  if (!maxCodonSteps) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start < sequenceLength; start += 3) {
      const startCodon = readCircularCodon(text, start);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let step = 1; step <= maxCodonSteps; step += 1) {
        const length = (step * 3) + 3;
        if (length > sequenceLength) {
          break;
        }
        const position = (start + (step * 3)) % sequenceLength;
        const stopCodon = readCircularCodon(text, position);
        if (!ORF_STOP_CODONS.has(stopCodon)) {
          continue;
        }
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectOrfHitsForSequence(sequence, topology, minNtLength) {
  const normalizedTopology = normalizeTopology(topology);
  return normalizedTopology === 'circular'
    ? detectCircularOrfHits(sequence, minNtLength)
    : detectLinearOrfHits(sequence, minNtLength);
}

function buildOrfFeatures(sequence, topology = 'linear', options = {}) {
  const text = normalizeSequenceText(sequence).replace(/[^ACGT]/g, 'N');
  const sequenceLength = text.length;
  if (!sequenceLength) {
    return [];
  }

  const minAaLength = Math.max(1, Math.floor(Number(options?.minAaLength) || DEFAULT_MIN_ORF_AA_LENGTH));
  const minNtLength = Math.max(6, (minAaLength + 1) * 3);
  const normalizedTopology = normalizeTopology(topology);
  const forwardHits = detectOrfHitsForSequence(text, normalizedTopology, minNtLength);
  const reverseSequence = reverseComplementIupac(text).replace(/[^ACGT]/g, 'N');
  const reverseHits = detectOrfHitsForSequence(reverseSequence, normalizedTopology, minNtLength);
  const dedupe = new Set();
  const features = [];

  const pushFeature = (hit, strand) => {
    const hitLength = Math.max(0, Number(hit?.length) || 0);
    if (hitLength <= 0) {
      return;
    }

    let genomicStart = 0;
    if (strand === 1) {
      genomicStart = Number(hit?.start) || 0;
    } else {
      genomicStart = positiveModulo(sequenceLength - ((Number(hit?.start) || 0) + hitLength), sequenceLength);
    }

    const segments = buildSegmentsFromStartAndLength(genomicStart, hitLength, sequenceLength, normalizedTopology);
    if (!segments.length) {
      return;
    }

    const frameIndex = Math.max(0, Math.min(2, Number(hit?.frame) || 0));
    const frameLabel = `${strand === -1 ? '-' : '+'}${frameIndex + 1}`;
    const stopCodon = String(hit?.stopCodon || '').toUpperCase();
    const aaLength = Math.max(0, Math.floor(hitLength / 3) - 1);
    const segmentKey = segments.map((segment) => `${segment.start}-${segment.end}`).join(',');
    const dedupeKey = `${strand}|${frameLabel}|${segmentKey}|${stopCodon}`;
    if (dedupe.has(dedupeKey)) {
      return;
    }
    dedupe.add(dedupeKey);

    features.push({
      id: `orf_${strand === -1 ? 'minus' : 'plus'}_${frameIndex + 1}_${segments[0].start}_${hitLength}`,
      name: `ORF ${frameLabel}`,
      type: 'open_reading_frame',
      strand,
      description: `Predicted ORF (${aaLength} aa, ${hitLength} nt, frame ${frameLabel}, start ATG${stopCodon ? `, stop ${stopCodon}` : ''}).`,
      source: 'orf',
      mode: 'ORF',
      orfFrame: frameLabel,
      orfLengthNt: hitLength,
      orfLengthAa: aaLength,
      startCodon: 'ATG',
      stopCodon,
      segments
    });
  };

  forwardHits.forEach((hit) => pushFeature(hit, 1));
  reverseHits.forEach((hit) => pushFeature(hit, -1));

  const sorted = features.sort((left, right) => {
    const leftStart = left.segments?.[0]?.start ?? 0;
    const rightStart = right.segments?.[0]?.start ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    const leftLength = Math.max(0, Number(left.orfLengthNt) || 0);
    const rightLength = Math.max(0, Number(right.orfLengthNt) || 0);
    if (leftLength !== rightLength) {
      return rightLength - leftLength;
    }
    return String(left.name || '').localeCompare(String(right.name || ''));
  });

  return collapseNestedOrfFeatures(sorted, sequenceLength);
}

function collapseNestedOrfFeatures(features, sequenceLength) {
  const list = Array.isArray(features) ? features : [];
  if (list.length < 2) {
    return list;
  }

  const annotated = list.map((feature, index) => ({
    feature,
    index,
    strand: feature?.strand === -1 ? -1 : 1,
    frame: String(feature?.orfFrame || ''),
    indices: getOrfCodingIndices(feature, sequenceLength)
  }));
  const byGroup = new Map();
  annotated.forEach((entry) => {
    const key = `${entry.strand}|${entry.frame}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
    }
    byGroup.get(key).push(entry);
  });

  const discarded = new Set();
  const isSubset = (inner, outer) => {
    if (!inner.length || inner.length > outer.length) {
      return false;
    }
    const outerSet = new Set(outer);
    return inner.every((index) => outerSet.has(index));
  };

  byGroup.forEach((entries) => {
    const ranked = [...entries].sort((left, right) => {
      if (right.indices.length !== left.indices.length) {
        return right.indices.length - left.indices.length;
      }
      return left.index - right.index;
    });

    for (let i = 0; i < ranked.length; i += 1) {
      const outer = ranked[i];
      if (!outer.indices.length || discarded.has(outer.index)) {
        continue;
      }
      for (let j = i + 1; j < ranked.length; j += 1) {
        const inner = ranked[j];
        if (!inner.indices.length || discarded.has(inner.index)) {
          continue;
        }
        if (isSubset(inner.indices, outer.indices)) {
          discarded.add(inner.index);
        }
      }
    }
  });

  return list.filter((_feature, index) => !discarded.has(index));
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function parseCssPixels(value) {
  const numeric = Number.parseFloat(String(value || ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeRecordName(value, fallback = 'record') {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || fallback;
}

function detectSequenceFormat(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return 'empty';
  }

  if (/^\s*LOCUS\b/im.test(text) && /^\s*ORIGIN\b/im.test(text)) {
    return 'genbank';
  }

  if (/^\s*>/m.test(text)) {
    return 'fasta';
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length >= 4 && lines[0].startsWith('@')) {
    const plusIndex = lines.findIndex((line, idx) => idx > 0 && line.startsWith('+'));
    if (plusIndex >= 2) {
      return 'fastq';
    }
  }

  return 'raw';
}

function computeGcPercent(sequence) {
  const cleaned = normalizeSequenceText(sequence);
  if (!cleaned.length) {
    return 0;
  }
  const gc = [...cleaned].reduce((sum, base) => sum + (base === 'G' || base === 'C' ? 1 : 0), 0);
  return (gc / cleaned.length) * 100;
}

function countAmbiguousBases(sequence) {
  const cleaned = normalizeSequenceText(sequence);
  if (!cleaned.length) {
    return 0;
  }
  return [...cleaned].reduce((sum, base) => sum + ((base === 'A' || base === 'C' || base === 'G' || base === 'T') ? 0 : 1), 0);
}

function normalizeTopology(value) {
  return String(value || '').toLowerCase() === 'circular' ? 'circular' : 'linear';
}

function parseFastaRecords(rawInput, options = {}) {
  const maxRecords = Math.max(1, Math.floor(Number(options.maxRecords) || DEFAULT_MAX_RECORDS));
  const raw = String(rawInput || '');
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  const records = [];
  const warnings = [];
  const errors = [];

  let currentHeader = '';
  let currentBody = [];

  const flushCurrent = () => {
    if (!currentHeader && !currentBody.length) {
      return;
    }
    if (records.length >= maxRecords) {
      return;
    }

    const [nameToken = '', ...rest] = String(currentHeader || '').trim().split(/\s+/);
    const description = rest.join(' ').trim();
    const sequence = normalizeSequenceText(currentBody.join(''));

    records.push({
      id: `fasta_${records.length + 1}`,
      name: normalizeRecordName(nameToken || `record_${records.length + 1}`),
      description,
      sourceFormat: 'fasta',
      topology: 'linear',
      sequence,
      quality: '',
      features: []
    });
  };

  lines.forEach((line) => {
    if (line.startsWith('>')) {
      flushCurrent();
      currentHeader = line.slice(1);
      currentBody = [];
      return;
    }
    if (!currentHeader && !line.trim()) {
      return;
    }
    currentBody.push(line.trim());
  });

  flushCurrent();

  if (!records.length) {
    errors.push('No FASTA records were parsed.');
  }

  if (records.length >= maxRecords) {
    warnings.push(`Input was truncated at ${maxRecords.toLocaleString()} FASTA records.`);
  }

  return {
    format: 'fasta',
    records,
    warnings,
    errors
  };
}

function parseFastqRecords(rawInput, options = {}) {
  const maxRecords = Math.max(1, Math.floor(Number(options.maxRecords) || DEFAULT_MAX_RECORDS));
  const lines = String(rawInput || '').replace(/\r\n?/g, '\n').split('\n');

  const records = [];
  const warnings = [];
  const errors = [];

  let cursor = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && !String(lines[cursor] || '').trim()) {
      cursor += 1;
    }
    if (cursor >= lines.length) {
      break;
    }

    if (records.length >= maxRecords) {
      warnings.push(`Input was truncated at ${maxRecords.toLocaleString()} FASTQ records.`);
      break;
    }

    const headerLine = String(lines[cursor] || '');
    if (!headerLine.startsWith('@')) {
      errors.push(`FASTQ parse error near line ${cursor + 1}: expected '@' header.`);
      break;
    }
    cursor += 1;

    const sequenceParts = [];
    while (cursor < lines.length) {
      const line = String(lines[cursor] || '');
      if (line.startsWith('+')) {
        break;
      }
      sequenceParts.push(line.trim());
      cursor += 1;
    }

    if (cursor >= lines.length || !String(lines[cursor] || '').startsWith('+')) {
      errors.push(`FASTQ parse error near line ${cursor + 1}: missing '+' separator line.`);
      break;
    }
    cursor += 1;

    const sequence = normalizeSequenceText(sequenceParts.join(''));
    let quality = '';

    while (cursor < lines.length && quality.length < sequence.length) {
      quality += String(lines[cursor] || '');
      cursor += 1;
    }

    if (quality.length < sequence.length) {
      errors.push(`FASTQ parse error near line ${cursor}: quality string shorter than sequence.`);
      break;
    }

    if (quality.length > sequence.length) {
      warnings.push(`FASTQ record ${records.length + 1} quality string was longer than sequence and was truncated.`);
      quality = quality.slice(0, sequence.length);
    }

    const headerText = headerLine.slice(1).trim();
    const [nameToken = '', ...rest] = headerText.split(/\s+/);

    records.push({
      id: `fastq_${records.length + 1}`,
      name: normalizeRecordName(nameToken || `read_${records.length + 1}`),
      description: rest.join(' ').trim(),
      sourceFormat: 'fastq',
      topology: 'linear',
      sequence,
      quality,
      features: []
    });
  }

  if (!records.length && !errors.length) {
    errors.push('No FASTQ records were parsed.');
  }

  return {
    format: 'fastq',
    records,
    warnings,
    errors
  };
}

function splitTopLevelArguments(raw) {
  const input = String(raw || '');
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeFeatureRange(startRaw, endRaw, sequenceLength, strand) {
  const len = Math.max(0, Number(sequenceLength) || 0);
  if (!len) {
    return [];
  }

  const start = clamp(Math.round(Number(startRaw) || 0), 1, len);
  const end = clamp(Math.round(Number(endRaw) || 0), 1, len);

  if (start <= end) {
    return [{
      start: start - 1,
      end,
      strand
    }];
  }

  return [
    {
      start: start - 1,
      end: len,
      strand
    },
    {
      start: 0,
      end,
      strand
    }
  ];
}

function parseSimpleLocationAtom(atom, sequenceLength, strand = 1) {
  const raw = String(atom || '').trim();
  if (!raw) {
    return [];
  }

  const body = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  const numbers = body.match(/\d+/g)?.map((part) => Number(part)) || [];
  if (!numbers.length) {
    return [];
  }

  if (body.includes('..') || body.includes('^')) {
    return normalizeFeatureRange(numbers[0], numbers[numbers.length - 1], sequenceLength, strand);
  }

  return normalizeFeatureRange(numbers[0], numbers[0], sequenceLength, strand);
}

function parseGenBankLocationSegments(rawExpression, sequenceLength, strand = 1) {
  const expression = String(rawExpression || '').replace(/\s+/g, '');
  if (!expression) {
    return [];
  }

  const lower = expression.toLowerCase();

  if (lower.startsWith('complement(') && expression.endsWith(')')) {
    const inner = expression.slice('complement('.length, -1);
    return parseGenBankLocationSegments(inner, sequenceLength, strand * -1);
  }

  if ((lower.startsWith('join(') || lower.startsWith('order(')) && expression.endsWith(')')) {
    const fnLength = lower.startsWith('join(') ? 'join('.length : 'order('.length;
    const inner = expression.slice(fnLength, -1);
    return splitTopLevelArguments(inner).flatMap((part) => parseGenBankLocationSegments(part, sequenceLength, strand));
  }

  return parseSimpleLocationAtom(expression, sequenceLength, strand);
}

function parseFeatureQualifier(line) {
  const token = String(line || '').trim().replace(/^\//, '');
  if (!token) {
    return null;
  }

  const equalIndex = token.indexOf('=');
  if (equalIndex === -1) {
    return { key: token.toLowerCase(), value: 'true', openQuote: false };
  }

  const key = token.slice(0, equalIndex).trim().toLowerCase();
  let value = token.slice(equalIndex + 1).trim();

  const quoted = value.startsWith('"');
  if (quoted) {
    value = value.slice(1);
  }

  let openQuote = false;
  if (value.endsWith('"')) {
    value = value.slice(0, -1);
  } else if (quoted) {
    openQuote = true;
  }

  return {
    key,
    value,
    openQuote
  };
}

function parseGenBankFeatureEntries(featureBlock, sequenceLength) {
  const lines = String(featureBlock || '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [];

  let current = null;

  const flush = () => {
    if (!current) {
      return;
    }
    entries.push(current);
    current = null;
  };

  lines.forEach((line) => {
    const featureMatch = line.match(/^\s{5}(\S+)\s+(.+)$/);
    if (featureMatch) {
      flush();
      current = {
        type: featureMatch[1],
        location: String(featureMatch[2] || '').trim(),
        qualifiers: {},
        pendingQualifierKey: ''
      };
      return;
    }

    if (!current) {
      return;
    }

    const qualifierMatch = line.match(/^\s{21}\/(.+)$/);
    if (qualifierMatch) {
      const parsed = parseFeatureQualifier(qualifierMatch[1]);
      if (!parsed) {
        return;
      }
      current.qualifiers[parsed.key] = parsed.value;
      current.pendingQualifierKey = parsed.openQuote ? parsed.key : '';
      return;
    }

    const continuationMatch = line.match(/^\s{21}(.+)$/);
    if (!continuationMatch) {
      return;
    }

    const continuation = String(continuationMatch[1] || '').trim();
    if (!continuation) {
      return;
    }

    if (current.pendingQualifierKey) {
      let text = continuation;
      let closed = false;
      if (text.endsWith('"')) {
        text = text.slice(0, -1);
        closed = true;
      }
      const merged = [current.qualifiers[current.pendingQualifierKey], text].filter(Boolean).join(' ');
      current.qualifiers[current.pendingQualifierKey] = merged;
      if (closed) {
        current.pendingQualifierKey = '';
      }
      return;
    }

    current.location += continuation;
  });

  flush();

  return entries
    .map((entry, index) => {
      const segmentsWithStrand = parseGenBankLocationSegments(entry.location, sequenceLength);
      if (!segmentsWithStrand.length) {
        return null;
      }

      const strand = segmentsWithStrand[0].strand === -1 ? -1 : 1;
      const segments = segmentsWithStrand.map((segment) => ({
        start: segment.start,
        end: segment.end
      }));
      const name = normalizeRecordName(
        entry.qualifiers.label
          || entry.qualifiers.gene
          || entry.qualifiers.locus_tag
          || entry.qualifiers.product
          || entry.type
          || `feature_${index + 1}`,
        `feature_${index + 1}`
      );

      const description = normalizeRecordName(
        entry.qualifiers.note
          || entry.qualifiers.product
          || entry.qualifiers.function
          || '',
        ''
      );

      return {
        id: `gbk_feature_${index + 1}`,
        name,
        type: String(entry.type || 'misc_feature').toLowerCase(),
        strand,
        description,
        source: 'genbank',
        locationText: entry.location,
        segments
      };
    })
    .filter(Boolean);
}

function parseGenBankRecords(rawInput) {
  const text = String(rawInput || '');
  const blocks = text
    .split(/^\s*\/\/\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);

  const records = [];
  const warnings = [];
  const errors = [];

  blocks.forEach((block, index) => {
    const locusMatch = block.match(/^\s*LOCUS\s+(\S+)(.*)$/im);
    const locusTail = String(locusMatch?.[2] || '');
    const name = normalizeRecordName(locusMatch?.[1] || `record_${index + 1}`, `record_${index + 1}`);
    const topology = /\bcircular\b/i.test(locusTail) ? 'circular' : 'linear';

    const originMatch = block.match(/^\s*ORIGIN\b([\s\S]*)$/im);
    if (!originMatch) {
      warnings.push(`GenBank record ${name} skipped: ORIGIN section not found.`);
      return;
    }

    const sequence = normalizeSequenceText(String(originMatch[1] || ''));
    if (!sequence.length) {
      warnings.push(`GenBank record ${name} skipped: ORIGIN section had no sequence.`);
      return;
    }

    const featuresMatch = block.match(/^\s*FEATURES\b([\s\S]*?)(?=^\s*ORIGIN\b)/im);
    const features = parseGenBankFeatureEntries(featuresMatch?.[1] || '', sequence.length);

    records.push({
      id: `genbank_${records.length + 1}`,
      name,
      description: '',
      sourceFormat: 'genbank',
      topology,
      sequence,
      quality: '',
      features
    });
  });

  if (!records.length && !errors.length) {
    errors.push('No GenBank records were parsed.');
  }

  return {
    format: 'genbank',
    records,
    warnings,
    errors
  };
}

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

function parseInputRecords(rawInput, options = {}) {
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
    type: normalizeRecordName(feature.type || 'misc_feature', 'misc_feature').toLowerCase(),
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

function normalizeExternalPayload(payload) {
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

function summarizeFastqQuality(qualityText) {
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

function buildFeatureLocationText(feature, sequenceLength) {
  if (feature.locationText) {
    return feature.locationText;
  }
  const len = Math.max(1, Number(sequenceLength) || 1);
  const segments = Array.isArray(feature.segments) ? feature.segments : [];
  if (!segments.length) {
    return '-';
  }

  return segments
    .map((segment) => {
      const start = clamp(segment.start + 1, 1, len);
      const end = clamp(segment.end, 1, len);
      return `${start}..${end}`;
    })
    .join(', ');
}

function hashTypeToColor(type) {
  const colors = ['#4e7fff', '#f6a35e', '#479f71', '#c97064', '#808080', '#2f8f9d', '#8b5cf6', '#a16207'];
  const key = String(type || 'misc_feature');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function parseHexColor(color) {
  const normalized = String(color || '').trim();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (raw.length === 3) {
    return {
      r: Number.parseInt(`${raw[0]}${raw[0]}`, 16),
      g: Number.parseInt(`${raw[1]}${raw[1]}`, 16),
      b: Number.parseInt(`${raw[2]}${raw[2]}`, 16)
    };
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  };
}

function getContrastTextColor(backgroundColor) {
  const rgb = parseHexColor(backgroundColor);
  if (!rgb) {
    return '#0f223e';
  }

  const toLinear = (channel) => {
    const srgb = clamp(channel, 0, 255) / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (
    (0.2126 * toLinear(rgb.r))
    + (0.7152 * toLinear(rgb.g))
    + (0.0722 * toLinear(rgb.b))
  );

  return luminance >= 0.42 ? '#0f223e' : '#ffffff';
}

function segmentsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function assignFeatureLanes(features) {
  const lanes = [];

  return features.map((feature) => {
    const segments = Array.isArray(feature.segments) ? feature.segments : [];
    let laneIndex = 0;

    while (laneIndex < lanes.length) {
      const laneSegments = lanes[laneIndex];
      const hasOverlap = segments.some((segment) => laneSegments.some((existing) => segmentsOverlap(segment, existing)));
      if (!hasOverlap) {
        break;
      }
      laneIndex += 1;
    }

    if (!lanes[laneIndex]) {
      lanes[laneIndex] = [];
    }
    lanes[laneIndex].push(...segments);

    return {
      ...feature,
      lane: laneIndex
    };
  });
}

function getOrfFeaturesForRecord(record, options = {}) {
  if (!record?.sequence) {
    return [];
  }
  const minAaLength = Math.max(1, Math.floor(Number(options?.minAaLength) || DEFAULT_MIN_ORF_AA_LENGTH));
  const cacheKey = `${record.sequence}|${normalizeTopology(record.topology)}|${minAaLength}`;
  const cached = ORF_FEATURE_CACHE.get(record);
  if (cached?.key === cacheKey && Array.isArray(cached.features)) {
    return cached.features;
  }

  const features = buildOrfFeatures(record.sequence, record.topology, { minAaLength });
  ORF_FEATURE_CACHE.set(record, { key: cacheKey, features });
  return features;
}

function isOrfFeature(feature) {
  if (!feature || typeof feature !== 'object') {
    return false;
  }
  return String(feature.type || '').toLowerCase() === 'open_reading_frame'
    || String(feature.source || '').toLowerCase() === 'orf';
}

function getRenderableFeaturesForRecord(record, options = {}) {
  const parsedFeatures = Array.isArray(record?.features) ? record.features : [];
  const includeOrf = Boolean(options?.includeOrf);
  const orfFeatures = includeOrf ? getOrfFeaturesForRecord(record, options) : [];
  const restrictionFeatures = getCommercialRestrictionFeaturesForRecord(record, {
    vendorFilter: options?.restrictionVendorFilter
  });
  return [...parsedFeatures, ...orfFeatures, ...restrictionFeatures];
}

function getOrfCodingIndices(feature, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength || !isOrfFeature(feature)) {
    return [];
  }

  const strand = feature?.strand === -1 ? -1 : 1;
  const segments = (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, safeLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, safeLength)
    }))
    .filter((segment) => segment.end > segment.start);
  if (!segments.length) {
    return [];
  }

  const indices = [];
  if (strand === 1) {
    segments.forEach((segment) => {
      for (let index = segment.start; index < segment.end; index += 1) {
        indices.push(index);
      }
    });
  } else {
    for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const segment = segments[segmentIndex];
      for (let index = segment.end - 1; index >= segment.start; index -= 1) {
        indices.push(index);
      }
    }
  }

  return indices;
}

function buildSelectedOrfTranslationContext(sequence, feature) {
  const text = normalizeSequenceText(sequence);
  const sequenceLength = text.length;
  if (!sequenceLength || !isOrfFeature(feature)) {
    return null;
  }

  const strand = feature?.strand === -1 ? -1 : 1;
  const codingIndices = getOrfCodingIndices(feature, sequenceLength);
  const codonCount = Math.floor(codingIndices.length / 3);
  if (!codonCount) {
    return null;
  }

  const codingSequence = [];
  for (let i = 0; i < codonCount * 3; i += 1) {
    const baseIndex = codingIndices[i];
    const genomicBase = text[baseIndex] || 'N';
    codingSequence.push(strand === -1 ? complementBase(genomicBase) : genomicBase);
  }
  const translated = translateDnaSequence(codingSequence.join(''), 1, 'star');
  const protein = String(translated?.protein || '');
  const anchors = [];

  for (let codonIndex = 0; codonIndex < codonCount; codonIndex += 1) {
    const aa = protein[codonIndex] || 'X';
    if (aa === '*') {
      continue;
    }
    const codonPositions = codingIndices.slice(codonIndex * 3, (codonIndex + 1) * 3);
    if (codonPositions.length !== 3) {
      continue;
    }
    const anchorIndex = Math.min(...codonPositions);
    anchors.push({
      baseIndex: anchorIndex,
      aa
    });
  }

  if (!anchors.length) {
    return null;
  }

  anchors.sort((left, right) => left.baseIndex - right.baseIndex);
  return {
    strand,
    anchors
  };
}

function buildHighlightedLineMarkup(sourceText, lineStart, lineEnd, lineHighlights) {
  let body = '';
  if (!lineHighlights.length) {
    return escapeHtml(sourceText.slice(lineStart, lineEnd));
  }

  let cursor = lineStart;
  lineHighlights.forEach((segment) => {
    if (segment.start > cursor) {
      body += escapeHtml(sourceText.slice(cursor, segment.start));
    }
    body += `<span class="sequence-viewer-seq-highlight">${escapeHtml(sourceText.slice(segment.start, segment.end))}</span>`;
    cursor = segment.end;
  });

  if (cursor < lineEnd) {
    body += escapeHtml(sourceText.slice(cursor, lineEnd));
  }
  return body;
}

function normalizeHighlightSegments(segments, sequenceLength = null) {
  const maxLength = Number.isFinite(Number(sequenceLength))
    ? Math.max(0, Number(sequenceLength))
    : Number.POSITIVE_INFINITY;
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, maxLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, maxLength)
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });

  if (!normalized.length) {
    return [];
  }

  const merged = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const previous = merged[merged.length - 1];
    const current = normalized[i];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function getEnanaApiBridge() {
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

function buildPlannotateFeaturesFromResult(result, fallbackSequenceLength, fallbackTopology = 'linear') {
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

  const bridge = getEnanaApiBridge();
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

function resolveRestrictionCutBaseIndices(feature) {
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

function getCommercialRestrictionFeaturesForRecord(record, options = {}) {
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

function formatRestrictionCutSummary(feature) {
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

function computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, charAdvancePx, cutBaseIndex = null) {
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

function resolveRestrictionCutLocalPx(cutBaseIndex, geometry, lineStart, charAdvancePx, segmentStart, segmentEnd) {
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

function buildRestrictionCutPolylinePoints(
  widthPx,
  topCutLocalPx,
  bottomCutLocalPx,
  boxHeightPx,
  topRowHeightPx,
  strandGapPx,
  labelGapPx = RESTRICTION_LABEL_GAP_PX
) {
  if (!Number.isFinite(topCutLocalPx) && !Number.isFinite(bottomCutLocalPx)) {
    return '';
  }

  const safeWidth = Math.max(1, Number(widthPx) || 1);
  const safeTopCutPx = Number.isFinite(topCutLocalPx) ? clamp(topCutLocalPx, 0, safeWidth) : null;
  const safeBottomCutPx = Number.isFinite(bottomCutLocalPx) ? clamp(bottomCutLocalPx, 0, safeWidth) : null;
  const topX = Number.isFinite(safeTopCutPx) ? safeTopCutPx : safeBottomCutPx;
  const bottomX = Number.isFinite(safeBottomCutPx) ? safeBottomCutPx : safeTopCutPx;
  const safeBoxHeight = Math.max(8, Number(boxHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX);
  const safeTopRowHeight = clamp(
    Number(topRowHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
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

function renderLineRestrictionAnnotationsHtml(
  indexedFeatures,
  lineStart,
  lineEnd,
  sequenceLength,
  selectedFeatureIndex,
  charAdvancePx,
  sequenceLineHeightPx
) {
  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const safeLineHeight = Math.max(8, Number(sequenceLineHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX);
  const pairBoxHeightPx = Math.max(safeLineHeight + 8, (safeLineHeight * 2) + STRAND_PAIR_ROW_GAP_PX);
  const lineWidthPx = Math.max(1, (Math.max(lineStart, lineEnd) - lineStart) * safeAdvance);
  const annotations = indexedFeatures
    .filter(({ feature }) => String(feature?.type || '').toLowerCase() === 'restriction_site')
    .flatMap(({ feature, index }) => {
      const segments = Array.isArray(feature?.segments) ? feature.segments : [];
      const cutBaseIndices = resolveRestrictionCutBaseIndices(feature);
      return segments
        .map((segment) => {
          const segmentStart = Number(segment?.start) || 0;
          const segmentEnd = Number(segment?.end) || 0;
          const geometry = computeRestrictionAnnotationGeometry(
            segment,
            lineStart,
            lineEnd,
            safeAdvance,
            Number(cutBaseIndices?.top)
          );
          if (!geometry) {
            return null;
          }

          const topCutLocalPx = resolveRestrictionCutLocalPx(
            Number(cutBaseIndices?.top),
            geometry,
            lineStart,
            safeAdvance,
            segmentStart,
            segmentEnd
          );
          const bottomCutLocalPx = resolveRestrictionCutLocalPx(
            Number(cutBaseIndices?.bottom),
            geometry,
            lineStart,
            safeAdvance,
            segmentStart,
            segmentEnd
          );
          const strandGapPx = Math.max(2, pairBoxHeightPx - (safeLineHeight * 2));
          const cutPoints = (Number.isFinite(topCutLocalPx) || Number.isFinite(bottomCutLocalPx))
            ? buildRestrictionCutPolylinePoints(
              geometry.widthPx,
              topCutLocalPx,
              bottomCutLocalPx,
              pairBoxHeightPx,
              safeLineHeight,
              strandGapPx,
              RESTRICTION_LABEL_GAP_PX
            )
            : '';
          const svgWidth = Math.max(1, geometry.widthPx);
          const svgHeight = RESTRICTION_LABEL_GAP_PX + pairBoxHeightPx;
          const location = buildFeatureLocationText(feature, sequenceLength);
          const isActive = index === selectedFeatureIndex;
          const title = `${feature.name || '-'} (${location})`;

          return `
            <button
              type="button"
              class="sequence-viewer-restriction-annot${isActive ? ' sequence-viewer-restriction-annot-active' : ''}"
              data-feature-index="${index}"
              style="left:${geometry.leftPx.toFixed(3)}px;width:${geometry.widthPx.toFixed(3)}px;--sequence-viewer-restriction-label-gap:${RESTRICTION_LABEL_GAP_PX}px;"
              title="${escapeHtml(title)}"
            >
              <span class="sequence-viewer-restriction-label">${escapeHtml(feature.name || `site_${index + 1}`)}</span>
              <span class="sequence-viewer-restriction-box"></span>
              ${cutPoints
    ? `<svg class="sequence-viewer-restriction-cut-svg" viewBox="0 0 ${svgWidth.toFixed(2)} ${svgHeight.toFixed(2)}" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${cutPoints}"></polyline>
              </svg>`
    : ''}
            </button>
          `;
        })
        .filter(Boolean);
    })
    .join('');

  if (!annotations) {
    return '';
  }

  return `<div class="sequence-viewer-line-restriction-track" style="width:${lineWidthPx.toFixed(3)}px;height:${pairBoxHeightPx.toFixed(3)}px;">${annotations}</div>`;
}

function renderLineFeatureButtonsHtml(
  indexedFeatures,
  lineStart,
  lineEnd,
  sequenceLength,
  selectedFeatureIndex,
  charAdvancePx,
  lineFeatureOffsetPx = (DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX)
) {
  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const safeOffset = Math.max(0, Number(lineFeatureOffsetPx) || 0);
  const lineWidthPx = Math.max(1, (Math.max(lineStart, lineEnd) - lineStart) * safeAdvance);

  const fragments = indexedFeatures
    .filter(({ feature }) => String(feature?.type || '').toLowerCase() !== 'restriction_site')
    .flatMap(({ feature, index }) => {
      const segments = Array.isArray(feature?.segments) ? feature.segments : [];
      const location = buildFeatureLocationText(feature, sequenceLength);
      const title = `${feature.name || '-'} (${location})`;
      const color = hashTypeToColor(String(feature?.type || 'misc_feature'));
      const textColor = getContrastTextColor(color);
      return segments
        .map((segment) => {
          const geometry = computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, safeAdvance);
          if (!geometry) {
            return null;
          }
          return {
            feature,
            index,
            title,
            color,
            textColor,
            leftPx: geometry.leftPx,
            widthPx: geometry.widthPx,
            rightPx: geometry.leftPx + geometry.widthPx
          };
        })
        .filter(Boolean);
    })
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) {
        return left.leftPx - right.leftPx;
      }
      return right.widthPx - left.widthPx;
    });

  if (!fragments.length) {
    return '';
  }

  const laneRightEdges = [];
  fragments.forEach((fragment) => {
    let laneIndex = laneRightEdges.findIndex((rightEdge) => fragment.leftPx >= rightEdge);
    if (laneIndex < 0) {
      laneIndex = laneRightEdges.length;
      laneRightEdges.push(fragment.rightPx);
    } else {
      laneRightEdges[laneIndex] = fragment.rightPx;
    }
    fragment.lane = laneIndex;
  });

  const laneCount = Math.max(1, laneRightEdges.length);
  const trackHeightPx = (laneCount * LINE_FEATURE_BAR_HEIGHT_PX) + ((laneCount - 1) * LINE_FEATURE_BAR_GAP_PX);
  const bars = fragments
    .map((fragment) => {
      const topPx = fragment.lane * (LINE_FEATURE_BAR_HEIGHT_PX + LINE_FEATURE_BAR_GAP_PX);
      const isActive = fragment.index === selectedFeatureIndex;
      const label = String(fragment.feature?.name || `feature_${fragment.index + 1}`);
      const labelWidthPx = (label.length * safeAdvance) + (LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX * 2);
      const showLabel = fragment.widthPx >= labelWidthPx;
      return `
        <button
          type="button"
          class="sequence-viewer-line-feature sequence-viewer-line-feature-bar${isActive ? ' sequence-viewer-line-feature-active' : ''}${showLabel ? '' : ' sequence-viewer-line-feature-compact'}"
          data-feature-index="${fragment.index}"
          style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;top:${topPx.toFixed(3)}px;background:${fragment.color};color:${fragment.textColor};"
          title="${escapeHtml(fragment.title)}"
        >${showLabel ? `<span class="sequence-viewer-line-feature-label">${escapeHtml(label)}</span>` : ''}</button>
      `;
    })
    .join('');

  return `<div class="sequence-viewer-line-features" style="width:${lineWidthPx.toFixed(3)}px;height:${trackHeightPx.toFixed(3)}px;margin-left:${safeOffset.toFixed(3)}px;">${bars}</div>`;
}

function buildAminoAcidLineMarkup(lineStart, lineEnd, orfTranslationContext) {
  const lineSpan = Math.max(0, lineEnd - lineStart);
  if (!lineSpan || !orfTranslationContext || !Array.isArray(orfTranslationContext.anchors)) {
    return '';
  }

  const chars = new Array(lineSpan).fill(' ');
  orfTranslationContext.anchors.forEach((anchor) => {
    const baseIndex = Number(anchor?.baseIndex);
    const aa = String(anchor?.aa || '').slice(0, 1);
    if (!Number.isFinite(baseIndex) || !aa) {
      return;
    }
    if (baseIndex < lineStart || baseIndex >= lineEnd) {
      return;
    }
    const offset = baseIndex - lineStart;
    chars[offset] = aa;
  });

  if (chars.every((char) => char === ' ')) {
    return '';
  }

  return chars
    .map((char) => (char === ' ' ? '&nbsp;' : escapeHtml(char)))
    .join('');
}

function renderOrfAminoAcidRowHtml(lineStart, lineEnd, orfTranslationContext) {
  const body = buildAminoAcidLineMarkup(lineStart, lineEnd, orfTranslationContext);
  if (!body) {
    return '';
  }

  const strandClass = orfTranslationContext?.strand === -1
    ? 'sequence-viewer-aa-row-minus'
    : 'sequence-viewer-aa-row-plus';

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-aa-row ${strandClass}">
      <span class="sequence-viewer-strand-end sequence-viewer-aa-label">${AMINO_ACID_ROW_LABEL}</span>
      <span class="sequence-viewer-seq-text sequence-viewer-aa-text">
        <span class="sequence-viewer-seq-text-content sequence-viewer-aa-text-content">${body}</span>
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-aa-label"></span>
    </div>
  `;
}

function renderDualStrandSequenceLinesHtml(sequence, highlightedSegments = [], options = {}) {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    return '<p class="small-note">No sequence loaded.</p>';
  }

  const lineLength = clamp(
    Math.round(Number(options?.lineLength) || DEFAULT_SEQUENCE_LINE_LENGTH),
    24,
    280
  );
  const charAdvancePx = Math.max(1, Number(options?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const sequenceLineHeightPx = Math.max(8, Number(options?.sequenceLineHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX);
  const lineFeatureOffsetPx = Math.max(
    0,
    Number(options?.lineFeatureOffsetPx) || (DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX)
  );
  const selectedFeatureIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const cursorBaseIndex = Number.isFinite(Number(options?.cursorBaseIndex))
    ? Number(options.cursorBaseIndex)
    : null;
  const indexedFeatures = Array.isArray(options?.features)
    ? options.features.map((feature, index) => ({ feature, index }))
    : [];
  const orfTranslationContext = options?.orfTranslationContext || null;
  const isOrfTranslationOnPlusStrand = Boolean(orfTranslationContext && orfTranslationContext.strand !== -1);
  const isOrfTranslationOnMinusStrand = Boolean(orfTranslationContext && orfTranslationContext.strand === -1);
  const complementary = complementSequence(text);
  const sortedHighlights = normalizeHighlightSegments(highlightedSegments, text.length);
  const strandPairHeightPx = Math.max(8, (sequenceLineHeightPx * 2) + STRAND_PAIR_ROW_GAP_PX);

  const lines = [];

  for (let lineStart = 0; lineStart < text.length; lineStart += lineLength) {
    const lineEnd = Math.min(text.length, lineStart + lineLength);
    const lineHighlights = sortedHighlights
      .map((segment) => ({
        start: Math.max(lineStart, segment.start),
        end: Math.min(lineEnd, segment.end)
      }))
      .filter((segment) => segment.end > segment.start)
      .sort((a, b) => a.start - b.start);

    const forwardBody = buildHighlightedLineMarkup(text, lineStart, lineEnd, lineHighlights);
    const complementaryBody = buildHighlightedLineMarkup(complementary, lineStart, lineEnd, lineHighlights);
    const aminoAcidRow = renderOrfAminoAcidRowHtml(lineStart, lineEnd, orfTranslationContext);
    const lineRestrictionAnnotations = renderLineRestrictionAnnotationsHtml(
      indexedFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      sequenceLineHeightPx
    );
    const lineFeatureButtons = renderLineFeatureButtonsHtml(
      indexedFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      lineFeatureOffsetPx
    );
    const hasCursorOnLine = Number.isFinite(cursorBaseIndex) && cursorBaseIndex >= lineStart && cursorBaseIndex <= lineEnd;
    const cursorLeftPx = hasCursorOnLine
      ? lineFeatureOffsetPx + ((cursorBaseIndex - lineStart) * charAdvancePx)
      : null;

    lines.push(`
      <div class="sequence-viewer-dual-line" data-line-start="${lineStart}" data-line-end="${lineEnd}">
        <span class="sequence-viewer-seq-coord">${(lineStart + 1).toLocaleString()}</span>
        <div class="sequence-viewer-strand-block">
          <div class="sequence-viewer-strand-pair">
            ${hasCursorOnLine
    ? `<span class="sequence-viewer-line-cursor" style="left:${cursorLeftPx.toFixed(3)}px;height:${strandPairHeightPx.toFixed(3)}px;" aria-hidden="true"></span>`
    : ''}
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-top">
              <span class="sequence-viewer-strand-end">5'</span>
              <span class="sequence-viewer-seq-text sequence-viewer-seq-text-top">
                <span class="sequence-viewer-seq-text-content">${forwardBody}</span>
                ${lineRestrictionAnnotations}
              </span>
              <span class="sequence-viewer-strand-end">3'</span>
            </div>
            ${isOrfTranslationOnPlusStrand ? aminoAcidRow : ''}
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-bottom">
              <span class="sequence-viewer-strand-end">3'</span>
              <span class="sequence-viewer-seq-text"><span class="sequence-viewer-seq-text-content">${complementaryBody}</span></span>
              <span class="sequence-viewer-strand-end">5'</span>
            </div>
            ${isOrfTranslationOnMinusStrand ? aminoAcidRow : ''}
          </div>
          ${lineFeatureButtons}
        </div>
      </div>
    `);
  }

  return lines.join('');
}

function formatSelectedFeatureDetailHtml(feature, sequenceLength) {
  if (!feature) {
    return '<p class="small-note">Select a feature in the bottom track to view details.</p>';
  }

  const strand = feature.strand === -1 ? '-' : '+';
  const location = buildFeatureLocationText(feature, sequenceLength);
  const identity = Number.isFinite(feature.identity) ? `${feature.identity.toFixed(2)}%` : 'n/a';
  const coverage = Number.isFinite(feature.coverage) ? `${feature.coverage.toFixed(2)}%` : 'n/a';
  const source = String(feature.mode || feature.source || '-');
  const recognitionSite = String(feature.site || '').trim();
  const cutSummary = formatRestrictionCutSummary(feature);
  const description = String(feature.description || '').trim();
  const enzymeNames = (Array.isArray(feature.enzymeNames) ? feature.enzymeNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const vendors = (Array.isArray(feature.vendors) ? feature.vendors : [])
    .map((vendor) => String(vendor || '').trim())
    .filter(Boolean);
  const isOrf = String(feature.type || '').toLowerCase() === 'open_reading_frame'
    || String(feature.source || '').toLowerCase() === 'orf';
  const orfFrame = String(feature.orfFrame || '').trim();
  const orfLengthNt = Math.max(0, Number(feature.orfLengthNt) || 0);
  const orfLengthAa = Math.max(0, Number(feature.orfLengthAa) || 0);
  const startCodon = String(feature.startCodon || '').trim();
  const stopCodon = String(feature.stopCodon || '').trim();
  const orfSummaryParts = [];
  if (orfFrame) {
    orfSummaryParts.push(`Frame ${escapeHtml(orfFrame)}`);
  }
  if (orfLengthAa > 0) {
    orfSummaryParts.push(`${orfLengthAa.toLocaleString()} aa`);
  }
  if (orfLengthNt > 0) {
    orfSummaryParts.push(`${orfLengthNt.toLocaleString()} nt`);
  }
  if (startCodon) {
    orfSummaryParts.push(`Start ${escapeHtml(startCodon)}`);
  }
  if (stopCodon) {
    orfSummaryParts.push(`Stop ${escapeHtml(stopCodon)}`);
  }

  return `
    <p><strong>${escapeHtml(feature.name || '-')}</strong></p>
    <p><strong>Type:</strong> ${escapeHtml(feature.type || '-')} · <strong>Strand:</strong> ${strand}</p>
    <p><strong>Location:</strong> ${escapeHtml(location)}</p>
    ${isOrf && orfSummaryParts.length ? `<p><strong>ORF:</strong> ${orfSummaryParts.join(' · ')}</p>` : ''}
    ${recognitionSite ? `<p><strong>Recognition Site:</strong> ${escapeHtml(recognitionSite)}</p>` : ''}
    ${cutSummary ? `<p><strong>${escapeHtml(cutSummary.label)}:</strong> ${escapeHtml(cutSummary.text)}</p>` : ''}
    ${enzymeNames.length ? `<p><strong>Enzymes:</strong> ${escapeHtml(enzymeNames.join(', '))}</p>` : ''}
    ${vendors.length ? `<p><strong>Vendors:</strong> ${escapeHtml(vendors.join(', '))}</p>` : ''}
    <p><strong>Identity:</strong> ${identity} · <strong>Coverage:</strong> ${coverage} · <strong>Source:</strong> ${escapeHtml(source)}</p>
    ${description ? `<p class="small-note">${escapeHtml(description)}</p>` : ''}
  `;
}

function readStoragePathFromLocalState() {
  try {
    const raw = globalThis?.localStorage?.getItem?.('enana_state_v1');
    if (!raw) {
      return '';
    }
    const parsed = JSON.parse(raw);
    return String(parsed?.settings?.storagePath || '').trim();
  } catch {
    return '';
  }
}

function toGenbankDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const normalized = Number.isFinite(date.getTime()) ? date : new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(normalized.getDate()).padStart(2, '0');
  const month = months[normalized.getMonth()] || 'JAN';
  const year = String(normalized.getFullYear());
  return `${day}-${month}-${year}`;
}

function wrapGenbankLine(value, firstPrefix, continuationPrefix = firstPrefix, width = 80) {
  const text = String(value ?? '');
  if (!text.length) {
    return [firstPrefix];
  }

  const lines = [];
  let remaining = text;
  let prefix = firstPrefix;

  while (remaining.length) {
    const available = Math.max(1, width - prefix.length);
    if (remaining.length <= available) {
      lines.push(`${prefix}${remaining}`);
      break;
    }

    let splitAt = remaining.lastIndexOf(' ', available);
    if (splitAt <= 0 || splitAt < Math.floor(available * 0.35)) {
      splitAt = available;
    }

    const chunk = remaining.slice(0, splitAt);
    lines.push(`${prefix}${chunk}`);
    remaining = remaining.slice(splitAt).trimStart();
    prefix = continuationPrefix;
  }

  return lines;
}

function sanitizeGenbankToken(value, fallback = 'sequence', maxLength = 16) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, maxLength);
  return cleaned || fallback;
}

function sanitizeGenbankFeatureType(type) {
  const cleaned = String(type || 'misc_feature')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  return cleaned || 'misc_feature';
}

function sanitizeGenbankQualifierValue(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '\'');
}

function buildGenbankFeatureLocation(feature, sequenceLength) {
  const strand = feature?.strand === -1 ? -1 : 1;
  const rawSegments = Array.isArray(feature?.segments) ? feature.segments : [];
  const segments = rawSegments
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, sequenceLength)
    }))
    .filter((segment) => segment.end > segment.start);

  if (!segments.length) {
    return '';
  }

  const ordered = strand === -1 ? [...segments].reverse() : segments;
  const parts = ordered.map((segment) => `${segment.start + 1}..${segment.end}`);
  const location = parts.length === 1 ? parts[0] : `join(${parts.join(',')})`;
  return strand === -1 ? `complement(${location})` : location;
}

function formatGenbankOriginLines(sequence) {
  const lines = ['ORIGIN'];
  const lower = String(sequence || '').toLowerCase();

  for (let i = 0; i < lower.length; i += 60) {
    const chunk = lower.slice(i, i + 60);
    const groups = [];
    for (let j = 0; j < chunk.length; j += 10) {
      groups.push(chunk.slice(j, j + 10));
    }
    lines.push(`${String(i + 1).padStart(9, ' ')} ${groups.join(' ')}`);
  }

  return lines;
}

function buildRecordGenbankText(record) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  if (!sequence.length) {
    return '';
  }

  const topology = normalizeTopology(record?.topology || 'linear');
  const locusName = sanitizeGenbankToken(record?.name || 'sequence', 'sequence', 16);
  const dateStamp = toGenbankDate(new Date());
  const sourceFormat = String(record?.sourceFormat || '').trim().toUpperCase() || 'SEQUENCE_VIEWER';
  const definition = normalizeRecordName(record?.description || record?.name || '.', '.');
  const features = Array.isArray(record?.features) ? record.features : [];
  const lines = [
    `LOCUS       ${locusName.padEnd(16, ' ')}${String(sequence.length).padStart(11, ' ')} bp    DNA     ${topology.padEnd(8, ' ')} SYN ${dateStamp}`,
    ...wrapGenbankLine(definition, 'DEFINITION  ', '            '),
    ...wrapGenbankLine('.', 'ACCESSION   ', '            '),
    ...wrapGenbankLine('.', 'VERSION     ', '            '),
    'KEYWORDS    .',
    ...wrapGenbankLine('synthetic DNA construct', 'SOURCE      ', '            '),
    ...wrapGenbankLine('synthetic DNA construct', '  ORGANISM  ', '            '),
    '            .',
    ...wrapGenbankLine(`Exported from Sequence Viewer (${sourceFormat}).`, 'COMMENT     ', '            '),
    'FEATURES             Location/Qualifiers'
  ];

  features.forEach((feature) => {
    const location = buildGenbankFeatureLocation(feature, sequence.length);
    if (!location) {
      return;
    }
    const type = sanitizeGenbankFeatureType(feature?.type).slice(0, 16);
    const featurePrefix = `     ${type.padEnd(16, ' ')}`;
    const qualifierPrefix = '                     ';

    lines.push(...wrapGenbankLine(location, featurePrefix, qualifierPrefix));
    const qualifiers = [
      ['label', feature?.name || type],
      ['note', feature?.description || '']
    ];

    qualifiers.forEach(([key, rawValue]) => {
      const value = sanitizeGenbankQualifierValue(rawValue);
      if (!value) {
        return;
      }
      lines.push(...wrapGenbankLine(`/${key}="${value}"`, qualifierPrefix, qualifierPrefix));
    });
  });

  lines.push(...formatGenbankOriginLines(sequence));
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

function ratioToCircularAngle(ratio) {
  return ((Math.max(0, ratio) * Math.PI * 2) - (Math.PI / 2));
}

function polarPoint(cx, cy, radius, theta) {
  return {
    x: cx + (radius * Math.cos(theta)),
    y: cy + (radius * Math.sin(theta))
  };
}

function buildCircularSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio) {
  const safeStart = clamp(Number(startRatio) || 0, 0, 1);
  const safeEnd = clamp(Number(endRatio) || 0, 0, 1);
  const span = Math.max(0, safeEnd - safeStart);
  if (span <= 0) {
    return '';
  }

  const startTheta = ratioToCircularAngle(safeStart);
  const endTheta = ratioToCircularAngle(safeEnd);
  const outerStart = polarPoint(cx, cy, outerRadius, startTheta);
  const outerEnd = polarPoint(cx, cy, outerRadius, endTheta);
  const innerEnd = polarPoint(cx, cy, innerRadius, endTheta);
  const innerStart = polarPoint(cx, cy, innerRadius, startTheta);
  const largeArc = span > 0.5 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

function buildCircularPreviewHtmlDocument(record) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  const sequenceLength = sequence.length;
  const rawFeatures = Array.isArray(record?.features) ? record.features : [];
  const previewFeatures = rawFeatures
    .filter((feature) => String(feature?.type || '').toLowerCase() !== 'restriction_site')
    .filter((feature) => Array.isArray(feature?.segments) && feature.segments.length);
  const layoutFeatures = assignFeatureLanes(previewFeatures);

  const cx = 400;
  const cy = 360;
  const laneStep = 14;
  const backboneInner = 192;
  const featureThickness = 10;
  const maxLane = Math.max(0, ...layoutFeatures.map((feature) => Number(feature.lane) || 0));
  const outerRadius = backboneInner + featureThickness + (Math.max(1, maxLane + 1) * laneStep) + 16;
  const tickPaths = [];
  const segmentPaths = [];

  const tickCount = sequenceLength > 5000 ? 20 : 12;
  for (let i = 0; i < tickCount; i += 1) {
    const ratio = i / tickCount;
    const theta = ratioToCircularAngle(ratio);
    const from = polarPoint(cx, cy, backboneInner - 8, theta);
    const to = polarPoint(cx, cy, backboneInner + 8, theta);
    tickPaths.push(`<line x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" stroke="#8ca5c5" stroke-width="1"></line>`);
  }

  layoutFeatures.forEach((feature, index) => {
    const lane = Number(feature?.lane) || 0;
    const innerRadius = backboneInner + (lane * laneStep);
    const outerFeatureRadius = innerRadius + featureThickness;
    const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
    const fill = hashTypeToColor(colorKey);
    const title = `${feature.name || `feature_${index + 1}`} (${buildFeatureLocationText(feature, sequenceLength)})`;

    (Array.isArray(feature?.segments) ? feature.segments : []).forEach((segment) => {
      const start = clamp(Number(segment?.start) || 0, 0, sequenceLength);
      const end = clamp(Number(segment?.end) || 0, 0, sequenceLength);
      if (end <= start || !sequenceLength) {
        return;
      }
      const path = buildCircularSegmentPath(
        cx,
        cy,
        innerRadius,
        outerFeatureRadius,
        start / sequenceLength,
        end / sequenceLength
      );
      if (!path) {
        return;
      }
      segmentPaths.push(`<path d="${path}" fill="${fill}" stroke="#284a75" stroke-width="1.4"><title>${escapeHtml(title)}</title></path>`);
    });
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(record?.name || 'Sequence')}</title>
  <style>
    body { margin:0; padding:12px; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#1e3553; background:#f5f8fc; }
    .card { border:1px solid #d4deec; border-radius:12px; background:#fff; padding:10px; }
    svg { width:100%; height:auto; max-height:740px; display:block; }
  </style>
</head>
<body>
  <div class="card">
    <svg viewBox="0 0 800 760" role="img" aria-label="Circular plasmid preview">
      <circle cx="${cx}" cy="${cy}" r="${(backboneInner - 6).toFixed(2)}" fill="#f8fbff" stroke="#dbe6f5" stroke-width="2"></circle>
      <circle cx="${cx}" cy="${cy}" r="${backboneInner.toFixed(2)}" fill="none" stroke="#96aed0" stroke-width="2.2"></circle>
      ${tickPaths.join('')}
      ${segmentPaths.join('')}
    </svg>
  </div>
</body>
</html>`;
}

export function initSequenceViewer(options = {}) {
  const LIBRARY_STATUS_SAVED = 'saved';
  const LIBRARY_STATUS_TEMPORARY = 'temporary';
  const FILE_ACCEPT = '.gbk,.gb,.gbff,.fasta,.fa,.fas,.fna,.fastq,.fq,.txt,.seq';

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const homePasteBtn = document.getElementById('sequence-viewer-home-paste-btn');
  const homeOpenBtn = document.getElementById('sequence-viewer-home-open-btn');
  const homeOpenInput = document.getElementById('sequence-viewer-home-open-input');
  const homeStatusNote = document.getElementById('sequence-viewer-home-status');
  const libraryFilterSavedBtn = document.getElementById('sequence-viewer-library-filter-saved');
  const libraryFilterTemporaryBtn = document.getElementById('sequence-viewer-library-filter-temporary');
  const libraryList = document.getElementById('sequence-viewer-library-list');
  const previewHost = document.getElementById('sequence-viewer-preview-host');
  const backBtn = document.getElementById('sequence-viewer-back-btn');
  const saveBtn = document.getElementById('sequence-viewer-save-btn');
  const saveNameInput = document.getElementById('sequence-viewer-save-name');

  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  const pastePanel = document.getElementById('sequence-viewer-paste-panel');
  const filePanel = document.getElementById('sequence-viewer-file-panel');
  const inputTextarea = document.getElementById('sequence-viewer-textarea');
  const fileInput = document.getElementById('sequence-viewer-file-input');
  const fileChooseBtn = document.getElementById('sequence-viewer-file-choose');
  const fileNameLabel = document.getElementById('sequence-viewer-file-name');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  const orfToggle = document.getElementById('sequence-viewer-orf-toggle');
  const restrictionNebToggle = document.getElementById('sequence-viewer-restriction-neb-toggle');
  const restrictionThermoToggle = document.getElementById('sequence-viewer-restriction-thermo-toggle');
  const clearBtn = document.getElementById('sequence-viewer-clear-btn');
  const statusNote = document.getElementById('sequence-viewer-status');
  const messageBox = document.getElementById('sequence-viewer-messages');
  const recordSelect = document.getElementById('sequence-viewer-record-select');

  const statFormat = document.getElementById('sequence-viewer-stat-format');
  const statLength = document.getElementById('sequence-viewer-stat-length');
  const statTopology = document.getElementById('sequence-viewer-stat-topology');
  const statGc = document.getElementById('sequence-viewer-stat-gc');
  const statAmbiguous = document.getElementById('sequence-viewer-stat-ambiguous');
  const statQuality = document.getElementById('sequence-viewer-stat-quality');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const statRestrictionSites = document.getElementById('sequence-viewer-stat-restriction-sites');

  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');

  const state = {
    mode: 'paste',
    fileName: '',
    fileText: '',
    records: [],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    warnings: [],
    errors: [],
    annotationWarnings: [],
    isAnnotating: false,
    orfViewEnabled: false,
    restrictionVendorFilter: {
      ...DEFAULT_RESTRICTION_VENDOR_FILTER
    },
    inputComposerVisible: true,
    libraryFilter: LIBRARY_STATUS_SAVED,
    libraryEntries: [],
    selectedLibraryEntryId: '',
    activeEntryId: '',
    activeEntryStatus: '',
    lastLibraryClickEntryId: '',
    lastLibraryClickAt: 0,
    sequenceSelectionAnchor: null,
    sequenceSelectionFocus: null,
    sequenceCursorBase: null,
    isSelectingSequence: false,
    sequenceLayout: {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: FALLBACK_CHAR_ADVANCE_PX,
      lineHeightPx: FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
      lineFeatureOffsetPx: DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX
    }
  };

  const sequenceHoverTooltip = (() => {
    if (
      typeof document === 'undefined'
      || typeof document.createElement !== 'function'
      || !document.body
      || typeof document.body.appendChild !== 'function'
    ) {
      return null;
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'sequence-viewer-feature-hover-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    return tooltip;
  })();

  function getBridge() {
    return getEnanaApiBridge();
  }

  function getStoragePath() {
    return readStoragePathFromLocalState();
  }

  function hasStoragePath() {
    return Boolean(getStoragePath());
  }

  function setHomeStatus(message, isError = false) {
    if (!homeStatusNote) {
      return;
    }
    homeStatusNote.textContent = message;
    homeStatusNote.style.color = isError ? 'var(--danger)' : '';
  }

  const onNavigateHome = typeof options?.onNavigateHome === 'function'
    ? options.onNavigateHome
    : null;
  const onNavigateDetail = typeof options?.onNavigateDetail === 'function'
    ? options.onNavigateDetail
    : null;

  function setLocalWorkspaceVisibility(mode) {
    const next = mode === 'detail' ? 'detail' : 'home';
    if (homeWorkspace) {
      homeWorkspace.hidden = next !== 'home';
    }
    if (detailWorkspace) {
      detailWorkspace.hidden = next !== 'detail';
    }
  }

  function navigateToHome() {
    setLocalWorkspaceVisibility('home');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function navigateToDetail() {
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
  }

  function setLibraryFilter(status) {
    state.libraryFilter = status === LIBRARY_STATUS_TEMPORARY ? LIBRARY_STATUS_TEMPORARY : LIBRARY_STATUS_SAVED;
    if (libraryFilterSavedBtn) {
      libraryFilterSavedBtn.classList.toggle('sequence-viewer-library-switch-btn-active', state.libraryFilter === LIBRARY_STATUS_SAVED);
    }
    if (libraryFilterTemporaryBtn) {
      libraryFilterTemporaryBtn.classList.toggle('sequence-viewer-library-switch-btn-active', state.libraryFilter === LIBRARY_STATUS_TEMPORARY);
    }
  }

  function syncHomeControlsState() {
    const hasStorage = hasStoragePath();
    if (libraryFilterSavedBtn) {
      libraryFilterSavedBtn.disabled = !hasStorage;
    }
    if (libraryFilterTemporaryBtn) {
      libraryFilterTemporaryBtn.disabled = !hasStorage;
    }
    if (saveBtn) {
      saveBtn.disabled = !getSelectedRecord()?.sequence?.length;
    }
  }

  function renderPreviewFromHtml(entry, htmlText) {
    if (!previewHost) {
      return;
    }
    if (!entry || !String(htmlText || '').trim()) {
      previewHost.innerHTML = '<p class="small-note">Select a sequence in the library to preview.</p>';
      return;
    }

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(htmlText))}`;
    previewHost.innerHTML = `<iframe class="sequence-viewer-preview-frame" src="${dataUrl}" loading="lazy" title="${escapeHtml(entry.name || 'Sequence preview')}"></iframe>`;
  }

  function renderLibraryList() {
    if (!libraryList) {
      return;
    }
    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    if (!entries.length) {
      const noun = state.libraryFilter === LIBRARY_STATUS_SAVED ? 'saved' : 'unsaved';
      libraryList.innerHTML = `<p class="small-note">No ${noun} sequence entries.</p>`;
      return;
    }

    libraryList.innerHTML = entries
      .map((entry) => {
        const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
        const lengthLabel = `${Math.max(0, Number(entry.sequenceLength) || 0).toLocaleString()} bp`;
        const featureLabel = `${Math.max(0, Number(entry.featureCount) || 0).toLocaleString()} features`;
        const updated = String(entry.updatedAt || '').slice(0, 16).replace('T', ' ');
        return `
          <button
            type="button"
            class="sequence-viewer-library-item${active ? ' sequence-viewer-library-item-active' : ''}"
            data-sequence-entry-id="${escapeHtml(entry.id)}"
            title="${escapeHtml(entry.name || 'sequence')}"
          >
            <span class="sequence-viewer-library-item-name">${escapeHtml(entry.name || 'sequence')}</span>
            <span class="sequence-viewer-library-item-meta">${escapeHtml(lengthLabel)} · ${escapeHtml(entry.topology || 'linear')}</span>
            <span class="sequence-viewer-library-item-meta">${escapeHtml(featureLabel)} · updated ${escapeHtml(updated || '-')}</span>
          </button>
        `;
      })
      .join('');
  }

  async function loadSelectedLibraryPreview() {
    const entryId = cleanText(state.selectedLibraryEntryId, 200);
    const storagePath = getStoragePath();
    if (!entryId || !storagePath) {
      renderPreviewFromHtml(null, '');
      return;
    }
    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      renderPreviewFromHtml(null, '');
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: entryId,
        includeHtml: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load preview.');
      }
      renderPreviewFromHtml(response.entry, response.htmlText || '');
    } catch (error) {
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load preview.', true);
    }
  }

  async function refreshLibraryEntries(options = {}) {
    const storagePath = getStoragePath();
    syncHomeControlsState();
    if (!storagePath) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreviewFromHtml(null, '');
      setHomeStatus('Use New or Open to continue. Set Storage Folder Path in Settings to enable the saved/unsaved library.');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryList) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryList({
        storagePath,
        status: state.libraryFilter
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to list sequence entries.');
      }
      const entries = Array.isArray(response.entries) ? response.entries : [];
      state.libraryEntries = entries;

      const preferred = cleanText(options.selectedId, 200)
        || cleanText(state.selectedLibraryEntryId, 200);
      const nextSelected = entries.some((entry) => cleanText(entry.id, 200) === preferred)
        ? preferred
        : (entries[0]?.id || '');
      state.selectedLibraryEntryId = cleanText(nextSelected, 200);

      renderLibraryList();
      await loadSelectedLibraryPreview();
      if (!options.silent) {
        setHomeStatus(`Loaded ${entries.length} ${state.libraryFilter} sequence entr${entries.length === 1 ? 'y' : 'ies'}.`);
      }
    } catch (error) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load sequence library.', true);
    }
  }

  async function setSelectedLibraryEntry(entryId) {
    state.selectedLibraryEntryId = cleanText(entryId, 200);
    renderLibraryList();
    await loadSelectedLibraryPreview();
  }

  function resolveLibraryEntryIdFromEvent(event) {
    const target = event?.target;
    const direct = cleanText(target?.dataset?.sequenceEntryId, 200);
    if (direct) {
      return direct;
    }

    const viaClosest = cleanText(
      target?.closest?.('[data-sequence-entry-id]')?.dataset?.sequenceEntryId,
      200
    );
    if (viaClosest) {
      return viaClosest;
    }

    let cursor = target?.parentElement || target?.parentNode || null;
    while (cursor) {
      const resolved = cleanText(cursor?.dataset?.sequenceEntryId, 200);
      if (resolved) {
        return resolved;
      }
      cursor = cursor.parentElement || cursor.parentNode || null;
    }

    return '';
  }

  function getFeatureByIndexForRecord(record, index) {
    if (!record || !Number.isFinite(index) || index < 0) {
      return null;
    }
    const features = getVisibleFeaturesForRecord(record);
    return features[index] || null;
  }

  function findFeatureIndexByIdentity(features, feature) {
    if (!Array.isArray(features) || !features.length || !feature) {
      return -1;
    }
    const featureId = cleanText(feature.id, 240);
    if (featureId) {
      const byId = features.findIndex((item) => cleanText(item?.id, 240) === featureId);
      if (byId >= 0) {
        return byId;
      }
    }

    const source = cleanText(feature.source, 120);
    const name = cleanText(feature.name, 240);
    const type = cleanText(feature.type, 120);
    const strand = feature?.strand === -1 ? -1 : 1;
    const segmentKey = (Array.isArray(feature?.segments) ? feature.segments : [])
      .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
      .join(',');
    return features.findIndex((item) => {
      if (!item) {
        return false;
      }
      const itemSegmentKey = (Array.isArray(item?.segments) ? item.segments : [])
        .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
        .join(',');
      return cleanText(item.source, 120) === source
        && cleanText(item.name, 240) === name
        && cleanText(item.type, 120) === type
        && (item?.strand === -1 ? -1 : 1) === strand
        && itemSegmentKey === segmentKey;
    });
  }

  function hideSequenceHoverTooltip() {
    if (!sequenceHoverTooltip) {
      return;
    }
    sequenceHoverTooltip.hidden = true;
  }

  function buildFeatureHoverTooltipHtml(feature, sequenceLength) {
    const strand = feature?.strand === -1 ? '-' : '+';
    const location = buildFeatureLocationText(feature, sequenceLength);
    const identity = Number.isFinite(feature?.identity) ? `${feature.identity.toFixed(2)}%` : '';
    const coverage = Number.isFinite(feature?.coverage) ? `${feature.coverage.toFixed(2)}%` : '';
    const source = String(feature?.mode || feature?.source || '-');
    const meta = [identity ? `Identity ${identity}` : '', coverage ? `Coverage ${coverage}` : '', source].filter(Boolean).join(' · ');

    return `
      <p class="sequence-viewer-feature-hover-title">${escapeHtml(feature?.name || '-')}</p>
      <p>${escapeHtml(feature?.type || '-')} · Strand ${strand}</p>
      <p>${escapeHtml(location)}</p>
      <p>${escapeHtml(meta)}</p>
    `;
  }

  function showSequenceHoverTooltip(event, feature, sequenceLength) {
    if (!sequenceHoverTooltip || !feature) {
      return;
    }

    sequenceHoverTooltip.innerHTML = buildFeatureHoverTooltipHtml(feature, sequenceLength);
    sequenceHoverTooltip.hidden = false;

    const rawX = Number(event?.clientX);
    const rawY = Number(event?.clientY);
    const startX = Number.isFinite(rawX) ? rawX + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const startY = Number.isFinite(rawY) ? rawY + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const tooltipRect = sequenceHoverTooltip.getBoundingClientRect();
    const viewportWidth = Number(globalThis?.innerWidth) || 0;
    const viewportHeight = Number(globalThis?.innerHeight) || 0;

    let left = Math.max(8, startX);
    let top = Math.max(8, startY);

    if (viewportWidth > 0) {
      left = Math.min(left, Math.max(8, viewportWidth - tooltipRect.width - 8));
    }
    if (viewportHeight > 0) {
      top = Math.min(top, Math.max(8, viewportHeight - tooltipRect.height - 8));
    }

    sequenceHoverTooltip.style.left = `${left}px`;
    sequenceHoverTooltip.style.top = `${top}px`;
  }

  function measureSequenceTypography() {
    let charAdvancePx = FALLBACK_CHAR_ADVANCE_PX;
    let lineHeightPx = FALLBACK_SEQUENCE_LINE_HEIGHT_PX;

    if (typeof document !== 'undefined' && sequenceHost && typeof sequenceHost.appendChild === 'function') {
      let probe = null;
      try {
        probe = document.createElement('span');
        probe.className = 'sequence-viewer-seq-text';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.whiteSpace = 'nowrap';
        probe.style.display = 'inline-block';
        probe.style.width = 'auto';
        const sampleLength = 40;
        probe.textContent = 'A'.repeat(sampleLength);
        sequenceHost.appendChild(probe);

        const measuredAdvance = probe.getBoundingClientRect().width / sampleLength;
        if (Number.isFinite(measuredAdvance) && measuredAdvance > 0) {
          charAdvancePx = measuredAdvance;
        }

        if (typeof globalThis.getComputedStyle === 'function') {
          const computed = globalThis.getComputedStyle(probe);
          const measuredLineHeight = parseCssPixels(computed?.lineHeight);
          if (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0) {
            lineHeightPx = measuredLineHeight;
          } else {
            const measuredFontSize = parseCssPixels(computed?.fontSize);
            if (Number.isFinite(measuredFontSize) && measuredFontSize > 0) {
              lineHeightPx = measuredFontSize * 1.35;
            }
          }
        }
      } catch {
        // Keep fallback typography metrics.
      } finally {
        probe?.remove?.();
      }
    }

    return {
      charAdvancePx: Math.max(1, charAdvancePx),
      lineHeightPx: Math.max(8, lineHeightPx)
    };
  }

  function computeSequenceLayoutMetrics() {
    const typography = measureSequenceTypography();
    const fallbackFeatureOffsetPx = DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX;
    if (!sequenceHost || typeof sequenceHost.clientWidth !== 'number') {
      return {
        lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
        charAdvancePx: typography.charAdvancePx,
        lineHeightPx: typography.lineHeightPx,
        lineFeatureOffsetPx: fallbackFeatureOffsetPx
      };
    }

    const hostWidth = Math.max(0, sequenceHost.clientWidth);
    if (!hostWidth) {
      return {
        lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
        charAdvancePx: typography.charAdvancePx,
        lineHeightPx: typography.lineHeightPx,
        lineFeatureOffsetPx: fallbackFeatureOffsetPx
      };
    }

    const compact = hostWidth <= 640;
    const coordColumn = compact ? 58 : 74;
    const dualGap = compact ? 8 : 10;
    const strandEndColumn = compact ? 24 : 28;
    const strandEndGap = DEFAULT_STRAND_COLUMN_GAP_PX;
    const lineFeatureOffsetPx = strandEndColumn + strandEndGap;

    let hostPadding = 0;
    if (typeof globalThis.getComputedStyle === 'function') {
      const computed = globalThis.getComputedStyle(sequenceHost);
      hostPadding = parseCssPixels(computed?.paddingLeft) + parseCssPixels(computed?.paddingRight);
    }

    const usableWidth = Math.max(
      120,
      hostWidth - hostPadding - coordColumn - dualGap - (strandEndColumn * 2) - (strandEndGap * 2) - 12
    );
    const lineLength = clamp(Math.floor(usableWidth / Math.max(4.2, typography.charAdvancePx)), 24, 280);

    return {
      lineLength,
      charAdvancePx: typography.charAdvancePx,
      lineHeightPx: typography.lineHeightPx,
      lineFeatureOffsetPx
    };
  }

  function setInputComposerVisible(visible) {
    const shouldShow = visible !== false;
    state.inputComposerVisible = shouldShow;

    if (modePasteBtn) {
      modePasteBtn.hidden = !shouldShow;
    }
    if (modeFileBtn) {
      modeFileBtn.hidden = !shouldShow;
    }
    if (loadBtn) {
      loadBtn.hidden = !shouldShow;
    }

    if (pastePanel) {
      pastePanel.hidden = !shouldShow || state.mode !== 'paste';
    }
    if (filePanel) {
      filePanel.hidden = !shouldShow || state.mode !== 'file';
    }
  }

  function setMode(mode) {
    const resolved = mode === 'file' ? 'file' : 'paste';
    state.mode = resolved;

    if (modePasteBtn) {
      modePasteBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'paste');
    }
    if (modeFileBtn) {
      modeFileBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'file');
    }
    if (pastePanel) {
      pastePanel.hidden = !state.inputComposerVisible || resolved !== 'paste';
    }
    if (filePanel) {
      filePanel.hidden = !state.inputComposerVisible || resolved !== 'file';
    }
  }

  function setStatus(message, isError = false) {
    if (!statusNote) {
      return;
    }
    statusNote.textContent = message;
    statusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function updateMessages() {
    if (!messageBox) {
      return;
    }
    const rows = [
      ...state.errors.map((text) => `<p class="small-note" style="color:var(--danger);">${escapeHtml(text)}</p>`),
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`),
      ...state.annotationWarnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];

    messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
  }

  function getVisibleFeaturesForRecord(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: state.orfViewEnabled,
      restrictionVendorFilter: state.restrictionVendorFilter
    });
  }

  function clearSequenceSelection(options = {}) {
    const preserveCursor = Boolean(options?.preserveCursor);
    state.sequenceSelectionAnchor = null;
    state.sequenceSelectionFocus = null;
    state.isSelectingSequence = false;
    if (!preserveCursor) {
      state.sequenceCursorBase = null;
    }
  }

  function getSequenceSelectionSegments(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return [];
    }

    const anchor = Number(state.sequenceSelectionAnchor);
    const focus = Number(state.sequenceSelectionFocus);
    if (!Number.isFinite(anchor) || !Number.isFinite(focus)) {
      return [];
    }

    const start = clamp(Math.min(anchor, focus), 0, sequenceLength);
    const end = clamp(Math.max(anchor, focus), 0, sequenceLength);
    if (end <= start) {
      return [];
    }
    return [{ start, end }];
  }

  function resolveSequenceBoundaryFromEvent(event, record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return null;
    }

    const target = event?.target;
    const lineElement = target?.closest?.('.sequence-viewer-dual-line') || null;
    if (!lineElement) {
      return null;
    }

    const lineStart = Number(lineElement?.dataset?.lineStart);
    const lineEnd = Number(lineElement?.dataset?.lineEnd);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineEnd <= lineStart) {
      return null;
    }

    const lineSpan = lineEnd - lineStart;
    const seqTextElement = lineElement.querySelector?.('.sequence-viewer-strand-row-top .sequence-viewer-seq-text');
    const rawX = Number(event?.clientX);
    const safeAdvance = Math.max(1, Number(state.sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);

    let relativeX = null;
    if (seqTextElement && Number.isFinite(rawX) && typeof seqTextElement.getBoundingClientRect === 'function') {
      const rect = seqTextElement.getBoundingClientRect();
      if (Number.isFinite(rect?.left) && Number.isFinite(rect?.width) && rect.width > 0) {
        relativeX = clamp(rawX - rect.left, 0, rect.width);
      }
    }

    if (!Number.isFinite(relativeX)) {
      const fallbackOffsetX = Number(event?.offsetX);
      if (Number.isFinite(fallbackOffsetX)) {
        relativeX = Math.max(0, fallbackOffsetX);
      }
    }

    if (!Number.isFinite(relativeX)) {
      return null;
    }

    const localBoundary = clamp(Math.round(relativeX / safeAdvance), 0, lineSpan);
    return clamp(lineStart + localBoundary, 0, sequenceLength);
  }

  function syncAnnotateButtonState() {
    if (!annotateBtn) {
      return;
    }
    const record = getSelectedRecord();
    const hasRecord = Boolean(record?.sequence?.length);
    annotateBtn.disabled = state.isAnnotating || !hasRecord;
    if (saveBtn) {
      saveBtn.disabled = !hasRecord || !hasStoragePath();
    }
  }

  function syncOrfToggleState() {
    if (!orfToggle) {
      return;
    }
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    orfToggle.checked = Boolean(state.orfViewEnabled);
    orfToggle.disabled = !hasRecord;
  }

  function syncRestrictionVendorToggleState() {
    if (restrictionNebToggle) {
      restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (restrictionThermoToggle) {
      restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function updateRecordSelect() {
    if (!recordSelect) {
      return;
    }

    if (!state.records.length) {
      recordSelect.innerHTML = '<option value="">No records loaded</option>';
      recordSelect.disabled = true;
      return;
    }

    recordSelect.disabled = false;
    recordSelect.innerHTML = state.records
      .map((record, index) => {
        const selected = index === state.selectedRecordIndex ? ' selected' : '';
        const label = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
        return `<option value="${index}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderFeatureRail(record) {
    if (!featureRailHost) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const sequenceLength = Math.max(1, record?.sequence?.length || 1);

    if (!features.length) {
      featureRailHost.innerHTML = '<p class="small-note">No features to display.</p>';
      return;
    }

    const laidOut = assignFeatureLanes(features);
    const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
    const railHeight = Math.max(48, (laneCount * 18) + 18);

    const bars = laidOut
      .map((feature, index) => {
        const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
        const color = hashTypeToColor(colorKey);
        const locationText = buildFeatureLocationText(feature, sequenceLength);
        return (Array.isArray(feature.segments) ? feature.segments : [])
          .map((segment) => {
            const left = ((segment.start / sequenceLength) * 100).toFixed(3);
            const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100).toFixed(3);
            const top = (feature.lane * 18) + 8;
            const isActive = index === state.selectedFeatureIndex;
            const title = `${feature.name || '-'} (${locationText})`;
            return `
              <button
                class="sequence-viewer-feature-bar${isActive ? ' sequence-viewer-feature-bar-active' : ''}"
                type="button"
                data-feature-index="${index}"
                style="left:${left}%;width:${width}%;top:${top}px;background:${color};"
                title="${escapeHtml(title)}"
              ></button>
            `;
          })
          .join('');
      })
      .join('');

    featureRailHost.innerHTML = `
      <div class="sequence-viewer-feature-rail" style="height:${railHeight}px;">
        ${bars}
      </div>
      <div class="sequence-viewer-feature-axis">
        <span style="left:0%;">1</span>
        <span style="left:25%;">${Math.max(1, Math.round(sequenceLength * 0.25)).toLocaleString()}</span>
        <span style="left:50%;">${Math.max(1, Math.round(sequenceLength * 0.5)).toLocaleString()}</span>
        <span style="left:75%;">${Math.max(1, Math.round(sequenceLength * 0.75)).toLocaleString()}</span>
        <span style="left:100%;">${sequenceLength.toLocaleString()}</span>
      </div>
    `;
  }

  function renderSelectedFeatureDetail(record) {
    if (!featureDetail) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    if (!features.length || state.selectedFeatureIndex < 0) {
      featureDetail.innerHTML = '<p class="small-note">Select a feature in the bottom track to view details.</p>';
      return;
    }

    const selected = features[state.selectedFeatureIndex] || null;
    featureDetail.innerHTML = formatSelectedFeatureDetailHtml(selected, record.sequence.length);
  }

  function renderSequence(record, options = {}) {
    if (!sequenceHost) {
      return;
    }
    hideSequenceHoverTooltip();

    const preserveScroll = Boolean(options?.preserveScroll);
    const previousScrollTop = preserveScroll ? Math.max(0, Number(sequenceHost.scrollTop) || 0) : 0;

    if (!record) {
      sequenceHost.innerHTML = '<p class="small-note">Load sequence data to begin.</p>';
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const selectedFeature = (features.length && state.selectedFeatureIndex >= 0)
      ? features[state.selectedFeatureIndex] || null
      : null;
    const orfTranslationContext = state.orfViewEnabled
      ? buildSelectedOrfTranslationContext(record.sequence, selectedFeature)
      : null;

    const selectionHighlights = getSequenceSelectionSegments(record);
    const highlights = selectionHighlights.length
      ? selectionHighlights
      : normalizeHighlightSegments(selectedFeature?.segments || [], record.sequence.length);
    const {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    } = computeSequenceLayoutMetrics();
    state.sequenceLayout = {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    };
    sequenceHost.innerHTML = renderDualStrandSequenceLinesHtml(record.sequence, highlights, {
      lineLength,
      charAdvancePx,
      sequenceLineHeightPx: lineHeightPx,
      lineFeatureOffsetPx,
      features,
      selectedFeatureIndex: state.selectedFeatureIndex,
      cursorBaseIndex: state.sequenceCursorBase,
      orfTranslationContext
    });

    if (preserveScroll) {
      sequenceHost.scrollTop = previousScrollTop;
    } else if (highlights.length) {
      const first = highlights[0];
      const firstLine = Math.max(0, Math.floor(first.start / lineLength));
      sequenceHost.scrollTop = Math.max(0, (firstLine * DUAL_STRAND_SCROLL_STEP) - 42);
    } else {
      sequenceHost.scrollTop = 0;
    }
  }

  function renderStats(record) {
    if (!record) {
      if (statFormat) statFormat.textContent = '-';
      if (statLength) statLength.textContent = '0';
      if (statTopology) statTopology.textContent = '-';
      if (statGc) statGc.textContent = '-';
      if (statAmbiguous) statAmbiguous.textContent = '-';
      if (statQuality) statQuality.textContent = '-';
      if (statFeatures) statFeatures.textContent = '0';
      if (statRestrictionSites) statRestrictionSites.textContent = '0';
      return;
    }

    const gc = computeGcPercent(record.sequence);
    const ambiguous = countAmbiguousBases(record.sequence);
    const qualitySummary = summarizeFastqQuality(record.quality);
    const allFeatures = getVisibleFeaturesForRecord(record);
    const restrictionFeatures = allFeatures
      .filter((feature) => String(feature?.type || '').toLowerCase() === 'restriction_site');
    const totalFeatures = allFeatures.length;

    if (statFormat) {
      statFormat.textContent = String(record.sourceFormat || '-').toUpperCase();
    }
    if (statLength) {
      statLength.textContent = record.sequence.length.toLocaleString();
    }
    if (statTopology) {
      statTopology.textContent = normalizeTopology(record.topology);
    }
    if (statGc) {
      statGc.textContent = `${gc.toFixed(2)}%`;
    }
    if (statAmbiguous) {
      statAmbiguous.textContent = ambiguous.toLocaleString();
    }
    if (statFeatures) {
      statFeatures.textContent = totalFeatures.toLocaleString();
    }
    if (statRestrictionSites) {
      statRestrictionSites.textContent = restrictionFeatures.length.toLocaleString();
    }
    if (statQuality) {
      statQuality.textContent = qualitySummary
        ? `Q${qualitySummary.min.toFixed(1)} / ${qualitySummary.mean.toFixed(1)} / ${qualitySummary.max.toFixed(1)}`
        : 'n/a';
    }
  }

  function renderActiveRecord() {
    const record = getSelectedRecord();
    renderStats(record);
    renderSequence(record);
    renderFeatureRail(record);
    renderSelectedFeatureDetail(record);
    syncAnnotateButtonState();
    syncOrfToggleState();
    syncRestrictionVendorToggleState();
    updateMessages();
  }

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.annotationWarnings = [];
    state.isAnnotating = false;
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();

    updateRecordSelect();
    renderActiveRecord();
    if (saveNameInput && state.records.length) {
      saveNameInput.value = normalizeRecordName(state.records[0].name || 'sequence', 'sequence');
    }

    if (state.records.length) {
      setStatus(`${statusPrefix}: ${state.records.length} record(s).`);
    } else {
      setStatus(state.errors[0] || 'No records loaded.', true);
    }
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function loadCurrentInput() {
    const raw = state.mode === 'file'
      ? state.fileText
      : (inputTextarea?.value || '');

    if (!String(raw || '').trim()) {
      setRecords({ records: [], warnings: [], errors: ['Provide sequence input first.'] }, 'Idle');
      return;
    }

    const parsed = parseInputRecords(raw, { maxRecords: DEFAULT_MAX_RECORDS });
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setRecords(parsed, 'Loaded');
    setInputComposerVisible(!(Array.isArray(parsed.records) && parsed.records.length > 0));
  }

  async function persistRecordToLibrary(record, options = {}) {
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!storagePath) {
      throw new Error('Set Storage Folder Path in Settings before saving sequence entries.');
    }
    if (!bridge?.sequenceLibraryUpsert) {
      throw new Error('Sequence library storage API unavailable.');
    }
    const safeRecord = record && typeof record === 'object' ? record : null;
    if (!safeRecord?.sequence?.length) {
      throw new Error('No sequence record available to persist.');
    }

    const status = String(options?.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY).toLowerCase() === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const name = normalizeRecordName(
      options?.name || saveNameInput?.value || safeRecord.name || 'sequence',
      'sequence'
    );
    const gbkText = buildRecordGenbankText(safeRecord);
    if (!gbkText.trim()) {
      throw new Error('Failed to generate GenBank text for sequence entry.');
    }
    const htmlText = buildCircularPreviewHtmlDocument(safeRecord);
    const response = await bridge.sequenceLibraryUpsert({
      storagePath,
      id: cleanText(options?.id || state.activeEntryId, 200),
      name,
      status,
      sourceFormat: String(safeRecord.sourceFormat || ''),
      topology: normalizeTopology(safeRecord.topology || 'linear'),
      sequenceLength: safeRecord.sequence.length,
      featureCount: Array.isArray(safeRecord.features) ? safeRecord.features.length : 0,
      gbkText,
      htmlText
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to persist sequence entry.');
    }
    state.activeEntryId = cleanText(response.entry.id, 200);
    state.activeEntryStatus = String(response.entry.status || status).toLowerCase();
    if (saveNameInput) {
      saveNameInput.value = response.entry.name || name;
    }
    return response.entry;
  }

  async function persistAfterAnnotation(record) {
    const storagePath = getStoragePath();
    if (!storagePath) {
      state.annotationWarnings.push('pLannotate: Storage path not configured; annotation was not auto-saved.');
      return null;
    }
    const desiredStatus = state.activeEntryStatus === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const entry = await persistRecordToLibrary(record, {
      id: state.activeEntryId,
      status: desiredStatus,
      name: saveNameInput?.value || record.name || 'sequence'
    });
    await refreshLibraryEntries({ selectedId: entry.id, silent: true });
    return entry;
  }

  async function saveCurrentRecordAsSaved() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before saving.', true);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: LIBRARY_STATUS_SAVED,
        name: saveNameInput?.value || record.name || 'sequence'
      });
      state.activeEntryId = cleanText(entry.id, 200);
      state.activeEntryStatus = LIBRARY_STATUS_SAVED;
      await refreshLibraryEntries({ selectedId: entry.id, silent: true });
      setStatus(`Saved sequence as ${entry.name}.`);
      setHomeStatus(`Saved sequence entry: ${entry.name}.`);
    } catch (error) {
      setStatus(error?.message || 'Failed to save sequence.', true);
    }
  }

  async function openLibraryEntryInDetail(entryId) {
    const storagePath = getStoragePath();
    if (!storagePath) {
      setHomeStatus('Set Storage Folder Path in Settings before opening library entries.', true);
      return;
    }
    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }
    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: cleanText(entryId, 200),
        includeGbk: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load sequence entry.');
      }
      const parsed = parseInputRecords(String(response.gbkText || ''), { maxRecords: DEFAULT_MAX_RECORDS });
      if (!Array.isArray(parsed.records) || !parsed.records.length) {
        throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid records.');
      }

      state.activeEntryId = cleanText(response.entry.id, 200);
      state.activeEntryStatus = String(response.entry.status || '').toLowerCase();
      if (inputTextarea) {
        inputTextarea.value = String(response.gbkText || '');
      }
      if (saveNameInput) {
        saveNameInput.value = response.entry.name || parsed.records[0].name || 'sequence';
      }
      setMode('paste');
      setInputComposerVisible(false);
      setRecords(parsed, 'Loaded');
      navigateToDetail();
      setStatus(`Opened ${response.entry.name}.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open sequence entry.', true);
    }
  }

  function openParsedRecordsInDetail(parsed, rawText = '', statusPrefix = 'Loaded') {
    const hasRecords = Array.isArray(parsed?.records) && parsed.records.length > 0;
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (inputTextarea) {
      inputTextarea.value = rawText || '';
    }
    setMode('paste');
    setInputComposerVisible(!hasRecords);
    setRecords(parsed, statusPrefix);
    navigateToDetail();
  }

  async function annotateCurrentRecord() {
    if (state.isAnnotating) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before annotation.', true);
      return;
    }

    state.isAnnotating = true;
    state.annotationWarnings = [];
    syncAnnotateButtonState();
    updateMessages();
    setStatus(`Running pLannotate on ${record.name || 'record'}...`);

    try {
      const recordTopology = normalizeTopology(record.topology || 'linear');
      const result = await runPlannotateAnnotationForSequence(
        record.sequence,
        recordTopology,
        PLANNOTATE_DEFAULT_OPTIONS
      );
      const resultTopology = normalizeTopology(result?.topology || recordTopology);
      const plannotateFeatures = buildPlannotateFeaturesFromResult(result, record.sequence.length, resultTopology);

      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
      const nextRecords = [...state.records];
      const current = nextRecords[selectedIndex];
      if (!current) {
        throw new Error('Selected record no longer exists.');
      }

      const existingFeatures = Array.isArray(current.features) ? current.features : [];
      const retainedFeatures = existingFeatures.filter(
        (feature) => String(feature?.source || '').toLowerCase() !== 'plannotate'
      );

      current.features = [...retainedFeatures, ...plannotateFeatures];
      current.topology = resultTopology;

      state.records = nextRecords;
      state.selectedRecordIndex = selectedIndex;
      state.selectedFeatureIndex = -1;
      state.annotationWarnings = Array.isArray(result?.warnings)
        ? result.warnings.map((warning) => `pLannotate: ${String(warning)}`)
        : [];

      renderActiveRecord();
      try {
        await persistAfterAnnotation(current);
      } catch (persistError) {
        state.annotationWarnings.push(`pLannotate: ${String(persistError?.message || persistError)}`);
        updateMessages();
      }
      setStatus(`Completed: ${plannotateFeatures.length} pLannotate feature(s) on ${current.name || 'record'}.`);
    } catch (error) {
      setStatus(error?.message || 'Annotation failed.', true);
    } finally {
      state.isAnnotating = false;
      syncAnnotateButtonState();
    }
  }

  function clearAll() {
    if (inputTextarea) {
      inputTextarea.value = '';
    }
    if (fileInput) {
      fileInput.value = '';
    }
    if (fileNameLabel) {
      fileNameLabel.textContent = 'No file selected';
    }

    state.fileName = '';
    state.fileText = '';
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setMode('paste');
    setInputComposerVisible(true);
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    setStatus('Idle');
    if (saveNameInput) {
      saveNameInput.value = '';
    }
  }

  function setOrfViewEnabled(nextEnabled) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.orfViewEnabled = Boolean(nextEnabled);

    if (!state.orfViewEnabled && isOrfFeature(selectedFeature)) {
      state.selectedFeatureIndex = -1;
    } else if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  function setRestrictionVendorFilter(nextFilter) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.restrictionVendorFilter = normalizeRestrictionVendorFilter(nextFilter);

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  modePasteBtn?.addEventListener('click', () => {
    setMode('paste');
  });

  modeFileBtn?.addEventListener('click', () => {
    setMode('file');
  });

  fileChooseBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      setStatus('Loading file...');
      state.fileText = await readFileAsText(file);
      state.fileName = String(file.name || '');
      if (fileNameLabel) {
        fileNameLabel.textContent = state.fileName || 'No file selected';
      }
      setStatus(`Loaded file: ${state.fileName || 'input'}`);
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (fileNameLabel) {
        fileNameLabel.textContent = 'No file selected';
      }
      setStatus(error.message || 'Failed to load file.', true);
    }
  });

  homePasteBtn?.addEventListener('click', () => {
    clearAll();
    navigateToDetail();
    setMode('paste');
    setInputComposerVisible(true);
    setStatus('Paste sequence text, then click Load.');
    inputTextarea?.focus?.();
    setHomeStatus('Opened a new sequence detail page.');
  });

  if (homeOpenInput && typeof homeOpenInput.setAttribute === 'function') {
    homeOpenInput.setAttribute('accept', FILE_ACCEPT);
  }

  homeOpenBtn?.addEventListener('click', () => {
    homeOpenInput?.click();
  });

  homeOpenInput?.addEventListener('change', async () => {
    const file = homeOpenInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      setHomeStatus(`Reading ${file.name}...`);
      const text = await readFileAsText(file);
      const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
      openParsedRecordsInDetail(parsed, text, 'Loaded');
      setStatus(`Opened ${file.name} in detail workspace.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open selected file.', true);
    } finally {
      homeOpenInput.value = '';
    }
  });

  loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCurrentInput();
  });

  annotateBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void annotateCurrentRecord();
  });

  orfToggle?.addEventListener('change', () => {
    setOrfViewEnabled(Boolean(orfToggle.checked));
  });

  restrictionNebToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      neb: Boolean(restrictionNebToggle.checked)
    });
  });

  restrictionThermoToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      thermo: Boolean(restrictionThermoToggle.checked)
    });
  });

  clearBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    clearAll();
  });

  saveBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void saveCurrentRecordAsSaved();
  });

  backBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    navigateToHome();
    void refreshLibraryEntries({ silent: true });
  });

  libraryFilterSavedBtn?.addEventListener('click', () => {
    setLibraryFilter(LIBRARY_STATUS_SAVED);
    void refreshLibraryEntries({ silent: true });
  });

  libraryFilterTemporaryBtn?.addEventListener('click', () => {
    setLibraryFilter(LIBRARY_STATUS_TEMPORARY);
    void refreshLibraryEntries({ silent: true });
  });

  libraryList?.addEventListener('click', (event) => {
    const entryId = resolveLibraryEntryIdFromEvent(event);
    if (!entryId) {
      return;
    }
    if (Number.isFinite(Number(event?.detail)) && Number(event.detail) > 1) {
      return;
    }

    const now = Date.now();
    const previousEntryId = cleanText(state.lastLibraryClickEntryId, 200);
    const elapsedMs = now - (Number(state.lastLibraryClickAt) || 0);
    const isDoubleActivate = previousEntryId === entryId && elapsedMs >= 0 && elapsedMs <= 450;
    state.lastLibraryClickEntryId = entryId;
    state.lastLibraryClickAt = now;

    void setSelectedLibraryEntry(entryId);
    if (isDoubleActivate) {
      void openLibraryEntryInDetail(entryId);
    }
  });

  libraryList?.addEventListener('dblclick', (event) => {
    const entryId = resolveLibraryEntryIdFromEvent(event);
    if (!entryId) {
      return;
    }
    void setSelectedLibraryEntry(entryId);
    void openLibraryEntryInDetail(entryId);
  });

  recordSelect?.addEventListener('change', () => {
    state.selectedRecordIndex = clamp(Number(recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    renderActiveRecord();
    const selected = getSelectedRecord();
    if (selected && saveNameInput) {
      saveNameInput.value = normalizeRecordName(selected.name || 'sequence', 'sequence');
    }
  });

  featureRailHost?.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-feature-index]') || null;
    if (!trigger) {
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    clearSequenceSelection();
    renderActiveRecord();
  });

  sequenceHost?.addEventListener('mousedown', (event) => {
    const button = Number(event?.button);
    if (Number.isFinite(button) && button !== 0) {
      return;
    }
    const featureTrigger = event.target?.closest?.('[data-feature-index]') || null;
    if (featureTrigger) {
      return;
    }
    const record = getSelectedRecord();
    const boundary = resolveSequenceBoundaryFromEvent(event, record);
    if (!Number.isFinite(boundary)) {
      return;
    }
    event.preventDefault?.();
    state.isSelectingSequence = true;
    state.sequenceSelectionAnchor = boundary;
    state.sequenceSelectionFocus = boundary;
    state.sequenceCursorBase = boundary;
    renderSequence(record, { preserveScroll: true });
  });

  sequenceHost?.addEventListener('mousemove', (event) => {
    const record = getSelectedRecord();
    let rerenderNeeded = false;

    if (state.isSelectingSequence) {
      const boundary = resolveSequenceBoundaryFromEvent(event, record);
      if (Number.isFinite(boundary)) {
        if (state.sequenceSelectionFocus !== boundary) {
          state.sequenceSelectionFocus = boundary;
          rerenderNeeded = true;
        }
        if (state.sequenceCursorBase !== boundary) {
          state.sequenceCursorBase = boundary;
          rerenderNeeded = true;
        }
      }
      hideSequenceHoverTooltip();
      if (rerenderNeeded) {
        renderSequence(record, { preserveScroll: true });
      }
      return;
    }

    hideSequenceHoverTooltip();
    const boundary = resolveSequenceBoundaryFromEvent(event, record);
    if (Number.isFinite(boundary)) {
      if (state.sequenceCursorBase !== boundary) {
        state.sequenceCursorBase = boundary;
        rerenderNeeded = true;
      }
    } else if (Number.isFinite(state.sequenceCursorBase)) {
      state.sequenceCursorBase = null;
      rerenderNeeded = true;
    }

    if (rerenderNeeded) {
      renderSequence(record, { preserveScroll: true });
    }
  });

  sequenceHost?.addEventListener('mouseleave', () => {
    hideSequenceHoverTooltip();
    if (state.isSelectingSequence) {
      return;
    }
    if (Number.isFinite(state.sequenceCursorBase)) {
      state.sequenceCursorBase = null;
      renderSequence(getSelectedRecord(), { preserveScroll: true });
    }
  });

  sequenceHost?.addEventListener('scroll', () => {
    hideSequenceHoverTooltip();
  });

  sequenceHost?.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-feature-index]') || null;
    if (!trigger) {
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    clearSequenceSelection({ preserveCursor: true });
    renderActiveRecord();
  });

  globalThis.addEventListener?.('mouseup', () => {
    if (!state.isSelectingSequence) {
      return;
    }
    state.isSelectingSequence = false;
    renderSequence(getSelectedRecord(), { preserveScroll: true });
  });

  globalThis.addEventListener?.('resize', () => {
    renderSequence(getSelectedRecord(), { preserveScroll: true });
  });

  function loadFromExternal(payload) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);

    setMode('paste');
    if (inputTextarea) {
      inputTextarea.value = record.sequence;
    }
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (saveNameInput) {
      saveNameInput.value = record.name || 'sequence';
    }

    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');
    setInputComposerVisible(!hasSequence);

    if (hasSequence) {
      navigateToDetail();
      setStatus(`Imported ${record.name} from ${record.sourceFormat || 'external'}.`);
    }
  }

  function render() {
    updateRecordSelect();
    renderActiveRecord();
    syncHomeControlsState();
    void refreshLibraryEntries({ silent: true });
  }

  setLibraryFilter(LIBRARY_STATUS_SAVED);
  setLocalWorkspaceVisibility('home');
  setMode('paste');
  setInputComposerVisible(true);
  setStatus('Paste sequence text, then click Load.');
  setHomeStatus('Choose New or Open to continue.');
  render();

  return {
    render,
    loadFromExternal
  };
}

export {
  normalizeSequenceText,
  complementBase,
  complementSequence,
  buildCommercialRestrictionFeatures,
  buildOrfFeatures,
  buildSelectedOrfTranslationContext,
  detectSequenceFormat,
  parseFastaRecords,
  parseFastqRecords,
  parseGenBankRecords,
  parseInputRecords,
  normalizeExternalPayload,
  parseGenBankLocationSegments,
  renderDualStrandSequenceLinesHtml,
  computeRestrictionAnnotationGeometry,
  buildRestrictionCutPolylinePoints,
  formatSelectedFeatureDetailHtml,
  computeGcPercent,
  countAmbiguousBases,
  summarizeFastqQuality
};
