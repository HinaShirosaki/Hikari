export const BASE_COMPLEMENT = Object.freeze({
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

export function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

export function complementBase(base) {
  return BASE_COMPLEMENT[String(base || '').toUpperCase()] || 'N';
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

export function normalizeTopology(value) {
  return String(value || '').toLowerCase() === 'circular' ? 'circular' : 'linear';
}
