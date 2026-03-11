import { nucleotideCounts } from './sequence.js';

const DNA_BASE_MW = { A: 313.21, T: 304.2, G: 329.21, C: 289.18 };
const RNA_BASE_MW = { A: 329.21, U: 306.17, G: 345.21, C: 305.18 };

const DNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, T: 8700 };
const RNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, U: 9900 };

export function oligoMolecularWeight(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_BASE_MW : DNA_BASE_MW;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

export function oligoExtinction(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_EXTINCTION : DNA_EXTINCTION;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

export function oligoTm(sequence, type = 'DNA') {
  const counts = nucleotideCounts(sequence);
  const a = counts.A || 0;
  const g = counts.G || 0;
  const c = counts.C || 0;
  const tOrU = type === 'RNA' ? (counts.U || 0) : (counts.T || 0);
  const n = sequence.length;
  const gc = g + c;

  if (!n) {
    return 0;
  }

  if (n < 14) {
    return (2 * (a + tOrU)) + (4 * (g + c));
  }

  return 64.9 + (41 * (gc - 16.4)) / n;
}
