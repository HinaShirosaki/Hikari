import { cleanNucleotideSequence } from '../calculations/sequence.js';
import { asArray } from '../../../lib/normalize.js';

const CONCRETE_DNA_BASES = new Set(['A', 'C', 'G', 'T']);
const IUPAC_DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/;

function normalizedLetterSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z]/g, '');
}

export function normalizeSequence(raw) {
  return cleanNucleotideSequence(raw, 'DNA');
}

// Primer coordinates and junctions must never be calculated after silently
// deleting an ambiguous base. Keep the permissive normalizer for established
// callers, but make every cloning entry point validate its raw inputs first.
export function describeAmbiguousDna(raw, label = 'DNA sequence') {
  const bases = [...new Set([...normalizedLetterSequence(raw)].filter((base) => !CONCRETE_DNA_BASES.has(base)))];
  return bases.length
    ? `${label} contains unresolved base${bases.length === 1 ? '' : 's'} (${bases.join(', ')}). Resolve every position to A, C, G, or T before primer design; ambiguous bases are not deleted or guessed.`
    : '';
}

export function normalizeIupacSequence(raw) {
  const normalized = normalizedLetterSequence(raw);
  return normalized && IUPAC_DNA_PATTERN.test(normalized) ? normalized : '';
}

export function normalizeTopology(value) {
  return String(value || '').toLowerCase() === 'linear' ? 'linear' : 'circular';
}

export function normalizeOrientation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'reverse' || normalized === 'reverse-complement' || normalized === 'reverse_complement') {
    return 'reverse';
  }
  return 'forward';
}

export function computeGcContent(sequence) {
  const cleaned = normalizeSequence(sequence);
  if (!cleaned.length) {
    return 0;
  }
  const gc = [...cleaned].reduce((sum, base) => sum + ((base === 'G' || base === 'C') ? 1 : 0), 0);
  return (gc / cleaned.length) * 100;
}

export function clampIndex(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

export function mean(values) {
  const numbers = asArray(values).filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return 0;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function createMidpoint(range) {
  return (Number(range?.min) + Number(range?.max)) / 2;
}

export function commonPrefixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (matched < safeMax && safeLeft[matched] === safeRight[matched]) {
    matched += 1;
  }
  return matched;
}

export function commonSuffixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (
    matched < safeMax
    && safeLeft[safeLeft.length - 1 - matched] === safeRight[safeRight.length - 1 - matched]
  ) {
    matched += 1;
  }
  return matched;
}

export function circularSlice(sequence, start, length) {
  const cleaned = normalizeSequence(sequence);
  const totalLength = cleaned.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!totalLength || !desiredLength) {
    return '';
  }

  let cursor = ((Math.round(Number(start) || 0) % totalLength) + totalLength) % totalLength;
  let remaining = desiredLength;
  let result = '';

  while (remaining > 0) {
    const chunkLength = Math.min(remaining, totalLength - cursor);
    result += cleaned.slice(cursor, cursor + chunkLength);
    remaining -= chunkLength;
    cursor = 0;
  }

  return result;
}

export function buildStableFragmentId(prefix, index) {
  return `${prefix}_${index + 1}`;
}

export { asArray };
