import { normalizeFeatureType } from '../feature-types.js';
import { PRIMER_FEATURE_SOURCE } from '../primer-annotation.js';
import { clamp, normalizeRecordName, normalizeSequenceText } from '../shared.js';

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

// GenBank locations are 1-based inclusive; segments here are 0-based,
// end-exclusive. start > end means the feature wraps the origin of a circular
// sequence, so it becomes two segments (start..end-of-sequence, 0..end).
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

// "123", "10..200", "<10..>200", "102^103", or "ACC:10..20" (the accession
// prefix is ignored). Fuzzy-end markers are dropped: only the numbers are used.
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

// Recursive location grammar: complement(...) flips the strand, join/order
// concatenate their parts, anything else is a simple range.
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

// The LOCUS name: GenBank allows 16 characters and no spaces.
function sanitizeGenbankToken(value, fallback = 'sequence', maxLength = 16) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, maxLength);
  return cleaned || fallback;
}

// Labels, notes and the definition are the file's own text: undo the line
// wrapping, never cut it (normalizeRecordName caps record names at 120).
function unwrapText(value, fallback = '') {
  return String(value || '').trim().replace(/\s+/g, ' ') || fallback;
}

// A literal " inside a qualifier value is written "", so the value ends on an
// odd run of trailing quotes, never on the second quote of an escape.
function closesQualifierValue(text) {
  return (text.length - text.replace(/"+$/, '').length) % 2 === 1;
}

function unescapeQualifierText(text) {
  return text.replace(/""/g, '"');
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
  const value = token.slice(equalIndex + 1).trim();

  if (!value.startsWith('"')) {
    return { key, value: value.endsWith('"') ? value.slice(0, -1) : value, openQuote: false };
  }
  const quotedText = value.slice(1);
  const closed = closesQualifierValue(quotedText);
  return {
    key,
    value: unescapeQualifierText(closed ? quotedText.slice(0, -1) : quotedText),
    openQuote: !closed
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
      const previous = current.qualifiers[parsed.key];
      current.qualifiers[parsed.key] = previous === undefined ? parsed.value : [...(Array.isArray(previous) ? previous : [previous]), parsed.value];
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
      const closed = closesQualifierValue(continuation);
      const text = unescapeQualifierText(closed ? continuation.slice(0, -1) : continuation);
      const previous = current.qualifiers[current.pendingQualifierKey];
      if (Array.isArray(previous)) previous[previous.length - 1] = [previous.at(-1), text].filter(Boolean).join(' ');
      else current.qualifiers[current.pendingQualifierKey] = [previous, text].filter(Boolean).join(' ');
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
      const name = unwrapText(
        entry.qualifiers.label
          || entry.qualifiers.gene
          || entry.qualifiers.locus_tag
          || entry.qualifiers.product
          || entry.type,
        `feature_${index + 1}`
      );

      const description = unwrapText(
        entry.qualifiers.note
          || entry.qualifiers.product
          || entry.qualifiers.function
      );
      const translation = normalizeProteinTranslation(entry.qualifiers.translation || '');
      // A primer_bind written by this app carries the oligo it was designed as,
      // which is not always what the template says at that position. Only
      // primer design writes that qualifier, so it also marks the feature as
      // ours: the next design run replaces it instead of stacking a duplicate.
      const primerSequence = String(entry.qualifiers.primer_sequence || '')
        .toUpperCase()
        .replace(/[^A-Z]/g, '');

      return {
        id: `gbk_feature_${index + 1}`,
        name,
        type: normalizeFeatureType(entry.type || 'misc_feature'),
        strand,
        description,
        ...(translation ? { translation } : {}),
        ...(primerSequence ? { primerSequence } : {}),
        source: primerSequence ? PRIMER_FEATURE_SOURCE : 'genbank',
        locationText: entry.location,
        qualifiers: { ...entry.qualifiers },
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

    // Hikari writes the record name as DEFINITION when there is no description,
    // and LOCUS is that same name shortened; anything else is a real description.
    const definition = unwrapText(block.match(/^DEFINITION[ \t]+(.*(?:\r?\n {12}.*)*)/m)?.[1]);
    const description = definition === '.' || sanitizeGenbankToken(definition, '') === locusMatch?.[1] ? '' : definition;

    records.push({
      id: `genbank_${records.length + 1}`,
      name,
      description,
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

export {
  parseGenBankLocationSegments,
  parseGenBankRecords,
  sanitizeGenbankToken
};
