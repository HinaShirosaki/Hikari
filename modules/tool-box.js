import { BUFFER_COMPOUNDS } from './buffer-compounds.js';
import { annotatePlasmidSequence } from './plannotate-js.js';

const RESIDUE_MASS = {
  A: 71.08,
  R: 156.19,
  N: 114.1,
  D: 115.09,
  C: 103.15,
  E: 129.12,
  Q: 128.13,
  G: 57.05,
  H: 137.14,
  I: 113.16,
  L: 113.16,
  K: 128.17,
  M: 131.19,
  F: 147.18,
  P: 97.12,
  S: 87.08,
  T: 101.11,
  W: 186.21,
  Y: 163.18,
  V: 99.13
};

const PKA = {
  nTerminus: 9.69,
  cTerminus: 2.34,
  K: 10.54,
  R: 12.48,
  H: 6.04,
  D: 3.9,
  E: 4.07,
  C: 8.37,
  Y: 10.46
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CONCENTRATION_TO_M = {
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1
};

const VOLUME_TO_L = {
  uL: 1e-6,
  mL: 1e-3,
  L: 1
};

const MASS_TO_G = {
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
};

const CODON_TABLE = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
};
const REVERSE_TRANSLATE_DEFAULT_ORGANISM = 'ecoli';
const REVERSE_TRANSLATE_DEFAULT_BEAM_WIDTH = 96;
const REVERSE_TRANSLATE_MAX_BEAM_WIDTH = 512;
const REVERSE_TRANSLATE_MIN_SITE_LENGTH = 3;
const AMINO_ACID_TO_CODONS = Object.freeze(
  Object.entries(CODON_TABLE).reduce((acc, [codon, residue]) => {
    if (!acc[residue]) {
      acc[residue] = [];
    }
    acc[residue].push(codon);
    return acc;
  }, {})
);
const CODON_USAGE_PROFILES = Object.freeze({
  ecoli: {
    label: 'E. coli (K-12)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'TTA', 'TTG', 'CTC', 'CTT', 'CTA'],
      S: ['TCT', 'AGC', 'TCC', 'AGT', 'TCG', 'TCA'],
      Y: ['TAC', 'TAT'],
      '*': ['TAA', 'TGA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCG', 'CCT', 'CCA', 'CCC'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['CGT', 'CGC', 'CGG', 'AGA', 'AGG', 'CGA'],
      I: ['ATT', 'ATC', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACT', 'ACA', 'ACG'],
      N: ['AAC', 'AAT'],
      K: ['AAA', 'AAG'],
      V: ['GTG', 'GTT', 'GTC', 'GTA'],
      A: ['GCG', 'GCC', 'GCT', 'GCA'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGC', 'GGT', 'GGG', 'GGA']
    }
  },
  human: {
    label: 'Human (H. sapiens)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'CTC', 'TTG', 'CTT', 'TTA', 'CTA'],
      S: ['AGC', 'TCC', 'TCT', 'AGT', 'TCA', 'TCG'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCC', 'CCG', 'CCA', 'CCT'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['CGC', 'AGA', 'CGG', 'AGG', 'CGT', 'CGA'],
      I: ['ATC', 'ATT', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACA', 'ACT', 'ACG'],
      N: ['AAC', 'AAT'],
      K: ['AAG', 'AAA'],
      V: ['GTG', 'GTC', 'GTT', 'GTA'],
      A: ['GCC', 'GCT', 'GCA', 'GCG'],
      D: ['GAC', 'GAT'],
      E: ['GAG', 'GAA'],
      G: ['GGC', 'GGG', 'GGA', 'GGT']
    }
  },
  yeast: {
    label: 'Yeast (S. cerevisiae)',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['TTG', 'TTA', 'CTT', 'CTA', 'CTG', 'CTC'],
      S: ['TCT', 'TCA', 'AGT', 'TCC', 'AGC', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TAG', 'TGA'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCT', 'CCA', 'CCC', 'CCG'],
      H: ['CAT', 'CAC'],
      Q: ['CAA', 'CAG'],
      R: ['AGA', 'AGG', 'CGT', 'CGC', 'CGA', 'CGG'],
      I: ['ATT', 'ATA', 'ATC'],
      M: ['ATG'],
      T: ['ACT', 'ACA', 'ACC', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTT', 'GTA', 'GTG', 'GTC'],
      A: ['GCT', 'GCA', 'GCC', 'GCG'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGT', 'GGA', 'GGC', 'GGG']
    }
  },
  bacillus: {
    label: 'B. subtilis',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['TTA', 'TTG', 'CTT', 'CTA', 'CTG', 'CTC'],
      S: ['TCT', 'TCA', 'AGT', 'TCC', 'AGC', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TGA', 'TAG'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCA', 'CCT', 'CCC', 'CCG'],
      H: ['CAT', 'CAC'],
      Q: ['CAA', 'CAG'],
      R: ['AGA', 'CGT', 'AGG', 'CGC', 'CGA', 'CGG'],
      I: ['ATT', 'ATA', 'ATC'],
      M: ['ATG'],
      T: ['ACA', 'ACT', 'ACC', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTA', 'GTT', 'GTC', 'GTG'],
      A: ['GCA', 'GCT', 'GCC', 'GCG'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGA', 'GGT', 'GGC', 'GGG']
    }
  }
});

const DNA_BASE_MW = { A: 313.21, T: 304.2, G: 329.21, C: 289.18 };
const RNA_BASE_MW = { A: 329.21, U: 306.17, G: 345.21, C: 305.18 };

const DNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, T: 8700 };
const RNA_EXTINCTION = { A: 15400, C: 7400, G: 11500, U: 9900 };
const PLANNOTATE_TYPE_STYLES = {
  rep_origin: { fillColor: '#4e7fff', lineColor: '#000000' },
  origin_of_replication: { fillColor: '#4e7fff', lineColor: '#000000' },
  promoter: { fillColor: '#f6a35e', lineColor: '#000000' },
  cds: { fillColor: '#479f71', lineColor: '#000000' },
  misc_feature: { fillColor: '#808080', lineColor: '#000000' },
  primer_bind: { fillColor: '#ffffff', lineColor: '#000000' },
  terminator: { fillColor: '#c97064', lineColor: '#000000' },
  ncrna: { fillColor: '#e8dab2', lineColor: '#000000' },
  rna: { fillColor: '#e8dab2', lineColor: '#000000' }
};
const PLANNOTATE_FALLBACK_COLORS = [
  '#4e7fff',
  '#f6a35e',
  '#479f71',
  '#808080',
  '#c97064',
  '#e8dab2',
  '#8eb6ff',
  '#a3b1bf',
  '#8dc5a5',
  '#f1c086'
];
const PLANNOTATE_ORIENTED_TYPES = new Set([
  'cds',
  'exon',
  'gene',
  'intron',
  'mat_peptide',
  'mobile_element',
  'mrna',
  'ncrna',
  'orit',
  'polya_site',
  'protein_bind',
  'promoter',
  '35_signal',
  '10_signal',
  'rbs',
  'terminator',
  'trna',
  'swissprot',
  'origin_of_replication'
]);
const IUPAC_BASE_MAP = Object.freeze({
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'GC',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT'
});
const IUPAC_COMPLEMENT_MAP = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
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
  N: 'N'
});
const CRISPR_REFERENCE_GENOMES = Object.freeze([
  {
    id: 'human-hg38',
    label: 'Human (GRCh38 / hg38)',
    offTargetMultiplier: 1.35,
    note: 'Large and repetitive genome. Off-target estimates are scaled conservatively.'
  },
  {
    id: 'mouse-mm39',
    label: 'Mouse (GRCm39 / mm39)',
    offTargetMultiplier: 1.2,
    note: 'Mammalian-scale genome with moderate repeat burden.'
  },
  {
    id: 'zebrafish-gz11',
    label: 'Zebrafish (GRCz11)',
    offTargetMultiplier: 1.05,
    note: 'Intermediate genome size with common duplicated regions.'
  },
  {
    id: 'yeast-r64',
    label: 'Yeast (S288C / R64)',
    offTargetMultiplier: 0.72,
    note: 'Compact genome. Off-target rates are typically lower.'
  },
  {
    id: 'ecoli-k12',
    label: 'E. coli (K-12 MG1655)',
    offTargetMultiplier: 0.58,
    note: 'Small bacterial genome with reduced off-target search space.'
  },
  {
    id: 'custom',
    label: 'Custom / User-supplied',
    offTargetMultiplier: 1,
    note: 'No organism-specific scaling. Only submitted targets are evaluated directly.'
  }
]);

function formatSequenceLines(sequence, lineLength = 60) {
  const lines = [];
  for (let i = 0; i < sequence.length; i += lineLength) {
    lines.push(sequence.slice(i, i + lineLength));
  }
  return lines.join('<br />');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function concentrationToM(value, unit) {
  return toNumber(value) * (CONCENTRATION_TO_M[unit] || 0);
}

function concentrationFromM(valueM, unit) {
  const factor = CONCENTRATION_TO_M[unit] || 0;
  return factor ? valueM / factor : 0;
}

function volumeToL(value, unit) {
  return toNumber(value) * (VOLUME_TO_L[unit] || 0);
}

function volumeFromL(valueL, unit) {
  const factor = VOLUME_TO_L[unit] || 0;
  return factor ? valueL / factor : 0;
}

function massToG(value, unit) {
  return toNumber(value) * (MASS_TO_G[unit] || 0);
}

function massFromG(valueG, unit) {
  const factor = MASS_TO_G[unit] || 0;
  return factor ? valueG / factor : 0;
}

function formatSigFig(value, sigFigs = 4) {
  if (!Number.isFinite(value) || value === 0) {
    return '0';
  }
  const abs = Math.abs(value);
  if (abs >= 1e4 || abs < 1e-3) {
    return value.toExponential(Math.max(sigFigs - 1, 0));
  }
  return Number(value.toPrecision(sigFigs)).toString();
}

function cleanNucleotideSequence(raw, type = 'DNA') {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  const targetType = type === 'RNA' ? 'RNA' : 'DNA';
  if (targetType === 'RNA') {
    return normalized.replace(/T/g, 'U').replace(/[^ACGU]/g, '');
  }
  return normalized.replace(/U/g, 'T').replace(/[^ACGT]/g, '');
}

function nucleotideCounts(sequence) {
  const counts = {};
  for (const base of sequence) {
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

function reverseComplementDna(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence]
    .reverse()
    .map((base) => complement[base] || 'N')
    .join('');
}

function translateDnaSequence(sequence, frame = 1, stopMode = 'star') {
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
    const aa = CODON_TABLE[codon] || 'X';
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

function cleanProteinSequence(raw, allowStop = true) {
  const disallowed = allowStop ? /[^A-Z*]/g : /[^A-Z]/g;
  return String(raw || '')
    .toUpperCase()
    .replace(disallowed, '');
}

function parseRestrictionSites(raw) {
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

function resolveCodonProfile(profileKey = REVERSE_TRANSLATE_DEFAULT_ORGANISM) {
  return CODON_USAGE_PROFILES[profileKey] || CODON_USAGE_PROFILES[REVERSE_TRANSLATE_DEFAULT_ORGANISM];
}

function getCodonOptionsForResidue(residue, profileKey = REVERSE_TRANSLATE_DEFAULT_ORGANISM) {
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

function reverseTranslateProteinSequence(proteinInput, options = {}) {
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

function oligoMolecularWeight(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_BASE_MW : DNA_BASE_MW;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoExtinction(sequence, type = 'DNA') {
  const map = type === 'RNA' ? RNA_EXTINCTION : DNA_EXTINCTION;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoTm(sequence, type = 'DNA') {
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

function linearRegression(xValues, yValues) {
  const n = xValues.length;
  if (!n || n !== yValues.length) {
    return null;
  }

  const xMean = xValues.reduce((sum, value) => sum + value, 0) / n;
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / n;

  let ssXX = 0;
  let ssXY = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - xMean;
    const dy = yValues[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }

  if (ssXX === 0) {
    return null;
  }

  const slope = ssXY / ssXX;
  const intercept = yMean - (slope * xMean);
  const rSquared = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);

  return { slope, intercept, rSquared };
}

function normalizePlannotateType(type) {
  return String(type || 'misc_feature')
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hashString(value) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getPlannotateTypeStyle(type, fragment = false) {
  const normalized = normalizePlannotateType(type);
  const baseStyle = PLANNOTATE_TYPE_STYLES[normalized] || {
    fillColor: PLANNOTATE_FALLBACK_COLORS[hashString(normalized) % PLANNOTATE_FALLBACK_COLORS.length],
    lineColor: '#000000'
  };

  if (!fragment) {
    return baseStyle;
  }

  return {
    fillColor: '#ffffff',
    lineColor: baseStyle.fillColor === '#ffffff' ? baseStyle.lineColor : baseStyle.fillColor
  };
}

function getPlannotateTypeColor(type) {
  return getPlannotateTypeStyle(type, false).fillColor;
}

function hasPlannotateOrientation(type) {
  return PLANNOTATE_ORIENTED_TYPES.has(normalizePlannotateType(type));
}

function getPlannotateSegments(hit, sequenceLength, topology = 'circular') {
  if (!sequenceLength) {
    return [];
  }

  const qstart = Math.max(0, Math.min(sequenceLength, Number(hit.qstart) || 0));
  const qendRaw = Number(hit.qend);
  const qend = qendRaw === 0
    ? sequenceLength
    : Math.max(0, Math.min(sequenceLength, qendRaw || 0));

  if (topology === 'linear') {
    const left = Math.min(qstart, qend);
    const right = Math.max(qstart, qend);
    return right > left ? [{ start: left, end: right }] : [];
  }

  const wrapsOrigin = Boolean(hit.crossesOrigin) || qend < qstart;
  if (!wrapsOrigin) {
    return qend > qstart ? [{ start: qstart, end: qend }] : [];
  }

  const segments = [];
  if (sequenceLength > qstart) {
    segments.push({ start: qstart, end: sequenceLength });
  }
  if (qend > 0) {
    segments.push({ start: 0, end: qend });
  }

  if (!segments.length && qstart === 0 && qend === 0) {
    segments.push({ start: 0, end: sequenceLength });
  }

  return segments;
}

function formatPlannotateLocation(hit, sequenceLength) {
  const start = hit.qstart + 1;
  const end = hit.qend === 0 ? sequenceLength : hit.qend;
  if (!hit.crossesOrigin) {
    return `${start}..${end}`;
  }
  return `${start}..${sequenceLength}, 1..${end}`;
}

function formatPlannotateHoverInfo(hit, sequenceLength) {
  const location = formatPlannotateLocation(hit, sequenceLength);
  const strand = hit.sframe === -1 ? '-' : '+';
  const identity = Number.isFinite(hit.pident) ? `${hit.pident.toFixed(2)}%` : 'n/a';
  const coverage = Number.isFinite(hit.percmatch) ? `${hit.percmatch.toFixed(2)}%` : 'n/a';
  return `${hit.Feature} | ${hit.Type} | ${location} | Strand ${strand} | Identity ${identity} | Coverage ${coverage}`;
}

function formatBpCompact(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(1).replace(/\.0$/, '')} kb`;
  }
  return `${Math.round(numeric)} bp`;
}

function ratioToCircularAngle(ratio) {
  return (ratio * Math.PI * 2) - (Math.PI / 2);
}

function polarPoint(cx, cy, radius, theta) {
  return {
    x: cx + (radius * Math.cos(theta)),
    y: cy + (radius * Math.sin(theta))
  };
}

function makePlannotateDonutSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio) {
  if (endRatio <= startRatio) {
    return '';
  }

  const twoPi = Math.PI * 2;
  const startAngle = ratioToCircularAngle(startRatio);
  let delta = (endRatio - startRatio) * twoPi;
  if (delta >= twoPi) {
    delta = twoPi - 1e-4;
  }
  const endAngle = startAngle + delta;
  const largeArcFlag = delta > Math.PI ? 1 : 0;

  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

function makePlannotateLabelAnchor(theta) {
  const x = Math.cos(theta);
  const y = Math.sin(theta);
  if (x > 0.35) {
    return { anchor: 'start', dy: 4 };
  }
  if (x < -0.35) {
    return { anchor: 'end', dy: 4 };
  }
  return { anchor: 'middle', dy: y > 0 ? 14 : -6 };
}

function shortenPlannotateLabel(text, maxLength = 26) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, maxLength - 1)}…`;
}

function assignPlannotateCircularLevels(hits, sequenceLength) {
  const records = hits
    .map((hit) => ({
      hit,
      segments: getPlannotateSegments(hit, sequenceLength, 'circular')
        .filter((segment) => segment.end > segment.start)
        .sort((a, b) => a.start - b.start)
    }))
    .filter((item) => item.segments.length)
    .sort((a, b) => {
      if (a.segments[0].start !== b.segments[0].start) {
        return a.segments[0].start - b.segments[0].start;
      }
      const aLen = a.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
      const bLen = b.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
      return bLen - aLen;
    });

  const levelIntervals = [];
  records.forEach((record) => {
    let level = 0;
    while (true) {
      if (!levelIntervals[level]) {
        levelIntervals[level] = [];
        break;
      }
      const overlaps = record.segments.some((segment) => levelIntervals[level].some((existing) => (
        segment.start < existing.end && existing.start < segment.end
      )));
      if (!overlaps) {
        break;
      }
      level += 1;
    }

    record.level = level;
    levelIntervals[level].push(...record.segments.map((segment) => ({ ...segment })));
  });

  return records;
}

function computePlannotateTickValues(sequenceLength) {
  const approxChunk = Math.round((Math.floor(sequenceLength / 5) / 500)) * 500;
  const chunkSize = approxChunk > 0 ? approxChunk : 500;
  const ticks = [];
  for (let bp = 0; bp < sequenceLength - (chunkSize / 2); bp += chunkSize) {
    ticks.push(bp === 0 ? 1 : bp);
  }
  return ticks;
}

function renderPlannotateCircularMap(result) {
  const sequenceLength = result.sequenceLength;
  const hits = result.hits || [];
  if (!sequenceLength || !hits.length) {
    return '';
  }

  const cx = 400;
  const cy = 400;
  const backboneRadius = 205;
  const featureHalfThickness = 17;
  const levelStep = 40;
  const tickValues = computePlannotateTickValues(sequenceLength);
  const records = assignPlannotateCircularLevels(hits, sequenceLength);

  const ticks = tickValues.map((bp) => {
    const ratio = bp / sequenceLength;
    const theta = ratioToCircularAngle(ratio);
    const lineStart = polarPoint(cx, cy, backboneRadius - 6, theta);
    const lineEnd = polarPoint(cx, cy, backboneRadius - 22, theta);
    const labelPoint = polarPoint(cx, cy, backboneRadius - 40, theta);
    const anchor = makePlannotateLabelAnchor(theta);
    return `
      <line x1="${lineStart.x.toFixed(2)}" y1="${lineStart.y.toFixed(2)}" x2="${lineEnd.x.toFixed(2)}" y2="${lineEnd.y.toFixed(2)}" />
      <text x="${labelPoint.x.toFixed(2)}" y="${(labelPoint.y + anchor.dy).toFixed(2)}" text-anchor="${anchor.anchor}">${bp.toLocaleString()}</text>
    `;
  }).join('');

  const featurePaths = [];
  const connectorLines = [];
  const labels = [];

  records.forEach((record) => {
    const { hit, segments, level } = record;
    const style = getPlannotateTypeStyle(hit.Type, Boolean(hit.fragment));
    const title = escapeHtml(`${hit.Feature} (${formatPlannotateLocation(hit, sequenceLength)})`);
    const hoverInfo = escapeHtml(formatPlannotateHoverInfo(hit, sequenceLength));
    const levelRadius = backboneRadius + (level * levelStep);
    const innerRadius = Math.max(10, levelRadius - featureHalfThickness);
    const outerRadius = levelRadius + featureHalfThickness;

    segments.forEach((segment) => {
      const startRatio = segment.start / sequenceLength;
      const endRatio = segment.end / sequenceLength;
      const path = makePlannotateDonutSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio);
      if (!path) {
        return;
      }
      featurePaths.push(`
        <path
          class="plannotate-circular-hit plannotate-hover-target"
          data-hit-info="${hoverInfo}"
          d="${path}"
          fill="${style.fillColor}"
          stroke="${style.lineColor}"
          stroke-width="2.4"
          stroke-linejoin="round"
        >
          <title>${title}</title>
        </path>
      `);
    });

    const mainSegment = [...segments].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    if (!mainSegment) {
      return;
    }

    const midBp = (mainSegment.start + mainSegment.end) / 2;
    const midTheta = ratioToCircularAngle(midBp / sequenceLength);
    const lineStart = polarPoint(cx, cy, outerRadius, midTheta);
    const lineEnd = polarPoint(cx, cy, outerRadius + 30, midTheta);
    const textPoint = polarPoint(cx, cy, outerRadius + 36, midTheta);
    const textAnchor = makePlannotateLabelAnchor(midTheta);
    const labelColor = style.fillColor === '#ffffff' ? style.lineColor : style.fillColor;
    const labelText = escapeHtml(shortenPlannotateLabel(hit.Feature || 'feature'));

    connectorLines.push(`
      <line
        x1="${lineStart.x.toFixed(2)}"
        y1="${lineStart.y.toFixed(2)}"
        x2="${lineEnd.x.toFixed(2)}"
        y2="${lineEnd.y.toFixed(2)}"
        stroke="${labelColor}"
      />
    `);

    labels.push(`
      <text
        class="plannotate-hover-target"
        data-hit-info="${hoverInfo}"
        x="${textPoint.x.toFixed(2)}"
        y="${(textPoint.y + textAnchor.dy).toFixed(2)}"
        text-anchor="${textAnchor.anchor}"
        fill="${labelColor}"
      >${labelText}</text>
    `);

    if (hasPlannotateOrientation(hit.Type)) {
      const forward = Number(hit.sframe) !== -1;
      const tipBp = forward ? mainSegment.end : mainSegment.start;
      const tipTheta = ratioToCircularAngle(tipBp / sequenceLength);
      const offset = forward ? -0.11 : 0.11;
      const tip = polarPoint(cx, cy, levelRadius, tipTheta);
      const baseOuter = polarPoint(cx, cy, outerRadius + 1.5, tipTheta + offset);
      const baseInner = polarPoint(cx, cy, innerRadius - 1.5, tipTheta + offset);
      featurePaths.push(`
        <path
          class="plannotate-circular-hit plannotate-hover-target"
          data-hit-info="${hoverInfo}"
          d="M ${baseOuter.x.toFixed(2)} ${baseOuter.y.toFixed(2)} L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${baseInner.x.toFixed(2)} ${baseInner.y.toFixed(2)} Z"
          fill="${style.fillColor}"
          stroke="${style.lineColor}"
          stroke-width="2.1"
          stroke-linejoin="round"
        >
          <title>${title}</title>
        </path>
      `);
    }
  });

  return `
    <div class="plannotate-map-shell">
      <div class="plannotate-panzoom-viewport" data-panzoom="true">
        <div class="plannotate-panzoom-content">
          <svg class="plannotate-circular-map" viewBox="0 0 800 800" role="img" aria-label="Circular plasmid map">
            <circle class="plannotate-circular-backdrop" cx="${cx}" cy="${cy}" r="${backboneRadius}" />
            <g class="plannotate-circular-axis">${ticks}</g>
            <g class="plannotate-circular-features">${featurePaths.join('')}</g>
            <g class="plannotate-circular-connectors">${connectorLines.join('')}</g>
            <g class="plannotate-circular-labels plannotate-hover-target">${labels.join('')}</g>
            <text class="plannotate-circular-center" x="${cx}" y="${cy - 6}">${sequenceLength.toLocaleString()} bp</text>
            <text class="plannotate-circular-center-sub" x="${cx}" y="${cy + 18}">${hits.length} features</text>
          </svg>
        </div>
      </div>
    </div>
  `;
}

function renderPlannotateLinearMap(result) {
  const sequenceLength = result.sequenceLength;
  const hits = result.hits || [];
  if (!sequenceLength || !hits.length) {
    return '';
  }

  const sorted = hits
    .map((hit) => ({
      hit,
      segments: getPlannotateSegments(hit, sequenceLength, 'linear')
    }))
    .filter((item) => item.segments.length)
    .sort((a, b) => a.segments[0].start - b.segments[0].start);

  const lanes = [];
  sorted.forEach((item) => {
    const firstSegment = item.segments[0];
    let laneIndex = lanes.findIndex((lane) => firstSegment.start >= lane);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(firstSegment.end);
    } else {
      lanes[laneIndex] = firstSegment.end;
    }
    item.laneIndex = laneIndex;
  });

  const laneCount = Math.max(1, lanes.length);
  const laneHeightPx = 22;
  const railHeight = Math.max(32, (laneCount * laneHeightPx) + 10);
  const laneLabels = [0, 0.25, 0.5, 0.75, 1].map((ratio) => `
    <span style="left:${(ratio * 100).toFixed(2)}%">${Math.round(sequenceLength * ratio).toLocaleString()}</span>
  `).join('');

  const bars = sorted.map((item) => {
    const style = getPlannotateTypeStyle(item.hit.Type, Boolean(item.hit.fragment));
    const rowTop = 6 + (item.laneIndex * laneHeightPx);
    const title = escapeHtml(`${item.hit.Feature} (${formatPlannotateLocation(item.hit, sequenceLength)})`);
    const hoverInfo = escapeHtml(formatPlannotateHoverInfo(item.hit, sequenceLength));
    return item.segments.map((segment) => {
      const left = (segment.start / sequenceLength) * 100;
      const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100);
      return `
        <span
          class="plannotate-linear-hit plannotate-hover-target"
          style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%;top:${rowTop}px;background:${style.fillColor};border:2px solid ${style.lineColor};"
          title="${title}"
          data-hit-info="${hoverInfo}"
        ></span>
      `;
    }).join('');
  }).join('');

  return `
    <div class="plannotate-map-shell">
      <div class="plannotate-panzoom-viewport" data-panzoom="true">
        <div class="plannotate-panzoom-content">
          <div class="plannotate-linear-map" style="height:${railHeight}px;">
            <div class="plannotate-linear-track">${bars}</div>
          </div>
          <div class="plannotate-linear-axis">${laneLabels}</div>
        </div>
      </div>
    </div>
  `;
}

function renderPlannotateLegend(hits) {
  const counts = new Map();
  hits.forEach((hit) => {
    const type = String(hit.Type || 'misc_feature');
    counts.set(type, (counts.get(type) || 0) + 1);
  });

  if (!counts.size) {
    return '';
  }

  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `
      <span class="plannotate-legend-item">
        <span class="plannotate-legend-swatch" style="background:${getPlannotateTypeColor(type)};"></span>
        ${escapeHtml(type)} (${count})
      </span>
    `)
    .join('');

  return `<div class="plannotate-legend">${items}</div>`;
}

function cleanSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function countResidues(sequence) {
  const counts = {};
  for (const aa of sequence) {
    counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

function calculatePeptideMass(sequence) {
  if (!sequence.length) {
    return 0;
  }

  const residueSum = [...sequence].reduce((sum, aa) => sum + (RESIDUE_MASS[aa] || 0), 0);
  return residueSum + 18.015;
}

function positiveCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pH - pKa)));
}

function negativeCharge(pH, pKa, count) {
  return count * (1 / (1 + 10 ** (pKa - pH)));
}

function calculateNetCharge(sequence, pH) {
  const counts = countResidues(sequence);
  const positive =
    positiveCharge(pH, PKA.nTerminus, 1) +
    positiveCharge(pH, PKA.K, counts.K || 0) +
    positiveCharge(pH, PKA.R, counts.R || 0) +
    positiveCharge(pH, PKA.H, counts.H || 0);

  const negative =
    negativeCharge(pH, PKA.cTerminus, 1) +
    negativeCharge(pH, PKA.D, counts.D || 0) +
    negativeCharge(pH, PKA.E, counts.E || 0) +
    negativeCharge(pH, PKA.C, counts.C || 0) +
    negativeCharge(pH, PKA.Y, counts.Y || 0);

  return positive - negative;
}

function estimatePI(sequence) {
  if (!sequence.length) {
    return 0;
  }

  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const charge = calculateNetCharge(sequence, mid);
    if (charge > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function residueSummary(counts) {
  const keys = Object.keys(counts).sort();
  return keys.map((key) => `${key}:${counts[key]}`).join('  ');
}

function peptideStats(sequence) {
  const counts = countResidues(sequence);
  const invalidResidues = [...sequence].filter((aa) => !RESIDUE_MASS[aa]);
  const mass = calculatePeptideMass(sequence);
  const netCharge7 = calculateNetCharge(sequence, 7);
  const pI = estimatePI(sequence);

  const tyr = counts.Y || 0;
  const trp = counts.W || 0;
  const cys = counts.C || 0;

  return {
    counts,
    invalidResidues,
    length: sequence.length,
    mass,
    netCharge7,
    pI,
    extinctionReduced: 5500 * trp + 1490 * tyr,
    extinctionOxidized: 5500 * trp + 1490 * tyr + 125 * Math.floor(cys / 2)
  };
}

function renderChemicalOptions() {
  const options = BUFFER_COMPOUNDS.map(
    (chemical) => {
      const formTag = chemical.form === 'liquid' ? '; liquid' : '; solid';
      return `<option value="${chemical.name}">${chemical.name} (${chemical.mw} g/mol; ${chemical.category}${formTag})</option>`;
    }
  ).join('');
  return `${options}<option value="__custom__">Custom</option>`;
}

function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeDnaInput(raw, preserveUnknown = false) {
  const letters = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/U/g, 'T');
  if (!preserveUnknown) {
    return letters.replace(/[^ACGT]/g, '');
  }
  return letters.replace(/[^ACGT]/g, 'N');
}

function normalizeIupacPattern(raw) {
  const pattern = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!pattern) {
    return 'NGG';
  }
  return [...pattern]
    .map((base) => (IUPAC_BASE_MAP[base] ? base : 'N'))
    .join('');
}

function reverseComplementIupac(pattern) {
  return [...String(pattern || '').toUpperCase()]
    .reverse()
    .map((base) => IUPAC_COMPLEMENT_MAP[base] || 'N')
    .join('');
}

function matchesIupacPattern(sequence, pattern) {
  if (sequence.length !== pattern.length) {
    return false;
  }
  for (let i = 0; i < sequence.length; i += 1) {
    const base = sequence[i];
    const allowed = IUPAC_BASE_MAP[pattern[i]] || 'ACGT';
    if (!allowed.includes(base)) {
      return false;
    }
  }
  return true;
}

function countSequenceMismatches(left, right, maxMismatch = Infinity) {
  if (left.length !== right.length) {
    return maxMismatch + 1;
  }
  let mismatches = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      mismatches += 1;
      if (mismatches > maxMismatch) {
        return mismatches;
      }
    }
  }
  return mismatches;
}

function calculateGcPercent(sequence) {
  if (!sequence.length) {
    return 0;
  }
  const counts = nucleotideCounts(sequence);
  const gc = (counts.G || 0) + (counts.C || 0);
  return (gc / sequence.length) * 100;
}

function scoreCrisprOnTarget(guideSequence) {
  if (!guideSequence.length) {
    return 0;
  }

  const gcPercent = calculateGcPercent(guideSequence);
  const seed = guideSequence.slice(Math.max(0, guideSequence.length - 10));
  const seedGc = calculateGcPercent(seed);
  let score = 70 - (Math.abs(gcPercent - 52) * 1.25);

  if (guideSequence.startsWith('G')) {
    score += 4.5;
  }
  if (guideSequence.endsWith('GG')) {
    score += 2;
  }
  if (/TTTT/.test(guideSequence)) {
    score -= 22;
  }
  if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(guideSequence)) {
    score -= 12;
  }
  if (seedGc < 35 || seedGc > 82) {
    score -= 6;
  } else {
    score += 3;
  }
  if (!/^[ACGT]+$/.test(guideSequence)) {
    score -= 30;
  }

  return clampNumber(score, 0, 100, 0);
}

function sanitizeCrisprTargetName(rawName, fallbackName) {
  const clean = String(rawName || '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
  if (!clean) {
    return fallbackName;
  }
  return clean.slice(0, 80);
}

function buildCrisprTargetEntry(name, sequenceText, index) {
  const sequence = normalizeDnaInput(sequenceText, true);
  if (!sequence.length) {
    return null;
  }
  return {
    id: `target-${index + 1}`,
    name: sanitizeCrisprTargetName(name, `Target ${index + 1}`),
    sequence
  };
}

function parseCrisprLineTarget(line, index) {
  const namedMatch = String(line).match(/^([^:|]{1,80})\s*[:|]\s*([A-Za-z\-\s]+)$/);
  if (!namedMatch) {
    return null;
  }
  return buildCrisprTargetEntry(namedMatch[1], namedMatch[2], index);
}

function parseCrisprTargetsInput(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return [];
  }

  const parsed = [];
  const pushTarget = (name, sequenceText) => {
    const entry = buildCrisprTargetEntry(name, sequenceText, parsed.length);
    if (entry) {
      parsed.push(entry);
    }
  };

  if (/^\s*>/m.test(raw)) {
    const lines = raw.split(/\r?\n/);
    let currentName = '';
    let currentSequenceLines = [];

    const flush = () => {
      if (!currentSequenceLines.length) {
        return;
      }
      pushTarget(currentName || `Target ${parsed.length + 1}`, currentSequenceLines.join(''));
      currentSequenceLines = [];
    };

    lines.forEach((line) => {
      if (/^\s*>/.test(line)) {
        flush();
        currentName = line.replace(/^\s*>\s*/, '').trim();
      } else if (line.trim()) {
        currentSequenceLines.push(line.trim());
      }
    });
    flush();
    return parsed;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const namedTargets = lines
    .map((line, index) => parseCrisprLineTarget(line, index))
    .filter(Boolean);
  if (namedTargets.length) {
    return namedTargets.map((entry, index) => ({ ...entry, id: `target-${index + 1}` }));
  }

  const dnaLikeLines = lines.filter((line) => normalizeDnaInput(line, true).length >= 18);
  if (dnaLikeLines.length >= 2 && dnaLikeLines.length === lines.length) {
    dnaLikeLines.forEach((line) => pushTarget(`Target ${parsed.length + 1}`, line));
    return parsed;
  }

  pushTarget('Target 1', raw);
  return parsed;
}

function collectCrisprPamSites(target, guideLength, pamPattern) {
  const sequence = String(target.sequence || '').toUpperCase();
  const pamLength = pamPattern.length;
  const reversePamPattern = reverseComplementIupac(pamPattern);
  const windowSize = guideLength + pamLength;
  const sites = [];

  for (let i = 0; i + windowSize <= sequence.length; i += 1) {
    const guideForward = sequence.slice(i, i + guideLength);
    const pamForward = sequence.slice(i + guideLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideForward) && matchesIupacPattern(pamForward, pamPattern)) {
      sites.push({
        key: `${target.id}|+|${i + 1}`,
        targetId: target.id,
        targetName: target.name,
        strand: '+',
        start: i + 1,
        end: i + guideLength,
        guideSequence: guideForward,
        pamSequence: pamForward
      });
    }

    const pamReverse = sequence.slice(i, i + pamLength);
    const guideReverseWindow = sequence.slice(i + pamLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideReverseWindow) && matchesIupacPattern(pamReverse, reversePamPattern)) {
      sites.push({
        key: `${target.id}|-|${i + pamLength + 1}`,
        targetId: target.id,
        targetName: target.name,
        strand: '-',
        start: i + pamLength + 1,
        end: i + windowSize,
        guideSequence: reverseComplementDna(guideReverseWindow),
        pamSequence: reverseComplementDna(pamReverse)
      });
    }
  }

  return sites;
}

function collectCrisprPamSitesFromTargets(targets, guideLength, pamPattern) {
  const allSites = [];
  targets.forEach((target) => {
    allSites.push(...collectCrisprPamSites(target, guideLength, pamPattern));
  });
  return allSites;
}

function computeCrisprOffTargetStats(candidate, backgroundSites, genomeMultiplier = 1) {
  const mismatchCounts = {
    exact: 0,
    mismatch1: 0,
    mismatch2: 0,
    mismatch3: 0
  };

  backgroundSites.forEach((site) => {
    if (site.key === candidate.key) {
      return;
    }

    const mismatches = countSequenceMismatches(candidate.guideSequence, site.guideSequence, 3);
    if (mismatches > 3) {
      return;
    }

    if (mismatches === 0) {
      mismatchCounts.exact += 1;
    } else if (mismatches === 1) {
      mismatchCounts.mismatch1 += 1;
    } else if (mismatches === 2) {
      mismatchCounts.mismatch2 += 1;
    } else {
      mismatchCounts.mismatch3 += 1;
    }
  });

  const weightedRisk =
    (mismatchCounts.exact * 1.25) +
    (mismatchCounts.mismatch1 * 0.46) +
    (mismatchCounts.mismatch2 * 0.16) +
    (mismatchCounts.mismatch3 * 0.05);
  const offTargetRate = clampNumber(weightedRisk * 14.5 * genomeMultiplier, 0, 99.9, 0);
  const specificityScore = clampNumber(100 - offTargetRate, 0, 100, 100);

  return {
    mismatchCounts,
    offTargetRate,
    specificityScore
  };
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${Number(value).toFixed(digits)}%`;
}

function designCrisprGuides({
  selectedTargets,
  backgroundTargets,
  guideLength,
  pamPattern,
  minGc,
  maxGc,
  topCount,
  genomeMultiplier
}) {
  const selectedSites = collectCrisprPamSitesFromTargets(selectedTargets, guideLength, pamPattern);
  const candidates = selectedSites
    .map((site) => {
      const gcPercent = calculateGcPercent(site.guideSequence);
      const notes = [];
      if (/TTTT/.test(site.guideSequence)) {
        notes.push('poly-T motif');
      }
      if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(site.guideSequence)) {
        notes.push('homopolymer');
      }

      return {
        ...site,
        gcPercent,
        onTargetScore: scoreCrisprOnTarget(site.guideSequence),
        notes
      };
    })
    .filter((candidate) => candidate.gcPercent >= minGc && candidate.gcPercent <= maxGc);

  if (!candidates.length) {
    return {
      candidates: [],
      totalPamMatches: selectedSites.length,
      filteredCandidateCount: 0,
      evaluatedCandidateCount: 0,
      backgroundSiteCount: 0,
      scannedBackgroundSiteCount: 0,
      truncatedBackground: false,
      truncatedCandidates: false
    };
  }

  candidates.sort((left, right) => (
    (right.onTargetScore - left.onTargetScore) ||
    (right.gcPercent - left.gcPercent)
  ));

  const maxBackgroundSites = 15000;
  const maxEvaluatedCandidates = Math.min(
    candidates.length,
    Math.max(topCount * 4, 120),
    320
  );
  const backgroundSites = collectCrisprPamSitesFromTargets(backgroundTargets, guideLength, pamPattern);
  const scannedBackgroundSites = backgroundSites.slice(0, maxBackgroundSites);

  const scoredCandidates = candidates
    .slice(0, maxEvaluatedCandidates)
    .map((candidate) => {
      const offTarget = computeCrisprOffTargetStats(candidate, scannedBackgroundSites, genomeMultiplier);
      const totalScore = (candidate.onTargetScore * 0.62) + (offTarget.specificityScore * 0.38);
      return {
        ...candidate,
        ...offTarget,
        totalScore
      };
    })
    .sort((left, right) => (
      (right.totalScore - left.totalScore) ||
      (right.onTargetScore - left.onTargetScore) ||
      (right.specificityScore - left.specificityScore)
    ));

  return {
    candidates: scoredCandidates.slice(0, topCount),
    totalPamMatches: selectedSites.length,
    filteredCandidateCount: candidates.length,
    evaluatedCandidateCount: scoredCandidates.length,
    backgroundSiteCount: backgroundSites.length,
    scannedBackgroundSiteCount: scannedBackgroundSites.length,
    truncatedBackground: backgroundSites.length > scannedBackgroundSites.length,
    truncatedCandidates: candidates.length > scoredCandidates.length
  };
}

function makeBufferRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'buffer-row';
  wrapper.innerHTML = `
    <label>
      Chemical
      <select class="buffer-chemical-select">
        ${renderChemicalOptions()}
      </select>
    </label>
    <label>
      Custom Name
      <input class="buffer-custom-name" placeholder="Chemical name" disabled />
    </label>
    <label class="buffer-custom-form-wrap" hidden>
      Custom Type
      <select class="buffer-custom-form" disabled>
        <option value="solid" selected>Solid</option>
        <option value="liquid">Liquid</option>
      </select>
    </label>
    <label>
      MW (g/mol)
      <input class="buffer-mw" type="number" min="0" step="0.001" />
    </label>
    <label>
      <span class="buffer-concentration-label">Concentration (mM)</span>
      <input class="buffer-concentration" type="number" min="0" step="0.001" placeholder="e.g. 150" />
    </label>
    <div class="buffer-output">
      <span class="buffer-weight">0 mg</span>
    </div>
    <button type="button" class="ghost-btn buffer-remove-btn">Remove</button>
  `;

  const select = wrapper.querySelector('.buffer-chemical-select');
  const mwInput = wrapper.querySelector('.buffer-mw');
  const customNameInput = wrapper.querySelector('.buffer-custom-name');

  const first = BUFFER_COMPOUNDS[0];
  select.value = first.name;
  mwInput.value = first.mw;
  customNameInput.value = '';

  return wrapper;
}

export function initToolBox() {
  const toolTiles = [...document.querySelectorAll('.tool-tile')];
  const toolSubviews = [...document.querySelectorAll('.tool-subview')];
  const molarityMassForm = document.getElementById('molarity-mass-form');
  const massCalcResult = document.getElementById('mass-calc-result');
  const molarityVolumeForm = document.getElementById('molarity-volume-form');
  const volumeCalcResult = document.getElementById('volume-calc-result');
  const molarityConcentrationForm = document.getElementById('molarity-concentration-form');
  const concCalcResult = document.getElementById('conc-calc-result');
  const molarityDilutionForm = document.getElementById('molarity-dilution-form');
  const dilutionCalcResult = document.getElementById('dilution-calc-result');

  const peptideForm = document.getElementById('peptide-form');
  const peptideResult = document.getElementById('peptide-result');

  const bufferVolumeInput = document.getElementById('buffer-volume-ml');
  const bufferRows = document.getElementById('buffer-rows');
  const addBufferChemicalBtn = document.getElementById('add-buffer-chemical-btn');
  const bufferTotalResult = document.getElementById('buffer-total-result');

  const dnaProteinForm = document.getElementById('dna-protein-form');
  const dnaProteinResult = document.getElementById('dna-protein-result');
  const reverseTranslateForm = document.getElementById('reverse-translate-form');
  const reverseTranslateOrganismSelect = document.getElementById('reverse-translate-organism');
  const reverseTranslateResult = document.getElementById('reverse-translate-result');

  const oligoForm = document.getElementById('oligo-form');
  const oligoResult = document.getElementById('oligo-result');

  const extinctionForm = document.getElementById('extinction-form');
  const extinctionResult = document.getElementById('extinction-result');

  const qpcrForm = document.getElementById('qpcr-form');
  const qpcrResult = document.getElementById('qpcr-result');

  const plannotateForm = document.getElementById('plannotate-form');
  const plannotateResult = document.getElementById('plannotate-result');
  const plannotateSequenceInput = document.getElementById('plannotate-sequence');
  const plannotateTopologySelect = document.getElementById('plannotate-topology');
  const plannotateDetailedToggle = document.getElementById('plannotate-detailed');
  const plannotateMinIdentityInput = document.getElementById('plannotate-min-identity');
  const plannotateMinCoverageInput = document.getElementById('plannotate-min-coverage');
  const plannotateMinLengthInput = document.getElementById('plannotate-min-length');
  const plannotateMapHost = document.getElementById('plannotate-map');
  const plannotateMapMeta = document.getElementById('plannotate-map-meta');
  const plannotateHitCount = document.getElementById('plannotate-hit-count');
  const plannotateTableBody = document.getElementById('plannotate-table-body');
  const plannotateRunStatus = document.getElementById('plannotate-run-status');
  const plannotateModeTextBtn = document.getElementById('plannotate-mode-text');
  const plannotateModeFileBtn = document.getElementById('plannotate-mode-file');
  const plannotateTextPanel = document.getElementById('plannotate-text-panel');
  const plannotateFilePanel = document.getElementById('plannotate-file-panel');
  const plannotateEngineStatus = document.getElementById('plannotate-engine-status');
  const plannotateInstallAllBtn = document.getElementById('plannotate-install-all');
  const plannotateFileInput = document.getElementById('plannotate-file-input');
  const plannotateFileChooseBtn = document.getElementById('plannotate-file-choose');
  const plannotateFileName = document.getElementById('plannotate-file-name');
  const crisprForm = document.getElementById('crispr-form');
  const crisprReferenceGenomeSelect = document.getElementById('crispr-reference-genome');
  const crisprReferenceNote = document.getElementById('crispr-reference-note');
  const crisprPamPatternSelect = document.getElementById('crispr-pam-pattern');
  const crisprGuideLengthInput = document.getElementById('crispr-guide-length');
  const crisprTopCountInput = document.getElementById('crispr-top-count');
  const crisprMinGcInput = document.getElementById('crispr-min-gc');
  const crisprMaxGcInput = document.getElementById('crispr-max-gc');
  const crisprTargetInput = document.getElementById('crispr-target-input');
  const crisprTargetSelect = document.getElementById('crispr-target-select');
  const crisprSelectionSummary = document.getElementById('crispr-selection-summary');
  const crisprSelectAllBtn = document.getElementById('crispr-select-all-btn');
  const crisprClearBtn = document.getElementById('crispr-clear-btn');
  const crisprResultSummary = document.getElementById('crispr-result-summary');
  const crisprTableBody = document.getElementById('crispr-table-body');

  const plannotateState = {
    mode: 'text',
    fileName: '',
    fileText: ''
  };
  const crisprState = {
    targets: []
  };

  function getSelectedCompound(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value === '__custom__') {
      return null;
    }
    return BUFFER_COMPOUNDS.find((item) => item.name === select.value) || null;
  }

  function getBufferRowForm(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value === '__custom__') {
      return row.querySelector('.buffer-custom-form').value;
    }

    const compound = getSelectedCompound(row);
    return compound?.form === 'liquid' ? 'liquid' : 'solid';
  }

  function applyBufferRowMode(row) {
    const form = getBufferRowForm(row);
    const mwInput = row.querySelector('.buffer-mw');
    const concentrationLabel = row.querySelector('.buffer-concentration-label');
    const concentrationInput = row.querySelector('.buffer-concentration');

    if (form === 'liquid') {
      concentrationLabel.textContent = 'Volume (% v/v)';
      concentrationInput.placeholder = 'e.g. 0.1';
      concentrationInput.step = '0.0001';
      mwInput.disabled = true;
    } else {
      concentrationLabel.textContent = 'Concentration (mM)';
      concentrationInput.placeholder = 'e.g. 150';
      concentrationInput.step = '0.001';
      mwInput.disabled = false;
    }
  }

  function showToolView(viewId) {
    toolSubviews.forEach((subview) => {
      subview.hidden = subview.id !== viewId;
    });
    toolTiles.forEach((tile) => {
      tile.classList.toggle('tool-tile-active', tile.dataset.toolView === viewId);
    });
  }

  function populateReverseTranslateProfileOptions() {
    if (!reverseTranslateOrganismSelect) {
      return;
    }

    const selected = CODON_USAGE_PROFILES[reverseTranslateOrganismSelect.value]
      ? reverseTranslateOrganismSelect.value
      : REVERSE_TRANSLATE_DEFAULT_ORGANISM;

    reverseTranslateOrganismSelect.innerHTML = Object.entries(CODON_USAGE_PROFILES)
      .map(([key, profile]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${profile.label}</option>`)
      .join('');
    reverseTranslateOrganismSelect.value = selected;
  }

  function renderMolarity() {
    const massConcValue = toNumber(document.getElementById('mass-calc-concentration').value);
    const massConcUnit = document.getElementById('mass-calc-concentration-unit').value;
    const massMw = toNumber(document.getElementById('mass-calc-mw').value);
    const massVolumeValue = toNumber(document.getElementById('mass-calc-volume').value);
    const massVolumeUnit = document.getElementById('mass-calc-volume-unit').value;
    const massOutputUnit = document.getElementById('mass-calc-output-unit').value;

    const massM = concentrationToM(massConcValue, massConcUnit);
    const massL = volumeToL(massVolumeValue, massVolumeUnit);
    const massMoles = massM * massL;
    const massG = massMoles * massMw;
    const massOutput = massFromG(massG, massOutputUnit);

    if (massM > 0 && massL > 0 && massMw > 0) {
      massCalcResult.textContent = `Mass needed: ${massOutput.toFixed(6)} ${massOutputUnit} (${massG.toExponential(6)} g, ${massMoles.toExponential(6)} mol).`;
    } else {
      massCalcResult.textContent = 'Enter concentration, formula weight, and volume to calculate mass.';
    }

    const volumeMassValue = toNumber(document.getElementById('volume-calc-mass').value);
    const volumeMassUnit = document.getElementById('volume-calc-mass-unit').value;
    const volumeMw = toNumber(document.getElementById('volume-calc-mw').value);
    const volumeConcValue = toNumber(document.getElementById('volume-calc-concentration').value);
    const volumeConcUnit = document.getElementById('volume-calc-concentration-unit').value;
    const volumeOutputUnit = document.getElementById('volume-calc-output-unit').value;

    const volumeG = massToG(volumeMassValue, volumeMassUnit);
    const volumeM = concentrationToM(volumeConcValue, volumeConcUnit);
    const volumeMoles = volumeMw > 0 ? volumeG / volumeMw : 0;
    const volumeL = volumeM > 0 ? volumeMoles / volumeM : 0;
    const volumeOutput = volumeFromL(volumeL, volumeOutputUnit);

    if (volumeG > 0 && volumeMw > 0 && volumeM > 0) {
      volumeCalcResult.textContent = `Final volume: ${volumeOutput.toFixed(6)} ${volumeOutputUnit} (${volumeL.toExponential(6)} L).`;
    } else {
      volumeCalcResult.textContent = 'Enter mass, formula weight, and concentration to calculate volume.';
    }

    const concMassValue = toNumber(document.getElementById('conc-calc-mass').value);
    const concMassUnit = document.getElementById('conc-calc-mass-unit').value;
    const concMw = toNumber(document.getElementById('conc-calc-mw').value);
    const concVolumeValue = toNumber(document.getElementById('conc-calc-volume').value);
    const concVolumeUnit = document.getElementById('conc-calc-volume-unit').value;
    const concOutputUnit = document.getElementById('conc-calc-output-unit').value;

    const concMassG = massToG(concMassValue, concMassUnit);
    const concVolumeL = volumeToL(concVolumeValue, concVolumeUnit);
    const concMoles = concMw > 0 ? concMassG / concMw : 0;
    const concM = concVolumeL > 0 ? concMoles / concVolumeL : 0;
    const concOutput = concentrationFromM(concM, concOutputUnit);

    if (concMassG > 0 && concMw > 0 && concVolumeL > 0) {
      concCalcResult.textContent = `Concentration: ${concOutput.toFixed(6)} ${concOutputUnit} (${concM.toExponential(6)} M).`;
    } else {
      concCalcResult.textContent = 'Enter mass, formula weight, and volume to calculate concentration.';
    }

    const stockConcValue = toNumber(document.getElementById('dilution-stock-conc').value);
    const stockConcUnit = document.getElementById('dilution-stock-conc-unit').value;
    const targetConcValue = toNumber(document.getElementById('dilution-target-conc').value);
    const targetConcUnit = document.getElementById('dilution-target-conc-unit').value;
    const targetVolumeValue = toNumber(document.getElementById('dilution-target-volume').value);
    const targetVolumeUnit = document.getElementById('dilution-target-volume-unit').value;
    const dilutionOutputUnit = document.getElementById('dilution-output-unit').value;

    const stockM = concentrationToM(stockConcValue, stockConcUnit);
    const targetM = concentrationToM(targetConcValue, targetConcUnit);
    const targetVL = volumeToL(targetVolumeValue, targetVolumeUnit);
    const stockVL = stockM > 0 ? (targetM * targetVL) / stockM : 0;
    const diluentVL = targetVL - stockVL;
    const stockOutput = volumeFromL(stockVL, dilutionOutputUnit);
    const diluentOutput = volumeFromL(diluentVL, dilutionOutputUnit);

    if (stockM > 0 && targetM > 0 && targetVL > 0 && stockM >= targetM && diluentVL >= 0) {
      dilutionCalcResult.textContent = `Use ${stockOutput.toFixed(6)} ${dilutionOutputUnit} stock + ${diluentOutput.toFixed(6)} ${dilutionOutputUnit} diluent.`;
    } else if (stockM > 0 && targetM > stockM) {
      dilutionCalcResult.textContent = 'Desired concentration cannot be higher than stock concentration.';
    } else {
      dilutionCalcResult.textContent = 'Enter stock concentration, desired concentration, and final volume to calculate dilution.';
    }
  }

  function renderPeptide() {
    const sequence = cleanSequence(document.getElementById('peptide-sequence').value);

    if (!sequence.length) {
      peptideResult.innerHTML = '<p class="small-note">Enter a peptide sequence to calculate properties.</p>';
      return;
    }

    const stats = peptideStats(sequence);
    const countsText = residueSummary(stats.counts);

    peptideResult.innerHTML = `
      <p><strong>Length:</strong> ${stats.length} aa</p>
      <p><strong>Molecular weight:</strong> ${stats.mass.toFixed(2)} Da</p>
      <p><strong>Estimated pI:</strong> ${stats.pI.toFixed(2)}</p>
      <p><strong>Estimated net charge (pH 7.0):</strong> ${stats.netCharge7.toFixed(2)}</p>
      <p><strong>Extinction coefficient 280 nm (reduced):</strong> ${stats.extinctionReduced} M^-1 cm^-1</p>
      <p><strong>Extinction coefficient 280 nm (oxidized):</strong> ${stats.extinctionOxidized} M^-1 cm^-1</p>
      <p><strong>Residue counts:</strong> ${countsText || 'N/A'}</p>
    `;

    if (stats.invalidResidues.length) {
      peptideResult.innerHTML += '<p class="small-note">Sequence includes non-standard residues. Their masses are treated as 0.</p>';
    }
  }

  function renderDnaProtein() {
    const raw = document.getElementById('dna-protein-sequence').value;
    const type = document.getElementById('dna-protein-type').value;
    const frame = document.getElementById('dna-protein-frame').value;
    const stopMode = document.getElementById('dna-protein-stop-mode').value;

    const nucleotideSequence = cleanNucleotideSequence(raw, type);
    if (!nucleotideSequence.length) {
      dnaProteinResult.innerHTML = '<p class="small-note">Enter DNA or RNA sequence for translation.</p>';
      return;
    }

    const dnaSequence = type === 'RNA'
      ? nucleotideSequence.replace(/U/g, 'T')
      : nucleotideSequence;
    const translated = translateDnaSequence(dnaSequence, frame, stopMode);

    dnaProteinResult.innerHTML = `
      <p><strong>Nucleotide length:</strong> ${nucleotideSequence.length}</p>
      <p><strong>Reading frame:</strong> ${translated.strand}${translated.frame}</p>
      <p><strong>Codons translated:</strong> ${translated.codons}</p>
      <p><strong>Remainder bases:</strong> ${translated.remainderBases}</p>
      <p><strong>Protein length:</strong> ${translated.protein.length} aa</p>
      <p><strong>Protein sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.protein || '-')}</div>
    `;
  }

  function renderReverseTranslate() {
    const rawProtein = document.getElementById('reverse-translate-protein').value;
    const organism = reverseTranslateOrganismSelect?.value || REVERSE_TRANSLATE_DEFAULT_ORGANISM;
    const restrictionRaw = document.getElementById('reverse-translate-sites').value;
    const appendStopCodon = Boolean(document.getElementById('reverse-translate-append-stop').checked);
    const cleanedProtein = cleanProteinSequence(rawProtein, true);
    const parsedSites = parseRestrictionSites(restrictionRaw);
    const warningRows = [];

    if (!cleanedProtein.length) {
      reverseTranslateResult.innerHTML = '<p class="small-note">Enter a protein sequence to reverse translate.</p>';
      return;
    }

    if (parsedSites.ignoredTokens.length) {
      warningRows.push(
        `<p class="small-note">Ignored site tokens: ${escapeHtml(parsedSites.ignoredTokens.join(', '))}. Use DNA motifs with A/C/G/T and at least ${REVERSE_TRANSLATE_MIN_SITE_LENGTH} nt.</p>`
      );
    }

    const translated = reverseTranslateProteinSequence(cleanedProtein, {
      organism,
      restrictionSites: parsedSites.sites,
      appendStopCodon
    });

    if (!translated.ok) {
      const progressLine = Number.isFinite(translated.translatedResidues)
        ? `<p><strong>Progress:</strong> ${translated.translatedResidues}/${cleanedProtein.length} residues translated.</p>`
        : '';
      const partialDnaBlock = translated.dna
        ? `
          <p><strong>Partial DNA sequence:</strong></p>
          <div class="sequence-block">${formatSequenceLines(translated.dna)}</div>
        `
        : '';

      reverseTranslateResult.innerHTML = `
        <p><strong>Status:</strong> Unable to satisfy all constraints.</p>
        <p><strong>Reason:</strong> ${escapeHtml(translated.message || 'Unknown constraint error.')}</p>
        <p><strong>Organism profile:</strong> ${escapeHtml(translated.organismLabel || resolveCodonProfile(organism).label)}</p>
        ${progressLine}
        ${partialDnaBlock}
        ${warningRows.join('')}
      `;
      return;
    }

    const verificationProtein = translateDnaSequence(translated.dna, 1, 'star').protein;
    const restrictionSummary = translated.restrictionSites.length
      ? translated.restrictionSites.join(', ')
      : 'None';

    reverseTranslateResult.innerHTML = `
      <p><strong>Organism profile:</strong> ${escapeHtml(translated.organismLabel)}</p>
      <p><strong>Protein length:</strong> ${translated.aaLength} aa</p>
      <p><strong>DNA length:</strong> ${translated.ntLength} bp</p>
      <p><strong>GC content:</strong> ${translated.gcContent.toFixed(2)}%</p>
      <p><strong>Codon preference score:</strong> ${translated.preferenceScorePercent.toFixed(2)}%</p>
      <p><strong>Restricted motifs avoided:</strong> ${escapeHtml(restrictionSummary)}</p>
      <p><strong>DNA sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.dna || '-')}</div>
      <p><strong>Codon sequence:</strong></p>
      <div class="sequence-block">${formatSequenceLines(translated.codons.join(' ') || '-')}</div>
      <p><strong>Translation check (+1 frame):</strong> ${escapeHtml(verificationProtein || '-')}</p>
      ${warningRows.join('')}
    `;
  }

  function renderOligo() {
    const type = document.getElementById('oligo-type').value;
    const sequence = cleanNucleotideSequence(document.getElementById('oligo-sequence').value, type);
    if (!sequence.length) {
      oligoResult.innerHTML = '<p class="small-note">Enter an oligo sequence to calculate properties.</p>';
      return;
    }

    const counts = nucleotideCounts(sequence);
    const length = sequence.length;
    const gcCount = (counts.G || 0) + (counts.C || 0);
    const gcPercent = (gcCount / length) * 100;
    const tm = oligoTm(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ext = oligoExtinction(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;
    const countsText = Object.keys(counts)
      .sort()
      .map((base) => `${base}:${counts[base]}`)
      .join('  ');

    oligoResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${length} nt</p>
      <p><strong>GC content:</strong> ${gcPercent.toFixed(2)}%</p>
      <p><strong>Approx Tm:</strong> ${tm.toFixed(2)} C</p>
      <p><strong>Approx molecular weight:</strong> ${mw.toFixed(2)} g/mol</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
      <p><strong>Base counts:</strong> ${countsText}</p>
    `;
  }

  function renderExtinction() {
    const type = document.getElementById('extinction-type').value;
    const raw = document.getElementById('extinction-sequence').value;

    if (type === 'protein') {
      const sequence = cleanSequence(raw);
      if (!sequence.length) {
        extinctionResult.innerHTML = '<p class="small-note">Enter a protein sequence.</p>';
        return;
      }

      const counts = countResidues(sequence);
      const trp = counts.W || 0;
      const tyr = counts.Y || 0;
      const cys = counts.C || 0;
      const reduced = 5500 * trp + 1490 * tyr;
      const oxidized = reduced + 125 * Math.floor(cys / 2);

      extinctionResult.innerHTML = `
        <p><strong>Sequence length:</strong> ${sequence.length} aa</p>
        <p><strong>Reduced extinction (280 nm):</strong> ${reduced} M^-1 cm^-1</p>
        <p><strong>Oxidized extinction (280 nm):</strong> ${oxidized} M^-1 cm^-1</p>
        <p><strong>Counts:</strong> W:${trp} Y:${tyr} C:${cys}</p>
      `;
      return;
    }

    const sequence = cleanNucleotideSequence(raw, type);
    if (!sequence.length) {
      extinctionResult.innerHTML = '<p class="small-note">Enter a nucleotide sequence.</p>';
      return;
    }

    const ext = oligoExtinction(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;

    extinctionResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${sequence.length} nt</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
    `;
  }

  function renderQpcr() {
    const slopeInput = toNumber(document.getElementById('qpcr-slope').value);
    const pointsRaw = document.getElementById('qpcr-points').value.trim();

    let slope = Number.isFinite(slopeInput) && slopeInput !== 0 ? slopeInput : 0;
    let intercept = null;
    let rSquared = null;
    let pointCount = 0;

    if (pointsRaw) {
      const rows = pointsRaw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const xValues = [];
      const yValues = [];
      rows.forEach((line) => {
        const parts = line.split(/[,\t ]+/).filter(Boolean);
        if (parts.length < 2) {
          return;
        }
        const qty = Number(parts[0]);
        const ct = Number(parts[1]);
        if (qty > 0 && Number.isFinite(ct)) {
          xValues.push(Math.log10(qty));
          yValues.push(ct);
        }
      });

      pointCount = xValues.length;
      if (pointCount >= 2) {
        const fit = linearRegression(xValues, yValues);
        if (fit) {
          slope = fit.slope;
          intercept = fit.intercept;
          rSquared = fit.rSquared;
        }
      }
    }

    if (!slope) {
      qpcrResult.innerHTML = '<p class="small-note">Enter slope or at least two quantity/Ct points.</p>';
      return;
    }

    const efficiency = (10 ** (-1 / slope)) - 1;
    const efficiencyPercent = efficiency * 100;
    const status = (efficiencyPercent >= 90 && efficiencyPercent <= 110)
      ? 'Within typical acceptable range (90-110%).'
      : 'Outside typical acceptable range (90-110%).';

    const extra = [];
    if (pointCount >= 2) {
      extra.push(`<p><strong>Points used:</strong> ${pointCount}</p>`);
    }
    if (intercept !== null) {
      extra.push(`<p><strong>Intercept:</strong> ${intercept.toFixed(4)}</p>`);
    }
    if (rSquared !== null) {
      extra.push(`<p><strong>R^2:</strong> ${rSquared.toFixed(4)}</p>`);
    }

    qpcrResult.innerHTML = `
      <p><strong>Slope:</strong> ${slope.toFixed(6)}</p>
      <p><strong>Efficiency:</strong> ${efficiencyPercent.toFixed(2)}%</p>
      <p><strong>Status:</strong> ${status}</p>
      ${extra.join('')}
    `;
  }

  function setPlannotateStatus(message, isError = false) {
    if (!plannotateRunStatus) {
      return;
    }
    plannotateRunStatus.textContent = message;
    plannotateRunStatus.style.color = isError ? 'var(--danger)' : '';
  }

  async function refreshPlannotateEngineStatus() {
    if (!plannotateEngineStatus) {
      return;
    }

    plannotateEngineStatus.textContent = 'Checking blastn/diamond backend...';
    const checker = window.enanaApi?.plannotateCheckEnv;
    if (typeof checker !== 'function') {
      plannotateEngineStatus.textContent = 'Native backend bridge unavailable.';
      return;
    }

    try {
      const response = await checker();
      if (!response?.ok) {
        plannotateEngineStatus.textContent = `Backend check failed: ${response?.error || 'unknown error'}`;
        return;
      }
      const status = response.status || {};
      if (status.ok) {
        plannotateEngineStatus.textContent = 'Backend ready: blastn + diamond + databases detected.';
      } else {
        const missing = [];
        if (!status.dataDir) {
          missing.push('metadata');
        }
        if (!status.dbDir || !status.databases?.snapgene || !status.databases?.fpbase || !status.databases?.swissprot) {
          missing.push('BLAST_dbs');
        }
        if (!status.executables?.blastn) {
          missing.push('blastn');
        }
        if (!status.executables?.diamond) {
          missing.push('diamond');
        }
        const details = missing.length ? `Missing: ${missing.join(', ')}` : 'Missing backend components.';
        plannotateEngineStatus.textContent = `Backend not ready. ${details}`;
      }
    } catch (error) {
      plannotateEngineStatus.textContent = `Backend check failed: ${error.message || error}`;
    }
  }

  function setupPlannotateMapInteractions() {
    if (!plannotateMapHost) {
      return;
    }

    const viewport = plannotateMapHost.querySelector('.plannotate-panzoom-viewport');
    const content = viewport?.querySelector('.plannotate-panzoom-content');
    if (!viewport || !content) {
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'plannotate-map-tooltip';
    tooltip.hidden = true;
    viewport.appendChild(tooltip);

    const state = {
      scale: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0
    };

    function hideTooltip() {
      tooltip.hidden = true;
    }

    function clampPan() {
      const viewportWidth = viewport.clientWidth || 1;
      const viewportHeight = viewport.clientHeight || 1;
      const contentWidth = content.scrollWidth || viewportWidth;
      const contentHeight = content.scrollHeight || viewportHeight;

      const maxX = Math.max(40, ((contentWidth * state.scale) - viewportWidth) / 2 + 24);
      const maxY = Math.max(40, ((contentHeight * state.scale) - viewportHeight) / 2 + 24);
      state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
      state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
    }

    function applyTransform() {
      clampPan();
      content.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    }

    function updateTooltipPosition(event, text) {
      if (!text || state.dragging) {
        hideTooltip();
        return;
      }

      tooltip.textContent = text;
      tooltip.hidden = false;

      const bounds = viewport.getBoundingClientRect();
      let x = event.clientX - bounds.left + 14;
      let y = event.clientY - bounds.top + 14;
      const maxX = viewport.clientWidth - tooltip.offsetWidth - 8;
      const maxY = viewport.clientHeight - tooltip.offsetHeight - 8;
      x = Math.max(8, Math.min(maxX, x));
      y = Math.max(8, Math.min(maxY, y));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    }

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      state.dragging = true;
      state.pointerId = event.pointerId;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      viewport.classList.add('is-dragging');
      viewport.setPointerCapture(event.pointerId);
      hideTooltip();
      event.preventDefault();
    });

    viewport.addEventListener('pointermove', (event) => {
      if (state.dragging && event.pointerId === state.pointerId) {
        const dx = event.clientX - state.lastX;
        const dy = event.clientY - state.lastY;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        state.panX += dx;
        state.panY += dy;
        applyTransform();
        return;
      }

      const hoverTarget = event.target?.closest('[data-hit-info]');
      if (hoverTarget && viewport.contains(hoverTarget)) {
        updateTooltipPosition(event, hoverTarget.getAttribute('data-hit-info'));
      } else {
        hideTooltip();
      }
    });

    function stopDragging(event) {
      if (!state.dragging || event.pointerId !== state.pointerId) {
        return;
      }
      state.dragging = false;
      state.pointerId = null;
      viewport.classList.remove('is-dragging');
      hideTooltip();
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore pointer-capture release errors.
      }
    }

    viewport.addEventListener('pointerup', stopDragging);
    viewport.addEventListener('pointercancel', stopDragging);
    viewport.addEventListener('pointerleave', () => {
      if (!state.dragging) {
        hideTooltip();
      }
    });

    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : (1 / 1.12);
      const nextScale = Math.max(0.55, Math.min(4.5, state.scale * factor));
      if (nextScale === state.scale) {
        return;
      }
      state.scale = nextScale;
      applyTransform();
      hideTooltip();
    }, { passive: false });

    viewport.addEventListener('dblclick', () => {
      state.scale = 1;
      state.panX = 0;
      state.panY = 0;
      applyTransform();
      hideTooltip();
    });

    applyTransform();
  }

  function setPlannotateMode(mode) {
    const resolvedMode = mode === 'file' ? 'file' : 'text';
    plannotateState.mode = resolvedMode;

    if (plannotateModeTextBtn) {
      plannotateModeTextBtn.classList.toggle('plannotate-mode-btn-active', resolvedMode === 'text');
    }
    if (plannotateModeFileBtn) {
      plannotateModeFileBtn.classList.toggle('plannotate-mode-btn-active', resolvedMode === 'file');
    }
    if (plannotateTextPanel) {
      plannotateTextPanel.hidden = resolvedMode !== 'text';
    }
    if (plannotateFilePanel) {
      plannotateFilePanel.hidden = resolvedMode !== 'file';
    }
  }

  function clearPlannotateTable(message = 'No annotations yet.') {
    if (!plannotateTableBody) {
      return;
    }
    plannotateTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="small-note">${escapeHtml(message)}</td>
      </tr>
    `;
  }

  function renderPlannotateEmptyMap(message = 'Run annotation to display the plasmid map.') {
    if (!plannotateMapHost) {
      return;
    }
    plannotateMapHost.innerHTML = `<p class="small-note">${escapeHtml(message)}</p>`;
  }

  function normalizeIupacDna(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/U/g, 'T')
      .replace(/[^ACGTRYSWKMBDHVN]/g, '');
  }

  function extractPlannotateSequence(rawInput) {
    const raw = String(rawInput || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      return { sequence: '', warning: '' };
    }

    const hasGenbankHeader = /^\s*LOCUS\b/im.test(trimmed);
    const originMatch = trimmed.match(/^\s*ORIGIN\b([\s\S]*)$/im);
    if (originMatch) {
      const fromOrigin = originMatch[1];
      const stopIndex = fromOrigin.search(/^\s*\/\/\s*$/m);
      const originBody = stopIndex >= 0 ? fromOrigin.slice(0, stopIndex) : fromOrigin;
      const sequence = normalizeIupacDna(originBody);
      return {
        sequence,
        warning: sequence ? '' : 'GenBank ORIGIN block was found but no DNA symbols were parsed.'
      };
    }

    if (hasGenbankHeader) {
      return {
        sequence: '',
        warning: 'GenBank input detected, but no ORIGIN section was found.'
      };
    }

    if (/^\s*>/m.test(trimmed)) {
      const sequence = normalizeIupacDna(trimmed.replace(/^>.*$/gm, ''));
      return { sequence, warning: '' };
    }

    return {
      sequence: normalizeIupacDna(trimmed),
      warning: ''
    };
  }

  function readPlannotateFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function runPlannotateAnnotation(sequence, options) {
    const backend = window.enanaApi?.plannotateAnnotate;
    if (typeof backend === 'function') {
      const response = await backend({
        sequenceText: sequence,
        topology: options.topology,
        detailed: options.detailed,
        minIdentity: options.minIdentity,
        minCoverage: options.minCoverage,
        minHitLength: options.minHitLength
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'pLannotate backend annotation failed.');
      }
      return response.result;
    }

    const fallback = annotatePlasmidSequence(sequence, options);
    fallback.warnings = [
      'Native blastn/diamond backend unavailable. Displaying JS fallback annotations.',
      ...(fallback.warnings || [])
    ];
    return fallback;
  }

  async function renderPlannotate() {
    if (!plannotateResult) {
      return;
    }

    const raw = plannotateState.mode === 'file'
      ? plannotateState.fileText
      : (plannotateSequenceInput?.value || '');

    const parsed = extractPlannotateSequence(raw);
    if (!parsed.sequence) {
      const emptyReason = plannotateState.mode === 'file'
        ? (plannotateState.fileName ? 'Selected file does not contain a valid sequence.' : 'Choose a FASTA/GenBank file to annotate.')
        : 'Paste a DNA sequence, FASTA entry, or GenBank content to annotate.';

      if (plannotateMapMeta) {
        plannotateMapMeta.textContent = '';
      }
      if (plannotateHitCount) {
        plannotateHitCount.textContent = '0 hits';
      }
      renderPlannotateEmptyMap(emptyReason);
      clearPlannotateTable(emptyReason);
      plannotateResult.innerHTML = parsed.warning
        ? `<p class="small-note">${escapeHtml(parsed.warning)}</p>`
        : `<p class="small-note">${escapeHtml(emptyReason)}</p>`;
      setPlannotateStatus('Idle');
      return;
    }

    const baseOptions = {
      topology: plannotateTopologySelect?.value || 'circular',
      detailed: Boolean(plannotateDetailedToggle?.checked),
      minIdentity: toNumber(plannotateMinIdentityInput?.value || 85),
      minCoverage: toNumber(plannotateMinCoverageInput?.value || 25) / 100,
      minHitLength: Math.round(toNumber(plannotateMinLengthInput?.value || 24))
    };

    let result = await runPlannotateAnnotation(parsed.sequence, baseOptions);

    const warnings = [];
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
    warnings.push(...(result.warnings || []));

    const warningRows = warnings
      .map((warning) => `<p class="small-note">${escapeHtml(warning)}</p>`)
      .join('');

    if (plannotateMapMeta) {
      plannotateMapMeta.textContent = `${result.sequenceLength.toLocaleString()} bp · ${result.topology}`;
    }
    if (plannotateHitCount) {
      plannotateHitCount.textContent = `${result.hits.length} hits`;
    }

    const mapMarkup = result.topology === 'linear'
      ? renderPlannotateLinearMap(result)
      : renderPlannotateCircularMap(result);
    const legendMarkup = renderPlannotateLegend(result.hits);
    if (plannotateMapHost) {
      plannotateMapHost.innerHTML = mapMarkup
        ? `${mapMarkup}${legendMarkup}`
        : '<p class="small-note">No annotations passed the current thresholds.</p>';
      setupPlannotateMapInteractions();
    }

    if (!result.hits.length) {
      clearPlannotateTable('No annotations passed the current thresholds.');
      plannotateResult.innerHTML = `
        <p><strong>Reference features scanned:</strong> ${result.stats.referenceFeatures}</p>
        <p class="small-note">No annotations passed the current thresholds.</p>
        ${warningRows}
      `;
      setPlannotateStatus('Completed: 0 hits');
      return;
    }

    const tableRows = result.hits.map((hit, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(hit.Feature)}</td>
        <td>${escapeHtml(hit.Type)}</td>
        <td>${escapeHtml(formatPlannotateLocation(hit, result.sequenceLength))}</td>
        <td>${hit.sframe === -1 ? '-' : '+'}</td>
        <td>${hit.pident.toFixed(2)}%</td>
        <td>${hit.percmatch.toFixed(2)}%</td>
        <td>${hit.matchMode}</td>
      </tr>
    `).join('');

    if (plannotateTableBody) {
      plannotateTableBody.innerHTML = tableRows;
    }

    plannotateResult.innerHTML = `
      <p><strong>Sequence length:</strong> ${result.sequenceLength.toLocaleString()} bp</p>
      <p><strong>Hits:</strong> ${result.stats.finalHits} (exact: ${result.stats.exactHits}, partial: ${result.stats.partialHits})</p>
      <p><strong>Reference features scanned:</strong> ${result.stats.referenceFeatures}</p>
      ${warningRows}
    `;
    setPlannotateStatus(`Completed: ${result.hits.length} hits`);
  }

  function setCrisprTableMessage(message = 'No sgRNA candidates yet.') {
    if (!crisprTableBody) {
      return;
    }
    crisprTableBody.innerHTML = `
      <tr>
        <td colspan="12" class="small-note">${escapeHtml(message)}</td>
      </tr>
    `;
  }

  function getSelectedCrisprReferenceGenome() {
    const selectedId = crisprReferenceGenomeSelect?.value || CRISPR_REFERENCE_GENOMES[0].id;
    return CRISPR_REFERENCE_GENOMES.find((genome) => genome.id === selectedId) || CRISPR_REFERENCE_GENOMES[0];
  }

  function updateCrisprReferenceNote() {
    if (!crisprReferenceNote) {
      return;
    }
    const genome = getSelectedCrisprReferenceGenome();
    crisprReferenceNote.textContent = genome?.note || 'Reference genome profile not selected.';
  }

  function populateCrisprReferenceGenomeOptions() {
    if (!crisprReferenceGenomeSelect) {
      return;
    }
    const current = crisprReferenceGenomeSelect.value;
    crisprReferenceGenomeSelect.innerHTML = CRISPR_REFERENCE_GENOMES
      .map((genome) => `<option value="${genome.id}">${escapeHtml(genome.label)}</option>`)
      .join('');
    if (current && CRISPR_REFERENCE_GENOMES.some((genome) => genome.id === current)) {
      crisprReferenceGenomeSelect.value = current;
    } else {
      crisprReferenceGenomeSelect.value = CRISPR_REFERENCE_GENOMES[0].id;
    }
    updateCrisprReferenceNote();
  }

  function getSelectedCrisprTargets() {
    if (!crisprTargetSelect) {
      return [];
    }
    const selectedIds = new Set(
      [...crisprTargetSelect.selectedOptions].map((option) => option.value)
    );
    return crisprState.targets.filter((target) => selectedIds.has(target.id));
  }

  function renderCrisprSelectionSummary() {
    if (!crisprSelectionSummary) {
      return;
    }
    if (!crisprState.targets.length) {
      crisprSelectionSummary.textContent = 'Add target sequences to begin.';
      return;
    }

    const selectedTargets = getSelectedCrisprTargets();
    const totalBases = selectedTargets.reduce((sum, target) => sum + target.sequence.length, 0);
    const shortest = selectedTargets.length
      ? Math.min(...selectedTargets.map((target) => target.sequence.length))
      : 0;
    const longest = selectedTargets.length
      ? Math.max(...selectedTargets.map((target) => target.sequence.length))
      : 0;

    crisprSelectionSummary.innerHTML = `
      <p><strong>Targets loaded:</strong> ${crisprState.targets.length}</p>
      <p><strong>Targets selected:</strong> ${selectedTargets.length}</p>
      <p><strong>Total selected length:</strong> ${totalBases.toLocaleString()} bp</p>
      <p><strong>Length range:</strong> ${shortest.toLocaleString()}-${longest.toLocaleString()} bp</p>
      <p class="small-note">Tip: Use FASTA headers to name each target sequence.</p>
    `;
  }

  function refreshCrisprTargets(selectAll = false) {
    if (!crisprTargetSelect || !crisprTargetInput) {
      return;
    }

    const previousSelection = new Set(
      [...crisprTargetSelect.selectedOptions].map((option) => option.value)
    );
    const hadPreviousSelection = previousSelection.size > 0;
    crisprState.targets = parseCrisprTargetsInput(crisprTargetInput.value);

    if (!crisprState.targets.length) {
      crisprTargetSelect.innerHTML = '<option value="" disabled>No targets parsed.</option>';
      renderCrisprSelectionSummary();
      return;
    }

    const optionsMarkup = crisprState.targets.map((target) => {
      const shouldSelect = selectAll || !hadPreviousSelection || previousSelection.has(target.id);
      const selectedAttr = shouldSelect ? ' selected' : '';
      return `<option value="${target.id}"${selectedAttr}>${escapeHtml(target.name)} (${target.sequence.length.toLocaleString()} bp)</option>`;
    }).join('');
    crisprTargetSelect.innerHTML = optionsMarkup;
    renderCrisprSelectionSummary();
  }

  function renderCrisprDesignResults(result, context) {
    const { guideLength, pamPattern, referenceGenome } = context;
    const warnings = [];
    if (result.truncatedCandidates) {
      warnings.push('Only the highest on-target guides were fully off-target scored for performance.');
    }
    if (result.truncatedBackground) {
      warnings.push('Off-target scanning used a truncated background window set.');
    }

    if (!result.candidates.length) {
      const noCandidateMessage = result.totalPamMatches > 0
        ? 'No candidates passed current GC and scoring filters. Try widening GC range or using a different PAM.'
        : 'No PAM-matching guides were found for the selected targets.';
      if (crisprResultSummary) {
        crisprResultSummary.innerHTML = `
          <p><strong>Reference genome:</strong> ${escapeHtml(referenceGenome.label)}</p>
          <p><strong>PAM:</strong> ${escapeHtml(pamPattern)} | <strong>Guide length:</strong> ${guideLength} nt</p>
          <p><strong>PAM-matching guides:</strong> ${result.totalPamMatches.toLocaleString()}</p>
          <p class="small-note">${escapeHtml(noCandidateMessage)}</p>
        `;
      }
      setCrisprTableMessage(noCandidateMessage);
      return;
    }

    const tableRows = result.candidates.map((candidate, index) => {
      const offTargetRate = candidate.offTargetRate;
      const riskClass = offTargetRate <= 10
        ? 'crispr-risk-low'
        : (offTargetRate <= 30 ? 'crispr-risk-medium' : 'crispr-risk-high');
      const notes = candidate.notes.length ? candidate.notes.join(', ') : '-';
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(candidate.targetName)}</td>
          <td>${candidate.start.toLocaleString()}-${candidate.end.toLocaleString()}</td>
          <td>${candidate.strand}</td>
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.guideSequence)}</span></td>
          <td><span class="crispr-guide-seq">${escapeHtml(candidate.pamSequence)}</span></td>
          <td>${candidate.gcPercent.toFixed(1)}%</td>
          <td>${candidate.onTargetScore.toFixed(1)}</td>
          <td><span class="crispr-risk-badge ${riskClass}">${formatPercent(offTargetRate, 2)}</span></td>
          <td>${candidate.specificityScore.toFixed(1)}</td>
          <td>${candidate.mismatchCounts.exact}/${candidate.mismatchCounts.mismatch1}/${candidate.mismatchCounts.mismatch2}/${candidate.mismatchCounts.mismatch3}</td>
          <td>${escapeHtml(notes)}</td>
        </tr>
      `;
    }).join('');

    if (crisprTableBody) {
      crisprTableBody.innerHTML = tableRows;
    }

    if (crisprResultSummary) {
      crisprResultSummary.innerHTML = `
        <p><strong>Reference genome:</strong> ${escapeHtml(referenceGenome.label)}</p>
        <p><strong>PAM:</strong> ${escapeHtml(pamPattern)} | <strong>Guide length:</strong> ${guideLength} nt</p>
        <p><strong>Guides evaluated:</strong> ${result.evaluatedCandidateCount.toLocaleString()} / ${result.filteredCandidateCount.toLocaleString()} filtered candidates (${result.totalPamMatches.toLocaleString()} PAM-matching guides detected)</p>
        <p><strong>Background sites scanned:</strong> ${result.scannedBackgroundSiteCount.toLocaleString()} / ${result.backgroundSiteCount.toLocaleString()}</p>
        ${warnings.map((warning) => `<p class="small-note">${escapeHtml(warning)}</p>`).join('')}
      `;
    }
  }

  function runCrisprDesign() {
    const selectedTargets = getSelectedCrisprTargets();
    if (!selectedTargets.length) {
      if (crisprResultSummary) {
        crisprResultSummary.textContent = 'Select at least one target sequence to design sgRNAs.';
      }
      setCrisprTableMessage('Select at least one target sequence to design sgRNAs.');
      return;
    }

    const referenceGenome = getSelectedCrisprReferenceGenome();
    const guideLength = Math.round(clampNumber(crisprGuideLengthInput?.value, 18, 24, 20));
    const topCount = Math.round(clampNumber(crisprTopCountInput?.value, 1, 100, 12));
    let minGc = clampNumber(crisprMinGcInput?.value, 0, 100, 35);
    let maxGc = clampNumber(crisprMaxGcInput?.value, 0, 100, 75);
    if (minGc > maxGc) {
      [minGc, maxGc] = [maxGc, minGc];
    }

    const pamPattern = normalizeIupacPattern(crisprPamPatternSelect?.value || 'NGG');
    const result = designCrisprGuides({
      selectedTargets,
      backgroundTargets: crisprState.targets.length ? crisprState.targets : selectedTargets,
      guideLength,
      pamPattern,
      minGc,
      maxGc,
      topCount,
      genomeMultiplier: referenceGenome.offTargetMultiplier || 1
    });

    renderCrisprDesignResults(result, {
      guideLength,
      pamPattern,
      referenceGenome
    });
  }

  function resolveChemicalName(row) {
    const select = row.querySelector('.buffer-chemical-select');
    if (select.value !== '__custom__') {
      return select.value;
    }

    return row.querySelector('.buffer-custom-name').value.trim() || 'Custom Chemical';
  }

  function renderBuffer() {
    const volumeMl = toNumber(bufferVolumeInput.value);
    const volumeL = volumeMl / 1000;

    let totalSolidMg = 0;
    let totalLiquidMl = 0;

    [...bufferRows.querySelectorAll('.buffer-row')].forEach((row) => {
      const name = resolveChemicalName(row);
      const form = getBufferRowForm(row);
      const concentrationValue = toNumber(row.querySelector('.buffer-concentration').value);

      if (form === 'liquid') {
        const requiredMl = (concentrationValue / 100) * volumeMl;
        const requiredUl = requiredMl * 1000;
        totalLiquidMl += requiredMl;
        row.querySelector('.buffer-weight').textContent = `${name}: ${formatSigFig(requiredMl)} mL (${formatSigFig(requiredUl)} uL) at ${formatSigFig(concentrationValue)}% v/v`;
        return;
      }

      const mw = toNumber(row.querySelector('.buffer-mw').value);
      const concentrationMm = concentrationValue;
      const grams = (concentrationMm / 1000) * volumeL * mw;
      const mg = grams * 1000;
      totalSolidMg += mg;
      row.querySelector('.buffer-weight').textContent = `${name}: ${formatSigFig(mg)} mg (${formatSigFig(grams)} g) at ${formatSigFig(concentrationMm)} mM`;
    });

    bufferTotalResult.textContent = `Total solids: ${formatSigFig(totalSolidMg)} mg (${formatSigFig(totalSolidMg / 1000)} g) | Total liquids: ${formatSigFig(totalLiquidMl)} mL (${formatSigFig(totalLiquidMl * 1000)} uL)`;
  }

  function addRow() {
    const row = makeBufferRow();
    applyBufferRowMode(row);
    bufferRows.appendChild(row);
    renderBuffer();
  }

  [
    molarityMassForm,
    molarityVolumeForm,
    molarityConcentrationForm,
    molarityDilutionForm
  ].forEach((form) => {
    form.addEventListener('input', renderMolarity);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      renderMolarity();
    });
  });

  peptideForm.addEventListener('input', renderPeptide);
  peptideForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderPeptide();
  });

  dnaProteinForm.addEventListener('input', renderDnaProtein);
  dnaProteinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderDnaProtein();
  });

  reverseTranslateForm.addEventListener('input', renderReverseTranslate);
  reverseTranslateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderReverseTranslate();
  });

  oligoForm.addEventListener('input', renderOligo);
  oligoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderOligo();
  });

  extinctionForm.addEventListener('input', renderExtinction);
  extinctionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderExtinction();
  });

  qpcrForm.addEventListener('input', renderQpcr);
  qpcrForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderQpcr();
  });

  if (plannotateForm) {
    setPlannotateMode('text');
    setPlannotateStatus('Idle');
    renderPlannotateEmptyMap('Run annotation to display the plasmid map.');
    clearPlannotateTable('No annotations yet.');
    void refreshPlannotateEngineStatus();

    plannotateInstallAllBtn?.addEventListener('click', async () => {
      const installer = window.enanaApi?.plannotateInstallAll;
      if (typeof installer !== 'function') {
        setPlannotateStatus('Installer bridge unavailable.', true);
        return;
      }
      plannotateInstallAllBtn.disabled = true;
      setPlannotateStatus('Installing metadata + BLAST databases + executables...');
      if (plannotateEngineStatus) {
        plannotateEngineStatus.textContent = 'Installing pLannotate backend assets...';
      }
      try {
        const response = await installer();
        if (!response?.ok) {
          throw new Error(response?.error || 'Installation failed.');
        }
        const logs = response.result?.logs || [];
        const status = response.result?.status || {};
        const missing = [];
        if (!status.dataDir) {
          missing.push('metadata');
        }
        if (!status.dbDir || !status.databases?.snapgene || !status.databases?.fpbase || !status.databases?.swissprot) {
          missing.push('BLAST_dbs');
        }
        if (!status.executables?.blastn) {
          missing.push('blastn');
        }
        if (!status.executables?.diamond) {
          missing.push('diamond');
        }
        if (logs.length) {
          plannotateResult.innerHTML = `<p class="small-note">${escapeHtml(logs.join(' | '))}</p>`;
        }
        if (missing.length) {
          setPlannotateStatus(`Install finished, missing: ${missing.join(', ')}`, true);
        } else {
          setPlannotateStatus('Install completed.');
        }
      } catch (error) {
        setPlannotateStatus(error.message || 'Install failed.', true);
      } finally {
        plannotateInstallAllBtn.disabled = false;
        await refreshPlannotateEngineStatus();
      }
    });

    plannotateModeTextBtn?.addEventListener('click', () => {
      setPlannotateMode('text');
      setPlannotateStatus('Idle');
    });

    plannotateModeFileBtn?.addEventListener('click', () => {
      setPlannotateMode('file');
      setPlannotateStatus('Idle');
    });

    plannotateFileChooseBtn?.addEventListener('click', () => {
      plannotateFileInput?.click();
    });

    plannotateFileInput?.addEventListener('change', async () => {
      const file = plannotateFileInput.files?.[0];
      if (!file) {
        return;
      }
      try {
        setPlannotateStatus('Loading file...');
        plannotateState.fileText = await readPlannotateFile(file);
        plannotateState.fileName = file.name || '';
        if (plannotateFileName) {
          plannotateFileName.textContent = plannotateState.fileName || 'No file selected';
        }
        setPlannotateStatus(`Loaded ${plannotateState.fileName || 'file'}`);
      } catch (error) {
        plannotateState.fileText = '';
        plannotateState.fileName = '';
        if (plannotateFileName) {
          plannotateFileName.textContent = 'No file selected';
        }
        setPlannotateStatus(error.message || 'Failed to load file.', true);
      }
    });

    plannotateSequenceInput?.addEventListener('input', () => {
      if (plannotateState.mode === 'text') {
        setPlannotateStatus('Ready');
      }
    });

    plannotateForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setPlannotateStatus('Running annotation...');
      try {
        await renderPlannotate();
      } catch (error) {
        setPlannotateStatus(error.message || 'Annotation failed.', true);
        plannotateResult.innerHTML = `<p class="small-note">${escapeHtml(error.message || 'Annotation failed.')}</p>`;
      }
    });
  }

  if (crisprForm) {
    populateCrisprReferenceGenomeOptions();
    refreshCrisprTargets(true);
    setCrisprTableMessage('No sgRNA candidates yet.');

    crisprReferenceGenomeSelect?.addEventListener('change', () => {
      updateCrisprReferenceNote();
    });

    crisprTargetInput?.addEventListener('input', () => {
      refreshCrisprTargets();
      if (!crisprTargetInput.value.trim()) {
        if (crisprResultSummary) {
          crisprResultSummary.textContent = 'Enter target sequences and run design to view candidate guides.';
        }
        setCrisprTableMessage('No sgRNA candidates yet.');
      }
    });

    crisprTargetSelect?.addEventListener('change', () => {
      renderCrisprSelectionSummary();
    });

    crisprSelectAllBtn?.addEventListener('click', () => {
      refreshCrisprTargets(true);
    });

    crisprClearBtn?.addEventListener('click', () => {
      if (crisprTargetInput) {
        crisprTargetInput.value = '';
      }
      crisprState.targets = [];
      if (crisprTargetSelect) {
        crisprTargetSelect.innerHTML = '<option value="" disabled>No targets parsed.</option>';
      }
      renderCrisprSelectionSummary();
      if (crisprResultSummary) {
        crisprResultSummary.textContent = 'Enter target sequences and run design to view candidate guides.';
      }
      setCrisprTableMessage('No sgRNA candidates yet.');
    });

    crisprForm.addEventListener('submit', (event) => {
      event.preventDefault();
      runCrisprDesign();
    });
  }

  addBufferChemicalBtn.addEventListener('click', addRow);
  bufferVolumeInput.addEventListener('input', renderBuffer);

  bufferRows.addEventListener('input', (event) => {
    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    if (event.target.classList.contains('buffer-custom-form')) {
      applyBufferRowMode(row);
    }

    renderBuffer();
  });

  bufferRows.addEventListener('click', (event) => {
    if (!event.target.classList.contains('buffer-remove-btn')) {
      return;
    }

    const row = event.target.closest('.buffer-row');
    if (!row) {
      return;
    }

    row.remove();

    if (!bufferRows.children.length) {
      addRow();
    }

    renderBuffer();
  });

  bufferRows.addEventListener('change', (event) => {
    const customForm = event.target.closest('.buffer-custom-form');
    if (customForm) {
      const row = customForm.closest('.buffer-row');
      if (row) {
        applyBufferRowMode(row);
        renderBuffer();
      }
      return;
    }

    const select = event.target.closest('.buffer-chemical-select');
    if (!select) {
      return;
    }

    const row = select.closest('.buffer-row');
    const customNameInput = row.querySelector('.buffer-custom-name');
    const customFormWrap = row.querySelector('.buffer-custom-form-wrap');
    const customFormSelect = row.querySelector('.buffer-custom-form');
    const mwInput = row.querySelector('.buffer-mw');

    if (select.value === '__custom__') {
      customNameInput.disabled = false;
      customNameInput.focus();
      customFormWrap.hidden = false;
      customFormSelect.disabled = false;
      if (customFormSelect.value === 'solid') {
        mwInput.disabled = false;
      } else {
        mwInput.disabled = true;
      }
      renderBuffer();
      return;
    }

    customNameInput.disabled = true;
    customNameInput.value = '';
    customFormWrap.hidden = true;
    customFormSelect.disabled = true;

    const chemical = BUFFER_COMPOUNDS.find((item) => item.name === select.value);
    mwInput.value = chemical ? chemical.mw : '';
    applyBufferRowMode(row);
    renderBuffer();
  });

  toolTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      showToolView(tile.dataset.toolView);
    });
  });

  showToolView('tool-molarity-view');

  populateReverseTranslateProfileOptions();
  addRow();
  renderMolarity();
  renderPeptide();
  renderDnaProtein();
  renderReverseTranslate();
  renderOligo();
  renderExtinction();
  renderQpcr();
  void renderPlannotate().catch(() => {});
}
