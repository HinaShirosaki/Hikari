import { DEFAULT_MAX_RECORDS } from './constants.js';
import {
  clamp,
  detectSequenceFormat,
  normalizeRecordName,
  normalizeSequenceText,
  normalizeTopology
} from './shared.js';
import { postProcessAb1Trace } from './algorithms/ab1-trace-postprocess.js';

function readAsciiString(bytes) {
  let result = '';
  const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  for (let index = 0; index < safeBytes.length; index += 1) {
    const code = safeBytes[index];
    if (code === 0) {
      continue;
    }
    result += String.fromCharCode(code);
  }
  return result;
}

function readUint32Be(view, offset) {
  return view.getUint32(offset, false);
}

function readUint16Be(view, offset) {
  return view.getUint16(offset, false);
}

function parseAbifDirectoryEntry(view, offset) {
  return {
    name: String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    ),
    number: readUint32Be(view, offset + 4),
    elementType: readUint16Be(view, offset + 8),
    elementSize: readUint16Be(view, offset + 10),
    elementCount: readUint32Be(view, offset + 12),
    dataSize: readUint32Be(view, offset + 16),
    dataOffset: readUint32Be(view, offset + 20),
    entryOffset: offset
  };
}

function getAbifEntryData(buffer, view, entry) {
  const safeEntry = entry && typeof entry === 'object' ? entry : null;
  if (!safeEntry) {
    return new Uint8Array(0);
  }

  const dataSize = Math.max(0, Number(safeEntry.dataSize) || 0);
  if (!dataSize) {
    return new Uint8Array(0);
  }

  if (dataSize <= 4) {
    return new Uint8Array(buffer.slice(safeEntry.entryOffset + 20, safeEntry.entryOffset + 20 + dataSize));
  }

  const start = Math.max(0, Number(safeEntry.dataOffset) || 0);
  const end = start + dataSize;
  if (end > buffer.byteLength) {
    throw new Error(`AB1 entry ${safeEntry.name}${safeEntry.number} points outside the file.`);
  }
  return new Uint8Array(buffer.slice(start, end));
}

function buildAbifDirectoryMap(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 34) {
    throw new Error('AB1 file is truncated.');
  }
  if (String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  ) !== 'ABIF') {
    throw new Error('Selected file is not a valid AB1/ABIF trace.');
  }

  const root = parseAbifDirectoryEntry(view, 6);
  const directoryCount = Math.max(0, Number(root.elementCount) || 0);
  const directoryOffset = Math.max(0, Number(root.dataOffset) || 0);
  const directoryMap = new Map();

  for (let index = 0; index < directoryCount; index += 1) {
    const entryOffset = directoryOffset + (index * 28);
    if (entryOffset + 28 > buffer.byteLength) {
      throw new Error('AB1 directory table is truncated.');
    }
    const entry = parseAbifDirectoryEntry(view, entryOffset);
    directoryMap.set(`${entry.name}${entry.number}`, entry);
  }

  return {
    view,
    directoryMap
  };
}

function getAbifEntryByPreference(directoryMap, ...keys) {
  for (const key of keys) {
    if (directoryMap.has(key)) {
      return directoryMap.get(key);
    }
  }
  return null;
}

function readNumericSeriesFromEntry(buffer, view, entry, options = {}) {
  const bytes = getAbifEntryData(buffer, view, entry);
  const elementSize = Math.max(1, Number(entry?.elementSize) || 1);
  const elementCount = Math.max(0, Number(entry?.elementCount) || 0);
  const availableCount = Math.floor(bytes.byteLength / elementSize);
  const count = elementCount > 0 ? Math.min(elementCount, availableCount) : availableCount;
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signed = options?.signed === true;
  const values = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * elementSize;
    let value = 0;
    if (elementSize === 1) {
      value = signed ? dataView.getInt8(offset) : dataView.getUint8(offset);
    } else if (elementSize === 2) {
      value = signed ? dataView.getInt16(offset, false) : dataView.getUint16(offset, false);
    } else if (elementSize === 4) {
      value = signed ? dataView.getInt32(offset, false) : dataView.getUint32(offset, false);
    } else {
      for (let byteIndex = 0; byteIndex < elementSize; byteIndex += 1) {
        value = (value * 256) + dataView.getUint8(offset + byteIndex);
      }
    }
    values.push(value);
  }

  return values;
}

function normalizeAb1BaseOrder(rawValue) {
  const cleaned = String(rawValue || '')
    .toUpperCase()
    .replace(/[^ACGT]/g, '')
    .slice(0, 4);
  if (cleaned.length !== 4) {
    return ['G', 'A', 'T', 'C'];
  }
  const unique = new Set(cleaned.split(''));
  if (unique.size !== 4) {
    return ['G', 'A', 'T', 'C'];
  }
  return cleaned.split('');
}

function buildAb1TracePayload(buffer, view, directoryMap, sequenceLength, warnings) {
  const baseOrderEntry = getAbifEntryByPreference(directoryMap, 'FWO_1', 'FWO_2');
  const baseOrder = normalizeAb1BaseOrder(
    baseOrderEntry ? readAsciiString(getAbifEntryData(buffer, view, baseOrderEntry)) : ''
  );
  const canonicalBases = ['A', 'C', 'G', 'T'];
  const preferredTraceEntries = [9, 10, 11, 12].map((index) => directoryMap.get(`DATA${index}`) || null);
  const fallbackTraceEntries = [1, 2, 3, 4].map((index) => directoryMap.get(`DATA${index}`) || null);
  const selectedTraceEntries = preferredTraceEntries.every(Boolean)
    ? preferredTraceEntries
    : (fallbackTraceEntries.every(Boolean) ? fallbackTraceEntries : []);

  if (!selectedTraceEntries.length) {
    return null;
  }

  const rawChannelsByBase = new Map();
  selectedTraceEntries.forEach((entry, index) => {
    const base = baseOrder[index] || canonicalBases[index] || '';
    if (!base) {
      return;
    }
    const values = readNumericSeriesFromEntry(buffer, view, entry)
      .map((value) => Math.max(0, Math.round(Number(value) || 0)));
    rawChannelsByBase.set(base, values);
  });

  const positionsEntry = getAbifEntryByPreference(directoryMap, 'PLOC2', 'PLOC1');
  let positions = positionsEntry
    ? readNumericSeriesFromEntry(buffer, view, positionsEntry).map((value) => Math.max(0, Math.round(Number(value) || 0)))
    : [];

  if (positions.length && sequenceLength && positions.length > sequenceLength) {
    warnings.push('AB1 base-call positions were longer than the sequence and were truncated.');
    positions = positions.slice(0, sequenceLength);
  }

  const channels = canonicalBases
    .map((base) => ({
      base,
      values: rawChannelsByBase.get(base) || []
    }))
    .filter((channel) => channel.values.length > 0);

  if (!channels.length) {
    return null;
  }

  return {
    baseOrder,
    positions,
    channels
  };
}

function sanitizeAb1QualityBytes(bytes, sequenceLength, warnings) {
  const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  if (!safeBytes.length || !sequenceLength) {
    return '';
  }

  if (safeBytes.length < sequenceLength) {
    warnings.push('AB1 quality values were shorter than the base-call sequence and were discarded.');
    return '';
  }
  if (safeBytes.length > sequenceLength) {
    warnings.push('AB1 quality values were longer than the base-call sequence and were truncated.');
  }

  return [...safeBytes.slice(0, sequenceLength)]
    .map((value) => {
      const phred = clamp(Math.round(Number(value) || 0), 0, 93);
      return String.fromCharCode(phred + 33);
    })
    .join('');
}

function coerceArrayBuffer(value) {
  if (!value) {
    return null;
  }
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

export function parseAb1Record(rawInput, options = {}) {
  const warnings = [];
  const errors = [];

  try {
    const buffer = coerceArrayBuffer(rawInput);
    if (!buffer) {
      throw new Error('AB1 parsing requires an ArrayBuffer input.');
    }

    const { view, directoryMap } = buildAbifDirectoryMap(buffer);
    const baseEntry = getAbifEntryByPreference(directoryMap, 'PBAS2', 'PBAS1');
    if (!baseEntry) {
      throw new Error('AB1 file did not contain callable base tags (PBAS2/PBAS1).');
    }

    const qualityEntry = getAbifEntryByPreference(directoryMap, 'PCON2', 'PCON1');
    const baseBytes = getAbifEntryData(buffer, view, baseEntry);
    const sequence = normalizeSequenceText(readAsciiString(baseBytes));
    if (!sequence.length) {
      throw new Error('AB1 file did not contain any callable base sequence.');
    }

    let quality = '';
    if (qualityEntry) {
      const qualityBytes = getAbifEntryData(buffer, view, qualityEntry);
      quality = sanitizeAb1QualityBytes(qualityBytes, sequence.length, warnings);
    } else {
      warnings.push('AB1 quality values were not present (PCON2/PCON1 missing).');
    }
    const trace = buildAb1TracePayload(buffer, view, directoryMap, sequence.length, warnings);

    const fallbackName = String(options?.name || options?.fileName || 'sequencing_trace')
      .replace(/\.[^.]+$/u, '')
      .trim();

    let processedTrace = trace;
    if (trace && options?.postProcess !== false) {
      try {
        const processed = postProcessAb1Trace({ ...trace, sequence }, quality, options?.postProcessOptions || {});
        if (processed) {
          processedTrace = { ...trace, processed };
        }
      } catch (postProcessError) {
        warnings.push(`AB1 post-processing skipped: ${postProcessError?.message || 'unknown error'}.`);
      }
    }

    return {
      format: 'ab1',
      records: [{
        id: 'ab1_1',
        name: normalizeRecordName(fallbackName || 'sequencing_trace', 'sequencing_trace'),
        description: '',
        sourceFormat: 'ab1',
        topology: 'linear',
        sequence,
        quality,
        trace: processedTrace,
        features: []
      }],
      warnings,
      errors
    };
  } catch (error) {
    errors.push(error?.message || 'Failed to parse AB1 trace.');
    return {
      format: 'ab1',
      records: [],
      warnings,
      errors
    };
  }
}

export function parseFastaRecords(rawInput, options = {}) {
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

export function parseFastqRecords(rawInput, options = {}) {
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

export function parseGenBankLocationSegments(rawExpression, sequenceLength, strand = 1) {
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

function normalizeProteinTranslation(rawValue) {
  return String(rawValue || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z*]/g, '');
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
      const translation = normalizeProteinTranslation(entry.qualifiers.translation || '');

      return {
        id: `gbk_feature_${index + 1}`,
        name,
        type: String(entry.type || 'misc_feature').toLowerCase(),
        strand,
        description,
        ...(translation ? { translation } : {}),
        source: 'genbank',
        locationText: entry.location,
        segments
      };
    })
    .filter(Boolean);
}

export function parseGenBankRecords(rawInput) {
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
