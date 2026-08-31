// Minimum-free-energy folding for single-stranded DNA and RNA oligos: the Zuker
// recursions over a nearest-neighbour energy model, which is what mfold/UNAFold and
// RNAfold implement. Returns the dot-bracket structure and its dG, so primer and
// probe screens can say "this oligo folds back on itself at -4.2 kcal/mol" instead of
// counting complementary runs.
//
// Parameters: NNDB Turner 2004 (RNA stacks incl. GU wobbles, loop initiation) and
// SantaLucia (DNA stacks, reused from oligo.js) with the NNDB DNA loop table.
// https://rna.urmc.rochester.edu/NNDB/
import { DNA_NEAREST_NEIGHBOR } from './oligo.js';

const GAS_CONSTANT = 0.0019872; // kcal/(mol·K)
const REFERENCE_KELVIN = 310.15; // 37 °C, where every tabulated dG° was measured
const MAX_LOOP = 30; // longest internal/bulge loop the tables cover
const MIN_HAIRPIN = 3; // shortest loop that can close a hairpin
const EPSILON = 1e-9;

// ponytail: linear multibranch model (close + per-branch + per-unpaired). Oligos this
// short rarely form multiloops; swap in the efn2 model only if that stops being true.
const MULTILOOP_CLOSING = 3.4;
const MULTILOOP_BRANCH = 0.4;
const MULTILOOP_UNPAIRED = 0.0;

// Ninio asymmetry term for internal loops.
const ASYMMETRY_PER_BASE = 0.6;
const ASYMMETRY_MAX = 3.0;

// [dG37, dH] for a helix end that is not G:C — SantaLucia's terminal-AT term for DNA,
// Turner's terminal-AU/GU penalty for RNA.
const TERMINAL_PENALTY = { DNA: [0.06, 2.2], RNA: [0.45, 3.72] };

const PAIRABLE = {
  DNA: new Set(['AT', 'TA', 'GC', 'CG']),
  RNA: new Set(['AU', 'UA', 'GC', 'CG', 'GU', 'UG'])
};

// Turner 2004 stacks as outer pair -> inner pair -> [dG37, dH], reading
//   5' outer[0] inner[0] 3'
//   3' outer[1] inner[1] 5'
const RNA_STACK = Object.freeze({
  AU: { AU: [-0.9, -6.8], CG: [-2.2, -11.4], GC: [-2.1, -10.5], GU: [-0.6, -3.2], UA: [-1.1, -9.4], UG: [-1.4, -8.8] },
  CG: { AU: [-2.1, -10.4], CG: [-3.3, -13.4], GC: [-2.4, -10.6], GU: [-1.4, -5.6], UA: [-2.1, -10.5], UG: [-2.1, -12.1] },
  GC: { AU: [-2.4, -12.4], CG: [-3.4, -14.9], GC: [-3.3, -13.4], GU: [-1.5, -8.3], UA: [-2.2, -11.4], UG: [-2.5, -12.6] },
  GU: { AU: [-1.3, -12.8], CG: [-2.5, -12.6], GC: [-2.1, -12.1], GU: [-0.5, -13.5], UA: [-1.4, -8.8], UG: [1.3, -14.6] },
  UA: { AU: [-1.3, -7.7], CG: [-2.4, -12.4], GC: [-2.1, -10.4], GU: [-1.0, -7.0], UA: [-0.9, -6.8], UG: [-1.3, -12.8] },
  UG: { AU: [-1.0, -7.0], CG: [-1.5, -8.3], GC: [-1.4, -5.6], GU: [0.3, -9.3], UA: [-0.6, -3.2], UG: [-0.5, -13.5] }
});

// SantaLucia's dinucleotide table is already in the repo as [dH, dS]; only Watson-Crick
// stacks exist there, which is also all the DNA recursion pairs.
const DNA_STACK = Object.freeze(Object.fromEntries(
  Object.entries(DNA_NEAREST_NEIGHBOR).map(([step, [enthalpy, entropy]]) => [
    step,
    [enthalpy - (REFERENCE_KELVIN * entropy) / 1000, enthalpy]
  ])
));

// Loop initiation dG37 by number of unpaired nucleotides (NNDB length-dependent tables).
const LOOP_INITIATION = Object.freeze({
  DNA: {
    hairpin: { from: 3, values: [3.4, 3.4, 3.5, 4.2, 4.2, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.0, 6.1, 6.2, 6.3, 6.4, 6.5] },
    bulge: { from: 1, values: [2.9, 2.3, 2.5, 2.7, 3.0, 3.2, 3.4, 3.5, 3.6, 3.7, 3.9, 3.9, 4.0, 4.1, 4.2, 4.3, 4.3, 4.4, 4.4, 4.5, 4.5, 4.6, 4.6, 4.7, 4.7, 4.7, 4.8, 4.9, 4.9, 4.9] },
    internal: { from: 4, values: [3.1, 3.5, 3.9, 4.1, 4.2, 4.3, 4.5, 4.6, 4.6, 4.7, 4.8, 4.9, 5.0, 5.0, 5.1, 5.1, 5.2, 5.3, 5.3, 5.3, 5.4, 5.4, 5.5, 5.5, 5.6, 5.6, 5.6] }
  },
  RNA: {
    hairpin: { from: 3, values: [5.4, 5.6, 5.7, 5.4, 6.0, 5.5, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.9, 7.0, 7.1, 7.1, 7.2, 7.2, 7.3, 7.3, 7.4, 7.4, 7.5, 7.5, 7.5, 7.6, 7.6, 7.7] },
    bulge: { from: 1, values: [3.8, 2.8, 3.2, 3.6, 4.0, 4.4, 4.6, 4.7, 4.8, 4.9, 5.0, 5.1, 5.2, 5.3, 5.4, 5.4, 5.5, 5.5, 5.6, 5.7, 5.7, 5.8, 5.8, 5.8, 5.9, 5.9, 6.0, 6.0, 6.0, 6.1] },
    internal: { from: 4, values: [1.1, 2.0, 2.0, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.9, 3.0, 3.1, 3.1, 3.2, 3.3, 3.3, 3.4, 3.4, 3.5, 3.5, 3.5, 3.6, 3.6, 3.7, 3.7] }
  }
});

// dG(T) from a tabulated [dG37, dH] pair, assuming dH and dS are temperature independent.
function freeEnergyAt(entry, kelvin) {
  const [deltaG37, deltaH] = entry;
  return deltaH - (kelvin * (deltaH - deltaG37)) / REFERENCE_KELVIN;
}

// ponytail: loop initiation is held at its 37 °C value — the tables carry no enthalpy, so
// only stacks respond to `temperatureCelsius`. Fetch the NNDB dH loop tables if loop
// temperature dependence ever matters.
function loopInitiation(table, size) {
  const largest = table.from + table.values.length - 1;
  const index = Math.min(Math.max(size - table.from, 0), table.values.length - 1);
  const value = table.values[index];
  if (size <= largest) {
    return value;
  }
  // Jacobson-Stockmayer extrapolation for loops past the end of the table.
  return value + 1.75 * GAS_CONSTANT * REFERENCE_KELVIN * Math.log(size / largest);
}

function normalize(sequence, type) {
  const alphabet = type === 'RNA' ? 'ACGU' : 'ACGT';
  const swap = type === 'RNA' ? { T: 'U' } : { U: 'T' };
  return [...String(sequence || '').toUpperCase().replace(/\s+/g, '')]
    .map((base) => swap[base] || base)
    .map((base) => (alphabet.includes(base) ? base : 'N'))
    .join('');
}

/**
 * Fold an oligo and return its MFE secondary structure.
 *
 * @param {string} sequence raw sequence; whitespace ignored, unknown letters stay unpaired
 * @param {object} [options]
 * @param {'DNA'|'RNA'} [options.type] defaults to RNA when the sequence has U but no T
 * @param {number} [options.temperatureCelsius=37]
 * @param {number} [options.sodiumMolar=1] monovalent salt; 1 M matches the published tables
 * @param {number} [options.maxLength=300] guard against folding a whole plasmid (O(n^3))
 * @returns {{sequence: string, type: string, temperatureCelsius: number, deltaG: number,
 *   structure: string, pairs: Array<[number, number]>}} deltaG is 0 for an unfolded oligo
 */
export function foldOligo(sequence, options = {}) {
  const raw = String(sequence || '');
  const type = options.type === 'RNA' || options.type === 'DNA'
    ? options.type
    : (/U/i.test(raw) && !/T/i.test(raw) ? 'RNA' : 'DNA');
  const seq = normalize(raw, type);
  const temperatureCelsius = Number.isFinite(options.temperatureCelsius) ? options.temperatureCelsius : 37;
  const kelvin = temperatureCelsius + 273.15;
  const sodiumMolar = Number.isFinite(options.sodiumMolar) && options.sodiumMolar > 0 ? options.sodiumMolar : 1;
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 300;
  const n = seq.length;
  const unfolded = { sequence: seq, type, temperatureCelsius, deltaG: 0, structure: '.'.repeat(n), pairs: [] };

  if (n > maxLength) {
    throw new RangeError(`foldOligo: ${n} nt exceeds maxLength ${maxLength}; folding is O(n^3)`);
  }
  if (n < MIN_HAIRPIN + 2) {
    return unfolded;
  }

  const tables = LOOP_INITIATION[type];
  const terminal = freeEnergyAt(TERMINAL_PENALTY[type], kelvin);
  // SantaLucia's entropic salt correction, applied per stacked base pair.
  const saltPerStack = (-kelvin * 0.368 * Math.log(sodiumMolar)) / 1000;

  const canPair = (i, j) => j - i > MIN_HAIRPIN && PAIRABLE[type].has(seq[i] + seq[j]);
  const terminalDg = (i, j) => (seq[i] + seq[j] === 'GC' || seq[i] + seq[j] === 'CG' ? 0 : terminal);

  // Stack of pair (k, l) on pair (i, j); for a single-nucleotide bulge the helix keeps
  // stacking, so (k, l) is not required to be (i + 1, j - 1).
  function stackDg(i, j, k, l) {
    const entry = type === 'RNA'
      ? RNA_STACK[seq[i] + seq[j]]?.[seq[k] + seq[l]]
      : DNA_STACK[seq[i] + seq[k]];
    return entry ? freeEnergyAt(entry, kelvin) + saltPerStack : Infinity;
  }

  const hairpinDg = (i, j) => loopInitiation(tables.hairpin, j - i - 1);

  // ponytail: no terminal-mismatch, dangling-end, special-tetraloop or 1x1/2x2 tables —
  // the length-dependent initiation values are averages that already absorb a typical
  // mismatch. Costs ~1 kcal/mol of accuracy on individual loops; add the NNDB mismatch
  // tables if the numbers need to match UNAFold digit for digit.
  function internalDg(i, j, k, l) {
    const left = k - i - 1;
    const right = j - l - 1;
    const size = left + right;
    if (left === 0 || right === 0) {
      const initiation = loopInitiation(tables.bulge, size);
      return size === 1
        ? initiation + stackDg(i, j, k, l)
        : initiation + terminalDg(i, j) + terminalDg(l, k);
    }
    return loopInitiation(tables.internal, size)
      + Math.min(ASYMMETRY_MAX, ASYMMETRY_PER_BASE * Math.abs(left - right))
      + terminalDg(i, j) + terminalDg(l, k);
  }

  // V[i][j]: best energy of i..j given i pairs j. WM[i][j]: best energy of i..j as part of
  // a multiloop, with at least one branch in it.
  const V = new Float64Array(n * n).fill(Infinity);
  const WM = new Float64Array(n * n).fill(Infinity);

  for (let span = 1; span < n; span += 1) {
    for (let i = 0; i + span < n; i += 1) {
      const j = i + span;
      if (canPair(i, j)) {
        let best = hairpinDg(i, j);
        if (canPair(i + 1, j - 1)) {
          best = Math.min(best, stackDg(i, j, i + 1, j - 1) + V[(i + 1) * n + j - 1]);
        }
        for (let k = i + 1; k <= j - MIN_HAIRPIN - 2; k += 1) {
          if (k - i - 1 > MAX_LOOP) {
            break;
          }
          for (let l = j - 1; l > k + MIN_HAIRPIN; l -= 1) {
            if ((k - i - 1) + (j - l - 1) > MAX_LOOP) {
              break;
            }
            if ((k === i + 1 && l === j - 1) || V[k * n + l] === Infinity) {
              continue;
            }
            best = Math.min(best, internalDg(i, j, k, l) + V[k * n + l]);
          }
        }
        const closing = MULTILOOP_CLOSING + MULTILOOP_BRANCH + terminalDg(i, j);
        for (let h = i + 1; h <= j - 2; h += 1) {
          best = Math.min(best, closing + WM[(i + 1) * n + h] + WM[(h + 1) * n + j - 1]);
        }
        V[i * n + j] = best;
      }

      let multi = V[i * n + j] + MULTILOOP_BRANCH + terminalDg(i, j);
      multi = Math.min(multi, WM[(i + 1) * n + j] + MULTILOOP_UNPAIRED);
      multi = Math.min(multi, WM[i * n + j - 1] + MULTILOOP_UNPAIRED);
      for (let h = i; h < j; h += 1) {
        multi = Math.min(multi, WM[i * n + h] + WM[(h + 1) * n + j]);
      }
      WM[i * n + j] = multi;
    }
  }

  // Exterior loop: W[k] is the best energy of the first k bases.
  const W = new Float64Array(n + 1);
  for (let j = 0; j < n; j += 1) {
    let best = W[j];
    for (let i = 0; i + MIN_HAIRPIN < j; i += 1) {
      if (V[i * n + j] !== Infinity) {
        best = Math.min(best, W[i] + V[i * n + j] + terminalDg(i, j));
      }
    }
    W[j + 1] = best;
  }
  if (W[n] >= -EPSILON) {
    return unfolded;
  }

  // Traceback: re-derive which case won each cell.
  const pairs = [];
  const matches = (a, b) => Math.abs(a - b) < EPSILON;

  function traceV(i, j) {
    pairs.push([i, j]);
    const target = V[i * n + j];
    if (matches(target, hairpinDg(i, j))) {
      return;
    }
    if (canPair(i + 1, j - 1) && matches(target, stackDg(i, j, i + 1, j - 1) + V[(i + 1) * n + j - 1])) {
      traceV(i + 1, j - 1);
      return;
    }
    for (let k = i + 1; k <= j - MIN_HAIRPIN - 2 && k - i - 1 <= MAX_LOOP; k += 1) {
      for (let l = j - 1; l > k + MIN_HAIRPIN && (k - i - 1) + (j - l - 1) <= MAX_LOOP; l -= 1) {
        if ((k === i + 1 && l === j - 1) || V[k * n + l] === Infinity) {
          continue;
        }
        if (matches(target, internalDg(i, j, k, l) + V[k * n + l])) {
          traceV(k, l);
          return;
        }
      }
    }
    const closing = MULTILOOP_CLOSING + MULTILOOP_BRANCH + terminalDg(i, j);
    for (let h = i + 1; h <= j - 2; h += 1) {
      if (matches(target, closing + WM[(i + 1) * n + h] + WM[(h + 1) * n + j - 1])) {
        traceWM(i + 1, h);
        traceWM(h + 1, j - 1);
        return;
      }
    }
  }

  function traceWM(i, j) {
    if (i >= j || WM[i * n + j] === Infinity) {
      return;
    }
    const target = WM[i * n + j];
    if (matches(target, V[i * n + j] + MULTILOOP_BRANCH + terminalDg(i, j))) {
      traceV(i, j);
      return;
    }
    if (matches(target, WM[(i + 1) * n + j] + MULTILOOP_UNPAIRED)) {
      traceWM(i + 1, j);
      return;
    }
    if (matches(target, WM[i * n + j - 1] + MULTILOOP_UNPAIRED)) {
      traceWM(i, j - 1);
      return;
    }
    for (let h = i; h < j; h += 1) {
      if (matches(target, WM[i * n + h] + WM[(h + 1) * n + j])) {
        traceWM(i, h);
        traceWM(h + 1, j);
        return;
      }
    }
  }

  for (let j = n - 1; j > 0;) {
    if (matches(W[j + 1], W[j])) {
      j -= 1;
      continue;
    }
    let found = -1;
    for (let i = 0; i + MIN_HAIRPIN < j; i += 1) {
      if (V[i * n + j] !== Infinity && matches(W[j + 1], W[i] + V[i * n + j] + terminalDg(i, j))) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      break;
    }
    traceV(found, j);
    j = found - 1;
  }

  const structure = [...'.'.repeat(n)];
  pairs.forEach(([i, j]) => {
    structure[i] = '(';
    structure[j] = ')';
  });
  pairs.sort((left, right) => left[0] - right[0]);

  return {
    sequence: seq,
    type,
    temperatureCelsius,
    deltaG: W[n],
    structure: structure.join(''),
    pairs
  };
}
