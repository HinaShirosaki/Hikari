import { DEFAULT_MAX_RECORDS } from '../constants.js';
import { normalizeRecordName, normalizeSequenceText } from '../shared.js';


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

export {
  parseFastaRecords,
  parseFastqRecords
};
