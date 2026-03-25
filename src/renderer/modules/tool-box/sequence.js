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

export const REVERSE_TRANSLATE_DEFAULT_ORGANISM = 'ecoli';
const REVERSE_TRANSLATE_DEFAULT_BEAM_WIDTH = 96;
const REVERSE_TRANSLATE_MAX_BEAM_WIDTH = 512;
export const REVERSE_TRANSLATE_MIN_SITE_LENGTH = 3;

const AMINO_ACID_TO_CODONS = Object.freeze(
  Object.entries(CODON_TABLE).reduce((acc, [codon, residue]) => {
    if (!acc[residue]) {
      acc[residue] = [];
    }
    acc[residue].push(codon);
    return acc;
  }, {})
);

export const CODON_USAGE_PROFILES = Object.freeze({
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
  mouse: {
    label: 'Mouse (M. musculus)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'CTC', 'TTG', 'CTT', 'TTA', 'CTA'],
      S: ['AGC', 'TCC', 'TCT', 'AGT', 'TCA', 'TCG'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCC', 'CCT', 'CCA', 'CCG'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['AGA', 'CGC', 'AGG', 'CGG', 'CGT', 'CGA'],
      I: ['ATC', 'ATT', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACA', 'ACT', 'ACG'],
      N: ['AAC', 'AAT'],
      K: ['AAG', 'AAA'],
      V: ['GTG', 'GTC', 'GTT', 'GTA'],
      A: ['GCC', 'GCT', 'GCA', 'GCG'],
      D: ['GAC', 'GAT'],
      E: ['GAG', 'GAA'],
      G: ['GGC', 'GGA', 'GGG', 'GGT']
    }
  },
  rat: {
    label: 'Rat (R. norvegicus)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'CTC', 'TTG', 'CTT', 'TTA', 'CTA'],
      S: ['TCC', 'AGC', 'TCT', 'AGT', 'TCA', 'TCG'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCC', 'CCT', 'CCA', 'CCG'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['AGA', 'CGC', 'AGG', 'CGG', 'CGT', 'CGA'],
      I: ['ATC', 'ATT', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACA', 'ACT', 'ACG'],
      N: ['AAC', 'AAT'],
      K: ['AAG', 'AAA'],
      V: ['GTG', 'GTC', 'GTT', 'GTA'],
      A: ['GCC', 'GCT', 'GCA', 'GCG'],
      D: ['GAC', 'GAT'],
      E: ['GAG', 'GAA'],
      G: ['GGC', 'GGA', 'GGG', 'GGT']
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
  },
  pichia: {
    label: 'K. phaffii (Pichia pastoris)',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['CTG', 'TTG', 'CTT', 'TTA', 'CTA', 'CTC'],
      S: ['TCT', 'AGT', 'TCC', 'TCA', 'AGC', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TAG', 'TGA'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCA', 'CCT', 'CCC', 'CCG'],
      H: ['CAT', 'CAC'],
      Q: ['CAA', 'CAG'],
      R: ['AGA', 'CGT', 'AGG', 'CGC', 'CGA', 'CGG'],
      I: ['ATT', 'ATC', 'ATA'],
      M: ['ATG'],
      T: ['ACA', 'ACT', 'ACC', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTT', 'GTG', 'GTA', 'GTC'],
      A: ['GCT', 'GCA', 'GCC', 'GCG'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGT', 'GGA', 'GGC', 'GGG']
    }
  },
  arabidopsis: {
    label: 'Arabidopsis (A. thaliana)',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['CTT', 'TTA', 'TTG', 'CTG', 'CTA', 'CTC'],
      S: ['TCT', 'AGT', 'TCC', 'TCA', 'AGC', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TGA', 'TAG'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCA', 'CCT', 'CCC', 'CCG'],
      H: ['CAT', 'CAC'],
      Q: ['CAA', 'CAG'],
      R: ['AGA', 'AGG', 'CGT', 'CGC', 'CGA', 'CGG'],
      I: ['ATT', 'ATC', 'ATA'],
      M: ['ATG'],
      T: ['ACA', 'ACT', 'ACC', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTT', 'GTA', 'GTG', 'GTC'],
      A: ['GCT', 'GCA', 'GCC', 'GCG'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGT', 'GGA', 'GGC', 'GGG']
    }
  },
  drosophila: {
    label: 'Drosophila (D. melanogaster)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'CTC', 'TTG', 'CTT', 'TTA', 'CTA'],
      S: ['TCC', 'AGC', 'TCT', 'AGT', 'TCG', 'TCA'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCC', 'CCA', 'CCT', 'CCG'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['CGC', 'CGG', 'AGA', 'AGG', 'CGT', 'CGA'],
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
  c_elegans: {
    label: 'C. elegans',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['CTT', 'TTA', 'TTG', 'CTA', 'CTG', 'CTC'],
      S: ['TCT', 'AGT', 'TCA', 'TCC', 'AGC', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TGA', 'TAG'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCA', 'CCT', 'CCC', 'CCG'],
      H: ['CAT', 'CAC'],
      Q: ['CAA', 'CAG'],
      R: ['AGA', 'AGG', 'CGT', 'CGC', 'CGA', 'CGG'],
      I: ['ATT', 'ATA', 'ATC'],
      M: ['ATG'],
      T: ['ACA', 'ACT', 'ACC', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTT', 'GTA', 'GTG', 'GTC'],
      A: ['GCT', 'GCA', 'GCC', 'GCG'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGT', 'GGA', 'GGC', 'GGG']
    }
  },
  zebrafish: {
    label: 'Zebrafish (D. rerio)',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'TTG', 'CTC', 'CTT', 'TTA', 'CTA'],
      S: ['AGC', 'TCC', 'TCT', 'AGT', 'TCG', 'TCA'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCC', 'CCA', 'CCT', 'CCG'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['AGA', 'CGC', 'AGG', 'CGG', 'CGT', 'CGA'],
      I: ['ATC', 'ATT', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACA', 'ACT', 'ACG'],
      N: ['AAC', 'AAT'],
      K: ['AAG', 'AAA'],
      V: ['GTG', 'GTC', 'GTT', 'GTA'],
      A: ['GCC', 'GCT', 'GCA', 'GCG'],
      D: ['GAC', 'GAT'],
      E: ['GAG', 'GAA'],
      G: ['GGC', 'GGA', 'GGG', 'GGT']
    }
  },
  pseudomonas: {
    label: 'P. aeruginosa',
    preferences: {
      F: ['TTC', 'TTT'],
      L: ['CTG', 'CTC', 'CTT', 'TTG', 'TTA', 'CTA'],
      S: ['TCC', 'AGC', 'TCG', 'TCT', 'AGT', 'TCA'],
      Y: ['TAC', 'TAT'],
      '*': ['TGA', 'TAA', 'TAG'],
      C: ['TGC', 'TGT'],
      W: ['TGG'],
      P: ['CCG', 'CCC', 'CCT', 'CCA'],
      H: ['CAC', 'CAT'],
      Q: ['CAG', 'CAA'],
      R: ['CGC', 'CGG', 'CGT', 'CGA', 'AGG', 'AGA'],
      I: ['ATC', 'ATT', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACG', 'ACT', 'ACA'],
      N: ['AAC', 'AAT'],
      K: ['AAG', 'AAA'],
      V: ['GTG', 'GTC', 'GTT', 'GTA'],
      A: ['GCC', 'GCG', 'GCT', 'GCA'],
      D: ['GAC', 'GAT'],
      E: ['GAG', 'GAA'],
      G: ['GGC', 'GGG', 'GGT', 'GGA']
    }
  },
  salmonella: {
    label: 'S. enterica',
    preferences: {
      F: ['TTT', 'TTC'],
      L: ['CTG', 'TTA', 'TTG', 'CTT', 'CTC', 'CTA'],
      S: ['TCT', 'TCC', 'AGC', 'AGT', 'TCA', 'TCG'],
      Y: ['TAT', 'TAC'],
      '*': ['TAA', 'TGA', 'TAG'],
      C: ['TGT', 'TGC'],
      W: ['TGG'],
      P: ['CCG', 'CCA', 'CCT', 'CCC'],
      H: ['CAT', 'CAC'],
      Q: ['CAG', 'CAA'],
      R: ['CGT', 'CGC', 'CGG', 'AGA', 'AGG', 'CGA'],
      I: ['ATT', 'ATC', 'ATA'],
      M: ['ATG'],
      T: ['ACC', 'ACT', 'ACA', 'ACG'],
      N: ['AAT', 'AAC'],
      K: ['AAA', 'AAG'],
      V: ['GTG', 'GTT', 'GTC', 'GTA'],
      A: ['GCG', 'GCC', 'GCT', 'GCA'],
      D: ['GAT', 'GAC'],
      E: ['GAA', 'GAG'],
      G: ['GGC', 'GGT', 'GGG', 'GGA']
    }
  }
});

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
