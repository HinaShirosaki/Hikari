// Protein -> DNA with the mRNA folding checked afterwards.
//
// `reverseTranslateProteinSequence` already picks codons by usage (and dodges restriction
// sites), which is the right primary criterion. What it cannot see is that the transcript
// folds: stable local structure, especially over the start codon, is the classic reason a
// codon-optimal gene still expresses badly (Kudla et al. 2009). So: reverse translate by
// usage, fold the transcript in windows, and buy structure relief with synonymous swaps
// wherever a window is too stable — paying for each swap in codon preference.
import { foldOligo } from './fold.js';
import {
  getCodonOptionsForResidue,
  nucleotideCounts,
  reverseTranslateProteinSequence
} from './sequence.js';

const DEFAULT_WINDOW_NT = 40; // ~ the -4..+37 window around the start codon in Kudla 2009
const DEFAULT_STRUCTURE_THRESHOLD = -4; // kcal/mol; weaker windows are left alone
const DEFAULT_USAGE_WEIGHT = 1; // kcal/mol charged per natural-log unit of lost preference

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Reverse translate a protein, then relieve mRNA secondary structure with synonymous swaps.
 *
 * Takes everything `reverseTranslateProteinSequence` takes (organism, appendStopCodon,
 * restrictionSites, beamWidth) plus:
 * @param {number} [options.windowNt=40] folding window; folding cost grows steeply with it
 * @param {number} [options.structureThreshold=-4] only windows at or below this get worked on
 * @param {number} [options.usageWeight=1] higher keeps codon usage, lower buys more relief
 * @returns the reverse-translation result with `structureOptimization` added
 */
export function reverseTranslateForExpression(proteinInput, options = {}) {
  const seed = reverseTranslateProteinSequence(proteinInput, options);
  if (!seed.ok) {
    return seed;
  }

  const windowNt = clamp(Math.round(Number(options.windowNt) || DEFAULT_WINDOW_NT), 12, 120);
  const threshold = Number.isFinite(options.structureThreshold)
    ? options.structureThreshold
    : DEFAULT_STRUCTURE_THRESHOLD;
  const usageWeight = Number.isFinite(options.usageWeight) ? options.usageWeight : DEFAULT_USAGE_WEIGHT;
  const sites = seed.expandedRestrictionSites || [];
  const longestSite = sites.reduce((longest, site) => Math.max(longest, site.length), 0);
  const step = Math.max(3, Math.round(windowNt / 2));

  const protein = seed.protein;
  const codons = [...seed.codons];
  let dna = seed.dna;

  const optionCache = new Map();
  const choicesFor = (residue) => {
    if (!optionCache.has(residue)) {
      optionCache.set(residue, getCodonOptionsForResidue(residue, seed.organism));
    }
    return optionCache.get(residue);
  };
  const preference = (residue, codon) => {
    const choice = choicesFor(residue).find((entry) => entry.codon === codon);
    return choice ? Math.log(choice.weight / choice.maxWeight) : 0;
  };

  // The transcript is what folds, so the window is read as RNA.
  const foldWindow = (sequence, start) => foldOligo(sequence.slice(start, start + windowNt), { type: 'RNA' }).deltaG;
  const score = (deltaG, residue, codon) => deltaG + usageWeight * preference(residue, codon);
  const scan = (sequence) => {
    const windows = [];
    for (let start = 0; start === 0 || start + step <= sequence.length; start += step) {
      windows.push({ start, deltaG: foldWindow(sequence, start) });
    }
    return windows;
  };
  const penalty = (windows) => windows.reduce((total, window) => total + Math.min(0, window.deltaG), 0);
  const createsSite = (candidate, codonIndex) => sites.length > 0 && sites.some((site) => candidate
    .slice(Math.max(0, codonIndex * 3 - longestSite + 1), codonIndex * 3 + 3 + longestSite - 1)
    .includes(site));

  // This immutable seed scan is both the reported baseline and the global
  // accept/reject reference. Per-window greedy scores below may use mutated DNA.
  const before = scan(seed.dna);
  const swaps = [];

  // ponytail: greedy, one left-to-right pass, scoring each swap on its own window only.
  // Structure is global and codon choices interact, so this finds a better sequence, not
  // the best one. A second pass or a beam over windows is the upgrade if that matters.
  for (let start = 0; start === 0 || start + step <= dna.length; start += step) {
    let current = foldWindow(dna, start);
    // The 5' window is always worked on: structure over the start codon costs the most.
    if (start > 0 && current >= threshold) {
      continue;
    }

    const firstCodon = Math.ceil(start / 3);
    const lastCodon = Math.floor(Math.min(dna.length, start + windowNt) / 3) - 1;
    for (let index = firstCodon; index <= lastCodon; index += 1) {
      const residue = protein[index];
      const choices = choicesFor(residue);
      if (choices.length < 2) {
        continue;
      }

      const held = codons[index];
      let bestCodon = held;
      let bestDeltaG = current;
      let bestScore = score(current, residue, held);
      choices.forEach(({ codon }) => {
        if (codon === held) {
          return;
        }
        const candidate = `${dna.slice(0, index * 3)}${codon}${dna.slice(index * 3 + 3)}`;
        if (createsSite(candidate, index)) {
          return;
        }
        const deltaG = foldWindow(candidate, start);
        const value = score(deltaG, residue, codon);
        // Relief has to be real: the seed is already preference-optimal, so a swap may
        // only ever spend preference to weaken structure, never the other way round.
        if (deltaG > current + 1e-9 && value > bestScore + 1e-9) {
          bestCodon = codon;
          bestDeltaG = deltaG;
          bestScore = value;
        }
      });

      if (bestCodon !== held) {
        dna = `${dna.slice(0, index * 3)}${bestCodon}${dna.slice(index * 3 + 3)}`;
        codons[index] = bestCodon;
        swaps.push({
          codonIndex: index,
          residue,
          from: held,
          to: bestCodon,
          windowStart: start,
          deltaGBefore: current,
          deltaGAfter: bestDeltaG
        });
        current = bestDeltaG;
      }
    }
  }

  // Windows overlap, so a late swap can undo an early gain. Keep the result only if the
  // transcript came out less structured overall than the usage-only sequence.
  const after = swaps.length ? scan(dna) : before;
  const improved = swaps.length > 0 && penalty(after) > penalty(before) + 1e-9;
  const finalDna = improved ? dna : seed.dna;
  const finalCodons = improved ? codons : seed.codons;
  const finalWindows = improved ? after : before;

  const counts = nucleotideCounts(finalDna);
  const preferenceTotals = finalCodons.reduce((totals, codon, index) => {
    const choice = choicesFor(protein[index]).find((entry) => entry.codon === codon);
    return {
      weight: totals.weight + (choice ? choice.weight : 0),
      max: totals.max + (choice ? choice.maxWeight : 0)
    };
  }, { weight: 0, max: 0 });

  return {
    ...seed,
    dna: finalDna,
    codons: finalCodons,
    gcContent: finalDna.length ? (((counts.G || 0) + (counts.C || 0)) / finalDna.length) * 100 : 0,
    preferenceScorePercent: preferenceTotals.max ? (preferenceTotals.weight / preferenceTotals.max) * 100 : 100,
    structureOptimization: {
      windowNt,
      structureThreshold: threshold,
      usageWeight,
      applied: improved,
      swaps: improved ? swaps : [],
      windows: finalWindows,
      fivePrimeDeltaGBefore: before[0]?.deltaG ?? 0,
      fivePrimeDeltaGAfter: finalWindows[0]?.deltaG ?? 0,
      worstDeltaGBefore: Math.min(0, ...before.map((window) => window.deltaG)),
      worstDeltaGAfter: Math.min(0, ...finalWindows.map((window) => window.deltaG))
    }
  };
}
