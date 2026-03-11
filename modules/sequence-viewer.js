import { escapeHtml } from './tool-box/common.js';

const DEFAULT_MAX_RECORDS = 5000;
const SEQUENCE_LINE_LENGTH = 70;

function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
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

function renderSequenceLinesHtml(sequence, highlightedSegments = []) {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    return '<p class="small-note">No sequence loaded.</p>';
  }

  const sortedHighlights = highlightedSegments
    .map((segment) => ({
      start: Math.max(0, Number(segment.start) || 0),
      end: Math.max(0, Number(segment.end) || 0)
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const lines = [];

  for (let lineStart = 0; lineStart < text.length; lineStart += SEQUENCE_LINE_LENGTH) {
    const lineEnd = Math.min(text.length, lineStart + SEQUENCE_LINE_LENGTH);
    const lineText = text.slice(lineStart, lineEnd);
    const lineHighlights = sortedHighlights
      .map((segment) => ({
        start: Math.max(lineStart, segment.start),
        end: Math.min(lineEnd, segment.end)
      }))
      .filter((segment) => segment.end > segment.start)
      .sort((a, b) => a.start - b.start);

    let body = '';
    if (!lineHighlights.length) {
      body = escapeHtml(lineText);
    } else {
      let cursor = lineStart;
      lineHighlights.forEach((segment) => {
        if (segment.start > cursor) {
          body += escapeHtml(text.slice(cursor, segment.start));
        }
        body += `<span class="sequence-viewer-seq-highlight">${escapeHtml(text.slice(segment.start, segment.end))}</span>`;
        cursor = segment.end;
      });
      if (cursor < lineEnd) {
        body += escapeHtml(text.slice(cursor, lineEnd));
      }
    }

    lines.push(`
      <div class="sequence-viewer-seq-line">
        <span class="sequence-viewer-seq-coord">${(lineStart + 1).toLocaleString()}</span>
        <span class="sequence-viewer-seq-text">${body}</span>
      </div>
    `);
  }

  return lines.join('');
}

export function initSequenceViewer() {
  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  const pastePanel = document.getElementById('sequence-viewer-paste-panel');
  const filePanel = document.getElementById('sequence-viewer-file-panel');
  const inputTextarea = document.getElementById('sequence-viewer-textarea');
  const fileInput = document.getElementById('sequence-viewer-file-input');
  const fileChooseBtn = document.getElementById('sequence-viewer-file-choose');
  const fileNameLabel = document.getElementById('sequence-viewer-file-name');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
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

  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureTableBody = document.getElementById('sequence-viewer-feature-table-body');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');

  const state = {
    mode: 'paste',
    fileName: '',
    fileText: '',
    records: [],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    warnings: [],
    errors: []
  };

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
      pastePanel.hidden = resolved !== 'paste';
    }
    if (filePanel) {
      filePanel.hidden = resolved !== 'file';
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
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];

    messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
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

    const features = Array.isArray(record?.features) ? record.features : [];
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
        const color = hashTypeToColor(feature.type);
        return (Array.isArray(feature.segments) ? feature.segments : [])
          .map((segment) => {
            const left = ((segment.start / sequenceLength) * 100).toFixed(3);
            const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100).toFixed(3);
            const top = (feature.lane * 18) + 8;
            const isActive = index === state.selectedFeatureIndex;
            return `
              <button
                class="sequence-viewer-feature-bar${isActive ? ' sequence-viewer-feature-bar-active' : ''}"
                type="button"
                data-feature-index="${index}"
                style="left:${left}%;width:${width}%;top:${top}px;background:${color};"
                title="${escapeHtml(feature.name)}"
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

  function renderFeatureTable(record) {
    if (!featureTableBody) {
      return;
    }

    const features = Array.isArray(record?.features) ? record.features : [];
    if (!features.length) {
      featureTableBody.innerHTML = '<tr><td colspan="8" class="small-note">No features available.</td></tr>';
      return;
    }

    featureTableBody.innerHTML = features
      .map((feature, index) => {
        const activeClass = index === state.selectedFeatureIndex ? ' class="sequence-viewer-row-active"' : '';
        const strand = feature.strand === -1 ? '-' : '+';
        const identity = Number.isFinite(feature.identity) ? `${feature.identity.toFixed(2)}%` : 'n/a';
        const coverage = Number.isFinite(feature.coverage) ? `${feature.coverage.toFixed(2)}%` : 'n/a';
        return `
          <tr data-feature-index="${index}"${activeClass}>
            <td>${index + 1}</td>
            <td>${escapeHtml(feature.name)}</td>
            <td>${escapeHtml(feature.type || '-')}</td>
            <td>${escapeHtml(buildFeatureLocationText(feature, record.sequence.length))}</td>
            <td>${strand}</td>
            <td>${identity}</td>
            <td>${coverage}</td>
            <td>${escapeHtml(feature.mode || feature.source || '-')}</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderSequence(record) {
    if (!sequenceHost) {
      return;
    }

    if (!record) {
      sequenceHost.innerHTML = '<p class="small-note">Load sequence data to begin.</p>';
      return;
    }

    const selectedFeature = (Array.isArray(record.features) && state.selectedFeatureIndex >= 0)
      ? record.features[state.selectedFeatureIndex] || null
      : null;

    const highlights = selectedFeature?.segments || [];
    sequenceHost.innerHTML = renderSequenceLinesHtml(record.sequence, highlights);

    if (highlights.length) {
      const first = highlights[0];
      const firstLine = Math.max(0, Math.floor(first.start / SEQUENCE_LINE_LENGTH));
      sequenceHost.scrollTop = Math.max(0, (firstLine * 24) - 42);
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
      return;
    }

    const gc = computeGcPercent(record.sequence);
    const ambiguous = countAmbiguousBases(record.sequence);
    const qualitySummary = summarizeFastqQuality(record.quality);

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
      statFeatures.textContent = String(Array.isArray(record.features) ? record.features.length : 0);
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
    renderFeatureRail(record);
    renderFeatureTable(record);
    renderSequence(record);
    updateMessages();
  }

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;

    updateRecordSelect();
    renderActiveRecord();

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
    setRecords(parsed, 'Loaded');
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
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    setStatus('Idle');
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

  loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCurrentInput();
  });

  clearBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    clearAll();
  });

  recordSelect?.addEventListener('change', () => {
    state.selectedRecordIndex = clamp(Number(recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
    state.selectedFeatureIndex = -1;
    renderActiveRecord();
  });

  featureRailHost?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-feature-index]');
    if (!trigger) {
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    renderActiveRecord();
  });

  featureTableBody?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-feature-index]');
    if (!row) {
      return;
    }
    const index = Number(row.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    renderActiveRecord();
  });

  function loadFromExternal(payload) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);

    setMode('paste');
    if (inputTextarea) {
      inputTextarea.value = record.sequence;
    }

    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');

    if (hasSequence) {
      setStatus(`Imported ${record.name} from ${record.sourceFormat || 'external'}.`);
    }
  }

  function render() {
    updateRecordSelect();
    renderActiveRecord();
  }

  setMode('paste');
  setStatus('Idle');
  render();

  return {
    render,
    loadFromExternal
  };
}

export {
  normalizeSequenceText,
  detectSequenceFormat,
  parseFastaRecords,
  parseFastqRecords,
  parseGenBankRecords,
  parseInputRecords,
  normalizeExternalPayload,
  parseGenBankLocationSegments,
  computeGcPercent,
  countAmbiguousBases,
  summarizeFastqQuality
};
