import {
  getFeatureTypeGenbankKey,
  normalizeFeatureType
} from './feature-types.js';
import {
  clamp,
  normalizeRecordName,
  normalizeSequenceText,
  normalizeTopology
} from './shared.js';

export function readStoragePathFromLocalState() {
  try {
    const raw = globalThis?.localStorage?.getItem?.('hikari_state_v1');
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
  const knownKey = getFeatureTypeGenbankKey(type);
  if (knownKey) {
    return knownKey;
  }

  const cleaned = String(type || 'misc_feature')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  return normalizeFeatureType(cleaned || 'misc_feature');
}

function sanitizeGenbankQualifierValue(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '\'');
}

function sanitizeGenbankProteinQualifierValue(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z*]/g, '');
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

// The GenBank lines for a single feature. Split out so an annotation can be
// spliced into a file that already exists without rewriting the rest of it.
export function buildGenbankFeatureLines(feature, sequenceLength) {
  const location = buildGenbankFeatureLocation(feature, sequenceLength);
  if (!location) {
    return [];
  }
  const type = sanitizeGenbankFeatureType(feature?.type).slice(0, 16);
  const featurePrefix = `     ${type.padEnd(16, ' ')}`;
  const qualifierPrefix = '                     ';
  const lines = [...wrapGenbankLine(location, featurePrefix, qualifierPrefix)];

  [
    ['label', feature?.name || type],
    ['note', feature?.description || ''],
    // Without this the oligo is lost on the way to disk, and reopening the file
    // would rebuild it from the template -- which on the plasmid a mutagenic
    // primer was designed against gives back the wild-type bases, not the
    // primer that was ordered.
    ['primer_sequence', sanitizeGenbankQualifierValue(feature?.primerSequence || '')],
    ['translation', sanitizeGenbankProteinQualifierValue(feature?.translation || '')]
  ].forEach(([key, rawValue]) => {
    const value = sanitizeGenbankQualifierValue(rawValue);
    if (!value) {
      return;
    }
    lines.push(...wrapGenbankLine(`/${key}="${value}"`, qualifierPrefix, qualifierPrefix));
  });
  return lines;
}

export function buildRecordGenbankText(record) {
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
    lines.push(...buildGenbankFeatureLines(feature, sequence.length));
  });

  lines.push(...formatGenbankOriginLines(sequence));
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

