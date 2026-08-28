import { AMINO_ACID_TO_CODONS, CODON_TABLE, REVERSE_TRANSLATE_DEFAULT_BEAM_WIDTH, REVERSE_TRANSLATE_DEFAULT_ORGANISM, REVERSE_TRANSLATE_MAX_BEAM_WIDTH, REVERSE_TRANSLATE_MIN_SITE_LENGTH } from './sequence-tables/codon-table.js';
import { CODON_USAGE_PROFILES } from './sequence-tables/codon-usage.js';

export function cleanNucleotideSequence(raw, type = 'DNA') {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  const targetType = type === 'RNA' ? 'RNA' : 'DNA';
  if (targetType === 'RNA') {
    return normalized.replace(/T/g, 'U').replace(/[^ACGU]/g, '');
  }
  return normalized.replace(/U/g, 'T').replace(/[^ACGT]/g, '');
}

export function nucleotideCounts(sequence) {
  const counts = {};
  for (const base of sequence) {
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

export function reverseComplementDna(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence]
    .reverse()
    .map((base) => complement[base] || 'N')
    .join('');
}

export function translateDnaCodon(codon) {
  const normalized = cleanNucleotideSequence(codon, 'DNA')
    .replace(/U/g, 'T')
    .slice(0, 3);
  if (normalized.length !== 3) {
    return '';
  }
  return CODON_TABLE[normalized] || 'X';
}

export function translateDnaSequence(sequence, frame = 1, stopMode = 'star') {
  const numericFrame = Number(frame);
  const isNegativeStrand = numericFrame < 0;
  const absFrame = Math.max(1, Math.min(3, Math.abs(numericFrame) || 1));
  const startIndex = absFrame - 1;
  const template = isNegativeStrand ? reverseComplementDna(sequence) : sequence;
  const coding = template.slice(startIndex);
  let protein = '';
  let codons = 0;

  for (let i = 0; i + 2 < coding.length; i += 3) {
    const codon = coding.slice(i, i + 3);
    const aa = translateDnaCodon(codon) || 'X';
    codons += 1;
    if (aa === '*' && stopMode === 'trim') {
      break;
    }
    protein += aa;
  }

  return {
    protein,
    codons,
    frame: absFrame,
    strand: isNegativeStrand ? '-' : '+',
    remainderBases: coding.length % 3
  };
}

export function cleanProteinSequence(raw, allowStop = true) {
  const disallowed = allowStop ? /[^A-Z*]/g : /[^A-Z]/g;
  return String(raw || '')
    .toUpperCase()
    .replace(disallowed, '');
}

export function parseRestrictionSites(raw) {
  const tokens = String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const sites = new Set();
  const ignoredTokens = [];

  tokens.forEach((token) => {
    if (!/^[ACGT]+$/.test(token) || token.length < REVERSE_TRANSLATE_MIN_SITE_LENGTH) {
      ignoredTokens.push(token);
      return;
    }
    sites.add(token);
  });

  const normalizedSites = [...sites];
  const expandedSites = new Set(normalizedSites);
  normalizedSites.forEach((site) => {
    expandedSites.add(reverseComplementDna(site));
  });

  return {
    sites: normalizedSites,
    expandedSites: [...expandedSites],
    ignoredTokens
  };
}

export function resolveCodonProfile(profileKey = REVERSE_TRANSLATE_DEFAULT_ORGANISM) {
  return CODON_USAGE_PROFILES[profileKey] || CODON_USAGE_PROFILES[REVERSE_TRANSLATE_DEFAULT_ORGANISM];
}

export function getCodonOptionsForResidue(residue, profileKey = REVERSE_TRANSLATE_DEFAULT_ORGANISM) {
  const codons = AMINO_ACID_TO_CODONS[residue];
  if (!codons || !codons.length) {
    return [];
  }

  const profile = resolveCodonProfile(profileKey);
  const preferenceOrder = profile.preferences?.[residue] || [];
  const rankByCodon = new Map(preferenceOrder.map((codon, index) => [codon, index]));
  const ordered = [...codons].sort((a, b) => {
    const aRank = rankByCodon.has(a) ? rankByCodon.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = rankByCodon.has(b) ? rankByCodon.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.localeCompare(b);
  });

  const maxWeight = ordered.length;
  return ordered.map((codon, index) => ({
    codon,
    weight: maxWeight - index,
    maxWeight
  }));
}

function introducesRestrictionSite(previousSequence, candidateSequence, expandedSites) {
  if (!expandedSites.length) {
    return false;
  }

  return expandedSites.some((site) => {
    const searchFrom = Math.max(0, previousSequence.length - site.length + 1);
    return candidateSequence.indexOf(site, searchFrom) !== -1;
  });
}

export function reverseTranslateProteinSequence(proteinInput, options = {}) {
  const profileKey = CODON_USAGE_PROFILES[options.organism]
    ? options.organism
    : REVERSE_TRANSLATE_DEFAULT_ORGANISM;
  const profile = resolveCodonProfile(profileKey);
  const appendStopCodon = Boolean(options.appendStopCodon);
  const cleanedProtein = cleanProteinSequence(proteinInput, true);
  const protein = appendStopCodon && cleanedProtein && !cleanedProtein.endsWith('*')
    ? `${cleanedProtein}*`
    : cleanedProtein;
  const restrictionInput = Array.isArray(options.restrictionSites)
    ? options.restrictionSites.join(' ')
    : String(options.restrictionSites || '');
  const parsedSites = parseRestrictionSites(restrictionInput);
  const maxRestrictionLength = parsedSites.expandedSites.reduce(
    (maxLength, site) => Math.max(maxLength, site.length),
    0
  );
  const suffixLength = Math.max(1, maxRestrictionLength - 1);
  const requestedBeamWidth = Number(options.beamWidth);
  const beamWidth = Math.min(
    REVERSE_TRANSLATE_MAX_BEAM_WIDTH,
    Math.max(
      8,
      Number.isFinite(requestedBeamWidth)
        ? Math.round(requestedBeamWidth)
        : REVERSE_TRANSLATE_DEFAULT_BEAM_WIDTH
    )
  );

  if (!protein.length) {
    return {
      ok: false,
      reason: 'empty_protein',
      message: 'Enter a protein sequence to reverse translate.',
      organism: profileKey,
      organismLabel: profile.label,
      protein: '',
      dna: '',
      codons: [],
      restrictionSites: parsedSites.sites,
      expandedRestrictionSites: parsedSites.expandedSites
    };
  }

  const unsupportedResidues = [...new Set([...protein].filter((residue) => !AMINO_ACID_TO_CODONS[residue]))];
  if (unsupportedResidues.length) {
    return {
      ok: false,
      reason: 'unsupported_residue',
      message: `Unsupported residues: ${unsupportedResidues.join(', ')}`,
      unsupportedResidues,
      organism: profileKey,
      organismLabel: profile.label,
      protein,
      dna: '',
      codons: [],
      restrictionSites: parsedSites.sites,
      expandedRestrictionSites: parsedSites.expandedSites
    };
  }

  let states = [{
    dna: '',
    codons: [],
    score: 0,
    preferenceWeight: 0,
    preferenceMax: 0
  }];

  for (let i = 0; i < protein.length; i += 1) {
    const residue = protein[i];
    const optionsForResidue = getCodonOptionsForResidue(residue, profileKey);
    const nextStates = [];

    states.forEach((state) => {
      optionsForResidue.forEach((codonOption) => {
        const dna = `${state.dna}${codonOption.codon}`;
        if (introducesRestrictionSite(state.dna, dna, parsedSites.expandedSites)) {
          return;
        }

        nextStates.push({
          dna,
          codons: [...state.codons, codonOption.codon],
          score: state.score + Math.log(codonOption.weight),
          preferenceWeight: state.preferenceWeight + codonOption.weight,
          preferenceMax: state.preferenceMax + codonOption.maxWeight
        });
      });
    });

    if (!nextStates.length) {
      const bestPartial = states
        .slice()
        .sort((a, b) => b.score - a.score)[0] || {
        dna: '',
        codons: [],
        preferenceWeight: 0,
        preferenceMax: 0
      };
      return {
        ok: false,
        reason: 'restriction_conflict',
        message: `No codon path avoids restricted motifs at residue ${i + 1} (${residue}).`,
        blockedPosition: i + 1,
        blockedResidue: residue,
        translatedResidues: i,
        organism: profileKey,
        organismLabel: profile.label,
        protein,
        dna: bestPartial.dna,
        codons: bestPartial.codons,
        restrictionSites: parsedSites.sites,
        expandedRestrictionSites: parsedSites.expandedSites
      };
    }

    nextStates.sort((a, b) => b.score - a.score);
    if (!parsedSites.expandedSites.length) {
      states = nextStates.slice(0, beamWidth);
      continue;
    }

    const bestBySuffix = new Map();
    nextStates.forEach((state) => {
      const key = state.dna.slice(-suffixLength);
      const existing = bestBySuffix.get(key);
      if (!existing || state.score > existing.score) {
        bestBySuffix.set(key, state);
      }
    });

    states = [...bestBySuffix.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, beamWidth);
  }

  const best = states
    .slice()
    .sort((a, b) => b.score - a.score)[0];
  const counts = nucleotideCounts(best.dna);
  const gcContent = best.dna.length
    ? (((counts.G || 0) + (counts.C || 0)) / best.dna.length) * 100
    : 0;

  return {
    ok: true,
    organism: profileKey,
    organismLabel: profile.label,
    protein,
    dna: best.dna,
    codons: best.codons,
    aaLength: protein.length,
    ntLength: best.dna.length,
    gcContent,
    preferenceScorePercent: best.preferenceMax
      ? (best.preferenceWeight / best.preferenceMax) * 100
      : 100,
    restrictionSites: parsedSites.sites,
    expandedRestrictionSites: parsedSites.expandedSites
  };
}

export {
  REVERSE_TRANSLATE_DEFAULT_ORGANISM,
  REVERSE_TRANSLATE_MIN_SITE_LENGTH,
  formatSequenceLines
} from './sequence-tables/codon-table.js';
export { CODON_USAGE_PROFILES } from './sequence-tables/codon-usage.js';
