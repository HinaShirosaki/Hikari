import { BASE_COMPLEMENT } from './constants.js';

export function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

export function complementBase(base) {
  const normalized = String(base || '').toUpperCase();
  return BASE_COMPLEMENT[normalized] || 'N';
}

export function complementSequence(sequence) {
  return [...normalizeSequenceText(sequence)].map((base) => complementBase(base)).join('');
}

export function reverseComplementIupac(sequence) {
  const raw = String(sequence || '').toUpperCase().replace(/U/g, 'T');
  return [...raw].reverse().map((base) => complementBase(base)).join('');
}

export function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

export function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function parseCssPixels(value) {
  const numeric = Number.parseFloat(String(value || ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeRecordName(value, fallback = 'record') {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || fallback;
}

export function detectSequenceFormat(rawText) {
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

export function computeGcPercent(sequence) {
  const cleaned = normalizeSequenceText(sequence);
  if (!cleaned.length) {
    return 0;
  }
  const gc = [...cleaned].reduce((sum, base) => sum + (base === 'G' || base === 'C' ? 1 : 0), 0);
  return (gc / cleaned.length) * 100;
}

export function countAmbiguousBases(sequence) {
  const cleaned = normalizeSequenceText(sequence);
  if (!cleaned.length) {
    return 0;
  }
  return [...cleaned].reduce((sum, base) => sum + ((base === 'A' || base === 'C' || base === 'G' || base === 'T') ? 0 : 1), 0);
}

export function normalizeTopology(value) {
  return String(value || '').toLowerCase() === 'circular' ? 'circular' : 'linear';
}
