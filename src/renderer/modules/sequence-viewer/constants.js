export const DEFAULT_MAX_RECORDS = 5000;
export const DEFAULT_SEQUENCE_LINE_LENGTH = 120;
export const DUAL_STRAND_SCROLL_STEP = 44;
export const FALLBACK_CHAR_ADVANCE_PX = 8.8;
export const FALLBACK_SEQUENCE_LINE_HEIGHT_PX = 16;
export const RESTRICTION_LABEL_GAP_PX = 14;
export const STRAND_PAIR_ROW_GAP_PX = 8;
export const DEFAULT_STRAND_MARKER_COLUMN_PX = 28;
export const DEFAULT_STRAND_COLUMN_GAP_PX = 6;
export const LINE_FEATURE_BAR_HEIGHT_PX = 16;
export const LINE_FEATURE_BAR_GAP_PX = 3;
export const LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX = 5;
export const FEATURE_TOOLTIP_OFFSET_PX = 12;
export const AMINO_ACID_ROW_LABEL = 'AA';

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

export const IUPAC_DNA_CLASS = Object.freeze({
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: '[AG]',
  Y: '[CT]',
  S: '[GC]',
  W: '[AT]',
  K: '[GT]',
  M: '[AC]',
  B: '[CGT]',
  D: '[AGT]',
  H: '[ACT]',
  V: '[ACG]',
  N: '[ACGT]'
});

export const ORF_START_CODONS = new Set(['ATG']);
export const ORF_STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);
export const DEFAULT_MIN_ORF_AA_LENGTH = 75;

export const RESTRICTION_VENDOR_CODE_BY_KEY = Object.freeze({
  neb: 'N',
  thermo: 'B'
});

export const DEFAULT_RESTRICTION_VENDOR_FILTER = Object.freeze({
  neb: true,
  thermo: true
});
