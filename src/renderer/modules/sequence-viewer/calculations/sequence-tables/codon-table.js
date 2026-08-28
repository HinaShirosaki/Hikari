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

function formatSequenceLines(sequence, lineLength = 60) {
  const lines = [];
  for (let index = 0; index < sequence.length; index += lineLength) {
    lines.push(sequence.slice(index, index + lineLength));
  }
  return lines.join('<br />');
}

const AMINO_ACID_TO_CODONS = Object.freeze(
  Object.entries(CODON_TABLE).reduce((acc, [codon, residue]) => {
    if (!acc[residue]) {
      acc[residue] = [];
    }
    acc[residue].push(codon);
    return acc;
  }, {})
);

export {
  AMINO_ACID_TO_CODONS,
  CODON_TABLE,
  REVERSE_TRANSLATE_DEFAULT_BEAM_WIDTH,
  REVERSE_TRANSLATE_DEFAULT_ORGANISM,
  REVERSE_TRANSLATE_MAX_BEAM_WIDTH,
  REVERSE_TRANSLATE_MIN_SITE_LENGTH,
  formatSequenceLines
};
