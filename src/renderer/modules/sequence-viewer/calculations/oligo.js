import { nucleotideCounts } from './sequence.js';

const DNA_BASE_MW = { A: 313.21, T: 304.2, G: 329.21, C: 289.18 };
const RNA_BASE_MW = { A: 329.21, U: 306.17, G: 345.21, C: 305.18 };

const DNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, T: 8700 };
const RNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, U: 9900 };

export const DNA_NEAREST_NEIGHBOR = Object.freeze({
  AA: [-7.9, -22.2], TT: [-7.9, -22.2],
  AT: [-7.2, -20.4], TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0],
  GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4],
  GG: [-8.0, -19.9], CC: [-8.0, -19.9]
});

function reverseComplementDnaLocal(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence].reverse().map((base) => complement[base] || '').join('');
}

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

// SantaLucia DNA/DNA nearest-neighbour estimate for cloning primers. The default
// salt term represents a typical high-fidelity PCR buffer rather than pretending
// that Tm depends on GC and length alone. Callers can override the assumptions
// when a polymerase data sheet provides reaction-specific concentrations.
export function cloningPrimerTm(sequence, options = {}) {
  const cleaned = String(sequence || '').toUpperCase().replace(/[^ACGT]/g, '');
  if (!cleaned.length) {
    return 0;
  }
  if (cleaned.length < 8 || cleaned.length !== String(sequence || '').replace(/\s+/g, '').length) {
    return oligoTm(cleaned, 'DNA');
  }

  const primerConcentrationMolar = Math.max(1e-12, Number(options?.primerConcentrationMolar) || 5e-7);
  const sodiumEquivalentMolar = Math.max(1e-6, Number(options?.sodiumEquivalentMolar) || 0.08);
  let enthalpyKcal = 0.2;
  let entropyCal = -5.7;
  for (let index = 0; index < cleaned.length - 1; index += 1) {
    const pair = DNA_NEAREST_NEIGHBOR[cleaned.slice(index, index + 2)];
    if (!pair) {
      return oligoTm(cleaned, 'DNA');
    }
    enthalpyKcal += pair[0];
    entropyCal += pair[1];
  }
  [cleaned[0], cleaned[cleaned.length - 1]].forEach((terminalBase) => {
    if (terminalBase === 'A' || terminalBase === 'T') {
      enthalpyKcal += 2.2;
      entropyCal += 6.9;
    }
  });
  const selfComplementary = cleaned === reverseComplementDnaLocal(cleaned);
  if (selfComplementary) {
    entropyCal -= 1.4;
  }
  const gasConstant = 1.987;
  const concentrationDivisor = selfComplementary ? 1 : 4;
  const kelvin = (1000 * enthalpyKcal) / (
    entropyCal + gasConstant * Math.log(primerConcentrationMolar / concentrationDivisor)
  );
  return kelvin - 273.15 + (16.6 * Math.log10(sodiumEquivalentMolar));
}
